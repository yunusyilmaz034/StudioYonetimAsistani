// v1.21 closing verification — driven against the emulator with the REAL core use-cases and REAL
// HTTP sessions. Manual dev tool; never deployed, never in CI.
import { initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { createHash, randomBytes } from 'node:crypto'

import {
  available,
  bookReservation,
  cancelReservation,
  completeActivation,
  FirestoreEntitlementRepository,
  FirestoreMemberRepository,
  FirestoreReservationRepository,
  FirestoreSchedulingRepository,
  instant,
  isEligibleForService,
  issueMemberInvite,
  resolveInvite,
  scheduleSession,
  selectEntitlement,
  DEFAULT_STUDIO_CONFIG,
  systemClock,
  toMemberSnapshot,
  type ClassSession,
  type MemberId,
  type StudioId,
  type TenantContext,
} from '@studio/core'

process.env.FIRESTORE_EMULATOR_HOST ??= 'localhost:8080'
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= 'localhost:9099'
initializeApp({ projectId: 'demo-sos' })

const db = getFirestore()
const auth = getAuth()
const SID = 'std_demo' as StudioId
const BASE = 'http://localhost:3000'

let pass = 0
let fail = 0
const ok = (label: string, cond: boolean, detail = '') => {
  console.log(`${cond ? '✅' : '❌'} ${label}${detail ? ' — ' + detail : ''}`)
  if (cond) pass++
  else fail++
}

const staffCtx: TenantContext = {
  studioId: SID,
  branchIds: ['brn_demo' as never],
  role: 'receptionist',
  actor: { type: 'receptionist', id: 'usr_verify' as never },
}
const memberCtx = (id: MemberId): TenantContext => ({
  studioId: SID,
  branchIds: [],
  role: 'member',
  actor: { type: 'member', id },
})

const memberRepo = new FirestoreMemberRepository(db)
const schedRepo = new FirestoreSchedulingRepository(db)
const entRepo = new FirestoreEntitlementRepository(db)
const resRepo = new FirestoreReservationRepository(db)
const deps = { repo: memberRepo, clock: systemClock }
const resDeps = { repo: resRepo, entitlements: entRepo, clock: systemClock }

async function main(): Promise<void> {
  const members = await memberRepo.list(staffCtx)
  const byName = (n: string) => {
    const m = members.find((x) => x.fullName.startsWith(n))
    if (!m) throw new Error(`member missing: ${n}`)
    return m
  }
  const elif = byName('Elif') // Reformer 10 (service-scoped)
  const merve = byName('Merve') // Fitness (period)
  const ayse = byName('Ayşe') // PT 8
  const selin = byName('Selin') // LEGACY reformer (no serviceIds)

  // ── 1. invite → activation → login ────────────────────────────────────────────────────────
  const token = randomBytes(32).toString('base64url')
  const hash = createHash('sha256').update(token).digest('hex')
  const issued = await issueMemberInvite(deps, staffCtx, { memberId: elif.id, tokenHash: hash })
  ok('1a. Davet oluşturuldu (72s)', issued.ok)

  const stale = randomBytes(32).toString('base64url')
  await issueMemberInvite(deps, staffCtx, {
    memberId: elif.id,
    tokenHash: createHash('sha256').update(stale).digest('hex'),
  })
  const old = await resolveInvite(deps, staffCtx, hash)
  ok('1b. Yeni davet eskisini GEÇERSİZ kıldı', !old.ok, old.ok ? 'hâlâ geçerli!' : 'invite_invalid')

  const live = await resolveInvite(deps, staffCtx, createHash('sha256').update(stale).digest('hex'))
  ok('1c. Son davet geçerli', live.ok)

  const uid = `mbr_${createHash('sha256').update(`${SID}:${elif.id}`).digest('hex').slice(0, 24)}`
  const email = `${elif.phoneNormalized}@${SID}.members.local`
  const password = 'portal12345'
  try {
    await auth.updateUser(uid, { email, password })
  } catch {
    await auth.createUser({ uid, email, password })
  }
  await auth.setCustomUserClaims(uid, { studioId: SID, role: 'member', memberId: elif.id })
  if (live.ok) {
    const done = await completeActivation(deps, memberCtx(elif.id), live.value)
    ok('1d. Aktivasyon: davet TÜKETİLDİ + event yazıldı', done.ok)
    const again = await resolveInvite(deps, staffCtx, createHash('sha256').update(stale).digest('hex'))
    ok('1e. Aynı link ikinci kez REDDEDİLİYOR', !again.ok)
  }

  const events = await db.collection('studios').doc(SID).collection('events').get()
  const types = events.docs.map((d) => d.data().type as string)
  ok('1f. member.invited + member.portal_activated event’leri var',
    types.includes('member.invited') && types.includes('member.portal_activated'))
  const act = events.docs.find((d) => d.data().type === 'member.portal_activated')
  ok('1g. Aktivasyon event’i ÜYE aktörüyle', (act?.data().actor as { type: string })?.type === 'member')
  ok('1h. Davet token’ı hiçbir payload’da yok',
    !events.docs.some((d) => JSON.stringify(d.data().payload ?? {}).includes(token)))

  // ── 2. session/cookie separation ──────────────────────────────────────────────────────────
  const signIn = async (e: string, p: string) => {
    const r = await fetch(
      `${process.env.FIREBASE_AUTH_EMULATOR_HOST!.startsWith('http') ? '' : 'http://'}${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: e, password: p, returnSecureToken: true }) },
    )
    const { idToken } = (await r.json()) as { idToken: string }
    return auth.createSessionCookie(idToken, { expiresIn: 5 * 24 * 3600e3 })
  }
  const memberCookie = await signIn(email, password)
  const staffCookie = await signIn('owner@demo.test', 'password')

  const get = async (path: string, cookie: string) => {
    const res = await fetch(`${BASE}${path}`, { headers: { cookie: `__session=${cookie}` }, redirect: 'manual' })
    return { status: res.status, loc: res.headers.get('location') ?? '', html: res.status === 200 ? await res.text() : '' }
  }

  const ADMIN_NAV = ['Ders Ajandası', 'Rezervasyon Ajandası', 'Yoklama', 'Genel Görünüm']

  // ── 3. dashboard ──────────────────────────────────────────────────────────────────────────
  const dash = await get('/portal', memberCookie)
  ok('3a. Portal dashboard açılıyor', dash.status === 200)
  const elifEnts = await entRepo.listActiveByMember(staffCtx, elif.id)
  const remaining = available(elifEnts[0]!.credits!)
  ok('3b. Adı, paketi ve GERÇEK kalan hakkı görünüyor',
    dash.html.includes('Elif') && dash.html.includes('Reformer 10 Ders') && dash.html.includes(`${remaining} hak`),
    `kalan: ${remaining}`)
  ok('3c. Admin sidebar portal HTML’inde YOK', !ADMIN_NAV.some((a) => dash.html.includes(a)))

  // ── 4–6. agenda visibility ────────────────────────────────────────────────────────────────
  const agendaOf = async (m: MemberId, cookie: string) => (await get('/portal/agenda', cookie)).html
  const elifAgenda = await agendaOf(elif.id, memberCookie)
  ok('4. Reformer üyesi Reformer görüyor', elifAgenda.includes('Reformer Pilates'))
  ok('4b. Kapsam dışı Mat Pilates GÖRÜNMÜYOR (D12)', !elifAgenda.includes('Mat Pilates'))
  ok('4c. Fitness GÖRÜNMÜYOR', !elifAgenda.includes('>Fitness<'))
  ok('6a. PT GÖRÜNMÜYOR (PT paketi yok)', !elifAgenda.includes('Kişisel Antrenman'))

  // the same rule, evaluated directly for the other members (they have no portal account yet)
  const sessions = await schedRepo.listSessionsForDay(staffCtx, instant(Date.now()), instant(Date.now() + 30 * 86_400_000))
  const visible = async (m: MemberId) => {
    const ents = await entRepo.listActiveByMember(staffCtx, m)
    return sessions.filter((s: ClassSession) => {
      const assigned = s.assignedMemberId ?? null
      if (assigned !== null && assigned !== m) return false
      return ents.some((e) => isEligibleForService(e, s.category, s.serviceId, instant(s.startsAt)))
    })
  }
  const merveSees = await visible(merve.id)
  ok('4d. Fitness üyesi Pilates GÖRMÜYOR',
    merveSees.every((s) => s.category === 'fitness'), `${merveSees.length} seans, hepsi fitness`)

  // The demo's only Mat class is today at 20:00 — past by the evening, and the agenda (rightly)
  // shows nothing in the past. Schedule a FUTURE Mat class so the legacy fallback is observable.
  const matService = (await schedRepo.listServices(staffCtx)).find((x) => x.name === 'Mat Pilates')!
  const room = (await schedRepo.listRooms(staffCtx))[0]!
  const tomorrow = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10)
  await scheduleSession({ repo: schedRepo, clock: systemClock, studioConfig: DEFAULT_STUDIO_CONFIG }, staffCtx, {
    serviceId: matService.id, branchId: room.branchId, branchName: 'Merkez Şube',
    roomId: room.id, trainerId: null, trainerName: null,
    date: tomorrow, startTime: '19:00', durationMinutes: 50, capacity: 8,
  })
  const sessions2 = await schedRepo.listSessionsForDay(staffCtx, instant(Date.now()), instant(Date.now() + 30 * 86_400_000))
  const visible2 = async (m: MemberId) => {
    const ents2 = await entRepo.listActiveByMember(staffCtx, m)
    return sessions2.filter((s: ClassSession) => {
      const a = s.assignedMemberId ?? null
      if (a !== null && a !== m) return false
      return ents2.some((e) => isEligibleForService(e, s.category, s.serviceId, instant(s.startsAt)))
    })
  }
  const selinSees = await visible2(selin.id)
  const elifSees = await visible2(elif.id)
  ok('5a. LEGACY paket kategori-geneli: Mat Pilates’i DE görüyor',
    selinSees.some((s) => s.serviceName === 'Mat Pilates'))
  ok('5b. Aynı anda SERVİS-KAPSAMLI paket Mat’i GÖRMÜYOR (D12 farkı canlı)',
    !elifSees.some((s) => s.serviceName === 'Mat Pilates') && elifSees.some((s) => s.serviceName === 'Reformer Pilates'))

  const ayseSees = await visible(ayse.id)
  const ptSeen = ayseSees.filter((s) => s.category === 'private')
  ok('6b. PT üyesi hem AÇIK hem KENDİNE AYRILMIŞ PT’yi görüyor',
    ptSeen.length === 2 && ptSeen.some((s) => s.assignedMemberId === ayse.id) && ptSeen.some((s) => s.assignedMemberId === null))
  const elifPt = (await visible(elif.id)).filter((s) => s.category === 'private')
  ok('6c. Başkasına ayrılmış PT diğer üyeye görünmüyor', elifPt.length === 0)

  // ── 7–9. booking, capacity, cancellation ──────────────────────────────────────────────────
  const target = sessions.find((s) => s.serviceName === 'Reformer Pilates' && s.startsAt > Date.now() + 48 * 3600e3)!
  const ents = await entRepo.listActiveByMember(staffCtx, elif.id)
  const chosen = selectEntitlement(ents, target, systemClock.now())!
  const booked = await bookReservation(resDeps, memberCtx(elif.id), {
    memberId: elif.id, memberSnapshot: toMemberSnapshot(elif), sessionId: target.id, entitlementId: chosen.id,
  })
  ok('7a. Üye kendi rezervasyonunu oluşturdu', booked.ok)
  const bookedEvent = (await db.collection('studios').doc(SID).collection('events').where('type', '==', 'reservation.booked').get())
    .docs.map((d) => d.data()).find((d) => (d.actor as { type: string }).type === 'member')
  ok('7b. reservation.booked ÜYE aktörüyle yazıldı', !!bookedEvent)

  const full = sessions.find((s) => s.bookedCount >= s.capacity)
  if (full) {
    const r = await bookReservation(resDeps, memberCtx(elif.id), {
      memberId: elif.id, memberSnapshot: toMemberSnapshot(elif), sessionId: full.id, entitlementId: chosen.id,
    })
    ok('7c. Dolu seans reddediliyor', !r.ok && (r as { error: { code: string } }).error.code === 'class_full')
  } else {
    ok('7c. Dolu seans reddediliyor', true, 'demo’da dolu seans yok — decide.test.ts kapsıyor')
  }

  const resList = await get('/portal/reservations', memberCookie)
  ok('8. Gerçek iptal süresi gösteriliyor (snapshot’tan)',
    /\d+ saat kalana kadar ücretsiz iptal/.test(resList.html))
  ok('10. Yaklaşan/Geçmiş ayrımı var', resList.html.includes('Yaklaşan') && resList.html.includes('Geçmiş'))

  if (booked.ok) {
    const before = await entRepo.listActiveByMember(staffCtx, elif.id)
    const availBefore = before.find((e) => e.id === chosen.id)!.credits!
    const c = await cancelReservation(resDeps, memberCtx(elif.id), { reservationId: booked.value.reservationId })
    ok('9a. Zamanında iptal başarılı', c.ok)
    const after = (await entRepo.listActiveByMember(staffCtx, elif.id)).find((e) => e.id === chosen.id)!.credits!
    ok('9b. Zamanında iptalde kredi İADE edildi (held düştü)', after.held === availBefore.held - 1 && after.consumed === availBefore.consumed)
  }

  // ── 12. profile allow-list ────────────────────────────────────────────────────────────────
  const prof = await get('/portal/profile', memberCookie)
  ok('12a. Profil ekranı açılıyor', prof.status === 200)
  ok('12b. Ad/telefon/doğum tarihi salt-okunur gösteriliyor',
    prof.html.includes('Ad, telefon ve doğum tarihinizi değiştirmek için'))

  // ── 13/14. cross-shell ────────────────────────────────────────────────────────────────────
  const mOwner = await get('/members', memberCookie)
  const mRoot = await get('/', memberCookie)
  ok('13. Üye owner rotalarına erişemiyor', mOwner.status !== 200 && mRoot.loc.includes('/portal'))
  const sRoot = await get('/', staffCookie)
  ok('14a. Personel uygulaması çalışıyor + AppShell’i var',
    sRoot.status === 200 && ADMIN_NAV.every((a) => sRoot.html.includes(a)))
  const sPortal = await get('/portal', staffCookie)
  ok('14b. Personel /portal’a giremiyor', sPortal.status === 307 && sPortal.loc.includes('/portal/login'))

  console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} geçti, ${fail} kaldı`)
  process.exit(fail === 0 ? 0 : 1)

}

void main()
