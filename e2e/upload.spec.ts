import { test, expect } from "@playwright/test";
import {
  newAccount,
  registerVerified,
  deleteAccount,
  signInCode,
} from "./helpers";

// The flows that were broken in production and had no browser-level coverage.
test.describe("authenticated flows", () => {
  const created: string[] = [];
  test.afterAll(async () => {
    for (const email of created) await deleteAccount(email);
  });

  test("a verified account can upload a file", async ({ request }) => {
    const account = newAccount();
    created.push(account.email);
    await registerVerified(request, account);

    const response = await request.post("/v1/resources", {
      multipart: {
        file: {
          name: "worksheet.txt",
          mimeType: "text/plain",
          buffer: Buffer.from("Grade 10 electrostatics worksheet"),
        },
      },
    });

    expect(response.status(), await response.text()).toBe(202);
    const item = (await response.json()).item;
    expect(item.title).toBe("worksheet.txt");
    expect(Number(item.size_bytes)).toBe(33);
  });

  test("uploads are rejected without a session", async ({ request }) => {
    const response = await request.post("/v1/resources", {
      multipart: {
        file: {
          name: "worksheet.txt",
          mimeType: "text/plain",
          buffer: Buffer.from("no session"),
        },
      },
      headers: { cookie: "" },
    });
    expect([401, 403]).toContain(response.status());
  });

  test("email one-time code signs a returning teacher in", async ({
    request,
  }) => {
    const account = newAccount();
    created.push(account.email);
    await registerVerified(request, account);

    const requested = await request.post("/v1/auth/otp/request", {
      data: { email: account.email },
    });
    expect(requested.status()).toBe(200);

    const verified = await request.post("/v1/auth/otp/verify", {
      data: { email: account.email, code: await signInCode(account.email) },
    });
    expect(verified.status(), await verified.text()).toBe(200);

    const me = await request.get("/v1/me");
    expect(me.status()).toBe(200);
    expect((await me.json()).user.email).toBe(account.email);
  });

  test("a signed-in teacher reaches the workspace", async ({ page }) => {
    const account = newAccount();
    created.push(account.email);
    // page.request shares the page's cookie jar; the top-level `request`
    // fixture is a separate context and would leave the browser signed out.
    await registerVerified(page.request, account);

    await page.goto("/#/dashboard");
    const nav = page.getByRole("navigation");
    await expect(nav.getByRole("link", { name: "Lesson plans" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Files" })).toBeVisible();
  });
});
