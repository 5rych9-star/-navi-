import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isProfile,
  isSavedTrip,
  type Profile,
  type SavedTrip,
} from "./storage";

export interface UserTravelData {
  profile: Profile | null;
  trips: SavedTrip[];
}

export interface UserDataRepository {
  readLocal: () => UserTravelData;
  /** Import and remove a legacy server row, then use device storage only. */
  load: () => Promise<UserTravelData>;
  save: (data: UserTravelData) => Promise<void>;
  clear: () => Promise<void>;
}

const TABLE = "user_travel_data";
const MAX_PAYLOAD_BYTES = 1_000_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMPTY: UserTravelData = { profile: null, trips: [] };
const MESSAGES = {
  identity: "ログイン情報を確認できません。もう一度ログインしてください。",
  invalid:
    "保存データの形式を確認できません。端末内の登録情報をご確認ください。",
  size: "保存するデータが多すぎます。不要な予定を削除してから、もう一度お試しください。",
  local:
    "この端末に保存できません。ブラウザの保存設定や空き容量をご確認ください。",
  load: "以前のサーバー保存分の移行を確認できませんでした。端末内の情報は利用できます。接続を確認し、再読み込みしてください。",
  clear:
    "端末内の登録は削除しましたが、以前のサーバー保存分の削除は確認できません。接続を確認し、再読み込みしてください。",
  migration:
    "以前のサーバー保存分は端末に移しましたが、サーバーからの削除を確認できません。接続を確認し、再読み込みしてください。",
};

interface DeviceRecord {
  version: 2;
  userId: string;
  data: UserTravelData;
  legacyRemoved: boolean;
  legacyImported: boolean;
  /** A deletion must not be undone by a delayed legacy download. */
  discardLegacy: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateData(value: unknown): UserTravelData {
  if (!isRecord(value)) throw new Error(MESSAGES.invalid);
  let serialized: string;
  try {
    serialized = JSON.stringify({ profile: value.profile, trips: value.trips });
  } catch {
    throw new Error(MESSAGES.invalid);
  }
  if (new TextEncoder().encode(serialized).byteLength > MAX_PAYLOAD_BYTES)
    throw new Error(MESSAGES.size);
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new Error(MESSAGES.invalid);
  }
  if (
    !isRecord(parsed) ||
    (parsed.profile !== null && !isProfile(parsed.profile)) ||
    !Array.isArray(parsed.trips) ||
    !parsed.trips.every(isSavedTrip)
  )
    throw new Error(MESSAGES.invalid);
  return {
    profile: parsed.profile as Profile | null,
    trips: parsed.trips as SavedTrip[],
  };
}

/**
 * Home-bearing profiles AND itineraries stay on this device. The only server
 * operations are a legacy SELECT and DELETE scoped to the signed-in owner;
 * no travel-data write API is exposed, including IDs and nested route text.
 */
export function createUserDataRepository(
  client: SupabaseClient,
  userId: string,
): UserDataRepository {
  if (typeof userId !== "string" || !UUID.test(userId))
    throw new Error(MESSAGES.identity);
  const key = `nakatsu-account-travel-v2:${userId}`;

  function read(): DeviceRecord {
    let raw: string | null;
    try {
      raw = window.localStorage.getItem(key);
    } catch {
      throw new Error(MESSAGES.local);
    }
    if (raw === null)
      return {
        version: 2,
        userId,
        data: { ...EMPTY, trips: [] },
        legacyRemoved: false,
        legacyImported: false,
        discardLegacy: false,
      };
    if (new TextEncoder().encode(raw).byteLength > MAX_PAYLOAD_BYTES + 500)
      throw new Error(MESSAGES.size);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(MESSAGES.invalid);
    }
    if (
      !isRecord(parsed) ||
      parsed.version !== 2 ||
      parsed.userId !== userId ||
      typeof parsed.legacyRemoved !== "boolean" ||
      typeof parsed.discardLegacy !== "boolean" ||
      (parsed.legacyImported !== undefined &&
        typeof parsed.legacyImported !== "boolean")
    )
      throw new Error(MESSAGES.invalid);
    return {
      version: 2,
      userId,
      data: validateData(parsed.data),
      legacyRemoved: parsed.legacyRemoved,
      legacyImported: parsed.legacyImported === true,
      discardLegacy: parsed.discardLegacy,
    };
  }

  function write(record: DeviceRecord) {
    const snapshot = { ...record, data: validateData(record.data) };
    try {
      // A single setItem is atomic: quota failures preserve the previous record.
      window.localStorage.setItem(key, JSON.stringify(snapshot));
    } catch {
      throw new Error(MESSAGES.local);
    }
  }

  async function removeLegacy(message: string) {
    let response;
    try {
      response = await client.from(TABLE).delete().eq("user_id", userId);
    } catch {
      throw new Error(message);
    }
    if (response.error) throw new Error(message);
    // Preserve edits made while the DELETE was in flight.
    write({ ...read(), legacyRemoved: true });
  }

  return {
    readLocal: () => read().data,
    async load() {
      let local = read();
      if (local.legacyRemoved) return local.data;
      if (local.discardLegacy || local.legacyImported) {
        await removeLegacy(
          local.discardLegacy ? MESSAGES.clear : MESSAGES.migration,
        );
        return read().data;
      }
      let response;
      try {
        response = await client
          .from(TABLE)
          .select("user_id,profile,trips")
          .eq("user_id", userId)
          .maybeSingle();
      } catch {
        throw new Error(MESSAGES.load);
      }
      if (response.error) throw new Error(MESSAGES.load);
      // Re-read after the request so concurrent local edits win.
      local = read();
      if (local.legacyRemoved) return local.data;
      if (local.discardLegacy || local.legacyImported) {
        await removeLegacy(
          local.discardLegacy ? MESSAGES.clear : MESSAGES.migration,
        );
        return read().data;
      }
      if (response.data === null) {
        write({ ...local, legacyRemoved: true });
        return local.data;
      }
      if (!isRecord(response.data) || response.data.user_id !== userId)
        throw new Error(MESSAGES.load);
      const legacy = validateData(response.data);
      const existingIds = new Set(local.data.trips.map((trip) => trip.id));
      const merged = {
        profile: local.data.profile ?? legacy.profile,
        trips: [
          ...local.data.trips,
          ...legacy.trips.filter((trip) => !existingIds.has(trip.id)),
        ],
      };
      // Never delete the server's copy until the complete import is durable.
      write({ ...local, data: merged, legacyImported: true });
      await removeLegacy(MESSAGES.migration);
      return read().data;
    },
    async save(data) {
      const snapshot = validateData(data);
      write({ ...read(), data: snapshot });
    },
    async clear() {
      const local = read();
      // Keep a small tombstone so an old download cannot restore deleted data.
      write({ ...local, data: EMPTY, discardLegacy: true });
      if (!local.legacyRemoved) await removeLegacy(MESSAGES.clear);
    },
  };
}
