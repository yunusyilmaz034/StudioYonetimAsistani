'use client'

import { useState, type FormEvent, type ReactNode } from 'react'
import { Loader2Icon } from 'lucide-react'

import type { Member } from '@studio/core'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { domainErrorMessage } from '@/lib/domain-error'
import { createMember, updateMember } from '@/server/actions/members'

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
      </label>
      {children}
    </div>
  )
}

export function MemberForm({
  member,
  defaultBranchId,
  onDone,
}: {
  member: Member | null
  defaultBranchId: string | null
  onDone: () => void
}) {
  const [fullName, setFullName] = useState(member?.fullName ?? '')
  const [phone, setPhone] = useState<string>(member?.phone ?? '')
  const [email, setEmail] = useState(member?.email ?? '')
  const [birthDate, setBirthDate] = useState(member?.birthDate ?? '')
  const [notes, setNotes] = useState(member?.notes ?? '')
  const [ecName, setEcName] = useState(member?.emergencyContact?.name ?? '')
  const [ecPhone, setEcPhone] = useState<string>(member?.emergencyContact?.phone ?? '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading(true)
    setError(null)
    const emergencyContact =
      ecName.trim() && ecPhone.trim() ? { name: ecName.trim(), phone: ecPhone.trim() } : null
    const fields = {
      fullName: fullName.trim(),
      phone: phone.trim(),
      homeBranchId: member?.homeBranchId ?? defaultBranchId,
      email: email.trim() || null,
      birthDate: birthDate.trim() || null,
      notes: notes.trim() || null,
      emergencyContact,
    }
    try {
      const res = member
        ? await updateMember({ ...fields, memberId: member.id })
        : await createMember(fields)
      if (res.ok) {
        onDone()
      } else {
        setError(domainErrorMessage(res.error))
        setLoading(false)
      }
    } catch {
      setError('Kaydedilemedi. Lütfen tekrar deneyin.')
      setLoading(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field id="m-name" label="Ad Soyad">
        <Input id="m-name" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
      </Field>
      <Field id="m-phone" label="Telefon">
        <Input
          id="m-phone"
          required
          inputMode="tel"
          placeholder="0532 123 45 67"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
      </Field>
      <Field id="m-email" label="E-posta (opsiyonel)">
        <Input id="m-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field id="m-birth" label="Doğum tarihi (opsiyonel)">
        <Input
          id="m-birth"
          type="date"
          value={birthDate}
          onChange={(e) => setBirthDate(e.target.value)}
        />
      </Field>
      <Field id="m-notes" label="Not (opsiyonel)">
        <Textarea id="m-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <Field id="m-ec-name" label="Acil durum kişisi (opsiyonel)">
        <Input
          id="m-ec-name"
          placeholder="Ad Soyad"
          value={ecName}
          onChange={(e) => setEcName(e.target.value)}
        />
      </Field>
      <Field id="m-ec-phone" label="Acil durum telefonu (opsiyonel)">
        <Input
          id="m-ec-phone"
          inputMode="tel"
          placeholder="0532 123 45 67"
          value={ecPhone}
          onChange={(e) => setEcPhone(e.target.value)}
        />
      </Field>

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}

      <Button type="submit" className="min-h-11 w-full" disabled={loading}>
        {loading ? (
          <>
            <Loader2Icon className="animate-spin" />
            Kaydediliyor…
          </>
        ) : member ? (
          'Değişiklikleri Kaydet'
        ) : (
          'Üyeyi Oluştur'
        )}
      </Button>
    </form>
  )
}
