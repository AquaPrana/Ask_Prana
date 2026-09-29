import type { InputHTMLAttributes, SelectHTMLAttributes } from 'react'

interface BaseFieldProps {
  label?: string
  className?: string
}

type TextInputProps = BaseFieldProps &
  InputHTMLAttributes<HTMLInputElement> & {
    as?: 'input'
  }

type SelectProps = BaseFieldProps &
  SelectHTMLAttributes<HTMLSelectElement> & {
    as: 'select'
    options: Array<{ label: string; value: string }>
  }

type InputProps = TextInputProps | SelectProps

export function Input(props: InputProps) {
  if (props.as === 'select') {
    const { options, label, className = '', as: _as, ...rest } = props
    void _as
    return (
      <div className={`field ${className}`.trim()}>
        {label ? <label>{label}</label> : null}
        <select {...rest}>
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
    )
  }

  const { label, className = '', as: _as, ...rest } = props
  void _as
  return (
    <div className={`field ${className}`.trim()}>
      {label ? <label>{label}</label> : null}
      <input {...rest} />
    </div>
  )
}
