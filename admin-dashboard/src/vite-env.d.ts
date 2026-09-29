/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  readonly VITE_ASK_PRANA_API_URL?: string
  /** @deprecated Use VITE_ASK_PRANA_API_URL */
  readonly VITE_AQUAGPT_API_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
