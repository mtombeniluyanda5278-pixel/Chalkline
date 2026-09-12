import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
const tick = () => new Promise((r) => setTimeout(r, 15));
async function until(check) {
  for (let n = 0; n < 150; n++) {
    if (check()) return;
    await tick();
  }
  assert.fail("frontend did not settle");
}

test("homepage CTAs, SPA navigation, auth failures, copy fallback and native share", async () => {
  const dom = new JSDOM(
    await readFile(new URL("../index.html", import.meta.url), "utf8"),
    { url: "http://127.0.0.1:3000/", pretendToBeVisual: true },
  );
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
  let meStatus = 401,
    copied,
    nativeShare;
  const user = {
id: "teacher",
username: "teacher",
firstName: "Teacher",
email: "teacher@example.com",
emailVerified: true,
};
  Object.defineProperty(navigator, "clipboard", {
    value: {
      writeText: async (url) => {
        copied = url;
      },
    },
    configurable: true,
  });
  Object.defineProperty(navigator, "share", {
    value: async (data) => {
      nativeShare = data;
    },
    configurable: true,
  });
  globalThis.fetch = async (path) => {
    if (path === "/v1/me")
      return new Response(
        JSON.stringify(meStatus === 200 ? { user, address: {} } : {}),
        { status: meStatus },
      );
    if (path === "/v1/config")
      return Response.json({ bot: { registrationRequired: false } });
    if (path === "/v1/auth/logout") {
      meStatus = 401;
      return Response.json({ ok: true });
    }
    if (path.startsWith("/v1/workspace"))
      return Response.json({
        recent: [],
        notes: [],
        lessons: [],
        upcoming: [],
        resume: [],
      });
    if (path === "/v1/me/preferences")
      return Response.json({ preferences: {}, birthday: false });
    return Response.json({ items: [] });
  };
  const app = await import("../app.js?home-auth-test");
  document.dispatchEvent(new dom.window.Event("DOMContentLoaded"));
  const link = (text) =>
    [...document.querySelectorAll("#view-root a")].find(
      (e) => e.textContent === text,
    );
  const button = (text) =>
    [...document.querySelectorAll("button")].find((e) =>
      e.textContent.includes(text),
    );
  async function home(signedIn = false) {
    location.hash = "/";
    await until(
      () =>
        document.body.dataset.view === "home" &&
        button(signedIn ? "New note" : "Share Chix"),
    );
  }
  try {
    await until(() => button("Share Chix"));
    assert.ok(link("Sign in"));
    assert.ok(link("Create account"));
    assert.equal(link("Open your workspace"), undefined);
    link("Sign in").click();
    await until(() => document.querySelector("#login-email"));
    assert.equal(location.hash, "#/login");
    await home();
    link("Create account").click();
    await until(() => document.querySelector("#reg-email"));
    assert.equal(location.hash, "#/register");
    await home();
    button("Share Chix").click();
    assert.equal(button("Share Chix").getAttribute("aria-expanded"), "true");
    assert.equal(
      document.activeElement.getAttribute("aria-label"),
      "Chix address",
    );
    button("Copy link").click();
    await until(() => copied);
    assert.equal(copied, "http://127.0.0.1:3000/");
    await until(() => !button("Copy link").disabled);
    navigator.clipboard.writeText = async () => {
      throw new Error("denied");
    };
    button("Copy link").click();
    await tick();
    const address = document.querySelector('[aria-label="Chix address"]');
    assert.equal(address.selectionStart, 0);
    assert.equal(address.selectionEnd, address.value.length);
    button("Share with…").click();
    await until(() => nativeShare);
    assert.equal(nativeShare.url, "http://127.0.0.1:3000/");
    assert.equal(nativeShare.title, "Chix");
    meStatus = 200;
    await app.loadSession();
    location.hash = "/login";
    await tick();
    await home(true);
    assert.match(
      document.querySelector("#view-root h1").textContent,
      /Welcome back/,
    );
    assert.ok(button("New note"));
    assert.ok(button("New lesson plan"));

assert.match(
  document.querySelector("#view-root").textContent,
  /Continue where you left off/,
);

assert.match(
  document.querySelector("#view-root").textContent,
  /Recent/,
);

assert.doesNotMatch(
document.querySelector("#view-root").textContent,
/teacher@example\.com/,
);

assert.doesNotMatch(
  document.querySelector("#view-root").textContent,
  /Passkeys|Active sessions|Recovery email/,
);
    assert.equal(link("Sign in"), undefined);
    assert.equal(link("Create account"), undefined);
    assert.doesNotMatch(
      document.querySelector("#site-nav").textContent,
      /Sign in|Create account/,
    );
    document.querySelector('#site-nav a[href="#/dashboard"]').click();
    await until(() => location.hash === "#/dashboard");
    await home(true);
    meStatus = 500;
    await assert.rejects(app.loadSession());
    assert.equal(app.state.user.id, user.id);
    meStatus = 401;
    await app.loadSession();
    await until(() => link("Sign in"));
    assert.equal(app.state.user, null);
    assert.equal(app.state.address, null);
    location.hash = "/account";
    await until(() => location.hash !== "#/account");
    assert.equal(app.state.user, null);
  } finally {
    dom.window.close();
  }
});
