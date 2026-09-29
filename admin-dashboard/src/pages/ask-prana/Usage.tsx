import { useCallback, useEffect, useState } from 'react'
import { Card } from '../../components/common/Card'
import { Loader } from '../../components/common/Loader'
import { PageHeader } from '../../components/layout/PageHeader'
import { fetchAskPranaStats } from '../../services/ask-prana'
import type { AskPranaStats } from '../../types/ask-prana'

export function Usage() {
  const [stats, setStats] = useState<AskPranaStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setStats(await fetchAskPranaStats())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    <div className="stack-gap">
      <PageHeader title="Ask Prana Usage" onRefresh={() => void refresh()} />
      {error ? <div className="error-banner">{error}</div> : null}
      <div className="stats-grid">
        <Card kicker="Today" title="Messages">
          {loading ? (
            <Loader />
          ) : (
            <div className="stat-value">{stats?.messagesToday ?? 0}</div>
          )}
        </Card>
        <Card kicker="Today" title="Sessions">
          {loading ? (
            <Loader />
          ) : (
            <div className="stat-value">{stats?.sessionsToday ?? 0}</div>
          )}
        </Card>
        <Card kicker="Top Farmers" title="Highest usage">
          {loading ? (
            <Loader />
          ) : (stats?.topFarmers || []).length === 0 ? (
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
        <Card kicker="Top Ponds" title="Highest activity">
          {loading ? (
            <Loader />
          ) : (stats?.topPonds || []).length === 0 ? (
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
    </div>
  )
}
