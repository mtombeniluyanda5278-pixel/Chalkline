import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createResourcePreview, youtubePoster } from "../resource-preview.js";
import {
  setupWorkspace,
  renderFile,
  renderFiles,
  beforeLeave,
} from "../workspace.js";
const tick = () => new Promise((r) => setTimeout(r, 20));
function setup(t) {
  const dom = new JSDOM("<main></main>", { url: "http://localhost:3000" });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  t.after(() => dom.window.close());
  const el = (tag, attrs = {}, children = []) => {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (key.startsWith("on") && typeof value === "function")
        node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value);
    }
    for (const child of Array.isArray(children) ? children : [children])
      if (child != null) node.append(child);
    return node;
  };
  return { dom, el };
}
test("YouTube thumbnails use a fixed host and valid video IDs only", () => {
  assert.equal(
    youtubePoster("https://youtu.be/abcdefghijk?t=20"),
    "https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg",
  );
  assert.equal(
    youtubePoster("https://www.youtube.com/watch?v=abcdefghijk"),
    "https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg",
  );
  assert.equal(
    youtubePoster("https://youtube.com/shorts/abcdefghijk"),
    "https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg",
  );
  for (const url of [
    "https://youtube.com.evil.test/watch?v=abcdefghijk",
    "https://example.com/watch",
    "javascript:alert(1)",
    "https://youtu.be/../../private",
  ])
    assert.equal(youtubePoster(url), null);
});
test("ready images have authenticated previews; blocked files never request content", async (t) => {
  const { el, dom } = setup(t);
  const api = () => assert.fail("No preview API expected");
  const image = createResourcePreview({
    item: { id: "image", title: "Photo", mime: "image/png", status: "ready" },
    el,
    api,
  });
  const blocked = createResourcePreview({
    item: {
      id: "blocked",
      title: "Unsafe",
      mime: "image/png",
      status: "quarantined",
    },
    el,
    api,
  });
  await tick();
  assert.equal(
    image.element.querySelector("img").getAttribute("src"),
    "/v1/resources/image/content",
  );
  assert.equal(blocked.element.querySelector("img"), null);
  assert.match(blocked.element.textContent, /blocked/);
  image.element
    .querySelector("img")
    .dispatchEvent(new dom.window.Event("error"));
  assert.match(image.element.textContent, /Preview unavailable/);
  image.dispose();
  blocked.dispose();
});
test("document excerpts are plain text, and late responses do not redraw disposed previews", async (t) => {
  const { el } = setup(t);
  let release;
  const result = new Promise((resolve) => {
    release = resolve;
  });
  const item = {
    id: "doc",
    title: "Lesson",
    mime: "text/plain",
    status: "ready",
  };
  const doc = createResourcePreview({
    item,
    el,
    api: async () => ({
      sections: [{ text: "<script>unsafe()</script>\nLesson content" }],
    }),
  });
  const stale = createResourcePreview({ item, el, api: () => result });
  await tick();
  assert.equal(doc.element.querySelector("script"), null);
  assert.match(doc.element.querySelector("pre").textContent, /Lesson content/);
  stale.dispose();
  release({ sections: [{ text: "Late text" }] });
  await tick();
  assert.doesNotMatch(stale.element.textContent, /Late text/);
  doc.dispose();
});
test("video detail shows a poster and removes misleading zero-byte metadata", async (t) => {
  const { el } = setup(t);
  setupWorkspace({
    el,
    viewRoot: document.querySelector("main"),
    apiFetch: async () => ({
      item: {
        id: "v",
        title: "Types of tourism",
        mime: "video/link",
        size_bytes: 0,
        external_url: "https://youtu.be/abcdefghijk",
        status: "ready",
      },
    }),
  });
  await renderFile(new URLSearchParams({ id: "v" }));
  await tick();
  assert.ok(document.querySelector(".resource-video img"));
  assert.doesNotMatch(document.body.textContent, /0 KB/);
  const link = document.querySelector(".resource-video a");
  assert.equal(link.target, "_blank");
  assert.equal(link.rel, "noopener noreferrer");
  await beforeLeave();
});
test("dropping a file selects it, preserves upload validation and uses the normal upload endpoint", async (t) => {
  const { el, dom } = setup(t);
  let uploads = 0;
  const previousFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = previousFetch;
  });
  globalThis.fetch = async (path, options) => {
    assert.equal(path, "/v1/resources");
    assert.equal(options.body.get("file").name, "lesson.txt");
    uploads++;
    return Response.json({ item: { id: "new-file", title: "lesson.txt" } });
  };
  setupWorkspace({
    el,
    viewRoot: document.querySelector("main"),
    field: ({ label, type = "text", extraAttrs = {} }) => {
      const input = el("input", { type, ...extraAttrs });
      return { input, wrapper: el("label", {}, [label, input]) };
    },
    apiFetch: async (path) => {
      if (path.startsWith("/v1/resources?"))
        return {
          items: [],
          uploadMaxBytes: 1024,
          usage: {
            verified: true,
            storage_used_bytes: 0,
            storage_quota_bytes: 10000,
          },
        };
      assert.equal(path, "/v1/resources/new-file");
      return { ok: true };
    },
    toast: (message) => assert.fail(message),
    friendlyError: (e) => e.message,
  });
  await renderFiles();
  const area = document.querySelector(".upload-area");
  const drop = (files) => {
    const event = new dom.window.Event("drop", {
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, "dataTransfer", {
      value: { files, types: ["Files"] },
    });
    area.dispatchEvent(event);
    assert.equal(event.defaultPrevented, true);
  };
  const file = new File(["Lesson"], "lesson.txt", { type: "text/plain" });
  drop([file, file]);
  assert.match(area.textContent, /one file at a time/);
  drop([new File(["x".repeat(2048)], "large.txt")]);
  assert.match(area.textContent, /exceeds/);
  drop([file]);
  assert.match(area.textContent, /Selected: lesson.txt/);
  assert.equal(uploads, 0);
  [...area.querySelectorAll("button")]
    .find((b) => b.textContent === "Upload resource")
    .click();
  await tick();
  assert.equal(uploads, 1);
  assert.equal(document.querySelector(".security-activity"), null);
  await beforeLeave();
});
