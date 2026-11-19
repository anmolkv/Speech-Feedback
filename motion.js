/* =========================================================
   motion.js — animation & interaction layer
   Sits on top of script.js without changing its logic:
   watches the DOM and adds transitions, gliders, waveforms,
   count-ups and celebrations.
   ========================================================= */
(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const raf = fn => requestAnimationFrame(fn);
  const observe = (el, fn, opts = { childList: true }) => { if (el) new MutationObserver(fn).observe(el, opts); };

  /* ---------- 1. Splash + first entrance ---------- */
  const t0 = performance.now();
  window.addEventListener("load", () => {
    const wait = Math.max(0, (reduced ? 0 : 1300) - (performance.now() - t0));
    setTimeout(() => {
      $("splash")?.classList.add("gone");
      document.querySelector("main.app")?.classList.add("enter");
      document.querySelectorAll(".tabs").forEach(staggerTabs);
      placePill(); document.querySelectorAll(".tabs").forEach(t => moveGlider(t, true));
    }, wait);
  });

  /* ---------- 2. Background parallax ---------- */
  const par = document.querySelector(".bg-scene .parallax");
  if (par && !reduced) {
    window.addEventListener("pointermove", e => {
      const x = (e.clientX / innerWidth - .5) * 30, y = (e.clientY / innerHeight - .5) * 30;
      par.style.transform = `translate(${x}px,${y}px)`;
    }, { passive: true });
  }

  /* ---------- 3. Sliding pill on Write / Speak ---------- */
  const modes = document.querySelector(".modes"), pill = modes?.querySelector(".pill");
  function placePill() {
    if (!pill) return;
    const a = modes.querySelector(".mode.active"); if (!a) return;
    modes.classList.add("has-pill");
    const w = Math.max(56, a.offsetWidth * .7);
    pill.style.width = w + "px";
    pill.style.transform = `translateX(${a.offsetLeft + (a.offsetWidth - w) / 2}px)`;
  }
  modes?.querySelectorAll(".mode").forEach(b => observe(b, placePill, { attributes: true, attributeFilter: ["class"] }));
  window.addEventListener("resize", () => { placePill(); document.querySelectorAll(".tabs").forEach(t => moveGlider(t, true)); });

  // When a view becomes visible, re-measure gliders and stagger its tabs
  ["writeView", "speakView"].forEach(id => observe($(id), () => {
    const v = $(id); if (v.hidden) return;
    raf(() => { const t = v.querySelector(".tabs"); moveGlider(t, true); staggerTabs(t); });
  }, { attributes: true, attributeFilter: ["hidden"] }));

  /* ---------- 4. Gliding highlight behind the active task ---------- */
  const gliders = new WeakMap();
  function moveGlider(tabs, instant) {
    if (!tabs || !tabs.offsetParent) return;
    let g = gliders.get(tabs);
    if (!g) { g = document.createElement("div"); g.className = "glider"; gliders.set(tabs, g); tabs.closest(".sidebar")?.classList.add("has-glider"); }
    const prev = g.style.transform;
    if (g.parentNode !== tabs) {
      tabs.prepend(g);
      if (prev) { g.style.transition = "none"; g.style.transform = prev; void g.offsetWidth; g.style.transition = ""; }
    }
    const a = tabs.querySelector(".tab.active"); if (!a) return;
    if (instant) g.style.transition = "none";
    // On wide screens the highlight is a "tab" that runs down to the bar's bottom edge and melts into the page below
    const bar = tabs.closest(".sidebar"), merge = !!bar && innerWidth >= 900;
    let h = a.offsetHeight;
    if (merge) h = Math.round(bar.getBoundingClientRect().bottom - tabs.getBoundingClientRect().top - a.offsetTop) + 1;
    g.classList.toggle("merge", merge);
    g.style.width = a.offsetWidth + "px"; g.style.height = h + "px";
    g.style.transform = `translate(${a.offsetLeft}px,${a.offsetTop}px)`;
    g.classList.add("ready");
    if (instant) { void g.offsetWidth; g.style.transition = ""; }
    // keep the active chip in view on phones
    if (tabs.scrollWidth > tabs.clientWidth) a.scrollIntoView({ behavior: reduced ? "auto" : "smooth", inline: "center", block: "nearest" });
  }
  function staggerTabs(tabs) {
    if (!tabs || reduced) return;
    tabs.querySelectorAll(".tab").forEach((t, i) => t.style.setProperty("--i", i));
    tabs.classList.remove("stagger"); void tabs.offsetWidth; tabs.classList.add("stagger");
    setTimeout(() => tabs.classList.remove("stagger"), 900);
  }
  ["tabs", "sTabs"].forEach(id => observe($(id), () => moveGlider($(id))));

  /* ---------- 5. Ripple on press ---------- */
  document.addEventListener("pointerdown", e => {
    const b = e.target.closest("button.primary, button.ghost, .tab, .mode, .link-btn");
    if (!b || b.disabled || reduced) return;
    const r = b.getBoundingClientRect(), d = Math.max(r.width, r.height) * 2.2;
    const s = document.createElement("span");
    s.className = "ripple";
    Object.assign(s.style, { width: d + "px", height: d + "px", left: (e.clientX - r.left - d / 2) + "px", top: (e.clientY - r.top - d / 2) + "px" });
    b.appendChild(s); setTimeout(() => s.remove(), 700);
  });

  /* ---------- 6. Titles and prompts ---------- */
  ["wTitle", "sTitle"].forEach(id => observe($(id), () => {
    const h = $(id); h.classList.remove("swap"); void h.offsetWidth; h.classList.add("swap");
  }));
  const reveal = (box, step = 70) => {
    if (!box || reduced) return;
    [...box.children].forEach((c, i) => { c.style.setProperty("--i", i); c.classList.remove("reveal"); void c.offsetWidth; c.classList.add("reveal"); });
    // fade in the pane body too, so the whole task feels like a new screen
    void step;
  };
  ["promptBox", "sPromptBox"].forEach(id => observe($(id), () => {
    reveal($(id));
    $(id).closest(".pane")?.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" });
  }));

  /* ---------- 9. Feedback panels: skeleton, stagger, ring, count-up, celebration ---------- */
  const skeleton = msg => `<div class="skeleton"><div class="sk h2"></div><div class="sk h1"></div><div class="sk h3"></div><div class="sk h2"></div><div class="msg">${msg}</div></div>`;

  function animateFeedback(box) {
    if (!box) return;
    if (box.querySelector(".empty .spinner")) { box.innerHTML = skeleton("Checking your answer…"); return; }
    if (box.querySelector(".skeleton")) return;
    reveal(box);
    const card = box.querySelector(".scorecard");
    if (!card) return;
    recordResult(box, card.querySelector(".ring-num"));

    // bars fill one after another
    card.querySelectorAll(".bar").forEach((bar, r) => bar.querySelectorAll("span").forEach((s, i) => s.style.setProperty("--b", r * 2 + i)));

    const prog = card.querySelector(".ring .prog"), num = card.querySelector(".ring-num");
    if (prog) {
      const target = prog.style.strokeDasharray, circ = target.split(/[ ,]+/)[1] || "188.5";
      const color = prog.style.stroke; card.querySelector(".ring").style.setProperty("--ring-glow", color);
      if (!reduced) { prog.style.transition = "none"; prog.style.strokeDasharray = `0 ${circ}`; void prog.getBoundingClientRect(); prog.style.transition = ""; setTimeout(() => prog.style.strokeDasharray = target, 250); }
    }
    let ratio = 0;
    if (num) {
      const tn = [...num.childNodes].find(n => n.nodeType === 3 && /\d/.test(n.textContent));
      const max = parseFloat((num.querySelector("small")?.textContent || "").replace(/[^\d.]/g, "")) || 0;
      if (tn) {
        const end = parseFloat(tn.textContent), dec = (tn.textContent.split(".")[1] || "").length;
        ratio = max ? end / max : 0;
        if (!reduced && end > 0) {
          const start = performance.now() + 250, dur = 1300;
          tn.textContent = (0).toFixed(dec);
          const tick = now => {
            const p = Math.min(1, Math.max(0, (now - start) / dur)), e = 1 - Math.pow(1 - p, 3);
            tn.textContent = (end * e).toFixed(dec);
            if (p < 1) raf(tick);
          };
          raf(tick);
        }
      }
    }
    if (ratio >= .75 && !reduced) setTimeout(() => celebrate(card.querySelector(".ring")), 1350);
    box.closest(".pane")?.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" });
  }
  ["out", "sOut"].forEach(id => observe($(id), () => { animateFeedback($(id)); updateSteps(); }));

  /* Keep each task's best score so the task list can show "Done · best 12/16" */
  function recordResult(box, num) {
    try {
      if (!num) return;
      const m = num.textContent.match(/([\d.]+)\s*\/\s*([\d.]+)/); if (!m) return;
      const write = box.id === "out", key = (write ? "w:" + current : "s:" + sCurrent);
      const prev = RESULTS[key], val = +m[1], max = +m[2];
      if (!prev || val / max > prev.split("/")[0] / prev.split("/")[1]) RESULTS[key] = `${m[1]}/${m[2]}`;
      write ? renderTabs() : renderSTabs();
    } catch (e) { /* the task list just won't show the score */ }
  }

  /* ---------- Stepper: Prepare → Write/Record → Feedback ---------- */
  function setSteps(id, step) {
    const ol = $(id); if (!ol) return;
    [...ol.children].forEach((li, i) => { li.classList.toggle("on", i === step - 1); li.classList.toggle("past", i < step - 1); });
  }
  function updateSteps() {
    const wDone = !!$("out")?.querySelector(".scorecard");
    const typed = /^[1-9]/.test($("count")?.textContent || "");
    setSteps("wSteps", wDone ? 3 : typed ? 2 : 1);
    const sDone = !!$("sOut")?.querySelector(".scorecard");
    const rec = $("recBtn")?.classList.contains("on") || !!$("live")?.textContent.trim().match(/\w/) && !$("live").querySelector(".sub");
    setSteps("sSteps", sDone ? 3 : rec ? 2 : 1);
  }
  observe($("count"), updateSteps, { childList: true, characterData: true, subtree: true });
  observe($("recBtn"), updateSteps, { attributes: true, attributeFilter: ["class"] });
  observe($("live"), updateSteps);
  updateSteps();

  function celebrate(el) {
    if (!el) return;
    const r = el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const colors = ["#1f4fd8", "#e2262d", "#0d0f14", "#1f4fd8", "#e2262d", "#a4a9b4"];
    for (let i = 0; i < 34; i++) {
      const s = document.createElement("span"); s.className = "spark";
      s.style.background = colors[i % colors.length];
      s.style.left = cx + "px"; s.style.top = cy + "px";
      if (i % 3 === 0) s.style.borderRadius = "50%";
      document.body.appendChild(s);
      const a = Math.random() * Math.PI * 2, d = 60 + Math.random() * 110;
      const dx = Math.cos(a) * d, dy = Math.sin(a) * d - 30;
      s.animate([
        { transform: "translate(-50%,-50%) scale(1) rotate(0)", opacity: 1 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(.9) rotate(${Math.random() * 360}deg)`, opacity: 1, offset: .6 },
        { transform: `translate(calc(-50% + ${dx * 1.1}px), calc(-50% + ${dy + 70}px)) scale(.4) rotate(${Math.random() * 540}deg)`, opacity: 0 }
      ], { duration: 1100 + Math.random() * 500, easing: "cubic-bezier(.22,1,.36,1)" }).onfinish = () => s.remove();
    }
  }

  /* ---------- 10. Recorder: live waveform ---------- */
  const wave = $("wave"), meter = $("recMeter"), recBtn = $("recBtn"), recorder = document.querySelector(".recorder");
  if (wave && recorder) {
    recorder.classList.add("has-wave");
    const ctx = wave.getContext("2d"), N = 48, levels = new Array(N).fill(0);
    let level = 0, phase = 0;
    const size = () => { const dpr = devicePixelRatio || 1; wave.width = wave.clientWidth * dpr; wave.height = wave.clientHeight * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
    observe(meter, () => { level = Math.min(1, (parseFloat(meter.style.width) || 0) / 100); }, { attributes: true, attributeFilter: ["style"] });
    observe(recBtn, () => recorder.classList.toggle("live-on", recBtn.classList.contains("on")), { attributes: true, attributeFilter: ["class"] });
    const css = getComputedStyle(document.documentElement);
    let last = 0;
    function draw(now) {
      if (!wave.clientWidth) { raf(draw); return; }
      if (wave.width !== Math.round(wave.clientWidth * (devicePixelRatio || 1))) size();
      const on = recBtn.classList.contains("on");
      if (now - last > 50) {
        last = now; phase += .18;
        levels.shift();
        levels.push(on ? Math.max(.04, level * (0.75 + Math.random() * .5)) : 0);
      }
      const w = wave.clientWidth, h = wave.clientHeight, gap = w / N, bw = Math.max(2, gap * .55);
      ctx.clearRect(0, 0, w, h);
      const grad = ctx.createLinearGradient(0, 0, w, 0);
      const c = on ? "#ff4a52" : "#4a4f5a";
      grad.addColorStop(0, c); grad.addColorStop(1, c);
      ctx.fillStyle = grad;
      for (let i = 0; i < N; i++) {
        const idle = on ? 0 : (Math.sin(phase + i * .35) * .5 + .5) * .16 + .04;
        const v = on ? levels[i] : (reduced ? .08 : idle);
        const bh = Math.max(3, v * h * .95), x = i * gap + (gap - bw) / 2, y = (h - bh) / 2;
        ctx.globalAlpha = on ? .35 + .65 * (i / N) : .55;
        ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, bw, bh, bw / 2) : ctx.rect(x, y, bw, bh); ctx.fill();
      }
      ctx.globalAlpha = 1;
      void css;
      raf(draw);
    }
    raf(draw);
  }

  /* ---------- 10b. Reading flow: keep the passage in view, follow along, Space to record ---------- */
  const speakPane = $("speakView")?.querySelector(".pane.editor");
  const passageEl = () => $("sPromptBox")?.querySelector(".read-passage");

  // Wrap each passage word in a span once, so we can highlight how far the reader has got
  function wrapWords() {
    const p = passageEl(); if (!p || p.dataset.wrapped) return;
    const text = p.textContent;
    p.innerHTML = text.split(/(\s+)/).map(t => /\S/.test(t) ? `<span class="w">${t.replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]))}</span>` : t).join("");
    p.dataset.wrapped = "1";
  }
  observe($("sPromptBox"), wrapWords);
  wrapWords();

  let lastNext = -1;
  function track() {
    const p = passageEl(); if (!p) return;
    const live = $("live"), on = recBtn?.classList.contains("on");
    const said = live && !live.querySelector(":scope > .sub") ? (live.textContent.match(/[A-Za-z0-9'’:-]+/g) || []) : [];
    const ws = p.querySelectorAll(".w");
    p.classList.toggle("tracking", !!on);
    if (!on) { ws.forEach(w => w.classList.remove("said", "next")); lastNext = -1; return; }
    // Line up what was heard with the passage: each heard word may match one of the next few
    // passage words, so a misread or "eight forty five" for "8:45" doesn't push the marker off.
    const norm = w => w.toLowerCase().replace(/[^a-z0-9]/g, "");
    const ref = [...ws].map(w => norm(w.textContent));
    let n = 0;
    said.forEach(sw => {
      const h = norm(sw); if (!h) return;
      for (let k = 0; k < 6 && n + k < ref.length; k++) if (ref[n + k] === h) { n = n + k + 1; break; }
    });
    ws.forEach((w, i) => { w.classList.toggle("said", i < n); w.classList.toggle("next", i === n); });
    // keep the current line on screen, above the pinned dock
    if (n !== lastNext && ws[n] && speakPane) {
      lastNext = n;
      const r = ws[n].getBoundingClientRect(), dock = $("recDock").getBoundingClientRect();
      const top = Math.max(speakPane.getBoundingClientRect().top, 0);
      if (r.bottom > dock.top - 24 || r.top < top + 16) ws[n].scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
    }
  }
  observe($("live"), track, { childList: true, characterData: true, subtree: true });

  observe(recBtn, () => {
    const on = recBtn.classList.contains("on");
    $("live")?.classList.toggle("on", on);
    track();
    // when recording starts, bring the passage (or the question) to the top of the screen
    if (on && speakPane) {
      (passageEl() || $("sPromptBox")).scrollIntoView({ block: "start", behavior: reduced ? "auto" : "smooth" });
    }
  }, { attributes: true, attributeFilter: ["class"] });

  // Space starts / stops recording on the Speak screen (not while typing in a field)
  document.addEventListener("keydown", e => {
    if (e.code !== "Space" || e.repeat || $("speakView").hidden) return;
    if (e.target.closest("input, textarea, select, button, summary, [contenteditable]")) return;
    if (!$("settingsSheet").hidden || document.querySelector(".fb-modal.show, .type-modal.show")) return;
    e.preventDefault(); recBtn.click();
  });

  /* ---------- 11. Toast for copy ---------- */
  const toast = document.createElement("div"); toast.className = "toast"; toast.setAttribute("role", "status"); document.body.appendChild(toast);
  let toastTimer;
  const showToast = msg => { toast.textContent = msg; toast.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove("show"), 2200); };
  document.addEventListener("click", e => {
    if (e.target.closest("#copyBtn")) setTimeout(() => showToast(e.target.closest("#copyBtn").textContent === "Copied" ? "Feedback copied to clipboard" : "Copying isn't allowed here"), 250);
  });
})();
