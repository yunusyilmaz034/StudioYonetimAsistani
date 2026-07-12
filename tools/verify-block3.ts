// Block 3 (v1.22) — the Operations Center, proven against the emulator.
//
// What must be true:
//   • every timeline query returns the aggregate's real history, in order
//   • one OperationId gathers every event of one act (OP-2), across aggregates
//   • the presenter has a Turkish sentence for every event the studio actually produced —
//     no technical event name can reach a screen
//   • the log still contains NO PII (#6): the audit's before/after never carries a name or phone
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

process.env.FIRESTORE_EMULATOR_HOST ??= 'localhost:8080'
initializeApp({ projectId: 'demo-sos' })
const db = getFirestore()

const SID = 'std_demo'

let pass = 0
let fail = 0
const ok = (l: string, c: boolean, d = ''): void => {
  console.log(`${c ? '✅' : '❌'} ${l}${d ? ' — ' + d : ''}`)
  if (c) pass++
  else fail++
}

// The presenter and the kind map are pure, so the verification uses the very same code the screen
// uses. If it renders here, it renders there.
import { present } from '../apps/web/src/lib/activity/present'
import { KIND_OF } from '../apps/web/src/server/activity-query'

interface Row {
  id: string
  type: string
  payload: Record<string, unknown>
  correlationId: string
  related: Record<string, string>
  occurredAt: number
}

const rows = async (): Promise<Row[]> => {
  const snap = await db.collection(`studios/${SID}/events`).orderBy('recordedAt', 'desc').limit(500).get()
  return snap.docs.map((d) => ({
    id: d.id,
    type: d.get('type') as string,
    payload: (d.get('payload') ?? {}) as Record<string, unknown>,
    correlationId: (d.get('correlationId') as string) ?? '',
    related: (d.get('related') ?? {}) as Record<string, string>,
    occurredAt: d.get('occurredAt')?.toMillis?.() ?? 0,
  }))
}

async function main(): Promise<void> {
  const all = await rows()
  ok('Event log okunabiliyor', all.length > 0, `${all.length} event`)

  const types = [...new Set(all.map((r) => r.type))]
  console.log(`   üretilen tipler: ${types.length}`)

  // 1. Every event the studio actually produced has a Turkish sentence.
  const unmapped = types.filter((t) => !(t in KIND_OF))
  ok('Her event tipi bir iş kategorisine bağlı', unmapped.length === 0, unmapped.join(', '))

  const render = (r: Row) =>
    present({
      eventId: r.id,
      type: r.type,
      kind: KIND_OF[r.type] ?? 'system',
      occurredAt: r.occurredAt,
      recordedAt: r.occurredAt,
      actorType: 'receptionist',
      actorId: 'usr_1',
      actorName: 'Reyhan',
      memberId: r.related.memberId ?? null,
      memberName: r.related.memberId ? 'Ayşe' : null,
      operationId: r.correlationId,
      undoPolicy: 'compensating',
      payload: r.payload,
      related: {},
    } as never)

  const leaking = all.filter((r) => {
    const p = render(r)
    return p.title.includes(r.type) || p.title === 'Sistem kaydı oluşturuldu.'
  })
  ok(
    'Hiçbir teknik event adı ekrana çıkmıyor',
    leaking.length === 0,
    leaking.length ? [...new Set(leaking.map((r) => r.type))].join(', ') : 'hepsi Türkçe cümle',
  )

  // A sample, so a human can read what the owner will read.
  console.log('\n   — ekranın göreceği cümleler —')
  for (const r of all.slice(0, 6)) {
    const p = render(r)
    console.log(`   ${new Date(r.occurredAt).toLocaleString('tr-TR')}  ${p.title}${p.detail ? ` (${p.detail})` : ''}`)
  }
  console.log()

  // 2. OP-2: one operation, many aggregates, one id.
  // The NEWEST applied closure: an emulator that has been through several runs also holds
  // closures written before OP-2 threaded the operation id through — those legitimately carry only
  // their own event, and testing against them would be testing history, not the code.
  const closure = all.find((r) => r.type === 'studio_closure.applied')
  if (closure) {
    const snap = await db
      .collection(`studios/${SID}/events`)
      .where('correlationId', '==', closure.correlationId)
      .get()
    const opTypes = snap.docs.map((d) => d.get('type') as string)
    ok(
      'OP-2: kapanışın tüm alt hareketleri tek İşlem No altında',
      opTypes.includes('studio_closure.applied') &&
        opTypes.some((t) => t === 'class_session.cancelled') &&
        opTypes.some((t) => t === 'reservation.cancelled') &&
        opTypes.some((t) => t === 'entitlement.extended'),
      `${opTypes.length} event: ${[...new Set(opTypes)].join(', ')}`,
    )
  } else {
    ok('OP-2: kapanış operasyonu bulundu', false, 'demo veride kapanış yok')
  }

  // 3. The timelines' queries.
  const withMember = all.find((r) => r.related.memberId)!
  const memberEvents = await db
    .collection(`studios/${SID}/events`)
    .where('related.memberId', '==', withMember.related.memberId)
    .orderBy('occurredAt', 'desc')
    .limit(50)
    .get()
  ok('Üye timeline sorgusu çalışıyor', memberEvents.size > 0, `${memberEvents.size} hareket`)

  const withEnt = all.find((r) => r.related.entitlementId)!
  const packageEvents = await db
    .collection(`studios/${SID}/events`)
    .where('related.entitlementId', '==', withEnt.related.entitlementId)
    .orderBy('occurredAt', 'desc')
    .limit(50)
    .get()
  ok('Paket timeline sorgusu çalışıyor', packageEvents.size > 0, `${packageEvents.size} hareket`)

  const withRes = all.find((r) => r.related.reservationId)!
  const resEvents = await db
    .collection(`studios/${SID}/events`)
    .where('related.reservationId', '==', withRes.related.reservationId)
    .orderBy('occurredAt', 'desc')
    .limit(50)
    .get()
  ok('Rezervasyon timeline sorgusu çalışıyor', resEvents.size > 0, `${resEvents.size} hareket`)

  // 4. #6 — no PII in the log, before/after included. If a payload ever carried a name or a phone,
  // this is where we find out — and it is unrecoverable, so we look every time.
  const members = await db.collection(`studios/${SID}/members`).get()
  const secrets = members.docs.flatMap((d) => [d.get('fullName') as string, d.get('phone') as string]).filter(Boolean)
  const contaminated = all.filter((r) => {
    const json = JSON.stringify(r.payload)
    return secrets.some((v) => v && json.includes(v))
  })
  ok(
    '#6: hiçbir event payload’unda PII yok (changes[] dahil)',
    contaminated.length === 0,
    contaminated.length ? [...new Set(contaminated.map((r) => r.type))].join(', ') : `${secrets.length} isim/telefon arandı`,
  )

  console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} geçti, ${fail} kaldı`)
  process.exit(fail === 0 ? 0 : 1)
}

void main()
