import { Platform } from "react-native";
import type { EmailOtpType } from "@supabase/supabase-js";
import {
  acceptAuthenticatedSession,
  ensureValidSession,
  supabase,
} from "../lib/supabase";

export function isAuthSessionMissing(error: unknown): boolean {
  if (!error) return false;
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error && "message" in error
        ? String((error as { message: unknown }).message)
        : String(error);
  return /auth session missing/i.test(message);
}

export type OtpSendFailure = "rate_limited" | "network" | "failed";

/** Buckets a Supabase signInWithOtp error (or thrown error) for the login screen. */
export function classifyOtpSendError(error: unknown): OtpSendFailure {
  const record = (error ?? {}) as { message?: unknown; code?: unknown; status?: unknown; name?: unknown };
  if (/signups? not allowed|signup_disabled|otp_disabled/i.test(`${record.code ?? ""} ${record.message ?? ""}`)) {
    // New-user sign-up is switched off in the Supabase dashboard (Auth → Providers).
    console.warn("[auth] OTP refused: sign-ups are disabled for this provider");
  }
  const message = String(record.message ?? error ?? "").toLowerCase();
  const code = String(record.code ?? "").toLowerCase();
  const status = Number(record.status);
  if (
    code.includes("rate_limit") ||
    status === 429 ||
    /security purposes|only request this after|after \d+ seconds|rate limit|too many requests/.test(message)
  ) {
    return "rate_limited";
  }
  if (
    record.name === "AuthRetryableFetchError" ||
    /network|failed to fetch|fetch failed|load failed|timed? ?out/.test(message)
  ) {
    return "network";
  }
  return "failed";
}

/**
 * Readable message for a failed verifyOtp. Supabase reports wrong and expired
 * codes with the same error, so the time since the code was sent decides.
 */
export function friendlyOtpVerifyError(
  error: unknown,
  sentAtMs: number,
  expirySeconds: number,
): string {
  const record = (error ?? {}) as { message?: unknown; code?: unknown };
  const message = String(record.message ?? error ?? "").toLowerCase();
  const code = String(record.code ?? "").toLowerCase();
  if (code === "otp_expired" || /expired|invalid|token/.test(message)) {
    return Date.now() - sentAtMs > expirySeconds * 1000
      ? "This OTP has expired. Please request a new OTP."
      : "Incorrect OTP. Please check the code and try again.";
  }
  if (classifyOtpSendError(error) === "network") {
    return "Network error. Please check your connection and try again.";
  }
  return "Unable to verify OTP. Please try again.";
}

/**
 * Sends a phone OTP for login OR registration: Supabase signs in the existing
 * user for a known number and creates the auth user only for a new number, so
 * no duplicate account is ever made for the same phone.
 */
export async function sendOTP(phone: string) {
  const first = await supabase.auth.signInWithOtp({
    phone,
    options: { shouldCreateUser: true },
  });

  if (first.error && isAuthSessionMissing(first.error)) {
    await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
    return await supabase.auth.signInWithOtp({
      phone,
      options: { shouldCreateUser: true },
    });
  }

  return first;
}

export async function verifyOTP(
  phone: string,
  otp: string
) {
  const result = await supabase.auth.verifyOtp({
    phone,
    token: otp,
    type: "sms",
  });

  if (!result.error && result.data.session) {
    acceptAuthenticatedSession(result.data.session);
    await ensureValidSession();
  }

  return result;
}

/**
 * Ends the current user's session on this device only. Server data (profile,
 * ponds, Ask Prana history, files) is never touched. Supabase emits
 * SIGNED_OUT, which the profile and Ask Prana contexts use to reset state.
 */
/**
 * Web only: finishes sign-in when Ask Prana is opened from an email link.
 * Handles every link format Supabase can send — `#access_token` (implicit),
 * `?token_hash=&type=` (custom template), `?code=` (PKCE) — and link errors
 * such as an expired/used link, then removes the tokens from the address bar.
 * Returns an error message for the login screen when the link can't be used.
 */
// Address the app was opened with, captured before the Supabase client can
// strip the link's #tokens/#error from it. Processed at most once.
const INITIAL_WEB_URL =
  Platform.OS === "web" && typeof window !== "undefined" ? window.location.href : "";
let emailLinkProcessed = false;

export async function completeEmailLinkSignIn(): Promise<{
  handled: boolean;
  error: string | null;
}> {
  if (Platform.OS !== "web" || typeof window === "undefined" || emailLinkProcessed) {
    return { handled: false, error: null };
  }
  emailLinkProcessed = true;
  const url = new URL(INITIAL_WEB_URL || window.location.href);
  const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
  const query = url.searchParams;
  const get = (key: string) => hash.get(key) ?? query.get(key);

  const linkError = get("error_code") || get("error");
  const tokenHash = query.get("token_hash");
  const code = query.get("code");
  const accessToken = hash.get("access_token");
  const refreshToken = hash.get("refresh_token");
  if (!linkError && !tokenHash && !code && !accessToken) {
    return { handled: false, error: null };
  }

  const clearUrl = () => {
    window.history.replaceState(null, "", `${url.origin}${url.pathname}`);
  };

  if (linkError) {
    clearUrl();
    const expired = /otp_expired|expired/i.test(`${linkError} ${get("error_description") ?? ""}`);
    console.warn("[auth] email link error:", linkError);
    return {
      handled: true,
      error: expired
        ? "This sign-in link has expired or was already used. Please request a new one."
        : "This sign-in link couldn't be used. Please request a new one.",
    };
  }

  let failed = false;
  if (tokenHash) {
    const type = (query.get("type") || "magiclink") as EmailOtpType;
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    failed = Boolean(error);
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    failed = Boolean(error);
  } else if (accessToken && refreshToken) {
    // Normally read automatically (detectSessionInUrl); set it if that missed.
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      const { error } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      failed = Boolean(error);
    }
  }
  clearUrl();
  if (failed) {
    console.warn("[auth] email link sign-in failed");
    return {
      handled: true,
      error: "This sign-in link has expired or was already used. Please request a new one.",
    };
  }
  return { handled: true, error: null };
}

export async function logout(): Promise<{ error: Error | null }> {
  const { error } = await supabase.auth.signOut({ scope: "local" });
  if (error && !isAuthSessionMissing(error)) {
    // Safe diagnostics only — never log tokens or the session object.
    console.warn("[auth] signOut failed:", error.name, error.message);
    return { error };
  }
  // An already-expired/missing session counts as logged out.
  return { error: null };
}
