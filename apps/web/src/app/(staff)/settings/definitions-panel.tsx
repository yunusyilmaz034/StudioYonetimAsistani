'use client'

import { PlusIcon } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Section } from '@/components/ui/section'
import { RetailPanel } from './retail-panel'
import { Textarea } from '@/components/ui/textarea'
import { domainErrorMessage } from '@/lib/domain-error'
import { createDrawerAction, listDrawersAction, renameDrawerAction, setDrawerActiveAction } from '@/server/actions/finance'
import {
  createRoomNoteAction,
  listRoomNotesAction,
  resolveRoomNoteAction,
  type RoomNote,
} from '@/server/actions/room-notes'
import {
  createRoomAction,
  createServiceAction,
  deactivateRoomAction,
  deactivateServiceAction,
  listDefinitionsAction,
  reactivateRoomAction,
  reactivateServiceAction,
  type RoomRow,
  type ServiceRow,
} from '@/server/actions/scheduling'

// DERS TÜRLERİ ve SALONLAR (Alpha Review, 2026-07-13).
//
// The domain has been able to create these since v1.6 and **no screen ever did**. The only creator in
// the whole repository was the demo seed — so a studio doing a real cutover could not define a single
// ders türü or salon of its own, and could therefore not schedule its first class. The capability was
// finished; it simply had no door.
//
// ── The category is IMMUTABLE, and the form says so ─────────────────────────────────────────
// A service's category is frozen at creation (I-22). It is what the category wall is judged against:
// an unlimited fitness membership does not open the reformer room. Letting it be edited would
// retroactively change which packages open which classes — for reservations that already happened.

const CATEGORY: Record<string, string> = {
  pilates_group: 'Pilates (grup)',
  fitness: 'Fitness',
  private: 'Özel ders (PT)',
}

interface DrawerRow {
  id: string
  name: string
  kind: string
  status: string
  active: boolean
}

export function DefinitionsPanel({ branchId, canManage = false }: { branchId: string | null; canManage?: boolean }) {
  const [services, setServices] = useState<readonly ServiceRow[]>([])
  const [rooms, setRooms] = useState<readonly RoomRow[]>([])
  const [drawers, setDrawers] = useState<readonly DrawerRow[]>([])
  const [notes, setNotes] = useState<readonly RoomNote[]>([])
  const [newService, setNewService] = useState(false)
  const [newRoom, setNewRoom] = useState(false)
  const [newDrawer, setNewDrawer] = useState(false)
  const [newNote, setNewNote] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [drawerName, setDrawerName] = useState('')

  const load = useCallback(async () => {
    try {
      const [d, k, n] = await Promise.all([listDefinitionsAction(), listDrawersAction(), listRoomNotesAction()])
      setServices(d.services)
      setRooms(d.rooms)
      setDrawers(k as unknown as DrawerRow[])
      setNotes(n)
    } catch {
      toast.error('Tanımlar okunamadı.')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const saveRename = async (id: string) => {
    const res = await renameDrawerAction({ drawerId: id, name: drawerName.trim() })
    if (res.ok) {
      setRenamingId(null)
      await load()
    } else toast.error(domainErrorMessage(res.error))
  }

  const toggleArchive = async (d: DrawerRow) => {
    const res = await setDrawerActiveAction({ drawerId: d.id, active: !d.active })
    if (res.ok) {
      toast.success(d.active ? 'Kasa arşivlendi.' : 'Kasa geri alındı.')
      await load()
    } else toast.error(domainErrorMessage(res.error))
  }

  const toggleService = async (s: ServiceRow) => {
    const res = s.active
      ? await deactivateServiceAction({ serviceId: s.id, reason: 'Ayarlar ekranından kapatıldı' })
      : await reactivateServiceAction({ serviceId: s.id })
    if (!res.ok) {
      toast.error(domainErrorMessage(res.error))
      return
    }
    toast.success(s.active ? 'Ders türü kapatıldı.' : 'Ders türü açıldı.')
    void load()
  }

  const toggleRoom = async (r: RoomRow) => {
    const res = r.active
      ? await deactivateRoomAction({ roomId: r.id, reason: 'Ayarlar ekranından kapatıldı' })
      : await reactivateRoomAction({ roomId: r.id })
    if (!res.ok) {
      toast.error(domainErrorMessage(res.error))
      return
    }
    toast.success(r.active ? 'Salon kapatıldı.' : 'Salon açıldı.')
    void load()
  }

  const resolveNote = async (n: RoomNote) => {
    const res = await resolveRoomNoteAction({ noteId: n.id })
    if (!res.ok) {
      toast.error('Not kapatılamadı.')
      return
    }
    toast.success('Not kapatıldı.')
    void load()
  }

  const activeRooms = rooms.filter((r) => r.active)

  return (
    <div className="space-y-6">
      <Section
        title="Ders türleri"
        hint="Reformer, Mat Pilates, Fitness… Bir ders türünün kategorisi sonradan değiştirilemez — hangi paketin hangi dersi açtığı buna bağlıdır."
      >
        <div className="mb-3">
          <Button variant="outline" onClick={() => setNewService(true)}>
            <PlusIcon />
            Ders türü ekle
          </Button>
        </div>

        {services.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Henüz ders türü yok. İlk dersi oluşturabilmek için en az bir tane gerekiyor.
          </p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            {services.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    {s.name}
                    {s.active ? null : (
                      <Badge className="bg-muted text-muted-foreground">Kapalı</Badge>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {CATEGORY[s.category] ?? s.category} · iptal penceresi{' '}
                    {s.cancellationWindowHours === null
                      ? 'stüdyo varsayılanı'
                      : `${s.cancellationWindowHours} saat`}{' '}
                    · en fazla {s.maxDaysInAdvance} gün önceden
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => void toggleService(s)}>
                  {s.active ? 'Kapat' : 'Aç'}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Salonlar" hint="Bir dersin kontenjanı, yapıldığı salonun kapasitesini aşamaz.">
        <div className="mb-3">
          <Button variant="outline" disabled={!branchId} onClick={() => setNewRoom(true)}>
            <PlusIcon />
            Salon ekle
          </Button>
        </div>

        {rooms.length === 0 ? (
          <p className="text-sm text-muted-foreground">Henüz salon yok.</p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            {rooms.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    {r.name}
                    {r.active ? null : (
                      <Badge className="bg-muted text-muted-foreground">Kapalı</Badge>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">{r.capacity} kişilik</p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => void toggleRoom(r)}>
                  {r.active ? 'Kapat' : 'Aç'}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* ── SALON NOTLARI ───────────────────────────────────────────────────────────────────
          Reception's whiteboard: an operational annotation about a room ("Reformer 3 arızalı",
          "Salon B bugün 14:00–16:00 bakımda"). Active notes appear as a banner above the Ders
          Ajandası. Not a domain event — a lightweight operational note. */}
      <Section
        title="Salon Notları"
        hint="Bir salonla ilgili geçici uyarı — arıza, bakım, kapalı saat. Aktif notlar Ders Ajandası'nın üstünde görünür."
      >
        <div className="mb-3">
          <Button variant="outline" disabled={activeRooms.length === 0} onClick={() => setNewNote(true)}>
            <PlusIcon />
            Not ekle
          </Button>
        </div>

        {notes.length === 0 ? (
          <p className="text-sm text-muted-foreground">Henüz salon notu yok.</p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            {notes.map((n) => (
              <li key={n.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    {n.roomName}
                    {n.active ? null : <Badge className="bg-muted text-muted-foreground">Kapalı</Badge>}
                  </p>
                  <p className="text-xs text-muted-foreground">{n.text}</p>
                </div>
                {n.active ? (
                  <Button variant="ghost" size="sm" onClick={() => void resolveNote(n)}>
                    Kapat
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* ── KASALAR (hotfix B-2) ────────────────────────────────────────────────────────────
          A studio started with no till and NOTHING could make one — so reception could take no cash
          at all: every cash sale was refused with `drawer_required`, correctly, and for ever. */}
      <Section
        title="Kasalar"
        hint="Nakit, açık bir kasa olmadan alınamaz — ve alınmamalı: masada alınan ama hiçbir kasaya girmeyen para, gün sonu sayımının asla açıklayamadığı paradır."
      >
        <div className="mb-3">
          <Button variant="outline" disabled={!branchId} onClick={() => setNewDrawer(true)}>
            <PlusIcon />
            Kasa ekle
          </Button>
        </div>

        {drawers.length === 0 ? (
          <p className="text-sm text-danger">
            <strong>Henüz kasa yok.</strong> Bir kasa oluşturmadan nakit tahsilat yapılamaz.
          </p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            {drawers.map((d) => (
              <li key={d.id} className={`flex flex-wrap items-center justify-between gap-2 px-3 py-3 ${d.active ? '' : 'opacity-60'}`}>
                {renamingId === d.id ? (
                  <div className="flex flex-1 flex-wrap items-center gap-2">
                    <Input value={drawerName} onChange={(e) => setDrawerName(e.target.value)} className="h-8 max-w-56" autoFocus />
                    <Button size="sm" onClick={() => void saveRename(d.id)}>
                      Kaydet
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setRenamingId(null)}>
                      Vazgeç
                    </Button>
                  </div>
                ) : (
                  <>
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 text-sm font-medium">
                        {d.name}
                        {d.active ? null : (
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">Arşivli</span>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {d.kind === 'cash' ? 'Nakit' : 'POS'} · {d.status === 'open' ? 'açık' : 'kapalı'}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button size="sm" variant="ghost" onClick={() => { setRenamingId(d.id); setDrawerName(d.name) }}>
                        Düzenle
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => void toggleArchive(d)}>
                        {d.active ? 'Arşivle' : 'Geri Al'}
                      </Button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          Kasa <strong>kapalı</strong> doğar. Günlük açılış ve gün sonu sayımı <strong>Kasa</strong>{' '}
          ekranından yapılır.
        </p>
      </Section>

      {/* Ürünler (Retail) — Plus Phase 6. Physical items sold alongside packages. */}
      <RetailPanel canManage={canManage} />

      {newDrawer && branchId ? (
        <DrawerDialog
          branchId={branchId}
          onClose={() => setNewDrawer(false)}
          onDone={() => {
            setNewDrawer(false)
            void load()
          }}
        />
      ) : null}

      {newNote ? (
        <RoomNoteDialog
          rooms={activeRooms}
          onClose={() => setNewNote(false)}
          onDone={() => {
            setNewNote(false)
            void load()
          }}
        />
      ) : null}

      {newService ? (
        <ServiceDialog
          onClose={() => setNewService(false)}
          onDone={() => {
            setNewService(false)
            void load()
          }}
        />
      ) : null}

      {newRoom && branchId ? (
        <RoomDialog
          branchId={branchId}
          onClose={() => setNewRoom(false)}
          onDone={() => {
            setNewRoom(false)
            void load()
          }}
        />
      ) : null}
    </div>
  )
}

function ServiceDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState('')
  const [category, setCategory] = useState('pilates_group')
  const [windowHours, setWindowHours] = useState('')
  const [maxDays, setMaxDays] = useState('14')
  const [selfBooking, setSelfBooking] = useState(false)
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    try {
      const res = await createServiceAction({
        name: name.trim(),
        category,
        policy: {
          maxDaysInAdvance: Number(maxDays) || 14,
          // Empty ⇒ inherit the studio default (D14, level 3 of the chain). It is NOT zero: a service
          // that inherits and a service with a zero-hour window are different things, and writing one
          // as the other would let members cancel a class as it starts.
          cancellationWindowHours: windowHours.trim() === '' ? null : Number(windowHours),
          lateCancellationConsumesCredit: true,
          noShowConsumesCredit: false,
          attendanceDefaultOutcome: 'attended',
          autoResolveAfterMinutes: 15,
          allowMemberSelfBooking: selfBooking,
        },
      })
      if (!res.ok) {
        toast.error(domainErrorMessage(res.error))
        setBusy(false)
        return
      }
      toast.success('Ders türü eklendi.')
      onDone()
    } catch {
      toast.error('Kaydedilemedi.')
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Ders türü ekle</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <Input placeholder="Ad (ör. Reformer)" value={name} onChange={(e) => setName(e.target.value)} />

          <div>
            <Select value={category} onValueChange={(v) => setCategory(v ?? 'pilates_group')}>
              <SelectTrigger>
                <SelectValue>{CATEGORY[category]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {Object.entries(CATEGORY).map(([id, label]) => (
                  <SelectItem key={id} value={id}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-1 text-xs text-muted-foreground">
              Kategori <strong>sonradan değiştirilemez</strong>: hangi paketin bu dersi açtığı buna
              bağlı.
            </p>
          </div>

          <Input
            type="number"
            min={0}
            placeholder="İptal penceresi (saat) — boş bırakırsanız stüdyo varsayılanı"
            value={windowHours}
            onChange={(e) => setWindowHours(e.target.value)}
          />
          <Input
            type="number"
            min={0}
            placeholder="En fazla kaç gün önceden rezervasyon"
            value={maxDays}
            onChange={(e) => setMaxDays(e.target.value)}
          />

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={selfBooking}
              onChange={(e) => setSelfBooking(e.target.checked)}
            />
            Üyeler bu dersi uygulamadan kendileri rezerve edebilsin
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Vazgeç
          </Button>
          <Button disabled={busy || name.trim().length === 0} onClick={() => void submit()}>
            Ekle
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RoomDialog({
  branchId,
  onClose,
  onDone,
}: {
  branchId: string
  onClose: () => void
  onDone: () => void
}) {
  const [name, setName] = useState('')
  const [capacity, setCapacity] = useState('8')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    try {
      const res = await createRoomAction({
        branchId,
        name: name.trim(),
        capacity: Number(capacity) || 1,
      })
      if (!res.ok) {
        toast.error(domainErrorMessage(res.error))
        setBusy(false)
        return
      }
      toast.success('Salon eklendi.')
      onDone()
    } catch {
      toast.error('Kaydedilemedi.')
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Salon ekle</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <Input
            placeholder="Ad (ör. Reformer Salonu)"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Input
            type="number"
            min={1}
            placeholder="Kapasite"
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Vazgeç
          </Button>
          <Button disabled={busy || name.trim().length === 0} onClick={() => void submit()}>
            Ekle
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}


function RoomNoteDialog({
  rooms,
  onClose,
  onDone,
}: {
  rooms: readonly RoomRow[]
  onClose: () => void
  onDone: () => void
}) {
  const [roomId, setRoomId] = useState(rooms[0]?.id ?? '')
  const [text, setText] = useState('')
  // Optional maintenance window. datetime-local is read in the browser's local time (Türkiye = IST
  // in practice); the banner compares epoch-ms, so the comparison is timezone-independent.
  const [startsAt, setStartsAt] = useState('')
  const [endsAt, setEndsAt] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    try {
      const res = await createRoomNoteAction({
        roomId,
        text: text.trim(),
        startsAt: startsAt ? new Date(startsAt).getTime() : null,
        endsAt: endsAt ? new Date(endsAt).getTime() : null,
      })
      if (!res.ok) {
        toast.error('Not eklenemedi.')
        setBusy(false)
        return
      }
      toast.success('Salon notu eklendi.')
      onDone()
    } catch {
      toast.error('Kaydedilemedi.')
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Salon notu ekle</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <Select value={roomId} onValueChange={(v) => setRoomId(v ?? '')}>
            <SelectTrigger>
              <SelectValue>
                {(v: unknown) => (typeof v === 'string' ? (rooms.find((r) => r.id === v)?.name ?? 'Salon seç') : 'Salon seç')}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {rooms.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Textarea placeholder="Not (ör. Reformer 3 arızalı, kullanmayın)" value={text} onChange={(e) => setText(e.target.value)} />

          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Başlangıç (opsiyonel)
              <Input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Bitiş (opsiyonel)
              <Input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
            </label>
          </div>
          <p className="text-xs text-muted-foreground">Bitiş verilirse, o saatten sonra not otomatik gizlenir.</p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Vazgeç
          </Button>
          <Button disabled={busy || roomId === '' || text.trim().length === 0} onClick={() => void submit()}>
            Ekle
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DrawerDialog({
  branchId,
  onClose,
  onDone,
}: {
  branchId: string
  onClose: () => void
  onDone: () => void
}) {
  const [name, setName] = useState('Merkez Kasa')
  const [kind, setKind] = useState<'cash' | 'pos'>('cash')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    try {
      const res = await createDrawerAction({ branchId, name: name.trim(), kind })
      if (!res.ok) {
        toast.error(domainErrorMessage(res.error))
        setBusy(false)
        return
      }
      toast.success('Kasa oluşturuldu.')
      onDone()
    } catch {
      toast.error('Kaydedilemedi.')
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Kasa ekle</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <Input placeholder="Ad (ör. Merkez Kasa)" value={name} onChange={(e) => setName(e.target.value)} />

          <Select value={kind} onValueChange={(v) => setKind((v as 'cash' | 'pos') ?? 'cash')}>
            <SelectTrigger>
              <SelectValue>{kind === 'cash' ? 'Nakit' : 'POS'}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="cash">Nakit</SelectItem>
              <SelectItem value="pos">POS</SelectItem>
            </SelectContent>
          </Select>

          <p className="text-xs text-muted-foreground">
            Kasa <strong>kapalı</strong> olarak oluşturulur. İçindeki parayı, açarken siz sayarsınız —
            gün sonu farkı bu sayıya göre hesaplanır.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Vazgeç
          </Button>
          <Button disabled={busy || name.trim().length === 0} onClick={() => void submit()}>
            Ekle
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
