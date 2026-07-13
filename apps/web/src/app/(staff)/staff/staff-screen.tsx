'use client'

import { UserPlusIcon } from 'lucide-react'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/page-header'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { domainErrorMessage } from '@/lib/domain-error'
import {
  changeStaffRoleAction,
  createStaffAction,
  deactivateStaffAction,
  reactivateStaffAction,
  type StaffRow,
} from '@/server/actions/staff'

// Who may work here, and as what.
//
// The screen is deliberately plain. It is used perhaps five times a year, and every one of those
// times it hands somebody the keys to the studio — so what it owes the owner is not elegance, it is
// **being impossible to misread**: what each role can see, said in a sentence, next to the choice.

const ROLE_LABEL: Record<string, string> = {
  owner: 'Sahip',
  receptionist: 'Resepsiyon',
  trainer: 'Eğitmen',
}

// The permission matrix, in the owner's language, at the moment she is choosing. A role name means
// nothing on its own; "üyeleri ve kasayı görür" means everything.
const ROLE_MEANS: Record<string, string> = {
  owner: 'Her şeyi görür ve yönetir — denetim kaydı, analiz, personel dahil.',
  receptionist: 'Üyeler, paketler, rezervasyon, satış, tahsilat, kasa. Analiz ve denetim kaydını görmez.',
  trainer: 'Yalnızca kendi derslerini ve o derslerdeki üyelerin adlarını görür. Başka hiçbir şeyi.',
}

export function StaffScreen({ staff }: { staff: readonly StaffRow[] }) {
  const [adding, setAdding] = useState(false)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Personel"
        description="Stüdyoda kimin çalıştığı ve neyi görebildiği."
        actions={
          <Button onClick={() => setAdding(true)}>
            <UserPlusIcon className="size-4" />
            Personel ekle
          </Button>
        }
      />

      <div className="grid gap-3">
        {staff.map((s) => (
          <StaffCard key={s.id} staff={s} />
        ))}
      </div>

      <AddStaffDialog open={adding} onClose={() => setAdding(false)} />
    </div>
  )
}

function StaffCard({ staff }: { staff: StaffRow }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [reason, setReason] = useState('')
  const [asking, setAsking] = useState(false)

  // The refresh is not cosmetic. Without it the row keeps rendering the STALE `staff` prop: the
  // Select snaps back to the old role and a change that actually succeeded looks like it failed
  // (Alpha Review).
  const run = (fn: () => Promise<{ ok: boolean; error?: unknown }>, done: string) =>
    start(async () => {
      const res = await fn()
      if (res.ok) {
        toast.success(done)
        router.refresh()
      } else {
        toast.error(domainErrorMessage(res.error as never))
      }
    })

  return (
    <Card className={staff.active ? undefined : 'opacity-60'}>
      <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium">{staff.displayName}</span>
            {staff.isSelf ? <Badge className="bg-muted text-muted-foreground">Sen</Badge> : null}
            {!staff.active ? <Badge className="bg-muted text-muted-foreground">Pasif</Badge> : null}
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">{ROLE_MEANS[staff.role]}</p>
          {staff.isLastOwner ? (
            <p className="mt-1 text-sm text-muted-foreground">
              Stüdyodaki tek aktif sahip. Yetkisi değiştirilemez — önce başka bir sahip yetkilendirin.
            </p>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          <Select
            value={staff.role}
            // A studio ALWAYS has at least one active owner. The domain refuses to demote the last
            // one — a studio with no owner has locked every human out of its own permission system.
            // The select is disabled so she never meets that refusal as a surprise; the refusal is
            // what actually holds.
            disabled={pending || !staff.active || staff.isLastOwner}
            onValueChange={(v) =>
              v &&
              run(
                () => changeStaffRoleAction({ staffUserId: staff.id, role: v }),
                'Yetki güncellendi.',
              )
            }
          >
            <SelectTrigger className="w-[9.5rem]">
              <SelectValue>{ROLE_LABEL[staff.role]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {Object.entries(ROLE_LABEL).map(([id, label]) => (
                <SelectItem key={id} value={id}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {staff.active ? (
            <Button
              variant="outline"
              disabled={pending || staff.isSelf || staff.isLastOwner}
              onClick={() => setAsking(true)}
            >
              Pasife al
            </Button>
          ) : (
            <Button
              variant="outline"
              disabled={pending}
              onClick={() =>
                run(() => reactivateStaffAction({ staffUserId: staff.id }), 'Yeniden aktif.')
              }
            >
              Aktif et
            </Button>
          )}
        </div>
      </CardContent>

      <Dialog open={asking} onOpenChange={setAsking}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{staff.displayName} pasife alınacak</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Hesabı devre dışı kalır ve giriş yapamaz. Geçmişte yaptığı işlemler kayıtlarda kalır —
            silinmez.
          </p>
          {/* The reason is mandatory in the domain. A departure with no recorded reason is
              indistinguishable from an account somebody quietly removed. */}
          <Textarea
            placeholder="Gerekçe (zorunlu) — örn. işten ayrıldı"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setAsking(false)}>
              Vazgeç
            </Button>
            <Button
              disabled={pending || reason.trim().length === 0}
              onClick={() => {
                setAsking(false)
                run(
                  () => deactivateStaffAction({ staffUserId: staff.id, reason }),
                  'Personel pasife alındı.',
                )
              }}
            >
              Pasife al
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

function AddStaffDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [pending, start] = useTransition()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('receptionist')
  const [password, setPassword] = useState('')

  const submit = () =>
    start(async () => {
      const res = await createStaffAction({ displayName: name, email, role, password })
      if (!res.ok) {
        toast.error(domainErrorMessage(res.error))
        return
      }
      toast.success(`${name} eklendi.`)
      setName('')
      setEmail('')
      setPassword('')
      onClose()
    })

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Personel ekle</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <Input placeholder="Ad Soyad" value={name} onChange={(e) => setName(e.target.value)} />
          <Input
            type="email"
            placeholder="E-posta (giriş için)"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Input
            type="password"
            placeholder="Geçici şifre (en az 8 karakter)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          <Select value={role} onValueChange={(v) => setRole(v ?? 'receptionist')}>
            <SelectTrigger>
              <SelectValue>{ROLE_LABEL[role]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {Object.entries(ROLE_LABEL).map(([id, label]) => (
                <SelectItem key={id} value={id}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Said at the moment she chooses, not in a help page she will never open. */}
          <p className="rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">
            {ROLE_MEANS[role]}
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Vazgeç
          </Button>
          <Button
            disabled={pending || !name.trim() || !email.trim() || password.length < 8}
            onClick={submit}
          >
            Ekle
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
