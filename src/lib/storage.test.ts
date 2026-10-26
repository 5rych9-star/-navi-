import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearUserData,
  loadProfile,
  loadTrips,
  saveProfile,
  saveTrips,
  type Profile,
  type SavedTrip,
} from "./storage";
import { DESTINATIONS, HOME_AREAS, searchJourneys } from "./transit";

const PROFILE_KEY = "nakatsu-profile-v1";
const TRIPS_KEY = "nakatsu-trips-v1";
const profile: Profile = { nickname: "なかつ", home: HOME_AREAS[0] };
const trip: SavedTrip = {
  id: "local-plan-1",
  profile,
  journey: searchJourneys({
    home: profile.home,
    destinationId: DESTINATIONS[0].id,
    date: "2026-10-27",
    arrivalTime: "10:00",
  })[0],
  date: "2026-10-27",
  createdAt: "2026-10-26T12:00:00.000Z",
  status: "saved",
};

let values: Map<string, string>;
let storage: {
  getItem: ReturnType<typeof vi.fn>;
  setItem: ReturnType<typeof vi.fn>;
  removeItem: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  values = new Map();
  storage = {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
  };
  vi.stubGlobal("window", { localStorage: storage });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("local profile and sample trip storage", () => {
  it("roundtrips a profile and a complete sample trip without changing their contents", () => {
    expect(loadProfile()).toBeNull();
    expect(loadTrips()).toEqual([]);
    expect(saveProfile(profile)).toBe(true);
    expect(saveTrips([trip])).toBe(true);
    expect(loadProfile()).toEqual(profile);
    expect(loadTrips()).toEqual([trip]);
    expect([...values.keys()].sort()).toEqual([PROFILE_KEY, TRIPS_KEY]);
  });

  it("supports an optional nickname and an empty trips list", () => {
    expect(saveProfile({ ...profile, nickname: "" })).toBe(true);
    expect(loadProfile()?.nickname).toBe("");
    expect(saveTrips([])).toBe(true);
    expect(loadTrips()).toEqual([]);
  });

  it.each(["{invalid", "null", "false", '"string"', "42", "{}", "[]"])(
    "does not trust malformed or wrong-shaped profiles: %s",
    (raw) => {
      values.set(PROFILE_KEY, raw);
      expect(loadProfile()).toBeNull();
    },
  );

  it("does not trust invalid coordinates or a non-string nickname in stored profiles", () => {
    values.set(
      PROFILE_KEY,
      JSON.stringify({ ...profile, home: { ...profile.home, lat: 999 } }),
    );
    expect(loadProfile()).toBeNull();
    values.set(
      PROFILE_KEY,
      JSON.stringify({ ...profile, nickname: { text: "name" } }),
    );
    expect(loadProfile()).toBeNull();
  });

  it("retains valid trips while filtering corrupt entries that could crash rendering", () => {
    values.set(
      TRIPS_KEY,
      JSON.stringify([
        null,
        trip,
        { ...trip, journey: { ...trip.journey, destination: null } },
        {
          ...trip,
          journey: {
            ...trip.journey,
            steps: [{ title: "missing required fields" }],
          },
        },
        { ...trip, journey: { ...trip.journey, steps: "not-an-array" } },
        { ...trip, status: "confirmed" },
        { ...trip, date: "2026-02-29" },
        { ...trip, createdAt: "invalid" },
      ]),
    );
    expect(loadTrips()).toEqual([trip]);
  });

  it.each(["{invalid", "null", "{}", '"plans"'])(
    "handles invalid trips containers: %s",
    (raw) => {
      values.set(TRIPS_KEY, raw);
      expect(loadTrips()).toEqual([]);
    },
  );

  it("rejects invalid writes instead of persisting unsafe shapes", () => {
    expect(
      saveProfile({ nickname: "name", home: null } as unknown as Profile),
    ).toBe(false);
    expect(
      saveTrips([{ ...trip, journey: null }] as unknown as SavedTrip[]),
    ).toBe(false);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("reports quota/permission write failures without throwing and retains previous data", () => {
    expect(saveProfile(profile)).toBe(true);
    storage.setItem.mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(saveProfile({ ...profile, nickname: "new" })).toBe(false);
    expect(saveTrips([trip])).toBe(false);
    expect(loadProfile()).toEqual(profile);
  });

  it("handles disabled storage, getter errors and a non-browser environment", () => {
    storage.getItem.mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(loadProfile()).toBeNull();
    expect(loadTrips()).toEqual([]);
    vi.stubGlobal(
      "window",
      Object.defineProperty({}, "localStorage", {
        get() {
          throw new Error("blocked");
        },
      }),
    );
    expect(loadProfile()).toBeNull();
    expect(loadTrips()).toEqual([]);
    expect(saveProfile(profile)).toBe(false);
    expect(saveTrips([trip])).toBe(false);
    expect(clearUserData()).toBe(false);
    vi.stubGlobal("window", undefined);
    expect(loadProfile()).toBeNull();
    expect(loadTrips()).toEqual([]);
    expect(saveProfile(profile)).toBe(false);
    expect(saveTrips([trip])).toBe(false);
    expect(clearUserData()).toBe(false);
  });

  it("clears only its owned keys and preserves unrelated local storage", () => {
    saveProfile(profile);
    saveTrips([trip]);
    values.set("another-app", "keep");
    expect(clearUserData()).toBe(true);
    expect(loadProfile()).toBeNull();
    expect(loadTrips()).toEqual([]);
    expect(values.get("another-app")).toBe("keep");
    expect(storage.removeItem.mock.calls).toEqual([[PROFILE_KEY], [TRIPS_KEY]]);
  });

  it("attempts both owned removals and reports any removal failure", () => {
    saveProfile(profile);
    saveTrips([trip]);
    storage.removeItem.mockImplementation((key: string) => {
      if (key === PROFILE_KEY) throw new Error("blocked");
      values.delete(key);
    });
    expect(clearUserData()).toBe(false);
    expect(storage.removeItem).toHaveBeenCalledTimes(2);
    expect(values.has(TRIPS_KEY)).toBe(false);
    expect(values.has(PROFILE_KEY)).toBe(true);
  });
});
