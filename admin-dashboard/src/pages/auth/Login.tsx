import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../../components/common/Button'
import { Card } from '../../components/common/Card'
import { Input } from '../../components/common/Input'
import { useAuth } from '../../hooks/useAuth'
import { isSupabaseConfigured } from '../../lib/supabase'

export function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('admin@aquaprana.com')
  const [password, setPassword] = useState('admin123')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')

    if (!isSupabaseConfigured) {
      setError(
        'Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to admin-dashboard/.env.',
      )
      return
    }

    setLoading(true)
    try {
      await login(email, password)
      navigate('/', { replace: true })
    } catch (err) {
      const message =
        err instanceof Error && err.message === 'Not authorized'
          ? 'This account is not authorized for admin access.'
          : 'Unable to sign in. Check your email and password.'
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-page">
      <Card className="login-card">
        <img
          className="login-logo"
          src="/aquaprana-logo.png"
          alt="AquaPrana"
          width={140}
          height={140}
        />
        <div className="page-eyebrow">AquaPrana</div>
        <h1>Admin Panel</h1>
        <p>Sign in to monitor farmers, ponds, logs, and Ask Prana usage.</p>
        <form className="login-form" onSubmit={onSubmit}>
          <Input
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <Input
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          {error ? <p style={{ color: 'var(--danger)' }}>{error}</p> : null}
          <Button type="submit" disabled={loading} fullWidth>
            {loading ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </Card>
    </div>
  )
}
