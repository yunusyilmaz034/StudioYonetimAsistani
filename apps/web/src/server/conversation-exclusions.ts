import 'server-only'

import { FieldValue } from 'firebase-admin/firestore'

import { adminDb } from './firebase-admin'

// ── MÜŞTERİ DEĞİL (owner, 2026-11-24) ────────────────────────────────────────────────────────
//
// *"Instagram hattında müşteri dışındaki konuşmalar varsa hiç gösterme — iş için yazanlar, reklam,
// pazarlama."* Kimin müşteri olmadığına bir İNSAN karar verir: otomatik bir tahmin yanlış
// gizlediğinde kaybolan şey bir müşteri olur, ve bunu kimse fark etmez.
//
// YENİ BİR LİSTE DEĞİL. 12 Kasım'da sahiplerin özel sohbetleri için açılan liste aynı işi görüyor
// (`settings/ai.ignoredContacts`, bkz. apps/functions/src/http/ignored-contacts.ts): listedeki
// kişiden gelen YENİ mesaj hiç saklanmaz, AI cevaplamaz, aday açılmaz. Bu dosya o listeyi panel
// tarafından okuyup yazar; daha önce saklanmış sohbet silinmez — hattan ve panodan çekilir, Sohbetler
// ekranındaki "Müşteri değil" filtresinde durur ve oradan geri alınır.
const aiSettings = (studioId: string) => adminDb().doc(`studios/${studioId}/settings/ai`)

export async function loadNotCustomerKeys(studioId: string): Promise<ReadonlySet<string>> {
  const list = (await aiSettings(studioId).get()).get('ignoredContacts') as unknown
  return new Set(Array.isArray(list) ? list.filter((k): k is string => typeof k === 'string').map((k) => k.trim()) : [])
}

export async function setNotCustomer(studioId: string, key: string, notCustomer: boolean, actorId: string): Promise<void> {
  await aiSettings(studioId).set(
    {
      ignoredContacts: notCustomer ? FieldValue.arrayUnion(key) : FieldValue.arrayRemove(key),
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: { type: 'staff', id: actorId },
    },
    { merge: true },
  )
}
