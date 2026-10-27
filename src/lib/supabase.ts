import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type SupabaseConfiguration =
  | { configured: true; error: null; url: string; publishableKey: string }
  | { configured: false; error: string; url: null; publishableKey: null };

const REQUIRED_CONFIGURATION =
  "ログインを使うには、Supabaseの接続先と公開キーの設定が必要です。";
const INVALID_URL =
  "Supabaseの接続先には、HTTPSのプロジェクトURLを設定してください。パス・認証情報・検索条件は含められません。";
const INVALID_KEY =
  "Supabaseの公開用キー（publishableキー、またはanonキー）を設定してください。";
const PRIVATE_KEY =
  "管理者用のキーはブラウザに設定できません。Supabaseの公開用キーを使用してください。";
let client: SupabaseClient | null = null;
let initializationError: string | null = null;
let recoveryUserId: string | null = null;

function invalid(error: string): SupabaseConfiguration {
  return { configured: false, error, url: null, publishableKey: null };
}

/** Validate public frontend configuration without logging or echoing its values. */
export function validateSupabaseConfiguration(
  urlValue: unknown,
  keyValue: unknown,
): SupabaseConfiguration {
  if (
    typeof urlValue !== "string" ||
    !urlValue.trim() ||
    typeof keyValue !== "string" ||
    !keyValue.trim()
  )
    return invalid(REQUIRED_CONFIGURATION);

  let url: URL;
  try {
    url = new URL(urlValue.trim());
  } catch {
    return invalid(INVALID_URL);
  }
  if (
    url.protocol !== "https:" ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    return invalid(INVALID_URL);

  const key = keyValue.trim();
  if (/^sb_secret_/i.test(key)) return invalid(PRIVATE_KEY);
  if (key.length > 4096 || /\s/.test(key)) return invalid(INVALID_KEY);
  if (/^sb_publishable_[A-Za-z0-9_-]{16,}$/.test(key)) {
    return {
      configured: true,
      error: null,
      url: url.origin,
      publishableKey: key,
    };
  }

  // Legacy anon keys are JWTs. Decoding identifies an accidentally supplied
  // administrator/user token; it does not authenticate or verify the token.
  const segments = key.split(".");
  if (
    segments.length !== 3 ||
    segments.some((segment) => !/^[A-Za-z0-9_-]+$/.test(segment))
  )
    return invalid(INVALID_KEY);
  try {
    const encoded = segments[1].replace(/-/g, "+").replace(/_/g, "/");
    const decoded = atob(
      encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "="),
    );
    const payload: unknown = JSON.parse(decoded);
    if (
      typeof payload !== "object" ||
      payload === null ||
      Array.isArray(payload)
    )
      return invalid(INVALID_KEY);
    const role = (payload as Record<string, unknown>).role;
    if (typeof role === "string" && role.toLowerCase() === "service_role")
      return invalid(PRIVATE_KEY);
    if (role !== "anon") return invalid(INVALID_KEY);
    return {
      configured: true,
      error: null,
      url: url.origin,
      publishableKey: key,
    };
  } catch {
    return invalid(INVALID_KEY);
  }
}

function configuredValues(): SupabaseConfiguration {
  return validateSupabaseConfiguration(
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  );
}

/** Only a deliberately unconnected demo may read the legacy guest cache. */
export function isGuestModeAllowed(
  values: { url?: unknown; publishableKey?: unknown } = {
    url: import.meta.env.VITE_SUPABASE_URL,
    publishableKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  },
): boolean {
  const absent = (value: unknown) =>
    value === undefined || value === null || value === "";
  return absent(values.url) && absent(values.publishableKey);
}

export function getAuthConfiguration(): {
  configured: boolean;
  error: string | null;
} {
  const config = configuredValues();
  if (!config.configured) return { configured: false, error: config.error };
  if (initializationError)
    return { configured: false, error: initializationError };
  return { configured: true, error: null };
}

type SessionStorageAdapter = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;

function documentIdentifier(): string {
  if (typeof globalThis.crypto?.randomUUID === "function")
    return globalThis.crypto.randomUUID();
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    return Array.from(
      globalThis.crypto.getRandomValues(new Uint8Array(16)),
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join("");
  }
  throw new Error("Secure browser randomness is unavailable.");
}

/**
 * The SDK uses storageKey for both persistence and BroadcastChannel. Give each
 * document its own channel, while mapping persistence to stable sessionStorage
 * keys. Even duplicated tabs with copied sessionStorage cannot broadcast a
 * different user's identity into one another. No private SDK fields are used.
 */
export function createAuthSessionStorage(
  storage: SessionStorageAdapter,
  projectHost: string,
  documentId = documentIdentifier(),
) {
  const persistedKey = `nakatsu-auth-${projectHost}-v1`;
  const storageKey = `${persistedKey}-document-${documentId}`;
  function storedKey(key: string): string | null {
    return key === storageKey || key.startsWith(`${storageKey}-`)
      ? `${persistedKey}${key.slice(storageKey.length)}`
      : null;
  }
  return {
    storageKey,
    persistedKey,
    storage: {
      getItem(key: string): string | null {
        const mapped = storedKey(key);
        return mapped === null ? null : storage.getItem(mapped);
      },
      setItem(key: string, value: string): void {
        const mapped = storedKey(key);
        if (mapped === null)
          throw new Error("Unexpected authentication storage key.");
        storage.setItem(mapped, value);
      },
      removeItem(key: string): void {
        const mapped = storedKey(key);
        if (mapped !== null) storage.removeItem(mapped);
      },
    },
  };
}

/** One real Supabase client; auth tokens are scoped to this browser tab. */
export function getSupabaseClient(): SupabaseClient | null {
  if (client) return client;
  const config = configuredValues();
  if (!config.configured || typeof window === "undefined") return null;
  try {
    // Access can throw in browsers with storage disabled. Never silently fall
    // back to persistent localStorage for authentication sessions.
    const storage = window.sessionStorage;
    const probe = "nakatsu-auth-storage-check";
    const previousProbeValue = storage.getItem(probe);
    storage.setItem(probe, "1");
    if (previousProbeValue === null) storage.removeItem(probe);
    else storage.setItem(probe, previousProbeValue);
    const sessionStorage = createAuthSessionStorage(
      storage,
      new URL(config.url).hostname,
    );
    client = createClient(config.url, config.publishableKey, {
      auth: {
        storage: sessionStorage.storage,
        storageKey: sessionStorage.storageKey,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        // Email links may open a new browser tab. Implicit email verification
        // does not depend on a PKCE verifier held in the original tab, while
        // the resulting session still remains in sessionStorage.
        flowType: "implicit",
        debug: false,
      },
    });
    // Capture URL-initialization events before React's effect subscribes.
    // In particular, do not infer recovery just from an untrusted URL flag.
    client.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY")
        recoveryUserId = session?.user.id ?? null;
      if (
        event === "SIGNED_OUT" ||
        (session?.user.id && recoveryUserId !== session.user.id)
      )
        recoveryUserId = null;
    });
    initializationError = null;
    return client;
  } catch {
    initializationError =
      "ログインの準備ができませんでした。このサイトでブラウザのセッション保存を許可し、画面を開き直してください。";
    return null;
  }
}

export function hasPendingPasswordRecovery(): boolean {
  return recoveryUserId !== null;
}
export function clearPasswordRecovery(): void {
  recoveryUserId = null;
}

/** Build callbacks from the current origin and app subpath, never from a query parameter. */
export function buildAuthRedirectUrl(
  origin: string,
  baseUrl: string,
  currentPathname = "/",
): string | null {
  let current: URL;
  try {
    current = new URL(origin);
  } catch {
    return null;
  }
  const localDevelopment =
    current.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(current.hostname);
  if (
    (current.protocol !== "https:" && !localDevelopment) ||
    current.username ||
    current.password ||
    current.pathname !== "/" ||
    current.search ||
    current.hash
  )
    return null;
  const relativeBase = baseUrl === "./" || baseUrl === "";
  const selectedPath = relativeBase
    ? currentPathname.replace(/\/index\.html$/i, "/")
    : baseUrl;
  if (
    !selectedPath.startsWith("/") ||
    selectedPath.startsWith("//") ||
    /[\\?#]/.test(selectedPath) ||
    selectedPath.trim() !== selectedPath ||
    /%(?:2f|5c)/i.test(selectedPath)
  )
    return null;
  try {
    const decoded = decodeURIComponent(selectedPath);
    if (
      /[\\?#]/.test(decoded) ||
      decoded.split("/").some((segment) => segment === "." || segment === "..")
    )
      return null;
    const path = selectedPath.endsWith("/") ? selectedPath : `${selectedPath}/`;
    const redirect = new URL(path, current.origin);
    return redirect.origin === current.origin ? redirect.href : null;
  } catch {
    return null;
  }
}
