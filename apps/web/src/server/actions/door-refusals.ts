'use server'

import { Timestamp } from 'firebase-admin/firestore'
import { z } from 'zod'

import { requireTenantContext } from '../auth'
import { adminDb } from '../firebase-admin'

// ── KAPIDA KALAN ÜYE, O AN (owner, 2026-10-08) ─────────────────────────────────────────────
//
// *"Turnikede uyarı veren, giriş yapamayan üye için panelde hemen en üstten bir toast mesajı gibi
// popup çıkıp söylesin, dikkat çeksin."*
//
// Ret zaten yazılıyordu (`member.entry_refused`) ve panoda bir iş olarak görünüyordu — ama panoya
// bakan birine. Kapıda bekleyen üye ise ŞİMDİ bekliyor; masa başka bir ekrandayken haberi olmuyordu.
//
// NEDEN DİNLEME DEĞİL, SORMA: olay günlüğü kurallarda sunucuya-özel (owner dışında kimse okuyamaz) ve
// öyle kalmalı. Masanın tarayıcısına günlüğü açmak yerine, masa birkaç saniyede bir bu eylemi çağırıyor;
// dönen şey yalnızca ret ve üyenin adı. Sorgu mevcut `(type, recordedAt)` indeksini kullanır.
const DESK = ['owner', 'receptionist', 'platform_admin'] as const

export interface DoorRefusal {
  readonly id: string
  readonly memberId: string
  readonly name: string
  readonly reason: string
  readonly at: number
}

export interface DoorRefusalsResult {
  /** Bir sonraki çağrıda gönderilecek işaret — SUNUCU saatiyle; tarayıcının saati güvenilmez. */
  readonly cursor: number
  readonly refusals: readonly DoorRefusal[]
}

export async function recentDoorRefusalsAction(input: unknown): Promise<DoorRefusalsResult> {
  const p = z.object({ cursor: z.number().int().nullable() }).parse(input)
  const ctx = await requireTenantContext(DESK)
  const now = Date.now()
  // İlk çağrı yalnızca işareti kurar: sayfa açıldığında geçmişin retleri ekrana dökülmez.
  if (p.cursor === null) return { cursor: now, refusals: [] }

  const snap = await adminDb()
    .collection('studios')
    .doc(String(ctx.studioId))
    .collection('events')
    .where('type', '==', 'member.entry_refused')
    // Uykudan dönen bir sekme saatlerce eski bir işaret gönderebilir; on dakikadan eski bir ret artık
    // "şimdi kapıda" değildir ve onun yeri pano.
    .where('recordedAt', '>', Timestamp.fromMillis(Math.max(p.cursor, now - 10 * 60_000)))
    .orderBy('recordedAt', 'desc')
    .limit(10)
    .get()
  if (snap.empty) return { cursor: p.cursor, refusals: [] }

  const rows = snap.docs.map((d) => ({
    id: d.id,
    memberId: String(d.get('subject.id') ?? ''),
    reason: String(d.get('payload.reason') ?? 'no_active_membership'),
    at: (d.get('recordedAt') as Timestamp).toMillis(),
  }))
  const ids = [...new Set(rows.map((r) => r.memberId).filter(Boolean))]
  // İsim olayda YOK (#6) — `/members`ten okunuyor, en fazla on belge.
  const uyeler = ids.length
    ? await adminDb().getAll(...ids.map((id) => adminDb().doc(`studios/${ctx.studioId}/members/${id}`)))
    : []
  const ad = new Map(uyeler.map((d) => [d.id, String(d.get('fullName') ?? '')]))

  return {
    // İşaret, görülen EN YENİ kaydın anı: `now` yazılsaydı, sorgu ile dönüş arasında yazılan bir ret
    // iki çağrının arasına düşer ve hiç gösterilmezdi.
    cursor: Math.max(...rows.map((r) => r.at)),
    refusals: rows.map((r) => ({ ...r, name: ad.get(r.memberId) || 'Bilinmeyen üye' })).reverse(),
  }
}
