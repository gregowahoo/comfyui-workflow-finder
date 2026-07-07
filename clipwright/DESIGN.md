# Clipwright — Design

Story-driven video production studio for ComfyUI + LTX 2.3.
You bring an idea (or a full story bible like Aeterna's); Clipwright turns it into
chapters → scenes → clips, writes the image and video prompts for every clip,
queues renders to ComfyUI, and keeps every revision of everything.

---

## 1. Core concepts

### Hierarchy

```
Project            e.g. "Aeterna"
 └─ Chapter        an act / arc — navigation unit for long videos
     └─ Scene      "a page of a chapter": one location+time, one dramatic beat set
         └─ Clip   one LTX render, ~5–10 s: a single action / camera move
             └─ Render   one actual generation: frozen prompt + refs + seed + output file
```

- A **Scene** carries story truth: summary, setting, characters present, beats,
  and continuity state (what's true coming in / going out).
- A **Clip** carries production truth: the exact image prompt (start frame),
  video prompt (LTX), camera direction, duration, reference images.
- A **Render** is immutable. It snapshots the prompts, reference images, workflow,
  and seed used, plus the output video file. Re-rendering makes a new render;
  the clip points at its `active_render`.

### Everything is a JSON file on disk

A project is a folder tree of small JSON files — human-readable, diff-able,
easy to back up, and safe to hand-edit:

```
projects/aeterna/
  project.json                 title, logline, style bible, characters, locations
  bible/                       your source docs (Aeterna bible .md/.txt) + global ref images
  chapters/ch01/
    chapter.json
    scenes/sc001/
      scene.json
      refs/                    scene-level reference images
      clips/c001/
        clip.json
        refs/                  clip-level reference images (start frames etc.)
        renders/r001/
          render.json          frozen snapshot of everything used
          workflow.json        the exact ComfyUI workflow submitted
          refs/                copies of the ref images as-used
          output.mp4           the rendered clip
  _revisions/                  previous versions of every saved JSON (rev-N.json)
  history.jsonl                one line per change: who/when/what/rev
  proposals/                   pending AI-proposed propagation diffs
```

### Revisions

Every entity JSON has a `rev` integer. On every save, the store:
1. copies the outgoing file to `_revisions/<same path>/rev-<N>.json`
2. bumps `rev` and `updated_at`
3. appends a line to `history.jsonl` (`{ts, path, rev, summary}`)

So rollback = copy a file back. Nothing is ever silently lost. Because it's all
plain files, you can additionally `git init` a project folder for offsite history.

### Change propagation (propose → approve)

When you edit story-level content (scene summary, character description,
chapter arc), Clipwright doesn't silently rewrite anything. Instead:

1. You click **Propagate** on the edited entity.
2. The AI reads the edit (old vs new), the surrounding chapters/scenes, and the
   project bible, and drafts a **proposal**: a list of concrete field changes to
   other scenes/clips — downstream *and* upstream — each with a reason.
3. Proposals land in `proposals/` and show up in the UI as a review list.
4. You accept or reject each item. Accepting applies it through the store, so it
   gets a revision bump and a history line like any manual edit.

This is the answer to "changes propagate downwards or even upwards" without
ever losing wording you liked.

---

## 2. Prompt generation

### Prompt profiles (data-driven)

Prompt style differs per model, so prompting knowledge lives in editable JSON
profiles (`clipwright/profiles/*.json`), not in code:

- **`flux.json`** (image) — flowing natural-language prose paragraphs
- **`qwen_image.json`** (image) — Qwen-Image dialect
- **`ltx23.json`** (video) — LTX 2.3: present-tense cinematic prose describing
  subject, action, camera movement, lighting, and mood in one continuous paragraph

Each profile contains `guidance` text that is injected into the AI request when
generating prompts. Tweak a profile file → every future prompt follows the new
style. Projects pick default image/video profiles; clips can override.

### What the AI generates, at which level

| Level   | AI produces |
|---------|-------------|
| Project | story treatment, chapter breakdown, characters, locations, visual bible |
| Chapter | scene list with summaries, settings, continuity chain |
| Scene   | clip breakdown: each clip's action, camera, duration |
| Clip    | image prompt (start frame, per image profile) + video prompt (per LTX profile) |

Two entry points for story creation:
- **From an idea** — you type a paragraph; Clipwright writes the treatment and structure.
- **From a bible** — drop docs (e.g. the Aeterna bible) into `bible/`; Clipwright
  ingests them and builds the structure faithfully, and keeps consulting them for
  every prompt so characters/locations stay consistent.

---

## 3. Render pipeline (ComfyUI integration)

Same-machine setup: ComfyUI at `http://127.0.0.1:8188`.

1. You export your working LTX 2.3 workflow from ComfyUI **in API format** into
   `workflows/` (e.g. `ltx23_i2v.json`), and describe its key nodes once in
   `workflows/ltx23_i2v.map.json` (which node takes the positive prompt, the
   start image, the seed, the frame count…). See `workflows/README.md`.
2. **Render clip** in the UI → Clipwright creates `renders/rNNN/`, freezes the
   prompts + refs + seed there, injects them into a copy of the workflow, and
   POSTs it to ComfyUI `/prompt`.
3. It polls `/history/<prompt_id>` until done, fetches the output video via
   `/view`, and stores it as `renders/rNNN/output.mp4`.
4. The clip's render list and `active_render` update; the UI plays the video inline.

Because the render folder snapshots everything, "which prompt and refs made this
clip?" is always answerable — even after the clip's live prompt has moved on.

---

## 4. Architecture

```
┌────────────── browser (localhost:8321) ──────────────┐
│  vanilla JS single page: tree │ editor │ proposals │ renders │
└──────────────────────┬────────────────────────────────┘
                       │ REST (JSON)
┌──────────────────────┴────────────────────────────────┐
│ FastAPI server (clipwright/server.py)                  │
│  store.py     JSON persistence, revisions, history     │
│  ai.py        Claude API: story / clips / prompts /    │
│               propagation proposals                    │
│  comfy.py     ComfyUI API client: queue, poll, fetch   │
│  profiles     prompt-style JSON profiles               │
└──────────────────────┬───────────────┬────────────────┘
                 projects/ (disk)   ComfyUI :8188
```

- Python 3.10+, deps: `fastapi`, `uvicorn`, `anthropic` (ComfyUI client is stdlib).
- `ANTHROPIC_API_KEY` from environment, same as Workflow Finder.
- Config in `clipwright_config.json` (auto-created): projects dir, ComfyUI URL,
  model, default profiles.

---

## 5. Roadmap

**v0.1 (this scaffold)**
- Project/chapter/scene/clip CRUD with revisions + history
- Story generation from idea or bible docs
- Clip breakdown + prompt generation via profiles
- Propagation proposals with accept/reject
- Render queue to ComfyUI with full snapshotting

**v0.2**
- Reference-image generation pipeline (queue Flux/Qwen start frames through
  ComfyUI too, not just video)
- Character/location reference galleries with "use as ref" one-click
- Timeline / storyboard view with thumbnails per clip
- Batch rendering (whole scene / chapter), seed sweeps

**v0.3**
- Assembly: concatenate active renders into scene/chapter/full cuts (ffmpeg)
- Audio: LTX 2 audio track handling, music/VO slots per scene
- Diff viewer for revisions; restore-from-revision in UI
