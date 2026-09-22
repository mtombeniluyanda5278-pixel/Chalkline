import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
const tick = () => new Promise((r) => setTimeout(r, 15));
async function until(fn) {
  for (let i = 0; i < 100; i++) {
    if (fn()) return;
    await tick();
  }
  assert.fail("Signup did not settle");
}
test("signup omits country and requires the emailed OTP before entering the account", async (t) => {
  const dom = new JSDOM(
    await readFile(new URL("../index.html", import.meta.url), "utf8"),
    { url: "http://127.0.0.1:3000/#/register", pretendToBeVisual: true },
  );
  t.after(() => dom.window.close());
  for (const k of [
    "window",
    "document",
    "Node",
    "location",
    "history",
    "navigator",
  ])
    Object.defineProperty(globalThis, k, {
      value: dom.window[k],
      configurable: true,
    });
  globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(
    dom.window,
  );
  let verified = false,
    registrations = 0,
    resends = 0;
  globalThis.fetch = async (path, options = {}) => {
    if (path === "/v1/me")
      return verified
        ? Response.json({
            user: {
              id: "teacher",
              email: "teacher@example.com",
              emailVerified: true,
            },
            address: {},
          })
        : Response.json({}, { status: 401 });
    if (path === "/v1/config")
      return Response.json({ bot: { registrationRequired: false } });
    if (path === "/v1/auth/passwordless/register") {
      const body = JSON.parse(options.body);
      assert.equal("country" in body, false);
      assert.equal("password" in body, false);
      assert.equal(body.email, "teacher@example.com");
      assert.equal(body.dateOfBirth, "2000-02-12");
      registrations++;
      return Response.json(
        {
          ok: true,
          verificationRequired: true,
          message: "Enter the emailed code.",
        },
        { status: 201 },
      );
    }
    if (path === "/v1/auth/otp/request") {
      assert.deepEqual(JSON.parse(options.body), {
        email: "teacher@example.com",
      });
      resends++;
      return Response.json({ ok: true });
    }
    if (path === "/v1/auth/otp/verify") {
      assert.deepEqual(JSON.parse(options.body), {
        email: "teacher@example.com",
        code: "012345",
      });
      verified = true;
      return Response.json({ ok: true });
    }
    if (path.startsWith("/v1/workspace?")) return Response.json({});
    throw Error("Unexpected endpoint " + path);
  };
  const app = await import("../app.js?signup-otp");
  document.dispatchEvent(new dom.window.Event("DOMContentLoaded"));
  await until(() => document.querySelector("#reg-email"));
  assert.equal(document.querySelector("#reg-country"), null);
  const values = {
    "reg-first-name": "Test",
    "reg-last-name": "Teacher",
    "reg-dob": "12/02/2000",
    "reg-email": "teacher@example.com",
    "reg-username": "teacher",
  };
  for (const [id, value] of Object.entries(values))
    document.getElementById(id).value = value;
  const submit = () =>
    document
      .querySelector("form")
      .dispatchEvent(
        new dom.window.Event("submit", { bubbles: true, cancelable: true }),
      );
  document.querySelector("#reg-dob").value = "31/02/2000";
  submit();
  assert.equal(registrations, 0);
  assert.match(
    document.querySelector("#reg-dob-error").textContent,
    /valid date/,
  );
  document.querySelector("#reg-dob").value = "12/02/2000";
  submit();
  await until(() => document.querySelector("#verify-code"));
  assert.equal(registrations, 1);
  assert.equal(app.state.user, null);
  assert.equal(
    document.querySelector("#verify-email").value,
    "teacher@example.com",
  );
  [...document.querySelectorAll("#view-root button")]
    .find((b) => b.textContent === "Resend code")
    .click();
  await until(() => resends === 1);
  document.querySelector("#verify-code").value = "012345";
  submit();
  await until(() => document.querySelector(".workspace-home"));
  assert.equal(location.hash, "#/dashboard");
  assert.equal(app.state.user.id, "teacher");
});
