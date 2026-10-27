import { describe, expect, it } from "vitest";
import {
  getAuthErrorMessage,
  validateAuthEmail,
  validateAuthPassword,
  validateSignInPassword,
  type AuthOperation,
} from "./auth";

describe("authentication input and safe error helpers", () => {
  it("accepts a trimmed email and rejects malformed email addresses", () => {
    expect(validateAuthEmail(" person@example.com ")).toBeNull();
    for (const email of [
      "",
      "invalid",
      "person@",
      "@example.com",
      "person @example.com",
    ])
      expect(validateAuthEmail(email)).toContain("メールアドレス");
  });

  it("validates password length without trimming or storing it", () => {
    expect(validateAuthPassword("12345678")).toBeNull();
    expect(validateAuthPassword(" 123456 ")).toBeNull();
    expect(validateAuthPassword("1234567")).toContain("8文字");
    expect(validateAuthPassword("x".repeat(129))).toContain("128文字");
  });

  it("does not prevent existing provider accounts from signing in with a shorter password", () => {
    expect(validateSignInPassword("short")).toBeNull();
    expect(validateSignInPassword("")).toContain("パスワード");
    expect(validateSignInPassword("x".repeat(129))).toContain("128文字");
    expect(validateAuthPassword("short")).toContain("8文字");
  });

  it.each([
    ["invalid_credentials", "メールアドレスまたはパスワード"],
    ["email_not_confirmed", "確認メール"],
    ["over_email_send_rate_limit", "時間をおいて"],
    ["weak_password", "推測されにくい"],
    ["signup_disabled", "受け付けていません"],
    ["flow_state_expired", "有効期限"],
    ["refresh_token_not_found", "ログイン"],
  ])("translates known provider code %s", (code, expected) => {
    expect(
      getAuthErrorMessage(
        { code, message: "private provider message" },
        "signIn",
      ),
    ).toContain(expected);
  });

  it("never exposes raw error messages, tokens, URLs, email addresses or unknown codes", () => {
    const sensitive =
      "person@example.com https://internal.example/token?key=private access_token=private";
    const operations: AuthOperation[] = [
      "signIn",
      "signUp",
      "signOut",
      "passwordReset",
      "passwordUpdate",
      "session",
    ];
    for (const operation of operations) {
      const message = getAuthErrorMessage(
        { code: sensitive, message: sensitive },
        operation,
      );
      expect(message).not.toContain("person@example.com");
      expect(message).not.toContain("internal.example");
      expect(message).not.toContain("private");
      expect(message).not.toContain("access_token");
    }
  });

  it("maps network failures and rate limits without exposing provider details", () => {
    expect(
      getAuthErrorMessage(new TypeError("private details"), "signOut"),
    ).toContain("通信できません");
    expect(
      getAuthErrorMessage({ name: "AuthRetryableFetchError" }, "signIn"),
    ).toContain("通信できません");
    expect(getAuthErrorMessage({ status: 429 }, "signUp")).toContain(
      "時間をおいて",
    );
  });
});
