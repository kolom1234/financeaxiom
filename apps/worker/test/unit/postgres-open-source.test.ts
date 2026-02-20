import { describe, expect, it } from "vitest";
import { resolveOpenSourceUrl } from "../../src/services/postgres";

describe("resolveOpenSourceUrl", () => {
  it("returns direct urls for valid http links", () => {
    expect(
      resolveOpenSourceUrl({
        externalUrl: "https://example.com/article",
        itemType: "sec_filing",
        headline: "SEC filing",
        entities: []
      })
    ).toBe("https://example.com/article");
  });

  it("builds fallback gdelt search when legacy home url exists", () => {
    const resolved = resolveOpenSourceUrl({
      externalUrl: "https://www.gdeltproject.org",
      itemType: "gdelt_link",
      headline: "NVIDIA index activity (10-minute)",
      entities: []
    });
    expect(resolved).toBe(
      "https://api.gdeltproject.org/api/v2/doc/doc?query=NVIDIA&mode=artlist&format=html&sort=datedesc&maxrecords=5"
    );
  });

  it("builds fallback gdelt search from headline", () => {
    const resolved = resolveOpenSourceUrl({
      externalUrl: "about:blank",
      itemType: "gdelt_link",
      headline: "NVIDIA mentions spike",
      entities: []
    });
    expect(resolved).toBe(
      "https://api.gdeltproject.org/api/v2/doc/doc?query=NVIDIA&mode=artlist&format=html&sort=datedesc&maxrecords=5"
    );
  });

  it("normalizes legacy gdelt api URL to maxrecords=5", () => {
    const resolved = resolveOpenSourceUrl({
      externalUrl:
        "https://api.gdeltproject.org/api/v2/doc/doc?query=NVIDIA&mode=artlist&format=html&sort=datedesc&maxrecords=20",
      itemType: "gdelt_link",
      headline: "NVIDIA index activity",
      entities: []
    });
    expect(resolved).toBe(
      "https://api.gdeltproject.org/api/v2/doc/doc?query=NVIDIA&mode=artlist&format=html&sort=datedesc&maxrecords=5"
    );
  });

  it("normalizes gdelt API URLs with trailing slash path", () => {
    const resolved = resolveOpenSourceUrl({
      externalUrl: "https://api.gdeltproject.org/api/v2/doc/doc/?query=NVIDIA&mode=artlist&format=html&sort=datedesc&maxrecords=20",
      itemType: "gdelt_link",
      headline: "NVIDIA index activity",
      entities: []
    });
    expect(resolved).toBe(
      "https://api.gdeltproject.org/api/v2/doc/doc?query=NVIDIA&mode=artlist&format=html&sort=datedesc&maxrecords=5"
    );
  });

  it("builds fallback gdelt search from entity name when headline missing", () => {
    const resolved = resolveOpenSourceUrl({
      externalUrl: "https://www.gdeltproject.org/",
      itemType: "gdelt_link",
      headline: "mentions spike",
      entities: [{ name: "NVIDIA", slug: "nvidia" }]
    });
    expect(resolved).toBe(
      "https://api.gdeltproject.org/api/v2/doc/doc?query=NVIDIA&mode=artlist&format=html&sort=datedesc&maxrecords=5"
    );
  });
});
