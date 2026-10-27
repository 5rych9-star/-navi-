import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  LockKeyhole,
  Mail,
  ShieldCheck,
  UserRound,
  X,
} from "lucide-react";
import type { AuthController } from "../lib/auth";
import "./AuthDialog.css";

export interface AuthDialogProps {
  auth: AuthController;
  onClose: () => void;
}

type Mode = "signIn" | "signUp" | "reset" | "update";
type Field = "email" | "password" | "confirm";
type Success = { title: string; message: string; backToSignIn: boolean };

/** Credentials are held only while editing this dialog and passed to the auth service. */
export default function AuthDialog({ auth, onClose }: AuthDialogProps) {
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const alive = useRef(false);
  const closing = useRef(false);
  const [mode, setMode] = useState<Mode>(auth.recovery ? "update" : "signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState("");
  const [invalid, setInvalid] = useState<Field | null>(null);
  const [success, setSuccess] = useState<Success | null>(null);

  useEffect(() => {
    alive.current = true;
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      alive.current = false;
      dialog?.close();
    };
  }, []);

  useEffect(() => {
    if (!auth.recovery) return;
    setMode("update");
    setPassword("");
    setConfirmation("");
    setLocalError("");
    setInvalid(null);
    setSuccess(null);
    auth.clearError();
  }, [auth.recovery, auth.clearError]);

  const unconfigured = auth.status === "unconfigured";
  const loading = auth.status === "loading";
  const disabled = busy || loading;
  const account =
    auth.status === "signedIn" &&
    !auth.recovery &&
    mode !== "update" &&
    !success;
  const error = localError || auth.error;
  const newPassword = mode === "signUp" || mode === "update";
  const title = unconfigured
    ? "ログインの準備中"
    : success
      ? success.title
      : account
        ? "アカウント"
        : mode === "signUp"
          ? "新規登録"
          : mode === "reset"
            ? "パスワードを再設定"
            : mode === "update"
              ? "新しいパスワードを設定"
              : "ログイン";

  function clearPasswords() {
    setPassword("");
    setConfirmation("");
  }

  function close() {
    closing.current = true;
    clearPasswords();
    auth.clearError();
    onClose();
  }

  function changeMode(next: Mode) {
    if (disabled) return;
    clearPasswords();
    setMode(next);
    setSuccess(null);
    setLocalError("");
    setInvalid(null);
    auth.clearError();
  }

  function fail(message: string, field: Field) {
    setLocalError(message);
    setInvalid(field);
    ({ email: emailRef, password: passwordRef, confirm: confirmRef })[
      field
    ].current?.focus();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled || unconfigured) return;
    setLocalError("");
    setInvalid(null);
    auth.clearError();
    const address = email.trim();
    if (
      mode !== "update" &&
      (!address || emailRef.current?.validity.typeMismatch)
    ) {
      fail("メールアドレスを正しく入力してください。", "email");
      return;
    }
    if (mode !== "reset" && !password) {
      fail("パスワードを入力してください。", "password");
      return;
    }
    if (newPassword && password.length < 8) {
      fail("パスワードは8文字以上で入力してください。", "password");
      return;
    }
    if (newPassword && password !== confirmation) {
      fail(
        "確認用のパスワードが一致しません。もう一度ご確認ください。",
        "confirm",
      );
      return;
    }

    setBusy(true);
    try {
      const result = await (mode === "signIn"
        ? auth.signIn(address, password)
        : mode === "signUp"
          ? auth.signUp(address, password)
          : mode === "reset"
            ? auth.sendPasswordReset(address)
            : auth.updatePassword(password));
      if (!alive.current || closing.current) return;
      if (result.error) {
        setLocalError(result.error);
        return;
      }
      clearPasswords();
      if (mode === "reset") {
        setSuccess({
          title: "メールをご確認ください",
          message:
            "対象のアカウントがある場合は、パスワード再設定の案内が届きます。メール内のリンクから、新しいパスワードを設定してください。",
          backToSignIn: true,
        });
      } else if (mode === "signUp" && result.requiresEmailConfirmation) {
        setSuccess({
          title: "確認メールをご確認ください",
          message:
            "確認メールが届いたら、メール内のリンクから登録を完了してください。その後、この画面からログインできます。届かない場合は、迷惑メールのフォルダーや入力したメールアドレスもご確認ください。",
          backToSignIn: true,
        });
      } else if (mode === "update") {
        setSuccess({
          title: "パスワードを変更しました",
          message: "次回からは、新しいパスワードでログインできます。",
          backToSignIn: false,
        });
      } else {
        close();
      }
    } catch {
      if (alive.current && !closing.current)
        setLocalError(
          "接続できませんでした。通信状況をご確認のうえ、もう一度お試しください。",
        );
    } finally {
      if (alive.current && !closing.current) setBusy(false);
    }
  }

  const passwordLabel = mode === "update" ? "新しいパスワード" : "パスワード";
  const confirmationLabel =
    mode === "update" ? "新しいパスワード（確認）" : "パスワード（確認）";
  const submitLabel =
    mode === "signIn"
      ? "ログインする"
      : mode === "signUp"
        ? "アカウントを作成する"
        : mode === "reset"
          ? "再設定メールを送る"
          : "パスワードを変更する";

  return (
    <dialog
      ref={dialogRef}
      className="auth-dialog"
      aria-labelledby={`${id}-title`}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div className="auth-dialog-content">
        <div className="auth-dialog-heading">
          <div className="auth-dialog-title">
            <span className="auth-heading-icon" aria-hidden="true">
              <UserRound size={25} />
            </span>
            <h2 id={`${id}-title`}>{title}</h2>
          </div>
          <button
            type="button"
            className="auth-close"
            aria-label="ログイン画面を閉じる"
            onClick={close}
          >
            <X size={23} />
          </button>
        </div>

        {unconfigured ? (
          <div className="auth-preparation">
            <span className="auth-state-icon" aria-hidden="true">
              <ShieldCheck size={39} />
            </span>
            <p>
              アカウントを安全に確認するための接続設定が、まだ完了していません。
            </p>
            <p>準備ができるまで、ログイン・新規登録はご利用いただけません。</p>
            <button type="button" className="auth-primary" onClick={close}>
              閉じる
            </button>
          </div>
        ) : success ? (
          <div className="auth-success" role="status">
            <span className="auth-state-icon" aria-hidden="true">
              <CheckCircle2 size={42} />
            </span>
            <p>{success.message}</p>
            {success.backToSignIn && (
              <button
                type="button"
                className="auth-primary"
                onClick={() => changeMode("signIn")}
              >
                <ArrowLeft size={20} />
                ログインに戻る
              </button>
            )}
            <button
              type="button"
              className={
                success.backToSignIn ? "auth-secondary" : "auth-primary"
              }
              onClick={close}
            >
              閉じる
            </button>
          </div>
        ) : account ? (
          <div className="auth-account">
            <span className="auth-state-icon" aria-hidden="true">
              <CheckCircle2 size={42} />
            </span>
            <p>ログインしています。</p>
            {auth.user?.email && (
              <p className="auth-account-email">{auth.user.email}</p>
            )}
            <button type="button" className="auth-primary" onClick={close}>
              閉じる
            </button>
          </div>
        ) : (
          <>
            {(mode === "signIn" || mode === "signUp") && (
              <div
                className="auth-mode-buttons"
                role="group"
                aria-label="ログインと新規登録の切り替え"
              >
                <button
                  type="button"
                  aria-pressed={mode === "signIn"}
                  disabled={disabled}
                  onClick={() => changeMode("signIn")}
                >
                  ログイン
                </button>
                <button
                  type="button"
                  aria-pressed={mode === "signUp"}
                  disabled={disabled}
                  onClick={() => changeMode("signUp")}
                >
                  新規登録
                </button>
              </div>
            )}
            <p className="auth-description">
              {mode === "signIn"
                ? "登録したメールアドレスでログインしてください。"
                : mode === "signUp"
                  ? "初めての方は、メールアドレスとパスワードで登録できます。"
                  : mode === "reset"
                    ? "登録したメールアドレスに、再設定の案内をお送りします。"
                    : "メールのリンクを確認しました。新しいパスワードを設定してください。"}
            </p>
            {loading && (
              <p className="auth-progress" role="status">
                ログイン状態を確認しています…
              </p>
            )}
            <form
              className="auth-form"
              onSubmit={submit}
              noValidate
              aria-busy={disabled}
            >
              {mode !== "update" && (
                <div className="auth-field">
                  <label htmlFor={`${id}-email`}>
                    <Mail size={20} aria-hidden="true" />
                    メールアドレス
                  </label>
                  <input
                    id={`${id}-email`}
                    ref={emailRef}
                    type="email"
                    inputMode="email"
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck={false}
                    value={email}
                    onChange={(event) => {
                      setEmail(event.target.value);
                      if (invalid === "email") setInvalid(null);
                    }}
                    placeholder="例：name@example.com"
                    maxLength={254}
                    required
                    disabled={disabled}
                    aria-invalid={invalid === "email"}
                    aria-describedby={
                      invalid === "email" && error ? `${id}-error` : undefined
                    }
                  />
                </div>
              )}
              {mode !== "reset" && (
                <div className="auth-field">
                  <label htmlFor={`${id}-password`}>
                    <LockKeyhole size={20} aria-hidden="true" />
                    {passwordLabel}
                  </label>
                  <input
                    id={`${id}-password`}
                    ref={passwordRef}
                    type="password"
                    autoComplete={
                      newPassword ? "new-password" : "current-password"
                    }
                    value={password}
                    onChange={(event) => {
                      setPassword(event.target.value);
                      if (invalid === "password") setInvalid(null);
                    }}
                    required
                    minLength={newPassword ? 8 : undefined}
                    disabled={disabled}
                    aria-invalid={invalid === "password"}
                    aria-describedby={
                      [
                        newPassword ? `${id}-password-hint` : "",
                        invalid === "password" && error ? `${id}-error` : "",
                      ]
                        .filter(Boolean)
                        .join(" ") || undefined
                    }
                  />
                  {newPassword && (
                    <p className="auth-field-hint" id={`${id}-password-hint`}>
                      8文字以上で、ほかのサービスと異なるパスワードを設定してください。
                    </p>
                  )}
                </div>
              )}
              {newPassword && (
                <div className="auth-field">
                  <label htmlFor={`${id}-confirm`}>
                    <LockKeyhole size={20} aria-hidden="true" />
                    {confirmationLabel}
                  </label>
                  <input
                    id={`${id}-confirm`}
                    ref={confirmRef}
                    type="password"
                    autoComplete="new-password"
                    value={confirmation}
                    onChange={(event) => {
                      setConfirmation(event.target.value);
                      if (invalid === "confirm") setInvalid(null);
                    }}
                    required
                    disabled={disabled}
                    aria-invalid={invalid === "confirm"}
                    aria-describedby={
                      invalid === "confirm" && error ? `${id}-error` : undefined
                    }
                  />
                </div>
              )}
              {error && (
                <p className="auth-error" id={`${id}-error`} role="alert">
                  {error}
                </p>
              )}
              <button
                type="submit"
                className="auth-primary"
                disabled={disabled}
              >
                {busy ? "確認しています…" : submitLabel}
                {!busy && <ArrowRight size={21} aria-hidden="true" />}
              </button>
              {mode === "signIn" && (
                <button
                  type="button"
                  className="auth-link-button"
                  disabled={disabled}
                  onClick={() => changeMode("reset")}
                >
                  パスワードを忘れた方
                </button>
              )}
              {mode === "reset" && (
                <button
                  type="button"
                  className="auth-link-button"
                  disabled={disabled}
                  onClick={() => changeMode("signIn")}
                >
                  <ArrowLeft size={19} />
                  ログインに戻る
                </button>
              )}
            </form>
            <p className="auth-privacy">
              <ShieldCheck size={20} aria-hidden="true" />
              <span>
                ご自宅や現在地が、ほかの利用者へ公開されることはありません。
              </span>
            </p>
          </>
        )}
      </div>
    </dialog>
  );
}
