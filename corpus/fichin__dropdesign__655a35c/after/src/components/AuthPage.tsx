import { useState, type FormEvent, type MouseEvent } from 'react'
import { ApiError } from '../api/client'
import './AuthPage.css'

type Mode = 'login' | 'register'
type Field = 'email' | 'password'

interface AuthPageProps {
  mode: Mode
  /** Shown above the form, e.g. "Your session has ended" */
  notice?: string
  onSubmit: (email: string, password: string) => Promise<void>
  onSwitchMode: (mode: Mode) => void
}

const COPY = {
  login: {
    title: 'Log in',
    subtitle: 'Welcome back to Project PlanetX.',
    submit: 'Log in',
    submitting: 'Logging in…',
    switchText: "Don't have an account?",
    switchLink: 'Create one',
  },
  register: {
    title: 'Create your account',
    subtitle: 'Sign up to use the board.',
    submit: 'Create account',
    submitting: 'Creating account…',
    switchText: 'Already have an account?',
    switchLink: 'Log in',
  },
} as const

/** Same rules as the API, checked first so most mistakes don't need a round trip */
function validate(mode: Mode, email: string, password: string): Partial<Record<Field, string>> {
  const errors: Partial<Record<Field, string>> = {}
  if (!email.trim()) errors.email = 'Enter your email address'
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) errors.email = 'Enter a valid email address'

  if (!password) errors.password = 'Enter your password'
  else if (mode === 'register' && password.length < 8) errors.password = 'Use at least 8 characters'
  else if (mode === 'register' && new TextEncoder().encode(password).length > 72) errors.password = 'Use at most 72 bytes'
  return errors
}

function AuthPage({ mode, notice, onSubmit, onSwitchMode }: AuthPageProps) {
  const copy = COPY[mode]
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<Field, string>>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  // Errors appear after the first submit, then update as you type
  const [attempted, setAttempted] = useState(false)

  function update(field: Field, value: string) {
    const next = { email, password, [field]: value }
    if (field === 'email') setEmail(value)
    else setPassword(value)
    if (attempted) setFieldErrors(validate(mode, next.email, next.password))
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return
    setAttempted(true)
    setFormError(null)
    const errors = validate(mode, email, password)
    setFieldErrors(errors)
    if (Object.keys(errors).length) return

    setSubmitting(true)
    try {
      await onSubmit(email.trim(), password)
      // On success the app navigates to the board, which unmounts this page
    } catch (error) {
      if (!(error instanceof ApiError)) setFormError('Something went wrong. Please try again.')
      else if (error.unreachable) setFormError("Can't reach the server. Check your connection and try again.")
      else if (error.status === 409) setFieldErrors({ email: 'An account with this email already exists' })
      else if (error.status === 400 && error.issues.length) {
        const fromServer: Partial<Record<Field, string>> = {}
        for (const issue of error.issues) {
          const field = issue.path[0]
          if ((field === 'email' || field === 'password') && !fromServer[field]) fromServer[field] = issue.message
        }
        setFieldErrors(fromServer)
      } else setFormError(error.message)
      setSubmitting(false)
    }
  }

  function switchMode(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault()
    onSwitchMode(mode === 'login' ? 'register' : 'login')
  }

  const errorId = (field: Field) => `${field}-error`

  return (
    <main className="auth-page">
      <div className="auth-card">
        <div className="auth-logo" aria-hidden="true" />
        <h1 className="auth-title">{copy.title}</h1>
        <p className="auth-subtitle">{copy.subtitle}</p>

        {notice && (
          <p className="auth-notice" role="status">
            {notice}
          </p>
        )}
        {formError && (
          <p className="auth-form-error" role="alert">
            {formError}
          </p>
        )}

        <form className="auth-form" onSubmit={handleSubmit} noValidate aria-busy={submitting}>
          <div className="auth-field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => update('email', event.target.value)}
              aria-invalid={!!fieldErrors.email}
              aria-describedby={fieldErrors.email ? errorId('email') : undefined}
              autoFocus
            />
            {fieldErrors.email && (
              <p id={errorId('email')} className="auth-field-error">
                {fieldErrors.email}
              </p>
            )}
          </div>

          <div className="auth-field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(event) => update('password', event.target.value)}
              aria-invalid={!!fieldErrors.password}
              aria-describedby={fieldErrors.password ? errorId('password') : mode === 'register' ? 'password-hint' : undefined}
            />
            {fieldErrors.password ? (
              <p id={errorId('password')} className="auth-field-error">
                {fieldErrors.password}
              </p>
            ) : (
              mode === 'register' && (
                <p id="password-hint" className="auth-field-hint">
                  At least 8 characters
                </p>
              )
            )}
          </div>

          <button type="submit" className="auth-submit" disabled={submitting}>
            {submitting && <span className="auth-spinner" aria-hidden="true" />}
            {submitting ? copy.submitting : copy.submit}
          </button>
        </form>

        <p className="auth-switch">
          {copy.switchText}{' '}
          <a href={mode === 'login' ? '/register' : '/login'} onClick={switchMode}>
            {copy.switchLink}
          </a>
        </p>
      </div>
    </main>
  )
}

export default AuthPage
