import { useState, type ReactNode } from 'react'
import { Button } from './Button'
import { Card } from './Card'
import { Input } from './Input'

export interface DeepFilterValues {
  from: string
  to: string
  state: string
  district: string
  farmer: string
  pond: string
  severity: string
}

export interface FilterOption {
  label: string
  value: string
}

export const EMPTY_DEEP_FILTERS: DeepFilterValues = {
  from: '',
  to: '',
  state: 'all',
  district: 'all',
  farmer: 'all',
  pond: 'all',
  severity: 'all',
}

const EMPTY = EMPTY_DEEP_FILTERS

interface DeepFiltersProps {
  values?: DeepFilterValues
  onChange?: (values: DeepFilterValues) => void
  onClear?: () => void
  farmerOptions?: FilterOption[]
  pondOptions?: FilterOption[]
  stateOptions?: FilterOption[]
  districtOptions?: FilterOption[]
  severityOptions?: FilterOption[]
  extraFilters?: ReactNode
  statusText?: string
  severityLabel?: string
}

export function DeepFilters({
  values: controlled,
  onChange,
  onClear,
  farmerOptions = [
    { label: 'All Farmers', value: 'all' },
  ],
  pondOptions = [
    { label: 'All Ponds', value: 'all' },
  ],
  stateOptions = [
    { label: 'All States', value: 'all' },
  ],
  districtOptions = [
    { label: 'All Districts', value: 'all' },
  ],
  severityOptions = [
    { label: 'All', value: 'all' },
    { label: 'Low', value: 'low' },
    { label: 'Medium', value: 'medium' },
    { label: 'High', value: 'high' },
    { label: 'Critical', value: 'critical' },
  ],
  extraFilters,
  statusText = 'Showing all data',
  severityLabel = 'Alert Severity',
}: DeepFiltersProps) {
  const [internal, setInternal] = useState<DeepFilterValues>(EMPTY)
  const values = controlled ?? internal

  const update = (patch: Partial<DeepFilterValues>) => {
    const next = { ...values, ...patch }
    if (!controlled) setInternal(next)
    onChange?.(next)
  }

  const clear = () => {
    if (!controlled) setInternal(EMPTY)
    onChange?.(EMPTY)
    onClear?.()
  }

  return (
    <Card
      className="deep-filters"
      kicker="Deep Filters"
      title="Region, farmer, pond, severity, and date range"
      actions={
        <Button type="button" variant="outline" onClick={clear}>
          Clear Filters
        </Button>
      }
    >
      <div className="deep-filters-grid">
        <Input
          label="From"
          type="date"
          value={values.from}
          onChange={(e) => update({ from: e.target.value })}
        />
        <Input
          label="To"
          type="date"
          value={values.to}
          onChange={(e) => update({ to: e.target.value })}
        />
        <Input
          as="select"
          label="State"
          value={values.state}
          onChange={(e) =>
            update({ state: e.target.value, district: 'all' })
          }
          options={stateOptions}
        />
        <Input
          as="select"
          label="District"
          value={values.district}
          onChange={(e) => update({ district: e.target.value })}
          options={districtOptions}
        />
        <Input
          as="select"
          label="Farmer"
          value={values.farmer}
          onChange={(e) => update({ farmer: e.target.value })}
          options={farmerOptions}
        />
        <Input
          as="select"
          label="Pond"
          value={values.pond}
          onChange={(e) => update({ pond: e.target.value })}
          options={pondOptions}
        />
        <Input
          as="select"
          label={severityLabel}
          value={values.severity}
          onChange={(e) => update({ severity: e.target.value })}
          options={severityOptions}
        />
        {extraFilters}
      </div>
      <div className="deep-filters-footer">{statusText}</div>
    </Card>
  )
}
