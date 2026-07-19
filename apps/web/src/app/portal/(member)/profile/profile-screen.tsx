'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth'
import { Loader2Icon, LockIcon } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Section } from '@/components/ui/section'
import { clientAuth } from '@/lib/firebase-client'
import { domainErrorMessage } from '@/lib/domain-error'
import { changeOwnPasswordAction, updateOwnProfileAction } from '@/server/actions/portal'

// D9 — what she may change, and what she may not.
//
// The read-only fields are not merely disabled in the form: the SERVER never reads them from the
// request. Her phone is her login identity and the studio's link to her record; her name and
// birth date are what reception verifies her against. Wanting one corrected is a legitimate need
// with a legitimate answer — she asks the studio, and the screen says so (UX-6).
export function PortalProfileScreen(props: {
  studioId: string
  fullName: string
  phone: string
  birthDate: string | null
  email: string | null
  emergencyName: string | null
  emergencyPhone: string | null
}) {
  const router = useRouter()
  const [email, setEmail] = useState(props.email ?? '')
  const [emName, setEmName] = useState(props.emergencyName ?? '')
  const [emPhone, setEmPhone] = useState(props.emergencyPhone ?? '')
  const [busy, setBusy] = useState(false)

  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [pwBusy, setPwBusy] = useState(false)

  async function save() {
    setBusy(true)
    try {
      const res = await updateOwnProfileAction({
        email: email.trim() === '' ? null : email.trim(),
        emergencyName: emName.trim() === '' ? null : emName.trim(),
        emergencyPhone: emPhone.trim() === '' ? null : emPhone.trim(),
      })
      if (res.ok) {
        toast.success('Bilgileriniz kaydedildi.')
        router.refresh()
      } else {
        toast.error(domainErrorMessage(res.error))
      }
    } catch {
      toast.error('Kaydedilemedi.')
    }
    setBusy(false)
  }

  async function changePassword() {
    setPwBusy(true)
    try {
      // She must prove she knows the CURRENT password before setting a new one. The
      // re-authentication happens here, against Firebase, with the account she is signed in as.
      const user = clientAuth().currentUser
      if (!user?.email) throw new Error('no session')
      await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, current))

      const res = await changeOwnPasswordAction({ password: next })
      if (res.ok) {
        toast.success('Şifreniz güncellendi.')
        setCurrent('')
        setNext('')
      } else {
        toast.error(domainErrorMessage(res.error))
      }
    } catch {
      toast.error('Mevcut şifreniz hatalı.')
    }
    setPwBusy(false)
  }

  return (
    <main className="mx-auto max-w-lg space-y-6 p-4 pb-8">
      <h1 className="text-display font-semibold text-foreground">Profil</h1>

      <Section title="Bilgilerim">
        <div className="space-y-3 rounded-xl border border-border bg-card p-4 shadow-sm">
          <ReadOnly label="Ad Soyad" value={props.fullName} />
          <ReadOnly label="Telefon" value={props.phone} />
          <ReadOnly label="Doğum tarihi" value={props.birthDate ? props.birthDate.split('-').reverse().join('/') : '—'} />
          <p className="text-xs text-muted-foreground">
            Ad, telefon ve doğum tarihinizi değiştirmek için stüdyoyla iletişime geçin.
          </p>
        </div>
      </Section>

      <Section title="Güncelleyebilecekleriniz">
        <div className="space-y-3 rounded-xl border border-border bg-card p-4 shadow-sm">
          <Field label="E-posta">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ornek@eposta.com" />
          </Field>
          <Field label="Acil durum kişisi">
            <Input value={emName} onChange={(e) => setEmName(e.target.value)} placeholder="Ad Soyad" />
          </Field>
          <Field label="Acil durum telefonu">
            <Input value={emPhone} onChange={(e) => setEmPhone(e.target.value)} placeholder="05xx xxx xx xx" />
          </Field>
          <Button className="min-h-11 w-full" onClick={save} disabled={busy}>
            {busy ? <Loader2Icon className="animate-spin" /> : null} Kaydet
          </Button>
        </div>
      </Section>

      <Section title="Şifre">
        <div className="space-y-3 rounded-xl border border-border bg-card p-4 shadow-sm">
          <Field label="Mevcut şifre">
            <Input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          </Field>
          <Field label="Yeni şifre (en az 8 karakter)">
            <Input type="password" value={next} onChange={(e) => setNext(e.target.value)} />
          </Field>
          <Button
            variant="outline"
            className="min-h-11 w-full"
            onClick={changePassword}
            disabled={pwBusy || current.length === 0 || next.length < 8}
          >
            {pwBusy ? <Loader2Icon className="animate-spin" /> : <LockIcon />} Şifremi Değiştir
          </Button>
        </div>
      </Section>
    </main>
  )
}

function ReadOnly({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-medium text-foreground">{value}</p>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-[0.6875rem] font-medium tracking-wide uppercase text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  )
}
