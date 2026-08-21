const fs = require("fs");
const d = require("docx");
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType,
  LevelFormat, PageBreak, ExternalHyperlink,
} = d;

/* ---------- palette ---------- */
const INK = "1B1F24";
const ACCENT = "1F5C8B";     // deep blue
const ACCENT_DK = "153F5F";
const MUTED = "5A6672";
const RULE = "C9D4DE";
const BAND = "EDF3F8";       // table header / callout fill
const WARNBAND = "FBF1DC";
const WARNRULE = "C9962B";
const CODEBAND = "F2F4F6";

const BODY = "Calibri";
const MONO = "Consolas";

const CONTENT_W = 9360; // letter, 1in margins

/* ---------- helpers ---------- */
let stepInstance = 0;

const P = (text, opts = {}) =>
  new Paragraph({
    spacing: { after: opts.after ?? 140, line: 276 },
    alignment: opts.align,
    indent: opts.indent,
    children: runs(text, opts),
  });

// Inline markup: **bold**, `code`, *italic*
function runs(text, opts = {}) {
  if (Array.isArray(text)) return text;
  const base = { font: opts.font ?? BODY, size: opts.size ?? 22, color: opts.color ?? INK };
  const out = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g;
  let last = 0, m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(new TextRun({ ...base, text: text.slice(last, m.index) }));
    const tok = m[0];
    if (tok.startsWith("**")) {
      out.push(new TextRun({ ...base, text: tok.slice(2, -2), bold: true }));
    } else if (tok.startsWith("`")) {
      out.push(new TextRun({ ...base, text: tok.slice(1, -1), font: MONO, size: 20, color: ACCENT_DK }));
    } else {
      out.push(new TextRun({ ...base, text: tok.slice(1, -1), italics: true }));
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(new TextRun({ ...base, text: text.slice(last) }));
  return out;
}

const H1 = (text) =>
  new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 400, after: 180 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: RULE, space: 6 } },
    children: [new TextRun({ text, font: BODY, size: 34, bold: true, color: ACCENT_DK })],
  });

const H2 = (text) =>
  new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 300, after: 120 },
    children: [new TextRun({ text, font: BODY, size: 26, bold: true, color: ACCENT })],
  });

const H3 = (text) =>
  new Paragraph({
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 220, after: 100 },
    children: [new TextRun({ text, font: BODY, size: 23, bold: true, color: INK })],
  });

const Bullet = (text, level = 0) =>
  new Paragraph({
    numbering: { reference: "bullets", level },
    spacing: { after: 90, line: 276 },
    children: runs(text),
  });

const Step = (text, instance) =>
  new Paragraph({
    numbering: { reference: "steps", level: 0, instance },
    spacing: { after: 110, line: 276 },
    children: runs(text),
  });

const newSteps = () => ++stepInstance;

const Code = (lines) =>
  lines.map((ln, i) =>
    new Paragraph({
      spacing: { before: i === 0 ? 100 : 0, after: i === lines.length - 1 ? 160 : 0, line: 250 },
      shading: { type: ShadingType.CLEAR, fill: CODEBAND },
      indent: { left: 220, right: 220 },
      children: [new TextRun({ text: ln || " ", font: MONO, size: 19, color: INK })],
    })
  );

const Callout = (label, text, kind = "info") => {
  const fill = kind === "warn" ? WARNBAND : BAND;
  const bar = kind === "warn" ? WARNRULE : ACCENT;
  return new Paragraph({
    spacing: { before: 140, after: 180, line: 276 },
    shading: { type: ShadingType.CLEAR, fill },
    indent: { left: 200, right: 200 },
    border: {
      left: { style: BorderStyle.SINGLE, size: 18, color: bar, space: 10 },
    },
    children: [
      new TextRun({ text: label + "  ", font: BODY, size: 22, bold: true, color: kind === "warn" ? "8A6414" : ACCENT_DK }),
      ...runs(text),
    ],
  });
};

function cell(text, { header = false, width, fill } = {}) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    shading: fill ? { type: ShadingType.CLEAR, fill } : undefined,
    margins: { top: 90, bottom: 90, left: 130, right: 130 },
    children: [
      new Paragraph({
        spacing: { after: 0, line: 260 },
        children: header
          ? [new TextRun({ text, font: BODY, size: 21, bold: true, color: ACCENT_DK })]
          : runs(text, { size: 21 }),
      }),
    ],
  });
}

function Tbl(headers, rows, widths) {
  const total = widths.reduce((a, b) => a + b, 0);
  const scale = CONTENT_W / total;
  const w = widths.map((x) => Math.round(x * scale));
  const diff = CONTENT_W - w.reduce((a, b) => a + b, 0);
  w[w.length - 1] += diff;

  const border = { style: BorderStyle.SINGLE, size: 2, color: RULE };
  return new Table({
    columnWidths: w,
    width: { size: CONTENT_W, type: WidthType.DXA },
    borders: { top: border, left: border, bottom: border, right: border, insideHorizontal: border, insideVertical: border },
    rows: [
      new TableRow({
        tableHeader: true,
        children: headers.map((h, i) => cell(h, { header: true, width: w[i], fill: BAND })),
      }),
      ...rows.map((r) =>
        new TableRow({ children: r.map((c, i) => cell(c, { width: w[i] })) })
      ),
    ],
  });
}

const Spacer = (h = 120) => new Paragraph({ spacing: { after: h }, children: [] });

/* ================= CONTENT ================= */
const body = [];
const A = (...x) => body.push(...x.flat());

/* ---- Title block ---- */
A(
  new Paragraph({
    spacing: { before: 1200, after: 60 },
    children: [new TextRun({ text: "MiniMax H3 Prompt Builder", font: BODY, size: 56, bold: true, color: ACCENT_DK })],
  }),
  new Paragraph({
    spacing: { after: 340 },
    children: [new TextRun({ text: "A beginner's guide to the ComfyUI custom node", font: BODY, size: 30, color: MUTED })],
  }),
  new Paragraph({
    spacing: { after: 60 },
    border: { top: { style: BorderStyle.SINGLE, size: 8, color: RULE, space: 12 } },
    children: [],
  }),
  P("**Node pack:** ComfyUI-Fantastic-MiniMaxH3-PromptBuilder", { after: 60 }),
  P("**Author:** Adudeguyman   ·   **Licence:** MIT   ·   **Version covered:** 1.6.0", { after: 60 }),
  new Paragraph({
    spacing: { after: 60 },
    children: [
      new TextRun({ text: "Repository: ", font: BODY, size: 22, color: INK }),
      new ExternalHyperlink({
        link: "https://github.com/Adudeguyman/ComfyUI-Fantastic-MiniMaxH3-PromptBuilder",
        children: [new TextRun({ text: "github.com/Adudeguyman/ComfyUI-Fantastic-MiniMaxH3-PromptBuilder", font: BODY, size: 22, color: ACCENT, underline: {} })],
      }),
    ],
  }),
  Spacer(300),
  Callout("Read this first.",
    "You do not need to understand everything here before you start. Sections 1 to 6 get you a working video. Everything after that is there for when you need it."),
  new Paragraph({ children: [new PageBreak()] }),
);

/* ---- 1 ---- */
A(H1("1. What this node actually does"));
A(P("**MiniMax H3** is a free, open-weight AI model that makes short videos with sound. It is very good. It is also very fussy about how you talk to it."));
A(P("Most video models are happy with a plain sentence: *\"a woman walking through a rainy street at night.\"* H3 is not. H3 expects a structured document — labelled sections, shot numbers, exact timestamps, speaker IDs, and special tags that point at the images and clips you gave it. Feed it a plain sentence and you get a disappointing result, because you have skipped most of the form it was trained to read."));
A(P("MiniMax's own solution was a second AI, called the rewriter, that turned your casual sentence into that structured document for you. **They never released it.** So everyone using H3 locally has to write the structured version by hand."));
A(Callout("In one line.",
  "This node pack is the form. You fill in labelled boxes, it assembles the correctly formatted prompt underneath, and it warns you when something breaks H3's rules."));
A(P("It changes nothing else about your workflow. Your model loaders, sampler, VAE decode and save nodes stay exactly as they are in ComfyUI's built-in H3 templates. This pack only replaces the box where the prompt text comes from."));

/* ---- 2 ---- */
A(H1("2. Words you will see in this guide"));
A(P("Only a handful of terms matter, and two of them are constantly confused with each other."));
A(Tbl(
  ["Term", "What it means"],
  [
    ["**Node**", "One box on the ComfyUI canvas. You drag wires between them."],
    ["**Slot / input / output**", "The little dots on a node's left (inputs) and right (outputs) that wires plug into."],
    ["**Mode**", "Which kind of generation you are doing — text only, starting from a picture, and so on. There are five. See section 7."],
    ["**Keyframe**", "A picture that *is* an actual frame of your finished video — the exact first or last frame. Not a suggestion."],
    ["**Reference**", "A picture, clip or sound that the model should *draw ideas from* — a face to keep consistent, a look, a voice. Not a frame of the output."],
    ["**Tag**", "How your prompt text points at your media: `<Picture 1>`, `<Video 2>`, `<Audio 1>`, `<Subject 1>`."],
    ["**Shot**", "One continuous camera take inside your video. Written `[Shot 1]`, `[Shot 2]` and so on."],
  ],
  [1900, 7460]));
A(Spacer());
A(Callout("Keyframe vs reference is the big one.",
  "A keyframe is a frame of the output. A reference is inspiration. They go to different nodes and different slots, and mixing them up is the single most common beginner mistake. Section 7 and section 9 keep them apart.", "warn"));

/* ---- 3 ---- */
A(H1("3. What you need before you start"));
A(Tbl(
  ["You need", "Why"],
  [
    ["**ComfyUI version 0.30.0 or newer**", "This is when ComfyUI added support for H3 at all. Older versions will not work."],
    ["**The H3 model files**", "Two of them. `fl2va` for text and picture modes; `ref2va` for reference mode. ComfyUI's own H3 templates will point you at these."],
    ["**PyAV or ffmpeg**", "**Only** if you want to use reference *videos*. Pictures and audio work without it."],
  ],
  [3000, 6360]));
A(Spacer());
A(P("On that last one: there is a good chance you already have it. Many ComfyUI installs ship with ffmpeg, and PyAV comes bundled with several popular node packs. The easy test is to drag a video file onto the Media Loader once you have installed everything. If it is accepted, you are fine. If it is refused, run this in your ComfyUI Python environment:"));
A(Code(["pip install av"]));
A(P("The pack will not crash without it — it just tells you videos are unavailable, rather than failing halfway through a render."));
A(H2("File types it accepts"));
A(Tbl(
  ["Kind", "Extensions"],
  [
    ["Pictures", "`jpg` · `jpeg` · `png` · `webp` · `gif` · `bmp`"],
    ["Video", "`mp4` · `mov` · `mkv` · `webm` · `avi` · `m4v`"],
    ["Audio", "`wav` · `mp3` · `flac` · `ogg` · `aac` · `m4a`"],
  ],
  [1800, 7560]));

/* ---- 4 ---- */
A(H1("4. Installing it"));
A(P("Pick whichever of these three you are comfortable with. They all end up in the same place."));
A(H3("Option A — ComfyUI Manager (easiest)"));
A(P("Open the Manager, search for **Fantastic H3 Prompt Builder**, click Install."));
A(H3("Option B — git"));
A(Code([
  "cd ComfyUI/custom_nodes",
  "git clone https://github.com/Adudeguyman/ComfyUI-Fantastic-MiniMaxH3-PromptBuilder",
  "",
  "pip install av      # only if you want reference videos and lack ffmpeg",
]));
A(H3("Option C — manual"));
A(P("Download the ZIP from the repository and extract it into `ComfyUI/custom_nodes/` so that you end up with a folder at `ComfyUI/custom_nodes/ComfyUI-Fantastic-MiniMaxH3-PromptBuilder/`."));
A(H2("Then restart — properly"));
A(Callout("Refreshing the browser is not enough.",
  "ComfyUI only registers new nodes when it starts up. Close ComfyUI completely and start it again.", "warn"));
A(P("To check it worked, double-click the empty canvas and search for **MiniMax H3**. Four nodes should appear. If they do not, jump to section 17."));

/* ---- 5 ---- */
A(H1("5. The four nodes"));
A(P("All four live under **conditioning → video_models** in the node menu. You only need the first two to get going; the other two are conveniences you can ignore for now."));
A(Tbl(
  ["Node", "What it is for", "Need it?"],
  [
    ["**Fantastic H3 Prompt Builder**", "The main event. Click its **Edit prompt…** button to open a full-screen editor with fillable fields. Outputs your finished prompt.", "Yes"],
    ["**Fantastic H3 Media Loader**", "Drag and drop your pictures, clips and sounds onto it. Shows you exactly which tag each one will get.", "Yes, if you use any media"],
    ["**Fantastic H3 Reference Splitter**", "Fans a bundle of media out into individual wires. Only needed if you want media to reach the sampler *without* passing through the Prompt Builder.", "Rarely"],
    ["**Fantastic H3 Filename Prefix**", "Builds a save path with today's date already filled in. Solves a specific annoyance — see section 16.", "Optional"],
  ],
  [2600, 5560, 1200]));
A(Spacer());
A(P("**Capacity:** the Prompt Builder handles up to **9 pictures, 3 videos, 3 video soundtracks and 3 standalone audio clips**. Those limits come from H3 itself, not from this pack."));

/* ---- 6 ---- */
A(H1("6. Your first video, step by step"));
A(P("This walkthrough uses **T2VA** — text only, no pictures. It is the simplest mode and the fastest way to confirm everything works."));
{
  const s = newSteps();
  A(Step("Load ComfyUI's built-in MiniMax H3 template so you have a working graph — model loader, sampler, VAE decode, save.", s));
  A(Step("Double-click the canvas, search **Fantastic H3 Prompt Builder**, and drop one onto the graph.", s));
  A(Step("Click the node's **Edit prompt…** button. A large editor opens.", s));
  A(Step("Along the top of the editor are the five mode buttons. Click **T2VA**.", s));
  A(Step("Fill in the description field. Write what happens, plainly and in order. The right-hand panel builds the finished prompt live as you type — watch it.", s));
  A(Step("Click **Save to node**. This is the *only* button that changes what the node will send.", s));
  A(Step("Back on the canvas, drag a wire from the Prompt Builder's **prompt** output to the **prompt** input on the **MiniMax H3 Image to Video** node.", s));
  A(Step("Set `width`, `height` and `length` on that H3 node. For length, see section 8 — H3 only accepts certain numbers.", s));
  A(Step("Queue it.", s));
}
A(Callout("If `prompt` is a text box rather than a socket…",
  "…right-click it and choose *Convert widget to input*. Then you can wire into it."));
A(Callout("Only Save to node commits.",
  "The ✕ button, Cancel and the Escape key all throw your edits away. If you close the editor with unsaved changes it will ask first — Save to node, Discard, or Keep editing. Get in the habit of clicking Save to node.", "warn"));

/* ---- 7 ---- */
A(H1("7. The five modes"));
A(P("The mode you pick decides what kind of input the model gets. Choose it from the buttons at the top of the editor."));
A(Tbl(
  ["Mode", "You give it", "Use it when"],
  [
    ["**T2VA**", "Text only", "Building a scene from nothing."],
    ["**I2VA**", "One picture, used as the **first frame**", "You have an image and want it to start moving."],
    ["**FL2VA**", "Two pictures — **first** and **last** frame", "You know where it starts and where it ends, and want the model to get from A to B."],
    ["**L2VA**", "One picture, used as the **last frame**", "You know the ending and want the model to invent a plausible run-up to it."],
    ["**REF**", "Any mix of up to 9 pictures, 3 videos and 3 sounds", "Locking a character's face, a visual style, a voice, or a motion across shots."],
  ],
  [1200, 3200, 4960]));
A(Spacer());
A(H2("The clever bit: the mode gates your wires"));
A(P("This is worth understanding early, because it saves you a lot of re-plugging."));
A(P("**The mode you saved decides which media actually leaves the node.** You can wire every cable once and then leave the workflow alone forever. A prompt saved in T2VA mode sends nothing but text — even with a picture still plugged into `first_frame`. Switch the editor to I2VA, click Save to node, and that picture starts flowing again."));
A(P("Media that is being held back is greyed out in the editor, and the console prints exactly what was withheld on every run — so you can always see what is happening."));

/* ---- 8 ---- */
A(H1("8. Getting the video length right"));
A(P("H3 will not accept just any frame count. Valid lengths follow a fixed pattern at 24 frames per second, so most round numbers are wrong."));
A(P("You do not have to calculate this. **Type the duration you want in the editor and it tells you the exact frame count to use.** Copy that number into the `length` field on the H3 node."));
A(Tbl(
  ["Frames", "Seconds", "Frames", "Seconds"],
  [
    ["56", "2.33", "141", "5.88"],
    ["73", "3.04", "158", "6.58"],
    ["90", "3.75", "175", "7.29"],
    ["107", "4.46", "192", "8.00"],
    ["124", "5.17", "209", "8.71"],
  ],
  [2340, 2340, 2340, 2340]));
A(Spacer());
A(Callout("Why it matters more in FL2VA and L2VA.",
  "In those modes the prompt itself states the moment your last frame lands. If the prompt says 5.88 seconds and you generate 90 frames, the prompt and the video disagree and the result suffers. Use the number the editor gives you.", "warn"));

/* ---- 9 ---- */
A(H1("9. Working with pictures (I2VA, FL2VA, L2VA)"));
A(P("These three modes take **keyframes** — pictures that are literal frames of the output."));
A(H2("Where the pictures go"));
A(P("They go to the **MiniMax H3 Image to Video** node, into its `first_frame` and `last_frame` inputs:"));
A(Bullet("**I2VA** — your picture → `first_frame`"));
A(Bullet("**FL2VA** — first picture → `first_frame`, second picture → `last_frame`"));
A(Bullet("**L2VA** — your picture → `last_frame`"));
A(Spacer(60));
A(Callout("Do not put keyframes into ref_images.",
  "The `ref_images` slots exist only on the Reference to Video node, and they mean \"here is something to draw from\" — not \"here is a frame.\" Keyframes belong in first_frame and last_frame. This is the mistake to avoid.", "warn"));
A(H2("Two ways to load them"));
A(P("**Straightforward:** use ComfyUI's ordinary **Load Image** nodes and wire them directly into the H3 node. This works perfectly."));
A(P("**With previews:** route the image through the Prompt Builder first — into its `picture_1` input, and back out of its matching `picture_1` output. Do this and your picture shows up as a thumbnail inside the editor while you write, so you can click it to insert its tag. You can also split the wire and do both at once."));
A(P("**Least wiring:** drop your pictures on the **Media Loader**, run its single `references` output into the Prompt Builder, and take your frames from the builder's `picture_1` and `picture_2` outputs."));
A(P("These modes take one picture each, except FL2VA which takes two. Connect more and the editor tells you which ones will be ignored."));

/* ---- 10 ---- */
A(H1("10. Reference mode"));
A(P("Reference mode is where H3 gets interesting: you hand it pictures, clips and sounds to *draw from* — a face to keep consistent across shots, a lighting style, a voice, a camera movement. It uses the **MiniMax H3 Reference to Video** node and the `ref2va` model."));
A(H2("The short version"));
{
  const s = newSteps();
  A(Step("On the Prompt Builder, click **+ Media loader**. One appears, already wired up.", s));
  A(Step("Drag your files onto it, or click **Load files…**. Pictures, video and audio can go in all at once — each lands in the right group automatically.", s));
  A(Step("Open **Edit prompt…** and click **Reference**. Your media now appears as clickable thumbnails down the side.", s));
  A(Step("Fill in the six sections (see below). Click a thumbnail whenever you want to mention that piece of media — it inserts the tag for you.", s));
  A(Step("Click **Save to node**.", s));
  A(Step("Wire the builder's media outputs across to the Reference to Video node, using the map below.", s));
}
A(H2("Which output goes where"));
A(Tbl(
  ["Prompt Builder output", "Reference to Video input"],
  [
    ["`prompt`", "`prompt`"],
    ["`picture_1` … `picture_9`", "the `ref_images` slots"],
    ["`video_1` … `video_3`", "the `ref_videos` slots"],
    ["`video_audio_1` … `video_audio_3`", "the `ref_video_audios` slots"],
    ["`audio_1` … `audio_3`", "the `ref_audios` slots"],
  ],
  [4200, 5160]));
A(Spacer());
A(Callout("Watch the numbering when you wire.",
  "This pack counts from 1, the native H3 node counts from 0. So `picture_1` goes into `ref_image_0`, `picture_2` into `ref_image_1`, and so on. Just keep them in the same order and you will be fine.", "warn"));
A(P("Empty slots pass through empty and the H3 node ignores them, so wiring all of them once and leaving the graph alone is exactly how this is meant to be used."));
A(H2("You are not obliged to use the Media Loader"));
A(P("Three routes all work, and the first two mix freely — if a slot has its own wire, that wins over the Media Loader's bundle:"));
A(Bullet("**Media Loader → Prompt Builder.** One cable. Thumbnails and correct tag numbering come free."));
A(Bullet("**Your own loaders → Prompt Builder.** Wire `LoadImage` and friends into the `picture_1`, `video_1`, `audio_1` inputs."));
A(Bullet("**Loaders straight to the H3 node.** Skip this pack's media handling entirely. You still get a well-formed prompt; you just do not get thumbnails while writing."));
A(H2("The six sections in reference mode"));
A(P("The editor gives you six labelled boxes. In plain terms:"));
A(Tbl(
  ["Section", "What goes in it"],
  [
    ["**subject_definitions**", "Who and what is in the video. *\"`<Subject 1>` is the woman in `<Picture 1>`, mid-thirties, dark coat.\"*"],
    ["**summary**", "One line saying what job you are asking the model to do. The editor tags it with a task type for you."],
    ["**retention_analysis**", "For each reference, how strictly it should be obeyed. Chips fill this in for you — you rarely type it by hand."],
    ["**detailed_description**", "The actual scene: shots, action, camera, dialogue. This is where most of your writing goes."],
    ["**overall_soundscape**", "The sounds that exist in the scene — rain, traffic, footsteps."],
    ["**non_diegetic_music**", "Background score that the characters cannot hear. Leave it and it writes `N/A`."],
  ],
  [2600, 6760]));
A(Spacer());
A(P("Two of these are compulsory — **summary** and **detailed_description**. Without them there is no prompt. The other four each have a ◉ switch on the heading that removes the whole section from the output while leaving your text in the editor."));
A(H3("Picture roles — the shortcut worth knowing"));
A(P("Start a line in **subject_definitions** with `<Picture N>` and a row of role chips appears underneath. Click one and it writes the definition, sets the strictness marker, and adds the right task type — three jobs in one click."));
A(Tbl(
  ["Chip", "Means", "Strictness"],
  [
    ["First frame / Last frame", "This picture is an exact frame", "`fully_preserved`"],
    ["Composition", "Copy the framing, not the content", "`weak_reference`"],
    ["Look / style", "Copy the mood and grade", "`weak_reference`"],
    ["Setting", "Reuse this location", "`partially_preserved`"],
    ["Attribute → subject", "Give this trait to a character", "`attribute_transfer`"],
    ["Storyboard", "Use as staging guidance", "`weak_reference`"],
  ],
  [2600, 4400, 2360]));
A(Spacer());
A(Callout("There is no \"identity\" chip, on purpose.",
  "A picture that simply shows what a character looks like should be mentioned inside that character's own line — `<Subject 1> is the woman in <Picture 1>, with …` — not given a standalone picture definition. Standalone picture lines are for pictures playing a role in their own right."));

/* ---- 11 ---- */
A(H1("11. Writing text that H3 understands"));
A(P("Everything so far has been about the machinery — which node, which wire, which button. This section is about the words themselves, because H3 has firm opinions about those too."));
A(P("All of it comes from MiniMax's own **Video Prompt Writing Guide**, which ships inside this node pack. Two ways to open it:"));
A(Bullet("Click the **📖** button in the editor header."));
A(Bullet("Or open it straight in your browser while ComfyUI is running: `http://127.0.0.1:8188/extensions/ComfyUI-Fantastic-MiniMaxH3-PromptBuilder/Video_Prompt_Writing_Guide.pdf` — change the address and port if your ComfyUI is not on the default."));
A(Spacer(60));
A(P("It is twenty pages and worth reading properly once. What follows is the part you will use daily."));

A(H2("Open with style and composition"));
A(P("The very start of `[Shot 1]` should establish the overall look and the opening framing, before anything moves. The guide's suggested styles: **cinematic, live-action, 2D-animated, 3D CG, claymation, watercolour, vintage film.** For picture modes, take the style from your reference image; for T2VA, pick it deliberately."));
A(Code(["[Shot 1] Live-action, cinematic, a medium-wide shot frames..."]));
A(P("Then keep going along the timeline. Every detail you write should correspond to something actually visible or audible — appearance, position, props, actions, reactions, cuts, speech, and the sounds that go with them."));

A(H2("Shots and cuts"));
A(Bullet("**`[Shot 1]` never carries a timestamp.** Later shots always do, and the times must strictly increase and land inside your video's duration."));
A(Bullet("Format is exact: `[Shot 2] At 00:03.500, the camera cuts to…`"));
A(Bullet("Approved phrasings for an ordinary cut: *the camera cuts to*, *the shot cuts to*, *the shot transitions to*, *the shot changes to*, *the shot switches to*. Use cross-dissolve, fade or wipe only when you actually want one."));
A(Spacer(60));
A(Callout("When to cut and when to move the camera.",
  "A cut should introduce genuinely new information — a new subject, space, state, viewpoint or moment in time. If all you want is a slightly different distance or angle, move the camera instead. Cutting for nothing wastes a shot."));

A(H2("Camera motion"));
A(P("A camera move has three parts: **type, amplitude and speed.** Only the type is required — add amplitude and speed when they matter, since medium amplitude at normal speed is the assumed default and saying so just adds noise."));
A(Tbl(
  ["Motion type", "What it does"],
  [
    ["Zoom In / Zoom Out", "Focal length changes; the camera body stays put"],
    ["Push In / Pull Out", "The camera itself moves forward or back"],
    ["Pan Left / Pan Right", "Camera stays put, lens pivots horizontally"],
    ["Truck Left / Truck Right", "The camera slides sideways"],
    ["Tilt Up / Tilt Down", "Camera stays put, lens pivots vertically"],
    ["Pedestal Up / Pedestal Down", "The whole camera rises or drops"],
    ["Arc Shot", "The camera curves around the subject"],
    ["Tracking Shot", "The camera follows a moving subject"],
    ["Static Shot", "Nothing moves"],
    ["Shake Slightly / Shake Strongly", "Camera shake"],
    ["POV", "The subject's own point of view"],
    ["Roll Clockwise / Roll Counterclockwise", "The camera rolls around the lens axis"],
  ],
  [3200, 6160]));
A(Spacer());
A(P("Amplitude is written `with small amplitude` or `with large amplitude`; speed is `at slow speed` or `at fast speed`."));
A(Callout("Write the move as a sentence, not a label.",
  "Do not staple \"(push in, slow)\" onto the end of a line. Fold it into the action:", "info"));
A(Code([
  "The camera pushes in with small amplitude at slow speed toward the",
  "folded letter in her hands.",
  "",
  "The camera pans right with large amplitude at fast speed, revealing",
  "the open doorway.",
]));

A(H2("Speakers and dialogue"));
A(P("Anyone who speaks, sings, or is heard off-screen gets a stable ID — `(S1)`, `(S2)` — and **keeps that same ID for the whole video**. Characters who never make a sound get no ID at all. Two people speaking at once share a compound ID: `(S1,S2)`."));
A(P("When a speaker first appears, give enough detail to fix their identity: type of character, age, gender, whether they are on screen, and how they sound — pitch, timbre, pace, accent."));
A(Callout("The one rule to remember about <d> tags.",
  "Everything about who is speaking and how goes OUTSIDE the tags. Inside the tags goes only the language marker and the exact words spoken — preserved verbatim, punctuation and all, never translated or tidied up.", "warn"));
A(Code([
  "The young woman with a quiet, breathy voice (S1) says:",
  "<d>[English] I get off at the next station.</d>",
  "",
  "The two children (S1,S2) shout together,",
  "<d>[English] Wait for us!</d>",
]));
A(P("**Voiceover** has its own required phrasing — the exact words *says in an off-screen voiceover* — and you must state immediately afterwards that the character's lips stay shut, or the model will animate them talking:"));
A(Code([
  "The man (S1) says in an off-screen voiceover: <d>[English] I still",
  "remember that road.</d> while his lips remain completely closed.",
]));
A(P("The editor's dialogue row writes this for you, including the lips-closed clause, so you rarely have to remember it."));
A(P("Two more tags for edge cases: `<scenetrans>` goes at the joining point in **both** halves when one spoken line carries across a cut (and you should say in words that the audio continues), and `<cutoff>` marks speech chopped off by the end of the video."));

A(H2("On-screen text"));
A(P("Any sign, banner, label or subtitle that is genuinely visible goes in **double quotation marks**, verbatim and untranslated:"));
A(Code(['A red neon sign reading "OPEN" glows above the doorway.']));

A(H2("The two sound sections"));
A(Tbl(
  ["Section", "The rules"],
  [
    ["**overall_soundscape**", "One to four sentences, one continuous paragraph. Ambient sound, physical action sounds, and non-verbal human sounds — wind, rain, traffic, footsteps, fabric, impacts, breathing, laughter. **Do not repeat dialogue, singing or in-scene music here** — those live in the description. Use `N/A` only if you genuinely want total silence."],
    ["**non_diegetic_music**", "One to three sentences covering instrumentation, tempo and dynamics. This is score the characters cannot hear. `N/A` is perfectly normal here."],
  ],
  [2600, 6760]));
A(Spacer());
A(Code([
  "overall_soundscape: Steady rain taps against the cafe windows while",
  "low room ambience continues underneath. The entrance bell rings once,",
  "followed by wet footsteps and the soft scrape of a chair.",
]));

A(H2("Reference mode: what the strictness markers actually mean"));
A(P("In `retention_analysis` you give every reference a marker saying how strictly to obey it. The editor's role chips usually pick these for you, but this is what they mean:"));
A(Tbl(
  ["Marker (pictures, videos, subjects)", "Meaning"],
  [
    ["`fully_preserved`", "The reference's defined role is kept completely."],
    ["`partially_preserved`", "Still used, but some defined characteristics change or are only partly kept."],
    ["`attribute_transfer`", "Take these characteristics and give them to a *different* subject."],
    ["`weak_reference`", "Keep only a broad similarity — style, category, composition, atmosphere."],
  ],
  [3400, 5960]));
A(Spacer(80));
A(Tbl(
  ["Marker (audio)", "Meaning"],
  [
    ["`fully_copy`", "The whole source audio becomes the video's complete final audio track."],
    ["`partially_copy`", "Only part of it is copied, or things are added, removed or replaced afterwards."],
    ["`reference`", "Nothing is copied — only the timbre, rhythm, style, content or texture is followed."],
    ["`weak_reference`", "Only a broad similarity of category or atmosphere."],
  ],
  [3400, 5960]));
A(Spacer());
A(P("The line format is `<label> (where it appears): marker - explanation`, for example:"));
A(Code([
  "<Subject 1> (appears in [Shot 1], [Shot 3]): fully_preserved - ...",
  "<Picture 2> ([Shot 1] first frame): fully_preserved - ...",
  "<Video 1> (cut and pacing structure): weak_reference - ...",
  "<Audio 2>: reference - the target speaker follows <Audio 2>'s voice",
  "  timbre and measured delivery without copying the original signal.",
]));

A(H2("Task types, and a trap"));
A(P("The `summary` line opens with the kind of job you are asking for. Combine several with `+` when a job genuinely does several things — *[video continuation + keyframe completion]* — but never repeat one."));
A(Tbl(
  ["Task type", "Use it when"],
  [
    ["`keyframe completion`", "An image is a concrete frame anchor — first frame, last frame, a keyframe."],
    ["`reference generation`", "An image, video or sound guides a character, scene, style, action, camera move or storyboard **without** being a literal frame or an edited source."],
    ["`video editing`", "An existing source video is directly modified."],
    ["`video continuation`", "New content continues, extends or resumes from an existing source video."],
    ["`audio reuse`", "The same audio signal is reused, in whole or in part."],
    ["`audio reference`", "The audio is not copied — only its style, timbre, content, texture or beat is followed."],
  ],
  [2600, 6760]));
A(Spacer());
A(Callout("The trap.",
  "Attaching a video or an audio clip does not automatically earn the matching task type. A reference video that only supplies camera movement, cuts or rhythm is `reference generation` — not `video editing`. Use editing or continuation only when that video is genuinely being edited or continued.", "warn"));

A(H2("The checklist, condensed"));
A(P("MiniMax's guide ends with a checklist. The points worth a final glance before you queue:"));
A(Bullet("`[Shot 1]` has no timestamp; every later cut time increases and sits inside the duration."));
A(Bullet("Every cut introduces genuinely new information."));
A(Bullet("Camera motion reads as natural action, with amplitude and speed only where meaningful."));
A(Bullet("Speaker IDs are stable across shots; silent characters have none."));
A(Bullet("`<d>` contains only the language tag and the exact words."));
A(Bullet("Voiceovers use the required phrase and a closed-lips statement."));
A(Bullet("On-screen text is in double quotes and untranslated."));
A(Bullet("`overall_soundscape` is one to four sentences and repeats no dialogue or music."));
A(Bullet("`N/A` appears only where it is genuinely warranted."));
A(Spacer(60));
A(P("**In reference mode, additionally:** all six sections present and in order; every label defined once and used consistently; the task-type prefix matches what each reference really does; no new labels invented in `summary`; **no speaker IDs anywhere in `retention_analysis`**; and the style established in a sentence or two before `[Shot 1]`."));
A(Callout("The good news.",
  "The editor checks a large share of this list for you as you type — shot numbering, cut times, unbalanced or unlabelled dialogue tags, references you connected but never mentioned, and subjects missing a retention entry. Amber warnings are advisory; red ones are worth fixing before you render."));
/* ---- 12 ---- */
A(H1("12. Tag numbering — the rule that catches everyone"));
A(P("Your prompt refers to media by tags: `<Picture 1>`, `<Audio 2>`. It is very tempting to assume `<Picture 3>` means \"the one plugged into slot 3.\" **It does not.**"));
A(Callout("H3 numbers references by the order they arrive, not by which slot they occupy.", "", "warn"));
A(P("Two consequences:"));
A(Bullet("**Gaps close up.** Fill only `picture_2` and `picture_5`, leaving the rest empty, and they become `<Picture 1>` and `<Picture 2>`."));
A(Bullet("**A video's soundtrack takes a low audio number.** It is presented immediately before its own video. So with one video that has sound plus one separate music clip, the soundtrack is `<Audio 1>` and your music file is `<Audio 2>` — even though you added the music first."));
A(Spacer(60));
A(P("You do not have to work any of this out. The **Media Loader prints the exact tag order along the bottom of the node**, and every thumbnail in the editor is labelled with the tag it will really get. Trust those two displays over your intuition, every time."));
A(Callout("Reordering media does not rewrite your prompt.",
  "If you drag media into a different order, or switch a piece off, the tags change — but the text you already typed does not. You have to update it yourself. The editor will show the now-wrong tags in red.", "warn"));

/* ---- 13 ---- */
A(H1("13. The limits you cannot exceed"));
A(P("There are three separate budgets, and they are counted independently. Most confusion here comes from assuming there is only one."));
A(H3("1. Twelve references, total"));
A(P("Across everything — pictures, videos and sounds. **A video whose audio is switched on costs two**, because its soundtrack counts as a reference in its own right. Set that video's audio to `off` and you get one back."));
A(P("Go over twelve and you get a red warning. The node deliberately refuses to drop anything for you, because removing a reference renumbers every tag after it and would quietly break the text you already wrote."));
A(H3("2. Three audio clips"));
A(P("A soundtrack split off from a video counts as one of the three, even though it travels along a different wire. So three videos with their sound on will use your entire audio allowance."));
A(H3("3. Two to fifteen seconds — and fifteen is the TOTAL"));
A(P("This is the one people miss. Each clip must run between 2 and 15 seconds, **and 15 seconds is the total across all clips of a type, not an allowance per clip.**"));
A(Bullet("Three 15-second audio clips is 45 seconds — three times over budget."));
A(Bullet("Three clips only fit if they average about five seconds each."));
A(Bullet("A 12-second video with its sound on spends 12 of your 15 video seconds *and* 12 of your 15 audio seconds, leaving 3 seconds of audio for anything else."));
A(Spacer(60));
A(P("Also: **audio cannot be sent on its own.** There must be at least one picture or video alongside it."));
A(P("The Media Loader shows both counters — files and audio seconds — and warns you as soon as either is exceeded. The usual fix is trimming (section 14), not re-exporting your files."));
A(H2("off / paired / alone"));
A(P("Any video that has sound gets a small three-way control. What to pick:"));
A(Tbl(
  ["Setting", "Choose it when"],
  [
    ["**paired**", "The sound belongs to this footage — on-screen dialogue where lip sync matters, action sounds that must land on the right frames, or you are keeping a source clip's original audio."],
    ["**alone**", "You want the sound as a reference rather than as this clip's soundtrack — borrowing a voice, a music style, some ambience. Also right when you are not reusing the visuals in sync."],
    ["**off**", "Ignore the audio entirely. Gives you a reference slot back."],
  ],
  [1500, 7860]));

/* ---- 14 ---- */
A(H1("14. Trimming, cropping and memory"));
A(P("Click **✂** on a video or audio row (or **▣** on a picture) to open an editor."));
A(Callout("Your original files are never modified.",
  "Every trim, crop, rotation, mirror and size cap is stored as a note on the item and applied when the media is decoded. The same file can behave differently in another workflow, and Reset always gives you the whole thing back."));
A(H2("Getting around the timeline"));
A(P("Click or drag anywhere on the bar to scrub the preview. Drag the two blue handles to set what is kept — clicking the bar never moves them. An amber playhead shows where you are, and turns red if you scrub outside the kept range, so you can never be looking at a frame that is secretly excluded."));
A(Tbl(
  ["Key", "Does"],
  [
    ["← →", "Step one frame (hold shift for ten)"],
    ["space", "Play / pause the selected span"],
    ["`[`  `]`", "Set the start / end to wherever the playhead is"],
    ["home / end", "Jump to the start / end of the selection"],
    ["M", "Mute or unmute the preview"],
    ["A", "Save the kept range as an audio reference"],
    ["C", "Capture the current frame (video only)"],
    ["esc", "Close without applying"],
  ],
  [1600, 7760]));
A(Spacer());
A(H2("Three shortcuts worth learning"));
A(Bullet("**`last 2s` / `last 3s`** grab a clip's tail in one click. This is exactly what a continuation reference wants — the motion leading into your new shot, without spending your whole budget on footage the model does not need."));
A(Bullet("**📷 Use frame** saves the frame you are looking at into ComfyUI's input folder and adds it as a picture reference. This is the clean way to continue from a clip: scrub back slightly from the very last frame (which is usually the blurriest), capture it, and wire that picture to `first_frame` in I2VA mode."));
A(Bullet("**🎵 Use audio** writes the kept range out as its own WAV and adds it as a standalone audio reference. This is how you lift one spoken sentence out of a longer recording to use as a voice reference."));
A(H2("Reference video eats RAM — read this before loading a 4K clip"));
A(P("Reference video is decoded into raw frames, so the memory cost is width × height × 3 × 4 bytes × number of frames. That adds up alarmingly fast:"));
A(Tbl(
  ["Size cap on a 15-second 1080p clip", "Memory used"],
  [
    ["full (the default — nothing is resized unless you ask)", "about 9.0 GB"],
    ["1280 px", "about 4.0 GB"],
    ["1024 px", "about 2.5 GB"],
    ["832 px", "about 1.7 GB"],
  ],
  [5600, 3760]));
A(Spacer());
A(P("Setting a **size** cap in the ✂ editor costs far less quality than you would expect, because the H3 node rescales every reference down to your generation's pixel area anyway. Feeding it 1080p while generating at 832×480 spends all that memory and then throws the detail away."));
A(P("**Two exceptions — leave these at full:** a clip you are using as a motion continuation source, and any clip whose framing you are matching closely. Both want to be at least as large as what you are generating."));
A(P("The same logic applies to pictures, with one important exception: a picture used as `first_frame` or `last_frame` should stay **at least as large as your generation**, or the model ends up upscaling it and you will see the softness."));
A(P("**⬇ Write copy** makes a reduction permanent — it writes a resized copy (with your crop, rotation and mirror baked in) into the input folder and points the reference at that, so the file, the decode and the memory all shrink. Your original is left exactly as it was."));
A(Callout("One wrinkle.",
  "A trim applies to the whole item, so trimming a video trims its picture and its soundtrack together. If you want the full video but only a few seconds of its audio, set the video's audio to `off`, load the audio file separately, and trim that copy instead."));

/* ---- 15 ---- */
A(H1("15. Saving your work"));
A(H2("The prompt library"));
A(P("**☰ Library** in the editor header. Saving stores the *state of every field*, not just the finished text — so loading a prompt puts you back exactly where you were, ready to edit. Nothing is re-parsed on the way back in, so nothing can be misread."));
A(P("You can search by name, category, mode or the prompt text itself; star favourites; and rename or clear categories across every prompt at once."));
A(P("If you load a prompt, change its name and save, it asks what you meant: **Save as new** keeps the original and adds a second entry (this is the default, and what Enter does), while **Rename** carries the original over. Name collisions always ask before overwriting."));
A(P("Your prompts are stored as individual files in ComfyUI's user folder, so they survive updates and are easy to back up."));
A(H2("Phrases"));
A(P("Wording you type over and over — a house style line, a camera move you like — can be saved once and dropped in with a click. Use **+ New**, or select some text, right-click, and choose *Save selection as phrase…*."));
A(Callout("Line breaks in a saved phrase get flattened.",
  "That is deliberate: H3 reads a line break as a shot cut, so a multi-line phrase would silently chop your video up."));
A(H2("Media presets"));
A(P("The Media Loader can save your current set of references — which files, what order, each video's audio setting, and any trims — under a name, and reload the lot in one click."));
A(P("Presets *point at* files you have already uploaded rather than copying them, so saving and loading are instant. If you later delete one of those files, loading the preset skips it and tells you which one is missing. Deleting a preset never deletes your media."));
A(H2("Draft mode"));
A(P("Say you have queued a batch and want to start writing the next prompt. Click **Draft ▶** and the editor turns teal — you are now on a scratchpad that cannot be executed. The node still holds your live prompt, and nothing in the draft reaches it until you click **Commit to Live**."));
A(P("Drafts autosave to disk as you type, survive a browser crash, and reopen where you left off. **Save to node** is greyed out the whole time you are drafting, which is the point."));
A(P("**⇣ Pull from Live** copies your live prompt into the draft so you do not retype a cast you have already written. It offers two scopes: *Cast and setup only* keeps the mode, duration, subjects and style but leaves the description empty — the right shape for writing the next shot in a scene — while *Everything* is a straight copy for working up a variant."));
A(Callout("Drafting will not disturb your live references.",
  "A draft only applies its media to the Media Loader if you actually edited the draft's media. If you never touched it, committing changes nothing about your loader — so improving your live references while a draft sits open is safe."));

/* ---- 16 ---- */
A(H1("16. Dated output folders"));
A(P("A small annoyance this node solves. Save nodes only expand date tokens like `%date:yyyy-MM-dd%` when you type them **directly into the save node's own box**. Route that text through a string node or a switch and the token arrives untouched — you end up with a folder literally named `%date:yyyy-MM-dd%`. This is a known issue in VideoHelperSuite among others."));
A(P("**Fantastic H3 Filename Prefix** builds the path from parts and works the date out itself, so what reaches the save node is a plain string that survives any amount of wiring."));
A(Tbl(
  ["Field", "What to put in it"],
  [
    ["**folder**", "Click **📁 Browse…** to walk your ComfyUI output directory — click a folder to enter it, `..` to go up, **Create** to make a new one. Or just type a path."],
    ["**subfolder**", "Optional extra levels, created if missing. `Ref2V`, or `client/act2`."],
    ["**date_folder**", "Off, or a dated folder in your preferred format — `YYYY-MM-DD`, `YYYY/MM/DD`, `YYYY-MM-DD_HH-MM` and so on."],
    ["**filename**", "The start of the file name. Your save node still adds its own counter on the end."],
  ],
  [1800, 7560]));
A(Spacer());
A(P("So folder `MiniMaxH3`, subfolder `Ref2V`, date format `YYYY-MM-DD` and filename `vid` gives you:"));
A(Code(["MiniMaxH3/Ref2V/2026-08-21/vid_00001.mp4"]));
A(P("The node re-evaluates on every run, so the date can never get stuck at whatever it was when you loaded the workflow."));

/* ---- 17 ---- */
A(H1("17. When something goes wrong"));
A(Tbl(
  ["Symptom", "What to do"],
  [
    ["**The nodes do not appear at all**", "ComfyUI needs a full restart, not a browser refresh. Check the startup console for errors mentioning MiniMaxH3."],
    ["**A node appears but has no buttons or panel** — you just see a plain text box", "The Python side loaded but the interface did not. In order of likelihood: (1) stale browser cache — press Ctrl+Shift+R, or try an incognito window; (2) another extension is throwing an error during load and stopping this one registering — press F12 and read the first red error, which often names a different pack; (3) a partial install — the `web/` folder should contain `promptbuilder.js`, `medialoader.js`, `fileprefix.js` and the guide PDF."],
    ["**I updated but nothing changed**", "ComfyUI caches extension files hard. Press F12, go to the Network tab, tick *Disable cache*, and reload with the tools still open. If a node's *outputs* look wrong specifically, that is a restart issue instead — and nodes already sitting in a workflow keep their old slots, so delete and re-add them after an update."],
    ["**My videos get rejected**", "Neither PyAV nor ffmpeg was found. Check whether ffmpeg is on your PATH before installing anything; otherwise run `pip install av` in ComfyUI's Python environment."],
    ["**A button does nothing**", "Press F12 to open the browser console and click it again — any failure prints there. The Media Loader also has an **Open loader…** button that works independently of the on-node panel."],
    ["**The media loader looks empty after opening a workflow**", "A bug in versions before 1.5.7. Your files were never touched — only the node's list of them. Update the pack."],
    ["**Something looks squashed or overlapping**", "The pack supports both the classic node renderer and Nodes 2.0. If a panel misbehaves in one of them, the pop-out buttons (**Edit prompt…**, **Open loader…**) always work regardless."],
  ],
  [2700, 6660]));
A(Spacer());
A(P("If the pack itself is the thing failing, the node shows a **⚠ UI failed** button — click it for the error text, and include that text in any bug report."));

/* ---- 18 ---- */
A(H1("18. The example workflow"));
A(P("The pack ships with a complete example. Find it in ComfyUI under **Workflows → Browse Templates**, or open `example_workflows/MMH3PromptBuilder_AIO_Example.json` directly."));
A(P("It needs two other packs installed: **VideoHelperSuite** for the video output, and **KJNodes** for the Set/Get nodes."));
A(Callout("One setting to check before you run it.",
  "The example is built for a 4-step turbo LoRA, with Sigma Shift at 12 video / 6 audio. If you are running the base FL2VA model without a turbo LoRA, change the audio value back to 3. The released base configuration is 12/3; the 6 is there because distilled turbo LoRAs compress the video trajectory, and the audio schedule is derived from the video one.", "warn"));

/* ---- 19 ---- */
A(H1("19. Cheat sheet"));
A(Tbl(
  ["", ""],
  [
    ["**Where are the nodes?**", "conditioning → video_models → Fantastic H3 …"],
    ["**How much media?**", "9 pictures · 3 videos · 3 video soundtracks · 3 standalone audio clips"],
    ["**Hard limits**", "12 references total · 3 audio clips · each clip 2–15 s · **15 s total per media type** · audio needs a picture or video alongside it"],
    ["**Valid lengths**", "at 24 fps: … 90, 107, 124, 141, 158, 175, 192 … — the editor tells you the number"],
    ["**Slot offset**", "builder `picture_1` → native `ref_image_0` (we count from 1, it counts from 0)"],
    ["**Tag numbering**", "by arrival order, gaps close up; a video's soundtrack comes before its video"],
    ["**What commits your edits?**", "**Save to node** only. ✕, Cancel and Escape all discard."],
    ["**What decides what gets sent?**", "the mode you *saved*, not what is wired"],
    ["**Video costs two references**", "unless its audio is set to `off`"],
    ["**Where is my stuff stored?**", "ComfyUI's user folder, under `minimax_h3/` — prompts, presets, phrases and drafts"],
  ],
  [2900, 6460]));
A(Spacer(240));
A(new Paragraph({
  spacing: { before: 200 },
  border: { top: { style: BorderStyle.SINGLE, size: 6, color: RULE, space: 10 } },
  children: [new TextRun({
    text: "Written against version 1.6.0 of the node pack. Later releases may behave differently — check the repository's README for the current changelog.",
    font: BODY, size: 19, italics: true, color: MUTED,
  })],
}));

/* ================= DOC ================= */
const doc = new Document({
  creator: "ComfyUI Workflow Finder",
  title: "MiniMax H3 Prompt Builder — A Beginner's Guide",
  description: "Beginner-friendly usage guide for the ComfyUI-Fantastic-MiniMaxH3-PromptBuilder custom node.",
  numbering: {
    config: [
      {
        reference: "bullets",
        levels: [
          { level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 460, hanging: 260 } } } },
          { level: 1, format: LevelFormat.BULLET, text: "◦", alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 900, hanging: 260 } } } },
        ],
      },
      {
        reference: "steps",
        levels: [
          { level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.START,
            style: { paragraph: { indent: { left: 500, hanging: 300 } } } },
        ],
      },
    ],
  },
  styles: {
    default: {
      document: { run: { font: BODY, size: 22, color: INK } },
    },
  },
  sections: [{
    properties: {
      page: {
        size: { width: 12240, height: 15840 },
        margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 },
      },
    },
    children: body,
  }],
});

Packer.toBuffer(doc).then((b) => {
  fs.writeFileSync(process.argv[2], b);
  console.log("wrote", process.argv[2], b.length, "bytes");
});
