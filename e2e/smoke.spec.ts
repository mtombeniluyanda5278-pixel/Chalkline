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

  test("sign-in offers every passwordless method", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Email me a sign-in code/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /authenticator app/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /passkey/i }),
    ).toBeVisible();
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
