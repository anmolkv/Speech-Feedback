/* =========================================================
   fit-inside.js — "nothing scrolls" helpers, used when the tool
   runs inside frame.html (html.embed).
   1. Any box whose content is taller than the box is fitted:
      its content is scaled down a little (zoom) instead of scrolling.
   2. The writing box shrinks its text as the answer grows.
   3. The coach shows the newest sentences that fit.
   4. The live transcript keeps its newest words in view.
   5. The feedback pop-up is split into pages with Back / Next.
   ========================================================= */
(() => {
  "use strict";
  const root = document.documentElement;
  if (!root.classList.contains("embed")) return;
  const $ = s => document.querySelector(s);
  const visible = el => !!(el && el.offsetParent !== null && el.getClientRects().length);
  const SKIP = "textarea, input, select, .live, .fb-dialog, .fb-dialog *, .coach-body, .map, .map *, .word-pop, .flute, .flute *";

  /* ---------- 1 · fit boxes that overflow ---------- */
  function fitBox(el) {
    const kids = [...el.children].filter(k => getComputedStyle(k).position !== "absolute" && getComputedStyle(k).position !== "fixed");
    kids.forEach(k => { if (k.dataset.fitZoom) { k.style.zoom = ""; delete k.dataset.fitZoom; } });
    if (!kids.length || el.scrollHeight <= el.clientHeight + 2) return;
    let z = Math.max(0.5, el.clientHeight / el.scrollHeight);
    for (let i = 0; i < 5; i++) {
      kids.forEach(k => { k.style.zoom = z.toFixed(3); k.dataset.fitZoom = "1"; });
      if (el.scrollHeight <= el.clientHeight + 2 || z <= 0.5) break;
      z = Math.max(0.5, z * (el.clientHeight / el.scrollHeight) * 0.99);
    }
    el.scrollTop = 0;
  }
  function scrollables() {
    const out = [];
    document.querySelectorAll("body *").forEach(el => {
      if (el.matches(SKIP) || !visible(el)) return;
      const cs = getComputedStyle(el);
      if (/(auto|scroll)/.test(cs.overflowY) || el.dataset.fitWatch) { el.dataset.fitWatch = "1"; out.push(el); }
    });
    return out;
  }
  // deepest boxes first, so an inner box is fitted before the box around it
  const depth = el => { let d = 0; while ((el = el.parentElement)) d++; return d; };
  function fitAll() {
    scrollables().sort((a, b) => depth(b) - depth(a)).forEach(fitBox);
    fitAnswer(); fitCoach(); stickLive();
  }

  /* ---------- 2 · the writing box ---------- */
  function fitAnswer() {
    const ta = $("#answer"); if (!visible(ta)) return;
    ta.style.fontSize = "";
    let fs = parseFloat(getComputedStyle(ta).fontSize);
    while (ta.scrollHeight > ta.clientHeight + 2 && fs > 11) { fs -= 0.5; ta.style.fontSize = fs + "px"; }
    ta.scrollTop = 0;
  }

  /* ---------- 3 · the coach: newest sentences that fit ---------- */
  function fitCoach() {
    const body = $(".coach-body"), list = $("#sentences"); if (!visible(body) || !list) return;
    const rows = [...list.querySelectorAll(":scope > .sent")];
    rows.forEach(r => r.hidden = false);
    let more = list.querySelector(":scope > .fit-more");
    if (more) more.remove();
    let i = 0;
    while (body.scrollHeight > body.clientHeight + 2 && i < rows.length - 1) { rows[i].hidden = true; i++; }
    if (i) {
      more = document.createElement("div"); more.className = "sub fit-more";
      more.textContent = `${i} earlier sentence${i > 1 ? "s" : ""} not shown`;
      list.prepend(more);
      if (body.scrollHeight > body.clientHeight + 2 && i < rows.length - 1) { rows[i].hidden = true; more.textContent = `${i + 1} earlier sentences not shown`; }
    }
    body.scrollTop = 0;
  }

  /* ---------- 4 · live transcript ---------- */
  function stickLive() { const l = $(".live"); if (l) l.scrollTop = l.scrollHeight; }

  /* ---------- 5 · feedback pages ---------- */
  const modal = $("#fbModal"), dlg = modal && modal.querySelector(".fb-dialog");
  const out = dlg && dlg.querySelector("#out, #sOut");
  let pages = [], page = 0;
  let pager = null;
  if (dlg && out) {
    pager = document.createElement("div");
    pager.className = "fb-pager";
    pager.innerHTML = `<button type="button" class="prev">‹ Back</button><span class="dots" aria-live="polite"></span><button type="button" class="next">Next ›</button>`;
    dlg.appendChild(pager);
    pager.querySelector(".prev").onclick = () => show(page - 1);
    pager.querySelector(".next").onclick = () => show(page + 1);
    document.addEventListener("keydown", e => {
      if (!modal.classList.contains("show") || e.target.closest("input, textarea")) return;
      if (e.key === "ArrowRight" && page < pages.length - 1) { e.preventDefault(); show(page + 1); }
      if (e.key === "ArrowLeft" && page > 0) { e.preventDefault(); show(page - 1); }
    });
  }
  function paginate() {
    if (!out) return;
    if (!modal.classList.contains("show") || dlg.classList.contains("fx-intro")) return;
    const kids = [...out.children].filter(k => !k.matches(".empty"));
    out.classList.add("fb-paged");
    [...out.children].forEach(k => { k.classList.remove("pg-hide", "pg-in"); k.style.zoom = ""; });
    if (kids.length <= 1 && !kids.some(k => k.offsetHeight > 0)) { pages = [[...out.children]]; page = 0; pager.classList.remove("on"); return; }
    pager.classList.add("on");
    const body = out.parentElement, cs = getComputedStyle(body);
    const avail = body.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - 4;
    pages = []; let cur = [], h = 0;
    kids.forEach(k => {
      const kh = k.getBoundingClientRect().height + 18;
      if (cur.length && h + kh > avail) { pages.push(cur); cur = []; h = 0; }
      cur.push(k); h += kh;
      if (kh > avail) k.style.zoom = Math.max(0.45, (avail - 18) / (kh - 18) * 0.98).toFixed(3);
    });
    if (cur.length) pages.push(cur);
    if (pages.length <= 1) pager.classList.remove("on");
    show(Math.min(page, pages.length - 1), true);
  }
  function show(i, quiet) {
    if (!pages.length) return;
    const dir = i >= page ? 1 : -1;
    page = Math.max(0, Math.min(pages.length - 1, i));
    const on = new Set(pages[page]);
    [...out.children].forEach(k => {
      const vis = on.has(k) || k.matches(".empty");
      k.classList.toggle("pg-hide", !vis);
      k.classList.remove("pg-in");
      if (vis && !quiet) { k.style.setProperty("--pg-dx", (dir * 24) + "px"); void k.offsetWidth; k.classList.add("pg-in"); }
    });
    out.parentElement.scrollTop = 0; dlg.scrollTop = 0;
    pager.querySelector(".prev").disabled = page === 0;
    const nx = pager.querySelector(".next");
    nx.disabled = page === pages.length - 1;
    pager.querySelector(".dots").innerHTML = pages.map((_, j) => `<i class="${j === page ? "on" : ""}"></i>`).join("") + `<span>${page + 1} / ${pages.length}</span>`;
  }

  /* ---------- when to run ---------- */
  let queued = false;
  const schedule = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; fitAll(); }); };
  let pq = 0;
  const schedulePages = (reset) => { if (reset) page = 0; clearTimeout(pq); pq = setTimeout(paginate, 80); };

  addEventListener("resize", () => { schedule(); schedulePages(); });
  addEventListener("load", () => { schedule(); setTimeout(schedule, 600); });
  document.addEventListener("input", schedule, true);
  document.addEventListener("transitionend", schedule, true);
  document.addEventListener("animationend", e => { if (!e.target.closest || !e.target.closest(".fb-paged")) schedule(); }, true);
  new MutationObserver(muts => {
    const ours = m => {
      const t = m.target.nodeType === 1 ? m.target : m.target.parentElement;
      if (!t || !t.closest) return false;
      if (t.closest(".fb-dialog")) return true;                                    // handled by the pager
      if (m.type === "attributes" && t.closest(".coach-body")) return true;         // rows we hid ourselves
      if (m.type === "childList" && [...m.addedNodes, ...m.removedNodes].every(n => n.classList && n.classList.contains("fit-more"))) return true;
      return false;
    };
    if (muts.every(ours)) return;
    schedule();
  }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["hidden"] });
  if (out) {
    new MutationObserver(() => schedulePages(true)).observe(out, { childList: true });
    new MutationObserver(() => schedulePages()).observe(dlg, { attributes: true, attributeFilter: ["class"] });
    new MutationObserver(() => schedulePages(true)).observe(modal, { attributes: true, attributeFilter: ["class"] });
  }
  // the classes that switch views (home ↔ task) live on <body>
  new MutationObserver(schedule).observe(document.body, { attributes: true, attributeFilter: ["class"] });
  schedule();
})();
