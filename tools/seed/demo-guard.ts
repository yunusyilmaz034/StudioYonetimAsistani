import type { CollectionReference, DocumentReference, Firestore } from 'firebase-admin/firestore'

// TEK BİR STÜDYONUN DIŞINA YAZAMAYAN FIRESTORE (owner, 2026-08-26).
//
// Demo verisi, 171 kadının bağlı olduğu bir işletmeyle AYNI veritabanında duruyor. Çok kiracılı
// tasarım bunu güvenli kılıyor — ama "güvenli" olan mimari, benim bir satırda yanlış id yazmam
// değil. Owner'ın cümlesi: "orayı bozarsak hiçbir şeyin önemi yok."
//
// Bu yüzden seeder'a dikkat etmesini SÖYLEMİYORUZ; yanlış yere yazmasını İMKÂNSIZ kılıyoruz.
// Repository'lerin Firestore'a girdiği iki kapı var:
//
//   db.collection('studios').doc(<sid>)   ← repository'lerin kullandığı yol
//   db.doc('studios/<sid>/…')             ← doğrudan yol
//
// İkisi de burada kontrol ediliyor. Başka bir stüdyoya uzanan çağrı, veritabanına ulaşmadan
// ÇÖKÜYOR — sessizce yok sayılmıyor, çünkü yok sayılan bir koruma fark edilmez.

export class WrongStudioError extends Error {
  constructor(path: string, allowed: string) {
    super(`DEMO KİLİDİ: "${path}" yolu "${allowed}" stüdyosunun dışında. Hiçbir şey yazılmadı.`)
    this.name = 'WrongStudioError'
  }
}

/**
 * `db`nin yalnızca `studios/<allowed>/…` altına erişebilen bir kopyasını verir.
 *
 * Okumalar da kısıtlı, kasten: yanlış stüdyodan okuyup demo verisine karıştırmak, yanlış yere
 * yazmak kadar sinsi bir hata — ve fark edilmesi daha zor.
 */
export function lockToStudio(db: Firestore, allowed: string): Firestore {
  const check = (path: string): void => {
    const norm = path.replace(/^\/+/, '')
    if (norm === 'studios') return // kök koleksiyonun kendisi zararsız
    if (!norm.startsWith(`studios/${allowed}/`) && norm !== `studios/${allowed}`) {
      throw new WrongStudioError(path, allowed)
    }
  }

  return new Proxy(db, {
    get(target, prop, receiver) {
      if (prop === 'collection') {
        return (path: string): CollectionReference => {
          check(path)
          const col = target.collection(path)
          // `db.collection('studios')` tek başına geçerli; tehlikeli olan ondan SONRAKİ `.doc(sid)`.
          return path.replace(/^\/+/, '') === 'studios' ? guardStudiosRoot(col, allowed) : col
        }
      }
      if (prop === 'doc') {
        return (path: string): DocumentReference => {
          check(path)
          return target.doc(path)
        }
      }
      const value = Reflect.get(target, prop, receiver) as unknown
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value
    },
  }) as Firestore
}

/** `/studios` koleksiyonu — `.doc(sid)` yalnızca izinli stüdyoyu verebilir. */
function guardStudiosRoot(col: CollectionReference, allowed: string): CollectionReference {
  return new Proxy(col, {
    get(target, prop, receiver) {
      if (prop === 'doc') {
        return (sid: string): DocumentReference => {
          if (sid !== allowed) throw new WrongStudioError(`studios/${sid}`, allowed)
          return target.doc(sid)
        }
      }
      const value = Reflect.get(target, prop, receiver) as unknown
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value
    },
  }) as CollectionReference
}
