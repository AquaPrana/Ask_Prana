import { useCallback, useEffect, useState } from 'react'
import { Card } from '../../components/common/Card'
import { Loader } from '../../components/common/Loader'
import { PageHeader } from '../../components/layout/PageHeader'
import { fetchAskPranaSession, fetchAskPranaSessions } from '../../services/ask-prana'
import type { AskPranaChatMessage, AskPranaMonitorSession } from '../../types/ask-prana'
import { formatDate } from '../../utils/formatDate'
import { Button } from '../../components/common/Button'

export function Messages() {
  const [sessions, setSessions] = useState<AskPranaMonitorSession[]>([])
  const [selectedId, setSelectedId] = useState<string>('')
  const [messages, setMessages] = useState<AskPranaChatMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMessages, setLoadingMessages] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const page = await fetchAskPranaSessions({ page: 1, pageSize: 50 })
      setSessions(page.items)
      setSelectedId((current) => current || page.items[0]?.sessionId || '')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!selectedId) return
    void (async () => {
      setLoadingMessages(true)
      try {
        const detail = await fetchAskPranaSession(selectedId)
        setMessages(detail.messages)
      } finally {
        setLoadingMessages(false)
      }
    })()
  }, [selectedId])

  return (
    <div className="stack-gap">
      <PageHeader title="Ask Prana Messages" onRefresh={() => void refresh()} />
      <Card title="Pick a session">
        {loading ? (
          <Loader />
        ) : (
          <div className="stack-gap">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {sessions.map((session) => (
                <Button
                  key={session.sessionId}
                  type="button"
                  variant={
                    selectedId === session.sessionId ? 'primary' : 'outline'
                  }
                  onClick={() => setSelectedId(session.sessionId)}
                >
                  {session.farmerName} · {session.pondName}
                </Button>
              ))}
            </div>
            {loadingMessages ? (
              <Loader />
            ) : (
              <div className="chat-drawer-body" style={{ maxHeight: 520 }}>
                {messages.length === 0 ? (
                  <div className="empty-state">
                    No messages in this session yet.
                  </div>
                ) : (
                  messages.map((message) => (
                    <div
                      key={message.id}
                      className={`chat-bubble-row ${message.role === 'user' ? 'is-user' : 'is-assistant'}`}
                    >
                      <div className="chat-role-label">
                        {message.role === 'user' ? 'User' : 'Assistant'}
                      </div>
                      <div
                        className={`chat-bubble ${message.role === 'user' ? 'user' : 'assistant'}`}
                      >
                        {message.message}
                      </div>
                      <div className="chat-meta">
                        {formatDate(message.createdAt)}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  )
}
