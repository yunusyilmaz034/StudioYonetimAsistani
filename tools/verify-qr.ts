// v1.21 — the dynamic QR, driven against the emulator: mint → scan → re-scan → expired → wrong
// branch. The burn (single-use) lives in a Firestore transaction, so it can only be proven here.
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

import { signQrToken, verifyQrToken } from '../apps/web/src/server/qr-token'

process.env.FIRESTORE_EMULATOR_HOST ??= 'localhost:8080'
initializeApp({ projectId: 'demo-sos' })
const db = getFirestore()
const SECRET = 'dev-only-qr-secret'
const SID = 'std_demo'
const BRANCH = 'brn_demo'

let pass = 0, fail = 0
const ok = (l: string, c: boolean, d = ''): void => {
  console.log(`${c ? '✅' : '❌'} ${l}${d ? ' — ' + d : ''}`)
  if (c) pass++
  else fail++
}

// The exact server-side check `checkInByQrAction` performs.
async function scan(token: string, branchId: string): Promise<string> {
  const claims = verifyQrToken(token, SECRET)
  if (!claims) return 'qr_invalid'
  if (Date.now() > claims.exp) return 'qr_expired'
  if (claims.branchId !== branchId) return 'qr_invalid'
  const ref = db.collection('studios').doc(SID).collection('qrTokens').doc(claims.jti)
  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref)
      if (snap.exists) throw new Error('used')
      tx.set(ref, { usedAt: new Date(), memberId: claims.memberId })
    })
  } catch {
    return 'qr_used'
  }
  return 'ok'
}

async function main(): Promise<void> {
  const members = await db.collection(`studios/${SID}/members`).get()
  const memberId = members.docs[0]!.id

  const live = signQrToken({ memberId, branchId: BRANCH, exp: Date.now() + 60_000, jti: 'jti_live' }, SECRET)
  ok('11a. Geçerli QR kabul ediliyor', (await scan(live, BRANCH)) === 'ok')
  ok('11b. AYNI kod ikinci kez REDDEDİLİYOR (tek kullanımlık)', (await scan(live, BRANCH)) === 'qr_used')

  const expired = signQrToken({ memberId, branchId: BRANCH, exp: Date.now() - 1000, jti: 'jti_exp' }, SECRET)
  ok('11c. Süresi dolmuş kod reddediliyor', (await scan(expired, BRANCH)) === 'qr_expired')

  const wrongBranch = signQrToken({ memberId, branchId: 'brn_other', exp: Date.now() + 60_000, jti: 'jti_br' }, SECRET)
  ok('11d. Yanlış şube reddediliyor', (await scan(wrongBranch, BRANCH)) === 'qr_invalid')

  const forged = signQrToken({ memberId, branchId: BRANCH, exp: Date.now() + 60_000, jti: 'jti_f' }, 'wrong-secret')
  ok('11e. Başka secret ile imzalanan kod reddediliyor', (await scan(forged, BRANCH)) === 'qr_invalid')

  ok('11f. ESKİ statik memberId QR’ı artık işe yaramıyor', (await scan(memberId, BRANCH)) === 'qr_invalid')

  const tampered = live.replace(memberId, members.docs[1]!.id)
  ok('11g. Üye değiştirilmiş kod reddediliyor', (await scan(tampered, BRANCH)) === 'qr_invalid')

  console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} geçti, ${fail} kaldı`)
  process.exit(fail === 0 ? 0 : 1)
}
void main()
