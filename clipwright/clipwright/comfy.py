"""ComfyUI API client: inject prompts into a workflow template, queue, poll, fetch.

Workflow templates live in workflows/ as API-format exports (ComfyUI:
Workflow menu > Export (API)). Each template <name>.json has a sibling
<name>.map.json describing which node inputs receive what:

{
  "positive_prompt": ["6", "inputs", "text"],
  "negative_prompt": ["7", "inputs", "text"],
  "seed":            ["3", "inputs", "seed"],
  "start_image":     ["10", "inputs", "image"],     // LoadImage filename (optional)
  "frame_count":     ["12", "inputs", "length"],    // optional
  "fps":             ["12", "inputs", "fps"]        // optional
}
"""

from __future__ import annotations

import json
import random
import shutil
import time
import urllib.parse
import urllib.request
import uuid
from pathlib import Path


class ComfyError(RuntimeError):
    pass


class ComfyClient:
    def __init__(self, base_url: str = "http://127.0.0.1:8188",
                 workflows_dir: Path | str = "workflows"):
        self.base = base_url.rstrip("/")
        self.workflows_dir = Path(workflows_dir)
        self.client_id = str(uuid.uuid4())

    # ---------- http ----------

    def _get(self, path: str) -> bytes:
        try:
            with urllib.request.urlopen(self.base + path, timeout=30) as r:
                return r.read()
        except Exception as e:
            raise ComfyError(f"ComfyUI GET {path} failed: {e}. "
                             f"Is ComfyUI running at {self.base}?")

    def _post_json(self, path: str, payload: dict) -> dict:
        body = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(self.base + path, data=body,
                                     headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", errors="replace")[:2000]
            raise ComfyError(f"ComfyUI POST {path} -> HTTP {e.code}: {detail}")
        except Exception as e:
            raise ComfyError(f"ComfyUI POST {path} failed: {e}. "
                             f"Is ComfyUI running at {self.base}?")

    def ping(self) -> bool:
        try:
            self._get("/system_stats")
            return True
        except ComfyError:
            return False

    # ---------- templates ----------

    def list_templates(self) -> list[dict]:
        out = []
        if not self.workflows_dir.exists():
            return out
        for f in sorted(self.workflows_dir.glob("*.json")):
            if f.name.endswith(".map.json"):
                continue
            has_map = (f.parent / f"{f.stem}.map.json").exists()
            out.append({"name": f.stem, "mapped": has_map})
        return out

    def load_template(self, name: str) -> tuple[dict, dict]:
        wf_path = self.workflows_dir / f"{name}.json"
        map_path = self.workflows_dir / f"{name}.map.json"
        if not wf_path.exists():
            raise ComfyError(f"workflow template not found: {wf_path}")
        if not map_path.exists():
            raise ComfyError(
                f"mapping file missing: {map_path}. Create it to tell "
                f"Clipwright which nodes take the prompt/seed/image "
                f"(see workflows/README.md).")
        workflow = json.loads(wf_path.read_text(encoding="utf-8"))
        mapping = json.loads(map_path.read_text(encoding="utf-8"))
        return workflow, mapping

    @staticmethod
    def _set_by_path(workflow: dict, node_path: list, value) -> None:
        cur = workflow
        for key in node_path[:-1]:
            if key not in cur:
                raise ComfyError(f"mapping path {node_path} not found in workflow "
                                 f"(missing {key!r}) - re-export the API workflow "
                                 f"or fix the .map.json")
            cur = cur[key]
        cur[node_path[-1]] = value

    # ---------- upload / queue / poll / fetch ----------

    def upload_image(self, file_path: Path) -> str:
        """Upload a reference image; returns the ComfyUI-side filename."""
        boundary = uuid.uuid4().hex
        data = file_path.read_bytes()
        body = (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="image"; '
            f'filename="{file_path.name}"\r\n'
            f"Content-Type: application/octet-stream\r\n\r\n"
        ).encode() + data + f"\r\n--{boundary}--\r\n".encode()
        req = urllib.request.Request(
            self.base + "/upload/image", data=body,
            headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                resp = json.loads(r.read().decode("utf-8"))
            return resp["name"]
        except Exception as e:
            raise ComfyError(f"image upload failed: {e}")

    def queue(self, template: str, positive: str, negative: str = "",
              seed: int | None = None, start_image: Path | None = None,
              duration_seconds: float | None = None,
              fps: int | None = None) -> dict:
        """Build a workflow from a template and queue it. Returns
        {prompt_id, seed, workflow} - workflow is the exact graph submitted."""
        workflow, mapping = self.load_template(template)
        if seed is None:
            seed = random.randint(0, 2**48)
        self._set_by_path(workflow, mapping["positive_prompt"], positive)
        if "negative_prompt" in mapping and negative:
            self._set_by_path(workflow, mapping["negative_prompt"], negative)
        if "seed" in mapping:
            self._set_by_path(workflow, mapping["seed"], seed)
        if start_image is not None:
            if "start_image" not in mapping:
                raise ComfyError("clip has a start image but the template map "
                                 "has no 'start_image' entry")
            uploaded = self.upload_image(start_image)
            self._set_by_path(workflow, mapping["start_image"], uploaded)
        if duration_seconds and "frame_count" in mapping:
            use_fps = fps or 25
            self._set_by_path(workflow, mapping["frame_count"],
                              int(duration_seconds * use_fps) + 1)
        if fps and "fps" in mapping:
            self._set_by_path(workflow, mapping["fps"], fps)
        resp = self._post_json("/prompt", {"prompt": workflow,
                                           "client_id": self.client_id})
        if "prompt_id" not in resp:
            raise ComfyError(f"unexpected /prompt response: {resp}")
        return {"prompt_id": resp["prompt_id"], "seed": seed,
                "workflow": workflow}

    def status(self, prompt_id: str) -> dict:
        """Returns {state: queued|running|done|failed, outputs: [...], error}."""
        hist = json.loads(self._get(f"/history/{prompt_id}").decode("utf-8"))
        if prompt_id not in hist:
            queue = json.loads(self._get("/queue").decode("utf-8"))
            running = any(item[1] == prompt_id
                          for item in queue.get("queue_running", []))
            return {"state": "running" if running else "queued"}
        entry = hist[prompt_id]
        st = entry.get("status", {})
        if st.get("status_str") == "error":
            msgs = [m for m in st.get("messages", []) if m[0] == "execution_error"]
            detail = msgs[0][1].get("exception_message", "") if msgs else ""
            return {"state": "failed", "error": detail or "execution error"}
        outputs = []
        for node_out in entry.get("outputs", {}).values():
            for key in ("videos", "gifs", "images"):
                for item in node_out.get(key, []):
                    outputs.append({"filename": item.get("filename"),
                                    "subfolder": item.get("subfolder", ""),
                                    "type": item.get("type", "output"),
                                    "kind": key})
        return {"state": "done", "outputs": outputs}

    def fetch_output(self, output: dict, dest: Path) -> Path:
        """Download an output file via /view into dest (a file path)."""
        q = urllib.parse.urlencode({"filename": output["filename"],
                                    "subfolder": output.get("subfolder", ""),
                                    "type": output.get("type", "output")})
        data = self._get(f"/view?{q}")
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)
        return dest


# ---------- render orchestration (store-aware) ----------

def start_render(store, comfy: ComfyClient, project_id: str, clip_rel: str,
                 template: str, seed: int | None = None) -> dict:
    """Create an immutable render folder for a clip and queue it."""
    clip = store.load(project_id, clip_rel)
    proj = store.load(project_id, "project.json")
    clip_dir = store.resolve(project_id, clip_rel).parent
    renders_dir = clip_dir / "renders"
    n = 1
    while (renders_dir / f"r{n:03d}").exists():
        n += 1
    rid = f"r{n:03d}"
    rdir = renders_dir / rid
    (rdir / "refs").mkdir(parents=True)

    # snapshot reference images as-used
    ref_copies = []
    start_image = None
    for i, ref in enumerate(clip.get("ref_images", [])):
        src = store.resolve(project_id, ref)
        if src.exists():
            dst = rdir / "refs" / src.name
            shutil.copy2(src, dst)
            ref_copies.append(f"refs/{src.name}")
            if i == 0:
                start_image = dst  # first ref is the start frame

    vp = clip.get("video_prompt", {})
    job = comfy.queue(template,
                      positive=vp.get("text", ""),
                      negative=vp.get("negative", ""),
                      seed=seed, start_image=start_image,
                      duration_seconds=clip.get("duration_seconds"),
                      fps=proj.get("style", {}).get("fps", 25))

    (rdir / "workflow.json").write_text(
        json.dumps(job["workflow"], indent=2), encoding="utf-8")
    clip_base = clip_rel.rsplit("/", 1)[0]
    render_rel = f"{clip_base}/renders/{rid}/render.json"
    render = {"id": rid, "clip_rev": clip.get("rev"),
              "video_prompt": vp, "image_prompt": clip.get("image_prompt", {}),
              "ref_images": ref_copies, "workflow_template": template,
              "seed": job["seed"],
              "comfy": {"prompt_id": job["prompt_id"], "host": comfy.base},
              "status": "queued", "output": "",
              "queued_at": time.strftime("%Y-%m-%dT%H:%M:%S")}
    store.save(project_id, render_rel, render,
               summary=f"render {rid} queued for {clip_rel}")
    clip = store.load(project_id, clip_rel)
    clip.setdefault("renders", []).append(rid)
    clip["status"] = "rendering"
    store.save(project_id, clip_rel, clip, summary=f"render {rid} queued")
    return render


def poll_render(store, comfy: ComfyClient, project_id: str,
                render_rel: str) -> dict:
    """Check a queued render; on completion fetch the output video."""
    render = store.load(project_id, render_rel)
    if render.get("status") in ("done", "failed"):
        return render
    st = comfy.status(render["comfy"]["prompt_id"])
    if st["state"] in ("queued", "running"):
        if render.get("status") != st["state"]:
            render["status"] = st["state"]
            store.save(project_id, render_rel, render,
                       summary=f"render {render['id']} {st['state']}")
        return render

    clip_rel = render_rel.rsplit("/renders/", 1)[0] + "/clip.json"
    if st["state"] == "failed":
        render["status"] = "failed"
        render["error"] = st.get("error", "")
        store.save(project_id, render_rel, render,
                   summary=f"render {render['id']} FAILED")
    else:
        vids = [o for o in st["outputs"] if o["kind"] in ("videos", "gifs")]
        pick = (vids or st["outputs"])[0] if st["outputs"] else None
        rdir = store.resolve(project_id, render_rel).parent
        if pick:
            ext = Path(pick["filename"]).suffix or ".mp4"
            comfy.fetch_output(pick, rdir / f"output{ext}")
            render["output"] = f"output{ext}"
        render["status"] = "done"
        store.save(project_id, render_rel, render,
                   summary=f"render {render['id']} done")
        clip = store.load(project_id, clip_rel)
        clip["active_render"] = render["id"]
        clip["status"] = "rendered"
        store.save(project_id, clip_rel, clip,
                   summary=f"render {render['id']} completed")
    return render
