/* Urban design photo study — single-page survey for Prolific.
 * Parts: U1 (multi-select boxes + "None"), U2 (one objective letter per box), U3 (multi-select boxes, Before only).
 * No answer key is ever loaded by this page. */
(() => {
  "use strict";

  const CFG = window.STUDY_CONFIG || {};
  const PARTS = ["U1", "U2", "U3"];
  const params = new URLSearchParams(location.search);
  // One link per study: ?study=U1-S1 (set 1 = questions 1-25 ... set 4 = 76-100). ?part=U1&set=1 (or &batch=1) also works.
  const studyMatch = (params.get("study") || "").trim().toUpperCase().match(/^(U[1-3])-S(\d+)$/);
  const part = studyMatch ? studyMatch[1] : (params.get("part") || "").toUpperCase();
  const batchParam = (studyMatch ? studyMatch[2] : params.get("set") || params.get("batch") || "").replace(/^S/i, "");
  const idsParam = params.get("ids");
  const pid = (params.get("PROLIFIC_PID") || "").trim();
  const studyId = params.get("STUDY_ID") || "";
  const sessionId = params.get("SESSION_ID") || "";
  const preview = !pid;
  const batchKey = idsParam ? "custom" : batchParam ? `S${batchParam}` : ""; // "S1".."S4"
  const setName = `${part}-${batchKey}`; // "U1-S1"
  const storeKey = `t1study:v1:${part}:${batchKey}:${idsParam || ""}:${pid || "preview"}`;
  const app = document.getElementById("app");

  let DATA = null; // part json
  let byId = {};
  let EX = null; // sample question for this part (data/examples.json), or null
  let S = null; // persisted state
  let cur = null; // current question object
  let timer = { id: null, t0: null };

  // ------------------------------------------------------------------ helpers
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "html") el.innerHTML = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const c of children.flat(Infinity)) {
      if (c == null || c === false) continue;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }
  const nowIso = () => new Date().toISOString();
  const r1 = (x) => Math.round(x * 10) / 10;

  function persist() {
    if (!S) return;
    try { localStorage.setItem(storeKey, JSON.stringify(S)); } catch (e) { /* storage may be blocked */ }
  }
  function restore() {
    try { return JSON.parse(localStorage.getItem(storeKey) || "null"); } catch (e) { return null; }
  }

  // Plain text -> paragraphs, "- " bullet lists, and an "Example" box. Text is never interpreted as HTML.
  function richText(str, opts = {}) {
    const wrap = h("div", { class: "richtext" });
    str.split(/\n\s*\n/).forEach((para, pi) => {
      const lines = para.split("\n");
      const isExample = /^Example\b/.test(lines[0]);
      const box = isExample ? h("div", { class: "example" }) : wrap;
      let p = null, ul = null;
      for (const line of lines) {
        if (/^- /.test(line)) {
          p = null;
          if (!ul) { ul = h("ul"); box.append(ul); }
          ul.append(h("li", null, line.slice(2)));
        } else {
          ul = null;
          if (!p) { p = h("p", { class: pi === 0 && opts.lead ? "lead" : null }); box.append(p); }
          else p.append(h("br"));
          p.append(line);
        }
      }
      if (isExample) { const last = box.lastChild; if (last && last.tagName === "P") last.style.margin = "0"; wrap.append(box); }
    });
    return wrap;
  }

  function seededShuffle(arr, seedStr) {
    let s = 0;
    for (const ch of seedStr) s = (Math.imul(s, 31) + ch.charCodeAt(0)) | 0;
    const rand = () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  function ribbon() {
    return preview ? h("div", { class: "preview-ribbon" }, "Preview mode: no Prolific ID in the link. ",
      CFG.save && CFG.save.savePreview ? "Answers WILL be sent to the server." : "Answers are not sent to the server.") : null;
  }
  function setScreen(...nodes) {
    closeOverlays();
    app.replaceChildren(...nodes.filter(Boolean));
    window.scrollTo(0, 0);
  }
  function fatal(msg, detail) {
    setScreen(h("div", { class: "screen-center" }, h("div", { class: "card" },
      h("h1", null, "Something went wrong"),
      h("p", null, msg),
      detail ? h("p", { class: "notice warn" }, detail) : null,
      h("p", null, "If you came from Prolific, please send the researcher a message on Prolific."))));
  }

  // ------------------------------------------------------------------ answers
  function ans(id) {
    if (!S.answers[id]) S.answers[id] = { boxes: [], none: false, map: {} };
    return S.answers[id];
  }
  function finalAnswer(q) {
    const a = ans(q.id);
    if (part === "U2") { const out = {}; for (const b of q.boxes) if (a.map[b]) out[String(b)] = a.map[b]; return out; }
    if (part === "U1" && a.none) return [];
    return a.boxes.slice().sort((x, y) => x - y);
  }
  function isValid(q) {
    const a = ans(q.id);
    if (part === "U2") return q.boxes.every((b) => a.map[b]);
    if (part === "U1") return a.none || a.boxes.length > 0;
    return a.boxes.length > 0;
  }

  // ------------------------------------------------------------------ timing (active, visible time only)
  function timerStart(id) { timer = { id, t0: document.hidden ? null : performance.now() }; }
  function timerFlush() {
    if (timer.id && timer.t0 != null) {
      S.seconds[timer.id] = (S.seconds[timer.id] || 0) + (performance.now() - timer.t0) / 1000;
      timer.t0 = document.hidden ? null : performance.now();
    }
  }
  function timerStop() { timerFlush(); timer = { id: null, t0: null }; }
  document.addEventListener("visibilitychange", () => {
    if (!timer.id) return;
    if (document.hidden) { timerFlush(); timer.t0 = null; persist(); } else timer.t0 = performance.now();
  });
  window.addEventListener("pagehide", () => { timerFlush(); persist(); });

  // ------------------------------------------------------------------ boot
  async function boot() {
    if (params.has("reset")) { try { localStorage.removeItem(storeKey); } catch (e) { /* ignore */ } }
    if (!PARTS.includes(part)) return fatal("This study link is incomplete.", "The link does not say which part of the study to show.");
    try {
      const res = await fetch(`${CFG.dataBase || "data/"}${part.toLowerCase()}.json?v=1`, { cache: "no-cache" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      DATA = await res.json();
    } catch (e) {
      return fatal("The study questions could not be loaded. Please check your connection and reload the page.", String(e));
    }
    byId = Object.fromEntries(DATA.questions.map((q) => [q.id, q]));
    if (CFG.showExample !== false) {
      try {
        const r = await fetch(`${CFG.dataBase || "data/"}examples.json?v=1`, { cache: "no-cache" });
        if (r.ok) { const all = await r.json(); if (all[part]) EX = { ...all[part], id: "__sample" }; }
      } catch (e) { /* the study still runs without the sample question */ }
    }

    let ids;
    if (idsParam) ids = idsParam.split(",").map((s) => s.trim()).filter(Boolean);
    else if (batchParam && DATA.batches[+batchParam - 1]) ids = DATA.batches[+batchParam - 1];
    else return fatal("This study link is incomplete.", "The link does not say which set of questions to show.");
    const unknown = ids.filter((id) => !byId[id]);
    if (unknown.length) return fatal("This study link is not valid.", `Unknown question ids for ${part}: ${unknown.join(", ")}`);

    const saved = restore();
    if (saved && saved.ids && saved.ids.join() === ids.join()) S = saved;
    else {
      S = {
        ids, order: CFG.shuffleQuestions && pid ? seededShuffle(ids, pid + part + batchKey) : ids.slice(),
        screen: "welcome", index: 0, answers: {}, seconds: {}, submittedAt: {}, layouts: {}, boxIdx: {}, imgErrors: {},
        startedAt: null, finishedAt: null, saved: false, consent: false,
        previewId: preview ? Math.random().toString(36).slice(2, 8) : null,
      };
    }
    const jump = parseInt(params.get("q"), 10);
    if (preview && jump >= 1 && jump <= S.order.length) { S.screen = "question"; S.index = jump - 1; S.startedAt = S.startedAt || nowIso(); }
    if (preview && params.get("q") === "0" && EX) { S.screen = "example"; S.index = 0; S.startedAt = S.startedAt || nowIso(); }
    route();
  }

  function route() {
    if (S.screen === "question") showQuestion(S.index);
    else if (S.screen === "instructions") { if (EX) showExample(); else showInstructions(); }
    else if (S.screen === "example") showExample();
    else if (S.screen === "finish") showFinish();
    else showWelcome();
  }

  // ------------------------------------------------------------------ welcome & instructions
  function showWelcome() {
    S.screen = "welcome"; persist();
    const n = S.order.length;
    const narrow = window.innerWidth < (CFG.minViewportWidth || 1000);
    const start = h("button", { class: "btn primary", disabled: CFG.consentHtml && !S.consent ? true : null, onclick: () => (EX ? showExample() : showInstructions()) }, "Start");
    const consent = CFG.consentHtml ? [
      h("div", { class: "consent", html: CFG.consentHtml }),
      h("label", { class: "consent-check" },
        h("input", { type: "checkbox", checked: S.consent ? true : null, onchange: (e) => { S.consent = e.target.checked; start.disabled = !S.consent; persist(); } }),
        h("span", null, "I have read the information above and agree to take part.")),
    ] : null;
    setScreen(ribbon(), h("div", { class: "screen-center" }, h("div", { class: "card" },
      h("div", { class: "kicker" }, `Part ${part.slice(1)}`),
      h("h1", null, CFG.title || "Study"),
      narrow ? h("p", { class: "notice warn" }, "This study needs a computer screen. Please use a laptop or desktop computer, or make this window wider.") : null,
      h("p", { style: "margin-top:16px" }, CFG.welcome.intro),
      h("p", null, CFG.welcome.task[part]),
      h("p", null, `There ${n === 1 ? "is 1 question" : `are ${n} questions`}. ${CFG.welcome.closing}`),
      consent,
      h("div", { class: "actions" }, start))));
  }

  function showInstructions() {
    S.screen = "instructions"; persist();
    setScreen(ribbon(), h("div", { class: "screen-center" }, h("div", { class: "card" },
      h("div", { class: "kicker" }, "Instructions"),
      richText(DATA.instructions, { lead: true }),
      h("p", { class: "notice info" }, "You can reopen these instructions at any time with the Instructions button at the top of each question. Click a photo to see it larger."),
      h("div", { class: "actions" },
        h("button", { class: "btn", onclick: () => showWelcome() }, "Back"),
        h("button", { class: "btn primary", onclick: () => { S.startedAt = S.startedAt || nowIso(); if (EX) showExample(); else showQuestion(S.index || 0); } },
          EX ? "Next: sample question" : "Begin")))));
  }

  function openInstructionsModal() {
    const close = () => ov.remove();
    const ov = h("div", { class: "overlay modal", onclick: (e) => { if (e.target === ov) close(); } },
      h("div", { class: "card", role: "dialog", "aria-modal": "true", "aria-label": "Instructions" },
        h("div", { class: "kicker" }, "Instructions"),
        richText(DATA.instructions, { lead: true }),
        h("div", { class: "actions" },
          EX ? h("button", { class: "btn", onclick: () => { close(); openExampleModal(); } }, "See the sample question") : null,
          h("button", { class: "btn primary", onclick: close }, "Close"))));
    document.body.append(ov);
    ov.querySelector("button").focus();
  }
  function closeOverlays() { document.querySelectorAll(".overlay").forEach((o) => o.remove()); }

  // ------------------------------------------------------------------ question screen
  function showQuestion(i) {
    timerStop();
    S.screen = "question"; S.index = i; persist();
    cur = byId[S.order[i]];
    const q = cur;
    const n = S.order.length;
    if (part === "U2" && S.boxIdx[q.id] == null) S.boxIdx[q.id] = 0;

    const topbar = h("header", { class: "topbar" },
      h("span", { class: "count" }, `Question ${i + 1} of ${n}`),
      h("div", { class: "progress", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": String(n), "aria-valuenow": String(i) },
        h("span", { style: `width:${(i / n) * 100}%` })),
      h("span", { class: "spacer" }),
      h("span", { class: "ref", title: "Question reference" }, `Ref ${q.id}`),
      h("button", { class: "btn small", onclick: openInstructionsModal }, "Instructions"));

    const stage = buildStage(q);
    const panel = h("aside", { class: "panel" },
      h("div", { class: "panel-scroll", id: "panel-scroll" }, buildText(q), h("div", { id: "answer" })),
      h("footer", { class: "panel-foot" },
        h("button", { class: "btn", id: "btn-back", onclick: goBack }, "Back"),
        h("span", { class: "hint", id: "hint", "aria-live": "polite" }),
        h("button", { class: "btn primary", id: "btn-next", onclick: goNext }, i === n - 1 ? "Finish" : "Next")));

    setScreen(h("div", { class: "qscreen" }, ribbon(), topbar, h("main", { class: "qmain" }, stage, panel)));
    renderAnswer();
    layoutStage(); // size the photos immediately (the DOM is attached), then once more after the first paint
    requestAnimationFrame(layoutStage);
    timerStart(q.id);
    preload(S.order[i + 1]);
  }

  // U1 briefs = scene description + the project's goal as the last sentence (checked on all 100: the goal is
  // everything after the last ". "; abbreviations such as "St." only occur earlier, in the scene description).
  function splitGoal(brief) {
    const t = brief.trim(), core = t.endsWith(".") ? t.slice(0, -1) : t, i = core.lastIndexOf(". ");
    return i < 0 ? ["", t] : [t.slice(0, i + 1), t.slice(i + 2)];
  }
  function briefNodes(q) {
    const out = [h("div", { class: "brief-label" }, "Project brief:")];
    const m = part === "U3" ? q.brief.match(/^([\s\S]*?)\s*Objective for this question: ([\s\S]*)$/) : null;
    if (m) {
      out.push(h("p", { class: "brief" }, m[1]),
        h("div", { class: "objective-callout" }, h("span", { class: "k" }, "Objective for this question:"), h("span", { class: "v" }, m[2])));
    } else if (part === "U1") {
      const [scene, goal] = splitGoal(q.brief);
      out.push(h("p", { class: "brief" }, scene ? [scene, h("br")] : null, h("strong", { class: "goal" }, goal)));
    } else out.push(h("p", { class: "brief" }, q.brief));
    return out;
  }
  // The question paragraph (identical for every question of a part) is split into the photo description, shown first
  // under "About the photos", and the question itself, shown after the brief. U2's three answer rules become a list.
  const sentences = (t) => t.replace(/\.\s+(?=[A-Z])/g, ".\n").split("\n").map((x) => x.trim()).filter(Boolean);
  function splitPrompt(prompt) {
    const k = prompt.search(/Which marked regions|Assign each marked region/);
    return { photo: k > 0 ? prompt.slice(0, k).split("\n").flatMap(sentences) : [], ask: k >= 0 ? prompt.slice(k).trim() : prompt };
  }
  function fold(cls, title, body, open) {
    return h("details", { class: `fold ${cls}`, open: open ? true : null }, h("summary", null, title), h("div", { class: "fold-body" }, body));
  }
  function askNode(ask) { // "... Select all that apply." -> the last sentence in bold, with "all" in italics
    const m = ask.match(/^([\s\S]*?)\s*Select all that apply\.$/);
    return h("p", { class: "ask" }, m ? `${m[1]} ` : ask, m ? h("strong", null, "Select ", h("em", null, "all"), " that apply.") : null);
  }
  function buildText(q, full) {
    const { photo, ask } = splitPrompt(q.prompt);
    const open = full || S.index < (CFG.collapseAfter == null ? 5 : CFG.collapseAfter); // open on the first N questions
    const frag = document.createDocumentFragment();
    if (photo.length) frag.append(fold("photo-notes", "About the photos", photo.map((t) => h("p", null, t)), open));
    frag.append(...briefNodes(q));
    if (part === "U2") frag.append(fold("how-box", "How to answer", h("ol", null, sentences(ask).map((t) => h("li", null, t))), open));
    else frag.append(askNode(ask));
    return frag;
  }

  // ----- images
  function buildStage(q) {
    const imgs = q.after
      ? [{ src: q.before, size: q.before_size, cap: "Image 1: BEFORE" }, { src: q.after, size: q.after_size, cap: "Image 2: AFTER" }]
      : [{ src: q.before, size: q.before_size, cap: "BEFORE" }];
    const stage = h("section", { class: "stage", id: "stage", "data-mode": imgs.length === 2 ? "stacked" : "single" });
    for (const im of imgs) {
      const box = h("div", { class: "imgbox loading", "data-w": (im.size || [4, 3])[0], "data-h": (im.size || [4, 3])[1] });
      const img = h("img", { alt: `${im.cap} photo with numbered boxes`, draggable: "false" });
      img.addEventListener("load", () => {
        box.classList.remove("loading");
        if (!im.size) { box.dataset.w = img.naturalWidth; box.dataset.h = img.naturalHeight; layoutStage(); }
      });
      img.addEventListener("error", () => {
        box.classList.remove("loading");
        S.imgErrors[q.id] = (S.imgErrors[q.id] || 0) + 1; persist();
        const err = h("div", { class: "img-error" }, "This photo did not load.",
          h("button", { class: "btn small", onclick: (e) => { e.stopPropagation(); err.remove(); box.classList.add("loading"); img.src = `${im.src}?retry=${Date.now()}`; } }, "Try again"));
        box.append(err);
      });
      img.src = im.src;
      box.append(img);
      box.addEventListener("click", () => openLightbox(im.src, im.cap));
      stage.append(h("figure", { class: "pic" }, h("figcaption", null, im.cap, h("span", { class: "zoom-hint" }, "click to enlarge")), box));
    }
    return stage;
  }

  function layoutStage() {
    const stage = document.getElementById("stage");
    if (!stage || !cur) return;
    const boxes = [...stage.querySelectorAll(".imgbox")];
    const sz = boxes.map((b) => [+b.dataset.w, +b.dataset.h]);
    const cs = getComputedStyle(stage);
    const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    const qmain = stage.parentElement;
    const narrow = window.innerWidth < 900; // panel sits below the photos; height is not the limit
    // Photo area width assuming the default panel width; any width the photos cannot use goes to the panel below.
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    // Default panel width (grows with the text size), and the most it may take when the photos leave room.
    const P0 = Math.min(40 * rem, Math.max(24 * rem, qmain.clientWidth * 0.38)), PMAX = 46 * rem;
    const W = narrow ? stage.clientWidth - padX : qmain.clientWidth - P0 - padX;
    const H = narrow ? Infinity : stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    const GAP = parseFloat(cs.rowGap) || 10, CAP = 1.625 * rem, CAPW = 1.625 * rem, MAX_SCALE = 2; // caption above (CAP tall) or beside (CAPW wide)
    const [a, b] = sz;
    // Side by side vs one above the other (squarish vs wide photos), captions above vs beside: take whichever shows the
    // photos largest; captions stay above unless moving them beside gains more than 2%.
    const cands = sz.length === 1 ? [
      { mode: "single", cap: "top", s: Math.min(W / a[0], (H - CAP) / a[1]) },
      { mode: "single", cap: "left", s: Math.min((W - CAPW) / a[0], H / a[1]) },
    ] : [
      { mode: "side", cap: "top", s: Math.min((W - GAP) / (a[0] + b[0]), (H - CAP) / Math.max(a[1], b[1])) },
      { mode: "side", cap: "left", s: Math.min((W - GAP - 2 * CAPW) / (a[0] + b[0]), H / Math.max(a[1], b[1])) },
      { mode: "stacked", cap: "top", s: Math.min(W / Math.max(a[0], b[0]), (H - 2 * CAP - GAP) / (a[1] + b[1])) },
      { mode: "stacked", cap: "left", s: Math.min((W - CAPW) / Math.max(a[0], b[0]), (H - GAP) / (a[1] + b[1])) },
    ];
    const maxS = Math.max(...cands.map((c) => c.s));
    const best = cands.find((c) => c.cap === "top" && c.s >= maxS * 0.98) || cands.find((c) => c.s === maxS);
    const mode = best.mode, scale = Math.max(0.05, Math.min(best.s, MAX_SCALE));
    stage.dataset.mode = mode;
    stage.dataset.cap = best.cap;
    boxes.forEach((bx, k) => { bx.style.width = `${Math.floor(sz[k][0] * scale)}px`; bx.style.height = `${Math.floor(sz[k][1] * scale)}px`; });
    if (narrow) qmain.style.gridTemplateColumns = "";
    else {
      const capw = best.cap === "left" ? CAPW : 0;
      const used = mode === "side" ? Math.ceil((a[0] + b[0]) * scale) + GAP + 2 * capw : Math.ceil(Math.max(...sz.map((x) => x[0])) * scale) + capw;
      const panel = Math.round(Math.min(PMAX, P0 + Math.max(0, W - used - 8)));
      qmain.style.gridTemplateColumns = `minmax(0, 1fr) ${panel}px`;
    }
    if (S.layouts[cur.id] !== mode) { S.layouts[cur.id] = mode; persist(); }
  }
  let resizeRaf = 0;
  window.addEventListener("resize", () => { cancelAnimationFrame(resizeRaf); resizeRaf = requestAnimationFrame(layoutStage); });

  function preload(id) {
    const q = id && byId[id];
    if (!q) return;
    [q.before, q.after].filter(Boolean).forEach((src) => { const im = new Image(); im.src = src; });
  }

  function openLightbox(src, cap) {
    const ov = h("div", { class: "overlay lightbox", role: "dialog", "aria-label": cap, onclick: () => ov.remove() },
      h("figure", null, h("img", { src, alt: cap }), h("figcaption", null, `${cap} — click anywhere or press Esc to close`)));
    document.body.append(ov);
  }

  // ----- answer area
  function renderAnswer() {
    const q = cur;
    const box = document.getElementById("answer");
    if (!box) return;
    box.replaceChildren(part === "U2" ? renderAssign(q) : renderMulti(q));
    updateFooter();
  }

  function renderMulti(q) {
    const a = ans(q.id);
    const frag = document.createDocumentFragment();
    frag.append(h("div", { class: "ans-head" }, locked() ? "Correct answer " : "Your answer ",
      h("span", { class: "ans-sub" }, part === "U3" ? "· select all boxes that apply (at least one)" : "· select all that apply")));
    const grid = h("div", { class: "boxgrid", role: "group", "aria-label": "Boxes" });
    for (const b of q.boxes) {
      grid.append(h("label", { class: "chip" },
        h("input", { type: "checkbox", value: String(b), checked: a.boxes.includes(b) ? true : null, disabled: locked() ? true : null, onchange: (e) => toggleBox(b, e.target.checked) }),
        h("span", null, `Box ${b}`)));
    }
    frag.append(grid);
    if (part === "U1") {
      frag.append(h("label", { class: "chip none" },
        h("input", { type: "checkbox", value: "none", checked: a.none ? true : null, disabled: locked() ? true : null, onchange: (e) => toggleNone(e.target.checked) }),
        h("span", null, "None of the boxes")));
    }
    if (!locked()) frag.append(h("p", { class: "kbd-hint" }, "Keyboard: ", h("kbd", null, "1"), "–", h("kbd", null, String(Math.min(9, q.boxes.length))),
      " toggle boxes", q.boxes.includes(10) ? [", ", h("kbd", null, "0"), " = Box 10"] : null,
      part === "U1" ? [", ", h("kbd", null, "N"), " = none"] : null, ", ", h("kbd", null, "Enter"), " = next"));
    return frag;
  }
  function toggleBox(b, on) {
    const a = ans(cur.id);
    a.boxes = a.boxes.filter((x) => x !== b);
    if (on) { a.boxes.push(b); a.none = false; }
    persist(); renderAnswer();
  }
  function toggleNone(on) {
    const a = ans(cur.id);
    a.none = on;
    if (on) a.boxes = [];
    persist(); renderAnswer();
  }

  function renderAssign(q) {
    const a = ans(q.id);
    const k = Math.min(S.boxIdx[q.id] || 0, q.boxes.length - 1);
    const b = q.boxes[k];
    const frag = document.createDocumentFragment();
    frag.append(h("div", { class: "ans-head" }, locked() ? "Correct answer " : "Your answer ", h("span", { class: "ans-sub" }, "· choose one of the objectives for every box")));
    const strip = h("div", { class: "boxstrip", role: "tablist", "aria-label": "Boxes" });
    q.boxes.forEach((bb, j) => {
      strip.append(h("button", {
        class: `bchip${a.map[bb] ? " answered" : ""}${j === k ? " current" : ""}`, role: "tab", "aria-selected": j === k ? "true" : "false",
        title: a.map[bb] ? `Box ${bb}: ${a.map[bb]}` : `Box ${bb}: not answered`, onclick: () => gotoBox(j),
      }, h("span", { class: "n" }, `Box ${bb}`), h("span", { class: "v" }, a.map[bb] || "–")));
    });
    frag.append(strip);
    const opts = h("div", { class: "opts", role: "radiogroup", "aria-label": `Objective for box ${b}` });
    for (const o of q.options) {
      const text = o.label.replace(/^[A-Z]\.\s*/, "");
      const special = /^(No change here|Not a documented objective)\.?$/.test(text);
      opts.append(h("label", { class: `opt${special ? " special" : ""}` },
        h("input", { type: "radio", name: `box-${q.id}`, value: o.value, checked: a.map[b] === o.value ? true : null, disabled: locked() ? true : null, onchange: () => assign(o.value) }),
        h("span", null, h("span", { class: "letter" }, o.value), h("span", { class: "txt" }, text))));
    }
    const card = h("div", { class: "boxq", id: "boxq" },
      h("div", { class: "boxq-title" },
        h("span", { class: "big" }, `Box ${b}`), h("span", { class: "of" }, `${k + 1} of ${q.boxes.length}`),
        h("span", { class: "nav" },
          h("button", { class: "btn small ghost", disabled: k === 0 ? true : null, onclick: () => gotoBox(k - 1), "aria-label": "Previous box" }, "‹ Prev box"),
          h("button", { class: "btn small ghost", disabled: k === q.boxes.length - 1 ? true : null, onclick: () => gotoBox(k + 1), "aria-label": "Next box" }, "Next box ›"))),
      opts);
    frag.append(card);
    const last = q.options[q.options.length - 1].value;
    if (!locked()) frag.append(h("p", { class: "kbd-hint" }, "Keyboard: ", h("kbd", null, "A"), "–", h("kbd", null, last), " choose, ",
      h("kbd", null, "←"), " ", h("kbd", null, "→"), " switch box, ", h("kbd", null, "Enter"), " = next question"));
    return frag;
  }
  function gotoBox(j, flash = true) {
    const q = cur;
    S.boxIdx[q.id] = Math.max(0, Math.min(j, q.boxes.length - 1));
    persist(); renderAnswer();
    if (flash) { const c = document.getElementById("boxq"); if (c) c.classList.add("flash"); }
  }
  let advanceTimer = 0;
  function assign(letter) {
    const q = cur, a = ans(q.id);
    const k = S.boxIdx[q.id] || 0;
    a.map[q.boxes[k]] = letter;
    persist(); renderAnswer();
    // Move on to the next unanswered box (looking forward first, then from the start).
    clearTimeout(advanceTimer);
    const order = [...q.boxes.keys()].slice(k + 1).concat([...q.boxes.keys()].slice(0, k));
    const nextK = order.find((j) => !a.map[q.boxes[j]]);
    if (nextK != null) advanceTimer = setTimeout(() => { if (cur === q) gotoBox(nextK); }, 260);
    else setTimeout(() => { const nb = document.getElementById("btn-next"); if (nb && cur === q) nb.focus(); }, 0);
  }

  function updateFooter() {
    const q = cur, a = ans(q.id);
    const hint = document.getElementById("hint"), next = document.getElementById("btn-next");
    if (!hint || !next) return;
    if (locked()) {
      next.disabled = false; // stays clickable so a click can point to the confirmation box
      next.classList.toggle("is-disabled", !S.sampleConfirmed);
      hint.classList.remove("done");
      hint.textContent = S.sampleConfirmed ? "" : "Tick the confirmation at the end of the sample to continue";
      return;
    }
    const ok = isValid(q);
    next.disabled = !ok;
    hint.classList.toggle("done", ok);
    if (part === "U2") {
      const done = q.boxes.filter((b) => a.map[b]).length;
      hint.textContent = ok ? "All boxes answered" : `${done} of ${q.boxes.length} boxes answered`;
    } else if (part === "U1") {
      hint.textContent = ok ? (a.none ? "None of the boxes" : `${a.boxes.length} selected`) : "Select at least one option";
    } else {
      hint.textContent = ok ? `${a.boxes.length} selected` : "Select at least one box";
    }
  }

  function leaveQuestion() {
    clearTimeout(advanceTimer);
    timerStop();
    if (cur && isValid(cur)) S.submittedAt[cur.id] = nowIso();
    persist();
  }
  function goNext() {
    if (!cur || !isValid(cur)) return;
    leaveQuestion();
    if (S.index + 1 < S.order.length) showQuestion(S.index + 1);
    else { S.finishedAt = nowIso(); showFinish(); }
  }
  function goBack() {
    leaveQuestion();
    if (S.index > 0) showQuestion(S.index - 1);
    else { cur = null; if (EX) showExample(); else showInstructions(); }
  }

  // ------------------------------------------------------------------ sample question (worked example, answer shown)
  function locked() { return !!EX && cur === EX; } // the sample shows the correct answer; its controls are read-only
  const SPECIAL = /^(No change here|Not a documented objective)\.?$/;
  const decision = (v) => (part === "U2" ? v : v ? "Select" : "Don't select");

  // Per box: the correct answer, and whether the box is highlighted (selected in U1/U3; a listed objective in U2).
  function sampleKey(ex) {
    const special = new Set((ex.options || []).filter((o) => SPECIAL.test(o.label.replace(/^[A-Z]\.\s*/, ""))).map((o) => o.value));
    return ex.boxes.map((b) => (part === "U2"
      ? { box: b, truth: ex.answer[b], hit: !special.has(ex.answer[b]) }
      : { box: b, truth: ex.answer.includes(b), hit: ex.answer.includes(b) }));
  }

  // Green frame over the boxes that are part of the answer; the other boxes keep their yellow frame and get a grey tag.
  function addOverlays(box, ex) {
    box.querySelectorAll(".ov").forEach((o) => o.remove());
    const [W, H] = ex.before_size;
    for (const r of sampleKey(ex)) {
      const [x, y, w, hh] = ex.rects[r.box];
      box.append(h("div", { class: `ov ${r.hit ? "hit" : "miss"}`, style: `left:${((x - 2) / W) * 100}%;top:${((y - 2) / H) * 100}%;width:${((w + 4) / W) * 100}%;height:${((hh + 4) / H) * 100}%` },
        h("span", { class: "tag" }, r.hit && part !== "U2" ? `✓ ${decision(r.truth)}` : decision(r.truth))));
    }
  }

  function explainNodes(ex) {
    const key = part === "U2" ? ex.boxes.map((b) => `${b}-${ex.answer[b]}`).join(", ") : ex.answer.join(", ");
    return [
      h("div", { class: "fb-score" }, "Correct answer: ", h("span", null, key)),
      h("div", { class: "fb-list" }, sampleKey(ex).map((r) => h("div", { class: `fb-row ${r.hit ? "hit" : "miss"}` },
        h("span", { class: "fb-mark" }, part === "U2" ? r.truth : r.hit ? "✓" : "–"),
        h("div", null,
          h("div", { class: "fb-head" }, `Box ${r.box}: `,
            h("b", null, part === "U2" ? (ex.options.find((o) => o.value === r.truth) || { label: r.truth }).label : decision(r.truth))),
          h("div", { class: "fb-why" }, ex.why[r.box]))))),
      ex.rule ? h("div", { class: "fb-rule" }, h("b", null, "Rule to remember. "), ex.rule) : null, // optional per part
    ];
  }

  function showExample() {
    if (!EX) return showQuestion(S.index || 0);
    timerStop();
    S.screen = "example"; persist();
    cur = EX;
    S.startedAt = S.startedAt || nowIso();
    S.answers[EX.id] = part === "U2" ? { boxes: [], none: false, map: { ...EX.answer } } : { boxes: EX.answer.slice(), none: false, map: {} };
    if (part === "U2" && S.boxIdx[EX.id] == null) S.boxIdx[EX.id] = 0;
    const topbar = h("header", { class: "topbar" },
      h("span", { class: "count" }, "Instructions and Sample Question"),
      h("span", { class: "spacer" }),
      h("button", { class: "btn small", onclick: openInstructionsModal }, "Instructions"));
    const panel = h("aside", { class: "panel" },
      h("div", { class: "panel-scroll", id: "panel-scroll" },
        h("section", { class: "instr-block" },
          h("h2", { class: "sec-title" }, "Instructions"),
          richText(DATA.instructions, { lead: true }),
          h("p", { class: "instr-note" }, "Scroll down for a sample question with its correct answer. You can reopen these instructions at any time with the Instructions button at the top right. Click a photo to see it larger.")),
        h("h2", { class: "sec-title sample-title" }, "Sample question"),
        buildText(EX, true), h("div", { id: "answer" }), h("div", { id: "feedback" }, explainNodes(EX)),
        h("label", { class: "confirm", id: "sample-confirm" },
          h("input", { type: "checkbox", checked: S.sampleConfirmed ? true : null, onchange: (e) => {
            S.sampleConfirmed = e.target.checked; S.sampleConfirmedAt = e.target.checked ? nowIso() : null; persist(); updateFooter();
          } }),
          h("span", null, h("b", null, "Please confirm before continuing: "), "I have read and understood the examples shown in this sample question"))),
      h("footer", { class: "panel-foot" },
        h("button", { class: "btn", onclick: () => { timerStop(); persist(); cur = null; showWelcome(); } }, "Back"),
        h("span", { class: "hint", id: "hint" }),
        h("button", { class: "btn primary", id: "btn-next", onclick: exampleNext }, "Start the questions")));
    setScreen(h("div", { class: "qscreen" }, ribbon(), topbar, h("main", { class: "qmain" }, buildStage(EX), panel)));
    renderAnswer();
    document.querySelectorAll("#stage .imgbox").forEach((bx) => addOverlays(bx, EX));
    layoutStage();
    requestAnimationFrame(layoutStage);
    timerStart(EX.id);
    preload(S.order[0]);
  }

  function exampleNext() {
    if (!S.sampleConfirmed) {
      const c = document.getElementById("sample-confirm"), ps = document.getElementById("panel-scroll");
      if (c && ps) {
        ps.scrollTop += c.getBoundingClientRect().top - ps.getBoundingClientRect().top - 40;
        c.classList.remove("flash"); void c.offsetWidth; c.classList.add("flash");
        c.querySelector("input").focus();
      }
      return;
    }
    timerStop(); persist();
    showQuestion(S.index || 0);
  }

  function openExampleModal() {
    const pics = [[EX.before, EX.after ? "Image 1: BEFORE" : "BEFORE"], [EX.after, "Image 2: AFTER"]].filter((p) => p[0]);
    const close = () => ov.remove();
    const ov = h("div", { class: "overlay modal", onclick: (e) => { if (e.target === ov) close(); } },
      h("div", { class: "card wide", role: "dialog", "aria-modal": "true", "aria-label": "Sample question" },
        h("div", { class: "kicker" }, "Sample Question"),
        briefNodes(EX),
        h("div", { class: "exfigs" }, pics.map(([src, cap]) => {
          const box = h("div", { class: "imgbox", style: `aspect-ratio:${EX.before_size[0]} / ${EX.before_size[1]}` }, h("img", { src, alt: cap }));
          addOverlays(box, EX);
          return h("figure", { class: "pic" }, h("figcaption", null, cap), box);
        })),
        explainNodes(EX),
        h("div", { class: "actions" }, h("button", { class: "btn primary", onclick: close }, "Close"))));
    document.body.append(ov);
    ov.querySelector(".actions button").focus();
  }

  // ------------------------------------------------------------------ keyboard
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { closeOverlays(); return; }
    if (!S || (S.screen !== "question" && S.screen !== "example") || !cur || document.querySelector(".overlay")) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = (e.target && e.target.tagName) || "";
    if (e.key === "Enter") {
      if (tag === "BUTTON" || tag === "A") return; // native activation handles it
      e.preventDefault(); if (S.screen === "example") exampleNext(); else goNext(); return;
    }
    if (part === "U2") {
      const k = S.boxIdx[cur.id] || 0;
      if (e.key === "ArrowRight") { e.preventDefault(); gotoBox(k + 1); return; }
      if (e.key === "ArrowLeft") { e.preventDefault(); gotoBox(k - 1); return; }
      if (locked()) return;
      const L = e.key.length === 1 ? e.key.toUpperCase() : "";
      if (L && cur.options.some((o) => o.value === L)) { e.preventDefault(); assign(L); }
      return;
    }
    if (locked()) return;
    if (/^[0-9]$/.test(e.key)) {
      const b = e.key === "0" ? 10 : +e.key;
      if (cur.boxes.includes(b)) { e.preventDefault(); toggleBox(b, !ans(cur.id).boxes.includes(b)); }
    } else if (part === "U1" && e.key.toLowerCase() === "n") {
      e.preventDefault(); toggleNone(!ans(cur.id).none);
    }
  });

  // ------------------------------------------------------------------ finish & saving
  function completionCode() {
    const c = (CFG.prolific && CFG.prolific.completionCodes) || {};
    return c[setName] || c[part] || c.default || "";
  }
  function annotator() { return pid || `preview-${S.previewId}`; }
  function buildPayload() {
    const who = annotator();
    return {
      schema: "t1-human-study/v1",
      part, set: setName, batch: batchKey, ids_param: idsParam || null, annotator: who, preview,
      prolific: { PROLIFIC_PID: pid || null, STUDY_ID: studyId || null, SESSION_ID: sessionId || null },
      started_at: S.startedAt, finished_at: S.finishedAt,
      total_seconds: r1(S.order.reduce((x, id) => x + (S.seconds[id] || 0), 0)),
      sample_seconds: EX ? r1(S.seconds[EX.id] || 0) : null,
      sample_confirmed_at: S.sampleConfirmedAt || null,
      client: {
        user_agent: navigator.userAgent, viewport: [window.innerWidth, window.innerHeight],
        screen: [window.screen.width, window.screen.height], dpr: window.devicePixelRatio || 1,
      },
      question_order: S.order,
      responses: S.order.map((id, i) => ({
        annotator: who, id, answer: finalAnswer(byId[id]),
        seconds: r1(S.seconds[id] || 0), submitted_at: S.submittedAt[id] || null,
        position: i + 1, layout: S.layouts[id] || null, image_errors: S.imgErrors[id] || 0,
      })),
    };
  }
  function fileName() {
    const safe = (s) => String(s).replace(/[^A-Za-z0-9_-]/g, "");
    return `${safe(setName)}_${safe(annotator())}_${safe(sessionId || S.previewId || Date.now())}.json`;
  }

  async function sendOnce(payload) {
    const sv = CFG.save || {};
    let res;
    if (sv.method === "datapipe") {
      res = await fetch("https://pipe.jspsych.org/api/data/", {
        method: "POST", headers: { "Content-Type": "application/json", Accept: "*/*" },
        body: JSON.stringify({ experimentID: sv.datapipeExperimentId, filename: fileName(), data: JSON.stringify(payload) }),
      });
    } else if (sv.method === "post") {
      res = await fetch(sv.postUrl, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(payload) });
    } else throw new Error("Saving is not configured (config.js: save.method).");
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      // DataPipe rejects a filename it already has. Our filename is unique per session, so "already exists" means an
      // earlier attempt was stored even though its reply never reached us: count it as saved.
      if (sv.method === "datapipe" && /FILE_EXISTS|already exists/i.test(text)) return;
      throw new Error(`Server replied ${res.status}: ${text.slice(0, 200)}`);
    }
  }
  async function sendWithRetry(payload) {
    let err;
    for (const wait of [0, 1500, 4000]) {
      if (wait) await new Promise((r) => setTimeout(r, wait));
      try { await sendOnce(payload); return; } catch (e) { err = e; }
    }
    throw err;
  }

  async function showFinish() {
    timerStop(); cur = null;
    S.screen = "finish"; S.finishedAt = S.finishedAt || nowIso(); persist();
    const payload = buildPayload();
    window.__studyPayload = payload; // for the researcher's own testing
    const sendThis = !preview || (CFG.save && CFG.save.savePreview);
    if (S.saved || !sendThis) return renderDone(payload);
    setScreen(ribbon(), h("div", { class: "screen-center" }, h("div", { class: "card", style: "text-align:center" },
      h("div", { style: "display:flex;justify-content:center;margin-bottom:16px" }, h("div", { class: "spinner" })),
      h("p", null, "Saving your answers…"), h("p", { class: "notice info", style: "text-align:left" }, "Please keep this page open."))));
    try {
      await sendWithRetry(payload);
      S.saved = true; persist();
      renderDone(payload);
    } catch (e) {
      renderSaveFailed(payload, e);
    }
  }

  function downloadJson(payload) {
    const a = h("a", { href: URL.createObjectURL(new Blob([JSON.stringify(payload, null, 1)], { type: "application/json" })), download: fileName() });
    document.body.append(a); a.click(); a.remove();
  }
  function prolificBlock(code) {
    const url = (CFG.prolific && CFG.prolific.completionUrl || "") + encodeURIComponent(code);
    return [
      h("p", null, "Your completion code:"),
      h("div", { class: "code-box" }, h("span", { class: "code" }, code || "(not set)"),
        h("button", { class: "btn small", onclick: (e) => { navigator.clipboard && navigator.clipboard.writeText(code); e.target.textContent = "Copied"; } }, "Copy")),
      h("div", { class: "actions" }, h("a", { class: "btn primary", href: url }, "Return to Prolific")),
    ];
  }

  function renderDone(payload) {
    const code = completionCode();
    const secs = (CFG.prolific && CFG.prolific.autoRedirectSeconds) || 0;
    const card = h("div", { class: "card" }, h("h1", null, CFG.endText || "Thank you."));
    if (preview) {
      card.append(
        h("p", { class: "notice info" }, S.saved ? "Preview mode: answers were sent to the server." : "Preview mode: your answers were not sent anywhere. You can download them to check the output format."),
        !code || code === "REPLACE_ME" ? h("p", { class: "notice warn" }, `No completion code is set for ${setName} (config.js → prolific.completionCodes).`) : null,
        h("div", { class: "actions" },
          h("button", { class: "btn", onclick: () => downloadJson(payload) }, "Download answers (JSON)"),
          h("button", { class: "btn", onclick: () => { try { localStorage.removeItem(storeKey); } catch (e) { /* ignore */ } location.reload(); } }, "Start again")));
    } else {
      card.append(h("p", { class: "notice ok" }, "Your answers have been saved."), ...prolificBlock(code));
      if (secs > 0 && code) {
        const note = h("p", { style: "color:var(--muted);font-size:13.5px;margin-top:14px;text-align:right" });
        card.append(note);
        let left = secs;
        const tick = () => {
          if (!document.body.contains(note)) return;
          if (left <= 0) { location.href = (CFG.prolific.completionUrl || "") + encodeURIComponent(code); return; }
          note.textContent = `Returning you to Prolific in ${left} s…`; left -= 1; setTimeout(tick, 1000);
        };
        tick();
      }
    }
    setScreen(ribbon(), h("div", { class: "screen-center" }, card));
  }

  function renderSaveFailed(payload, err) {
    const code = completionCode();
    const blob = JSON.stringify(payload);
    setScreen(ribbon(), h("div", { class: "screen-center" }, h("div", { class: "card" },
      h("h1", null, "Your answers could not be saved automatically"),
      h("p", { class: "notice warn" }, String(err && err.message || err)),
      h("div", { class: "actions", style: "justify-content:flex-start;margin-top:0" },
        h("button", { class: "btn primary", onclick: () => showFinish() }, "Try again")),
      h("p", { style: "margin-top:18px" }, "If trying again does not work, copy the text below and send it to the researcher in a Prolific message. Then return to Prolific with the completion code."),
      h("textarea", { class: "fallback-data", readonly: true, onclick: (e) => e.target.select() }, blob),
      h("div", { class: "actions", style: "justify-content:flex-start;margin-top:8px" },
        h("button", { class: "btn small", onclick: (e) => { navigator.clipboard && navigator.clipboard.writeText(blob); e.target.textContent = "Copied"; } }, "Copy answers")),
      ...(preview ? [] : prolificBlock(code)))));
  }

  // expose read-only hooks for the researcher's own testing
  window.__study = { state: () => S, payload: () => buildPayload() };
  boot();
})();
