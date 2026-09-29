import { supabase } from '../lib/supabase'
import type {
  AskPranaChatMessage,
  AskPranaMonitorSession,
  AskPranaSessionDetail,
  AskPranaSessionsPage,
  AskPranaSessionsQuery,
  AskPranaStats,
} from '../types/ask-prana'

function mapSession(raw: Record<string, unknown>): AskPranaMonitorSession {
  return {
    sessionId: String(raw.session_id ?? raw.sessionId ?? ''),
    farmerName: String(raw.farmer_name ?? raw.farmerName ?? 'Unknown farmer'),
    phone: String(raw.phone ?? ''),
    pondId: (raw.pond_id as string | null) ?? (raw.pondId as string | null) ?? null,
    pondName: String(raw.pond_name ?? raw.pondName ?? 'Generic'),
    mode: String(raw.mode ?? 'generic'),
    totalMessages: Number(raw.total_messages ?? raw.totalMessages ?? 0),
    lastMessage: String(raw.last_message ?? raw.lastMessage ?? ''),
    lastActivity: String(raw.last_activity ?? raw.lastActivity ?? ''),
    createdAt: String(raw.created_at ?? raw.createdAt ?? ''),
    state: String(raw.state ?? ''),
    district: String(raw.district ?? ''),
  }
}

function mapMessage(raw: Record<string, unknown>): AskPranaChatMessage {
  return {
    id: String(raw.id ?? ''),
    sessionId: String(raw.session_id ?? raw.sessionId ?? ''),
    role: (raw.role as 'user' | 'assistant') ?? 'assistant',
    message: String(raw.message ?? raw.content ?? ''),
    createdAt: String(raw.created_at ?? raw.createdAt ?? ''),
    mode: (raw.mode as string | null) ?? null,
    farmerName: (raw.farmer_name as string | null) ?? null,
    pondName: (raw.pond_name as string | null) ?? null,
    metadata: (raw.metadata as Record<string, unknown> | null) ?? null,
    attachments: raw.attachments ?? null,
    messageType: (raw.message_type as string | null) ?? null,
    fileName: (raw.file_name as string | null) ?? null,
  }
}

export function formatAskPranaError(error: unknown): string {
  if (!error) return 'Unknown error'
  if (typeof error === 'string') return error
  if (error instanceof Error) return error.message
  if (typeof error === 'object') {
    const e = error as {
      message?: string
      details?: string
      hint?: string
      code?: string
      error?: string
    }
    return (
      e.message ||
      e.error ||
      e.details ||
      e.hint ||
      (e.code ? `Error ${e.code}` : JSON.stringify(error))
    )
  }
  return String(error)
}

type UserMeta = {
  name: string
  phone: string
  state: string
  district: string
}

type PondMeta = { name: string }

type SessionRow = {
  id: string
  user_id: string
  pond_id: string | null
  farmer_name?: string | null
  pond_name?: string | null
  mode?: string | null
  title?: string | null
  last_message?: string | null
  last_activity?: string | null
  created_at: string
}

async function loadUserMap(userIds: string[]): Promise<Map<string, UserMeta>> {
  const map = new Map<string, UserMeta>()
  const ids = [...new Set(userIds.filter(Boolean))]
  if (!ids.length) return map

  const { data, error } = await supabase
    .from('users')
    .select('id, name, phone, state, district')
    .in('id', ids)

  if (error) {
    console.warn('[Ask Prana] users lookup failed:', formatAskPranaError(error))
    return map
  }

  for (const row of data || []) {
    map.set(row.id, {
      name: row.name || '',
      phone: row.phone || '',
      state: row.state || '',
      district: row.district || '',
    })
  }
  return map
}

async function loadPondMap(pondIds: string[]): Promise<Map<string, PondMeta>> {
  const map = new Map<string, PondMeta>()
  const ids = [...new Set(pondIds.filter(Boolean))]
  if (!ids.length) return map

  const { data, error } = await supabase
    .from('ponds')
    .select('id, name')
    .in('id', ids)

  if (error) {
    console.warn('[Ask Prana] ponds lookup failed:', formatAskPranaError(error))
    return map
  }

  for (const row of data || []) {
    map.set(row.id, { name: row.name || 'Pond' })
  }
  return map
}

async function loadMessageCounts(
  sessionIds: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  if (!sessionIds.length) return counts

  const { data, error } = await supabase
    .from('ask_prana_messages')
    .select('session_id')
    .in('session_id', sessionIds)

  if (error) {
    console.warn('[Ask Prana] message counts failed:', formatAskPranaError(error))
    return counts
  }

  for (const row of data || []) {
    counts.set(row.session_id, (counts.get(row.session_id) || 0) + 1)
  }
  return counts
}

async function hydrateSessions(
  rows: SessionRow[],
  meta: {
    page: number
    pageSize: number
    total: number
    query: AskPranaSessionsQuery
  },
): Promise<AskPranaSessionsPage> {
  const [users, ponds, counts] = await Promise.all([
    loadUserMap(rows.map((r) => r.user_id)),
    loadPondMap(rows.map((r) => r.pond_id).filter(Boolean) as string[]),
    loadMessageCounts(rows.map((r) => r.id)),
  ])

  let items = rows.map((r) => {
    const user = users.get(r.user_id)
    const pond = r.pond_id ? ponds.get(r.pond_id) : undefined
    return mapSession({
      session_id: r.id,
      farmer_name: r.farmer_name || user?.name || 'Unknown farmer',
      phone: user?.phone || '',
      pond_id: r.pond_id,
      pond_name:
        r.pond_name || pond?.name || (r.pond_id ? 'Pond' : 'Generic'),
      mode: r.mode || (r.pond_id ? 'pond' : 'generic'),
      total_messages: counts.get(r.id) || 0,
      last_message: r.last_message || r.title || '',
      last_activity: r.last_activity || r.created_at,
      created_at: r.created_at,
      state: user?.state || '',
      district: user?.district || '',
    })
  })

  if (meta.query.state && meta.query.state !== 'all') {
    items = items.filter((s) => s.state === meta.query.state)
  }
  if (meta.query.district && meta.query.district !== 'all') {
    items = items.filter((s) => s.district === meta.query.district)
  }
  if (meta.query.search?.trim()) {
    const s = meta.query.search.trim().toLowerCase()
    items = items.filter((row) =>
      [
        row.sessionId,
        row.farmerName,
        row.pondName,
        row.lastMessage,
        row.phone,
      ]
        .join(' ')
        .toLowerCase()
        .includes(s),
    )
  }

  return {
    items,
    page: meta.page,
    pageSize: meta.pageSize,
    total: meta.total,
  }
}

/**
 * Authenticated admin client + admin RLS.
 * Does NOT embed `users` — there is no FK from ask_prana_sessions → users.
 */
export async function fetchAskPranaSessions(
  query: AskPranaSessionsQuery = {},
): Promise<AskPranaSessionsPage> {
  const page = query.page ?? 1
  const pageSize = query.pageSize ?? 25
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  const applyFilters = (builder: any) => {
    let q = builder
    if (query.mode === 'generic' || query.mode === 'pond') {
      q = q.eq('mode', query.mode)
    }
    if (query.farmer && query.farmer !== 'all') {
      q = q.eq('user_id', query.farmer)
    }
    if (query.pond && query.pond !== 'all') {
      q = q.eq('pond_id', query.pond)
    }
    if (query.from) {
      q = q.gte('created_at', `${query.from}T00:00:00.000Z`)
    }
    if (query.to) {
      q = q.lte('created_at', `${query.to}T23:59:59.999Z`)
    }
    return q
  }

  const fullSelect =
    'id, user_id, pond_id, farmer_name, pond_name, mode, title, last_message, last_activity, created_at'

  let result: any = await applyFilters(
    supabase
      .from('ask_prana_sessions')
      .select(fullSelect, { count: 'exact' })
      .order('last_activity', { ascending: false })
      .order('created_at', { ascending: false })
      .range(from, to),
  )

  if (result.error) {
    result = await applyFilters(
      supabase
        .from('ask_prana_sessions')
        .select(fullSelect, { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(from, to),
    )
  }

  if (result.error) {
    result = await applyFilters(
      supabase
        .from('ask_prana_sessions')
        .select('id, user_id, pond_id, created_at', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(from, to),
    )
  }

  if (result.error) throw result.error

  return hydrateSessions((result.data || []) as SessionRow[], {
    page,
    pageSize,
    total: result.count ?? (result.data || []).length,
    query,
  })
}

export async function fetchAskPranaSession(
  sessionId: string,
): Promise<AskPranaSessionDetail> {
  let session: SessionRow | null = null

  const full = await supabase
    .from('ask_prana_sessions')
    .select(
      'id, user_id, pond_id, farmer_name, pond_name, mode, title, last_message, last_activity, created_at',
    )
    .eq('id', sessionId)
    .maybeSingle()

  if (full.error) {
    const minimal = await supabase
      .from('ask_prana_sessions')
      .select('id, user_id, pond_id, created_at')
      .eq('id', sessionId)
      .maybeSingle()
    if (minimal.error) throw minimal.error
    session = minimal.data as SessionRow | null
  } else {
    session = full.data as SessionRow | null
  }

  if (!session) throw new Error('Session not found')

  let messagesQuery: any = await supabase
    .from('ask_prana_messages')
    .select(
      'id, session_id, role, content, created_at, mode, farmer_name, pond_name, metadata, attachments, message_type, file_name',
    )
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true })

  if (messagesQuery.error) {
    messagesQuery = await supabase
      .from('ask_prana_messages')
      .select('id, session_id, role, content, created_at')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true })
    if (messagesQuery.error) throw messagesQuery.error
  }

  const [users, ponds] = await Promise.all([
    loadUserMap([session.user_id]),
    loadPondMap(session.pond_id ? [session.pond_id] : []),
  ])
  const user = users.get(session.user_id)
  const pond = session.pond_id ? ponds.get(session.pond_id) : undefined

  return {
    session: mapSession({
      session_id: session.id,
      farmer_name: session.farmer_name || user?.name || 'Unknown farmer',
      phone: user?.phone || '',
      pond_id: session.pond_id,
      pond_name:
        session.pond_name ||
        pond?.name ||
        (session.pond_id ? 'Pond' : 'Generic'),
      mode: session.mode || (session.pond_id ? 'pond' : 'generic'),
      last_message: session.last_message || '',
      last_activity: session.last_activity || session.created_at,
      created_at: session.created_at,
      state: user?.state || '',
      district: user?.district || '',
      total_messages: (messagesQuery.data || []).length,
    }),
    messages: (messagesQuery.data || []).map((m: Record<string, unknown>) =>
      mapMessage({
        ...m,
        message: m.content,
      }),
    ),
  }
}

export async function deleteAskPranaSession(sessionId: string): Promise<void> {
  const { error: messagesError } = await supabase
    .from('ask_prana_messages')
    .delete()
    .eq('session_id', sessionId)
  if (messagesError) {
    console.warn(
      '[Ask Prana] delete messages:',
      formatAskPranaError(messagesError),
    )
  }

  const { error } = await supabase
    .from('ask_prana_sessions')
    .delete()
    .eq('id', sessionId)
  if (error) throw error
}

export async function fetchAskPranaStats(): Promise<AskPranaStats> {
  const startOfDay = new Date()
  startOfDay.setHours(0, 0, 0, 0)
  const isoDay = startOfDay.toISOString()

  const [messagesTodayRes, sessionsTodayRes, recentRes, allMessagesRes] =
    await Promise.all([
      supabase
        .from('ask_prana_messages')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', isoDay),
      supabase
        .from('ask_prana_sessions')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', isoDay),
      supabase
        .from('ask_prana_sessions')
        .select(
          'id, user_id, farmer_name, pond_name, mode, pond_id, last_message, last_activity, created_at',
        )
        .order('created_at', { ascending: false })
        .limit(10),
      supabase
        .from('ask_prana_messages')
        .select('user_id, pond_id, farmer_name, pond_name')
        .limit(5000),
    ])

  if (messagesTodayRes.error) {
    console.warn(
      '[Ask Prana] messagesToday:',
      formatAskPranaError(messagesTodayRes.error),
    )
  }
  if (sessionsTodayRes.error) {
    console.warn(
      '[Ask Prana] sessionsToday:',
      formatAskPranaError(sessionsTodayRes.error),
    )
  }
  if (recentRes.error) {
    console.warn(
      '[Ask Prana] recent sessions:',
      formatAskPranaError(recentRes.error),
    )
  }
  if (allMessagesRes.error) {
    console.warn(
      '[Ask Prana] all messages stats:',
      formatAskPranaError(allMessagesRes.error),
    )
  }

  const recent = (recentRes.data || []) as SessionRow[]
  const [users, ponds] = await Promise.all([
    loadUserMap(recent.map((r) => r.user_id)),
    loadPondMap(recent.map((r) => r.pond_id).filter(Boolean) as string[]),
  ])

  const farmerCounts = new Map<string, { name: string; count: number }>()
  const pondCounts = new Map<string, { name: string; count: number }>()
  for (const row of allMessagesRes.data || []) {
    if (row.user_id) {
      const prev = farmerCounts.get(row.user_id) || {
        name: row.farmer_name || 'Farmer',
        count: 0,
      }
      prev.count += 1
      if (row.farmer_name) prev.name = row.farmer_name
      farmerCounts.set(row.user_id, prev)
    }
    if (row.pond_id) {
      const prev = pondCounts.get(row.pond_id) || {
        name: row.pond_name || 'Pond',
        count: 0,
      }
      prev.count += 1
      if (row.pond_name) prev.name = row.pond_name
      pondCounts.set(row.pond_id, prev)
    }
  }

  const missingFarmerIds = [...farmerCounts.entries()]
    .filter(([, v]) => !v.name || v.name === 'Farmer')
    .map(([id]) => id)
  if (missingFarmerIds.length) {
    const extraUsers = await loadUserMap(missingFarmerIds)
    for (const [id, meta] of extraUsers) {
      const prev = farmerCounts.get(id)
      if (prev && meta.name) prev.name = meta.name
    }
  }

  const missingPondIds = [...pondCounts.entries()]
    .filter(([, v]) => !v.name || v.name === 'Pond')
    .map(([id]) => id)
  if (missingPondIds.length) {
    const extraPonds = await loadPondMap(missingPondIds)
    for (const [id, meta] of extraPonds) {
      const prev = pondCounts.get(id)
      if (prev && meta.name) prev.name = meta.name
    }
  }

  return {
    messagesToday: messagesTodayRes.count || 0,
    sessionsToday: sessionsTodayRes.count || 0,
    latestSessions: recent.map((s) => {
      const user = users.get(s.user_id)
      const pond = s.pond_id ? ponds.get(s.pond_id) : undefined
      return {
        sessionId: s.id,
        farmerName: s.farmer_name || user?.name || 'Unknown farmer',
        pondName: s.pond_name || pond?.name || (s.pond_id ? 'Pond' : 'Generic'),
        mode: s.mode || (s.pond_id ? 'pond' : 'generic'),
        lastMessage: s.last_message || '',
        lastActivity: s.last_activity || s.created_at,
      }
    }),
    topFarmers: [...farmerCounts.entries()]
      .map(([id, v]) => ({ id, name: v.name, messages: v.count }))
      .sort((a, b) => b.messages - a.messages)
      .slice(0, 5),
    topPonds: [...pondCounts.entries()]
      .map(([id, v]) => ({ id, name: v.name, messages: v.count }))
      .sort((a, b) => b.messages - a.messages)
      .slice(0, 5),
  }
}

export async function exportAskPranaCsv(): Promise<string> {
  const { data, error } = await supabase
    .from('ask_prana_messages')
    .select(
      'session_id, farmer_name, pond_name, mode, role, content, created_at, pond_id',
    )
    .order('created_at', { ascending: true })
    .limit(10000)

  const rows =
    error || !data
      ? (
          await supabase
            .from('ask_prana_messages')
            .select('session_id, role, content, created_at, pond_id')
            .order('created_at', { ascending: true })
            .limit(10000)
        ).data || []
      : data

  if (error && !rows.length) {
    const retry = await supabase
      .from('ask_prana_messages')
      .select('session_id, role, content, created_at, pond_id')
      .order('created_at', { ascending: true })
      .limit(10000)
    if (retry.error) throw retry.error
    return buildCsv(retry.data || [])
  }

  return buildCsv(rows)
}

function buildCsv(
  rows: Array<{
    session_id: string
    farmer_name?: string | null
    pond_name?: string | null
    mode?: string | null
    role: string
    content: string | null
    created_at: string
    pond_id?: string | null
  }>,
) {
  const bySession = new Map<
    string,
    {
      farmer: string
      pond: string
      mode: string
      userMessage: string
      assistantResponse: string
      timestamp: string
    }
  >()

  for (const row of rows) {
    const existing = bySession.get(row.session_id) || {
      farmer: row.farmer_name || '',
      pond: row.pond_name || (row.pond_id ? 'Pond' : 'Generic'),
      mode: row.mode || (row.pond_id ? 'pond' : 'generic'),
      userMessage: '',
      assistantResponse: '',
      timestamp: row.created_at,
    }
    if (row.role === 'user' && !existing.userMessage) {
      existing.userMessage = row.content || ''
      existing.timestamp = row.created_at
    }
    if (row.role === 'assistant') {
      existing.assistantResponse = row.content || ''
      existing.timestamp = row.created_at
    }
    bySession.set(row.session_id, existing)
  }

  const escape = (value: string) => {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`
    }
    return value
  }

  const lines = [
    'Session ID,Farmer,Pond,Mode,User Message,Assistant Response,Timestamp',
  ]
  for (const [sessionId, row] of bySession) {
    lines.push(
      [
        sessionId,
        row.farmer,
        row.pond,
        row.mode,
        row.userMessage,
        row.assistantResponse,
        row.timestamp,
      ]
        .map((c) => escape(String(c ?? '')))
        .join(','),
    )
  }
  return lines.join('\n')
}

export async function getAskPranaSessions() {
  const page = await fetchAskPranaSessions({ page: 1, pageSize: 50 })
  return page.items.map((s) => ({
    id: s.sessionId,
    scope: s.mode === 'pond' ? 'Pond Session' : 'General',
    farmerName: s.farmerName,
    phone: s.phone,
    model: s.mode,
    messages: s.totalMessages,
    tokens: 0,
  }))
}

export async function getAskPranaUsage() {
  const stats = await fetchAskPranaStats()
  return [
    {
      id: 'today',
      date: new Date().toISOString(),
      farmerName: 'All farmers',
      phone: '',
      messages: stats.messagesToday,
      tokens: 0,
      updatedAt: new Date().toISOString(),
    },
  ]
}
