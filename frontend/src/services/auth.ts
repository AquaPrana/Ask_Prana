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

export async function sendOTP(phone: string) {
  const first = await supabase.auth.signInWithOtp({
    phone,
  });

  if (first.error && isAuthSessionMissing(first.error)) {
    await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
    return await supabase.auth.signInWithOtp({
      phone,
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

export async function logout() {
  return await supabase.auth.signOut();
}
