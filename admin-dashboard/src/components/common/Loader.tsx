interface LoaderProps {
  label?: string
}

export function Loader({ label = 'Loading…' }: LoaderProps) {
  return (
    <div className="loader">
      <div className="spinner" />
      <div>{label}</div>
    </div>
  )
}
