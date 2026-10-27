import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createGeolocationController,
  type GeolocationSource,
  type VisibilitySource,
} from "./geolocation";

type Request = {
  success: PositionCallback;
  error: PositionErrorCallback | null | undefined;
  options?: PositionOptions;
};

function position(
  lat = 33.59,
  lng = 131.19,
  timestamp = 1000,
): GeolocationPosition {
  return {
    coords: {
      latitude: lat,
      longitude: lng,
      accuracy: 12,
      altitude: null,
      altitudeAccuracy: null,
      heading: null,
      speed: null,
    },
    timestamp,
    toJSON: () => ({}),
  } as GeolocationPosition;
}

function positionError(code: number): GeolocationPositionError {
  return {
    code,
    message: "platform error",
    PERMISSION_DENIED: 1,
    POSITION_UNAVAILABLE: 2,
    TIMEOUT: 3,
  } as GeolocationPositionError;
}

function platform() {
  const requests: Request[] = [];
  const listeners = new Set<() => void>();
  const geolocation = {
    watchPosition: vi.fn<GeolocationSource["watchPosition"]>(
      (success, error, options) => {
        requests.push({ success, error, options });
        return requests.length - 1;
      },
    ),
    clearWatch: vi.fn<GeolocationSource["clearWatch"]>(),
  };
  const visibility: VisibilitySource & { hidden: boolean } = {
    hidden: false,
    addEventListener: vi.fn((_type, listener) => {
      listeners.add(listener);
    }),
    removeEventListener: vi.fn((_type, listener) => {
      listeners.delete(listener);
    }),
  };
  const controller = createGeolocationController({
    geolocation,
    visibility,
    isSecureContext: true,
  });
  return {
    requests,
    geolocation,
    visibility,
    controller,
    listeners,
    setHidden(hidden: boolean) {
      visibility.hidden = hidden;
      [...listeners].forEach((listener) => listener());
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("explicit, memory-only geolocation controller", () => {
  it("makes no permission request or installs any watcher before explicit start", () => {
    const { controller, geolocation, listeners } = platform();
    expect(controller.getSnapshot()).toEqual({
      status: "idle",
      position: null,
      error: null,
    });
    expect(geolocation.watchPosition).not.toHaveBeenCalled();
    expect(listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses a fresh high-accuracy watch and exposes coordinates, accuracy and timestamp", () => {
    const { controller, geolocation, requests } = platform();
    controller.start();
    expect(controller.getSnapshot()).toEqual({
      status: "requesting",
      position: null,
      error: null,
    });
    expect(geolocation.watchPosition).toHaveBeenCalledTimes(1);
    expect(requests[0].options).toEqual({
      enableHighAccuracy: true,
      timeout: 15_000,
      maximumAge: 0,
    });
    requests[0].success(position());
    expect(controller.getSnapshot()).toEqual({
      status: "active",
      position: { lat: 33.59, lng: 131.19, accuracy: 12, timestamp: 1000 },
      error: null,
    });
    vi.advanceTimersByTime(30_000);
    expect(controller.getSnapshot().status).toBe("active");
    expect(geolocation.clearWatch).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears watch ID zero and position on stop, ignoring late success and error callbacks", () => {
    const { controller, requests, geolocation, listeners } = platform();
    controller.start();
    requests[0].success(position());
    controller.stop();
    expect(geolocation.clearWatch).toHaveBeenCalledWith(0);
    expect(listeners.size).toBe(0);
    expect(controller.getSnapshot()).toEqual({
      status: "idle",
      position: null,
      error: null,
    });
    requests[0].success(position(33.6));
    requests[0].error?.(positionError(1));
    vi.advanceTimersByTime(30_000);
    expect(controller.getSnapshot()).toEqual({
      status: "idle",
      position: null,
      error: null,
    });
  });

  it("cancels the previous watch on restart and rejects callbacks from that request", () => {
    const { controller, requests, geolocation } = platform();
    controller.start();
    requests[0].success(position());
    controller.start();
    expect(geolocation.clearWatch).toHaveBeenCalledWith(0);
    expect(controller.getSnapshot().position).toBeNull();
    requests[0].success(position(34));
    requests[0].error?.(positionError(1));
    expect(controller.getSnapshot().status).toBe("requesting");
    requests[1].success(position(33.61));
    expect(controller.getSnapshot().position?.lat).toBe(33.61);
    controller.stop();
    expect(geolocation.clearWatch).toHaveBeenLastCalledWith(1);
  });

  it("times out an unanswered acquisition once and never retries automatically", () => {
    const { controller, requests, geolocation, listeners } = platform();
    controller.start();
    vi.advanceTimersByTime(14_999);
    expect(controller.getSnapshot().status).toBe("requesting");
    vi.advanceTimersByTime(1);
    expect(controller.getSnapshot()).toMatchObject({
      status: "timeout",
      position: null,
    });
    expect(controller.getSnapshot().error).toContain("もう一度");
    expect(geolocation.clearWatch).toHaveBeenCalledWith(0);
    expect(listeners.size).toBe(0);
    requests[0].success(position());
    vi.advanceTimersByTime(60_000);
    expect(controller.getSnapshot().status).toBe("timeout");
    expect(geolocation.watchPosition).toHaveBeenCalledTimes(1);
    controller.stop();
    expect(controller.getSnapshot()).toEqual({
      status: "idle",
      position: null,
      error: null,
    });
  });

  it.each([
    [1, "denied"],
    [2, "unavailable"],
    [3, "timeout"],
    [99, "unavailable"],
  ] as const)(
    "maps browser error %s to %s and clears an acquired position",
    (code, status) => {
      const { controller, requests, geolocation } = platform();
      controller.start();
      requests[0].success(position());
      requests[0].error?.(positionError(code));
      expect(controller.getSnapshot()).toMatchObject({
        status,
        position: null,
      });
      expect(controller.getSnapshot().error).toBeTruthy();
      expect(geolocation.clearWatch).toHaveBeenCalledWith(0);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("offers useful permission guidance and permits an explicit retry after denial", () => {
    const { controller, requests, geolocation } = platform();
    controller.start();
    requests[0].error?.(positionError(1));
    expect(controller.getSnapshot().error).toContain("サイト設定");
    controller.start();
    expect(geolocation.watchPosition).toHaveBeenCalledTimes(2);
    expect(controller.getSnapshot()).toEqual({
      status: "requesting",
      position: null,
      error: null,
    });
    requests[1].success(position());
    expect(controller.getSnapshot().status).toBe("active");
  });

  it("stops and clears coordinates when hidden and does not resume when visible", () => {
    const { controller, requests, geolocation, listeners, setHidden } =
      platform();
    controller.start();
    requests[0].success(position());
    setHidden(true);
    expect(controller.getSnapshot()).toEqual({
      status: "idle",
      position: null,
      error: null,
    });
    expect(geolocation.clearWatch).toHaveBeenCalledWith(0);
    expect(listeners.size).toBe(0);
    setHidden(false);
    requests[0].success(position());
    expect(geolocation.watchPosition).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().position).toBeNull();
  });

  it("stops a pending permission request when hidden and never starts while already hidden", () => {
    const { controller, requests, geolocation, setHidden } = platform();
    controller.start();
    setHidden(true);
    expect(geolocation.clearWatch).toHaveBeenCalledWith(0);
    requests[0].success(position());
    expect(controller.getSnapshot().position).toBeNull();
    controller.start();
    expect(geolocation.watchPosition).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("checks secure context and browser support without requesting permissions", () => {
    const { geolocation } = platform();
    const insecure = createGeolocationController({
      geolocation,
      isSecureContext: false,
    });
    insecure.start();
    expect(insecure.getSnapshot()).toMatchObject({
      status: "insecure",
      position: null,
    });
    expect(insecure.getSnapshot().error).toContain("HTTPS");
    const unsupported = createGeolocationController({
      geolocation: null,
      isSecureContext: true,
    });
    unsupported.start();
    expect(unsupported.getSnapshot().status).toBe("unsupported");
    expect(geolocation.watchPosition).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects invalid coordinates and ignores older positions from the current watch", () => {
    const { controller, requests } = platform();
    controller.start();
    requests[0].success(position(33.59, 131.19, 2000));
    requests[0].success(position(34, 131.19, 1000));
    expect(controller.getSnapshot().position?.lat).toBe(33.59);
    requests[0].success(position(Number.NaN));
    expect(controller.getSnapshot()).toMatchObject({
      status: "unavailable",
      position: null,
    });
  });

  it("cleans up an ID returned after a synchronous error callback", () => {
    const geolocation: GeolocationSource = {
      watchPosition: vi.fn((_success, error) => {
        error?.(positionError(1));
        return 42;
      }),
      clearWatch: vi.fn(),
    };
    const controller = createGeolocationController({
      geolocation,
      isSecureContext: true,
    });
    controller.start();
    expect(controller.getSnapshot().status).toBe("denied");
    expect(geolocation.clearWatch).toHaveBeenCalledWith(42);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("handles a throwing browser API and can still stop when clearWatch throws", () => {
    const { controller, geolocation, requests } = platform();
    geolocation.watchPosition.mockImplementationOnce(() => {
      throw new Error("blocked");
    });
    controller.start();
    expect(controller.getSnapshot().status).toBe("unavailable");
    expect(vi.getTimerCount()).toBe(0);
    controller.start();
    requests[0].success(position());
    geolocation.clearWatch.mockImplementation(() => {
      throw new Error("platform failure");
    });
    expect(() => controller.stop()).not.toThrow();
    expect(controller.getSnapshot()).toEqual({
      status: "idle",
      position: null,
      error: null,
    });
  });

  it("provides stable snapshots, cleans subscriptions and permits start after effect cleanup", () => {
    const { controller } = platform();
    const listener = vi.fn();
    const first = controller.getSnapshot();
    expect(controller.getSnapshot()).toBe(first);
    const unsubscribe = controller.subscribe(listener);
    controller.start();
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    controller.stop();
    controller.start();
    expect(controller.getSnapshot().status).toBe("requesting");
    expect(listener).toHaveBeenCalledTimes(1);
    controller.stop();
  });

  it("does not touch browser storage or application network APIs", () => {
    const fetch = vi.fn(() => {
      throw new Error("unexpected network request");
    });
    const localStorage = {
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("localStorage", localStorage);
    const { controller, requests } = platform();
    controller.start();
    requests[0].success(position());
    controller.stop();
    expect(fetch).not.toHaveBeenCalled();
    expect(localStorage.getItem).not.toHaveBeenCalled();
    expect(localStorage.setItem).not.toHaveBeenCalled();
    expect(localStorage.removeItem).not.toHaveBeenCalled();
  });
});
