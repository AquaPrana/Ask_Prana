import { Fragment, useState, type ReactNode } from 'react'

export interface Column<T> {
  key: string
  header: string
  render: (row: T) => ReactNode
  width?: string
}

interface TableProps<T> {
  columns: Column<T>[]
  data: T[]
  rowKey: (row: T) => string
  emptyMessage?: string
  expandable?: boolean
  renderExpanded?: (row: T) => ReactNode
}

export function Table<T>({
  columns,
  data,
  rowKey,
  emptyMessage = 'No data available yet.',
  expandable = false,
  renderExpanded,
}: TableProps<T>) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null)

  if (data.length === 0) {
    return <div className="empty-state">{emptyMessage}</div>
  }

  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key} style={col.width ? { width: col.width } : undefined}>
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row) => {
            const key = rowKey(row)
            const isOpen = expandable && expandedKey === key
            return (
              <Fragment key={key}>
                <tr
                  className={
                    expandable
                      ? `data-table-row-clickable${isOpen ? ' is-expanded' : ''}`
                      : undefined
                  }
                  onClick={
                    expandable
                      ? () => setExpandedKey(isOpen ? null : key)
                      : undefined
                  }
                >
                  {columns.map((col) => (
                    <td key={col.key}>{col.render(row)}</td>
                  ))}
                </tr>
                {isOpen && renderExpanded ? (
                  <tr className="data-table-expanded">
                    <td colSpan={columns.length}>{renderExpanded(row)}</td>
                  </tr>
                ) : null}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
