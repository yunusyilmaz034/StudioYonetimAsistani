// v1.25 Notification Center — proven end to end against the emulator.
//
// What must be true:
//   • Event → Intent → Delivery Attempt, with the channels INDEPENDENT of each other
//   • in_app is delivered (it is a write to our own database) while e-mail is merely `sent`
//   • a member's preference suppresses a channel BY NAME — and can never suppress in_app
//   • a bulk act collapses to ONE intent per (member, operation, template) — not twelve messages
//   • a transient failure queues a retry with a backoff; a PERMANENT one never retries
//   • I-38: the rendered body and the member's address NEVER enter the event log
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

import {
  collapsedIntentId,
  ConsoleEmailProvider,
  DEFAULT_NOTIFICATION_SETTINGS,
  DEFAULT_PREFS,
  FirestoreMemberRepository,
  FirestoreNotificationRepository,
  InAppProvider,
  intentIdFor,
  MockSmsProvider,
  notify,
  sweepRetries,
  systemClock,
  type NotificationDeps,
  type NotificationPrefs,
  type RecipientRef,
  type StudioId,
  type TenantContext,
} from '@studio/core'

process.env.FIRESTORE_EMULATOR_HOST ??= 'localhost:8080'
initializeApp({ projectId: 'demo-sos' })
const db = getFirestore()

const SID = 'std_demo' as StudioId
const ctx: TenantContext = {
  studioId: SID,
  branchIds: [],
  role: 'owner',
  actor: { type: 'system', id: 'verify_notify' as never },
}

const repo = new FirestoreNotificationRepository(db)
const members = new FirestoreMemberRepository(db)

let pass = 0
let fail = 0
const ok = (l: string, c: boolean, d = ''): void => {
  console.log(`${c ? '✅' : '❌'} ${l}${d ? ' — ' + d : ''}`)
  if (c) pass++
  else fail++
}

// The verification runs at whatever hour someone types `pnpm`. Quiet hours are REAL — at 02:00 a
// NORMAL message is supposed to sit in the queue until 08:00, and a test that ignored that would be
// testing a system we did not build. So: most checks run with quiet hours OFF (from === to ⇒ the
// window is empty), and quiet hours get their own explicit check below.
const AWAKE = { ...DEFAULT_NOTIFICATION_SETTINGS, quietFromHour: 3, quietToHour: 3 }

const deps = (
  prefs: NotificationPrefs = DEFAULT_PREFS,
  smsBehaviour?: 'ok' | 'transient' | 'permanent',
  quiet = false,
): NotificationDeps => ({
  repo,
  clock: systemClock,
  providers: [
    new InAppProvider(db),
    new ConsoleEmailProvider(),
    ...(smsBehaviour ? [new MockSmsProvider(smsBehaviour)] : []),
  ],
  settings: {
    ...(quiet ? { ...DEFAULT_NOTIFICATION_SETTINGS, quietFromHour: 0, quietToHour: 23 } : AWAKE),
    enabledChannels: smsBehaviour ? ['in_app', 'email', 'sms'] : ['in_app', 'email'],
  },
  utcOffsetMinutes: 180,
  loadPrefs: async () => prefs,
})

async function main(): Promise<void> {
  const all = await members.list(ctx)
  const member = all[0]!
  const uniq = String(Date.now()).slice(-6)

  const recipient: RecipientRef = {
    kind: 'member',
    id: member.id as string,
    email: 'uye@example.com',
    phone: member.phone as string,
    displayName: member.fullName,
  }

  const params = {
    memberName: member.fullName,
    sessionName: 'Reformer Pilates',
    sessionTime: '20.07.2026 09:00',
  }

  // ── 1. Event → Intent → Attempts, one per channel. ────────────────────────────────────────
  const eventId = `evt_v125_${uniq}`
  const intentId = intentIdFor(eventId, 'booking_confirmed', recipient.id)
  const created = await notify(deps(), ctx, {
    intentId,
    eventId,
    eventType: 'reservation.booked',
    operationId: `cor_v125_${uniq}`,
    templateId: 'booking_confirmed',
    recipient,
    params,
  })
  ok('Intent oluşturuldu ve dağıtıldı', created.ok && created.value.created)

  const attempts = await repo.listAttemptsByIntent(ctx, intentId)
  const inApp = attempts.find((a) => a.channel === 'in_app')!
  const email = attempts.find((a) => a.channel === 'email')!
  ok('Her kanal için AYRI bir deneme kaydı var', attempts.length === 2, attempts.map((a) => a.channel).join(', '))
  ok(
    'in_app "delivered" — kendi veritabanımıza yazdık, dürüstçe iddia edebiliyoruz',
    inApp.status === 'delivered',
    inApp.status,
  )
  ok(
    'e-posta yalnızca "sent" — teslim iddiası sağlayıcıdan gelir, bizden değil',
    email.status === 'sent',
    email.status,
  )

  const inbox = await repo.listInbox(ctx, recipient.id)
  ok(
    'Üyenin gelen kutusuna düştü (kapatılamayan kanal)',
    inbox.some((m) => m.intentId === intentId),
    inbox[0]?.subject ?? '—',
  )

  // ── 2. IDEMPOTENT — aynı event tekrar teslim edilirse ikinci bildirim YOK. ─────────────────
  const again = await notify(deps(), ctx, {
    intentId,
    eventId,
    eventType: 'reservation.booked',
    operationId: `cor_v125_${uniq}`,
    templateId: 'booking_confirmed',
    recipient,
    params,
  })
  ok(
    'Aynı event yeniden teslim edildi → İKİNCİ bildirim oluşmadı',
    again.ok && !again.value.created,
    'tekrarlanan bir bildirim, eksik olandan kötüdür',
  )

  // ── 3. Tercih: üye e-posta istemiyor → kanal ADIYLA bastırılır, in_app yine gider. ─────────
  const prefIntentId = intentIdFor(`${eventId}_pref`, 'booking_confirmed', recipient.id)
  await notify(deps({ ...DEFAULT_PREFS, email: false }), ctx, {
    intentId: prefIntentId,
    eventId: `${eventId}_pref`,
    eventType: 'reservation.booked',
    operationId: `cor_v125b_${uniq}`,
    templateId: 'booking_confirmed',
    recipient,
    params,
  })
  const prefIntent = (await repo.getIntent(ctx, prefIntentId))!
  ok(
    'Üye e-posta istemiyor → yalnızca in_app kanalı kaldı',
    prefIntent.channels.length === 1 && prefIntent.channels[0] === 'in_app',
    prefIntent.channels.join(', '),
  )
  const suppressedEvents = await db
    .collection(`studios/${SID}/events`)
    .where('type', '==', 'notification.suppressed')
    .get()
  ok(
    'Bastırma bir EVENT — sessiz bastırma, hatadan ayırt edilemez',
    suppressedEvents.size > 0,
    `${suppressedEvents.size} kayıt`,
  )

  // ── 4. TOPLU İŞLEM BİRLEŞTİRME — 12 iptal = 1 mesaj (ve 1 SMS ücreti). ────────────────────
  const opId = `cor_v125_bulk_${uniq}`
  let createdCount = 0
  for (let i = 0; i < 12; i++) {
    const r = await notify(deps(), ctx, {
      intentId: collapsedIntentId(opId, 'closure_applied', recipient.id),
      eventId: `evt_bulk_${uniq}_${i}`,
      eventType: 'studio_closure.applied',
      operationId: opId,
      templateId: 'closure_applied',
      recipient,
      params: { memberName: member.fullName, reason: 'Kurban Bayramı', sessionCount: '12' },
    })
    if (r.ok && r.value.created) createdCount++
  }
  ok(
    'Bir kapanışın 12 event’i TEK mesaja indi (12 SMS ücreti değil)',
    createdCount === 1,
    `${createdCount} intent`,
  )

  // ── 5. RETRY — geçici hata kuyruğa alır, kalıcı hata asla yeniden denenmez. ────────────────
  const transientId = intentIdFor(`${eventId}_sms_t`, 'booking_confirmed', recipient.id)
  await notify(deps(DEFAULT_PREFS, 'transient'), ctx, {
    intentId: transientId,
    eventId: `${eventId}_sms_t`,
    eventType: 'reservation.booked',
    operationId: `cor_v125c_${uniq}`,
    templateId: 'booking_confirmed',
    recipient,
    params,
  })
  const smsTransient = (await repo.listAttemptsByIntent(ctx, transientId)).find((a) => a.channel === 'sms')!
  ok(
    'Geçici SMS hatası → kuyrukta, backoff ile',
    smsTransient.status === 'queued' && smsTransient.nextRetryAt !== null,
    `${smsTransient.status} · ${smsTransient.error?.code}`,
  )

  const permanentId = intentIdFor(`${eventId}_sms_p`, 'booking_confirmed', recipient.id)
  await notify(deps(DEFAULT_PREFS, 'permanent'), ctx, {
    intentId: permanentId,
    eventId: `${eventId}_sms_p`,
    eventType: 'reservation.booked',
    operationId: `cor_v125d_${uniq}`,
    templateId: 'booking_confirmed',
    recipient,
    params,
  })
  const smsPermanent = (await repo.listAttemptsByIntent(ctx, permanentId)).find((a) => a.channel === 'sms')!
  ok(
    'Kalıcı SMS hatası → ASLA yeniden denenmez (tahmine para harcanmaz)',
    smsPermanent.status === 'failed' && smsPermanent.nextRetryAt === null,
    `${smsPermanent.status} · ${smsPermanent.error?.code}`,
  )

  const swept = await sweepRetries(deps(DEFAULT_PREFS, 'ok'), ctx)
  ok('Retry süpürgesi kuyruktakileri yeniden denedi', swept.retried > 0, `${swept.retried} deneme`)

  // ── 5b. SESSİZ SAAT — öncelik karar verir (owner, karar 4). ────────────────────────────────
  const quietId = intentIdFor(`${eventId}_quiet`, 'booking_confirmed', recipient.id)
  await notify(deps(DEFAULT_PREFS, undefined, true), ctx, {
    intentId: quietId,
    eventId: `${eventId}_quiet`,
    eventType: 'reservation.booked',
    operationId: `cor_v125e_${uniq}`,
    templateId: 'booking_confirmed', // NORMAL
    recipient,
    params,
  })
  const quietEmail = (await repo.listAttemptsByIntent(ctx, quietId)).find((a) => a.channel === 'email')!
  ok(
    'Sessiz saatte NORMAL öncelikli mesaj KUYRUKTA bekliyor',
    quietEmail.status === 'queued',
    quietEmail.status,
  )

  const urgentId = intentIdFor(`${eventId}_urgent`, 'session_cancelled', recipient.id)
  await notify(deps(DEFAULT_PREFS, undefined, true), ctx, {
    intentId: urgentId,
    eventId: `${eventId}_urgent`,
    eventType: 'class_session.cancelled',
    operationId: `cor_v125f_${uniq}`,
    templateId: 'session_cancelled', // URGENT — "yarınki dersiniz iptal edildi" 08:00'i bekleyemez
    recipient,
    params,
  })
  const urgentEmail = (await repo.listAttemptsByIntent(ctx, urgentId)).find((a) => a.channel === 'email')!
  ok(
    'Sessiz saatte URGENT mesaj BEKLEMEDEN gitti (ders iptali)',
    urgentEmail.status === 'sent',
    urgentEmail.status,
  )

  // ── 6. I-38 — gövde ve adres event log’una GİRMEZ. ────────────────────────────────────────
  const notifEvents = await db
    .collection(`studios/${SID}/events`)
    .where('type', 'in', [
      'notification.intent_created',
      'notification.sent',
      'notification.delivered',
      'notification.failed',
      'notification.suppressed',
    ])
    .get()
  const payloads = JSON.stringify(notifEvents.docs.map((d) => d.data().payload))
  ok(
    'I-38: mesaj METNİ event log’unda YOK',
    !payloads.includes('Merhaba') && !payloads.includes('rezervasyonunuz'),
    `${notifEvents.size} bildirim event’i tarandı`,
  )
  ok(
    'I-38: üyenin e-postası ve telefonu event log’unda YOK',
    !payloads.includes('uye@example.com') && !payloads.includes(String(member.phone)),
    'kimlik intent’te yaşar, log’da değil',
  )

  console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} geçti, ${fail} kaldı`)
  process.exit(fail === 0 ? 0 : 1)
}

void main()
