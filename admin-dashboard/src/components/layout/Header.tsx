interface HeaderProps {
  title?: string
}

export function Header({ title }: HeaderProps) {
  if (!title) return null
  return (
    <header className="page-header">
      <h1>{title}</h1>
    </header>
  )
}
