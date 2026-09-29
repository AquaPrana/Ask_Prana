import { useEffect, useRef } from 'react'
import type { AskPranaChatMessage } from '../../types/ask-prana'
import { formatDate } from '../../utils/formatDate'
import { Button } from '../common/Button'
import { Loader } from '../common/Loader'

interface SessionChatDrawerProps {
  open: boolean
  title: string
  subtitle?: string
  loading?: boolean
  error?: string | null
  messages: AskPranaChatMessage[]
  onClose: () => void
  onDelete?: () => void
}

export function SessionChatDrawer({
  open,
  title,
  subtitle,
  loading,
  error,
  messages,
  onClose,
  onDelete,
}: SessionChatDrawerProps) {
  const endRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (open) {
      endRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [open, messages.length])

  if (!open) return null

  return (
    <div className="drawer-backdrop" onClick={onClose} role="presentation">
      <aside
        className="chat-drawer"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="chat-drawer-header">
          <div>
            <div className="page-eyebrow">Conversation</div>
            <h2>{title}</h2>
            {subtitle ? <p className="cell-secondary">{subtitle}</p> : null}
          </div>
          <div className="page-header-actions">
            {onDelete ? (
              <Button type="button" variant="outline" onClick={onDelete}>
                Delete
              </Button>
            ) : null}
            <Button type="button" variant="ghost" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>

        <div className="chat-drawer-body">
          {loading ? <Loader /> : null}
          {error ? <div className="error-banner">{error}</div> : null}
          {!loading && !error && messages.length === 0 ? (
            <div className="empty-state">No messages in this session yet.</div>
          ) : null}
          {!loading &&
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
                  {message.message || (
                    <span className="cell-secondary">
                      {message.fileName
                        ? `[Attachment: ${message.fileName}]`
                        : '(empty)'}
                    </span>
                  )}
                </div>
                <div className="chat-meta">{formatDate(message.createdAt)}</div>
              </div>
            ))}
          <div ref={endRef} />
        </div>
      </aside>
    </div>
  )
}
