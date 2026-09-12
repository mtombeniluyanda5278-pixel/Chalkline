import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
const tick = () => new Promise((r) => setTimeout(r, 25));
test("public homepage renders during API outage, share is accessible, and unknown-device login enters approval", async () => {
  const html = await readFile(
    new URL("../index.html", import.meta.url),
    "utf8",
  );
  const dom = new JSDOM(html, {
    url: "http://localhost:8080/",
    pretendToBeVisual: true,
  });
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
  let mode = "offline";
  const requests = [];
  globalThis.fetch = async (path, options = {}) => {
    requests.push({ path, options });
    if (path === "/v1/me")
      return new Response("{}", { status: mode === "offline" ? 503 : 401 });
    if (path === "/v1/auth/login")
      return new Response(
        JSON.stringify({ approvalRequired: true, number: 42 }),
        { status: 202 },
      );
    if (path === "/v1/devices/pending")
      return new Response(
        JSON.stringify({
          status: "pending",
          number: 42,
          expiresAt: new Date(Date.now() + 600000).toISOString(),
        }),
      );
    throw new Error("Unexpected endpoint " + path);
  };
  await import("../app.js");
  document.dispatchEvent(new dom.window.Event("DOMContentLoaded"));
  await tick();
  await tick();
  assert.match(document.querySelector("h1").textContent, /good teaching/);
  assert.equal(location.hash, "");
  const share = [...document.querySelectorAll("button")].find((b) =>
    b.textContent.includes("Share Chalkline"),
  );
  share.click();
  await tick();
  assert.equal(share.getAttribute("aria-expanded"), "true");
  assert.equal(document.querySelector(".share-panel").hidden, false);
  mode = "guest";
  location.hash = "/login";
  await tick();
  await tick();
  document.querySelector("#login-email").value = "teacher@example.com";
  document.querySelector("#login-password").value =
    "correct horse battery staple";
  document
    .querySelector("form.form")
    .dispatchEvent(
      new dom.window.Event("submit", { bubbles: true, cancelable: true }),
    );
  await tick();
  await tick();
  assert.equal(location.hash, "#/device");
  assert.equal(document.querySelector(".matching-number").textContent, "42");
  assert.ok(requests.every((r) => r.path.startsWith("/v1/")));
  // Leave the view to stop its polling timer before disposing the DOM.
  location.hash = "/";
  await tick();
  await tick();
  dom.window.close();
});
