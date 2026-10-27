import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createUserDataRepository, type UserTravelData } from "./userData";
import { DESTINATIONS, HOME_AREAS, searchJourneys } from "./transit";
import type { SavedTrip } from "./storage";

const OWNER = "a10c2026-1027-4000-8000-000000000001";
const OTHER = "a10c2026-1027-4000-8000-000000000002";
const key = (owner = OWNER) => `nakatsu-account-travel-v2:${owner}`;
const profile = { nickname: "なかつ", home: HOME_AREAS[0] };
const trip: SavedTrip = {
  id: "sample-plan-1",
  profile,
  journey: searchJourneys({
    home: profile.home,
    destinationId: DESTINATIONS[0].id,
    date: "2026-10-27",
    arrivalTime: "10:00",
  })[0],
  date: "2026-10-27",
  createdAt: "2026-10-27T01:00:00.000Z",
  status: "saved",
};
const validData = (): UserTravelData =>
  structuredClone({ profile, trips: [trip] });

function mockSupabase() {
  let result: { data: unknown; error: unknown } = { data: null, error: null };
  let deleteError: unknown = null;
  let transportFailure = false;
  const builder = {
    select: vi.fn((_columns: string) => builder),
    eq: vi.fn((_column: string, _value: string) => builder),
    upsert: vi.fn((_payload: unknown, _options: unknown) => builder),
    insert: vi.fn((_payload: unknown) => builder),
    update: vi.fn((_payload: unknown) => builder),
    delete: vi.fn(() => builder),
    maybeSingle: vi.fn(async () => {
      if (transportFailure) throw new Error("Internal network failure");
      return result;
    }),
    then: (
      resolve: (value: { error: unknown }) => unknown,
      reject?: (reason: unknown) => unknown,
    ) =>
      (transportFailure
        ? Promise.reject(new Error("Internal network failure"))
        : Promise.resolve({ error: deleteError })
      ).then(resolve, reject),
  };
  const from = vi.fn((_table: string) => builder);
  return {
    client: { from } as unknown as SupabaseClient,
    from,
    builder,
    response: (data: unknown, error: unknown = null) => {
      result = { data, error };
    },
    failDelete: (error: unknown = { message: "Internal database detail" }) => {
      deleteError = error;
    },
    failTransport: () => {
      transportFailure = true;
    },
  };
}

let server: ReturnType<typeof mockSupabase>;
let values: Map<string, string>;
let storage: {
  getItem: ReturnType<typeof vi.fn>;
  setItem: ReturnType<typeof vi.fn>;
};
beforeEach(() => {
  server = mockSupabase();
  values = new Map();
  storage = {
    getItem: vi.fn((name: string) => values.get(name) ?? null),
    setItem: vi.fn((name: string, value: string) => {
      values.set(name, value);
    }),
  };
  vi.stubGlobal("window", { localStorage: storage });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function saved(owner = OWNER) {
  return JSON.parse(values.get(key(owner))!);
}
function assertNoUpload() {
  expect(server.builder.upsert).not.toHaveBeenCalled();
  expect(server.builder.insert).not.toHaveBeenCalled();
  expect(server.builder.update).not.toHaveBeenCalled();
}

describe("device-only account travel data", () => {
  it("saves the complete profile and nested home-bearing route locally without making a request", async () => {
    const repository = createUserDataRepository(server.client, OWNER);
    const data = validData();
    expect(data.trips[0].journey.id).toContain(profile.home.lat.toFixed(6));
    await repository.save(data);
    expect(repository.readLocal()).toEqual(data);
    expect(saved().data).toEqual(data);
    expect(server.from).not.toHaveBeenCalled();
    assertNoUpload();
  });

  it("keeps accounts and guest storage separate, including an injected owner field", async () => {
    values.set("nakatsu-profile-v1", JSON.stringify(profile));
    values.set("another-app", "keep");
    const owner = createUserDataRepository(server.client, OWNER);
    const other = createUserDataRepository(server.client, OTHER);
    await owner.save({ ...validData(), user_id: OTHER } as UserTravelData);
    expect(other.readLocal()).toEqual({ profile: null, trips: [] });
    await other.save({
      profile: { ...profile, nickname: "別の人" },
      trips: [],
    });
    expect(owner.readLocal()).toEqual(validData());
    expect(saved().userId).toBe(OWNER);
    expect(saved(OTHER).data.profile.nickname).toBe("別の人");
    expect(values.get("another-app")).toBe("keep");
    expect(values.get("nakatsu-profile-v1")).toBe(JSON.stringify(profile));
  });

  it("checks an empty legacy row once and then reads and saves offline", async () => {
    const repository = createUserDataRepository(server.client, OWNER);
    await expect(repository.load()).resolves.toEqual({
      profile: null,
      trips: [],
    });
    expect(saved().legacyRemoved).toBe(true);
    expect(server.builder.maybeSingle).toHaveBeenCalledOnce();
    server.failTransport();
    await repository.save(validData());
    await expect(repository.load()).resolves.toEqual(validData());
    expect(server.builder.maybeSingle).toHaveBeenCalledOnce();
    expect(server.builder.delete).not.toHaveBeenCalled();
    assertNoUpload();
  });

  it("imports the fixed owner's old row, makes a durable copy BEFORE DELETE and never uploads it", async () => {
    server.response({ user_id: OWNER, ...validData() });
    server.builder.delete.mockImplementation(() => {
      expect(saved().data).toEqual(validData());
      expect(saved().legacyImported).toBe(true);
      return server.builder;
    });
    const repository = createUserDataRepository(server.client, OWNER);
    await expect(repository.load()).resolves.toEqual(validData());
    expect(server.builder.select).toHaveBeenCalledExactlyOnceWith(
      "user_id,profile,trips",
    );
    expect(server.builder.eq.mock.calls).toEqual([
      ["user_id", OWNER],
      ["user_id", OWNER],
    ]);
    expect(saved().legacyRemoved).toBe(true);
    assertNoUpload();
  });

  it("preserves local profile and same-ID plans while importing missing legacy plans", async () => {
    const local = validData();
    local.profile!.nickname = "今の名前";
    local.trips[0].date = "2026-11-01";
    const legacy = validData();
    legacy.trips.push({ ...structuredClone(trip), id: "other-plan" });
    const repository = createUserDataRepository(server.client, OWNER);
    await repository.save(local);
    server.response({ user_id: OWNER, ...legacy });
    await repository.load();
    expect(repository.readLocal()).toEqual({
      profile: local.profile,
      trips: [local.trips[0], legacy.trips[1]],
    });
  });

  it("never deletes a legacy row when device storage rejects the complete import", async () => {
    server.response({ user_id: OWNER, ...validData() });
    storage.setItem.mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    await expect(
      createUserDataRepository(server.client, OWNER).load(),
    ).rejects.toThrow("この端末に保存できません");
    expect(server.builder.delete).not.toHaveBeenCalled();
    expect(values.size).toBe(0);
    assertNoUpload();
  });

  it("retains the imported copy on failed deletion and retries without resurrecting a removed plan", async () => {
    server.response({ user_id: OWNER, ...validData() });
    server.failDelete();
    const repository = createUserDataRepository(server.client, OWNER);
    await expect(repository.load()).rejects.toThrow(
      "サーバーからの削除を確認できません",
    );
    expect(repository.readLocal()).toEqual(validData());
    expect(saved().legacyRemoved).toBe(false);
    await repository.save({ profile, trips: [] });
    server.failDelete(null);
    await expect(repository.load()).resolves.toEqual({ profile, trips: [] });
    expect(server.builder.maybeSingle).toHaveBeenCalledOnce();
    expect(server.builder.delete).toHaveBeenCalledTimes(2);
    expect(saved().legacyRemoved).toBe(true);
    assertNoUpload();
  });

  it("keeps local information available when legacy reading fails", async () => {
    const repository = createUserDataRepository(server.client, OWNER);
    await repository.save(validData());
    server.response(null, { message: "Internal database detail" });
    await expect(repository.load()).rejects.toThrow(
      "以前のサーバー保存分の移行を確認できません",
    );
    expect(repository.readLocal()).toEqual(validData());
    await repository.save({ profile, trips: [] });
    expect(repository.readLocal().trips).toEqual([]);
    assertNoUpload();
  });

  it.each([OTHER, undefined, null])(
    "never imports or deletes a row with foreign owner: %s",
    async (owner) => {
      server.response({ user_id: owner, ...validData() });
      await expect(
        createUserDataRepository(server.client, OWNER).load(),
      ).rejects.toThrow("以前のサーバー保存分の移行");
      expect(values.size).toBe(0);
      expect(server.builder.delete).not.toHaveBeenCalled();
    },
  );

  it.each([
    { profile: {}, trips: [] },
    { profile: [], trips: [] },
    { profile: null, trips: {} },
    { profile: null },
    { trips: [] },
    { profile: null, trips: [null] },
  ])("does not discard malformed legacy data: %j", async (data) => {
    server.response({ user_id: OWNER, ...data });
    await expect(
      createUserDataRepository(server.client, OWNER).load(),
    ).rejects.toThrow("保存データの形式");
    expect(server.builder.delete).not.toHaveBeenCalled();
  });

  it("rejects a corrupt nested itinerary without importing or deleting it", async () => {
    const data = validData();
    data.trips[0].journey.steps[0].departureTime = "99:99";
    server.response({ user_id: OWNER, ...data });
    await expect(
      createUserDataRepository(server.client, OWNER).load(),
    ).rejects.toThrow("保存データの形式");
    expect(server.builder.delete).not.toHaveBeenCalled();
  });

  it("validates a snapshot and rejects invalid or cyclic local saves", async () => {
    const repository = createUserDataRepository(server.client, OWNER);
    const data = validData();
    await repository.save(data);
    data.profile!.nickname = "changed";
    expect(repository.readLocal()).toEqual(validData());
    data.profile!.home.lat = 999;
    await expect(repository.save(data)).rejects.toThrow("保存データの形式");
    const cycle = validData();
    (cycle.trips[0] as unknown as Record<string, unknown>).cycle = cycle;
    await expect(repository.save(cycle)).rejects.toThrow("保存データの形式");
    expect(repository.readLocal()).toEqual(validData());
    expect(server.from).not.toHaveBeenCalled();
  });

  it("enforces a combined UTF-8 limit before local writes or legacy deletion", async () => {
    const data = validData();
    (data.profile as unknown as Record<string, unknown>).extra = "あ".repeat(
      340_000,
    );
    const repository = createUserDataRepository(server.client, OWNER);
    await expect(repository.save(data)).rejects.toThrow("データが多すぎます");
    server.response({ user_id: OWNER, ...data });
    await expect(repository.load()).rejects.toThrow("データが多すぎます");
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(server.builder.delete).not.toHaveBeenCalled();
  });

  it("does not overwrite a durable local record on quota failure", async () => {
    const repository = createUserDataRepository(server.client, OWNER);
    await repository.save(validData());
    storage.setItem.mockImplementation(() => {
      throw new Error("quota");
    });
    await expect(repository.save({ profile, trips: [] })).rejects.toThrow(
      "この端末に保存できません",
    );
    expect(repository.readLocal()).toEqual(validData());
  });

  it("rejects corrupt or foreign local envelopes without falling back to another storage scope", async () => {
    const repository = createUserDataRepository(server.client, OWNER);
    await repository.save(validData());
    values.set(key(), JSON.stringify({ ...saved(), userId: OTHER }));
    expect(() => repository.readLocal()).toThrow("保存データの形式");
    await expect(repository.load()).rejects.toThrow("保存データの形式");
    expect(server.from).not.toHaveBeenCalled();
  });

  it("does not read a legacy row if local storage access itself is denied", async () => {
    storage.getItem.mockImplementation(() => {
      throw new Error("denied");
    });
    await expect(
      createUserDataRepository(server.client, OWNER).load(),
    ).rejects.toThrow("この端末に保存できません");
    expect(server.from).not.toHaveBeenCalled();
  });

  it("clears a migrated owner's private data locally, preserving unrelated users and settings", async () => {
    const repository = createUserDataRepository(server.client, OWNER);
    await repository.load();
    await repository.save(validData());
    await createUserDataRepository(server.client, OTHER).save(validData());
    values.set("another-app", "keep");
    server.failTransport();
    await repository.clear();
    expect(repository.readLocal()).toEqual({ profile: null, trips: [] });
    expect(createUserDataRepository(server.client, OTHER).readLocal()).toEqual(
      validData(),
    );
    expect(values.get("another-app")).toBe("keep");
    expect(saved().discardLegacy).toBe(true);
    expect(server.builder.delete).not.toHaveBeenCalled();
  });

  it("leaves a deletion tombstone if legacy cleanup fails and retries DELETE without importing", async () => {
    const repository = createUserDataRepository(server.client, OWNER);
    await repository.save(validData());
    server.failDelete();
    await expect(repository.clear()).rejects.toThrow(
      "端末内の登録は削除しました",
    );
    expect(repository.readLocal()).toEqual({ profile: null, trips: [] });
    server.failDelete(null);
    server.response({ user_id: OWNER, ...validData() });
    await repository.load();
    expect(repository.readLocal()).toEqual({ profile: null, trips: [] });
    expect(server.builder.maybeSingle).not.toHaveBeenCalled();
    assertNoUpload();
  });

  it("preserves local edits made while the legacy request is pending", async () => {
    let resolve!: (value: { data: unknown; error: null }) => void;
    server.builder.maybeSingle.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const repository = createUserDataRepository(server.client, OWNER);
    const pending = repository.load();
    await repository.save({
      profile: { ...profile, nickname: "最新" },
      trips: [],
    });
    resolve({ data: { user_id: OWNER, ...validData() }, error: null });
    await pending;
    expect(repository.readLocal().profile?.nickname).toBe("最新");
  });

  it("never resurrects data when explicit deletion races with an old download", async () => {
    let resolve!: (value: { data: unknown; error: null }) => void;
    server.builder.maybeSingle.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const repository = createUserDataRepository(server.client, OWNER);
    const pending = repository.load();
    await repository.clear();
    resolve({ data: { user_id: OWNER, ...validData() }, error: null });
    await pending;
    expect(repository.readLocal()).toEqual({ profile: null, trips: [] });
  });

  it("sanitizes transport errors and keeps local writes independent of the network", async () => {
    server.failTransport();
    const repository = createUserDataRepository(server.client, OWNER);
    await expect(repository.load()).rejects.toThrow("移行を確認できません");
    await expect(repository.load()).rejects.not.toThrow(
      "Internal network failure",
    );
    await repository.save(validData());
    expect(repository.readLocal()).toEqual(validData());
    assertNoUpload();
  });

  it.each([
    "",
    "not-an-authenticated-user",
    `${OWNER} OR true`,
    null,
    undefined,
  ])("rejects unusable owner identity: %s", (value) => {
    expect(() =>
      createUserDataRepository(server.client, value as string),
    ).toThrow("ログイン情報");
    expect(server.from).not.toHaveBeenCalled();
  });
});
