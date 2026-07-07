"""Clipwright web server. Run:  python -m clipwright  then open the printed URL."""

from __future__ import annotations

import json
import mimetypes
from pathlib import Path

from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import ai, comfy
from .store import Store

APP_DIR = Path(__file__).parent
CONFIG_PATH = Path("clipwright_config.json")

DEFAULT_CONFIG = {
    "projects_dir": "projects",
    "workflows_dir": "workflows",
    "comfy_url": "http://127.0.0.1:8188",
    "model": ai.DEFAULT_MODEL,
    "port": 8321,
}


def load_config() -> dict:
    cfg = dict(DEFAULT_CONFIG)
    if CONFIG_PATH.exists():
        cfg.update(json.loads(CONFIG_PATH.read_text(encoding="utf-8")))
    else:
        CONFIG_PATH.write_text(json.dumps(cfg, indent=2), encoding="utf-8")
    return cfg


config = load_config()
store = Store(Path(config["projects_dir"]))
engine = ai.Engine(store, model=config["model"])
comfy_client = comfy.ComfyClient(config["comfy_url"],
                                 Path(config["workflows_dir"]))

app = FastAPI(title="Clipwright")


def _err(e: Exception) -> HTTPException:
    code = 400 if isinstance(e, (ValueError, ai.AIError, comfy.ComfyError,
                                 FileNotFoundError)) else 500
    return HTTPException(status_code=code, detail=str(e))


# ---------- projects ----------

class ProjectIn(BaseModel):
    title: str
    logline: str = ""


@app.get("/api/config")
def get_config():
    return {**config,
            "comfy_online": comfy_client.ping(),
            "templates": comfy_client.list_templates(),
            "profiles": {k: {"label": v.get("label", k), "kind": v.get("kind")}
                         for k, v in ai.load_profiles().items()}}


@app.get("/api/projects")
def list_projects():
    return store.list_projects()


@app.post("/api/projects")
def create_project(body: ProjectIn):
    try:
        return store.create_project(body.title, body.logline)
    except Exception as e:
        raise _err(e)


@app.get("/api/projects/{pid}/tree")
def tree(pid: str):
    try:
        return store.tree(pid)
    except Exception as e:
        raise _err(e)


@app.get("/api/projects/{pid}/history")
def history(pid: str):
    return store.history(pid)


# ---------- entities ----------

@app.get("/api/projects/{pid}/entity")
def get_entity(pid: str, path: str):
    try:
        return {"path": path, "data": store.load(pid, path),
                "revisions": store.revisions(pid, path)}
    except FileNotFoundError:
        raise HTTPException(404, f"not found: {path}")
    except Exception as e:
        raise _err(e)


class EntityIn(BaseModel):
    data: dict
    summary: str = "manual edit"


@app.put("/api/projects/{pid}/entity")
def put_entity(pid: str, path: str, body: EntityIn):
    try:
        return store.save(pid, path, body.data, summary=body.summary)
    except Exception as e:
        raise _err(e)


class ChapterIn(BaseModel):
    title: str
    summary: str = ""


@app.post("/api/projects/{pid}/chapters")
def add_chapter(pid: str, body: ChapterIn):
    try:
        return store.add_chapter(pid, body.title, body.summary)
    except Exception as e:
        raise _err(e)


class SceneIn(BaseModel):
    chapter_id: str
    title: str


@app.post("/api/projects/{pid}/scenes")
def add_scene(pid: str, body: SceneIn):
    try:
        return store.add_scene(pid, body.chapter_id, body.title)
    except Exception as e:
        raise _err(e)


class ClipIn(BaseModel):
    chapter_id: str
    scene_id: str
    action: str = ""


@app.post("/api/projects/{pid}/clips")
def add_clip(pid: str, body: ClipIn):
    try:
        return store.add_clip(pid, body.chapter_id, body.scene_id,
                              action=body.action)
    except Exception as e:
        raise _err(e)


# ---------- files (bible docs, ref images, rendered videos) ----------

@app.get("/api/projects/{pid}/file")
def get_file(pid: str, path: str):
    try:
        p = store.resolve(pid, path)
    except Exception as e:
        raise _err(e)
    if not p.is_file():
        raise HTTPException(404, f"not found: {path}")
    mime = mimetypes.guess_type(p.name)[0] or "application/octet-stream"
    return FileResponse(p, media_type=mime)


@app.post("/api/projects/{pid}/upload")
async def upload(pid: str, path: str, file: UploadFile):
    """Upload into a project-relative directory (e.g. bible, or a clip's refs)."""
    try:
        dest_dir = store.resolve(pid, path)
        dest_dir.mkdir(parents=True, exist_ok=True)
        name = Path(file.filename or "upload.bin").name
        dest = dest_dir / name
        dest.write_bytes(await file.read())
        return {"path": f"{path}/{name}"}
    except Exception as e:
        raise _err(e)


@app.get("/api/projects/{pid}/bible")
def bible(pid: str):
    return {"docs": store.bible_docs(pid)}


# ---------- AI ----------

class StoryIn(BaseModel):
    idea: str = ""


@app.post("/api/projects/{pid}/ai/story")
def ai_story(pid: str, body: StoryIn):
    try:
        return engine.generate_story(pid, body.idea)
    except Exception as e:
        raise _err(e)


class ClipsIn(BaseModel):
    chapter_id: str
    scene_id: str


@app.post("/api/projects/{pid}/ai/clips")
def ai_clips(pid: str, body: ClipsIn):
    try:
        return engine.generate_clips(pid, body.chapter_id, body.scene_id)
    except Exception as e:
        raise _err(e)


class PropagateIn(BaseModel):
    path: str
    note: str = ""


@app.post("/api/projects/{pid}/ai/propagate")
def ai_propagate(pid: str, body: PropagateIn):
    try:
        return engine.propose_propagation(pid, body.path, body.note)
    except Exception as e:
        raise _err(e)


# ---------- proposals ----------

@app.get("/api/projects/{pid}/proposals")
def proposals(pid: str):
    pdir = store.project_dir(pid) / "proposals"
    out = []
    if pdir.exists():
        for f in sorted(pdir.glob("p*.json")):
            out.append(store.load(pid, f"proposals/{f.name}"))
    return out


class ProposalActionIn(BaseModel):
    proposal: str  # e.g. proposals/p001.json
    item_index: int
    accept: bool


@app.post("/api/projects/{pid}/proposals/resolve")
def resolve_proposal(pid: str, body: ProposalActionIn):
    try:
        return ai.apply_proposal_item(store, pid, body.proposal,
                                      body.item_index, body.accept)
    except Exception as e:
        raise _err(e)


# ---------- rendering ----------

class RenderIn(BaseModel):
    clip_path: str  # .../clip.json
    template: str
    seed: int | None = None


@app.post("/api/projects/{pid}/render")
def render(pid: str, body: RenderIn):
    try:
        return comfy.start_render(store, comfy_client, pid,
                                  body.clip_path, body.template, body.seed)
    except Exception as e:
        raise _err(e)


@app.post("/api/projects/{pid}/render/poll")
def render_poll(pid: str, render_path: str):
    try:
        return comfy.poll_render(store, comfy_client, pid, render_path)
    except Exception as e:
        raise _err(e)


# ---------- static UI ----------

@app.get("/")
def index():
    return Response((APP_DIR / "web" / "index.html").read_text(encoding="utf-8"),
                    media_type="text/html")


app.mount("/static", StaticFiles(directory=APP_DIR / "web"), name="static")


def main():
    import uvicorn
    print(f"\n  Clipwright  ->  http://127.0.0.1:{config['port']}\n")
    uvicorn.run(app, host="127.0.0.1", port=config["port"], log_level="warning")


if __name__ == "__main__":
    main()
