'use client'

import { MessageCircleIcon } from 'lucide-react'

import { isWhatsAppReachable, openWhatsApp } from '@/lib/whatsapp'
import { cn } from '@/lib/utils'

// A reusable WhatsApp quick-action (Plus Phase 2 §3). It opens WhatsApp at the member's number with a
// ready message from the central module (`lib/whatsapp.ts`) — the human presses send. Nothing is sent
// automatically. If there is no phone on file, the button is disabled and says why, rather than
// opening a broken link.
export function WhatsAppButton({
  phone,
  text = '',
  label = 'WhatsApp',
  className,
}: {
  phone: string | null | undefined
  text?: string
  label?: string
  className?: string
}) {
  const reachable = isWhatsAppReachable(phone)
  return (
    <button
      type="button"
      disabled={!reachable}
      title={reachable ? 'WhatsApp ile yaz' : 'Kayıtlı telefon yok'}
      onClick={() => phone && openWhatsApp(phone, text)}
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 text-sm font-medium text-foreground transition-colors hover:border-success/50 hover:text-success disabled:opacity-50 disabled:hover:border-border disabled:hover:text-foreground',
        className,
      )}
    >
      <MessageCircleIcon className="size-4" />
      {label}
    </button>
  )
}
