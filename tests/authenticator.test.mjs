import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { authenticatorCard } from "../authenticator-ui.js";
const until = async (fn) => {
  for (let i = 0; i < 100; i++) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.fail("Authenticator UI did not settle");
};
test("authenticator setup offers QR and manual key, retains failed codes, clears secrets after confirmation and cancellation", async (t) => {
  const dom = new JSDOM("<main></main>", { url: "http://localhost" });
  t.after(() => dom.window.close());
  globalThis.document = dom.window.document;
  const el = (tag, attrs = {}, kids = []) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, String(v));
    }
    for (const c of Array.isArray(kids) ? kids : [kids]) n.append(c);
    return n;
  };
  const field = ({ label, ...config }) => {
    const input = el("input", { type: config.type, ...config.extraAttrs });
    return { input, wrapper: el("label", {}, [label, input]) };
  };
  let enabled = false,
    good = false,
    cancelled = false;
  const calls = [];
  const apiFetch = async (path, opts = {}) => {
    calls.push([path, opts]);
    if (path.endsWith("/setup")) {
      if (opts.method === "DELETE") {
        cancelled = true;
        return {};
      }
      return {
        secret: "PRIVATEKEY",
        qr: "data:image/png;base64,AA==",
        account: "teacher@example.com",
      };
    }
    if (path.endsWith("/confirm")) {
      assert.equal(opts.body.code, "123456");
      if (!good) throw Error("Code invalid");
      enabled = true;
      return {};
    }
    return { enabled };
  };
  const helpers = {
    el,
    field,
    apiFetch,
    withReauth: (fn) => fn(),
    confirmDialog: async () => ({ confirmed: true }),
    toast: () => {},
    loadSession: async () => {},
  };
  document.querySelector("main").append(authenticatorCard(helpers));
  const btn = (text) =>
    [...document.querySelectorAll("button")].find(
      (b) => b.textContent === text,
    );
  await until(() => btn("Set up authenticator"));
  btn("Set up authenticator").click();
  await until(() => document.querySelector(".authenticator-qr"));
  assert.equal(
    document.querySelector(".authenticator-key").value,
    "PRIVATEKEY",
  );
  assert.ok(
    document.querySelector("details").textContent.includes("Time-based"),
  );
  const input = document.querySelector("form input");
  input.value = "123456";
  const submit = () =>
    document
      .querySelector("form")
      .dispatchEvent(
        new dom.window.Event("submit", { bubbles: true, cancelable: true }),
      );
  submit();
  await until(() => document.body.textContent.includes("Code invalid"));
  assert.equal(input.value, "123456");
  good = true;
  submit();
  await until(() =>
    document.body.textContent.includes("Authenticator connected"),
  );
  assert.equal(document.querySelector(".authenticator-key"), null);
  assert.equal(document.querySelector(".authenticator-qr"), null);
  enabled = false;
  document.querySelector("main").replaceChildren(authenticatorCard(helpers));
  await until(() => btn("Set up authenticator"));
  btn("Set up authenticator").click();
  await until(() => btn("Cancel setup"));
  btn("Cancel setup").click();
  await until(() => cancelled && btn("Set up authenticator"));
  assert.equal(document.querySelector(".authenticator-key"), null);
});
