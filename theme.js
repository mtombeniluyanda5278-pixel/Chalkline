// Apply the preference before the stylesheet paints; no account is required.
(() => {
  const key = "chix-theme";
  const system = window.matchMedia?.("(prefers-color-scheme: dark)");
  let preference;
  try {
    preference = localStorage.getItem(key);
  } catch {
    // The switch remains functional when browser storage is unavailable.
  }
  if (!["light", "dark"].includes(preference)) preference = null;
  const apply = () => {
    const dark = preference ? preference === "dark" : Boolean(system?.matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    const toggle = document.getElementById("theme-toggle");
    if (toggle) toggle.checked = dark;
  };
  apply();
  system?.addEventListener("change", () => {
    if (!preference) apply();
  });
  window.addEventListener("storage", (event) => {
    if (event.key !== key && event.key !== null) return;
    preference = ["light", "dark"].includes(event.newValue)
      ? event.newValue
      : null;
    apply();
  });
  document.addEventListener("DOMContentLoaded", apply, { once: true });
  let drag = null;
  let suppressClick = null;
  function previewPalette() {
    const root = document.documentElement;
    const original = root.dataset.theme;
    const names = ["bg", "bg-soft", "surface", "surface-border", "hairline", "ink", "ink-soft", "ink-muted", "green", "green-dark", "green-tint", "tan", "tan-dark", "danger", "danger-dark", "danger-tint", "focus"].map(name => "--color-" + name);
    const previous = names.map(name => root.style.getPropertyValue(name));
    root.dataset.theme = "light";
    const light = names.map(name => getComputedStyle(root).getPropertyValue(name).trim());
    root.dataset.theme = "dark";
    const dark = names.map(name => getComputedStyle(root).getPropertyValue(name).trim());
    root.dataset.theme = original;
    return names.map((name, i) => ({ name, light: light[i], dark: dark[i], previous: previous[i] }));
  }
  document.addEventListener("pointerdown", (event) => {
    if (event.target.id !== "theme-toggle" || event.button !== 0 || event.isPrimary === false || drag) return;
    const toggle = event.target;
    const width = toggle.getBoundingClientRect().width;
    if (!width) return;
    suppressClick = null;
    drag = { toggle, id: event.pointerId, x: event.clientX, travel: width / 2, initial: toggle.checked ? 1 : 0, progress: toggle.checked ? 1 : 0, moved: false };
    drag.palette = previewPalette();
    toggle.setPointerCapture?.(event.pointerId);
    toggle.focus({ preventScroll: true });
  });
  document.addEventListener("pointermove", (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    const delta = event.clientX - drag.x;
    if (!drag.moved && Math.abs(delta) < 4) return;
    drag.moved = true;
    drag.progress = Math.max(0, Math.min(1, drag.initial + delta / drag.travel));
    const wrap = drag.toggle.closest(".theme__toggle-wrap");
    wrap.classList.add("is-dragging");
    wrap.style.setProperty("--theme-drag-x", drag.progress * 3 + "em");
    wrap.style.setProperty("--theme-progress", drag.progress);
    wrap.style.setProperty("--theme-night", drag.progress * 100 + "%");
    for (const color of drag.palette) {
      if (color.light && color.dark) document.documentElement.style.setProperty(color.name,
        `color-mix(in srgb, ${color.dark} ${drag.progress * 100}%, ${color.light})`);
    }
  });
  function finishDrag(event) {
    if (!drag || event.pointerId !== drag.id) return;
    const current = drag;
    drag = null;
    const wrap = current.toggle.closest(".theme__toggle-wrap");
    wrap.classList.remove("is-dragging");
    wrap.style.removeProperty("--theme-drag-x");
    wrap.style.removeProperty("--theme-progress");
    wrap.style.removeProperty("--theme-night");
    for (const color of current.palette) {
      if (color.previous) document.documentElement.style.setProperty(color.name, color.previous);
      else document.documentElement.style.removeProperty(color.name);
    }
    if (current.toggle.hasPointerCapture?.(current.id)) current.toggle.releasePointerCapture(current.id);
    if (!current.moved) return;
    suppressClick = current.toggle;
    if (event.type === "pointerup") {
      current.toggle.checked = current.progress >= 0.5;
      current.toggle.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }
  document.addEventListener("pointerup", finishDrag);
  document.addEventListener("pointercancel", finishDrag);
  document.addEventListener("lostpointercapture", finishDrag);
  document.addEventListener("click", (event) => {
    if (event.target !== suppressClick || event.detail === 0) return;
    // A completed drag already set the value; suppress its synthetic click.
    event.preventDefault();
    event.stopImmediatePropagation();
    suppressClick = null;
  }, true);
  // Settings are rendered on demand as the user navigates.
  document.addEventListener("change", (event) => {
    const toggle = event.target;
    if (toggle.id !== "theme-toggle") return;
    preference = toggle.checked ? "dark" : "light";
    apply();
    try {
      localStorage.setItem(key, preference);
    } catch {
      // Keep the selected theme for this page even without persistence.
    }
  });
})();
