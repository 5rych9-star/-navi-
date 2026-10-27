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
  load: () => Promise<UserTravelData>;
  save: (data: UserTravelData) => Promise<void>;
  clear: () => Promise<void>;
}

const TABLE = "user_travel_data";
const MAX_PAYLOAD_BYTES = 1_000_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MESSAGES = {
  identity: "ログイン情報を確認できません。もう一度ログインしてください。",
  invalid:
    "保存データの形式を確認できません。ご自宅と予定のデータをご確認ください。",
  size: "保存するデータが多すぎます。不要な予定を削除してから、もう一度お試しください。",
  load: "ご自宅と予定を読み込めませんでした。通信状態やデータベースの設定を確認してから、もう一度お試しください。",
  save: "ご自宅と予定を保存できませんでした。通信状態やデータベースの設定を確認してから、もう一度お試しください。",
  clear:
    "ご自宅と予定を削除できませんでした。通信状態やデータベースの設定を確認してから、もう一度お試しください。",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Validate the actual JSON payload, including all nested itineraries. */
function validateData(value: unknown): UserTravelData {
  if (!isRecord(value)) throw new Error(MESSAGES.invalid);
  let serialized: string;
  try {
    // Ownership fields and other top-level input properties never cross this
    // boundary. JSON roundtripping also gives each operation its own snapshot.
    serialized = JSON.stringify({ profile: value.profile, trips: value.trips });
  } catch {
    throw new Error(MESSAGES.invalid);
  }
  if (new TextEncoder().encode(serialized).byteLength > MAX_PAYLOAD_BYTES) {
    throw new Error(MESSAGES.size);
  }
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
  ) {
    throw new Error(MESSAGES.invalid);
  }
  return {
    profile: parsed.profile as Profile | null,
    trips: parsed.trips as SavedTrip[],
  };
}

/**
 * Use a browser Supabase client with a publishable key and the signed-in user's
 * session. userId must come from that session, never a field supplied in a form.
 * Client-side filters are defense in depth; the migration's RLS policies are
 * the access-control boundary. No service-role key belongs in this application.
 */
export function createUserDataRepository(
  client: SupabaseClient,
  userId: string,
): UserDataRepository {
  if (typeof userId !== "string" || !UUID.test(userId))
    throw new Error(MESSAGES.identity);

  return {
    async load() {
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
      if (response.data === null) return { profile: null, trips: [] };
      // Even a malformed/unexpected response must never expose another user.
      if (!isRecord(response.data) || response.data.user_id !== userId)
        throw new Error(MESSAGES.load);
      return validateData(response.data);
    },

    async save(data) {
      const snapshot = validateData(data);
      let response;
      try {
        response = await client
          .from(TABLE)
          .upsert(
            {
              user_id: userId,
              profile: snapshot.profile,
              trips: snapshot.trips,
            },
            { onConflict: "user_id" },
          )
          .eq("user_id", userId);
      } catch {
        throw new Error(MESSAGES.save);
      }
      if (response.error) throw new Error(MESSAGES.save);
    },

    async clear() {
      let response;
      try {
        response = await client.from(TABLE).delete().eq("user_id", userId);
      } catch {
        throw new Error(MESSAGES.clear);
      }
      if (response.error) throw new Error(MESSAGES.clear);
    },
  };
}
