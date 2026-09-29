import { useCallback, useEffect, useState } from 'react'
import type { DeepFilterValues } from '../../components/common/DeepFilters'
import { DeepFilters } from '../../components/common/DeepFilters'
import { Button } from '../../components/common/Button'
import { Card } from '../../components/common/Card'
import { Input } from '../../components/common/Input'
import { Loader } from '../../components/common/Loader'
import { Table, type Column } from '../../components/common/Table'
import { SessionChatDrawer } from '../../components/ask-prana/SessionChatDrawer'
import { PageHeader } from '../../components/layout/PageHeader'
import { supabase } from '../../lib/supabase'
import {
  deleteAskPranaSession,
  exportAskPranaCsv,
  fetchAskPranaSession,
  fetchAskPranaSessions,
  fetchAskPranaStats,
  formatAskPranaError,
} from '../../services/ask-prana'
import type {
  AskPranaChatMessage,
  AskPranaMonitorSession,
  AskPranaStats,
} from '../../types/ask-prana'
import { formatDate } from '../../utils/formatDate'

const EMPTY_FILTERS: DeepFilterValues = {
  from: '',
  to: '',
  state: 'all',
  district: 'all',
  farmer: 'all',
  pond: 'all',
  severity: 'all',
}

export function AskPranaMonitor() {
  const [sessions, setSessions] = useState<AskPranaMonitorSession[]>([])
  const [stats, setStats] = useState<AskPranaStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filters, setFilters] = useState<DeepFilterValues>(EMPTY_FILTERS)
  const [modeFilter, setModeFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const pageSize = 25

  const [farmerOptions, setFarmerOptions] = useState<
    Array<{ label: string; value: string }>
  >([{ label: 'All farmers', value: 'all' }])
  const [pondOptions, setPondOptions] = useState<
    Array<{ label: string; value: string }>
  >([{ label: 'All ponds', value: 'all' }])
  const [stateOptions, setStateOptions] = useState<
    Array<{ label: string; value: string }>
  >([{ label: 'All states', value: 'all' }])
  const [districtOptions, setDistrictOptions] = useState<
    Array<{ label: string; value: string }>
  >([{ label: 'All districts', value: 'all' }])

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [activeSession, setActiveSession] =
    useState<AskPranaMonitorSession | null>(null)
  const [drawerMessages, setDrawerMessages] = useState<AskPranaChatMessage[]>([])
  const [drawerLoading, setDrawerLoading] = useState(false)
  const [drawerError, setDrawerError] = useState<string | null>(null)

  useEffect(() => {
    setFarmerOptions([{ label: 'All farmers', value: 'all' }])
    setPondOptions([{ label: 'All ponds', value: 'all' }])
    setStateOptions([{ label: 'All states', value: 'all' }])
    setDistrictOptions([{ label: 'All districts', value: 'all' }])
  }, [])

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [pageData, nextStats] = await Promise.all([
        fetchAskPranaSessions({
          page,
          pageSize,
          search,
          mode: modeFilter,
          farmer: filters.farmer,
          pond: filters.pond,
          state: filters.state,
          district: filters.district,
          from: filters.from,
          to: filters.to,
          severity: filters.severity,
        }),
        fetchAskPranaStats(),
      ])
      setSessions(pageData.items)
      setTotal(pageData.total)
      setStats(nextStats)
    } catch (err) {
      const message = formatAskPranaError(err)
      setError(message)
      console.error('[Ask Prana Monitor] refresh failed:', err)
    } finally {
      setLoading(false)
    }
  }, [filters, modeFilter, page, search])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Realtime: refresh table; append to open drawer when matching session.
  useEffect(() => {
    const channel = supabase
      .channel('ask-prana-admin-monitor')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'ask_prana_messages' },
        (payload) => {
          void refresh()
          const row = payload.new as {
            id?: string
            session_id?: string
            role?: 'user' | 'assistant'
            content?: string
            created_at?: string
            mode?: string
            farmer_name?: string
            pond_name?: string
            message_type?: string
            file_name?: string
          }
          if (
            drawerOpen &&
            activeSession &&
            row.session_id === activeSession.sessionId
          ) {
            setDrawerMessages((current) => {
              if (current.some((m) => m.id === row.id)) return current
              return [
                ...current,
                {
                  id: row.id || `rt-${Date.now()}`,
                  sessionId: row.session_id || activeSession.sessionId,
                  role: row.role || 'assistant',
                  message: row.content || '',
                  createdAt: row.created_at || new Date().toISOString(),
                  mode: row.mode,
                  farmerName: row.farmer_name,
                  pondName: row.pond_name,
                  messageType: row.message_type,
                  fileName: row.file_name,
                },
              ]
            })
          }
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'ask_prana_sessions' },
        () => {
          void refresh()
        },
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [activeSession, drawerOpen, refresh])

  const openSession = async (session: AskPranaMonitorSession) => {
    setActiveSession(session)
    setDrawerOpen(true)
    setDrawerLoading(true)
    setDrawerError(null)
    try {
      const detail = await fetchAskPranaSession(session.sessionId)
      setDrawerMessages(detail.messages)
      setActiveSession(detail.session)
    } catch (err) {
      setDrawerError(formatAskPranaError(err))
      setDrawerMessages([])
    } finally {
      setDrawerLoading(false)
    }
  }

  const onDeleteSession = async () => {
    if (!activeSession) return
    if (!window.confirm('Delete this entire Ask Prana session?')) return
    try {
      await deleteAskPranaSession(activeSession.sessionId)
      setDrawerOpen(false)
      setActiveSession(null)
      setDrawerMessages([])
      await refresh()
    } catch (err) {
      setDrawerError(err instanceof Error ? err.message : String(err))
    }
  }

  const onExport = async () => {
    try {
      const csv = await exportAskPranaCsv()
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'ask-prana-chats.csv'
      link.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('[Ask Prana Monitor] export failed:', err)
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const columns: Column<AskPranaMonitorSession>[] = [
    {
      key: 'session',
      header: 'Session ID',
      render: (row) => (
        <code className="mono-cell">{row.sessionId.slice(0, 8)}…</code>
      ),
    },
    {
      key: 'farmer',
      header: 'Farmer Name',
      render: (row) => (
        <div>
          <div className="cell-primary">{row.farmerName}</div>
          <div className="cell-secondary">{row.phone}</div>
        </div>
      ),
    },
    {
      key: 'pond',
      header: 'Pond Name',
      render: (row) => row.pondName,
    },
    {
      key: 'mode',
      header: 'Mode',
      render: (row) => (
        <span className={`mode-pill mode-${row.mode}`}>{row.mode}</span>
      ),
    },
    {
      key: 'count',
      header: 'Message Count',
      render: (row) => row.totalMessages,
    },
    {
      key: 'last',
      header: 'Last Message',
      render: (row) => (
        <span className="truncate-cell" title={row.lastMessage}>
          {row.lastMessage || '—'}
        </span>
      ),
    },
    {
      key: 'activity',
      header: 'Last Activity',
      render: (row) => formatDate(row.lastActivity),
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (row) => (
        <Button
          type="button"
          variant="outline"
          onClick={() => void openSession(row)}
        >
          View
        </Button>
      ),
    },
  ]

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <div className="stack-gap">
      <PageHeader
        title="Ask Prana Monitor"
        onRefresh={() => void refresh()}
        onExport={() => void onExport()}
        live
      />

      <DeepFilters
        values={filters}
        onChange={(next) => {
          setPage(1)
          setFilters(next)
        }}
        farmerOptions={farmerOptions}
        pondOptions={pondOptions}
        stateOptions={stateOptions}
        districtOptions={districtOptions}
        severityOptions={[
          { label: 'All statuses', value: 'all' },
          { label: 'Stable', value: 'stable' },
          { label: 'Warning', value: 'warning' },
        ]}
        extraFilters={
          <>
            <Input
              as="select"
              label="Mode"
              value={modeFilter}
              onChange={(e) => {
                setPage(1)
                setModeFilter(e.target.value)
              }}
              options={[
                { label: 'All modes', value: 'all' },
                { label: 'Generic', value: 'generic' },
                { label: 'Pond', value: 'pond' },
              ]}
            />
            <Input
              label="Search"
              placeholder="Farmer, pond, message, session…"
              value={search}
              onChange={(e) => {
                setPage(1)
                setSearch(e.target.value)
              }}
            />
          </>
        }
        statusText={
          loading
            ? 'Loading…'
            : `Showing ${sessions.length} of ${total} sessions`
        }
      />

      {error ? <div className="error-banner">{error}</div> : null}

      <div className="stats-grid">
        <Card kicker="Daily Ask Prana Usage" title="Today">
          <div className="stat-row">
            <div>
              <div className="stat-value">{stats?.messagesToday ?? 0}</div>
              <div className="cell-secondary">Messages today</div>
            </div>
            <div>
              <div className="stat-value">{stats?.sessionsToday ?? 0}</div>
              <div className="cell-secondary">Sessions today</div>
            </div>
          </div>
        </Card>
        <Card kicker="Latest AI Chats" title="Latest 10 active sessions">
          {(stats?.latestSessions || []).length === 0 ? (
            <div className="empty-state">No data available yet.</div>
          ) : (
            <ul className="compact-list">
              {(stats?.latestSessions || []).map((item) => (
                <li key={item.sessionId}>
                  <button
                    type="button"
                    className="linkish"
                    onClick={() =>
                      void openSession({
                        sessionId: item.sessionId,
                        farmerName: item.farmerName,
                        phone: '',
                        pondId: null,
                        pondName: item.pondName,
                        mode: item.mode,
                        totalMessages: 0,
                        lastMessage: item.lastMessage,
                        lastActivity: item.lastActivity,
                        createdAt: item.lastActivity,
                        state: '',
                        district: '',
                      })
                    }
                  >
                    {item.farmerName} · {item.pondName}
                  </button>
                  <div className="cell-secondary truncate-cell">
                    {item.lastMessage || '—'}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card kicker="Top Farmers" title="Highest chat usage">
          {(stats?.topFarmers || []).length === 0 ? (
            <div className="empty-state">No data available yet.</div>
          ) : (
            <ul className="compact-list">
              {(stats?.topFarmers || []).map((f) => (
                <li key={f.id}>
                  <span className="cell-primary">{f.name}</span>
                  <span className="cell-secondary">{f.messages} msgs</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card kicker="Top Ponds" title="Highest chat activity">
          {(stats?.topPonds || []).length === 0 ? (
            <div className="empty-state">No data available yet.</div>
          ) : (
            <ul className="compact-list">
              {(stats?.topPonds || []).map((p) => (
                <li key={p.id}>
                  <span className="cell-primary">{p.name}</span>
                  <span className="cell-secondary">{p.messages} msgs</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card kicker="All Sessions" title="Ask Prana chat sessions">
        {loading ? (
          <Loader />
        ) : (
          <>
            <Table
              columns={columns}
              data={sessions}
              rowKey={(row) => row.sessionId}
              emptyMessage="No Ask Prana sessions yet. Chats from the mobile app will appear here in real time."
            />
            <div className="pagination-row">
              <Button
                type="button"
                variant="outline"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              <span className="cell-secondary">
                Page {page} of {totalPages}
              </span>
              <Button
                type="button"
                variant="outline"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </>
        )}
      </Card>

      <SessionChatDrawer
        open={drawerOpen}
        title={activeSession?.farmerName || 'Conversation'}
        subtitle={
          activeSession
            ? `${activeSession.pondName} · ${activeSession.mode} · ${activeSession.sessionId}`
            : undefined
        }
        loading={drawerLoading}
        error={drawerError}
        messages={drawerMessages}
        onClose={() => {
          setDrawerOpen(false)
          setActiveSession(null)
          setDrawerMessages([])
        }}
        onDelete={() => void onDeleteSession()}
      />
    </div>
  )
}
