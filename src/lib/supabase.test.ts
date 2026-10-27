import { describe, expect, it } from "vitest";
import {
  buildAuthRedirectUrl,
  createAuthSessionStorage,
  isGuestModeAllowed,
  validateSupabaseConfiguration,
} from "./supabase";

const PUBLIC_KEY = "sb_publishable_synthetic_public_key_123456789";
const CONFIG_URL = "https://project.example.supabase.co";
function legacyKey(role: string) {
  const payload = btoa(JSON.stringify({ role }))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  return `synthetic_header.${payload}.synthetic_signature`;
}

describe("safe public Supabase configuration", () => {
  it("allows the guest demo only when both public configuration values are absent", () => {
    expect(isGuestModeAllowed({})).toBe(true);
    expect(isGuestModeAllowed({ url: "", publishableKey: "" })).toBe(true);
    expect(isGuestModeAllowed({ url: undefined, publishableKey: null })).toBe(
      true,
    );
    expect(
      isGuestModeAllowed({ url: CONFIG_URL, publishableKey: PUBLIC_KEY }),
    ).toBe(false);
    expect(isGuestModeAllowed({ url: CONFIG_URL })).toBe(false);
    expect(isGuestModeAllowed({ publishableKey: PUBLIC_KEY })).toBe(false);
    expect(
      isGuestModeAllowed({ url: "invalid", publishableKey: "invalid" }),
    ).toBe(false);
    expect(isGuestModeAllowed({ url: " " })).toBe(false);
    expect(isGuestModeAllowed({ publishableKey: false })).toBe(false);
  });

  it("accepts HTTPS project roots and custom HTTPS domains with a publishable key", () => {
    expect(validateSupabaseConfiguration(CONFIG_URL, PUBLIC_KEY)).toMatchObject(
      { configured: true, error: null, url: CONFIG_URL },
    );
    expect(
      validateSupabaseConfiguration("https://auth.example.com/", PUBLIC_KEY),
    ).toMatchObject({ configured: true, url: "https://auth.example.com" });
  });

  it.each(["", undefined, null])(
    "requires URL and public key configuration",
    (value) => {
      expect(validateSupabaseConfiguration(value, PUBLIC_KEY).configured).toBe(
        false,
      );
      expect(validateSupabaseConfiguration(CONFIG_URL, value).configured).toBe(
        false,
      );
    },
  );

  it.each([
    "http://project.example.com",
    "http://localhost:54321",
    "javascript:alert(1)",
    "https://user:password@example.com",
    "https://example.com/auth/v1",
    "https://example.com/?key=private",
    "https://example.com/#private",
    "not a URL",
  ])("rejects an unsafe project URL without echoing it", (url) => {
    const result = validateSupabaseConfiguration(url, PUBLIC_KEY);
    expect(result.configured).toBe(false);
    expect(result.error).not.toContain(url);
    expect(result.url).toBeNull();
    expect(result.publishableKey).toBeNull();
  });

  it("accepts a legacy anon key and rejects administrator or authenticated-user tokens", () => {
    expect(
      validateSupabaseConfiguration(CONFIG_URL, legacyKey("anon")).configured,
    ).toBe(true);
    const service = validateSupabaseConfiguration(
      CONFIG_URL,
      legacyKey("service_role"),
    );
    expect(service.configured).toBe(false);
    expect(service.error).toContain("管理者");
    expect(service.publishableKey).toBeNull();
    expect(
      validateSupabaseConfiguration(CONFIG_URL, legacyKey("authenticated"))
        .configured,
    ).toBe(false);
    const secret = validateSupabaseConfiguration(
      CONFIG_URL,
      "sb_secret_x",
    );
    expect(secret.configured).toBe(false);
    expect(secret.error).toContain("管理者");
    expect(secret.publishableKey).toBeNull();
  });

  it.each([
    "random-key",
    "sb_publishable_short",
    "broken.jwt.payload",
    "x.%%%%.x",
    "x.bnVsbA.x",
  ])("rejects malformed public keys", (key) => {
    const result = validateSupabaseConfiguration(CONFIG_URL, key);
    expect(result.configured).toBe(false);
    expect(result.error).not.toContain(key);
  });
});

describe("same-origin auth callback URL", () => {
  it("honors root and subpath deployments with a normalized trailing slash", () => {
    expect(buildAuthRedirectUrl("https://app.example.com", "/")).toBe(
      "https://app.example.com/",
    );
    expect(buildAuthRedirectUrl("https://app.example.com", "/navi")).toBe(
      "https://app.example.com/navi/",
    );
    expect(buildAuthRedirectUrl("https://app.example.com", "/apps/navi/")).toBe(
      "https://app.example.com/apps/navi/",
    );
    expect(buildAuthRedirectUrl("http://localhost:5173", "/navi/")).toBe(
      "http://localhost:5173/navi/",
    );
  });

  it("resolves a relative Vite base against the actual root or GitHub Pages subpath", () => {
    expect(buildAuthRedirectUrl("https://app.example.com", "./", "/")).toBe(
      "https://app.example.com/",
    );
    expect(
      buildAuthRedirectUrl("https://app.example.com", "./", "/-navi-/"),
    ).toBe("https://app.example.com/-navi-/");
    expect(
      buildAuthRedirectUrl(
        "https://app.example.com",
        "./",
        "/-navi-/index.html",
      ),
    ).toBe("https://app.example.com/-navi-/");
    expect(
      buildAuthRedirectUrl("https://app.example.com", "", "/apps/navi/"),
    ).toBe("https://app.example.com/apps/navi/");
    expect(
      buildAuthRedirectUrl("https://app.example.com", "./", "//evil.example"),
    ).toBeNull();
    expect(
      buildAuthRedirectUrl(
        "https://app.example.com",
        "./",
        "/-navi-/?next=evil",
      ),
    ).toBeNull();
  });

  it.each([
    "//evil.example",
    "https://evil.example/",
    "/\\evil.example",
    "/navi?next=https://evil.example",
    "/navi#token",
    "/%2f%2fevil.example",
    "/../private",
    "/navi/%2e%2e/private",
    "navi/",
    " /navi/",
    "/%broken",
  ])("rejects unsafe app base paths: %s", (base) => {
    expect(buildAuthRedirectUrl("https://app.example.com", base)).toBeNull();
  });

  it.each([
    "https://user:pass@app.example.com",
    "https://app.example.com/other",
    "https://app.example.com?next=private",
    "http://public.example.com",
    "javascript:alert(1)",
  ])("rejects unsafe origins", (origin) => {
    expect(buildAuthRedirectUrl(origin, "/")).toBeNull();
  });
});

describe("document-isolated auth channels with sessionStorage persistence", () => {
  function memoryStorage(entries: [string, string][] = []) {
    const data = new Map(entries);
    return {
      data,
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => {
        data.set(key, value);
      },
      removeItem: (key: string) => {
        data.delete(key);
      },
    };
  }

  it("keeps stable persisted session keys while giving each document a unique SDK channel", () => {
    const sessionStorage = memoryStorage();
    const first = createAuthSessionStorage(
      sessionStorage,
      "project.example.com",
      "document-one",
    );
    const reloaded = createAuthSessionStorage(
      sessionStorage,
      "project.example.com",
      "document-two",
    );
    expect(first.storageKey).not.toBe(reloaded.storageKey);
    expect(first.persistedKey).toBe(reloaded.persistedKey);
    first.storage.setItem(first.storageKey, "synthetic-session");
    expect(reloaded.storage.getItem(reloaded.storageKey)).toBe(
      "synthetic-session",
    );
    expect([...sessionStorage.data.keys()]).toEqual([first.persistedKey]);
  });

  it("does not share channel identities or mutable storage after a tab is duplicated", () => {
    const originalStorage = memoryStorage();
    const original = createAuthSessionStorage(
      originalStorage,
      "project.example.com",
      "original-document",
    );
    original.storage.setItem(original.storageKey, "synthetic-user-A-session");
    const duplicatedStorage = memoryStorage([
      ...originalStorage.data.entries(),
    ]);
    const duplicate = createAuthSessionStorage(
      duplicatedStorage,
      "project.example.com",
      "duplicate-document",
    );
    expect(duplicate.storageKey).not.toBe(original.storageKey);
    expect(duplicate.storage.getItem(duplicate.storageKey)).toBe(
      "synthetic-user-A-session",
    );
    duplicate.storage.setItem(duplicate.storageKey, "synthetic-user-B-session");
    expect(original.storage.getItem(original.storageKey)).toBe(
      "synthetic-user-A-session",
    );
    expect(duplicate.storage.getItem(duplicate.storageKey)).toBe(
      "synthetic-user-B-session",
    );
  });

  it("maps SDK-owned auxiliary keys and preserves unrelated browser state", () => {
    const sessionStorage = memoryStorage([["another-app", "keep"]]);
    const adapter = createAuthSessionStorage(
      sessionStorage,
      "project.example.com",
      "current-document",
    );
    adapter.storage.setItem(`${adapter.storageKey}-user`, "synthetic-user");
    expect(sessionStorage.data.get(`${adapter.persistedKey}-user`)).toBe(
      "synthetic-user",
    );
    adapter.storage.removeItem(`${adapter.storageKey}-user`);
    expect(sessionStorage.data.has(`${adapter.persistedKey}-user`)).toBe(false);
    expect(adapter.storage.getItem("another-app")).toBeNull();
    expect(() => adapter.storage.setItem("another-app", "overwrite")).toThrow(
      "Unexpected",
    );
    adapter.storage.removeItem("another-app");
    expect(sessionStorage.data.get("another-app")).toBe("keep");
  });
});
