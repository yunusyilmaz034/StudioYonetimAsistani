'use client'

import { useState, type ReactNode } from 'react'

import { Input } from '@/components/ui/input'

// PF-29 — a deliberately SIMPLE bot deterrent (owner's "basit önlem"): a small arithmetic question,
// shown only AFTER a failed login so daily logins stay frictionless. No external service, no tracking,
// no reCAPTCHA/CSP. It is not a fortress — Firebase Auth's own throttling ('auth/too-many-requests')
// is the real brute-force brake; this just stops the casual form-filling bot from hammering the page.
function newQuestion(): { a: number; b: number; sum: number } {
  const a = 2 + Math.floor(Math.random() * 8) // 2..9
  const b = 1 + Math.floor(Math.random() * 9) // 1..9
  return { a, b, sum: a + b }
}

export function useMathCaptcha(): { solved: boolean; node: ReactNode; reset: () => void } {
  const [q, setQ] = useState(newQuestion)
  const [answer, setAnswer] = useState('')

  const solved = answer.trim() !== '' && Number(answer) === q.sum

  return {
    solved,
    reset: () => {
      setQ(newQuestion())
      setAnswer('')
    },
    node: (
      <div className="space-y-1.5">
        <label htmlFor="captcha" className="text-sm font-medium text-foreground">
          Doğrulama: {q.a} + {q.b} = ?
        </label>
        <Input
          id="captcha"
          inputMode="numeric"
          autoComplete="off"
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          placeholder="Sonucu yazın"
        />
      </div>
    ),
  }
}
