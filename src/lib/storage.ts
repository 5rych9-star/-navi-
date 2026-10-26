import type {
  Destination,
  HomeLocation,
  Journey,
  JourneyStep,
} from "./transit";

export interface Profile {
  nickname: string;
  home: HomeLocation;
}

/** A local, unsent sample plan. This is not an operator reservation. */
export interface SavedTrip {
  id: string;
  profile: Profile;
  journey: Journey;
  date: string;
  createdAt: string;
  status: "saved";
}

const PROFILE_KEY = "nakatsu-profile-v1";
const TRIPS_KEY = "nakatsu-trips-v1";
const MAX_STORED_CHARACTERS = 1_000_000;
const CATEGORIES = ["駅", "病院", "買い物", "公共施設", "観光"];

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(
  value: unknown,
  maximum = 200,
  allowEmpty = false,
): value is string {
  return (
    typeof value === "string" &&
    value.length <= maximum &&
    (allowEmpty || value.trim().length > 0)
  );
}

function finiteNumber(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function integer(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return finiteNumber(value, minimum, maximum) && Number.isInteger(value);
}

function time(value: unknown): value is string {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function date(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return (
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

function home(value: unknown): value is HomeLocation {
  return (
    record(value) &&
    text(value.id) &&
    text(value.label) &&
    finiteNumber(value.lat, -90, 90) &&
    finiteNumber(value.lng, -180, 180)
  );
}

function profile(value: unknown): value is Profile {
  return record(value) && text(value.nickname, 80, true) && home(value.home);
}

function destination(value: unknown): value is Destination {
  return (
    record(value) &&
    text(value.id) &&
    text(value.name) &&
    text(value.category) &&
    CATEGORIES.includes(value.category) &&
    text(value.label) &&
    text(value.address) &&
    finiteNumber(value.lat, -90, 90) &&
    finiteNumber(value.lng, -180, 180)
  );
}

function step(value: unknown): value is JourneyStep {
  return (
    record(value) &&
    ["walk", "shuttle", "bus"].includes(value.type as string) &&
    text(value.title) &&
    text(value.from) &&
    text(value.to) &&
    time(value.departureTime) &&
    time(value.arrivalTime) &&
    integer(value.durationMinutes, 0, 1440) &&
    text(value.instruction, 1000)
  );
}

function journey(value: unknown): value is Journey {
  return (
    record(value) &&
    text(value.id, 500) &&
    destination(value.destination) &&
    time(value.departureTime) &&
    time(value.arrivalTime) &&
    integer(value.fare, 0, 100_000) &&
    integer(value.durationMinutes, 1, 1440) &&
    integer(value.transferCount, 0, 20) &&
    typeof value.demandBus === "boolean" &&
    Array.isArray(value.steps) &&
    value.steps.length > 0 &&
    value.steps.length <= 20 &&
    value.steps.every(step)
  );
}

function trip(value: unknown): value is SavedTrip {
  return (
    record(value) &&
    text(value.id, 500) &&
    profile(value.profile) &&
    journey(value.journey) &&
    date(value.date) &&
    text(value.createdAt, 100) &&
    Number.isFinite(Date.parse(value.createdAt)) &&
    value.status === "saved"
  );
}

function read(key: string): unknown {
  try {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(key);
    if (raw === null || raw.length > MAX_STORED_CHARACTERS) return null;
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): boolean {
  try {
    if (typeof window === "undefined") return false;
    const serialized = JSON.stringify(value);
    if (serialized.length > MAX_STORED_CHARACTERS) return false;
    window.localStorage.setItem(key, serialized);
    return true;
  } catch {
    return false;
  }
}

export function loadProfile(): Profile | null {
  const value = read(PROFILE_KEY);
  return profile(value) ? value : null;
}

export function saveProfile(value: Profile): boolean {
  try {
    return profile(value) && write(PROFILE_KEY, value);
  } catch {
    return false;
  }
}

export function loadTrips(): SavedTrip[] {
  const value = read(TRIPS_KEY);
  return Array.isArray(value) ? value.filter(trip) : [];
}

export function saveTrips(value: SavedTrip[]): boolean {
  try {
    return Array.isArray(value) && value.every(trip) && write(TRIPS_KEY, value);
  } catch {
    return false;
  }
}

/** Remove only this app's data; never clear unrelated browser storage. */
export function clearUserData(): boolean {
  if (typeof window === "undefined") return false;
  let success = true;
  for (const key of [PROFILE_KEY, TRIPS_KEY]) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      success = false;
    }
  }
  return success;
}
