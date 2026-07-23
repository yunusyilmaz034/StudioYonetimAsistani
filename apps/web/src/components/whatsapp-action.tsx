'use client'

import { useState } from 'react'
import { ExternalLinkIcon, MessageCircleIcon, SendIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ManualSendDialog } from '@/components/manual-send-dialog'
import { isWhatsAppReachable, openWhatsApp, WA_TEMPLATES } from '@/lib/whatsapp'
import { cn } from '@/lib/utils'

// The member-card WhatsApp action (Task, owner). Clicking it offers TWO paths, because they are two
// different acts: (1) open WhatsApp at her number with a ready greeting — a human then types and sends,
// nothing automated; (2) send a Meta-approved template over WhatsApp as a business-initiated message,
// through the notification pipeline (audited, owner-only). The redirect stays a redirect; the
// automated send is explicit and separate.
export function WhatsAppAction({
  memberId,
  phone,
  memberName,
  className,
}: {
  memberId: string
  phone: string | null | undefined
  memberName: string
  className?: string
}) {
  const [menu, setMenu] = useState(false)
  const [templateSend, setTemplateSend] = useState(false)
  const reachable = isWhatsAppReachable(phone)

  return (
    <>
      <button
        type="button"
        disabled={!reachable}
        title={reachable ? 'WhatsApp' : 'Kayıtlı telefon yok'}
        onClick={() => setMenu(true)}
        className={cn(
          'inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 text-sm font-medium text-foreground transition-colors hover:border-success/50 hover:text-success disabled:opacity-50 disabled:hover:border-border disabled:hover:text-foreground',
          className,
        )}
      >
        <MessageCircleIcon className="size-4" />
        WhatsApp
      </button>

      <Dialog open={menu} onOpenChange={(o) => (o ? null : setMenu(false))}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>WhatsApp</DialogTitle>
            <DialogDescription>Nasıl iletişim kurmak istersin?</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Button
              variant="outline"
              className="justify-start"
              onClick={() => {
                if (phone) openWhatsApp(phone, WA_TEMPLATES.greeting(memberName))
                setMenu(false)
              }}
            >
              <ExternalLinkIcon className="size-4" />
              WhatsApp&apos;ta aç (sohbet)
            </Button>
            <Button
              className="justify-start"
              onClick={() => {
                setMenu(false)
                setTemplateSend(true)
              }}
            >
              <SendIcon className="size-4" />
              Şablonla bildirim gönder
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <ManualSendDialog
        memberId={memberId}
        memberName={memberName}
        open={templateSend}
        onClose={() => setTemplateSend(false)}
        channel="whatsapp"
      />
    </>
  )
}
