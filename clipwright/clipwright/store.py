"""File-backed project store with revision tracking.

A project is a directory tree of small JSON files. Every save of an existing
entity copies the outgoing version into _revisions/<same relative path>/rev-N.json,
bumps the entity's rev, and appends a line to history.jsonl.
"""

from __future__ import annotations

import json
import re
import shutil
import time
from pathlib import Path

SAFE_ID = re.compile(r"^[a-z0-9][a-z0-9_-]*$")


def now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S")


def slugify(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return slug or "untitled"


class Store:
    def __init__(self, projects_dir: Path):
        self.root = Path(projects_dir)
        self.root.mkdir(parents=True, exist_ok=True)

    # ---------- path safety ----------

    def project_dir(self, project_id: str) -> Path:
        if not SAFE_ID.match(project_id):
            raise ValueError(f"bad project id: {project_id!r}")
        return self.root / project_id

    def resolve(self, project_id: str, rel: str) -> Path:
        """Resolve a project-relative path, refusing escapes."""
        base = self.project_dir(project_id).resolve()
        p = (base / rel).resolve()
        if base != p and base not in p.parents:
            raise ValueError(f"path escapes project: {rel!r}")
        return p

    # ---------- projects ----------

    def list_projects(self) -> list[dict]:
        out = []
        for d in sorted(self.root.iterdir()):
            pj = d / "project.json"
            if pj.exists():
                data = json.loads(pj.read_text(encoding="utf-8"))
                out.append({"id": d.name, "title": data.get("title", d.name),
                            "logline": data.get("logline", ""),
                            "updated_at": data.get("updated_at", "")})
        return out

    def create_project(self, title: str, logline: str = "") -> dict:
        pid = slugify(title)
        pdir = self.project_dir(pid)
        if pdir.exists():
            raise ValueError(f"project '{pid}' already exists")
        for sub in ("bible", "chapters", "proposals", "_revisions"):
            (pdir / sub).mkdir(parents=True)
        data = {
            "id": pid, "title": title, "logline": logline,
            "style": {"visual_bible": "", "aspect_ratio": "16:9",
                      "fps": 25, "default_clip_seconds": 8},
            "profiles": {"image": "flux", "video": "ltx23"},
            "characters": [], "locations": [], "chapters": [],
        }
        self.save(pid, "project.json", data, summary="project created")
        return data

    # ---------- generic entity IO ----------

    def load(self, project_id: str, rel: str) -> dict:
        p = self.resolve(project_id, rel)
        return json.loads(p.read_text(encoding="utf-8"))

    def save(self, project_id: str, rel: str, data: dict, summary: str = "") -> dict:
        """Save an entity JSON with revision bookkeeping."""
        p = self.resolve(project_id, rel)
        p.parent.mkdir(parents=True, exist_ok=True)
        if p.exists():
            old = json.loads(p.read_text(encoding="utf-8"))
            oldrev = int(old.get("rev", 1))
            revdir = self.resolve(project_id, f"_revisions/{rel}")
            revdir.mkdir(parents=True, exist_ok=True)
            shutil.copy2(p, revdir / f"rev-{oldrev}.json")
            data["rev"] = oldrev + 1
        else:
            data.setdefault("rev", 1)
            data.setdefault("created_at", now_iso())
        data["updated_at"] = now_iso()
        p.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
        self._log(project_id, {"ts": now_iso(), "path": rel,
                               "rev": data["rev"], "summary": summary})
        return data

    def _log(self, project_id: str, entry: dict) -> None:
        h = self.project_dir(project_id) / "history.jsonl"
        with h.open("a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")

    def history(self, project_id: str, limit: int = 200) -> list[dict]:
        h = self.project_dir(project_id) / "history.jsonl"
        if not h.exists():
            return []
        lines = h.read_text(encoding="utf-8").splitlines()
        return [json.loads(l) for l in lines[-limit:]][::-1]

    def revisions(self, project_id: str, rel: str) -> list[dict]:
        revdir = self.resolve(project_id, f"_revisions/{rel}")
        out = []
        if revdir.exists():
            for f in sorted(revdir.glob("rev-*.json"),
                            key=lambda f: int(f.stem.split("-")[1])):
                out.append({"rev": int(f.stem.split("-")[1]),
                            "path": f"_revisions/{rel}/{f.name}"})
        return out

    # ---------- hierarchy helpers ----------

    def _next_id(self, parent: Path, prefix: str, width: int) -> str:
        n = 1
        existing = {d.name for d in parent.iterdir()} if parent.exists() else set()
        while f"{prefix}{n:0{width}d}" in existing:
            n += 1
        return f"{prefix}{n:0{width}d}"

    def add_chapter(self, project_id: str, title: str, summary: str = "") -> dict:
        chdir = self.project_dir(project_id) / "chapters"
        cid = self._next_id(chdir, "ch", 2)
        data = {"id": cid, "title": title, "summary": summary, "scenes": []}
        self.save(project_id, f"chapters/{cid}/chapter.json", data,
                  summary=f"chapter added: {title}")
        proj = self.load(project_id, "project.json")
        proj["chapters"].append(cid)
        self.save(project_id, "project.json", proj, summary=f"chapter {cid} linked")
        return data

    def add_scene(self, project_id: str, chapter_id: str, title: str, **fields) -> dict:
        scdir = self.project_dir(project_id) / "chapters" / chapter_id / "scenes"
        sid = self._next_id(scdir, "sc", 3)
        data = {"id": sid, "title": title,
                "summary": fields.get("summary", ""),
                "setting": fields.get("setting", ""),
                "characters": fields.get("characters", []),
                "beats": fields.get("beats", []),
                "continuity": fields.get("continuity", {"in": "", "out": ""}),
                "status": "draft", "clips": []}
        rel = f"chapters/{chapter_id}/scenes/{sid}/scene.json"
        self.save(project_id, rel, data, summary=f"scene added: {title}")
        ch = self.load(project_id, f"chapters/{chapter_id}/chapter.json")
        ch["scenes"].append(sid)
        self.save(project_id, f"chapters/{chapter_id}/chapter.json", ch,
                  summary=f"scene {sid} linked")
        return data

    def add_clip(self, project_id: str, chapter_id: str, scene_id: str, **fields) -> dict:
        cldir = (self.project_dir(project_id) / "chapters" / chapter_id
                 / "scenes" / scene_id / "clips")
        cid = self._next_id(cldir, "c", 3)
        data = {"id": cid,
                "action": fields.get("action", ""),
                "camera": fields.get("camera", ""),
                "duration_seconds": fields.get("duration_seconds", 8),
                "image_prompt": fields.get("image_prompt",
                                           {"profile": "", "positive": "", "negative": ""}),
                "video_prompt": fields.get("video_prompt",
                                           {"profile": "", "text": "", "negative": ""}),
                "ref_images": [], "renders": [], "active_render": "",
                "status": "draft"}
        rel = f"chapters/{chapter_id}/scenes/{scene_id}/clips/{cid}/clip.json"
        self.save(project_id, rel, data, summary=f"clip added: {data['action'][:60]}")
        scene_rel = f"chapters/{chapter_id}/scenes/{scene_id}/scene.json"
        sc = self.load(project_id, scene_rel)
        sc["clips"].append(cid)
        self.save(project_id, scene_rel, sc, summary=f"clip {cid} linked")
        return data

    # ---------- tree for the UI ----------

    def tree(self, project_id: str) -> dict:
        proj = self.load(project_id, "project.json")
        chapters = []
        for chid in proj.get("chapters", []):
            try:
                ch = self.load(project_id, f"chapters/{chid}/chapter.json")
            except FileNotFoundError:
                continue
            scenes = []
            for sid in ch.get("scenes", []):
                srel = f"chapters/{chid}/scenes/{sid}/scene.json"
                try:
                    sc = self.load(project_id, srel)
                except FileNotFoundError:
                    continue
                clips = []
                for clid in sc.get("clips", []):
                    crel = f"chapters/{chid}/scenes/{sid}/clips/{clid}/clip.json"
                    try:
                        cl = self.load(project_id, crel)
                    except FileNotFoundError:
                        continue
                    clips.append({"id": clid, "path": crel,
                                  "action": cl.get("action", ""),
                                  "status": cl.get("status", ""),
                                  "renders": len(cl.get("renders", []))})
                scenes.append({"id": sid, "path": srel,
                               "title": sc.get("title", ""),
                               "status": sc.get("status", ""), "clips": clips})
            chapters.append({"id": chid,
                             "path": f"chapters/{chid}/chapter.json",
                             "title": ch.get("title", ""), "scenes": scenes})
        return {"project": {"id": proj["id"], "title": proj.get("title", ""),
                            "path": "project.json"},
                "chapters": chapters}

    # ---------- bible docs ----------

    def bible_docs(self, project_id: str) -> list[str]:
        bdir = self.project_dir(project_id) / "bible"
        if not bdir.exists():
            return []
        return sorted(f.name for f in bdir.iterdir()
                      if f.suffix.lower() in (".md", ".txt") and f.is_file())

    def read_bible(self, project_id: str, max_chars: int = 150_000) -> str:
        parts = []
        for name in self.bible_docs(project_id):
            text = self.resolve(project_id, f"bible/{name}").read_text(
                encoding="utf-8", errors="replace")
            parts.append(f"===== {name} =====\n{text}")
        blob = "\n\n".join(parts)
        return blob[:max_chars]
