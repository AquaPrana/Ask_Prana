/**
 * Ensures EXPO_PUBLIC_* env vars are available in EAS/APK builds.
 * Values come from local .env during `expo start`, and from eas.json `env`
 * (or EAS Secrets) during cloud builds.
 */
const appJson = require("./app.json");

module.exports = () => {
  const expo = appJson.expo ?? appJson;

  return {
    expo: {
      ...expo,
      extra: {
        ...(expo.extra ?? {}),
        supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? null,
        hasSupabaseAnonKey: Boolean(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY),
      },
    },
  };
};
