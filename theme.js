/* Theme picker: 1 Classic · 2 Navy · 3 Blue & Black · 4 Sky · 5 Purple · 6 Green (Snigdha's picks) */
(function(){
  const root = document.documentElement;
  function sync(){
    document.querySelectorAll("[data-theme-set]").forEach(b =>
      b.setAttribute("aria-pressed", String(b.dataset.themeSet === root.dataset.theme)));
  }
  function setTheme(t){
    root.dataset.theme = t;
    root.classList.toggle("lm", t !== "classic");
    try{ localStorage.setItem("speak-theme", t); }catch(e){}
    sync();
    window.dispatchEvent(new Event("resize")); // let canvases / notch re-measure
  }
  document.addEventListener("click", e => {
    const b = e.target.closest("[data-theme-set]");
    if (b) setTheme(b.dataset.themeSet);
  });
  sync();
})();
