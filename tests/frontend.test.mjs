import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
const tick = () => new Promise((r) => setTimeout(r, 25));
test("homepage survives API outages and two-step sign-in handles validation, errors and success", async () => {
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
  let loginMode = "invalid";
  const requests = [];
  globalThis.fetch = async (path, options = {}) => {
    requests.push({ path, options });
    if (path === "/v1/me") {
      if (mode === "signed-in")
        return Response.json({
          user: { id: "teacher", firstName: "Teacher", emailVerified: true },
          address: {},
        });
      return new Response("{}", { status: mode === "offline" ? 503 : 401 });
    }
    if (path === "/v1/auth/authenticator/login" && loginMode !== "approval") {
      if (loginMode === "invalid")
        return Response.json(
          { error: "Invalid email or authenticator code." },
          { status: 401 },
        );
      if (loginMode === "success") mode = "signed-in";
      return Response.json({ user: { id: "teacher" } });
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
      return Response.json({ preferences: {} });
    if (path === "/v1/auth/authenticator/login")
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
    b.textContent.includes("Share Chix"),
  );
  assert.ok(share, "homepage exposes the Chix share button");
  share.click();
  await tick();
  assert.equal(share.getAttribute("aria-expanded"), "true");
  assert.equal(document.querySelector(".share-panel").hidden, false);
  mode = "guest";
  location.hash = "/login";
  await tick();
  await tick();
  const email = document.querySelector("#login-email");
  const password = document.querySelector("#login-authenticator-code");
  const emailForm = email.closest("form");
  const passwordForm = password.closest("form");
  const submit = (form) =>
    form.dispatchEvent(
      new dom.window.Event("submit", { bubbles: true, cancelable: true }),
    );
  assert.equal(passwordForm.hidden, true);
  email.value = "invalid";
  emailForm.querySelector('button[type="button"]').click();
  assert.equal(passwordForm.hidden, true);
  email.value = "teacher@example.com";
  emailForm.querySelector('button[type="button"]').click();
  assert.equal(emailForm.hidden, true);
  assert.equal(passwordForm.hidden, false);
  assert.equal(document.activeElement, password);
  passwordForm.querySelector('button[type="button"]').click();
  assert.equal(emailForm.hidden, false);
  assert.equal(document.activeElement, email);
  emailForm.querySelector('button[type="button"]').click();
  submit(passwordForm);
  assert.equal(
    requests.filter((r) => r.path === "/v1/auth/authenticator/login").length,
    0,
  );
  password.value = "123456";
  submit(passwordForm);
  await tick();
  await tick();
  assert.match(
    document.querySelector(".form-error").textContent,
    /Invalid email/,
  );
  location.hash = "/login";
  await tick();
  await tick();
  document.querySelector("#login-email").value = "teacher@example.com";
  document
    .querySelector("#login-email")
    .closest("form")
    .querySelector('button[type="button"]')
    .click();
  const retryPassword = document.querySelector("#login-authenticator-code");
  retryPassword.value = "000000";
  const retryForm = retryPassword.closest("form");
  loginMode = "invalid";
  submit(retryForm);
  await tick();
  assert.match(
    document.querySelector(".form-error").textContent,
    /Invalid email/,
  );
  assert.equal(retryForm.querySelector('[type="submit"]').disabled, false);
  loginMode = "missing-session";
  submit(retryForm);
  await tick();
  assert.equal(location.hash, "#/login");
  assert.match(
    document.querySelector(".form-error").textContent,
    /allow cookies/,
  );
  loginMode = "success";
  retryPassword.value = "123456";
  submit(retryForm);
  await tick();
  await tick();
  assert.equal(location.hash, "#/dashboard");
  assert.match(document.querySelector("#toast").textContent, /Welcome back/);
  // Leave the view to stop its polling timer before disposing the DOM.
  location.hash = "/";
  await tick();
  await tick();
  dom.window.close();
});
