/* Renders the SAME content block from make.js as Markdown, so the .docx and
   the repo .md can never drift apart. */
const fs = require("fs");

const src = fs.readFileSync("make.js", "utf8");
const start = src.indexOf("/* ================= CONTENT ================= */");
const end = src.indexOf("/* ================= DOC ================= */");
if (start < 0 || end < 0) throw new Error("content markers not found");
let content = src.slice(start, end);
// the content block declares its own body/A collector; strip them so it
// feeds the markdown collector defined below instead.
content = content
  .replace(/^const body = \[\];$/m, "")
  .replace(/^const A = \(\.\.\.x\) => body\.push\(\.\.\.x\.flat\(\)\);$/m, "");

/* ---- markdown implementations of the same helper signatures ---- */
const out = [];
const push = (s) => out.push(s);

const H1 = (t) => "\n## " + t + "\n";
const H2 = (t) => "\n### " + t + "\n";
const H3 = (t) => "\n#### " + t + "\n";
const P = (t) => t + "\n";
const Bullet = (t, level = 0) => "  ".repeat(level) + "- " + t;
let stepCounters = {};
const newSteps = () => {
  const id = Object.keys(stepCounters).length + 1;
  stepCounters[id] = 0;
  return id;
};
const Step = (t, inst) => `${++stepCounters[inst]}. ${t}`;
// one element so blank lines inside the fence survive the collector
const Code = (lines) => ["```\n" + lines.join("\n") + "\n```"];
const Callout = (label, text) =>
  "> " + ("**" + label + "** " + text).trim() + "\n";
const Spacer = () => "";

function Tbl(headers, rows) {
  const esc = (c) => String(c).replace(/\|/g, "\\|");
  const lines = [
    "",
    "| " + headers.map(esc).join(" | ") + " |",
    "|" + headers.map(() => "---").join("|") + "|",
    ...rows.map((r) => "| " + r.map(esc).join(" | ") + " |"),
    "",
  ];
  return lines;
}

/* stubs for the docx objects used in the title block */
class Paragraph {
  constructor(o) {
    this.md = (o.children || [])
      .map((c) => (c && c.md !== undefined ? c.md : ""))
      .join("");
  }
}
class TextRun {
  constructor(o) {
    const t = typeof o === "string" ? o : o.text || "";
    this.md = o && o.bold ? (t.trim() ? "**" + t + "**" : t) : t;
  }
}
class PageBreak {
  constructor() {
    this.md = "";
  }
}
class ExternalHyperlink {
  constructor(o) {
    const label = (o.children || []).map((c) => c.md).join("");
    this.md = `[${label}](${o.link})`;
  }
}
const HeadingLevel = {}, AlignmentType = {}, BorderStyle = {}, ShadingType = {},
  WidthType = {}, LevelFormat = {}, Table = class {}, TableRow = class {},
  TableCell = class {};
const BODY = "", MONO = "", INK = "", ACCENT = "", ACCENT_DK = "", MUTED = "",
  RULE = "", BAND = "", WARNBAND = "", WARNRULE = "", CODEBAND = "",
  CONTENT_W = 0;

const body = [];
const A = (...x) =>
  x.flat(Infinity).forEach((item) => {
    if (item === "" || item === undefined || item === null) return;
    if (item instanceof Paragraph) {
      if (item.md.trim()) body.push(item.md);
      return;
    }
    body.push(item);
  });

eval(content);

/* ---- assemble ---- */
let md = body.join("\n");
md = md.replace(/\n{3,}/g, "\n\n");

// bullets and numbered items need to sit flush against their neighbours
md = md
  .split("\n")
  .reduce((acc, line, i, arr) => {
    const isItem = /^(\s*[-*]\s|\s*\d+\.\s)/.test(line);
    const prevItem = i > 0 && /^(\s*[-*]\s|\s*\d+\.\s)/.test(arr[i - 1]);
    if (isItem && prevItem) {
      // collapse the blank line that P() adds between consecutive items
      if (acc[acc.length - 1] === "") acc.pop();
    }
    acc.push(line);
    return acc;
  }, [])
  .join("\n");

// breathing room before block constructs
let inFence = false;
md = md
  .split("\n")
  .reduce((acc, line) => {
    const fence = line.startsWith("```");
    const prev = acc[acc.length - 1];
    const needsGap =
      !inFence && prev !== undefined && prev.trim() !== "" &&
      ((line.startsWith("> ") && !prev.startsWith("> ")) ||
       line.startsWith("#") ||
       fence ||
       (line.startsWith("|") && !prev.startsWith("|")));
    if (needsGap) acc.push("");
    acc.push(line);
    if (fence) inFence = !inFence;
    return acc;
  }, [])
  .join("\n");

// title block
md = md.replace(
  "**MiniMax H3 Prompt Builder**\nA beginner's guide to the ComfyUI custom node",
  "# MiniMax H3 Prompt Builder\n\n*A beginner's guide to the ComfyUI custom node*\n");

md = md.replace(/\n{3,}/g, "\n\n");

const header = `<!-- Generated from make.js — edit that, not this file. -->\n\n`;
fs.writeFileSync(process.argv[2], header + md.trim() + "\n");
console.log("wrote", process.argv[2]);
