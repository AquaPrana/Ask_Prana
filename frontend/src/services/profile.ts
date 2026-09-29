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
