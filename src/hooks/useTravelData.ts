import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AuthController } from "../lib/auth";
import { getSupabaseClient } from "../lib/supabase";
import { createUserDataRepository, type UserTravelData } from "../lib/userData";
import {
  clearUserData as clearGuestData,
  loadProfile,
  loadTrips,
  saveProfile as saveGuestProfile,
  saveTrips as saveGuestTrips,
  type Profile,
  type SavedTrip,
} from "../lib/storage";

const EMPTY: UserTravelData = { profile: null, trips: [] };

/** Account data never falls back to another account's or the guest's storage. */
export default function useTravelData(auth: AuthController) {
  const guest = auth.status === "unconfigured";
  const userId = auth.status === "signedIn" ? auth.user?.id : null;
  const repository = useMemo(() => {
    const client = userId ? getSupabaseClient() : null;
    try {
      return client && userId ? createUserDataRepository(client, userId) : null;
    } catch {
      return null;
    }
  }, [userId]);
  const [data, setData] = useState<UserTravelData>(() =>
    guest ? { profile: loadProfile(), trips: loadTrips() } : EMPTY,
  );
  const [loading, setLoading] = useState(Boolean(userId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const alive = useRef(false);
  const writing = useRef(false);
  const readable = useRef(guest);
  const dataRef = useRef(data);
  dataRef.current = data;

  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    if (!repository) {
      setLoading(false);
      readable.current = guest;
      if (userId)
        setError(
          "ログイン情報を確認できません。ログアウトして、もう一度ログインしてください。",
        );
      return () => {
        alive.current = false;
      };
    }
    readable.current = false;
    setLoading(true);
    setError(null);
    void repository
      .load()
      .then((value) => {
        if (cancelled) return;
        setData(value);
        dataRef.current = value;
        readable.current = true;
      })
      .catch(() => {
        if (!cancelled) {
          setData(EMPTY);
          dataRef.current = EMPTY;
          setError(
            "ご自身の登録情報を読み込めませんでした。接続と保存先の設定を確認して、再読み込みしてください。",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      alive.current = false;
    };
  }, [repository, retry, guest, userId]);

  const persist = useCallback(
    async (next: UserTravelData): Promise<boolean> => {
      if (writing.current || !readable.current || (!guest && !repository))
        return false;
      writing.current = true;
      setBusy(true);
      setError(null);
      try {
        if (repository) await repository.save(next);
        else if (guest) {
          // Guest mode is explicitly a device-local demo, never authentication.
          if (next.profile && !saveGuestProfile(next.profile))
            throw new Error("guest storage unavailable");
          if (!saveGuestTrips(next.trips))
            throw new Error("guest storage unavailable");
        }
        if (!alive.current) return false;
        dataRef.current = next;
        setData(next);
        return true;
      } catch {
        if (alive.current)
          setError(
            "保存できませんでした。接続と保存先の設定を確認して、もう一度お試しください。",
          );
        return false;
      } finally {
        writing.current = false;
        if (alive.current) setBusy(false);
      }
    },
    [guest, repository],
  );

  const saveProfile = useCallback(
    (profile: Profile) => persist({ ...dataRef.current, profile }),
    [persist],
  );
  const saveTrips = useCallback(
    (trips: SavedTrip[]) => persist({ ...dataRef.current, trips }),
    [persist],
  );
  const clear = useCallback(async (): Promise<boolean> => {
    if (writing.current || !readable.current || (!guest && !repository))
      return false;
    writing.current = true;
    setBusy(true);
    setError(null);
    try {
      if (repository) await repository.clear();
      else if (!clearGuestData()) throw new Error("guest storage unavailable");
      if (!alive.current) return false;
      dataRef.current = EMPTY;
      setData(EMPTY);
      return true;
    } catch {
      if (alive.current)
        setError(
          "削除できませんでした。接続を確認して、もう一度お試しください。",
        );
      return false;
    } finally {
      writing.current = false;
      if (alive.current) setBusy(false);
    }
  }, [guest, repository]);

  return {
    ...data,
    loading,
    busy,
    error,
    saveProfile,
    saveTrips,
    clear,
    reload: () => setRetry((value) => value + 1),
  };
}
