import { useCallback, useEffect, useState } from 'react'
import { Card } from '../../components/common/Card'
import { Loader } from '../../components/common/Loader'
import { Table, type Column } from '../../components/common/Table'
import { PageHeader } from '../../components/layout/PageHeader'
import { fetchAskPranaSessions } from '../../services/ask-prana'
import type { AskPranaMonitorSession } from '../../types/ask-prana'
import { formatDate } from '../../utils/formatDate'

export function Sessions() {
  const [sessions, setSessions] = useState<AskPranaMonitorSession[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const page = await fetchAskPranaSessions({ page: 1, pageSize: 100 })
      setSessions(page.items)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const columns: Column<AskPranaMonitorSession>[] = [
    {
      key: 'session',
      header: 'Session',
      render: (row) => row.sessionId.slice(0, 8),
    },
    { key: 'farmer', header: 'Farmer', render: (row) => row.farmerName },
    { key: 'pond', header: 'Pond', render: (row) => row.pondName },
    { key: 'mode', header: 'Mode', render: (row) => row.mode },
    {
      key: 'messages',
      header: 'Messages',
      render: (row) => row.totalMessages,
    },
    {
      key: 'activity',
      header: 'Last Activity',
      render: (row) => formatDate(row.lastActivity),
    },
  ]

  return (
    <div className="stack-gap">
      <PageHeader title="Ask Prana Sessions" onRefresh={() => void refresh()} />
      <Card title="Sessions">
        {loading ? (
          <Loader />
        ) : (
          <Table
            columns={columns}
            data={sessions}
            rowKey={(row) => row.sessionId}
          />
        )}
      </Card>
    </div>
  )
}
