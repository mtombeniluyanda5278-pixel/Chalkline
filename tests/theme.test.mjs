import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
const source = await readFile(new URL("../theme.js", import.meta.url), "utf8");
const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
async function page({ saved, dark = false, blocked = false } = {}) {
  const dom = new JSDOM(html, {
    url: "http://localhost/",
    runScripts: "outside-only",
  });
  await new Promise((resolve) =>
    dom.window.document.addEventListener("DOMContentLoaded", resolve, {
      once: true,
    }),
  );
  const media = {
    matches: dark,
    addEventListener: (_name, fn) => {
      media.change = fn;
    },
  };
  dom.window.matchMedia = () => media;
  if (saved) dom.window.localStorage.setItem("chix-theme", saved);
  if (blocked)
    Object.defineProperty(dom.window, "localStorage", {
      get() {
        throw new Error("Storage blocked");
      },
    });
  assert.equal(dom.window.document.querySelector(".site-header .theme"), null);
  dom.window.document.body.append(
    dom.window.document
      .getElementById("theme-control-template")
      .content.cloneNode(true),
  );
  dom.window.eval(source);
  dom.window.document.dispatchEvent(new dom.window.Event("DOMContentLoaded"));
  return {
    dom,
    media,
    root: dom.window.document.documentElement,
    toggle: dom.window.document.getElementById("theme-toggle"),
  };
}
test("theme switch uses native checked state, saves preference and restores it on reload", async () => {
  const p = await page();
  assert.equal(p.root.dataset.theme, "light");
  assert.equal(p.toggle.checked, false);
  assert.equal(p.toggle.getAttribute("role"), "switch");
  assert.match(
    p.dom.window.document.querySelector('label[for="theme-toggle"]')
      .textContent,
    /Dark theme/,
  );
  p.toggle.click();
  assert.equal(p.root.dataset.theme, "dark");
  assert.equal(p.toggle.checked, true);
  const saved = p.dom.window.localStorage.getItem("chix-theme");
  assert.equal(saved, "dark");
  p.dom.window.close();
  const reloaded = await page({ saved });
  assert.equal(reloaded.toggle.checked, true);
  assert.equal(reloaded.root.dataset.theme, "dark");
  reloaded.toggle.click();
  assert.equal(reloaded.root.dataset.theme, "light");
  assert.equal(reloaded.dom.window.localStorage.getItem("chix-theme"), "light");
  reloaded.dom.window.close();
});
test("system changes apply until explicitly chosen and storage events synchronize tabs", async () => {
  const p = await page({ dark: true });
  assert.equal(p.toggle.checked, true);
  p.media.matches = false;
  p.media.change();
  assert.equal(p.root.dataset.theme, "light");
  p.toggle.click();
  p.media.change();
  assert.equal(p.root.dataset.theme, "dark");
  p.dom.window.dispatchEvent(
    new p.dom.window.StorageEvent("storage", {
      key: "chix-theme",
      newValue: "light",
    }),
  );
  assert.equal(p.toggle.checked, false);
  p.dom.window.dispatchEvent(
    new p.dom.window.StorageEvent("storage", {
      key: "chix-theme",
      newValue: null,
    }),
  );
  p.media.matches = true;
  p.media.change();
  assert.equal(p.toggle.checked, true);
  p.dom.window.close();
});
test("blocked storage does not prevent switching or initial system theme", async () => {
  const p = await page({ dark: true, blocked: true });
  assert.equal(p.root.dataset.theme, "dark");
  p.toggle.click();
  assert.equal(p.root.dataset.theme, "light");
  p.dom.window.close();
});

function pointer(p, type, x) {
  const event = new p.dom.window.Event(type, {
    bubbles: true,
    cancelable: true,
  });
  Object.assign(event, {
    clientX: x,
    pointerId: 1,
    button: 0,
    isPrimary: true,
  });
  p.toggle.dispatchEvent(event);
}
test("drag follows the pointer, commits both directions and suppresses the release click", async () => {
  const p = await page();
  p.toggle.getBoundingClientRect = () => ({ width: 84 });
  const wrap = p.toggle.closest(".theme__toggle-wrap");
  pointer(p, "pointerdown", 20);
  pointer(p, "pointermove", 41);
  assert.equal(wrap.style.getPropertyValue("--theme-drag-x"), "1.5em");
  assert.equal(wrap.style.getPropertyValue("--theme-progress"), "0.5");
  assert.equal(wrap.style.getPropertyValue("--theme-night"), "50%");
  assert.equal(p.root.dataset.theme, "light");
  pointer(p, "pointermove", 62);
  pointer(p, "pointerup", 62);
  assert.equal(p.toggle.checked, true);
  p.toggle.dispatchEvent(
    new p.dom.window.MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      detail: 1,
    }),
  );
  assert.equal(p.toggle.checked, true);
  assert.equal(p.dom.window.localStorage.getItem("chix-theme"), "dark");
  assert.equal(wrap.classList.contains("is-dragging"), false);
  assert.equal(wrap.style.getPropertyValue("--theme-progress"), "");
  pointer(p, "pointerdown", 62);
  pointer(p, "pointermove", 20);
  pointer(p, "pointerup", 20);
  assert.equal(p.root.dataset.theme, "light");
  assert.equal(p.dom.window.localStorage.getItem("chix-theme"), "light");
  // Keyboard activation still uses the checkbox's native click behavior.
  p.toggle.click();
  assert.equal(p.root.dataset.theme, "dark");
  p.dom.window.close();
});
test("cancelled and short drags retain the current theme", async () => {
  const p = await page();
  p.toggle.getBoundingClientRect = () => ({ width: 84 });
  pointer(p, "pointerdown", 20);
  pointer(p, "pointermove", 62);
  pointer(p, "pointercancel", 62);
  assert.equal(p.root.dataset.theme, "light");
  assert.equal(p.dom.window.localStorage.getItem("chix-theme"), null);
  pointer(p, "pointerdown", 20);
  pointer(p, "pointermove", 30);
  pointer(p, "pointerup", 30);
  assert.equal(p.toggle.checked, false);
  p.dom.window.close();
});
