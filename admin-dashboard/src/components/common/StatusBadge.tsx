interface StatusBadgeProps {
  status: string
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const normalized = status.toLowerCase()
  let className = 'badge badge-info'

  if (normalized.includes('healthy') || normalized === 'active') {
    className = 'badge badge-success'
  } else if (normalized.includes('stable') || normalized === 'closed') {
    className = 'badge badge-info'
  } else if (
    normalized.includes('watch') ||
    normalized.includes('warning') ||
    normalized.includes('low') ||
    normalized.includes('pre-stocking') ||
    normalized.includes('pre stocking')
  ) {
    className = 'badge badge-warning'
  } else if (normalized.includes('critical') || normalized.includes('danger') || normalized === 'deleted') {
    className = 'badge badge-danger'
  }

  return <span className={className}>{status}</span>
}
