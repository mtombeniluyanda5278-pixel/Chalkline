import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
test("legacy password bookmarks offer password-free sign-in and never call reset endpoints", async (t) => {
  const dom = new JSDOM(
    await readFile(new URL("../index.html", import.meta.url), "utf8"),
    {
      url: "http://127.0.0.1:3000/#/reset-password?token=retired",
      pretendToBeVisual: true,
    },
  );
  t.after(() => dom.window.close());
  for (const key of [
    "window",
    "document",
    "Node",
    "location",
    "history",
    "navigator",
  ])
    Object.defineProperty(globalThis, key, {
      value: dom.window[key],
      configurable: true,
    });
  globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(
    dom.window,
  );
  const paths = [];
  globalThis.fetch = async (path) => {
    paths.push(path);
    return path === "/v1/me"
      ? Response.json({}, { status: 401 })
      : Response.json({ google: false });
  };
  await import("../app.js?retired-password");
  document.dispatchEvent(new dom.window.Event("DOMContentLoaded"));
  for (let i = 0; i < 100 && !document.querySelector("#login-email"); i++)
    await new Promise((r) => setTimeout(r, 10));
  assert.ok(document.querySelector("#login-email"));
  assert.equal(document.querySelector('input[type="password"]'), null);
  assert.equal(document.querySelector('a[href="#/forgot-password"]'), null);
  assert.ok(document.body.textContent.includes("Use an authenticator app"));
  assert.ok(paths.every((path) => !path.includes("password-reset")));
});
