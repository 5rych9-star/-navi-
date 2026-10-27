export interface GeoPosition {
  lat: number;
  lng: number;
  accuracy: number;
  timestamp: number;
}

export type GeoStatus =
  | "idle"
  | "requesting"
  | "active"
  | "denied"
  | "unavailable"
  | "timeout"
  | "unsupported"
  | "insecure";

export interface GeoSnapshot {
  status: GeoStatus;
  position: GeoPosition | null;
  error: string | null;
}

export interface GeoController extends GeoSnapshot {
  start: () => void;
  stop: () => void;
}

export interface GeolocationSource {
  watchPosition: (
    success: PositionCallback,
    error?: PositionErrorCallback | null,
    options?: PositionOptions,
  ) => number;
  clearWatch: (watchId: number) => void;
}

export interface VisibilitySource {
  readonly hidden: boolean;
  addEventListener: (type: "visibilitychange", listener: () => void) => void;
  removeEventListener: (type: "visibilitychange", listener: () => void) => void;
}

export interface GeoDependencies {
  geolocation: GeolocationSource | null;
  isSecureContext: boolean;
  visibility?: VisibilitySource | null;
}

export interface GeolocationManager {
  getSnapshot: () => GeoSnapshot;
  subscribe: (listener: () => void) => () => void;
  start: () => void;
  stop: () => void;
}

const ACQUISITION_TIMEOUT_MS = 15_000;
const MESSAGES: Record<
  Exclude<GeoStatus, "idle" | "requesting" | "active">,
  string
> = {
  denied:
    "現在地の利用が許可されていません。ブラウザのサイト設定で位置情報を許可してから、もう一度お試しください。",
  unavailable:
    "現在地を取得できませんでした。電波の届く場所で、もう一度お試しください。地図や地域からも場所を設定できます。",
  timeout:
    "現在地の取得に時間がかかっています。窓際などへ移動して、もう一度お試しください。自動では再試行しません。",
  unsupported:
    "このブラウザは現在地の取得に対応していません。地図や地域から場所を設定してください。",
  insecure:
    "現在地を使うには、安全な接続（HTTPS）が必要です。HTTPSで開くか、地図や地域から場所を設定してください。",
};

function browserDependencies(): GeoDependencies {
  let geolocation: GeolocationSource | null = null;
  try {
    if (typeof navigator !== "undefined")
      geolocation = navigator.geolocation ?? null;
  } catch {
    // Some browsers deny even access to the geolocation property.
  }
  return {
    geolocation,
    isSecureContext:
      typeof window !== "undefined" && window.isSecureContext === true,
    visibility: typeof document === "undefined" ? null : document,
  };
}

/**
 * Explicitly started, memory-only location tracking. This module never writes
 * browser storage or sends a network request. It stops when the page is hidden.
 * The injected platform APIs allow lifecycle/race behavior to be tested without
 * requesting a real location or browser permission.
 */
export function createGeolocationController(
  dependencies: GeoDependencies = browserDependencies(),
): GeolocationManager {
  const { geolocation, isSecureContext, visibility } = dependencies;
  let snapshot: GeoSnapshot = { status: "idle", position: null, error: null };
  let generation = 0;
  let watchId: number | null = null;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let listeningForVisibility = false;
  const subscribers = new Set<() => void>();

  function publish(next: GeoSnapshot) {
    if (
      next.status === snapshot.status &&
      next.position === snapshot.position &&
      next.error === snapshot.error
    )
      return;
    snapshot = next;
    subscribers.forEach((listener) => listener());
  }

  function clearAcquisitionTimeout() {
    if (timeout !== null) clearTimeout(timeout);
    timeout = null;
  }

  function clearWatch(id: number) {
    try {
      geolocation?.clearWatch(id);
    } catch {
      /* State cleanup must still finish. */
    }
  }

  function release() {
    generation += 1;
    clearAcquisitionTimeout();
    if (watchId !== null) clearWatch(watchId);
    watchId = null;
    if (listeningForVisibility)
      visibility?.removeEventListener("visibilitychange", handleVisibility);
    listeningForVisibility = false;
  }

  function stop() {
    release();
    publish({ status: "idle", position: null, error: null });
  }

  function handleVisibility() {
    if (visibility?.hidden) stop();
  }

  function fail(
    status: Exclude<GeoStatus, "idle" | "requesting" | "active">,
    requestGeneration: number,
  ) {
    if (requestGeneration !== generation) return;
    release();
    publish({ status, position: null, error: MESSAGES[status] });
  }

  function receivePosition(
    value: GeolocationPosition,
    requestGeneration: number,
  ) {
    if (requestGeneration !== generation) return;
    if (visibility?.hidden) {
      stop();
      return;
    }
    const { latitude: lat, longitude: lng, accuracy } = value.coords;
    const { timestamp } = value;
    if (
      ![lat, lng, accuracy, timestamp].every(Number.isFinite) ||
      Math.abs(lat) > 90 ||
      Math.abs(lng) > 180 ||
      accuracy < 0 ||
      timestamp < 0
    ) {
      fail("unavailable", requestGeneration);
      return;
    }
    if (snapshot.position && timestamp < snapshot.position.timestamp) return;
    clearAcquisitionTimeout();
    publish({
      status: "active",
      position: { lat, lng, accuracy, timestamp },
      error: null,
    });
  }

  function start() {
    release();
    const requestGeneration = generation;
    if (!isSecureContext) {
      fail("insecure", requestGeneration);
      return;
    }
    if (!geolocation || typeof geolocation.watchPosition !== "function") {
      fail("unsupported", requestGeneration);
      return;
    }
    if (visibility?.hidden) {
      publish({ status: "idle", position: null, error: null });
      return;
    }
    publish({ status: "requesting", position: null, error: null });
    if (visibility) {
      visibility.addEventListener("visibilitychange", handleVisibility);
      listeningForVisibility = true;
    }
    timeout = setTimeout(
      () => fail("timeout", requestGeneration),
      ACQUISITION_TIMEOUT_MS,
    );
    try {
      const nextWatchId = geolocation.watchPosition(
        (value) => receivePosition(value, requestGeneration),
        (error) =>
          fail(
            error.code === 1
              ? "denied"
              : error.code === 3
                ? "timeout"
                : "unavailable",
            requestGeneration,
          ),
        {
          enableHighAccuracy: true,
          timeout: ACQUISITION_TIMEOUT_MS,
          maximumAge: 0,
        },
      );
      // A synchronous mock/browser error may stop the request before its watch
      // ID is returned. Clear that ID as well instead of leaking a live watch.
      if (requestGeneration === generation) watchId = nextWatchId;
      else clearWatch(nextWatchId);
    } catch {
      fail("unavailable", requestGeneration);
    }
  }

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      subscribers.add(listener);
      return () => {
        subscribers.delete(listener);
      };
    },
    start,
    stop,
  };
}
