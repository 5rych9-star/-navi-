export interface AuthUser {
  id: string;
  email?: string;
}

export interface AuthResult {
  error: string | null;
  requiresEmailConfirmation?: boolean;
}

export interface AuthController {
  status: "unconfigured" | "loading" | "signedOut" | "signedIn";
  user: AuthUser | null;
  error: string | null;
  recovery: boolean;
  signIn: (email: string, password: string) => Promise<AuthResult>;
  signUp: (email: string, password: string) => Promise<AuthResult>;
  signOut: () => Promise<AuthResult>;
  sendPasswordReset: (email: string) => Promise<AuthResult>;
  updatePassword: (password: string) => Promise<AuthResult>;
  clearError: () => void;
}

export type AuthOperation =
  | "signIn"
  | "signUp"
  | "signOut"
  | "passwordReset"
  | "passwordUpdate"
  | "session";

export const AUTH_SETUP_REQUIRED =
  "ログイン機能はまだ接続されていません。Supabaseの接続設定を行ってください。";
export const AUTH_REDIRECT_ERROR =
  "確認メールの戻り先を設定できませんでした。アプリの公開URL設定をご確認ください。";

export function validateAuthEmail(email: string): string | null {
  return typeof email === "string" &&
    email.trim().length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
    ? null
    : "メールアドレスを正しく入力してください。";
}

export function validateAuthPassword(password: string): string | null {
  return typeof password === "string" &&
    password.length >= 8 &&
    password.length <= 128
    ? null
    : "パスワードは8文字以上、128文字以内で入力してください。";
}

/** Existing provider accounts may have passwords shorter than today's signup minimum. */
export function validateSignInPassword(password: string): string | null {
  return typeof password === "string" &&
    password.length > 0 &&
    password.length <= 128
    ? null
    : "パスワードを入力してください（128文字以内）。";
}

/** Provider messages can contain personal details. Never pass them to the UI. */
export function getAuthErrorMessage(
  error: unknown,
  operation: AuthOperation,
): string {
  let code = "";
  let name = "";
  let status: unknown;
  if (typeof error === "object" && error !== null) {
    const value = error as Record<string, unknown>;
    code = typeof value.code === "string" ? value.code : "";
    name = typeof value.name === "string" ? value.name : "";
    status = value.status;
  }
  if (code === "invalid_credentials")
    return "メールアドレスまたはパスワードをご確認ください。";
  if (code === "email_not_confirmed")
    return "確認メールのリンクを開いてから、ログインしてください。";
  if (
    [
      "over_email_send_rate_limit",
      "over_request_rate_limit",
      "over_sms_send_rate_limit",
    ].includes(code) ||
    status === 429
  ) {
    return "操作が続いたため、少し時間をおいてからお試しください。";
  }
  if (["weak_password", "password_too_short"].includes(code))
    return "より推測されにくい、8文字以上のパスワードを設定してください。";
  if (code === "same_password")
    return "以前とは異なるパスワードを設定してください。";
  if (["email_address_invalid", "validation_failed"].includes(code))
    return "入力したメールアドレスとパスワードをご確認ください。";
  if (code === "signup_disabled")
    return "現在、新しいアカウントの登録を受け付けていません。";
  if (["user_already_exists", "email_exists"].includes(code))
    return "このメールアドレスでは新規登録できません。登録済みの場合はログインかパスワード再設定をお試しください。";
  if (
    ["otp_expired", "flow_state_expired", "flow_state_not_found"].includes(code)
  )
    return "確認リンクの有効期限が切れています。もう一度メールの送信をお試しください。";
  if (
    [
      "bad_jwt",
      "session_not_found",
      "refresh_token_not_found",
      "refresh_token_already_used",
    ].includes(code)
  )
    return "ログインの有効期限が切れました。もう一度ログインしてください。";
  if (
    error instanceof TypeError ||
    name === "AuthRetryableFetchError" ||
    status === 0
  )
    return "通信できませんでした。インターネット接続を確認して、もう一度お試しください。";

  const messages: Record<AuthOperation, string> = {
    signIn: "ログインできませんでした。時間をおいて、もう一度お試しください。",
    signUp:
      "アカウントを登録できませんでした。時間をおいて、もう一度お試しください。",
    signOut:
      "ログアウトできませんでした。接続を確認して、もう一度お試しください。",
    passwordReset:
      "再設定メールを送信できませんでした。時間をおいて、もう一度お試しください。",
    passwordUpdate:
      "パスワードを変更できませんでした。確認メールから操作をやり直してください。",
    session:
      "ログイン状態を確認できませんでした。接続を確認して、もう一度ログインしてください。",
  };
  return messages[operation];
}
