import { createHmac, timingSafeEqual } from 'node:crypto'

import { cookies } from 'next/headers'

import { adminAuth, adminDb } from './firebase-admin'
import { qrSigningSecret } from './secrets'

// ── RAPOR PIN'İ (owner, 2026-09-30) ─────────────────────────────────────────────────────────
//
// *"Rapor ekranını şifreli açmamız mümkün mü? Bu rol admin açık bırakıyor, resepsiyondaki biri de
// görebiliyor, görmesini istemiyorum."*
//
// Önce ölçüldü: resepsiyonun KENDİ hesabı `/reports`'u zaten açamıyor — ne ekran ne de veri; hem
// `permissions.ts` hem `loadReportAction` owner şartı koyuyor. Yani korunan şey rol değil, **açık
// bırakılmış owner oturumu**: makinenin başına geçen bir başkası.
//
// Bu yüzden ikinci bir kapı gerekiyor ve bu kapı bir SIRRA dayanıyor. İki şeyi birden karşılaması
// gerekti:
//
//   · **Sır, panelde hiçbir zaman GÖSTERİLMEZ.** Ayarlarda yalnızca "değiştir" var. Owner: *"eskisini
//     söylemesin; biri değiştirirse zaten bilgi okunmuş demektir, o ayrı bir mesele."*
//   · **Sır, resepsiyonun okuyabileceği bir yerde DURAMAZ.** Bu, sistemin gerçek bir açığıydı:
//     `firestore.rules`'un son kuralı `desk()`e (owner + resepsiyon) bütün koleksiyonları okutuyor
//     ve `settings` sunucuya-özel listede DEĞİLDİ. PIN'in özetini oraya koysaydık, tam da
//     engellemek istediğimiz kişi onu veritabanından okur ve altı haneyi saniyeler içinde denerdi.
//     Bu yüzden `secrets` diye ayrı bir koleksiyon açıldı ve listeye eklendi (`devices` neden orada
//     ise aynı sebep: içinde bir `secretHash` var).
//
// Özet HMAC ile alınıyor, düz sha256 ile değil: altı hane bir sözlük kadar küçüktür, ve anahtarsız
// bir özet sızdığında saniyeler içinde geri çözülür. Anahtar olarak QR imza sırrı kullanılıyor —
// yeni bir üretim sırrı tanımlamamak için — ama alan ayrımı (`::report-pin`) ile, yani aynı
// anahtardan üretilen iki özet birbirinin yerine kullanılamaz.

const COL = 'secrets'
const DOC = 'reportPin'
const COOKIE = 'report_unlock'

/** Açılış PIN'i. Owner'ın verdiği değer; panelde HİÇBİR YERDE gösterilmiyor, yalnızca değiştiriliyor. */
const BOOTSTRAP_PIN = '156211'

/** Kilidin açık kaldığı süre. Kısa: masadan kalkıldığında ekran kendiliğinden kapansın. */
const UNLOCK_MS = 15 * 60 * 1000

const key = (): string => `${qrSigningSecret()}::report-pin`

function hash(pin: string): string {
  return createHmac('sha256', key()).update(pin).digest('hex')
}

/** Sabit süreli karşılaştırma: farkın NEREDE olduğunu zamanlamayla sızdırmamak için. */
function same(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

const ref = (studioId: string) => adminDb().collection(`studios/${studioId}/${COL}`).doc(DOC)

/**
 * Kayıtlı özet — hiç değiştirilmemişse açılış PIN'inin özeti.
 *
 * Açılış değeri belgeye ÖNCEDEN yazılmıyor: yazılsaydı "hiç değiştirilmedi" ile "değiştirildi ve
 * tesadüfen aynı" ayırt edilemezdi, ve ayarlar ekranının "bu PIN hiç değiştirilmedi" uyarısı
 * yalan söylerdi.
 */
async function storedHash(studioId: string): Promise<{ hash: string; varsayilan: boolean }> {
  const snap = await ref(studioId).get()
  const h = snap.data()?.hash
  return typeof h === 'string' && h.length > 0 ? { hash: h, varsayilan: false } : { hash: hash(BOOTSTRAP_PIN), varsayilan: true }
}

export async function reportPinIsDefault(studioId: string): Promise<boolean> {
  return (await storedHash(studioId)).varsayilan
}

export async function verifyReportPin(studioId: string, pin: string): Promise<boolean> {
  const { hash: stored } = await storedHash(studioId)
  return same(hash(pin.trim()), stored)
}

// ── Kilit çerezi ────────────────────────────────────────────────────────────────────────────
//
// Sunucuda oturum tablosu tutulmuyor: çerezin kendisi imzalı. İçinde bitiş anı ve o anın imzası
// var, yani tarayıcıda uzatılamaz. Kime ait olduğu da imzaya giriyor — bir çerez başka bir
// kullanıcıya taşınamaz.

const sign = (studioId: string, uid: string, exp: number): string =>
  createHmac('sha256', key()).update(`${studioId}|${uid}|${exp}`).digest('hex')

export async function unlockReports(studioId: string, uid: string): Promise<void> {
  const exp = Date.now() + UNLOCK_MS
  const store = await cookies()
  store.set(COOKIE, `${exp}.${sign(studioId, uid, exp)}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: Math.floor(UNLOCK_MS / 1000),
  })
}

export async function reportsUnlocked(studioId: string, uid: string): Promise<boolean> {
  const raw = (await cookies()).get(COOKIE)?.value ?? ''
  const [expRaw, sig] = raw.split('.')
  const exp = Number(expRaw)
  if (!sig || !Number.isFinite(exp) || exp < Date.now()) return false
  return same(sig, sign(studioId, uid, exp))
}

export async function lockReports(): Promise<void> {
  ;(await cookies()).delete(COOKIE)
}

// ── Değiştirme, ve değiştirildiğinin KAYDI ──────────────────────────────────────────────────
//
// Owner: *"değişince bunu mail olarak at, logu tutulsun."* İkisi birden yapılıyor — biri anlık
// haber, öteki kalıcı iz. E-posta gönderilemezse değişiklik yine de geçerli: bir bildirim yolu
// çalışmıyor diye owner'ı kendi PIN'ini değiştiremez hale getirmek, çözdüğünden büyük bir sorun
// yaratır. Ama gönderilemediği loga yazılıyor.

export async function changeReportPin(
  studioId: string,
  uid: string,
  current: string,
  next: string,
): Promise<{ ok: true } | { ok: false; code: 'wrong_pin' | 'weak_pin' }> {
  if (!(await verifyReportPin(studioId, current))) return { ok: false, code: 'wrong_pin' }
  const yeni = next.trim()
  // Altı hane, sadece rakam. Daha kısası ezberlenmez değil, denenebilir olur.
  if (!/^\d{6}$/.test(yeni)) return { ok: false, code: 'weak_pin' }

  const at = Date.now()
  await ref(studioId).set({ hash: hash(yeni), updatedAt: at, updatedBy: uid }, { merge: true })
  // Kalıcı iz. PIN'in kendisi DEĞİL — yalnızca ne zaman ve kim tarafından değiştirildiği
  // (ayarlar günlüğünün kuralı: alan adı yazılır, değeri asla).
  await ref(studioId).collection('changes').doc(String(at)).set({ at, by: uid })

  let mailed = false
  try {
    const user = await adminAuth().getUser(uid)
    if (user.email) {
      await sendChangedEmail(user.email, at)
      mailed = true
    }
  } catch {
    // yutulmuyor — aşağıya yazılıyor
  }
  if (!mailed) await ref(studioId).collection('changes').doc(String(at)).set({ mailed: false }, { merge: true })

  return { ok: true }
}

async function sendChangedEmail(to: string, at: number): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.EMAIL_FROM
  if (!apiKey || !from) throw new Error('email transport not configured')
  const ne = new Date(at).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [to],
      subject: 'Rapor PIN’i değiştirildi',
      // PIN'in kendisi e-postaya KONMUYOR. Bir sırrı gizlemek için kurulan şeyin o sırrı
      // postayla yollaması, kilidi takıp anahtarı kapının üstüne bırakmaktır.
      html: `<p>Merhaba,</p>
        <p>Panelin <strong>rapor PIN'i</strong> <strong>${ne}</strong> tarihinde değiştirildi.</p>
        <p>Bunu sen yaptıysan yapacak bir şey yok. <strong>Sen yapmadıysan</strong>, PIN'i bilen
        biri panelde açık bir oturuma ulaşmış demektir: panel şifreni değiştir ve PIN'i yeniden
        belirle.</p>
        <p style="color:#888;font-size:13px">Bu e-posta PIN'in kendisini içermez.</p>`,
    }),
  })
}
