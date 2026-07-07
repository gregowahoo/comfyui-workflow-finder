# Workflow templates

Clipwright renders through **your** ComfyUI workflows — it never invents a
graph. Each template is two files:

### 1. `<name>.json` — the workflow itself, exported in API format

In ComfyUI: **Workflow → Export (API)**. (Enable dev mode options in settings
if you don't see it.) Save it here, e.g. `ltx23_i2v.json`.

### 2. `<name>.map.json` — where Clipwright injects values

Open the exported JSON and find the node IDs (the top-level keys, `"6"`, `"73"`
etc. — each has a `class_type` you can recognize). Then write:

```json
{
  "positive_prompt": ["6",  "inputs", "text"],
  "negative_prompt": ["7",  "inputs", "text"],
  "seed":            ["73", "inputs", "noise_seed"],
  "start_image":     ["78", "inputs", "image"],
  "frame_count":     ["70", "inputs", "length"],
  "fps":             ["70", "inputs", "frame_rate"]
}
```

| Key | Required | Goes to |
|---|---|---|
| `positive_prompt` | yes | the clip's video prompt text |
| `negative_prompt` | no | the clip's negative prompt |
| `seed` | no | random per render unless you pass one; recorded either way |
| `start_image` | for i2v | a `LoadImage` node's `image` input — Clipwright uploads the clip's first reference image and sets the filename here |
| `frame_count` | no | computed as `duration_seconds × fps + 1` |
| `fps` | no | project fps setting |

Anything not mapped is simply left exactly as you exported it — samplers,
models, LoRAs, resolutions all stay yours. You can keep multiple templates
(t2v, i2v, upscale variants…) and pick one per render in the clip editor.
