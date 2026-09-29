const months = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

export function formatDate(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(date.getTime())) return '—'

  const day = date.getDate().toString().padStart(2, '0')
  const month = months[date.getMonth()]
  const year = date.getFullYear()
  let hours = date.getHours()
  const minutes = date.getMinutes().toString().padStart(2, '0')
  const period = hours >= 12 ? 'pm' : 'am'
  hours = hours % 12 || 12

  return `${day} ${month} ${year}, ${hours}:${minutes} ${period}`
}

export function formatIsoDateLocal(value: string | null | undefined): string {
  if (!value?.trim()) return '—'

  const iso = value.trim().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    return formatDateShort(value)
  }

  const [year, month, day] = iso.split('-').map(Number)
  const monthLabel = months[month - 1]
  if (!year || !monthLabel || !day) return '—'

  return `${String(day).padStart(2, '0')} ${monthLabel} ${year}`
}

export function formatDateShort(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(date.getTime())) return '—'

  const day = date.getDate().toString().padStart(2, '0')
  const month = months[date.getMonth()]
  const year = date.getFullYear()
  return `${day} ${month} ${year}`
}

export function formatCurrencyINR(amount: number | null | undefined): string {
  const value = typeof amount === 'number' ? amount : Number(amount)
  if (!Number.isFinite(value)) {
    return '₹0'
  }

  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(value)
}
