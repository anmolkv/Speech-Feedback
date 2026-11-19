/* =========================================================
   notch.js — curved "notch" cut-outs
   Cuts a smooth circular bite (with rounded shoulders) out of a
   surface wherever a round button sits on its edge, like a phone
   tab bar with a floating button. The shape is written to the
   CSS variable --notch as a clip-path; style.css decides what
   it clips. Bites can be on the top or the bottom edge.
   ========================================================= */
(() => {
  "use strict";
  const n = v => +v.toFixed(2);

  // Rounded rectangle w×h (radii tl,tr,br,bl) with circular bites on one edge.
  // bite: {at: centre x, depth: centre distance in from the edge (negative = outside), r: radius, f: shoulder radius}
  // edge "top" or "bottom". Bottom bites are drawn as top bites and mirrored.
  function notchPath(w, h, radii, bites, edge = "top"){
    const flip = edge === "bottom";
    const [tl, tr, br, bl] = flip ? [radii[3], radii[2], radii[1], radii[0]] : radii;
    const M = (x, y) => `${n(x)} ${n(flip ? h - y : y)}`;
    const S = s => flip ? 1 - s : s;
    let d = `M${M(tl, 0)}`;
    // a bite is a stadium: two half-circles (centres a and b) joined by a straight run; a === b gives a circle
    bites.slice().sort((p, q) => p.a - q.a).forEach(({a, b, depth, r, f}) => {
      const dx = Math.sqrt(Math.max(0, (r + f) ** 2 - (f - depth) ** 2)), k = r / (r + f);
      const py = depth + (f - depth) * k;
      d += ` L${M(a - dx, 0)} A${f} ${f} 0 0 ${S(1)} ${M(a - dx * k, py)} A${r} ${r} 0 0 ${S(0)} ${M(a, depth + r)}`;
      d += ` L${M(b, depth + r)} A${r} ${r} 0 0 ${S(0)} ${M(b + dx * k, py)} A${f} ${f} 0 0 ${S(1)} ${M(b + dx, 0)}`;
    });
    d += ` L${M(w - tr, 0)}` + (tr ? ` A${tr} ${tr} 0 0 ${S(1)} ${M(w, tr)}` : "");
    d += ` L${M(w, h - br)}` + (br ? ` A${br} ${br} 0 0 ${S(1)} ${M(w - br, h)}` : "");
    d += ` L${M(bl, h)}` + (bl ? ` A${bl} ${bl} 0 0 ${S(1)} ${M(0, h - bl)}` : "");
    d += ` L${M(0, tl)}` + (tl ? ` A${tl} ${tl} 0 0 ${S(1)} ${M(tl, 0)}` : "") + " Z";
    return `path("${d}")`;
  }

  // Each surface: element to notch, the round thing that sits in the notch, gap around it, which edge
  const SURFACES = [
    { el: () => document.querySelector(".recorder"), btn: () => document.getElementById("recBtn"), gap: 8, f: 14, radii: [22, 22, 22, 22], edge: "top" },
  ];

  function update(){
    SURFACES.forEach(s => {
      const el = s.el(), b = s.btn(); if (!el) return;
      const clear = () => { el.style.removeProperty("--notch"); el.classList.remove("notched"); };
      if (!b || (s.desktopOnly && innerWidth < 900) || !el.offsetWidth) return clear();
      const er = el.getBoundingClientRect(), br = b.getBoundingClientRect();
      const half = br.height / 2, r = half + s.gap;
      const x1 = br.left + half - er.left, x2 = br.right - half - er.left;
      const cy = br.top + half - er.top;
      const depth = s.edge === "bottom" ? er.height - cy : cy;
      // only notch when the button actually straddles that edge
      if (depth - r > 0 || depth + r < 0) return clear();
      el.style.setProperty("--notch", notchPath(er.width, er.height, s.radii, [{ a: x1, b: x2, depth, r, f: s.f }], s.edge));
      el.classList.add("notched");
    });
  }

  let queued = false;
  const schedule = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; update(); }); };
  const ro = new ResizeObserver(schedule);
  SURFACES.forEach(s => { const el = s.el(); if (el) ro.observe(el); });
  const tabs = document.getElementById("sTabs");
  if (tabs) new MutationObserver(schedule).observe(tabs, { childList: true });
  addEventListener("resize", schedule);
  addEventListener("load", () => { update(); setTimeout(update, 1500); });
  document.addEventListener("transitionend", schedule, true);
  document.addEventListener("animationend", schedule, true);
  update();
})();
