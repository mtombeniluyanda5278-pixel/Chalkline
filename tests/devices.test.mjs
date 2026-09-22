import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
const until = async (check) => {
  for (let i = 0; i < 150; i++) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.fail("Device view did not settle");
};
test("security activity filters dates and devices; recovery generation confirms, reauthenticates and displays codes", async (t) => {
  const dom = new JSDOM(
    await readFile(new URL("../index.html", import.meta.url), "utf8"),
    { url: "http://localhost:3000/#/devices", pretendToBeVisual: true },
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
  dom.window.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  dom.window.HTMLDialogElement.prototype.close = function () {
    this.open = false;
    this.dispatchEvent(new dom.window.Event("close"));
  };
  let authenticated = false,
    requests = 0;
  const codes = Array.from({ length: 8 }, (_, i) => String(i).repeat(64));
  globalThis.fetch = async (path, options = {}) => {
    if (path === "/v1/me")
      return Response.json({
        user: { id: "u", emailVerified: true },
        address: {},
      });
    if (path === "/v1/me/devices")
      return Response.json({
        devices: [],
        pending: [],
        events: [
          {
            event: "login_success",
            created_at: "2026-09-20T12:00:00Z",
            user_agent: "Mozilla Macintosh Safari/605",
          },
          {
            event: "passkey_added",
            created_at: "2026-09-21T12:00:00Z",
            user_agent: "Mozilla Windows Chrome/120",
          },
          {
            event: "email_changed",
            created_at: "2026-09-21T12:00:00Z",
            user_agent: null,
          },
        ],
      });
    if (path === "/v1/auth/otp/reauth/request")
      return Response.json({ ok: true });
    if (path === "/v1/auth/otp/verify") {
      authenticated = true;
      return Response.json({ ok: true });
    }
    if (path === "/v1/me/recovery-codes") {
      requests++;
      assert.deepEqual(JSON.parse(options.body), {});
      return authenticated
        ? Response.json({ codes })
        : Response.json(
            { code: "REAUTH_REQUIRED", error: "Confirm your identity" },
            { status: 401 },
          );
    }
    throw Error("Unexpected " + path);
  };
  await import("../app.js?devices-test");
  document.dispatchEvent(new dom.window.Event("DOMContentLoaded"));
  await until(() => document.querySelector(".security-timeline"));
  const rows = () => document.querySelectorAll(".security-timeline__event");
  assert.equal(rows().length, 3);
  const inputs = document.querySelectorAll(".security-filters input");
  const set = (input, value) => {
    input.value = value;
    input.dispatchEvent(new dom.window.Event("input"));
  };
  set(inputs[0], "2026-09-21");
  assert.equal(rows().length, 2);
  set(inputs[2], "windows");
  assert.equal(rows().length, 1);
  assert.match(rows()[0].textContent, /Passkey added/);
  set(inputs[1], "2026-09-19");
  assert.match(
    document.querySelector(".security-activity").textContent,
    /on or after/,
  );
  const click = (text) =>
    [...document.querySelectorAll("button")]
      .find((b) => b.textContent === text)
      .click();
  click("Clear filters");
  assert.equal(rows().length, 3);
  click("Generate recovery codes");
  await until(() => document.querySelector("#confirm-dialog").open);
  const submit = () =>
    document
      .querySelector("#confirm-dialog-form")
      .dispatchEvent(
        new dom.window.Event("submit", { bubbles: true, cancelable: true }),
      );
  submit();
  await until(
    () =>
      document.querySelector("#confirm-dialog-confirm").textContent ===
      "Email me a code",
  );
  submit();
  await until(() => document.querySelector("#confirm-dialog-password"));
  document.querySelector("#confirm-dialog-password").value = "123456";
  submit();
  await until(
    () => document.querySelectorAll(".recovery-codes code").length === 8,
  );
  assert.equal(requests, 2);
  assert.deepEqual(
    [...document.querySelectorAll(".recovery-codes code")].map(
      (n) => n.textContent,
    ),
    codes,
  );
  assert.ok(
    [...document.querySelectorAll("button")].some(
      (b) => b.textContent === "Download codes",
    ),
  );
});
