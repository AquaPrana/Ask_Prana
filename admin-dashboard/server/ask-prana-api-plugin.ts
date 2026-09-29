import type { Plugin } from 'vite'
import { createClient } from '@supabase/supabase-js'

const API_PREFIXES = ['/api/ask-prana', '/api/aquagpt'] as const

function normalizeApiPath(url: string): string {
  return url.replace(/^\/api\/(ask-prana|aquagpt)/, '/api/ask-prana')
}

/**
 * Dev-only /api/ask-prana/* backend (legacy /api/aquagpt alias supported).
 * Uses SUPABASE_SERVICE_ROLE_KEY from process.env (never VITE_*).
 * Proxies auth via the caller's Bearer token + verifies admins table.
 */
export function askPranaApiPlugin(): Plugin {
  return {
    name: 'ask-prana-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const isAskPranaApi = API_PREFIXES.some((prefix) =>
          req.url?.startsWith(prefix),
        )
        if (!isAskPranaApi) {
          next()
          return
        }

        try {
          const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
          const anonKey =
            process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
          const serviceKey =
            process.env.SUPABASE_SERVICE_ROLE_KEY ||
            process.env.SERVICE_ROLE_KEY

          if (!supabaseUrl || !anonKey) {
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'Supabase URL/anon key missing' }))
            return
          }

          const edgeBase = `${supabaseUrl.replace(/\/+$/, '')}/functions/v1/admin-ask-prana`
          const legacyEdgeBase = `${supabaseUrl.replace(/\/+$/, '')}/functions/v1/admin-aquagpt`
          const normalizedUrl = normalizeApiPath(req.url || '')
          const suffix = normalizedUrl.replace(/^\/api\/ask-prana/, '') || '/'

          // Prefer proxying to the deployed edge function when no local service key.
          if (!serviceKey) {
            const target = `${edgeBase}${suffix}`
            const headers: Record<string, string> = {}
            if (req.headers.authorization) {
              headers.Authorization = String(req.headers.authorization)
            }
            headers.apikey = anonKey

            let upstream = await fetch(target, {
              method: req.method,
              headers,
            })

            if (upstream.status === 404 || upstream.status === 502) {
              upstream = await fetch(`${legacyEdgeBase}${suffix}`, {
                method: req.method,
                headers,
              })
            }

            const body = await upstream.text()
            res.statusCode = upstream.status
            res.setHeader(
              'Content-Type',
              upstream.headers.get('Content-Type') || 'application/json',
            )
            res.end(body)
            return
          }

          const authHeader = req.headers.authorization
          if (!authHeader) {
            res.statusCode = 401
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'Missing authorization' }))
            return
          }

          const userClient = createClient(supabaseUrl, anonKey, {
            global: { headers: { Authorization: authHeader } },
          })
          const {
            data: { user },
          } = await userClient.auth.getUser()
          if (!user) {
            res.statusCode = 401
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'Unauthorized' }))
            return
          }

          const admin = createClient(supabaseUrl, serviceKey)
          const { data: adminRow } = await admin
            .from('admins')
            .select('id')
            .eq('id', user.id)
            .maybeSingle()

          if (!adminRow) {
            res.statusCode = 403
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'Admin access required' }))
            return
          }

          const url = new URL(normalizedUrl, 'http://localhost')
          const parts = url.pathname
            .replace(/^\/api\/ask-prana\/?/, '')
            .split('/')
            .filter(Boolean)

          let upstream = await fetch(`${edgeBase}/${parts.join('/')}${url.search}`, {
            method: req.method,
            headers: {
              Authorization: authHeader,
              apikey: anonKey,
            },
          })

          if (upstream.status === 404 || upstream.status === 502) {
            upstream = await fetch(
              `${legacyEdgeBase}/${parts.join('/')}${url.search}`,
              {
                method: req.method,
                headers: {
                  Authorization: authHeader,
                  apikey: anonKey,
                },
              },
            )
          }

          // If edge is not deployed, fall through to local session listing.
          if (upstream.status !== 404 && upstream.status !== 502) {
            const body = await upstream.text()
            res.statusCode = upstream.status
            res.setHeader(
              'Content-Type',
              upstream.headers.get('Content-Type') || 'application/json',
            )
            res.end(body)
            return
          }

          // Local fallback for sessions list when edge is unavailable.
          if (req.method === 'GET' && parts[0] === 'sessions' && parts.length === 1) {
            const { data, error, count } = await admin
              .from('ask_prana_sessions')
              .select(
                `
                id, user_id, pond_id, farmer_name, pond_name, mode, title,
                last_message, last_activity, created_at,
                users ( name, phone, state, district )
              `,
                { count: 'exact' },
              )
              .order('last_activity', { ascending: false, nullsFirst: false })
              .limit(50)

            if (error) {
              res.statusCode = 500
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ error: error.message }))
              return
            }

            const items = (data || []).map((session: any) => ({
              session_id: session.id,
              farmer_name: session.farmer_name || session.users?.name || 'Unknown farmer',
              phone: session.users?.phone || '',
              pond_id: session.pond_id,
              pond_name: session.pond_name || (session.pond_id ? 'Pond' : 'Generic'),
              mode: session.mode || (session.pond_id ? 'pond' : 'generic'),
              total_messages: 0,
              last_message: session.last_message || session.title || '',
              last_activity: session.last_activity || session.created_at,
              created_at: session.created_at,
              state: session.users?.state || '',
              district: session.users?.district || '',
            }))

            res.statusCode = 200
            res.setHeader('Content-Type', 'application/json')
            res.end(
              JSON.stringify({
                items,
                page: 1,
                pageSize: 50,
                total: count ?? items.length,
              }),
            )
            return
          }

          if (
            req.method === 'GET' &&
            parts[0] === 'session' &&
            parts[1] &&
            parts.length === 2
          ) {
            const sessionId = parts[1]
            const { data: session, error } = await admin
              .from('ask_prana_sessions')
              .select(
                `
                id, user_id, pond_id, farmer_name, pond_name, mode, title,
                last_message, last_activity, created_at,
                users ( name, phone, state, district )
              `,
              )
              .eq('id', sessionId)
              .maybeSingle()

            if (error || !session) {
              res.statusCode = error ? 500 : 404
              res.setHeader('Content-Type', 'application/json')
              res.end(
                JSON.stringify({
                  error: error?.message || 'Session not found',
                }),
              )
              return
            }

            const { data: messages } = await admin
              .from('ask_prana_messages')
              .select(
                'id, session_id, role, content, created_at, mode, farmer_name, pond_name, metadata, attachments, message_type, file_name',
              )
              .eq('session_id', sessionId)
              .order('created_at', { ascending: true })

            res.statusCode = 200
            res.setHeader('Content-Type', 'application/json')
            res.end(
              JSON.stringify({
                session: {
                  session_id: session.id,
                  farmer_name:
                    session.farmer_name ||
                    (session as any).users?.name ||
                    'Unknown farmer',
                  phone: (session as any).users?.phone || '',
                  pond_id: session.pond_id,
                  pond_name:
                    session.pond_name || (session.pond_id ? 'Pond' : 'Generic'),
                  mode: session.mode || (session.pond_id ? 'pond' : 'generic'),
                  last_message: session.last_message || '',
                  last_activity: session.last_activity || session.created_at,
                  created_at: session.created_at,
                },
                messages: (messages || []).map((m: any) => ({
                  id: m.id,
                  session_id: m.session_id,
                  role: m.role,
                  message: m.content || '',
                  created_at: m.created_at,
                  mode: m.mode,
                  farmer_name: m.farmer_name,
                  pond_name: m.pond_name,
                  metadata: m.metadata,
                  attachments: m.attachments,
                  message_type: m.message_type,
                  file_name: m.file_name,
                })),
              }),
            )
            return
          }

          res.statusCode = 404
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'Not found' }))
        } catch (error) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(
            JSON.stringify({
              error: error instanceof Error ? error.message : String(error),
            }),
          )
        }
      })
    },
  }
}
