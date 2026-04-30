import { useState, type FormEvent } from 'react'
import { toUserMessage } from '@/app/errors'
import { signInWithConfiguredPassword, signInWithPassword } from '@/app/auth'

export function LoginScreen({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [errorText, setErrorText] = useState('')
  const fixedPasswordConfigured = (import.meta.env.VITE_LOGIN_PASSWORD ?? '').trim().length > 0

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setErrorText('')
    try {
      if (fixedPasswordConfigured) {
        // When configured, we do not rely on user-entered password.
        // (PocketBase still validates against its stored hash; env must match.)
        await signInWithConfiguredPassword()
      } else {
        if (!password.trim()) {
          setErrorText('Enter password to continue.')
          return
        }
        await signInWithPassword(password)
      }
      setPassword('')
      onSuccess()
    } catch (error) {
      setErrorText(toUserMessage(error))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-100 p-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-center text-2xl font-semibold tracking-tight text-slate-900">Kapil Billing</h1>
        <p className="mt-2 text-center text-sm text-slate-500">Enter password to continue</p>
        <form className="mt-6 space-y-4" onSubmit={onSubmit}>
          {fixedPasswordConfigured ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              Password is configured from environment. Click <b>Login</b>.
            </div>
          ) : (
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Password"
              className="h-11 w-full rounded-lg border border-slate-300 px-3 text-sm text-slate-900 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              autoFocus
              autoComplete="current-password"
            />
          )}
          {errorText && <p className="text-sm text-red-600">{errorText}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="h-11 w-full rounded-lg bg-blue-700 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? 'Signing in...' : 'Login'}
          </button>
        </form>
      </div>
    </div>
  )
}
