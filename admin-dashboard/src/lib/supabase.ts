import { createClient } from '@supabase/supabase-js'

function readEnv(value: unknown): string {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (!trimmed || trimmed === 'undefined' || trimmed === 'null') return ''
  return trimmed
}

const supabaseUrl = readEnv(import.meta.env.VITE_SUPABASE_URL)
const supabaseAnonKey = readEnv(import.meta.env.VITE_SUPABASE_ANON_KEY)
const isValidUrl =
  /^https?:\/\//i.test(supabaseUrl) &&
  !supabaseUrl.includes('placeholder.supabase.co')

export const isSupabaseConfigured = isValidUrl && supabaseAnonKey.length > 0

if (!isSupabaseConfigured && import.meta.env.DEV) {
  console.error(
    '[admin-dashboard] Missing Supabase config. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in admin-dashboard/.env (copy from frontend/.env).',
  )
}

export const supabase = createClient(
  isSupabaseConfigured ? supabaseUrl : 'http://127.0.0.1:1',
  isSupabaseConfigured ? supabaseAnonKey : 'missing-supabase-config',
)
