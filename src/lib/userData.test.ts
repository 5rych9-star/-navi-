import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createUserDataRepository, type UserTravelData } from "./userData";
import { DESTINATIONS, HOME_AREAS, searchJourneys } from "./transit";
import type { SavedTrip } from "./storage";

const OWNER = "a10c2026-1027-4000-8000-000000000001";
const OTHER = "a10c2026-1027-4000-8000-000000000002";
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
  let transportFailure = false;
  const builder = {
    select: vi.fn((_columns: string) => builder),
    eq: vi.fn((_column: string, _value: string) => builder),
    upsert: vi.fn((_payload: unknown, _options: unknown) => builder),
    delete: vi.fn(() => builder),
    maybeSingle: vi.fn(async () => {
      if (transportFailure)
        throw new Error("Internal network failure: do not expose");
      return result;
    }),
    then: (
      resolve: (value: typeof result) => unknown,
      reject?: (reason: unknown) => unknown,
    ) =>
      (transportFailure
        ? Promise.reject(new Error("Internal network failure: do not expose"))
        : Promise.resolve(result)
      ).then(resolve, reject),
  };
  const from = vi.fn((_table: string) => builder);
  const client = { from } as unknown as SupabaseClient;
  return {
    client,
    from,
    builder,
    response: (data: unknown, error: unknown = null) => {
      result = { data, error };
    },
    failTransport: () => {
      transportFailure = true;
    },
  };
}

let server: ReturnType<typeof mockSupabase>;
beforeEach(() => {
  server = mockSupabase();
});

describe("authenticated private travel data repository", () => {
  it("loads only the fixed authenticated owner and validates a full itinerary", async () => {
    const data = validData();
    server.response({ user_id: OWNER, ...data });
    const result = await createUserDataRepository(server.client, OWNER).load();
    expect(server.from).toHaveBeenCalledExactlyOnceWith("user_travel_data");
    expect(server.builder.select).toHaveBeenCalledExactlyOnceWith(
      "user_id,profile,trips",
    );
    expect(server.builder.eq).toHaveBeenCalledExactlyOnceWith("user_id", OWNER);
    expect(server.builder.maybeSingle).toHaveBeenCalledOnce();
    expect(result).toEqual(data);
    expect(result).not.toBe(data);
    expect(result.trips[0]).not.toBe(data.trips[0]);
  });

  it("returns defaults only when the owner has no row, not when a request fails", async () => {
    const repository = createUserDataRepository(server.client, OWNER);
    await expect(repository.load()).resolves.toEqual({
      profile: null,
      trips: [],
    });
    server.response(null, {
      code: "42P01",
      message: "Internal database detail: do not expose",
    });
    await expect(repository.load()).rejects.toThrow("読み込めませんでした");
  });

  it("allows an explicit null profile and an empty trips list", async () => {
    server.response({ user_id: OWNER, profile: null, trips: [] });
    await expect(
      createUserDataRepository(server.client, OWNER).load(),
    ).resolves.toEqual({ profile: null, trips: [] });
    await expect(
      createUserDataRepository(server.client, OWNER).save({
        profile: null,
        trips: [],
      }),
    ).resolves.toBeUndefined();
  });

  it.each([OTHER, undefined, null])(
    "never returns a row with an unexpected owner: %s",
    async (userId) => {
      server.response({ user_id: userId, ...validData() });
      await expect(
        createUserDataRepository(server.client, OWNER).load(),
      ).rejects.toThrow("読み込めませんでした");
    },
  );

  it.each([
    { profile: {}, trips: [] },
    { profile: [], trips: [] },
    { profile: null, trips: {} },
    { profile: null },
    { trips: [] },
    { profile: null, trips: [null] },
  ])(
    "rejects malformed loaded fields without silently discarding data: %j",
    async (data) => {
      server.response({ user_id: OWNER, ...data });
      await expect(
        createUserDataRepository(server.client, OWNER).load(),
      ).rejects.toThrow("保存データの形式");
    },
  );

  it("rejects a corrupt nested itinerary instead of filtering it out", async () => {
    const data = validData();
    const malformed = {
      ...trip,
      journey: {
        ...trip.journey,
        steps: [{ ...trip.journey.steps[0], departureTime: "99:99" }],
      },
    };
    server.response({
      user_id: OWNER,
      ...data,
      trips: [...data.trips, malformed],
    });
    await expect(
      createUserDataRepository(server.client, OWNER).load(),
    ).rejects.toThrow("保存データの形式");
  });

  it("upserts profile and trips atomically under its fixed user ID, ignoring an injected top-level owner", async () => {
    const data = validData();
    const input = {
      ...data,
      user_id: OTHER,
      updated_at: "1900-01-01",
      other: "discard",
    };
    await createUserDataRepository(server.client, OWNER).save(input);
    expect(server.from).toHaveBeenCalledExactlyOnceWith("user_travel_data");
    expect(server.builder.upsert).toHaveBeenCalledExactlyOnceWith(
      { user_id: OWNER, ...data },
      { onConflict: "user_id" },
    );
    expect(server.builder.eq).toHaveBeenCalledExactlyOnceWith("user_id", OWNER);
  });

  it("takes an isolated save snapshot before awaiting the request", async () => {
    const data = validData();
    const pending = createUserDataRepository(server.client, OWNER).save(data);
    data.profile!.nickname = "changed after save started";
    data.trips.length = 0;
    await pending;
    expect(server.builder.upsert.mock.calls[0][0]).toEqual({
      user_id: OWNER,
      ...validData(),
    });
  });

  it("validates nested imported profile data before making a request", async () => {
    const data = validData();
    data.profile!.home.lat = 999;
    await expect(
      createUserDataRepository(server.client, OWNER).save(data),
    ).rejects.toThrow("保存データの形式");
    expect(server.from).not.toHaveBeenCalled();
  });

  it("rejects serialized function/cyclic payloads before making a request", async () => {
    const data = validData();
    (data.trips[0] as unknown as Record<string, unknown>).cycle = data;
    await expect(
      createUserDataRepository(server.client, OWNER).save(data),
    ).rejects.toThrow("保存データの形式");
    expect(server.from).not.toHaveBeenCalled();
  });

  it("enforces the combined UTF-8 byte limit, including multibyte imported properties", async () => {
    const data = validData();
    (data.profile as unknown as Record<string, unknown>).extra = "あ".repeat(
      340_000,
    );
    await expect(
      createUserDataRepository(server.client, OWNER).save(data),
    ).rejects.toThrow("データが多すぎます");
    expect(server.from).not.toHaveBeenCalled();
    server.response({ user_id: OWNER, ...data });
    await expect(
      createUserDataRepository(server.client, OWNER).load(),
    ).rejects.toThrow("データが多すぎます");
  });

  it("deletes only the fixed authenticated owner, including an idempotent empty deletion", async () => {
    await expect(
      createUserDataRepository(server.client, OWNER).clear(),
    ).resolves.toBeUndefined();
    expect(server.from).toHaveBeenCalledExactlyOnceWith("user_travel_data");
    expect(server.builder.delete).toHaveBeenCalledOnce();
    expect(server.builder.eq).toHaveBeenCalledExactlyOnceWith("user_id", OWNER);
  });

  it.each(["load", "save", "clear"] as const)(
    "sanitizes structured server errors during %s",
    async (operation) => {
      server.response(null, {
        code: "42501",
        message: "Internal database detail: do not expose",
      });
      const repository = createUserDataRepository(server.client, OWNER);
      const pending =
        operation === "save"
          ? repository.save(validData())
          : repository[operation]();
      await expect(pending).rejects.toThrow(
        /(?:読み込め|保存でき|削除でき)ませんでした/,
      );
      await expect(pending).rejects.not.toThrow("Internal database detail");
    },
  );

  it.each(["load", "save", "clear"] as const)(
    "sanitizes transport exceptions during %s",
    async (operation) => {
      server.failTransport();
      const repository = createUserDataRepository(server.client, OWNER);
      const pending =
        operation === "save"
          ? repository.save(validData())
          : repository[operation]();
      await expect(pending).rejects.toThrow(
        /(?:読み込め|保存でき|削除でき)ませんでした/,
      );
      await expect(pending).rejects.not.toThrow("Internal network failure");
    },
  );

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
