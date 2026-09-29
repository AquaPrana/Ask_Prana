export type AskPranaMode = 'generic' | 'pond'

export interface AskPranaUsage {
  id: string
  date: string
  farmerName: string
  phone: string
  messages: number
  tokens: number
  updatedAt: string
}

export interface AskPranaSession {
  id: string
  scope: string
  farmerName: string
  phone: string
  model: string
  messages: number
  tokens: number
}

/** One aggregated chat session for the Monitor table. */
export interface AskPranaMonitorSession {
  sessionId: string
  farmerName: string
  phone: string
  pondId: string | null
  pondName: string
  mode: AskPranaMode | string
  totalMessages: number
  lastMessage: string
  lastActivity: string
  createdAt: string
  state: string
  district: string
}

export interface AskPranaChatMessage {
  id: string
  sessionId: string
  role: 'user' | 'assistant'
  message: string
  createdAt: string
  mode?: string | null
  farmerName?: string | null
  pondName?: string | null
  metadata?: Record<string, unknown> | null
  attachments?: unknown
  messageType?: string | null
  fileName?: string | null
}

export interface AskPranaSessionDetail {
  session: AskPranaMonitorSession
  messages: AskPranaChatMessage[]
}

export interface AskPranaStats {
  messagesToday: number
  sessionsToday: number
  latestSessions: Array<{
    sessionId: string
    farmerName: string
    pondName: string
    mode: string
    lastMessage: string
    lastActivity: string
  }>
  topFarmers: Array<{ id: string; name: string; messages: number }>
  topPonds: Array<{ id: string; name: string; messages: number }>
}

export interface AskPranaSessionsQuery {
  page?: number
  pageSize?: number
  search?: string
  mode?: string
  farmer?: string
  pond?: string
  state?: string
  district?: string
  from?: string
  to?: string
  severity?: string
}

export interface AskPranaSessionsPage {
  items: AskPranaMonitorSession[]
  page: number
  pageSize: number
  total: number
}
