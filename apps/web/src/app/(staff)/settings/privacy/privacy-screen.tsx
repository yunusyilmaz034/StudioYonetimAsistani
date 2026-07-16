'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeftIcon, Loader2Icon, SearchIcon, ShieldAlertIcon } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/page-header'
import { Section } from '@/components/ui/section'
import { listBookingMembersAction, type BookingMember } from '@/server/actions/booking'

import { ErasurePanel } from './erasure-panel'

// KVKK / Gizlilik (PF-9) — the erasure moved OFF every member card (irreversible, and one accidental
// tap away on eight hundred screens) onto ONE deliberate surface: search a member, then anonymise. The
// erasure itself is unchanged — same preview, same typed-name confirmation, same platform_admin lock in
// the domain (AD-67). This screen only changes WHERE it lives, not what it does.
export function PrivacyScreen() {
  const [members, setMembers] = useState<readonly BookingMember[] | null>(null)
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<BookingMember | null>(null)

  useEffect(() => {
    listBookingMembersAction()
      .then(setMembers)
      .catch(() => {
        setMembers([])
        toast.error('Üye listesi yüklenemedi.')
      })
  }, [])

  const filtered = useMemo(() => {
    if (!members) return []
    const q = query.trim().toLocaleLowerCase('tr')
    const digits = query.replace(/\D/g, '')
    if (!q && !digits) return members.slice(0, 20)
    return members
      .filter((m) => m.fullName.toLocaleLowerCase('tr').includes(q) || (digits.length > 0 && m.phone.includes(digits)))
      .slice(0, 20)
  }, [members, query])

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="KVKK / Gizlilik"
        description="Üye kaydını kalıcı olarak anonimleştirme"
        actions={
          <Button variant="outline" size="sm" render={<Link href="/settings" />}>
            <ArrowLeftIcon />
            Ayarlar
          </Button>
        }
      />

      <Section
        title="Üye kaydını anonimleştir"
        hint="Geri alınamaz. Önce üyeyi seçin; sonra ne gideceğini görüp, adı yazarak onaylarsınız."
      >
        <div className="space-y-3">
          <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-2.5 text-sm">
            <ShieldAlertIcon className="mt-0.5 size-4 shrink-0 text-warning" />
            <p className="text-muted-foreground">
              Anonimleştirme <strong>kalıcıdır</strong> ve yalnızca yetkili (platform yöneticisi) tarafından
              yapılabilir. Geçici olarak erişimi kapatmak için üye kartındaki <strong>Pasife Al</strong> seçeneğini kullanın.
            </p>
          </div>

          {picked ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between rounded-lg border border-border p-2 text-sm">
                <span className="font-medium">{picked.fullName}</span>
                <Button variant="ghost" size="sm" onClick={() => setPicked(null)}>
                  Değiştir
                </Button>
              </div>
              <ErasurePanel memberId={picked.id} memberName={picked.fullName} />
            </div>
          ) : (
            <>
              <div className="relative">
                <SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input className="pl-8" placeholder="Üye ara (isim veya telefon)…" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
              </div>
              {members === null ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2Icon className="size-4 animate-spin" /> Yükleniyor…
                </p>
              ) : (
                <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-xl border border-border bg-card">
                  {filtered.map((m) => (
                    <li key={m.id}>
                      <button
                        type="button"
                        onClick={() => setPicked(m)}
                        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                      >
                        <span className="font-medium text-foreground">{m.fullName}</span>
                        <span className="text-xs text-muted-foreground">{m.phone}</span>
                      </button>
                    </li>
                  ))}
                  {filtered.length === 0 ? <li className="px-3 py-4 text-sm text-muted-foreground">Eşleşen üye yok.</li> : null}
                </ul>
              )}
            </>
          )}
        </div>
      </Section>
    </main>
  )
}
