import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const SUPABASE_SESSION = {
  access_token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLWlkIiwiZW1haWwiOiJleGlzdGluZy11c2VyQGV4YW1wbGUuY29tIiwiYXVkIjoiYXVkaWVuY2UiLCJpYXQiOjE2OTMzMDAwMDB9.sF8kN6fWqL7XGkM0NfVYj2k0jL0qHk4kqQ3J6xw8H0",
  refresh_token: "r1.example-refresh-token-v1",
  user: {
    id: "mock-user-id",
    email: "existing-user@example.com"
  },
  token_type: "bearer",
  expires_in: 3600,
  expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString()
};

async function routeSessionAuthEndpoints(page: Page): Promise<void> {
  await page.route("**/auth/v1/**", async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      await route.fulfill({
        status: 204
      });
      return;
    }

    const responsePayload = JSON.stringify({ ...SUPABASE_SESSION });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: responsePayload
    });
  });
}

async function loginFromLoginPage(page: Page): Promise<void> {
  await page.goto("/login");
  const signInSection = page.locator("section.card-stack:has-text(\"Sign in\")");
  await signInSection.getByLabel("Email").fill("existing-user@example.com");
  await signInSection.getByLabel("Password").fill("StrongPassw0rd!");
  await signInSection.getByRole("button", { name: "Login" }).click();
  await expect(page).toHaveURL(/\/alerts$/);
  await expect(page.getByText("Signed in as existing-user@example.com")).toBeVisible();
}

test("alerts login flow reports authentication failure from gateway", async ({ page }) => {
  await page.route("**/api/auth/login", async (route) => {
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({
        ok: false,
        error: {
          message: "Invalid credentials."
        }
      })
    });
  });

  await page.goto("/login");

  const signInSection = page.locator("section.card-stack:has-text(\"Sign in\")");
  await signInSection.getByLabel("Email").fill("user@example.com");
  await signInSection.getByLabel("Password").fill("Invalid-Password-123!");
  await signInSection.getByRole("button", { name: "Login" }).click();

  await expect(page.getByRole("status")).toContainText("Login failed: Invalid credentials.");
});

test("alerts signup flow reports registration failure from gateway", async ({ page }) => {
  await page.route("**/api/auth/signup", async (route) => {
    await route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({
        ok: false,
        error: {
          message: "email already exists"
        }
      })
    });
  });

  await page.goto("/signup");

  const signUpSection = page.locator("section.card-stack:has-text(\"Sign up\")");
  await signUpSection.getByLabel("Email").fill("existing-user@example.com");
  const passwordInputs = signUpSection.locator("input[type=\"password\"]");
  await passwordInputs.nth(0).fill("StrongPassw0rd!");
  await passwordInputs.nth(1).fill("StrongPassw0rd!");
  await signUpSection.getByRole("button", { name: "Create account" }).click();

  await expect(signUpSection.getByText(/Sign up failed:/)).toBeVisible();
  await expect(signUpSection.getByText("Sign up failed: email already exists")).toBeVisible();
});

test("alerts password reset flow reports success", async ({ page }) => {
  await page.route("**/api/auth/password-reset", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: { ok: true }
      })
    });
  });

  await page.goto("/forgot-password");

  const resetSection = page.locator("section.card-stack:has-text(\"Forgot password\")");
  await resetSection.getByLabel("Email").fill("user@example.com");
  await resetSection.getByRole("button", { name: "Send reset link" }).click();

  await expect(page.getByRole("status")).toContainText("Password reset email sent. Check your inbox.");
});

test("alerts password reset flow reports failure from gateway", async ({ page }) => {
  await page.route("**/api/auth/password-reset", async (route) => {
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({
        ok: false,
        error: {
          message: "temporary outage"
        }
      })
    });
  });

  await page.goto("/forgot-password");

  const resetSection = page.locator("section.card-stack:has-text(\"Forgot password\")");
  await resetSection.getByLabel("Email").fill("user@example.com");
  await resetSection.getByRole("button", { name: "Send reset link" }).click();

  await expect(page.getByRole("status")).toContainText("Password reset request failed: temporary outage");
});

test("alerts login flow can establish session and logout", async ({ page }) => {
  await routeSessionAuthEndpoints(page);

  await page.route("**/api/auth/login", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          ...SUPABASE_SESSION
        }
      })
    });
  });

  await page.route("**/api/auth/logout", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: { ok: true }
      })
    });
  });

  await loginFromLoginPage(page);
  await expect(page.getByRole("button", { name: "Logout" })).toBeEnabled();

  await page.getByRole("button", { name: "Logout" }).click();
  await expect(page.getByText("Sign in required")).toBeVisible();
});

test("alerts password change shows validation error when mismatch", async ({ page }) => {
  await routeSessionAuthEndpoints(page);

  await page.route("**/api/auth/login", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          ...SUPABASE_SESSION
        }
      })
    });
  });

  await page.route("**/api/auth/password-change", async (route) => {
    await route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({
        ok: false,
        error: {
          message: "not called in this test"
        }
      })
    });
  });

  await loginFromLoginPage(page);

  const changePasswordSection = page.locator("section.card-stack:has-text(\"Change password\")");
  const passwordInputs = changePasswordSection.locator("input[type=\"password\"]");
  await passwordInputs.nth(0).fill("StrongPassw0rd!");
  await passwordInputs.nth(1).fill("DifferentPassw0rd!");
  await changePasswordSection.getByRole("button", { name: "Update password" }).click();

  await expect(page.getByRole("status")).toContainText("Password update failed: Passwords do not match.");
});

test("alerts password change success updates session status", async ({ page }) => {
  await routeSessionAuthEndpoints(page);

  await page.route("**/api/auth/login", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          ...SUPABASE_SESSION
        }
      })
    });
  });

  await page.route("**/api/auth/password-change", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: { ok: true }
      })
    });
  });

  await loginFromLoginPage(page);

  const changePasswordSection = page.locator("section.card-stack:has-text(\"Change password\")");
  const passwordInputs = changePasswordSection.locator("input[type=\"password\"]");
  await passwordInputs.nth(0).fill("StrongPassw0rd!");
  await passwordInputs.nth(1).fill("StrongPassw0rd!");
  await changePasswordSection.getByRole("button", { name: "Update password" }).click();

  await expect(page.getByRole("status")).toContainText("Password updated.");
});

test("alerts rules load and add rule success", async ({ page }) => {
  await routeSessionAuthEndpoints(page);

  await page.route("**/api/auth/login", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          ...SUPABASE_SESSION
        }
      })
    });
  });

  await page.route("**/api/alerts/rules", async (route) => {
    const method = route.request().method().toUpperCase();
    if (method === "POST") {
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          data: {
            rule_id: "rule-1",
            rule_type: "breaking",
            enabled: true,
            rule: { tab: "breaking" }
          }
          // Load endpoint is responsible for returning canonical payload.
        })
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          rules: [
            {
              rule_id: "rule-1",
              rule_type: "breaking",
              enabled: true,
              rule: { tab: "breaking" }
            }
          ]
        }
      })
    });
  });

  await loginFromLoginPage(page);

  await page.getByRole("button", { name: "Load Rules" }).click();
  await expect(page.locator("pre").getByText("\"rule_id\": \"rule-1\"")).toBeVisible();
  await expect(page.locator("pre").getByText("\"rule_id\": \"rule-1\"")).toBeVisible();

  await page.getByRole("button", { name: "Add Breaking Rule" }).click();
  await expect(page.locator("pre").getByText("\"rule_id\": \"rule-1\"")).toBeVisible();
});

test("alerts rules load failure is surfaced", async ({ page }) => {
  await routeSessionAuthEndpoints(page);

  await page.route("**/api/auth/login", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          ...SUPABASE_SESSION
        }
      })
    });
  });

  await page.route("**/api/alerts/rules", async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({
        ok: false,
        error: {
          message: "internal server error"
        }
      })
    });
  });

  await loginFromLoginPage(page);
  await page.getByRole("button", { name: "Load Rules" }).click();
  await expect(page.getByText("Failed to load rules: internal server error")).toBeVisible();
});
