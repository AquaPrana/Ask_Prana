import type { ReactNode } from 'react'

interface CardProps {
  children: ReactNode
  className?: string
  kicker?: string
  title?: string
  actions?: ReactNode
}

export function Card({ children, className = '', kicker, title, actions }: CardProps) {
  const showHeader = Boolean(kicker || title || actions)

  return (
    <section className={`card ${className}`.trim()}>
      <div className="card-body">
        {showHeader ? (
          <div className="card-header">
            <div>
              {kicker ? <div className="card-kicker">{kicker}</div> : null}
              {title ? <h2 className="card-title">{title}</h2> : null}
            </div>
            {actions}
          </div>
        ) : null}
        {children}
      </div>
    </section>
  )
}
