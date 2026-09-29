import type { InputHTMLAttributes } from 'react'

interface SearchBarProps extends InputHTMLAttributes<HTMLInputElement> {}

export function SearchBar({ className = '', ...props }: SearchBarProps) {
  return (
    <div className={`search-bar ${className}`.trim()}>
      <input type="search" {...props} />
    </div>
  )
}
