/* =========================================================
   transition.js — fluted-glass stripe transition
   Start task / Next task : the chosen task's name appears
   Back                   : the roadmap's name appears
   (No transition when the feedback pop-up opens.)
   ========================================================= */
(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const N = innerWidth < 700 ? 9 : 16;
  const EASE = "cubic-bezier(.7,0,.25,1)";
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));
  const wait = ms => new Promise(r => setTimeout(r, ms));
  let busy = false;

  async function flute(label, title, swap){
    busy = true;
    const el = document.createElement("div");
    el.className = "flute"; el.setAttribute("aria-hidden", "true");
    el.style.setProperty("--n", N);
    const text = `<small>${esc(label)}</small><b>${esc(title)}</b>`;
    el.innerHTML = Array.from({ length: N }, (_, i) =>
      `<i class="sl" style="--i:${i};--lt:${Math.round(i / (N - 1) * 62)}%"><span class="tx-t" style="--shift:${(i % 2 ? 1 : -1) * 3}px">${text}</span></i>`).join("");
    document.body.appendChild(el);
    const slats = [...el.children], texts = slats.map(s => s.firstChild);

    // 1 · slats sweep in, left → right
    const ins = slats.map((s, i) => s.animate([{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }],
      { duration: 380, delay: i * 28, easing: EASE, fill: "forwards" }));
    // 2 · the name resolves through the glass
    texts.forEach((t, i) => t.animate([
      { opacity: 0, transform: `translateX(${70 + (i % 3) * 14}px)` },
      { opacity: 1, transform: `translateX(${(i % 2 ? 1 : -1) * 3}px)` }
    ], { duration: 620, delay: 300 + i * 18, easing: "cubic-bezier(.2,.8,.2,1)", fill: "forwards" }));
    await Promise.all(ins.map(a => a.finished.catch(() => {})));
    try { swap(); } catch(e){ console.error(e); }
    await wait(650);
    // 3 · text slips away, slats sweep out to the right
    texts.forEach((t, i) => t.animate([{ opacity: 1 }, { opacity: 0, transform: "translateX(-60px)" }],
      { duration: 260, delay: i * 10, easing: "ease-in", fill: "forwards" }));
    const outs = slats.map((s, i) => s.animate([
      { transform: "scaleX(1)", transformOrigin: "right center" },
      { transform: "scaleX(0)", transformOrigin: "right center" }
    ], { duration: 380, delay: 120 + i * 28, easing: EASE, fill: "forwards" }));
    await Promise.all(outs.map(a => a.finished.catch(() => {})));
    el.remove(); busy = false;
  }

  /* ---------- Start task / Next task ---------- */
  const _open = window.openTask;
  let nextFlag = false;
  window.openTask = function(k){
    const inTask = !$("speakView").hidden;
    if (busy || recState.on || !STASKS[k] || (inTask && k === sCurrent)) return _open(k);
    const t = STASKS[k], keys = SEGMENTS[segOf(k)].tasks, i = keys.indexOf(k);
    const label = `${nextFlag ? "Up next · " : ""}Stop ${i + 1} of ${keys.length} · ${t.kind === "read" ? "Read aloud" : "Speak"}`;
    nextFlag = false;
    flute(label, taskName(t), () => _open(k));
  };
  $("fbNext").addEventListener("click", () => { nextFlag = true; }, true);

  /* ---------- Back to the roadmap ---------- */
  const _home = window.goHome;
  window.goHome = function(){
    if (busy || recState.on || $("speakView").hidden) return _home();
    flute(`Segment ${segCur + 1} · Your roadmap`, SEGMENTS[segCur].name, () => _home());
  };
  $("backBtn").onclick = () => window.goHome();
})();
