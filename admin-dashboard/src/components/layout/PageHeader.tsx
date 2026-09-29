import { APP_EYEBROW } from '../../utils/constants'
import { Button } from '../common/Button'

interface PageHeaderProps {
  title: string
  eyebrow?: string
  onRefresh?: () => void
  onExport?: () => void
  live?: boolean
}

export function PageHeader({
  title,
  eyebrow = APP_EYEBROW,
  onRefresh,
  onExport,
  live = true,
}: PageHeaderProps) {
  return (
    <div className="page-header">
      <div>
        <div className="page-eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
      </div>
      <div className="page-header-actions">
        {live ? (
          <span className="live-badge">
            <span className="live-dot" />
            Live
          </span>
        ) : null}
        <Button type="button" variant="outline" onClick={onRefresh}>
          Refresh
        </Button>
        <Button type="button" variant="primary" onClick={onExport}>
          Export CSV
        </Button>
      </div>
    </div>
  )
}
