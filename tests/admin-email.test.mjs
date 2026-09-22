import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { setupExtras, renderAdmin } from "../extras.js";

test("admin email filters preview the audience, invalidate changed drafts, and confirm before queueing", async () => {
  const dom = new JSDOM("<main></main>", { url: "http://localhost/" });
  globalThis.document = dom.window.document;
  const el = (tag, attrs = {}, children = []) => {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value);
    }
    for (const child of Array.isArray(children) ? children : [children])
      node.append(child);
    return node;
  };
  const requests = [];
  let confirm = false;
  const accounts = { total: 0, items: [], plans: ["FREE_BETA", "FUTURE_PAID"] };
  setupExtras({
    el,
    viewRoot: document.querySelector("main"),
    field: ({ label, type = "text" }) => {
      const input = el("input", { type });
      return { input, wrapper: el("label", {}, [label, input]) };
    },
    withReauth: (fn) => fn(),
    friendlyError: (error) => error.message,
    toast: (message) => {
      throw new Error(message);
    },
    confirmDialog: async () => ({ confirmed: confirm }),
    apiFetch: async (path, options) => {
      requests.push({ path, ...options });
      if (path.startsWith("/v1/admin/users")) return accounts;
      if (path === "/v1/admin/feedback") return { items: [] };
      if (path === "/v1/admin/jobs") return { scans: [] };
      if (path === "/v1/admin/emails/preview")
        return {
          id: "draft",
          count: 12,
          subject: options.body.subject,
          message: options.body.message,
          sample: [{ email: "t***@example.com" }],
        };
      if (path === "/v1/admin/emails/draft/send") return { queued: 12 };
      throw new Error(path);
    },
  });
  const click = async (text) => {
    const btn = [...document.querySelectorAll("button")].find(
      (b) => b.textContent === text,
    );
    assert.ok(btn, text);
    btn.click();
    await new Promise((r) => setTimeout(r, 0));
  };
  try {
    await renderAdmin();
    const input = (label) =>
      [...document.querySelectorAll("label")]
        .find((n) => n.textContent === label)
        .querySelector("input");
    input("Minimum age").value = "25";
    input("Email subject").value = "Service update";
    document.querySelector("textarea").value = "A useful update.";
    await click("Preview email and recipients");
    assert.equal(requests.at(-1).body.filters.ageMin, 25);
    assert.equal(requests.at(-1).body.kind, "service");
    assert.match(document.body.textContent, /12 recipients/);
    await click("Send to 12 accounts");
    assert.ok(!requests.some((r) => r.path.endsWith("/send")));
    input("Minimum age").dispatchEvent(
      new dom.window.Event("input", { bubbles: true }),
    );
    assert.ok(
      ![...document.querySelectorAll("button")].some(
        (b) => b.textContent === "Send to 12 accounts",
      ),
    );
    await click("Preview email and recipients");
    confirm = true;
    await click("Send to 12 accounts");
    assert.equal(requests.filter((r) => r.path.endsWith("/send")).length, 1);
    assert.match(document.body.textContent, /12 emails queued/);
  } finally {
    dom.window.close();
  }
});
