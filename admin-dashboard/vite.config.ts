import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { askPranaApiPlugin } from './server/ask-prana-api-plugin.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function isUsableEnv(value: string | undefined): value is string {
  const trimmed = value?.trim() ?? ''
  return Boolean(trimmed) && trimmed !== 'undefined' && trimmed !== 'null'
}

function clearPoisonedEnv(key: string) {
  if (!isUsableEnv(process.env[key])) {
    delete process.env[key]
  }
}

function resolveSupabaseEnv(localEnv: Record<string, string>, frontendEnv: Record<string, string>) {
  const url =
    localEnv.VITE_SUPABASE_URL ||
    frontendEnv.VITE_SUPABASE_URL ||
    frontendEnv.EXPO_PUBLIC_SUPABASE_URL

  const anonKey =
    localEnv.VITE_SUPABASE_ANON_KEY ||
    frontendEnv.VITE_SUPABASE_ANON_KEY ||
    frontendEnv.EXPO_PUBLIC_SUPABASE_ANON_KEY

  return { url, anonKey }
}

export default defineConfig(({ mode }) => {
  // Assigning `undefined` to process.env stores the string "undefined".
  // Vite then injects that into the browser and will not overwrite it from .env.
  clearPoisonedEnv('VITE_SUPABASE_URL')
  clearPoisonedEnv('VITE_SUPABASE_ANON_KEY')
  clearPoisonedEnv('SUPABASE_SERVICE_ROLE_KEY')
  clearPoisonedEnv('SERVICE_ROLE_KEY')

  const localEnv = loadEnv(mode, process.cwd(), '')
  const frontendEnv = loadEnv(mode, path.resolve(__dirname, '../frontend'), '')
  const { url: supabaseUrl, anonKey: supabaseAnonKey } = resolveSupabaseEnv(
    localEnv,
    frontendEnv,
  )

  // Expose non-VITE service key only to the Node middleware, not the browser bundle.
  if (isUsableEnv(localEnv.SUPABASE_SERVICE_ROLE_KEY)) {
    process.env.SUPABASE_SERVICE_ROLE_KEY = localEnv.SUPABASE_SERVICE_ROLE_KEY
  }
  if (isUsableEnv(localEnv.SERVICE_ROLE_KEY)) {
    process.env.SERVICE_ROLE_KEY = localEnv.SERVICE_ROLE_KEY
  }
  if (isUsableEnv(supabaseUrl)) {
    process.env.VITE_SUPABASE_URL = supabaseUrl
  }
  if (isUsableEnv(supabaseAnonKey)) {
    process.env.VITE_SUPABASE_ANON_KEY = supabaseAnonKey
  }

  return {
    plugins: [react(), askPranaApiPlugin()],
  }
})
