import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";

async function until(check) {
  for (let attempt = 0; attempt < 150; attempt++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail("verification view did not settle");
}

let fixtureId = 0;
async function verifyEmail(
  t,
  { response, sessionStatus = 200, verified = true },
) {
  const dom = new JSDOM(
    await readFile(new URL("../index.html", import.meta.url), "utf8"),
    {
      url: "http://127.0.0.1:3000/#/verify-email?token=private-verification-token",
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
  ]) {
    Object.defineProperty(globalThis, key, {
      value: dom.window[key],
      configurable: true,
    });
  }
  globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(
    dom.window,
  );
  const user = {
    id: "verified-teacher",
    username: "teacher",
    firstName: "Teacher",
    emailVerified: true,
  };
  let verificationComplete = false;
  const requests = [];
  globalThis.fetch = async (path, options = {}) => {
    requests.push({ path, options });
    if (path === "/v1/me") {
      const status = verificationComplete ? sessionStatus : 401;
      return Response.json(status === 200 ? { user, address: {} } : {}, {
        status,
      });
    }
    if (path === "/v1/auth/verify-email") {
      assert.deepEqual(JSON.parse(options.body), {
        token: "private-verification-token",
      });
      assert.equal(location.hash, "#/verify-email", "token is scrubbed first");
      verificationComplete = true;
      return response();
    }
    throw new Error("Unexpected endpoint " + path);
  };
  const app = await import("../app.js?email-verification-" + fixtureId++);
  document.dispatchEvent(new dom.window.Event("DOMContentLoaded"));
  await until(() =>
    document.querySelector(verified ? ".form-success" : ".form-error"),
  );
  return { app, requests, user };
}

test("email verification refreshes guest auth and navigation from the issued session", async (t) => {
  const { app, requests, user } = await verifyEmail(t, {
    response: () => Response.json({ ok: true }),
  });
  assert.deepEqual(app.state.user, user);
  assert.deepEqual(
    requests.map(({ path }) => path),
    ["/v1/me", "/v1/auth/verify-email", "/v1/me"],
  );
  assert.equal(
    document.querySelector("#view-root .btn--primary").getAttribute("href"),
    "#/account",
  );
  assert.ok(document.querySelector('#site-nav a[href="#/account"]'));
  assert.equal(document.querySelector('#site-nav a[href="#/login"]'), null);
  assert.ok(requests.every(({ options }) => options.cache === "no-store"));
});

test("committed verification with a failed first sign-in clearly asks the guest to sign in", async (t) => {
  const { app, requests } = await verifyEmail(t, {
    response: () =>
      Response.json({
        ok: true,
        signInRequired: true,
        message: "Your email is verified. Sign in to continue.",
      }),
    sessionStatus: 401,
  });
  assert.equal(app.state.user, null);
  assert.match(document.querySelector("#view-root").textContent, /verified/);
  assert.match(document.querySelector("#view-root").textContent, /sign in/i);
  const action = document.querySelector("#view-root .btn--primary");
  assert.equal(action.getAttribute("href"), "#/login");
  assert.equal(action.textContent, "Sign in");
  assert.equal(document.querySelector(".form-error"), null);
  assert.ok(document.querySelector('#site-nav a[href="#/login"]'));
  assert.equal(requests.filter(({ path }) => path === "/v1/me").length, 2);
});

test("session refresh outages preserve successful verification without offering link resend", async (t) => {
  const { app, requests } = await verifyEmail(t, {
    response: () => Response.json({ ok: true }),
    sessionStatus: 503,
  });
  assert.equal(app.state.user, null);
  assert.equal(document.querySelector(".form-error"), null);
  assert.match(
    document.querySelector("#view-root").textContent,
    /verified.*couldn't refresh your session.*sign in/is,
  );
  assert.equal(document.querySelector("#view-root button"), null);
  assert.equal(
    requests.filter(({ path }) => path === "/v1/auth/verify-email").length,
    1,
  );
});

test("invalid verification links remain errors and do not refresh auth", async (t) => {
  const { app, requests } = await verifyEmail(t, {
    response: () =>
      Response.json(
        { error: "This link is invalid or expired." },
        { status: 400 },
      ),
    verified: false,
  });
  assert.equal(app.state.user, null);
  assert.match(document.querySelector(".form-error").textContent, /expired/);
  assert.equal(document.querySelector(".form-success"), null);
  assert.equal(requests.filter(({ path }) => path === "/v1/me").length, 1);
});
