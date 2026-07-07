# 🎬 Clipwright

Story-driven video production studio for **ComfyUI + LTX 2.3**.

Give it an idea — or a full story bible — and Clipwright writes the story as
**chapters → scenes → clips**, generates the image prompt (start frame) and the
LTX video prompt for every clip, queues renders straight to your local ComfyUI,
and keeps **every revision of everything**: prompts, reference images, seeds,
workflows, and the rendered clips they produced.

> Sibling project of [ComfyUI Workflow Finder](https://github.com/gregowahoo/comfyui-workflow-finder)
> and [ComfyUI Model Scanner](https://github.com/gregowahoo/comfyui-model-scanner).

See **[DESIGN.md](DESIGN.md)** for the full architecture.

---

## Features

- **Story generation** — from a one-paragraph idea or from bible documents you
  drop in (characters, world, plot). Produces chapters, scenes with beats and
  continuity chains, character/location sheets, and a global visual bible.
- **Prompt generation per clip** — image prompt for the start frame (Flux or
  Qwen-Image profiles) + video prompt in LTX 2.3 style. Prompt-style knowledge
  lives in editable JSON profiles.
- **Everything is editable** — every field of every chapter/scene/clip, in the
  browser, with automatic revision history on every save.
- **Change propagation** — edit a scene, hit *Save + Propagate*, and the AI
  proposes the exact edits needed up- and downstream to keep the story
  consistent. You accept/reject each one; nothing is overwritten silently.
- **One-click rendering** — queues your own exported LTX workflow to ComfyUI
  with the clip's prompt, seed, and start-frame image injected; polls until
  done and files the video next to a frozen snapshot of everything used.
- **Plain JSON on disk** — a project is a folder of small JSON files plus your
  media. Hand-editable, diff-able, back-up-able.

---

## Quick start

```powershell
python -m pip install fastapi uvicorn anthropic
python -m clipwright
```

Open **http://127.0.0.1:8321**, create a project, then either:

- type an idea into **✨ Generate Story**, or
- upload your bible docs (.md / .txt) in that same dialog first — e.g. the
  Aeterna bible — and generate from those.

Then open a scene → **🎬 Generate Clips + Prompts** → open a clip → tweak the
prompts → **▶ Render**.

Requires `ANTHROPIC_API_KEY` in your environment for the AI features (same key
Workflow Finder uses). Story/prompt editing, revisions, and rendering work
without it.

## Hooking up ComfyUI

1. Get your LTX 2.3 workflow working in ComfyUI as usual.
2. Export it in **API format** (Workflow menu → *Export (API)*) into the
   `workflows/` folder, e.g. `workflows/ltx23_i2v.json`.
3. Create `workflows/ltx23_i2v.map.json` telling Clipwright which node inputs
   take the prompt, seed, and start image — see
   [workflows/README.md](workflows/README.md). Takes two minutes.

ComfyUI URL defaults to `http://127.0.0.1:8188`; change it (and the port,
projects folder, or Claude model) in `clipwright_config.json`, which is created
on first run.

## Where your data lives

```
projects/<project>/            ← one folder per project (git-init it if you like)
  project.json                 title, characters, locations, visual bible
  bible/                       your source docs + global reference images
  chapters/chNN/scenes/scNNN/  scene.json + refs/ + clips/
  .../clips/cNNN/renders/rNNN/ render.json + workflow.json + refs/ + output.mp4
  _revisions/                  every previous version of every JSON
  history.jsonl                the full change log
```

`projects/` and `clipwright_config.json` are gitignored — your stories and
renders are yours, not part of the app repo.

## License

MIT
