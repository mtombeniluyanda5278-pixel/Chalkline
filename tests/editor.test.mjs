import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { setupWorkspace, renderEditor, beforeLeave } from "../workspace.js";
test("restoring an editor does not let focus events overwrite its saved cursor or scroll", async () => {
  const dom = new JSDOM('<main id="root"></main>', {
    pretendToBeVisual: true,
    url: "http://localhost/",
  });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  let restoredY;
  dom.window.scrollTo = (_x, y) => {
    restoredY = y;
  };
  const saved = {
      cursor: 14,
      selectionEnd: 18,
      scroll: 120,
      windowScroll: 500,
      field: "body",
    },
    writes = [],
    patches = [];
  const el = (tag, attrs = {}, children = []) => {
    const n = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (key === "class") n.className = value;
      else if (key.startsWith("on")) n.addEventListener(key.slice(2), value);
      else if (value !== undefined && value !== false)
        n.setAttribute(key, value);
    }
    for (const child of Array.isArray(children) ? children : [children])
      if (child !== null && child !== undefined) n.append(child);
    return n;
  };
  setupWorkspace({
    el,
    viewRoot: document.getElementById("root"),
    field: () => {
      const input = el("input");
      return { input, wrapper: el("div", {}, input) };
    },
    toast: () => {},
    friendlyError: (e) => e.message,
    apiFetch: async (path, options) => {
      if (options?.method === "PATCH") {
        patches.push(options.body);
        return { item: { revision: 2 } };
      }
      if (options?.method === "PUT") {
        writes.push(structuredClone(options.body.state));
        return { ok: true };
      }
      return {
        item: {
          id: "test",
          kind: "note",
          title: "Cyclones",
          revision: 1,
          content: { body: "A".repeat(200) },
        },
        resume: structuredClone(saved),
        resources: [],
      };
    },
  });
  await renderEditor(new URLSearchParams({ id: "test" }));
  await new Promise((r) => setTimeout(r, 30));
  const input = document.getElementById("editor-body");
  assert.equal(input.selectionStart, 14);
  assert.equal(input.selectionEnd, 18);
  assert.equal(input.scrollTop, 120);
  assert.equal(restoredY, 500);
  await beforeLeave(false);
  input.value = "A revised draft after a cancelled sign-out";
  input.dispatchEvent(new dom.window.Event("input"));
  await beforeLeave();
  assert.equal(patches[0].content.body, input.value);
  assert.equal(writes.at(-1).cursor, 14);
  dom.window.close();
});
