/* Clipwright UI — vanilla JS, no build step. */
"use strict";

const $ = (s) => document.querySelector(s);
let CFG = null, PID = null, SEL = null;   // SEL = {path, kind}
let pollTimer = null;

// ---------- helpers ----------

function toast(msg, err = false) {
  const t = $("#toast");
  t.textContent = msg; t.className = err ? "err" : ""; t.style.display = "block";
  clearTimeout(t._h); t._h = setTimeout(() => t.style.display = "none", err ? 7000 : 3000);
}

async function api(method, path, body) {
  const opt = { method, headers: {} };
  if (body !== undefined) { opt.headers["Content-Type"] = "application/json"; opt.body = JSON.stringify(body); }
  const r = await fetch(path, opt);
  if (!r.ok) {
    let d = ""; try { d = (await r.json()).detail; } catch { d = r.statusText; }
    throw new Error(d);
  }
  return r.json();
}
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fileUrl = (p) => `/api/projects/${PID}/file?path=${encodeURIComponent(p)}`;

function modal(html) {
  $("#modalBox").innerHTML = html;
  $("#modal").style.display = "flex";
}
function closeModal() { $("#modal").style.display = "none"; }
$("#modal").addEventListener("click", (e) => { if (e.target.id === "modal") closeModal(); });

async function busy(btn, fn) {
  const old = btn.textContent; btn.disabled = true; btn.textContent = "⏳ " + old;
  try { await fn(); } catch (e) { toast(e.message, true); }
  btn.disabled = false; btn.textContent = old;
}

// ---------- boot / projects ----------

async function boot() {
  CFG = await api("GET", "/api/config");
  const cs = $("#comfyStatus");
  cs.textContent = "ComfyUI: " + (CFG.comfy_online ? "online" : "offline");
  cs.className = "pill " + (CFG.comfy_online ? "on" : "off");
  const projects = await api("GET", "/api/projects");
  const sel = $("#projectSelect");
  sel.innerHTML = '<option value="">— project —</option>' +
    projects.map(p => `<option value="${p.id}">${esc(p.title)}</option>`).join("");
  if (projects.length && !PID) { PID = projects[0].id; sel.value = PID; }
  if (PID) refreshAll();
}

$("#projectSelect").onchange = (e) => { PID = e.target.value || null; SEL = null; refreshAll(); };

$("#newProjectBtn").onclick = () => modal(`
  <h3>New Project</h3>
  <div class="field"><label>Title</label><input type="text" id="npTitle" placeholder="Aeterna"></div>
  <div class="field"><label>Logline (optional)</label><textarea id="npLog"></textarea></div>
  <p style="color:var(--dim);font-size:12px">After creating: drop your bible docs (.md/.txt) in
  <span class="mono">projects/&lt;id&gt;/bible/</span> or upload them from the project page, then hit ✨ Generate Story.</p>
  <div class="actions"><button onclick="closeModal()">Cancel</button>
  <button class="primary" id="npGo">Create</button></div>`);

document.addEventListener("click", async (e) => {
  if (e.target.id !== "npGo") return;
  await busy(e.target, async () => {
    const p = await api("POST", "/api/projects", { title: $("#npTitle").value, logline: $("#npLog").value });
    closeModal(); PID = p.id; await boot(); $("#projectSelect").value = PID;
  });
});

async function refreshAll() {
  if (!PID) { $("#treeBody").innerHTML = ""; showEmpty(); return; }
  await Promise.all([renderTree(), renderProposals(), renderRenders()]);
  if (SEL) openEntity(SEL.path, SEL.kind); else showEmpty();
}
function showEmpty() { $("#editorEmpty").style.display = "block"; $("#editorBody").style.display = "none"; }

// ---------- tree ----------

async function renderTree() {
  const t = await api("GET", `/api/projects/${PID}/tree`);
  let h = `<div class="tnode ch ${selCls('project.json')}" data-path="project.json" data-kind="project">📕 ${esc(t.project.title)}</div>`;
  for (const ch of t.chapters) {
    h += `<div class="tnode ch ${selCls(ch.path)}" data-path="${ch.path}" data-kind="chapter"><span class="tid">${ch.id}</span>${esc(ch.title)}</div>`;
    for (const sc of ch.scenes) {
      h += `<div class="tnode sc ${selCls(sc.path)}" data-path="${sc.path}" data-kind="scene"><span class="tid">${sc.id}</span>${esc(sc.title)}${badge(sc.status)}</div>`;
      for (const cl of sc.clips)
        h += `<div class="tnode cl ${selCls(cl.path)}" data-path="${cl.path}" data-kind="clip"><span class="tid">${cl.id}</span>${esc(cl.action || "(clip)")}${badge(cl.status)}</div>`;
    }
  }
  $("#treeBody").innerHTML = h;
  $("#treeBody").querySelectorAll(".tnode").forEach(n =>
    n.onclick = () => openEntity(n.dataset.path, n.dataset.kind));
}
const selCls = (p) => SEL && SEL.path === p ? "sel" : "";
const badge = (s) => s && s !== "draft" ? `<span class="badge ${s}">${s.replace("_", " ")}</span>` : "";

$("#genStoryBtn").onclick = () => {
  if (!PID) return toast("Create a project first", true);
  modal(`<h3>✨ Generate Story</h3>
  <div class="field"><label>Idea / direction (optional if bible docs are uploaded)</label>
  <textarea id="gsIdea" rows="6" placeholder="A full-length story about…"></textarea></div>
  <div class="field"><label>Bible docs</label><div id="gsBible" style="color:var(--dim)">…</div>
  <input type="file" id="gsUpload" multiple accept=".md,.txt"></div>
  <p style="color:var(--dim);font-size:12px">This writes chapters, scenes, characters and a visual bible. It can take a couple of minutes and only runs on an empty project.</p>
  <div class="actions"><button onclick="closeModal()">Cancel</button>
  <button class="primary" id="gsGo">Generate</button></div>`);
  api("GET", `/api/projects/${PID}/bible`).then(b =>
    $("#gsBible").textContent = b.docs.length ? b.docs.join(", ") : "none uploaded yet");
};

document.addEventListener("change", async (e) => {
  if (e.target.id !== "gsUpload") return;
  for (const f of e.target.files) {
    const fd = new FormData(); fd.append("file", f);
    await fetch(`/api/projects/${PID}/upload?path=bible`, { method: "POST", body: fd });
  }
  const b = await api("GET", `/api/projects/${PID}/bible`);
  $("#gsBible").textContent = b.docs.join(", ");
  toast("Uploaded");
});

document.addEventListener("click", async (e) => {
  if (e.target.id !== "gsGo") return;
  await busy(e.target, async () => {
    const r = await api("POST", `/api/projects/${PID}/ai/story`, { idea: $("#gsIdea").value });
    closeModal(); toast(`Story generated: ${r.chapters} chapters, ${r.scenes} scenes`);
    await refreshAll();
  });
});

$("#addChapterBtn").onclick = async () => {
  if (!PID) return;
  const title = prompt("Chapter title:"); if (!title) return;
  await api("POST", `/api/projects/${PID}/chapters`, { title });
  renderTree();
};

// ---------- editor ----------

const FIELDS = {
  project: [["title", "text"], ["logline", "area"], ["style.visual_bible", "area"]],
  chapter: [["title", "text"], ["summary", "area"]],
  scene: [["title", "text"], ["summary", "area"], ["setting", "text"],
          ["beats", "list"], ["continuity.in", "text"], ["continuity.out", "text"]],
  clip: [["action", "area"], ["camera", "text"], ["duration_seconds", "text"],
         ["image_prompt.positive", "area"], ["image_prompt.negative", "text"],
         ["video_prompt.text", "area"], ["video_prompt.negative", "text"]],
};
const getF = (o, d) => d.split(".").reduce((a, k) => (a ?? {})[k], o);
const setF = (o, d, v) => { const p = d.split("."); let c = o;
  for (const k of p.slice(0, -1)) c = c[k] = c[k] ?? {}; c[p.at(-1)] = v; };

async function openEntity(path, kind) {
  SEL = { path, kind };
  const { data, revisions } = await api("GET", `/api/projects/${PID}/entity?path=${encodeURIComponent(path)}`);
  $("#editorEmpty").style.display = "none";
  const el = $("#editorBody"); el.style.display = "block";

  let h = `<div class="crumb mono">${esc(path)}</div>
    <div class="etitle">${esc(data.title || data.action || data.id || kind)}</div>
    <div class="emeta">rev ${data.rev} · updated ${esc(data.updated_at || "")} · ${revisions.length} prior revision(s)</div>`;

  for (const [f, type] of FIELDS[kind] || []) {
    const v = getF(data, f);
    const val = type === "list" ? (v || []).join("\n") : (v ?? "");
    h += `<div class="field"><label>${f}${type === "list" ? " (one per line)" : ""}</label>` +
      (type === "area" || type === "list"
        ? `<textarea data-f="${f}" data-t="${type}" rows="${type === "list" ? 5 : 4}">${esc(val)}</textarea>`
        : `<input type="text" data-f="${f}" data-t="text" value="${esc(val)}">`) + `</div>`;
  }

  h += `<div class="actions">
    <button class="primary" id="saveBtn">💾 Save</button>
    <button id="propBtn" title="AI checks the whole story for anything this edit breaks">🔁 Save + Propagate…</button>`;
  if (kind === "scene")
    h += `<button id="clipsBtn">🎬 Generate Clips + Prompts</button>
          <button id="addClipBtn">＋ Clip</button>`;
  if (kind === "clip")
    h += `<button id="renderBtn">▶ Render</button>
          <label style="align-self:center;font-size:12px;color:var(--dim)">
          template <select id="tplSel">${CFG.templates.map(t =>
            `<option ${t.mapped ? "" : "disabled"}>${t.name}${t.mapped ? "" : " (no map)"}</option>`).join("") || "<option disabled>none in workflows/</option>"}</select></label>`;
  h += `</div>`;

  if (kind === "clip") {
    h += `<div class="prompt-box"><h4>Reference images (first one = start frame)</h4>
      <div class="refs">${(data.ref_images || []).map(r => `<img src="${fileUrl(r)}" title="${esc(r)}">`).join("")}</div>
      <input type="file" id="refUpload" accept="image/*" multiple style="margin-top:8px"></div>`;
    h += `<div class="prompt-box"><h4>Renders</h4><div id="clipRenders">`;
    for (const rid of (data.renders || []).slice().reverse()) {
      const base = path.replace(/clip\.json$/, `renders/${rid}/render.json`);
      h += `<div data-render="${base}" class="renderRow mono" style="margin-bottom:6px">${rid} …</div>`;
    }
    h += (data.renders || []).length ? "" : `<span style="color:var(--dim)">none yet</span>`;
    h += `</div></div>`;
  }
  el.innerHTML = h;
  renderTree();

  const collect = () => {
    const d = JSON.parse(JSON.stringify(data));
    el.querySelectorAll("[data-f]").forEach(inp => {
      let v = inp.value;
      if (inp.dataset.t === "list") v = v.split("\n").map(s => s.trim()).filter(Boolean);
      if (inp.dataset.f === "duration_seconds") v = parseFloat(v) || 8;
      setF(d, inp.dataset.f, v);
    });
    return d;
  };
  $("#saveBtn").onclick = (e) => busy(e.target, async () => {
    await api("PUT", `/api/projects/${PID}/entity?path=${encodeURIComponent(path)}`, { data: collect() });
    toast("Saved (rev bumped)"); openEntity(path, kind);
  });
  $("#propBtn").onclick = (e) => busy(e.target, async () => {
    await api("PUT", `/api/projects/${PID}/entity?path=${encodeURIComponent(path)}`, { data: collect() });
    const note = prompt("Optional note about what you changed (helps the AI):") || "";
    const prop = await api("POST", `/api/projects/${PID}/ai/propagate`, { path, note });
    toast(`Proposal ready: ${prop.items.length} suggested change(s) — see Proposals panel`);
    await refreshAll();
  });
  if (kind === "scene") {
    const ids = path.match(/chapters\/(.+?)\/scenes\/(.+?)\//);
    $("#clipsBtn").onclick = (e) => busy(e.target, async () => {
      const r = await api("POST", `/api/projects/${PID}/ai/clips`, { chapter_id: ids[1], scene_id: ids[2] });
      toast(`${r.clips.length} clips generated with prompts`); await refreshAll();
    });
    $("#addClipBtn").onclick = async () => {
      await api("POST", `/api/projects/${PID}/clips`, { chapter_id: ids[1], scene_id: ids[2], action: prompt("Clip action:") || "" });
      renderTree();
    };
  }
  if (kind === "clip") {
    $("#refUpload").onchange = async (e2) => {
      const dir = path.replace(/clip\.json$/, "refs");
      const d = collect();
      for (const f of e2.target.files) {
        const fd = new FormData(); fd.append("file", f);
        const r = await (await fetch(`/api/projects/${PID}/upload?path=${encodeURIComponent(dir)}`, { method: "POST", body: fd })).json();
        d.ref_images = d.ref_images || []; d.ref_images.push(r.path.replace(/^.*?(chapters\/)/, "$1"));
      }
      // ref paths are project-relative already (dir is project-relative)
      await api("PUT", `/api/projects/${PID}/entity?path=${encodeURIComponent(path)}`, { data: d, summary: "ref images added" });
      openEntity(path, kind);
    };
    $("#renderBtn").onclick = (e2) => busy(e2.target, async () => {
      const tpl = $("#tplSel").value;
      if (!tpl) throw new Error("No mapped workflow template — see workflows/README.md");
      await api("POST", `/api/projects/${PID}/render`, { clip_path: path, template: tpl });
      toast("Queued to ComfyUI"); openEntity(path, kind); startPolling();
    });
    el.querySelectorAll(".renderRow").forEach(row => refreshRenderRow(row));
  }
}

async function refreshRenderRow(row) {
  const rp = row.dataset.render;
  try {
    const { data } = await api("GET", `/api/projects/${PID}/entity?path=${encodeURIComponent(rp)}`);
    let h = `<b>${data.id}</b> · ${data.status} · seed ${data.seed}`;
    if (data.status === "failed") h += ` <span style="color:var(--bad)">${esc(data.error || "")}</span>`;
    if (data.status === "done" && data.output) {
      const out = rp.replace(/render\.json$/, data.output);
      h += `<br><video controls preload="metadata" src="${fileUrl(out)}"></video>`;
    }
    row.innerHTML = h;
  } catch { /* render row vanished */ }
}

// ---------- polling active renders ----------

function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(async () => {
    if (!PID) return;
    const rows = document.querySelectorAll(".renderRow");
    let active = false;
    for (const row of rows) {
      const rp = row.dataset.render;
      try {
        const r = await api("POST", `/api/projects/${PID}/render/poll?render_path=${encodeURIComponent(rp)}`);
        if (["queued", "running"].includes(r.status)) active = true;
        else refreshRenderRow(row);
      } catch { }
    }
    renderRenders();
    if (!active) { clearInterval(pollTimer); pollTimer = null; renderTree(); }
  }, 4000);
}

// ---------- side panels ----------

document.querySelectorAll(".side-tabs button").forEach(b => b.onclick = () => {
  document.querySelectorAll(".side-tabs button").forEach(x => x.classList.remove("active"));
  b.classList.add("active");
  $("#sideProposals").style.display = b.dataset.tab === "proposals" ? "" : "none";
  $("#sideRenders").style.display = b.dataset.tab === "renders" ? "" : "none";
});

async function renderProposals() {
  const props = await api("GET", `/api/projects/${PID}/proposals`);
  const open = props.filter(p => p.status === "pending").reverse();
  let h = open.length ? "" : `<div style="color:var(--dim);padding:8px">No pending proposals.<br>Edit something and hit 🔁 Save + Propagate.</div>`;
  for (const p of open) {
    for (let i = 0; i < p.items.length; i++) {
      const it = p.items[i];
      if (it.status !== "pending") continue;
      h += `<div class="card">
        <div class="mono" style="color:var(--dim)">${esc(it.path)} · ${esc(it.field)}</div>
        <div class="why">${esc(it.reason)}</div>
        <div class="diff-old">${esc(short(it.old_value))}</div>
        <div class="diff-new">${esc(short(it.new_value))}</div>
        <div class="actions" style="margin:8px 0 0">
          <button class="small primary" data-prop="proposals/${p.id}.json" data-i="${i}" data-a="1">✓ Accept</button>
          <button class="small" data-prop="proposals/${p.id}.json" data-i="${i}" data-a="0">✗ Reject</button>
        </div></div>`;
    }
  }
  $("#sideProposals").innerHTML = h;
  $("#sideProposals").querySelectorAll("button[data-prop]").forEach(b => b.onclick = () => busy(b, async () => {
    await api("POST", `/api/projects/${PID}/proposals/resolve`,
      { proposal: b.dataset.prop, item_index: +b.dataset.i, accept: b.dataset.a === "1" });
    await refreshAll();
  }));
}
const short = (v) => { const s = typeof v === "string" ? v : JSON.stringify(v); return s && s.length > 400 ? s.slice(0, 400) + "…" : s; };

async function renderRenders() {
  if (!PID) return;
  const hist = await api("GET", `/api/projects/${PID}/history`);
  const rows = hist.filter(e => /renders\/r\d+\/render\.json$/.test(e.path)).slice(0, 25);
  $("#sideRenders").innerHTML = rows.map(e =>
    `<div class="card mono" style="font-size:11px">${esc(e.ts)}<br>${esc(e.summary)}</div>`).join("")
    || `<div style="color:var(--dim);padding:8px">No renders yet.</div>`;
}

$("#historyBtn").onclick = async () => {
  if (!PID) return;
  const hist = await api("GET", `/api/projects/${PID}/history`);
  modal(`<h3>🕘 History</h3>` + hist.slice(0, 100).map(e =>
    `<div class="card mono" style="font-size:11px"><b>${esc(e.ts)}</b> rev ${e.rev}<br>${esc(e.path)}<br>${esc(e.summary)}</div>`).join("")
    + `<div class="actions"><button onclick="closeModal()">Close</button></div>`);
};

window.closeModal = closeModal;
boot().catch(e => toast(e.message, true));
