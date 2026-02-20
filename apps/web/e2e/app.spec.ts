import { expect, test } from "@playwright/test";

const ACCEPT_ALL_CONSENT = {
  consent: {
    essential: true,
    analytics: true,
    ads_nonpersonalized: true,
    ads_personalized: true
  },
  at: 1_770_000_000_000
};

test.beforeEach(async ({ page }) => {
  await page.route("**/api/feed**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          items: [
            {
              item_id: "itm-gdelt-1",
              item_type: "gdelt_link",
              event_time: "2026-02-16T10:00:00Z",
              headline: "NVIDIA index activity (10-minute): 84 mentions",
              summary: "Detected via index metadata. Open original sources for full coverage.",
              meta: { query: "NVIDIA", mention_count: 84, source_count: 3 },
              external_url: "https://api.gdeltproject.org/api/v2/doc/doc?query=NVIDIA&mode=artlist&format=html&sort=datedesc&maxrecords=5",
              entities: [{ slug: "nvidia", name: "NVIDIA", primary_ticker: "NVDA" }],
              source: { name: "GDELT", policy_url: "https://www.gdeltproject.org/about.html" },
              license: {
                code: "GDELT",
                commercial_status: "allowed",
                attribution_text: "Index data: GDELT (citation + link)."
              }
            }
          ],
          next_cursor: null
        },
        meta: {
          generated_at: "2026-02-16T00:00:00Z",
          cursor: null,
          cache: { hit: false, ttl: 60 }
        }
      })
    });
  });

  await page.route("**/api/indicators/key", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          cards: [
            {
              series_id: "US_CPI_YOY",
              title: "US CPI YoY",
              latest_value: 2.7,
              period: "2026-01",
              yoy: 2.7,
              sparkline: [2.5, 2.4, 2.6, 2.8],
              source: { name: "BLS", policy_url: "https://www.bls.gov/developers/" },
              license: {
                code: "BLS_PUBLIC",
                commercial_status: "allowed",
                attribution_text: "Source: BLS."
              }
            }
          ]
        },
        meta: { generated_at: "2026-02-16T00:00:00Z", cursor: null, cache: { hit: false, ttl: 120 } }
      })
    });
  });
});

test("home renders feed and right panel indicators", async ({ page }) => {
  await page.route("**/api/geo", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: { country: "US", region_policy: "NON_EU" },
        meta: { generated_at: "2026-02-16T00:00:00Z", cursor: null, cache: { hit: false, ttl: 60 } }
      })
    });
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Market Pulse Feed" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Key Indicators" })).toBeVisible();
  await expect(page.locator(".feed-list .feed-headline").first()).toHaveText("NVIDIA Index Signal");
});

test("EU simulation blocks ad script before consent", async ({ page }) => {
  await page.route("**/api/geo", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: { country: "DE", region_policy: "EU_UK_CH" },
        meta: { generated_at: "2026-02-16T00:00:00Z", cursor: null, cache: { hit: false, ttl: 60 } }
      })
    });
  });

  await page.goto("/");
  await expect(page.getByText("Consent required in DE")).toBeVisible();
  await expect(page.locator("script[data-ofp-ad-script='1']")).toHaveCount(0);
});

test("EU simulation loads ad script only after TCF signal and consent", async ({ page }) => {
  await page.addInitScript(() => {
    (window as Window & { __tcfapi?: (...args: unknown[]) => void }).__tcfapi = (
      command: string,
      _version: number,
      callback: (payload: unknown, success: boolean) => void
    ) => {
      if (command === "getTCData") {
        callback(
          {
            tcString: "CPXxRfAPXxRfAAfKABENB-CgAAAAAAAAAAYgAAAAAAAA",
            gdprApplies: true
          },
          true
        );
        return;
      }
      callback(null, false);
    };
  });

  await page.route("**/api/geo", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: { country: "DE", region_policy: "EU_UK_CH", us_state_code: null, us_state_privacy_required: false },
        meta: { generated_at: "2026-02-16T00:00:00Z", cursor: null, cache: { hit: false, ttl: 60 } }
      })
    });
  });

  await page.goto("/");
  await expect(page.locator("script[data-ofp-ad-slot='home-inline-1']")).toHaveCount(0);
  await page.getByRole("button", { name: "Accept All" }).click();

  const script = page.locator("script[data-ofp-ad-slot='home-inline-1']");
  await expect(script).toHaveCount(1);
  await expect(script).toHaveAttribute("data-cmp-mode", "EU_UK_CH");
  await expect(script).toHaveAttribute("data-ofp-cmp-tcf", /CPXxRfA/);
});

test("resetting consent keeps ad script blocked after returning from privacy page", async ({ page }) => {
  await page.addInitScript((consentPayload) => {
    try {
      localStorage.setItem("ofp_consent_v1", JSON.stringify(consentPayload));
      (window as Window & { __tcfapi?: (...args: unknown[]) => void }).__tcfapi = (
        command: string,
        _version: number,
        callback: (payload: unknown, success: boolean) => void
      ) => {
        if (command === "getTCData") {
          callback({ tcString: "CPXxRfAPXxRfAAfKABENB-CgAAAAAAAAAAYgAAAAAAAA" }, true);
          return;
        }
        callback(null, false);
      };
    } catch {
      // ignore storage init failures in opaque origins during pre-navigation bootstrap
    }
  }, ACCEPT_ALL_CONSENT);

  await page.route("**/api/geo", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: { country: "DE", region_policy: "EU_UK_CH", us_state_code: null, us_state_privacy_required: false },
        meta: { generated_at: "2026-02-16T00:00:00Z", cursor: null, cache: { hit: false, ttl: 60 } }
      })
    });
  });

  await page.goto("/");
  await expect(page.locator("script[data-ofp-ad-slot='home-inline-1']")).toHaveCount(1);

  await page.goto("/privacy");
  await page.getByRole("button", { name: "Reset Decision" }).click();
  await expect(page.locator("script[data-ofp-ad-slot='home-inline-1']")).toHaveCount(0);

  await page.getByRole("link", { name: "Home" }).click();
  await expect(page.locator("script[data-ofp-ad-slot='home-inline-1']")).toHaveCount(0);
});

test("US state privacy simulation blocks ad script without GPP/USP signal", async ({ page }) => {
  await page.addInitScript((consentPayload) => {
    try {
      localStorage.setItem("ofp_consent_v1", JSON.stringify(consentPayload));
    } catch {
      // ignore storage init failures in opaque origins during pre-navigation bootstrap
    }
  }, ACCEPT_ALL_CONSENT);

  await page.route("**/api/geo", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: { country: "US", region_policy: "US_STATE_PRIVACY", us_state_code: "CA", us_state_privacy_required: true },
        meta: { generated_at: "2026-02-16T00:00:00Z", cursor: null, cache: { hit: false, ttl: 60 } }
      })
    });
  });

  await page.goto("/");
  await expect(page.locator("script[data-ofp-ad-slot='home-inline-1']")).toHaveCount(0);
  await expect(page.getByText("US privacy signal missing. Script blocked.")).toBeVisible();
});

test("US state privacy simulation loads ad script when GPP signal is available", async ({ page }) => {
  await page.addInitScript((consentPayload) => {
    try {
      localStorage.setItem("ofp_consent_v1", JSON.stringify(consentPayload));
      (window as Window & { __gpp?: (...args: unknown[]) => void }).__gpp = (
        command: string,
        callback: (payload: unknown, success: boolean) => void
      ) => {
        if (command === "getGPPData") {
          callback(
            {
              gppString: "DBABLA~CPXxRfAPXxRfAAfKABENB-CgAAAAAAAAAAYgAAAAAAAA",
              applicableSections: [7, 8]
            },
            true
          );
          return;
        }
        callback(null, false);
      };
    } catch {
      // ignore storage init failures in opaque origins during pre-navigation bootstrap
    }
  }, ACCEPT_ALL_CONSENT);

  await page.route("**/api/geo", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: { country: "US", region_policy: "US_STATE_PRIVACY", us_state_code: "CA", us_state_privacy_required: true },
        meta: { generated_at: "2026-02-16T00:00:00Z", cursor: null, cache: { hit: false, ttl: 60 } }
      })
    });
  });

  await page.goto("/");
  const script = page.locator("script[data-ofp-ad-slot='home-inline-1']");
  await expect(script).toHaveCount(1);
  await expect(script).toHaveAttribute("data-cmp-mode", "US_STATE_PRIVACY");
  await expect(script).toHaveAttribute("data-ofp-cmp-gpp", /DBABLA/);
});

test("external links are safe", async ({ page }) => {
  await page.route("**/api/geo", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: { country: "US", region_policy: "NON_EU" },
        meta: { generated_at: "2026-02-16T00:00:00Z", cursor: null, cache: { hit: false, ttl: 60 } }
      })
    });
  });

  await page.goto("/");
  const link = page.locator("a.external-link").first();
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", "noopener noreferrer");
});
