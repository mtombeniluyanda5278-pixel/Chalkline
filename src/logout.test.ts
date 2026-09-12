import { registerVerifiedAccount } from "./testAccounts.js";
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { buildApp } from "./app.js";
import { pool } from "./db.js";
import { createSession, hashToken } from "./sessions.js";
import { connectRedis, closeRedis, clearTestRateLimits } from "./rateLimit.js";

const { JSDOM, CookieJar } = createRequire(import.meta.url)("jsdom");
const app = await buildApp();
const users: string[] = [];
const origin = "http://app.example.test";
before(connectRedis);
beforeEach(clearTestRateLimits);
after(async () => {
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [users]);
  await app.close();
  await closeRedis();
  await pool.end();
});

async function browserSession() {
  const jar = new CookieJar();
  const requests: { path: string; status: number }[] = [];
  async function request(path: string, method = "GET", payload?: object) {
    const response = await app.inject({
      method: method as "GET" | "POST",
      url: path,
      headers: { cookie: jar.getCookieStringSync(origin + path) },
      ...(payload === undefined ? {} : { payload }),
    });
    for (const cookie of [response.headers["set-cookie"]]
      .flat()
      .filter(Boolean)) {
      jar.setCookieSync(cookie, origin + path);
    }
    requests.push({ path, status: response.statusCode });
    return response;
  }
  const suffix = randomUUID().slice(0, 8);
  const registered = await registerVerifiedAccount(app, {
    firstName: "Refresh",
    lastName: "Test",
    country: "ZA",
    dateOfBirth: "2000-01-01",
    email: `logout-${suffix}@example.com`,
    username: `r.${suffix}`,
    password: "correct horse battery staple",
    confirmPassword: "correct horse battery staple",
    trustDevice: true,
  });
  for (const cookie of [registered.headers["set-cookie"]].flat().filter(Boolean)) jar.setCookieSync(cookie, origin+"/v1/auth/verify-email");
  assert.equal(registered.statusCode, 201, registered.body);
  const id = registered.json().user.id;
  users.push(id);
  const cookies = jar.getCookiesSync(origin + "/v1/me");
  const original = cookies.find(
    (c: { key: string }) => c.key === "chalkline_session",
  );
  const device = cookies.find(
    (c: { key: string }) => c.key === "chalkline_device",
  );
  assert.ok(original);
  assert.ok(device);
  return { jar, request, requests, registered, original, device, id };
}

test("A/B/C: logout destroys the original token, expires its browser cookie, and device trust cannot restore it", async () => {
  const b = await browserSession();
  for (let refresh = 0; refresh < 2; refresh++) {
    const me = await b.request("/v1/me");
    assert.equal(me.statusCode, 200);
    assert.equal(me.headers["cache-control"], "no-store");
  }
  assert.equal(
    (
      await app.inject({
        method: "GET",
        url: "/v1/me",
        headers: { cookie: b.device.cookieString() },
      })
    ).statusCode,
    401,
  );
  const logout = await b.request("/v1/auth/logout", "POST");
  assert.equal(logout.statusCode, 200, logout.body);
  const deletion = [logout.headers["set-cookie"]]
    .flat()
    .find((c) => c?.startsWith("chalkline_session="))!;
  assert.ok(deletion, "logout sends a session deletion cookie");
  const parsed = CookieJar.deserializeSync(b.jar.serializeSync());
  assert.equal(
    parsed
      .getCookiesSync(origin + "/v1/me")
      .some((c: { key: string }) => c.key === "chalkline_session"),
    false,
  );
  assert.match(deletion, /(?:^|;)\s*Path=\/(?:;|$)/i);
  assert.match(deletion, /(?:^|;)\s*HttpOnly(?:;|$)/i);
  assert.match(deletion, /(?:^|;)\s*SameSite=Strict(?:;|$)/i);
  assert.doesNotMatch(deletion, /(?:^|;)\s*Domain=/i);
  assert.ok(
    /Max-Age=0/i.test(deletion) ||
      new Date(/Expires=([^;]+)/i.exec(deletion)?.[1] ?? "").getTime() <
        Date.now(),
  );
  assert.equal(b.original.path, "/");
  assert.equal(b.original.hostOnly, true);
  assert.equal(
    (
      await pool.query("SELECT id FROM sessions WHERE token_hash=$1", [
        hashToken(b.original.value),
      ])
    ).rowCount,
    0,
  );
  const replay = await app.inject({
    method: "GET",
    url: "/v1/me",
    headers: { cookie: b.original.cookieString() },
  });
  assert.equal(replay.statusCode, 401);
  assert.match(
    b.jar.getCookieStringSync(origin + "/v1/me"),
    /chalkline_device=/,
  );
  assert.equal((await b.request("/v1/me")).statusCode, 401);
});

test("logout revokes duplicate session cookies from legacy domain/path scopes", async () => {
  for (const scope of ["Domain=example.test; Path=/", "Path=/v1"]) {
    const b = await browserSession();
    const { token: legacy } = await createSession(b.id, {});
    b.jar.setCookieSync(
      `chalkline_session=${legacy}; ${scope}; HttpOnly`,
      origin + "/v1/auth/logout",
    );
    assert.equal(
      b.jar
        .getCookiesSync(origin + "/v1/auth/logout")
        .filter((c: { key: string }) => c.key === "chalkline_session").length,
      2,
    );
    assert.equal((await b.request("/v1/auth/logout", "POST")).statusCode, 200);
    assert.equal(
      (await b.request("/v1/me")).statusCode,
      401,
      "refresh after successful logout must reject surviving legacy cookies",
    );
    for (const token of [b.original.value, legacy]) {
      assert.equal(
        (
          await app.inject({
            method: "GET",
            url: "/v1/me",
            headers: { cookie: `chalkline_session=${token}` },
          })
        ).statusCode,
        401,
      );
    }
    assert.equal((await b.request("/v1/me")).statusCode, 401);
    const login = await b.request("/v1/auth/login", "POST", {
      email: b.registered.json().user.email,
      password: "correct horse battery staple",
    });
    assert.equal(login.statusCode, 200, login.body);
    assert.equal(
      (await b.request("/v1/me")).statusCode,
      200,
      "revoked legacy cookies must not mask a new authenticated session",
    );
  }
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 10));
async function until(check: () => boolean) {
  for (let n = 0; n < 200; n++) {
    if (check()) return;
    await tick();
  }
  assert.fail("Timed out waiting for frontend state");
}

test("D/E: real frontend startup preserves a valid session, logout clears state, and a fresh page stays signed out", async () => {
  const b = await browserSession();
  const html = await readFile(
    new URL("../index.html", import.meta.url),
    "utf8",
  );
  const saved = new Map<string, PropertyDescriptor | undefined>();
  const doms: any[] = [];
  let delayNextMe = false;
  let releaseMe: (() => void) | undefined;
  let delayedMeStarted = false;
  let failLogout = false;
  const replaceGlobal = (key: string, value: unknown) => {
    if (!saved.has(key))
      saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      value,
      configurable: true,
      writable: true,
    });
  };
  replaceGlobal("fetch", async (path: string, options: any = {}) => {
    assert.equal(options.credentials, "same-origin");
    assert.equal(options.cache, "no-store");
    if (path === "/v1/auth/logout" && failLogout)
      return new Response("{}", { status: 503 });
    const r = await b.request(
      path,
      options.method,
      options.body ? JSON.parse(options.body) : undefined,
    );
    // Capture the actual authenticated response, then deliver it after logout.
    if (path === "/v1/me" && delayNextMe) {
      delayNextMe = false;
      delayedMeStarted = true;
      await new Promise<void>((resolve) => {
        releaseMe = resolve;
      });
    }
    return new Response(r.body, { status: r.statusCode });
  });
  async function startup() {
    const dom = new JSDOM(html, {
      url: origin + "/",
      pretendToBeVisual: true,
      cookieJar: b.jar,
    });
    doms.push(dom);
    for (const key of [
      "window",
      "document",
      "Node",
      "location",
      "history",
      "navigator",
    ])
      replaceGlobal(key, dom.window[key]);
    replaceGlobal(
      "requestAnimationFrame",
      dom.window.requestAnimationFrame.bind(dom.window),
    );
    // New module state and a new document emulate a full browser refresh.
    const moduleUrl =
      new URL("../app.js", import.meta.url).href + "?refresh=" + randomUUID();
    const frontend = await import(moduleUrl);
    const previous = b.requests.length;
    dom.window.document.dispatchEvent(new dom.window.Event("DOMContentLoaded"));
    await until(
      () =>
        b.requests.length > previous &&
        Boolean(dom.window.document.querySelector("#view-root h1")),
    );
    return { dom, frontend };
  }
  try {
    let page = await startup();
    assert.equal(page.frontend.state.user.id, b.id);
   assert.match(
  page.dom.window.document.querySelector("#site-nav").textContent,
  /Sign out/,
);

assert.match(
  page.dom.window.document.querySelector("#site-nav").textContent,
  /Account/,
);
    page.dom.window.close();
    page = await startup();
    assert.equal(
      page.frontend.state.user.id,
      b.id,
      "normal refresh restores authentication",
    );
    const signOut = () =>
      [...page.dom.window.document.querySelectorAll("#site-nav button")].find(
        (e: any) => e.textContent === "Sign out",
      ) as any;
    failLogout = true;
    signOut().click();
    await until(() =>
      page.dom.window.document.body.textContent.includes("Sign-out failed"),
    );
    assert.equal(
      page.frontend.state.user.id,
      b.id,
      "failed logout must not pretend to succeed",
    );
    failLogout = false;
    delayNextMe = true;
    const stale = page.frontend.loadSession();
    await until(() => delayedMeStarted);
    signOut().click();
    await until(() => page.frontend.state.user === null);
    assert.equal(page.frontend.state.address, null);
    releaseMe!();
    await stale;
    assert.equal(
      page.frontend.state.user,
      null,
      "a pre-logout response cannot resurrect auth state",
    );
    await until(() => page.dom.window.document.body.dataset.view === "home");
    assert.doesNotMatch(
  page.dom.window.document.querySelector("#site-nav").textContent,
  /Sign out/,
);

assert.doesNotMatch(
  page.dom.window.document.querySelector("#site-nav").textContent,
  /Account/,
);
    assert.equal(await page.frontend.loadSession(), false);
    assert.equal(page.frontend.state.user, null);
    page.dom.window.close();
    page = await startup();
    assert.equal(b.requests.at(-1)?.path, "/v1/me");
    assert.equal(b.requests.at(-1)?.status, 401);
    assert.equal(page.frontend.state.user, null);
    assert.equal(page.frontend.state.address, null);
    assert.match(
      page.dom.window.document.querySelector("#site-nav").textContent,
      /Sign in/,
    );
    assert.match(
      page.dom.window.document.querySelector("h1").textContent,
      /good teaching/,
    );
    assert.equal(page.dom.window.document.body.dataset.view, "home");
  } finally {
    releaseMe?.();
    for (const dom of doms) dom.window.close();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
