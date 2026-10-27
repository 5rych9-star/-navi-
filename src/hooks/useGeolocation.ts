import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  createGeolocationController,
  type GeoController,
} from "../lib/geolocation";

export type { GeoController, GeoPosition, GeoStatus } from "../lib/geolocation";

/** No permission request is made until the user explicitly calls start(). */
export default function useGeolocation(): GeoController {
  const [manager] = useState(() => createGeolocationController());
  const snapshot = useSyncExternalStore(
    manager.subscribe,
    manager.getSnapshot,
    manager.getSnapshot,
  );
  useEffect(() => () => manager.stop(), [manager]);
  return useMemo(
    () => ({ ...snapshot, start: manager.start, stop: manager.stop }),
    [snapshot, manager],
  );
}
