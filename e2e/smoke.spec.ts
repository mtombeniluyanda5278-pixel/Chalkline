import { test, expect } from "@playwright/test";

// Public surfaces. These need no account and catch the failure mode that
// matters most: the app not rendering at all.
test.describe("public pages", () => {
  test("home page renders its hero and navigation", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      /Make space for/i,
    );
    // Scoped to the header: both labels also appear in the page's CTA.
    const nav = page.getByRole("navigation", { name: /account navigation/i });
    await expect(nav.getByRole("link", { name: "Sign in" })).toBeVisible();
    await expect(
      nav.getByRole("link", { name: "Create account" }),
    ).toBeVisible();
  });

  test("page title is focused without a visible ring", async ({ page }) => {
    await page.goto("/");
    // app.js moves focus to the h1 on each route change for screen readers.
    // The ring is suppressed; a regression here is visible on every page.
    const outline = await page
      .locator("h1")
      .evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).toBe("none");
  });

  // Hash routes are how the app links internally, and the only form that works
  // on static hosting as well as the dev server.
  test("sign-in asks who you are before offering any method", async ({
    page,
  }) => {
    await page.goto("/#/login");
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();

    // Nothing is offered until the account is named, so a teacher is never
    // shown a method their device cannot use.
    await expect(page.getByRole("button", { name: "Continue" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Email me a sign-in code/i }),
    ).toBeHidden();

    await page.getByLabel("Email").fill("nobody@example.com");
    await page.getByRole("button", { name: "Continue" }).click();

    // An unknown address gets the ordinary set: an emailed code, and no
    // passkey. Anything else would reveal whether the account exists.
    await expect(
      page.getByRole("button", { name: /Email me a sign-in code/i }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /passkey/i })).toBeHidden();
    await expect(
      page.getByRole("button", { name: /authenticator app/i }),
    ).toBeHidden();

    await page.getByRole("button", { name: "Change email" }).click();
    await expect(page.getByRole("button", { name: "Continue" })).toBeVisible();
  });

  test("health endpoint responds", async ({ request }) => {
    const r = await request.get("/health");
    expect(r.status()).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
  });

  test("retired password login is gone", async ({ request }) => {
    const r = await request.post("/v1/auth/login", {
      data: { email: "x@example.com", password: "x" },
    });
    expect(r.status()).toBe(404);
  });
});
