import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type AuthController,
  type AuthOperation,
  type AuthResult,
  type AuthUser,
  AUTH_REDIRECT_ERROR,
  AUTH_SETUP_REQUIRED,
  getAuthErrorMessage,
  validateAuthEmail,
  validateAuthPassword,
  validateSignInPassword,
} from "../lib/auth";
import {
  buildAuthRedirectUrl,
  clearPasswordRecovery,
  getAuthConfiguration,
  getSupabaseClient,
  hasPendingPasswordRecovery,
  isGuestModeAllowed,
} from "../lib/supabase";

export type { AuthController, AuthResult, AuthUser } from "../lib/auth";

/** Real provider authentication. Passwords are passed directly to Auth and never persisted. */
export default function useAuth(): AuthController {
  const [client] = useState(getSupabaseClient);
  // An unusable configured connection must fail closed. Falling back to the
  // demo would expose a previous visitor's legacy browser-local profile.
  const [status, setStatus] = useState<AuthController["status"]>(
    client ? "loading" : isGuestModeAllowed() ? "unconfigured" : "signedOut",
  );
  const [user, setUser] = useState<AuthUser | null>(null);
  const [error, setError] = useState<string | null>(() =>
    client ? null : (getAuthConfiguration().error ?? AUTH_SETUP_REQUIRED),
  );
  const [recovery, setRecovery] = useState(hasPendingPasswordRecovery);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    if (!client)
      return () => {
        mounted.current = false;
      };
    let active = true;
    let eventVersion = 0;
    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((event, session) => {
      // Never await another provider operation inside this callback: doing so
      // can deadlock the Supabase auth lock.
      if (!active) return;
      eventVersion += 1;
      setUser(
        session?.user
          ? { id: session.user.id, email: session.user.email }
          : null,
      );
      setStatus(session?.user ? "signedIn" : "signedOut");
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
      if (event === "INITIAL_SESSION")
        setRecovery(hasPendingPasswordRecovery());
      if (event === "SIGNED_OUT") setRecovery(false);
    });
    const initialEventVersion = eventVersion;
    void client.auth
      .getSession()
      .then(({ data, error: sessionError }) => {
        if (!active || eventVersion !== initialEventVersion) return;
        if (sessionError) {
          setUser(null);
          setStatus("signedOut");
          setError(getAuthErrorMessage(sessionError, "session"));
          return;
        }
        setUser(
          data.session?.user
            ? { id: data.session.user.id, email: data.session.user.email }
            : null,
        );
        setStatus(data.session?.user ? "signedIn" : "signedOut");
        setRecovery(hasPendingPasswordRecovery());
      })
      .catch((cause) => {
        if (!active || eventVersion !== initialEventVersion) return;
        setStatus("signedOut");
        setError(getAuthErrorMessage(cause, "session"));
      });
    return () => {
      active = false;
      mounted.current = false;
      subscription.unsubscribe();
    };
  }, [client]);

  const result = useCallback(
    (
      message: string | null,
      requiresEmailConfirmation?: boolean,
    ): AuthResult => {
      if (mounted.current) setError(message);
      return requiresEmailConfirmation === undefined
        ? { error: message }
        : { error: message, requiresEmailConfirmation };
    },
    [],
  );
  const providerFailure = useCallback(
    (cause: unknown, operation: AuthOperation) =>
      result(getAuthErrorMessage(cause, operation)),
    [result],
  );
  const redirectUrl = useCallback(
    () =>
      typeof window === "undefined"
        ? null
        : buildAuthRedirectUrl(
            window.location.origin,
            import.meta.env.BASE_URL,
            window.location.pathname,
          ),
    [],
  );

  const signIn = useCallback(
    async (email: string, password: string): Promise<AuthResult> => {
      if (!client) return result(AUTH_SETUP_REQUIRED);
      const validation =
        validateAuthEmail(email) || validateSignInPassword(password);
      if (validation) return result(validation);
      try {
        const { data, error: authError } = await client.auth.signInWithPassword(
          { email: email.trim(), password },
        );
        if (authError) return providerFailure(authError, "signIn");
        if (!data.session) return providerFailure(null, "signIn");
        return result(null);
      } catch (cause) {
        return providerFailure(cause, "signIn");
      }
    },
    [client, result, providerFailure],
  );

  const signUp = useCallback(
    async (email: string, password: string): Promise<AuthResult> => {
      if (!client) return result(AUTH_SETUP_REQUIRED);
      const validation =
        validateAuthEmail(email) || validateAuthPassword(password);
      if (validation) return result(validation);
      const redirect = redirectUrl();
      if (!redirect) return result(AUTH_REDIRECT_ERROR);
      try {
        const { data, error: authError } = await client.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: redirect },
        });
        if (authError) return providerFailure(authError, "signUp");
        return result(null, !data.session);
      } catch (cause) {
        return providerFailure(cause, "signUp");
      }
    },
    [client, result, providerFailure, redirectUrl],
  );

  const signOut = useCallback(async (): Promise<AuthResult> => {
    if (!client) return result(AUTH_SETUP_REQUIRED);
    try {
      const { error: authError } = await client.auth.signOut({
        scope: "local",
      });
      if (authError) return providerFailure(authError, "signOut");
      // Provider events, not an optimistic local state change, end the session.
      return result(null);
    } catch (cause) {
      return providerFailure(cause, "signOut");
    }
  }, [client, result, providerFailure]);

  const sendPasswordReset = useCallback(
    async (email: string): Promise<AuthResult> => {
      if (!client) return result(AUTH_SETUP_REQUIRED);
      const validation = validateAuthEmail(email);
      if (validation) return result(validation);
      const redirect = redirectUrl();
      if (!redirect) return result(AUTH_REDIRECT_ERROR);
      try {
        const { error: authError } = await client.auth.resetPasswordForEmail(
          email.trim(),
          { redirectTo: redirect },
        );
        return authError
          ? providerFailure(authError, "passwordReset")
          : result(null);
      } catch (cause) {
        return providerFailure(cause, "passwordReset");
      }
    },
    [client, result, providerFailure, redirectUrl],
  );

  const updatePassword = useCallback(
    async (password: string): Promise<AuthResult> => {
      if (!client) return result(AUTH_SETUP_REQUIRED);
      const validation = validateAuthPassword(password);
      if (validation) return result(validation);
      if (!user)
        return result(
          "パスワードの変更には、確認メールのリンクから開くかログインしてください。",
        );
      try {
        const { error: authError } = await client.auth.updateUser({ password });
        if (authError) return providerFailure(authError, "passwordUpdate");
        clearPasswordRecovery();
        if (mounted.current) setRecovery(false);
        return result(null);
      } catch (cause) {
        return providerFailure(cause, "passwordUpdate");
      }
    },
    [client, result, providerFailure, user],
  );

  const clearError = useCallback(() => setError(null), []);
  return useMemo(
    () => ({
      status,
      user,
      error,
      recovery,
      signIn,
      signUp,
      signOut,
      sendPasswordReset,
      updatePassword,
      clearError,
    }),
    [
      status,
      user,
      error,
      recovery,
      signIn,
      signUp,
      signOut,
      sendPasswordReset,
      updatePassword,
      clearError,
    ],
  );
}
