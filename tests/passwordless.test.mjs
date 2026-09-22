import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
const until = async (fn) => {
  for (let i = 0; i < 150; i++) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.fail("Passwordless view did not settle");
};
let fixture = 0;
async function setup(t, route, handler) {
  const dom = new JSDOM(
    await readFile(new URL("../index.html", import.meta.url), "utf8"),
    { url: `http://127.0.0.1:3000/#${route}`, pretendToBeVisual: true },
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
  globalThis.fetch = (path, options) =>
    path.startsWith("/v1/workspace?")
      ? Promise.resolve(Response.json({}))
      : handler(path, options);
  const app = await import(`../app.js?passwordless-${fixture++}`);
  document.dispatchEvent(new dom.window.Event("DOMContentLoaded"));
  const submit = (selector) =>
    document
      .querySelector(selector)
      .dispatchEvent(
        new dom.window.Event("submit", { bubbles: true, cancelable: true }),
      );
  return { app, dom, submit };
}
test("email-code login validates email, handles delivery failure, retries codes, and reports a missing session", async (t) => {
  let failSend = true,
    sendCount = 0,
    verifyCount = 0,
    valid = false;
  const { submit } = await setup(t, "/login", async (path, options = {}) => {
    if (path === "/v1/me") return Response.json({}, { status: 401 });
    if (path === "/v1/auth/methods")
      return Response.json({ google: false, emailOtp: true });
    if (path === "/v1/auth/otp/request") {
      sendCount++;
      assert.deepEqual(JSON.parse(options.body), {
        email: "teacher@example.com",
      });
      return failSend
        ? Response.json({ error: "Delivery unavailable" }, { status: 503 })
        : Response.json({ ok: true });
    }
    if (path === "/v1/auth/otp/verify") {
      verifyCount++;
      assert.deepEqual(JSON.parse(options.body), {
        email: "teacher@example.com",
        code: valid ? "123456" : "000000",
      });
      return valid
        ? Response.json({ ok: true })
        : Response.json({ error: "Invalid or expired code" }, { status: 400 });
    }
    throw Error("Unexpected endpoint " + path);
  });
  await until(() => document.querySelector("#login-email"));
  submit("#view-root form");
  assert.equal(sendCount, 0);
  document.querySelector("#login-email").value = "teacher@example.com";
  submit("#view-root form");
  await until(() => !document.querySelector(".form-error").hidden);
  assert.match(
    document.querySelector(".form-error").textContent,
    /Delivery unavailable/,
  );
  failSend = false;
  submit("#view-root form");
  await until(() => document.querySelector("#verify-code"));
  assert.equal(
    document.querySelector("#verify-email").value,
    "teacher@example.com",
  );
  submit("#view-root form");
  assert.equal(verifyCount, 0);
  document.querySelector("#verify-code").value = "000000";
  submit("#view-root form");
  await until(() => !document.querySelector(".form-error").hidden);
  assert.match(document.querySelector(".form-error").textContent, /expired/);
  valid = true;
  document.querySelector("#verify-code").value = "123456";
  submit("#view-root form");
  await until(() => document.querySelector(".form-success"));
  assert.match(
    document.querySelector("#view-root").textContent,
    /sign in to continue/i,
  );
  assert.equal(
    document.querySelector("#view-root .btn--primary").getAttribute("href"),
    "#/login",
  );
});

test("Google signup fills the verified profile, omits passwords, and enters onboarding after session confirmation", async (t) => {
  let signed = false;
  const { app, submit } = await setup(
    t,
    "/register?google=profile",
    async (path, options = {}) => {
      if (path === "/v1/me")
        return signed
          ? Response.json({
              user: {
                id: "google-user",
                email: "teacher@example.com",
                emailVerified: true,
              },
              address: {},
            })
          : Response.json({}, { status: 401 });
      if (path === "/v1/auth/google/pending")
        return Response.json({
          email: "teacher@example.com",
          firstName: "Test",
          lastName: "Teacher",
        });
      if (path === "/v1/auth/methods")
        return Response.json({ google: true, emailOtp: true });
      if (path === "/v1/config")
        return Response.json({ bot: { registrationRequired: false } });
      if (path === "/v1/auth/passwordless/register") {
        const body = JSON.parse(options.body);
        assert.equal(body.email, "teacher@example.com");
        assert.equal("password" in body, false);
        signed = true;
        return Response.json(
          { ok: true, verificationRequired: false },
          { status: 201 },
        );
      }
      if (path === "/v1/me/preferences")
        return Response.json({ preferences: {} });
      throw Error("Unexpected endpoint " + path);
    },
  );
  await until(() => document.querySelector("#reg-email"));
  assert.equal(
    document.querySelector("#reg-email").value,
    "teacher@example.com",
  );
  assert.equal(document.querySelector("#reg-email").readOnly, true);
  assert.equal(document.querySelector("#reg-password"), null);
  document.querySelector("#reg-username").value = "teacher";
  document.querySelector("#reg-dob").value = "2000-01-01";
  submit("#view-root form");
  await until(() => location.hash === "#/onboarding");
  assert.equal(app.state.user.id, "google-user");
});

test("Google errors leave email sign-in available and disabled Google configuration hides its button", async (t) => {
  await setup(t, "/login?google=error", async (path) =>
    path === "/v1/me"
      ? Response.json({}, { status: 401 })
      : Response.json({ google: false }),
  );
  await until(() => document.querySelector("#login-email"));
  assert.match(
    document.querySelector(".form-error").textContent,
    /Google sign-in did not finish/,
  );
  const google = [...document.querySelectorAll("button")].find(
    (b) => b.textContent === "Continue with Google",
  );
  assert.ok(google.hidden);
  assert.ok(
    document
      .querySelector("#login-email")
      .closest("form")
      .querySelector('[type="submit"]'),
  );
});

test("successful email-code sign-in shows loading and automatically opens the dashboard", async (t) => {
  let signed = false;
  let releaseSession;
  const sessionReady = new Promise((resolve) => {
    releaseSession = resolve;
  });
  const { app, submit } = await setup(t, "/email-code", async (path) => {
    if (path === "/v1/me") {
      if (signed) await sessionReady;
      return signed
        ? Response.json({
            user: {
              id: "email-user",
              email: "teacher@example.com",
              emailVerified: true,
            },
            address: {},
          })
        : Response.json({}, { status: 401 });
    }
    if (path === "/v1/auth/otp/verify") {
      signed = true;
      return Response.json({ ok: true, newAccount: false });
    }
    throw Error("Unexpected endpoint " + path);
  });
  await until(() => document.querySelector("#verify-code"));
  document.querySelector("#verify-email").value = "teacher@example.com";
  document.querySelector("#verify-code").value = "123456";
  submit("#view-root form");
  await until(() =>
    document.querySelector('progress[aria-label="Signing you in"]'),
  );
  assert.equal(
    document.querySelector("#view-root h1").textContent,
    "Signing you in…",
  );
  releaseSession();
  await until(() => document.querySelector(".workspace-home"));
  assert.equal(app.state.user.id, "email-user");
  assert.equal(location.hash, "#/dashboard");
  assert.equal(document.querySelector("progress"), null);
});

for (const scenario of ["create", "skip", "existing", "unsupported"])
  test(`email OTP passkey offer: ${scenario}`, async (t) => {
    let signed = false;
    let createCalls = 0;
    let verified = false;
    const { dom, submit } = await setup(t, "/email-code", async (path) => {
      if (path === "/v1/me")
        return signed
          ? Response.json({
              user: {
                id: "passkey-user",
                emailVerified: true,
                hasPasskey: scenario === "existing",
              },
              address: {},
            })
          : Response.json({}, { status: 401 });
      if (path === "/v1/auth/otp/verify") {
        signed = true;
        return Response.json({ ok: true });
      }
      if (path === "/v1/auth/passkeys/register/options")
        return Response.json({
          challenge: "AQID",
          user: { id: "BAUG" },
          rp: { id: "localhost" },
        });
      if (path === "/v1/auth/passkeys/register/verify") {
        verified = true;
        return Response.json({ ok: true });
      }
      throw Error("Unexpected endpoint " + path);
    });
    if (scenario !== "unsupported") {
      dom.window.PublicKeyCredential = function () {};
      Object.defineProperty(dom.window.navigator, "credentials", {
        value: {
          async create() {
            createCalls++;
            if (createCalls === 1)
              throw Object.assign(new Error(), { name: "NotAllowedError" });
            return {
              id: "AQID",
              rawId: new Uint8Array([1, 2, 3]).buffer,
              type: "public-key",
              response: {
                clientDataJSON: new Uint8Array([1]).buffer,
                attestationObject: new Uint8Array([2]).buffer,
              },
            };
          },
        },
      });
    }
    await until(() => document.querySelector("#verify-code"));
    document.querySelector("#verify-email").value = "teacher@example.com";
    document.querySelector("#verify-code").value = "123456";
    submit("#view-root form");
    await until(() => document.querySelector(".workspace-home"));
    const offer = document.querySelector('[aria-label="Set up a passkey"]');
    if (scenario === "existing" || scenario === "unsupported") {
      assert.equal(offer, null);
      return;
    }
    assert.ok(offer);
    assert.equal(createCalls, 0, "device prompt requires an explicit click");
    assert.equal(location.hash, "#/dashboard");
    if (scenario === "skip") {
      offer.querySelector(".btn--ghost").click();
      assert.equal(offer.isConnected, false);
      assert.equal(createCalls, 0);
      return;
    }
    offer.querySelector("button").click();
    await until(() => !offer.querySelector(".form-error").hidden);
    assert.match(offer.textContent, /cancelled/);
    assert.equal(verified, false);
    offer.querySelector("button").click();
    await until(() => offer.textContent.includes("Passkey created"));
    assert.equal(verified, true);
    assert.equal(createCalls, 2);
  });

test("Google start sends no JSON content type without a body and recovers from a provider error", async (t) => {
  let started = false;
  await setup(t, "/login", async (path, options = {}) => {
    if (path === "/v1/me") return Response.json({}, { status: 401 });
    if (path === "/v1/auth/methods") return Response.json({ google: true });
    if (path === "/v1/auth/google/start") {
      assert.equal(options.method, "POST");
      assert.equal(options.body, undefined);
      assert.equal(new Headers(options.headers).has("content-type"), false);
      started = true;
      return Response.json(
        { error: "Google temporarily unavailable" },
        { status: 503 },
      );
    }
    throw Error("Unexpected endpoint " + path);
  });
  const googleButton = () =>
    [...document.querySelectorAll("button")].find(
      (b) => b.textContent === "Continue with Google",
    );
  await until(() => googleButton() && !googleButton().hidden);
  googleButton().click();
  await until(() => started && !googleButton().disabled);
  assert.match(
    document.querySelector("#toast").textContent,
    /Google temporarily unavailable/,
  );
});

for (const hasPassword of [false, true])
  test(`account settings offer actual credentials (password=${hasPassword}) and keep email pending`, async (t) => {
    let requested = false;
    const user = {
      id: "settings-user",
      email: "old@example.com",
      username: "teacher",
      firstName: "Test",
      lastName: "Teacher",
      emailVerified: true,
      hasPassword,
      hasPasskey: false,
    };
    const { dom, submit } = await setup(
      t,
      "/account",
      async (path, options = {}) => {
        if (path === "/v1/me") return Response.json({ user, address: {} });
        if (path === "/v1/me/email") {
          assert.deepEqual(JSON.parse(options.body), {
            email: "new@example.com",
          });
          requested = true;
          return Response.json({ ok: true, emailVerificationRequired: true });
        }
        if (
          path === "/v1/auth/otp/reauth/request" ||
          path === "/v1/auth/otp/verify"
        )
          return Response.json({ ok: true });
        return Response.json({
          preferences: {},
          passkeys: [],
          sessions: [],
          devices: [],
          pending: [],
          events: [],
        });
      },
    );
    dom.window.HTMLDialogElement.prototype.showModal = function () {
      this.open = true;
    };
    dom.window.HTMLDialogElement.prototype.close = function () {
      this.open = false;
      this.dispatchEvent(new dom.window.Event("close"));
    };
    await until(() => document.querySelector("#email-new"));
    assert.equal(Boolean(document.querySelector("#password-current")), false);
    assert.equal(document.querySelector("#email-current-password"), null);
    document.querySelector("#email-new").value = "new@example.com";
    document
      .querySelector("#email-new")
      .closest("form")
      .dispatchEvent(
        new dom.window.Event("submit", { bubbles: true, cancelable: true }),
      );
    await until(() => document.querySelector("#confirm-dialog").open);
    assert.equal(
      document
        .querySelector("#confirm-dialog-extra")
        .textContent.includes("password"),
      false,
    );
    assert.equal(
      document
        .querySelector("#confirm-dialog-extra")
        .textContent.includes("passkey"),
      false,
    );
    submit("#confirm-dialog-form");
    await until(() => document.querySelector("#confirm-dialog-password"));
    document.querySelector("#confirm-dialog-password").value = "123456";
    submit("#confirm-dialog-form");
    await until(
      () =>
        requested &&
        document.body.textContent.includes("Your current email remains active"),
    );
    assert.equal(location.hash, "#/account");
  });
