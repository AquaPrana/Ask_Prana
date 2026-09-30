import { Platform } from "react-native";
import * as Linking from "expo-linking";
import type { User } from "@supabase/supabase-js";
import { supabase, waitForAuthReady, withTimeout } from "../lib/supabase";
import { isAuthSessionMissing } from "./auth";
import { getFarmerProfile } from "./local-profile";

export const ACCOUNT_DELETED_MESSAGE =
  "This account has been deleted.\nPlease contact support to restore your account.";

const PROFILE_QUERY_TIMEOUT_MS = 10000;

export type UserProfile = {
  name: string;
  state: string;
  district: string;
  language: string;
  phone?: string;
  avatarUrl?: string | null;
  avatarUpdatedAt?: string | null;
  isDeleted?: boolean;
};

export async function getCurrentUserProfile(): Promise<{
  profile: UserProfile | null;
  error: Error | null;
}> {
  try {
    const session = await waitForAuthReady();
    const user = session?.user;

    if (!user) {
      return { profile: null, error: null };
    }

    const { data, error } = await withTimeout(
      supabase
        .from("users")
        .select(
          "name, state, district, language, phone, avatar_url, avatar_updated_at, is_deleted",
        )
        .eq("id", user.id)
        .maybeSingle(),
      PROFILE_QUERY_TIMEOUT_MS,
      "users.profile",
    );

    if (error) {
      if (isAuthSessionMissing(error)) {
        return { profile: null, error: null };
      }
      return { profile: null, error: new Error(error.message) };
    }

    if (!data) {
      return {
        profile: {
          name: "",
          state: "",
          district: "",
          language: "English",
          phone: user.phone ?? "",
        },
        error: null,
      };
    }

    return {
      profile: {
        name: data.name || "",
        state: data.state || "",
        district: data.district || "",
        language: data.language || "English",
        phone: data.phone || user.phone || "",
        avatarUrl: data.avatar_url ?? null,
        avatarUpdatedAt: data.avatar_updated_at ?? null,
        isDeleted: Boolean(data.is_deleted),
      },
      error: null,
    };
  } catch (error: unknown) {
    return {
      profile: null,
      error: new Error(
        error instanceof Error
          ? error.message
          : "Unable to load profile right now.",
      ),
    };
  }
}

export async function isCurrentUserDeleted(): Promise<boolean> {
  try {
    const session = await waitForAuthReady();
    const userId = session?.user?.id;

    if (!userId) {
      return false;
    }

    const { data, error } = await withTimeout(
      supabase
        .from("users")
        .select("is_deleted")
        .eq("id", userId)
        .maybeSingle(),
      PROFILE_QUERY_TIMEOUT_MS,
      "users.is_deleted",
    );

    if (error || !data) {
      return false;
    }

    return Boolean(data.is_deleted);
  } catch {
    return false;
  }
}

export async function farmerExistsForPhone(phone: string): Promise<{
  exists: boolean;
  profile: UserProfile | null;
  error: Error | null;
}> {
  const { data, error } = await supabase
    .from("users")
    .select("name, state, district, language, phone, is_deleted")
    .eq("phone", phone)
    .maybeSingle();

  if (error) {
    if (isAuthSessionMissing(error)) {
      return { exists: false, profile: null, error: null };
    }
    return { exists: false, profile: null, error: new Error(error.message) };
  }

  if (data?.is_deleted) {
    return {
      exists: true,
      profile: {
        name: data.name || "",
        state: data.state || "",
        district: data.district || "",
        language: data.language || "English",
        phone: data.phone || "",
        isDeleted: true,
      },
      error: null,
    };
  }

  if (data?.name?.trim()) {
    return {
      exists: true,
      profile: {
        ...data,
        isDeleted: Boolean(data.is_deleted),
      },
      error: null,
    };
  }

  return { exists: false, profile: null, error: null };
}

export async function saveProfile(
  name: string,
  state: string,
  district: string,
  language: string,
  phone?: string,
) {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.id) {
    return {
      data: null,
      error: new Error("You must be signed in to update your profile."),
    };
  }

  return await supabase.from("users").upsert({
    id: user.id,
    phone: phone?.trim() || user.phone,
    name,
    state,
    district,
    language,
  });
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Trimmed, lower-cased form used for comparison and for Supabase Auth. */
export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string) {
  return EMAIL_PATTERN.test(normalizeEmail(email));
}

/**
 * none = no email on the account; verified = confirmed email; unverified =
 * email present but not confirmed; pending = a change awaits confirmation.
 */
export type EmailStatus = "none" | "verified" | "unverified" | "pending";

export type AuthEmailState = {
  email: string;
  pendingEmail: string;
  status: EmailStatus;
};

function emailStateFromUser(user: User): AuthEmailState {
  const email = user.email ?? "";
  const pendingEmail = user.new_email ?? "";
  const status: EmailStatus = pendingEmail
    ? "pending"
    : !email
      ? "none"
      : user.email_confirmed_at
        ? "verified"
        : "unverified";
  return { email, pendingEmail, status };
}

/** Readable message for Supabase Auth email errors (raw errors are only logged). */
export function friendlyEmailError(error: unknown): string {
  const record = (error ?? {}) as { message?: unknown; code?: unknown; status?: unknown };
  const message = String(record.message ?? error ?? "").toLowerCase();
  const code = String(record.code ?? "").toLowerCase();
  const status = Number(record.status);
  console.warn("[profile] email update error:", code || status || "unknown", record.message ?? "");

  if (code === "email_exists" || code === "user_already_exists" || /already (been )?registered|already exists|already in use/.test(message)) {
    return "This email address is already associated with another account.";
  }
  if (code === "email_address_invalid" || code === "validation_failed" || /invalid.*email|unable to validate email|email address.*invalid/.test(message)) {
    return "Please enter a valid email address, for example farmer@example.com.";
  }
  // Per-address cooldown: "For security purposes, you can only request this after 42 seconds."
  const waitSeconds = message.match(/after (\d+) seconds?/)?.[1];
  if (waitSeconds || code === "over_request_rate_limit" || /security purposes/.test(message)) {
    return waitSeconds
      ? `Please wait ${waitSeconds} seconds before requesting another code.`
      : "Please wait a minute before requesting another code.";
  }
  // Project-wide email quota (Supabase's built-in sender allows only a few emails per hour).
  if (code === "over_email_send_rate_limit" || /email rate limit/.test(message)) {
    return "Email sending limit reached for now. Please try again in about an hour, or log in with your phone number.";
  }
  if (code.includes("rate_limit") || status === 429 || /rate limit|too many/.test(message)) {
    return "Too many email requests. Please wait a few minutes and try again.";
  }
  if (code === "otp_expired" || /expired/.test(message)) {
    return "The verification link has expired. Please request a new verification email.";
  }
  if (code === "email_provider_disabled" || /email.*(disabled|not enabled)|signups? not allowed/.test(message)) {
    return "Email can't be added to this account right now. Please try again later.";
  }
  if (code === "session_not_found" || code === "bad_jwt" || status === 401 || /session|jwt|not authenticated|auth session missing/.test(message)) {
    return "Your session has expired. Please log in again and retry.";
  }
  if (/fetch|network|timed out|timeout|offline/.test(message)) {
    return "Network problem. Please check your internet connection and try again.";
  }
  return "Unable to send the verification code. Please try again.";
}

/**
 * Where the verification link returns. On web the existing Supabase client
 * (detectSessionInUrl) picks up the session from that URL; on native the
 * confirmation completes on Supabase and the screen re-reads the user on focus.
 * Must be listed under Auth → URL Configuration → Redirect URLs.
 */
function emailRedirectUrl(): string | undefined {
  if (Platform.OS === "web") {
    return typeof window !== "undefined" ? `${window.location.origin}/edit-profile` : undefined;
  }
  return Linking.createURL("/edit-profile");
}

/** Latest email state from the Auth server (not a cached session). */
export async function getCurrentUserEmailState(): Promise<{
  state: AuthEmailState | null;
  error: string | null;
}> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return { state: null, error: error ? friendlyEmailError(error) : null };
  }
  return { state: emailStateFromUser(data.user), error: null };
}

/**
 * Email lives on the Supabase Auth user (the users table has no email column),
 * so it is changed through Auth for the signed-in user only. Phone/OTP sign-in
 * is unaffected. With email confirmation on, Supabase sends a link and the
 * change stays pending (`new_email`) until it is confirmed.
 */
export async function requestCurrentUserEmailChange(email: string): Promise<{
  state: AuthEmailState | null;
  error: string | null;
}> {
  const { data, error } = await supabase.auth.updateUser(
    { email: normalizeEmail(email) },
    { emailRedirectTo: emailRedirectUrl() },
  );
  if (error) return { state: null, error: friendlyEmailError(error) };
  return { state: data.user ? emailStateFromUser(data.user) : null, error: null };
}

/** Re-sends the confirmation for a pending email change. */
export async function resendEmailChangeVerification(pendingEmail: string): Promise<{
  error: string | null;
}> {
  const { error } = await supabase.auth.resend({
    type: "email_change",
    email: normalizeEmail(pendingEmail),
    options: { emailRedirectTo: emailRedirectUrl() },
  });
  return { error: error ? friendlyEmailError(error) : null };
}

/**
 * Digits in the Supabase email OTP (Auth → Providers → Email → "Email OTP
 * length"). Keep in sync with the dashboard; codes of 6–10 digits are accepted.
 */
export const EMAIL_OTP_LENGTH = 8;

function friendlyEmailOtpError(error: unknown): string {
  const record = (error ?? {}) as { message?: unknown; code?: unknown; status?: unknown };
  const message = String(record.message ?? "").toLowerCase();
  const code = String(record.code ?? "").toLowerCase();
  // Supabase reports wrong and expired codes with the same error.
  if (code === "otp_expired" || /token has expired or is invalid|invalid.*(otp|token)|otp.*invalid/.test(message)) {
    console.warn("[profile] email OTP rejected:", code || "otp_invalid");
    return "This code is invalid or has expired. Check the code, or request a new one.";
  }
  return friendlyEmailError(error);
}

/**
 * Confirms an email change for the CURRENT signed-in user with the code
 * Supabase emailed after `updateUser({ email })`. The session stays the same
 * user, so no second account is created. With "Secure email change" on and an
 * existing email, both addresses must confirm; the state stays "pending" until then.
 */
export async function verifyEmailChangeCode(email: string, code: string): Promise<{
  state: AuthEmailState | null;
  error: string | null;
}> {
  const { error } = await supabase.auth.verifyOtp({
    email: normalizeEmail(email),
    token: code.trim(),
    type: "email_change",
  });
  if (error) return { state: null, error: friendlyEmailOtpError(error) };
  const { state } = await getCurrentUserEmailState();
  return { state, error: null };
}

/** Masks an email for display, e.g. v****@gmail.com. */
export function maskEmail(email: string) {
  const [local, domain] = normalizeEmail(email).split("@");
  if (!local || !domain) return email;
  return `${local[0]}${"*".repeat(Math.max(3, local.length - 1))}@${domain}`;
}

// ---------------------------------------------------------------------------
// Email login / registration (same unified OTP flow as phone)
// ---------------------------------------------------------------------------

/** Where a magic link returns on web; the existing client reads the session from it. */
function loginRedirectUrl(): string | undefined {
  if (Platform.OS === "web") {
    return typeof window !== "undefined" ? `${window.location.origin}/` : undefined;
  }
  return Linking.createURL("/");
}

/**
 * Sends a login/registration code (and, if the template has it, a magic link).
 * Supabase signs in the existing user for a known email (including an email
 * linked to a phone account from Edit profile) and creates the auth user only
 * for a new email, so the same address never gets a second account.
 */
export async function sendEmailLoginCode(email: string): Promise<{
  error: string | null;
  /** Raw Supabase error, for callers that show their own messages. */
  cause: unknown;
}> {
  const { error } = await supabase.auth.signInWithOtp({
    email: normalizeEmail(email),
    options: { shouldCreateUser: true, emailRedirectTo: loginRedirectUrl() },
  });
  if (!error) return { error: null, cause: null };
  const friendly = friendlyEmailError(error);
  return {
    error:
      friendly === "Unable to send the verification code. Please try again."
        ? "Unable to send the login code. Please try again."
        : friendly,
    cause: error,
  };
}

/** Verifies the emailed login/registration code and returns the signed-in user id. */
export async function verifyEmailLoginCode(email: string, code: string): Promise<{
  userId: string | null;
  error: string | null;
  /** Raw Supabase error, for callers that show their own messages. */
  cause: unknown;
}> {
  const { data, error } = await supabase.auth.verifyOtp({
    email: normalizeEmail(email),
    token: code.trim(),
    type: "email",
  });
  if (error) return { userId: null, error: friendlyEmailOtpError(error), cause: error };
  const user = data.user ?? data.session?.user ?? null;
  if (!user) return { userId: null, error: "Unable to sign in. Please try again.", cause: null };
  return { userId: user.id, error: null, cause: null };
}

/**
 * Runs after every successful OTP sign-in. Makes sure the signed-in user has
 * exactly one public.users row keyed by auth.uid() — a brand-new account gets
 * a minimal row (phone from Auth, English) — and returns the profile. An
 * existing row is never overwritten. An empty name means onboarding is needed.
 */
export async function ensureCurrentUserProfile(): Promise<{
  profile: UserProfile | null;
  error: Error | null;
}> {
  const session = await waitForAuthReady();
  const user = session?.user;
  if (!user) return { profile: null, error: new Error("You must be signed in.") };

  const { data: existing, error: lookupError } = await supabase
    .from("users")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();
  if (lookupError) return { profile: null, error: new Error(lookupError.message) };

  if (!existing) {
    const { error: insertError } = await supabase.from("users").insert({
      id: user.id,
      phone: user.phone || null,
      language: "English",
    });
    // 23505: another tab created the row first — that row is used as-is.
    if (insertError && insertError.code !== "23505") {
      return { profile: null, error: new Error(insertError.message) };
    }
  }

  return await getCurrentUserProfile();
}

export async function updateCurrentUserProfile(input: {
  name: string;
  phone?: string;
  state: string;
  district: string;
  language: string;
}): Promise<{ error: Error | null }> {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user?.id) {
    return {
      error: userError ?? new Error("You must be signed in to update your profile."),
    };
  }

  const { data, error } = await supabase
    .from("users")
    .update({
      name: input.name,
      phone: input.phone?.trim() || user.phone || null,
      state: input.state,
      district: input.district,
      language: input.language,
    })
    .eq("id", user.id)
    .select("id")
    .maybeSingle();

  if (error) {
    return { error: new Error(error.message) };
  }

  if (!data) {
    // Row may not exist yet for some accounts — fall back to upsert.
    const upsertResult = await saveProfile(
      input.name,
      input.state,
      input.district,
      input.language,
      input.phone,
    );

    if (upsertResult.error) {
      return { error: new Error(upsertResult.error.message) };
    }
  }

  return { error: null };
}

export async function updateCurrentUserAvatar(input: {
  avatarUrl: string | null;
  avatarUpdatedAt: string;
}): Promise<{ error: Error | null }> {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user?.id) {
    return {
      error:
        userError ??
        new Error("You must be signed in to update your profile photo."),
    };
  }

  const { data, error } = await supabase
    .from("users")
    .update({
      avatar_url: input.avatarUrl,
      avatar_updated_at: input.avatarUpdatedAt,
    })
    .eq("id", user.id)
    .select("id")
    .maybeSingle();

  if (error) {
    return { error: new Error(error.message) };
  }

  if (!data) {
    return {
      error: new Error(
        "Unable to update profile photo. Your account profile was not found.",
      ),
    };
  }

  return { error: null };
}

export async function resolveFarmerDisplayName(sessionUser?: {
  user_metadata?: Record<string, unknown> | null;
  phone?: string | null;
} | null): Promise<string> {
  const [remoteResult, localProfile] = await Promise.all([
    getCurrentUserProfile(),
    getFarmerProfile(),
  ]);

  const metadataName =
    typeof sessionUser?.user_metadata?.name === "string"
      ? sessionUser.user_metadata.name.trim()
      : "";

  return (
    remoteResult.profile?.name?.trim() ||
    localProfile?.name?.trim() ||
    metadataName ||
    "Farmer"
  );
}
