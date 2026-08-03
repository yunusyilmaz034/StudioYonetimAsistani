'use client'

import * as React from 'react'
import { EyeIcon, EyeOffIcon } from 'lucide-react'

import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

// PF-44 (owner, 2026-08-02) — *"girerken field içinde göz işareti olsun, ne yazdığını görmek isterse
// o butona basınca göstersin."*
//
// Typing a password you cannot see is a guessing game, and on a phone with autocorrect it is a game
// people lose quietly: a member gets it wrong three times and gives up, and nothing anywhere records
// that she tried. The log does not even say "login failed" — it simply does not happen.
//
// ONE component, used by all six password fields in the product. The toggle pasted into six places
// is a behaviour fixed in five of them.
//
// Deliberate choices, each of which has a wrong version:
//   · Default hidden. Revealing is the exception she asks for, never the state she arrives in.
//   · No auto-hide timer. A field that re-hides itself the moment she looks away is worse than one
//     that never showed her anything.
//   · The button is `tabIndex={-1}` — tabbing from the password field must reach "Giriş Yap", not a
//     decoration on the way.
//   · `aria-label` says the STATE, because the icon says nothing to a screen reader.
export function PasswordInput({
  className,
  ...props
}: Omit<React.ComponentProps<typeof Input>, 'type'>) {
  const [shown, setShown] = React.useState(false)

  return (
    <div className="relative">
      <Input
        {...props}
        type={shown ? 'text' : 'password'}
        // Room for the button, so a long password never runs underneath it.
        className={cn('pr-10', className)}
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setShown((v) => !v)}
        disabled={props.disabled}
        aria-label={shown ? 'Parolayı gizle' : 'Parolayı göster'}
        aria-pressed={shown}
        title={shown ? 'Parolayı gizle' : 'Parolayı göster'}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
      >
        {shown ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
      </button>
    </div>
  )
}
