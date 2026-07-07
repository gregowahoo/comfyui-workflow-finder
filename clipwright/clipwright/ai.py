"""Claude-powered story, prompt, and propagation engine.

All calls return parsed JSON. Prompt-style knowledge lives in
clipwright/profiles/*.json so it can be tuned without touching code.
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path

PROFILES_DIR = Path(__file__).parent / "profiles"
DEFAULT_MODEL = "claude-sonnet-5"


def load_profiles() -> dict[str, dict]:
    out = {}
    for f in PROFILES_DIR.glob("*.json"):
        data = json.loads(f.read_text(encoding="utf-8"))
        out[data["name"]] = data
    return out


class AIError(RuntimeError):
    pass


class Engine:
    def __init__(self, store, model: str = DEFAULT_MODEL):
        self.store = store
        self.model = model

    # ---------- plumbing ----------

    def _client(self):
        if not os.environ.get("ANTHROPIC_API_KEY"):
            raise AIError("ANTHROPIC_API_KEY is not set. Add it to your "
                          "environment variables (same key Workflow Finder uses).")
        try:
            import anthropic
        except ImportError:
            raise AIError("The 'anthropic' package is not installed. "
                          "Run: python -m pip install anthropic")
        return anthropic.Anthropic()

    def _ask_json(self, system: str, user: str, max_tokens: int = 8000):
        client = self._client()
        msg = client.messages.create(
            model=self.model, max_tokens=max_tokens,
            system=system + "\n\nRespond with ONLY a valid JSON object or array. "
                            "No markdown fences, no commentary.",
            messages=[{"role": "user", "content": user}],
        )
        text = "".join(b.text for b in msg.content if b.type == "text").strip()
        m = re.search(r"```(?:json)?\s*(.*?)```", text, re.DOTALL)
        if m:
            text = m.group(1).strip()
        start = min((i for i in (text.find("{"), text.find("[")) if i >= 0),
                    default=-1)
        if start > 0:
            text = text[start:]
        try:
            return json.loads(text)
        except json.JSONDecodeError as e:
            raise AIError(f"Model returned unparseable JSON: {e}\n---\n{text[:2000]}")

    def _project_context(self, project_id: str, include_bible: bool = True) -> str:
        proj = self.store.load(project_id, "project.json")
        parts = [f"PROJECT: {proj.get('title')}",
                 f"LOGLINE: {proj.get('logline', '')}",
                 f"VISUAL BIBLE: {proj.get('style', {}).get('visual_bible', '')}",
                 "CHARACTERS:\n" + json.dumps(proj.get("characters", []), indent=1),
                 "LOCATIONS:\n" + json.dumps(proj.get("locations", []), indent=1)]
        if include_bible:
            bible = self.store.read_bible(project_id)
            if bible:
                parts.append("SOURCE BIBLE DOCUMENTS:\n" + bible)
        return "\n\n".join(parts)

    # ---------- story generation ----------

    def generate_story(self, project_id: str, idea: str = "") -> dict:
        """Build the full chapter/scene structure from an idea and/or bible docs.

        Returns the created structure summary. Writes chapters and scenes to disk.
        """
        proj = self.store.load(project_id, "project.json")
        if proj.get("chapters"):
            raise AIError("Project already has chapters. Story generation only "
                          "runs on an empty project — edit or propagate instead.")
        context = self._project_context(project_id)
        system = (
            "You are a story architect for AI-generated video production. "
            "You turn ideas or story bibles into a filmable structure: "
            "chapters (acts), each with scenes. A scene is like a page of a "
            "chapter: one location and time, a coherent set of dramatic beats, "
            "filmable in a handful of 5-10 second clips. Maintain a continuity "
            "chain: each scene's 'continuity.in' must match the previous "
            "scene's 'continuity.out'."
        )
        user = f"""{context}

USER IDEA / DIRECTION:
{idea or '(none - work purely from the bible documents above)'}

Design the story structure. Return JSON:
{{
 "logline": "one sentence",
 "visual_bible": "150-300 word global visual style guide: palette, lighting philosophy, lens/grade, era, recurring motifs",
 "characters": [{{"id":"slug","name":"","description":"physical description precise enough to keep image prompts consistent"}}],
 "locations": [{{"id":"slug","name":"","description":"visual description"}}],
 "chapters": [
   {{"title":"", "summary":"2-4 sentences",
     "scenes":[{{"title":"", "summary":"3-6 sentences of what happens on this 'page'",
                "setting":"location, time of day, weather, mood",
                "characters":["character ids"],
                "beats":["beat 1","beat 2","..."],
                "continuity":{{"in":"state coming in","out":"state going out"}}}}]}}
 ]
}}
Aim for a structure appropriate to the material - a full-length story typically wants 6-12 chapters of 3-8 scenes each."""
        data = self._ask_json(system, user, max_tokens=32000)

        # write results to disk
        if data.get("logline"):
            proj["logline"] = data["logline"]
        if data.get("visual_bible"):
            proj["style"]["visual_bible"] = data["visual_bible"]
        proj["characters"] = data.get("characters", [])
        proj["locations"] = data.get("locations", [])
        self.store.save(project_id, "project.json", proj,
                        summary="AI story generation: project metadata")
        n_scenes = 0
        for ch in data.get("chapters", []):
            chd = self.store.add_chapter(project_id, ch.get("title", "Chapter"),
                                         ch.get("summary", ""))
            for sc in ch.get("scenes", []):
                self.store.add_scene(project_id, chd["id"],
                                     sc.get("title", "Scene"),
                                     summary=sc.get("summary", ""),
                                     setting=sc.get("setting", ""),
                                     characters=sc.get("characters", []),
                                     beats=sc.get("beats", []),
                                     continuity=sc.get("continuity",
                                                       {"in": "", "out": ""}))
                n_scenes += 1
        return {"chapters": len(data.get("chapters", [])), "scenes": n_scenes}

    # ---------- clip breakdown + prompts ----------

    def generate_clips(self, project_id: str, chapter_id: str, scene_id: str) -> dict:
        """Break a scene into clips and write image+video prompts for each."""
        proj = self.store.load(project_id, "project.json")
        scene_rel = f"chapters/{chapter_id}/scenes/{scene_id}/scene.json"
        scene = self.store.load(project_id, scene_rel)
        profiles = load_profiles()
        img_prof = profiles.get(proj["profiles"].get("image", "flux"), {})
        vid_prof = profiles.get(proj["profiles"].get("video", "ltx23"), {})
        default_secs = proj.get("style", {}).get("default_clip_seconds", 8)

        system = (
            "You are a director and prompt engineer breaking a scene into "
            "individually renderable clips for an image-to-video pipeline. "
            "Each clip is ONE action / camera move, 4-10 seconds. For each clip "
            "you write an image prompt (the start frame) and a video prompt "
            "(the motion).\n\n"
            f"IMAGE PROMPT STYLE ({img_prof.get('label','')}):\n{img_prof.get('guidance','')}\n\n"
            f"VIDEO PROMPT STYLE ({vid_prof.get('label','')}):\n{vid_prof.get('guidance','')}"
        )
        user = f"""{self._project_context(project_id, include_bible=False)}

SCENE {scene_id} - {scene.get('title')}:
{json.dumps({k: scene[k] for k in ('summary','setting','characters','beats','continuity') if k in scene}, indent=1)}

Break this scene into clips (typically one clip per beat; combine or split beats
where it films better). Default duration {default_secs}s. Return JSON:
{{"clips": [
  {{"action":"one sentence of what this clip shows",
    "camera":"short camera direction",
    "duration_seconds": {default_secs},
    "image_prompt": {{"positive":"...", "negative":"..."}},
    "video_prompt": {{"text":"...", "negative":"..."}}}}
]}}"""
        data = self._ask_json(system, user, max_tokens=16000)
        made = []
        for cl in data.get("clips", []):
            ip = cl.get("image_prompt", {})
            vp = cl.get("video_prompt", {})
            made.append(self.store.add_clip(
                project_id, chapter_id, scene_id,
                action=cl.get("action", ""), camera=cl.get("camera", ""),
                duration_seconds=cl.get("duration_seconds", default_secs),
                image_prompt={"profile": img_prof.get("name", ""),
                              "positive": ip.get("positive", ""),
                              "negative": ip.get("negative",
                                                 img_prof.get("negative_default", ""))},
                video_prompt={"profile": vid_prof.get("name", ""),
                              "text": vp.get("text", ""),
                              "negative": vp.get("negative",
                                                 vid_prof.get("negative_default", ""))},
            )["id"])
        scene = self.store.load(project_id, scene_rel)
        scene["status"] = "prompts_ready"
        self.store.save(project_id, scene_rel, scene,
                        summary=f"AI clip breakdown: {len(made)} clips")
        return {"clips": made}

    # ---------- change propagation ----------

    def propose_propagation(self, project_id: str, edited_rel: str,
                            note: str = "") -> dict:
        """Analyze an edit and propose consistency updates across the project."""
        edited = self.store.load(project_id, edited_rel)
        revs = self.store.revisions(project_id, edited_rel)
        old = None
        if revs:
            old = self.store.load(project_id, revs[-1]["path"])

        # collect a compact view of the whole story for the model
        tree = self.store.tree(project_id)
        story = []
        for ch in tree["chapters"]:
            chd = self.store.load(project_id, ch["path"])
            entry = {"path": ch["path"], "title": chd.get("title"),
                     "summary": chd.get("summary"), "scenes": []}
            for sc in ch["scenes"]:
                scd = self.store.load(project_id, sc["path"])
                sc_entry = {"path": sc["path"],
                            **{k: scd.get(k) for k in
                               ("title", "summary", "setting", "characters",
                                "beats", "continuity")},
                            "clips": []}
                for cl in sc["clips"]:
                    cld = self.store.load(project_id, cl["path"])
                    sc_entry["clips"].append(
                        {"path": cl["path"], "action": cld.get("action"),
                         "camera": cld.get("camera"),
                         "video_prompt_text": cld.get("video_prompt", {}).get("text", ""),
                         "image_prompt_positive": cld.get("image_prompt", {}).get("positive", "")})
                entry["scenes"].append(sc_entry)
            story.append(entry)

        system = (
            "You are a continuity supervisor for a video production. The user "
            "edited one entity; find every OTHER place in the story that is now "
            "inconsistent - downstream AND upstream: scene summaries, beats, "
            "continuity in/out chains, clip actions, image prompts, video "
            "prompts, character/location descriptions. Propose the minimal "
            "concrete edits that restore consistency. Preserve the author's "
            "voice; change only what the edit forces. If nothing is affected, "
            "return an empty list."
        )
        user = f"""{self._project_context(project_id, include_bible=False)}

FULL STORY STATE:
{json.dumps(story, indent=1)[:120000]}

EDITED ENTITY ({edited_rel}):
OLD VERSION:
{json.dumps(old, indent=1) if old else '(no previous version)'}
NEW VERSION:
{json.dumps(edited, indent=1)}

USER NOTE ABOUT THE EDIT: {note or '(none)'}

Return JSON:
{{"items": [
  {{"path": "project-relative path of the entity json to change",
    "field": "dotted field path, e.g. 'summary' or 'continuity.in' or 'video_prompt.text' or 'characters'",
    "new_value": <the full replacement value for that field>,
    "reason": "one sentence why"}}
]}}
Only include entities that genuinely need to change. 'path' must be one of the paths shown in FULL STORY STATE or 'project.json'."""
        data = self._ask_json(system, user, max_tokens=16000)
        items = []
        for it in data.get("items", []):
            if it.get("path") == edited_rel:
                continue  # never counter-edit the thing the user just wrote
            try:
                cur = self.store.load(project_id, it["path"])
                it["old_value"] = _get_field(cur, it.get("field", ""))
            except Exception:
                continue
            it["status"] = "pending"
            items.append(it)

        pdir = self.store.project_dir(project_id) / "proposals"
        pdir.mkdir(exist_ok=True)
        n = 1
        while (pdir / f"p{n:03d}.json").exists():
            n += 1
        prop = {"id": f"p{n:03d}",
                "trigger": {"path": edited_rel, "note": note,
                            "old_rev": (old or {}).get("rev"),
                            "new_rev": edited.get("rev")},
                "items": items, "status": "pending"}
        self.store.save(project_id, f"proposals/p{n:03d}.json", prop,
                        summary=f"propagation proposal for {edited_rel} "
                                f"({len(items)} items)")
        return prop


def _get_field(data: dict, dotted: str):
    cur = data
    for part in dotted.split("."):
        if isinstance(cur, dict) and part in cur:
            cur = cur[part]
        else:
            return None
    return cur


def _set_field(data: dict, dotted: str, value) -> None:
    parts = dotted.split(".")
    cur = data
    for part in parts[:-1]:
        cur = cur.setdefault(part, {})
    cur[parts[-1]] = value


def apply_proposal_item(store, project_id: str, proposal_rel: str,
                        item_index: int, accept: bool) -> dict:
    prop = store.load(project_id, proposal_rel)
    item = prop["items"][item_index]
    if accept:
        target = store.load(project_id, item["path"])
        _set_field(target, item["field"], item["new_value"])
        store.save(project_id, item["path"], target,
                   summary=f"propagated from {prop['trigger']['path']}: "
                           f"{item.get('reason','')[:80]}")
        item["status"] = "accepted"
    else:
        item["status"] = "rejected"
    if all(i.get("status") != "pending" for i in prop["items"]):
        prop["status"] = "resolved"
    store.save(project_id, proposal_rel, prop,
               summary=f"proposal item {item_index} "
                       f"{'accepted' if accept else 'rejected'}")
    return prop
