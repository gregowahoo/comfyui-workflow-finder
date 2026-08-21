# ComfyUI Fantastic MiniMax H3 Prompt Builder — How to Use It

A practical guide to **ComfyUI-Fantastic-MiniMaxH3-PromptBuilder** by
Adudeguyman ([GitHub](https://github.com/Adudeguyman/ComfyUI-Fantastic-MiniMaxH3-PromptBuilder),
MIT, v1.6.0 at time of writing).

Everything below was checked against the pack's source (`nodes.py`,
`media_io.py`, `web_api.py`, `web/promptbuilder.js`) rather than the marketing
blurb, so the slot names, limits and prompt formats are the ones the code
actually produces.

---

## 1. What problem it solves

MiniMax **H3** is an open-weight video+audio model. It does *not* want a casual
sentence — it wants a structured prompt with named sections, shot markers,
timestamps, speaker IDs and `<Picture N>` / `<Video N>` / `<Audio N>` tags
pointing at your reference media. MiniMax normally runs your idea through a
rewriter model (`H3-Context-IR`) to produce that structure, and that rewriter
was never open-sourced.

This pack is the hand-driven replacement: a fillable editor per mode, live
validation against MiniMax's *Video Prompt Writing Guide* (the PDF ships in
`web/`, reachable from the 📖 button), and a media loader that keeps reference
tag numbering straight.

It **only replaces how the prompt gets written**. Loaders, sampler, VAE decode
and save stay exactly as in ComfyUI's built-in H3 templates.

---

## 2. Requirements

| Thing | Why |
|---|---|
| **ComfyUI ≥ 0.30.0** | when native H3 support landed (`requires-comfyui` in `pyproject.toml`) |
| **Python ≥ 3.9** | |
| **H3 checkpoints** | `fl2va` for text/keyframe modes, `ref2va` for reference mode |
| **PyAV (`pip install av`) or ffmpeg on PATH** | **only** for reference *videos*. Images and audio work without either. |

If neither PyAV nor ffmpeg is found the pack still loads — videos are simply
rejected at drop time with an explanation, instead of failing at queue time.

**Accepted files** (from `web_api.py`):

- pictures — `jpg`, `jpeg`, `png`, `webp`, `gif`, `bmp`
- video — `mp4`, `mov`, `mkv`, `webm`, `avi`, `m4v`
- audio — `wav`, `mp3`, `flac`, `ogg`, `aac`, `m4a`

---

## 3. Install

**Git**

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/Adudeguyman/ComfyUI-Fantastic-MiniMaxH3-PromptBuilder
pip install av        # only if you want reference videos and lack ffmpeg
```

**ComfyUI Manager** — search **"Fantastic H3 Prompt Builder"**.

**Manual** — unzip so you end up with
`ComfyUI/custom_nodes/ComfyUI-Fantastic-MiniMaxH3-PromptBuilder/`.

Then **fully restart ComfyUI** — a browser refresh is not enough; nodes are only
registered at startup. Confirm by searching the node menu for `MiniMax H3` —
four nodes should appear under **conditioning → video_models**.

---

## 4. The four nodes

| Display name | Internal class | Inputs | Outputs |
|---|---|---|---|
| **Fantastic H3 Prompt Builder** | `MiniMaxH3PromptBuilder` | `prompt_text`, `builder_state` (both written by the editor UI), optional `references` + `picture_1…9`, `video_1…3`, `video_audio_1…3`, `audio_1…3` | `prompt` (STRING), the same 18 media slots as pass-throughs, and `references` (H3_REFS) in the last slot |
| **Fantastic H3 Media Loader** | `MiniMaxH3MediaLoader` | `media_state` (written by its panel) | `references` (H3_REFS) |
| **Fantastic H3 Reference Splitter** | `MiniMaxH3ReferenceSplitter` | `references` (H3_REFS) | 18 slots: `picture_1…9`, `video_1…3`, `video_audio_1…3`, `audio_1…3` |
| **Fantastic H3 Filename Prefix** | `MiniMaxH3FilenamePrefix` | `folder`, `subfolder`, `date_folder`, `filename` | `filename_prefix` (STRING) |

Capacity constants in `nodes.py`: **9 pictures, 3 videos, 3 paired video
soundtracks, 3 standalone audio clips**.

Only the Prompt Builder and Media Loader are essential. The Splitter is for
routing media around the builder; the Filename Prefix is a convenience for
dated output folders.

---

## 5. Quick start (any mode)

1. Add a **Fantastic H3 Prompt Builder**.
2. Click **Edit prompt…**, pick a mode along the top, fill in the fields. The
   finished prompt assembles live in the right-hand panel.
3. Click **Save to node**. *This is the only action that changes what the node
   sends* — ✕, Cancel and Escape all discard.
4. Wire the builder's `prompt` output into the `prompt` input of the H3 node:
   - **MiniMax H3 Image to Video** — for T2VA, I2VA, FL2VA, L2VA
   - **MiniMax H3 Reference to Video** — for reference mode

   If `prompt` shows as a widget instead of an input, right-click →
   *Convert widget to input*.
5. Set `width`, `height`, `length` on the H3 node. For first/last-frame modes
   the editor prints the exact frame count to use — copy it.
6. Wire whatever the mode needs (section 6).
7. Queue.

---

## 6. The five modes

| Mode | You supply | Media the node will actually send | Good for |
|---|---|---|---|
| **T2VA** | text only | nothing but the prompt | building a scene from scratch |
| **I2VA** | one image | `picture_1` → `first_frame` | animating forward from a still |
| **FL2VA** | two images | `picture_1` → `first_frame`, `picture_2` → `last_frame` | getting from A to B |
| **L2VA** | one image | `picture_1` → `last_frame` | working backwards to a known ending |
| **REF** | any mix of 9 pictures / 3 videos / 3 audio | everything, into `ref_*` slots | locking a character, style, voice or motion |

**The saved mode gates the outputs.** This is the design's nicest trick: you can
wire every cable once and leave it. A prompt saved in T2VA mode emits nothing
but the prompt even with `picture_1` still plugged into `first_frame`; switch
the editor to I2VA and **Save**, and picture 1 flows again. Withheld media is
greyed out in the editor rail and printed to the console on each run.

**Keyframes are not references.** In I2VA/FL2VA/L2VA the images are literal
frames of the output, so they go to `first_frame` / `last_frame` on **Image to
Video** — never to the `ref_images` slots, which mean "draw from this", not
"this is a frame".

---

## 7. Video length must match the prompt

H3 accepts only lengths on a **17k + 5 grid at 24 fps**. The editor snaps your
chosen duration and prints the frame count; for FL2VA/L2VA the prompt states
when the last frame lands, so the two have to agree.

| Frames | Seconds |
|---|---|
| 56 | 2.33 |
| 73 | 3.04 |
| 90 | 3.75 |
| 107 | 4.46 |
| 124 | 5.17 |
| 141 | 5.88 |
| 158 | 6.58 |
| 175 | 7.29 |
| 192 | 8.00 |

Put the number the editor shows into the native node's `length`.

---

## 8. Writing the prompt

### Toolbar does the fiddly formatting

Inserting numbered shots with correct cut times, writing camera moves as
sentences, wrapping dialogue in language tags and speaker IDs, and dropping in
reference tags. The literal formats it emits:

- shot markers — `[Shot 2] at 00:03.000` (strict `MM:SS.mmm`)
- dialogue — `<d>[English] line goes here</d>` with speaker IDs like `(S1)` or `(S1,S2)`
- languages available — English, Chinese, Japanese, Korean, French, German, Italian, Spanish, Portuguese, Russian, Arabic
- reference tags — `<Picture 1>`, `<Video 2>`, `<Audio 3>`, `<Subject 1>`

Click a thumbnail to insert its tag rather than typing it. Tags render as
colour-coded chips with hover previews; a tag with nothing behind it turns red
as you type.

### What it checks as you write

Shots numbered in order, cut times increasing and inside the video's length,
`[Shot 1]` not carrying a timestamp, `<d>` tags balanced and language-labelled,
a `[Shot 1]` opening present, references connected but never mentioned, and in
REF mode every subject having a matching retention entry.

**Amber = advisory, saves anyway. Red = fix it before rendering.**

### What the generated prompt looks like

*Base modes (T2VA / I2VA / FL2VA / L2VA)* — an auto-written alignment line for
the keyframe modes, then:

```
integrated_multimodal_description: …

overall_soundscape: …

non_diegetic_music: N/A
```

*Reference mode* — six blocks:

```
subject_definitions:
<Subject 1> is the woman in <Picture 1>, with …

summary:
[reference generation] …

retention_analysis:
<Picture 1> ([Shot 1] first frame): fully_preserved - …

detailed_description:
…

overall_soundscape:
…

non_diegetic_music:
N/A
```

**Summary task types** (combinable, joined with ` + `): `keyframe completion`,
`reference generation`, `video editing`, `video continuation`, `audio reuse`,
`audio reference`.

**Retention markers** — visual: `fully_preserved`, `partially_preserved`,
`attribute_transfer`, `weak_reference`. Audio: `fully_copy`, `partially_copy`,
`reference`, `weak_reference`.

### Picture role chips (reference mode)

Start a definition line with `<Picture N>` and role chips appear. Each writes
the definition, the retention marker and the summary task type together:

| Chip | Marker | Task type |
|---|---|---|
| First frame | `fully_preserved` | keyframe completion |
| Last frame | `fully_preserved` | keyframe completion |
| Composition | `weak_reference` | reference generation |
| Look / style | `weak_reference` | reference generation |
| Setting | `partially_preserved` | reference generation |
| Attribute → subject | `attribute_transfer` | reference generation |
| Storyboard | `weak_reference` | reference generation |

There is deliberately **no "identity" chip**. A picture that merely shows what a
character looks like belongs cited *inside* that subject's line
(`<Subject 1> is the woman in <Picture 1>, …`), not as a standalone picture
definition. Standalone `<Picture N>` lines are for pictures playing a role in
their own right.

### Switching lines off

Every line in `subject_definitions` and every row in `retention_analysis` has a
◉ switch: the line greys out and **drops out of the generated prompt** while
staying in the editor. Section headings have the same switch for
`subject_definitions`, `retention_analysis`, `overall_soundscape` and
`non_diegetic_music`. `summary` and the description can't be switched off.

Validation follows suit — a switched-off definition doesn't count as defined.

---

## 9. Reference mode wiring

1. On the Prompt Builder click **+ Media loader** — one appears, already
   connected.
2. Drop files on it (or **Load files…**). Images, video and audio can go in
   together; each lands in the right group.
3. **Edit prompt… → Reference**. Your media is now clickable thumbnails.
4. Fill the six sections, **Save to node**.
5. Wire the builder's media outputs to **MiniMax H3 Reference to Video**:

| Prompt Builder output | Reference to Video input |
|---|---|
| `prompt` | `prompt` |
| `picture_1 … picture_9` | `ref_image_0 … ref_image_8` |
| `video_1 … video_3` | `ref_videos` slots |
| `video_audio_1 … video_audio_3` | `ref_video_audios` slots |
| `audio_1 … audio_3` | `ref_audios` slots |

⚠️ **Ours are 1-based, the native node's are 0-based** — `picture_1` goes to
`ref_image_0`. Keep them in the same order.

Empty slots pass through empty and the H3 node skips them, so wiring all of them
once and leaving the workflow alone is the intended way to work.

### You don't have to use the Media Loader

Three routes, and 1 and 2 mix freely (a slot with its own input wins over the
bundle):

1. **Media Loader → Prompt Builder.** One cable. Previews and tag numbering come free.
2. **Your own loaders → Prompt Builder** `picture_1` / `video_1` / `audio_1` inputs.
3. **Loaders straight to the native node.** Well-formed prompt, no thumbnails in the editor.

The **Reference Splitter** exists only for getting media to the sampler
*without* passing through the builder (Media Loader → Splitter → native node).

---

## 10. The rule people get wrong: tag numbering

**H3 numbers references by arrival order, not by which slot you plugged them
into.** Two consequences:

- **Gaps close up.** Fill only `picture_2` and `picture_5` and they become
  `<Picture 1>` and `<Picture 2>`.
- **A video's soundtrack takes a low audio number.** It is presented right
  before its own video — so one video-with-sound plus one standalone audio clip
  makes the soundtrack `<Audio 1>` and the standalone `<Audio 2>`.

Don't work this out by hand. The Media Loader prints the exact tag order along
the bottom of the node, and the editor labels each thumbnail with the tag it
will really get. Trust those over intuition.

Note that **reordering or disabling media changes its tag but does not rewrite
your prompt** — you have to fix the text yourself.

---

## 11. Budgets — three separate ones

1. **12 references total.** A video whose audio is `paired` or `alone` costs
   **two** (the soundtrack is its own reference). Set it `off` and you get one
   back. Going over shows red; the node refuses to silently drop anything,
   because removing a reference renumbers every tag after it.
2. **3 audio clips.** A split-off soundtrack counts as one, even though it
   travels on a different input group. Three videos with sound on therefore
   consume the entire audio allowance.
3. **2–15 seconds per clip, and 15 seconds is the TOTAL across all clips of a
   type**, not per-clip. Three 15-second audio clips is 45 s — three times over.
   Three clips only fit at ~5 s each. A 12-second video with audio on spends 12
   of your 15 video seconds *and* 12 of your 15 audio seconds.

Also: **audio cannot be sent without at least one image or video alongside it.**

The loader shows both counters (files and ♪ audio) and warns on each. The usual
fix is the ✂ trim, not a re-export.

### off / paired / alone

The control on a video row that has sound:

- **paired** — the sound belongs to this footage: on-screen dialogue where lip
  sync matters, action sounds that must land on the right frames, keeping a
  source clip's original audio.
- **alone** — you want the audio as a *reference*: borrowing a voice, a music
  style, some ambience. Also right when you aren't reusing the visuals in sync.
- **off** — ignore the audio, and get a reference slot back.

---

## 12. Trim, crop and memory

The **✂** button on a video or audio row (or **▣** on a picture tile) opens a
non-destructive editor. **The file on disk is never modified** — the trim, crop,
rotation, mirror and size cap are stored on the item and applied at decode time,
so the same file behaves differently in another workflow and Reset restores it.

Timeline controls: click or drag the bar to scrub, drag the two blue handles to
set the kept range, `◀| |▶` step a frame, `⇤ start` / `end ⇥` snap the range to
the playhead, `⏮ First` / `Last ⏭` jump to the clip's ends. An amber playhead
turns red when you scrub outside the kept range.

| Key | Action |
|---|---|
| ← → | step one frame (shift = ten) |
| space | play / pause the selected span |
| `[` `]` | set start / end to the playhead |
| home / end | jump to start / end of selection |
| M | mute the preview |
| A | save the kept range as an audio reference |
| C | capture the current frame (video only) |
| esc | close without applying |

- **`last 2s` / `last 3s`** grab a clip's tail in one click — exactly what a
  video continuation reference wants.
- **📷 Use frame** writes the frame you're looking at into ComfyUI's input
  folder and adds it as a picture reference. This is the clean way to continue
  from a clip: scrub back a little from the very last frame (usually the
  blurriest), capture, and wire that picture to `first_frame` in I2VA mode. If
  all 12 references are in use the frame is still captured but arrives switched
  off; it's only refused outright when all nine picture slots are full.
- **🎵 Use audio** writes the kept range out as its own WAV and adds it as a
  standalone audio reference — how you lift a voice sample out of a longer clip.
  Refused if the audio slots are full or the range is under 2 seconds.
- **⇄ Mirror** (video) flips left-to-right. Useful for getting a pose or
  composition facing the other way; a poor idea for identity references you're
  keeping consistent, since text reverses and asymmetric details swap sides.
- **↻ Rotate** turns a picture 90° clockwise (shift-click anticlockwise); the
  crop rect turns with it.

### Reference video memory

Reference video is decoded to raw float frames, so memory is
`width × height × 3 × 4 bytes × frames`. Nothing is resized unless you set a
**size** cap in the ✂ editor, which caps the long edge *during* decoding.

| Cap on a 15 s 1080p clip | Memory |
|---|---|
| full *(default)* | ~9.0 GB |
| 1280 px | ~4.0 GB |
| 1024 px | ~2.5 GB |
| 832 px | ~1.7 GB |

It costs less quality than you'd expect: the native H3 node rescales every
reference to your generation's pixel area regardless, so feeding it 1080p while
generating at 832×480 spends the memory and throws the detail away.

**Two exceptions — leave at full:** a clip used as a motion-context continuation
source, and any clip whose framing you're matching closely. Same for pictures:
one used as `first_frame` or `last_frame` should be **at least as large as your
generation**, or the model upscales it back and you see the softness.

**⬇ Write copy** makes the reduction permanent — writes a resized copy with the
crop/rotation/mirror baked in into the input folder and points the reference at
it, so the file, the decode and the tensor all shrink. Your original is
untouched.

One wrinkle: a trim applies to the *item*, so trimming a video trims its frames
and its paired soundtrack together. To keep the full video but only a few
seconds of its audio, set the video's audio `off` and load that audio
separately, then trim the copy.

---

## 13. Saving your work

### Prompt library (☰ Library)

Saves the **editor state**, not just the finished text, so loading one puts
every field back exactly as you left it — nothing is re-parsed, so nothing can
be misread on the way back in. Search by name/category/mode/text, filter and
rename categories, star favourites, delete.

Saving under a different name after loading one asks explicitly: **Save as new**
(default, and what Enter does) keeps the original, **Rename "…"** carries it
over. Name collisions confirm inline before overwriting.

Prompts are individual JSON files in ComfyUI's user directory under
`minimax_h3/`, written atomically — so they survive updates, back up easily, and
a crash mid-save can't corrupt an entry.

### Phrases

Wording you reuse — a house style line, a favourite camera move — saved once and
inserted with **+ Phrase** at the caret. Create with **+ New**, or right-click a
selection → *Save selection as phrase…*. Line breaks in a saved phrase are
flattened, because the model reads them as shot cuts. Stored with ComfyUI, so
they follow the install and are shared across all prompts.

### Media presets

The Media Loader saves your current reference set — which files, their order,
each video's audio setting, and any trims — under a name. Presets **point at**
files you already uploaded rather than copying them, so saving and loading are
instant; delete one of those files and loading the preset skips it and says
which is missing. Deleting a preset never deletes media.

### Draft mode (1.6.0)

**Draft ▶** parks the queued Live prompt and gives you a teal scratchpad for the
next one. It autosaves to disk in its own directory (it can never appear in your
library or presets), survives a browser crash, and reopens where you left off.
**Save to node** is greyed out while drafting — nothing reaches the node except
through **Commit to Live**.

A draft's media is in one of three states, and the banner always says which:

- **Following the node's media** — the usual case.
- **Showing media as of when the draft started** — display only, so the draft's
  `<Picture N>` tags keep meaning the same files if you rearrange the loader.
- **Has its own media** — you edited it via ▣ Media. **Only this state is
  applied to the Media Loader on commit**, so improving your Live references
  while a draft sits open is safe.

**⇣ Pull from Live** copies the Live prompt across, either *Cast and setup only*
(mode, duration, subject definitions, style, retention markers — the shape for
writing the next shot in a scene) or *Everything* (for working up a variant).
Live is never changed by drafting.

Drafts are per Prompt Builder node, capped at the 25 most recently touched
across all workflows; older ones age out.

---

## 14. Dated output folders

Save nodes only expand `%date:…%` tokens typed **directly into their own
widget**. Route a prefix through a string node or a switch and the token arrives
verbatim — you get a folder literally named `%date:yyyy-MM-dd%`. That's a known
issue in VideoHelperSuite among others.

**Fantastic H3 Filename Prefix** resolves the date itself and hands the save node
a plain string:

- **folder** — **📁 Browse…** walks your ComfyUI output directory (click to
  enter, `..` up, **Create** to make one), or type a path.
- **subfolder** — optional extra levels, created if missing (`Ref2V`, `client/act2`).
- **date_folder** — off, or `YYYY-MM-DD`, `YYYY/MM/DD`, `YYYY-MM-DD_HH-MM`, …
- **filename** — the save node still appends its own counter.

`MiniMaxH3` + `Ref2V` + `YYYY-MM-DD` + `vid` →
`MiniMaxH3/Ref2V/2026-08-21/vid_00001.mp4`.

Date tokens still work inside **subfolder** and **filename** in either dialect —
`%date:hhmm%` or strftime `%H%M` — and the node re-evaluates every run, so the
date can't get stuck at whatever it was when the workflow loaded.

---

## 15. The example workflow

**MMH3PromptBuilder_AIO_Example** — ComfyUI's *Workflows → Browse Templates →
this pack*, or open `example_workflows/MMH3PromptBuilder_AIO_Example.json`
directly. It needs
[VideoHelperSuite](https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite) for
video output and [KJNodes](https://github.com/kijai/ComfyUI-KJNodes) for the
Set/Get nodes.

It's set up for a **4-step turbo LoRA with Sigma Shift at 12 video / 6 audio**.
That audio value is deliberate: the released base configuration is 12/3, but
distilled turbo LoRAs compress the video trajectory, and since the audio
schedule is derived from the video one, 6 keeps audio aligned at low step
counts. **Running base FL2VA without a turbo LoRA? Put it back to 3.**

### One loader, two pipelines

The builder's last output, `references`, is the bundle it received *gated to the
saved mode*, ready for a Reference Splitter. So one Media Loader + Prompt
Builder can drive both an fl2va and a ref2va pipeline: route `references`
through a Set/Get pair into each pipeline's own splitter and keep one bypassed.
Switch to FL2VA and Save and the ref2va splitter receives only pictures 1–2;
switch to REF and the full set flows. Gating lives in one place no matter how
many pipelines fan out.

---

## 16. Troubleshooting

**The nodes don't appear.** ComfyUI needs a full restart, not a page refresh.
Check the startup console for errors mentioning `MiniMaxH3`.

**The node appears but has no panel or buttons** (you can see `media_state` or
`builder_state` as a plain text widget). Python registered fine; the frontend
script failed. In order of likelihood:

1. **Stale browser cache** — Python reloads on restart, JavaScript doesn't.
   Ctrl+Shift+R, or an incognito window.
2. **Another extension throwing during load**, which can stop later ones
   registering. F12 → the first red error usually names the culprit, and it
   often isn't this pack.
3. **Partial install** — `custom_nodes/<pack>/web/` must contain
   `promptbuilder.js`, `medialoader.js`, `fileprefix.js` and the guide PDF.

If this pack is the one failing the node shows a **⚠ UI failed** button; click
it for the error text and include that in a bug report.

**I updated but nothing changed.** ComfyUI caches extension files aggressively.
F12 → Network tab → tick *Disable cache*, reload with DevTools open. If a node's
*outputs* look wrong specifically, that's a restart issue, not a browser one —
and nodes already placed in a workflow keep their old slots, so delete and re-add
them after an update.

**Videos are rejected.** Neither PyAV nor ffmpeg was found. Check whether ffmpeg
is on your PATH before installing anything; otherwise `pip install av` into
ComfyUI's environment.

**The media loader looks empty after opening a workflow.** Fixed in 1.5.7 —
earlier versions could overwrite loaded media while the workflow was still
loading. Your files were never touched, only the node's list of them. Update.

**A button does nothing.** F12, click it again, read the console. The Media
Loader also has an **Open loader…** button that works independently of the
on-node panel.

**Something looks squashed or overlapping.** The pack supports both the classic
node renderer and Nodes 2.0; if a panel misbehaves in one, the modal buttons
(**Edit prompt…**, **Open loader…**) always work regardless.

---

## 17. Quick reference card

```
Nodes           conditioning → video_models → Fantastic H3 …
Capacity        9 pictures · 3 videos · 3 paired soundtracks · 3 audio
Hard limits     12 references total · 3 audio clips · 2–15 s per clip
                15 s TOTAL per media type · audio needs an image or video
Length grid     17k + 5 frames @ 24 fps  (…, 90, 107, 124, 141, 158, 175 …)
Slot offset     builder picture_1  →  native ref_image_0
Tag numbering   by arrival order, gaps close up; soundtrack precedes its video
Only Save…      "Save to node" commits; ✕ / Cancel / Esc discard
Mode gates      the SAVED mode decides which media leaves the node
Storage         ComfyUI user dir → minimax_h3/ (prompts, presets, phrases, drafts)
```

---

*Written from the pack's source at v1.6.0. Behaviour in later releases may
differ — check the repo's README for the current changelog.*
