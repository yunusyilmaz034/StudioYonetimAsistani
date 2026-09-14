import {
  FieldValue,
  getFirestore,
  Timestamp,
  type CollectionReference,
  type Firestore,
  type Transaction,
} from 'firebase-admin/firestore'

import {
  instant,
  newEventId,
  ok,
  type DomainError,
  type NewEvent,
  type Result,
  type StaffUserId,
  type StudioId,
  type TenantContext,
} from '../../../shared'
import type { IdentityRepository, StaffLeaveRepository, StaffShiftRepository, StaffWeekPlanRepository } from '../application/ports'
import type { StaffLeave, StaffLeaveDocument, StaffMember, StaffShift, StaffWeekPlan, WeekPlanEntries } from '../domain/types'
import { staffFromFirestore, staffToFirestore } from './mappers'

export class FirestoreIdentityRepository implements IdentityRepository {
  constructor(private readonly db: Firestore = getFirestore()) {}

  private col(sid: StudioId, name: string): CollectionReference {
    return this.db.collection('studios').doc(sid).collection(name)
  }

  async listStaff(ctx: TenantContext): Promise<readonly StaffMember[]> {
    const snap = await this.col(ctx.studioId, 'staff').get()
    return snap.docs.map((doc) => staffFromFirestore(doc.id as StaffUserId, doc.data()))
  }

  async getStaff(ctx: TenantContext, id: StaffUserId): Promise<StaffMember | null> {
    const snap = await this.col(ctx.studioId, 'staff').doc(id).get()
    return snap.exists ? staffFromFirestore(id, snap.data() ?? {}) : null
  }

  /** The document and its event(s), in ONE transaction (#1). A role that changed without an event
   *  is a role nobody can explain — and explaining it is the only reason these are events. */
  async saveStaff(
    ctx: TenantContext,
    staff: StaffMember,
    events: readonly NewEvent[],
  ): Promise<void> {
    const ref = this.col(ctx.studioId, 'staff').doc(staff.id)
    await this.db.runTransaction(async (tx: Transaction) => {
      tx.set(ref, staffToFirestore(staff), { merge: true })
      this.writeEvents(ctx.studioId, tx, events)
    })
  }

  // Two timestamps, never one (#3): `occurredAt` is domain time, `recordedAt` is the server's.
  private writeEvents(sid: StudioId, tx: Transaction, events: readonly NewEvent[]): void {
    for (const e of events) {
      tx.set(this.col(sid, 'events').doc(newEventId()), {
        ...e,
        occurredAt: Timestamp.fromMillis(e.occurredAt as number),
        recordedAt: FieldValue.serverTimestamp(),
      })
    }
  }
}

// ── MESAİ (owner, 2026-09-01) ───────────────────────────────────────────────────────────────
//
// `staffShifts`: bir vardiya bir belge. "Bugünün vardiyası" diye bir belge YOK — gece yarısını
// geçen bir mesai hâlâ tek bir vardiyadır, ve günlük belge onu ikiye bölerdi.
export class FirestoreStaffShiftRepository implements StaffShiftRepository {
  constructor(private readonly db: Firestore = getFirestore()) {}

  private col(sid: StudioId): CollectionReference {
    return this.db.collection('studios').doc(sid).collection('staffShifts')
  }

  async getOpenShift(ctx: TenantContext, staffUserId: StaffUserId): Promise<StaffShift | null> {
    // Açık vardiya kişi başına EN FAZLA bir tane (karar öyle diyor). `limit(1)` bunu varsaymıyor,
    // yalnızca okumayı ucuz tutuyor — birden fazlası olsaydı en yenisi kazanırdı ve o da bir
    // ipucu olurdu, sessiz bir bozulma değil.
    const snap = await this.col(ctx.studioId)
      .where('staffUserId', '==', staffUserId)
      .where('endedAt', '==', null)
      .limit(1)
      .get()
    const d = snap.docs[0]
    return d ? this.oku(d.id, d.data()) : null
  }

  async listShifts(ctx: TenantContext, fromAt: number, toAt: number): Promise<readonly StaffShift[]> {
    const snap = await this.col(ctx.studioId)
      .where('startedAt', '>=', Timestamp.fromMillis(fromAt))
      .where('startedAt', '<=', Timestamp.fromMillis(toAt))
      .orderBy('startedAt', 'desc')
      .get()
    return snap.docs.map((d) => this.oku(d.id, d.data()))
  }

  async listOpenShifts(ctx: TenantContext): Promise<readonly StaffShift[]> {
    // Tek alanlı eşitlik — otomatik index yeter, bileşik index İSTEMEZ (OR-14'ün tuzağı burada yok).
    const snap = await this.col(ctx.studioId).where('endedAt', '==', null).get()
    return snap.docs.map((d) => this.oku(d.id, d.data()))
  }

  async saveShift(ctx: TenantContext, shift: StaffShift, events: readonly NewEvent[]): Promise<void> {
    await this.saveShifts(ctx, [shift], events)
  }

  async saveShifts(ctx: TenantContext, shifts: readonly StaffShift[], events: readonly NewEvent[]): Promise<void> {
    await this.db.runTransaction(async (tx: Transaction) => {
      for (const shift of shifts) {
        tx.set(
          this.col(ctx.studioId).doc(shift.id),
          {
            staffUserId: shift.staffUserId,
            branchId: shift.branchId,
            startedAt: Timestamp.fromMillis(shift.startedAt as number),
            endedAt: shift.endedAt === null ? null : Timestamp.fromMillis(shift.endedAt as number),
            lastCrossingAt: shift.lastCrossingAt === null ? null : Timestamp.fromMillis(shift.lastCrossingAt as number),
          },
          { merge: true },
        )
      }
      this.writeEvents(ctx.studioId, tx, events)
    })
  }

  private oku(id: string, d: Record<string, unknown>): StaffShift {
    const ts = (v: unknown): number => (v as Timestamp).toMillis()
    return {
      id,
      staffUserId: d.staffUserId as StaffUserId,
      branchId: (d.branchId ?? null) as StaffShift['branchId'],
      startedAt: instant(ts(d.startedAt)),
      endedAt: d.endedAt == null ? null : instant(ts(d.endedAt)),
      // 2026-09-13'ten önceki belgelerde alan YOK — onlar elle açılmış vardiyalar, geçişleri yok.
      lastCrossingAt: d.lastCrossingAt == null ? null : instant(ts(d.lastCrossingAt)),
    }
  }

  private writeEvents(sid: StudioId, tx: Transaction, events: readonly NewEvent[]): void {
    for (const e of events) {
      tx.set(this.db.collection('studios').doc(sid).collection('events').doc(newEventId()), {
        ...e,
        occurredAt: Timestamp.fromMillis(e.occurredAt as number),
        recordedAt: FieldValue.serverTimestamp(),
      })
    }
  }
}

// ── İZİN / YOKLUK (owner onayı, 2026-09-11) ─────────────────────────────────────────────────
//
// Ayrı bir koleksiyon (`staffLeaves`), vardiyaların içine karıştırılmadı: bir izin bir vardiya
// DEĞİLDİR ve ikisini aynı belgede tutmak, "kaç saat çalıştı" sorusunu izin günleriyle kirletirdi.
export class FirestoreStaffLeaveRepository implements StaffLeaveRepository {
  constructor(private readonly db: Firestore = getFirestore()) {}

  private col(sid: StudioId): CollectionReference {
    return this.db.collection('studios').doc(sid).collection('staffLeaves')
  }

  async getLeave(ctx: TenantContext, id: string): Promise<StaffLeave | null> {
    const d = await this.col(ctx.studioId).doc(id).get()
    return d.exists ? this.oku(d.id, d.data() as Record<string, unknown>) : null
  }

  async listLiveLeavesOf(ctx: TenantContext, staffUserId: StaffUserId): Promise<readonly StaffLeave[]> {
    const snap = await this.col(ctx.studioId)
      .where('staffUserId', '==', staffUserId)
      .where('status', 'in', ['pending', 'approved'])
      .get()
    return snap.docs.map((d) => this.oku(d.id, d.data()))
  }

  async listLeavesOverlapping(ctx: TenantContext, fromAt: number, toAt: number): Promise<readonly StaffLeave[]> {
    // TEK EŞİTSİZLİK ALANI. Firestore iki farklı alanda aralık sorgusunu birlikte kabul etmiyor,
    // ve çakışma iki karşılaştırma ister (`from <= toAt && to >= fromAt`). Bu yüzden sorgu
    // `to >= fromAt` ile daraltılıyor, öteki uç HAFIZADA süzülüyor — sonuç kümesi zaten küçük
    // (izinler nadirdir) ve `collectionGroup` gerektirmiyor.
    const snap = await this.col(ctx.studioId)
      .where('to', '>=', Timestamp.fromMillis(fromAt))
      .where('status', 'in', ['pending', 'approved'])
      .get()
    return snap.docs.map((d) => this.oku(d.id, d.data())).filter((l) => (l.from as number) <= toAt)
  }

  async listPendingLeaves(ctx: TenantContext): Promise<readonly StaffLeave[]> {
    const snap = await this.col(ctx.studioId).where('status', '==', 'pending').orderBy('from', 'asc').get()
    return snap.docs.map((d) => this.oku(d.id, d.data()))
  }

  async saveLeave(ctx: TenantContext, leave: StaffLeave, events: readonly NewEvent[]): Promise<void> {
    const ref = this.col(ctx.studioId).doc(leave.id)
    await this.db.runTransaction(async (tx: Transaction) => {
      tx.set(
        ref,
        {
          staffUserId: leave.staffUserId,
          kind: leave.kind,
          from: Timestamp.fromMillis(leave.from as number),
          to: Timestamp.fromMillis(leave.to as number),
          note: leave.note,
          status: leave.status,
          requestedAt: Timestamp.fromMillis(leave.requestedAt as number),
          decidedBy: leave.decidedBy,
          decidedAt: leave.decidedAt === null ? null : Timestamp.fromMillis(leave.decidedAt as number),
          decisionReason: leave.decisionReason,
        },
        { merge: true },
      )
      this.writeEvents(ctx.studioId, tx, events)
    })
  }

  // İzne rapor dosyası (OR-77, karar 4): iznin ALTINDA bir alt koleksiyon. Firestore kuralları yalnızca tek
  // seviyeli koleksiyonları masaya açıyor; bu yol hiçbir kuralla eşleşmez, istemci okuyamaz. Okuma ve yazma
  // yalnızca Admin SDK ile, yetkiyi soran Server Action üzerinden.
  private belgeler(sid: StudioId, leaveId: string): CollectionReference {
    return this.col(sid).doc(leaveId).collection('documents')
  }

  async listLeaveDocuments(ctx: TenantContext, leaveId: string): Promise<readonly StaffLeaveDocument[]> {
    const snap = await this.belgeler(ctx.studioId, leaveId).orderBy('uploadedAt', 'asc').get()
    return snap.docs.map((d) => this.belgeOku(leaveId, d.id, d.data()))
  }

  async getLeaveDocument(ctx: TenantContext, leaveId: string, documentId: string): Promise<StaffLeaveDocument | null> {
    const d = await this.belgeler(ctx.studioId, leaveId).doc(documentId).get()
    return d.exists ? this.belgeOku(leaveId, d.id, d.data() as Record<string, unknown>) : null
  }

  async saveLeaveDocument(ctx: TenantContext, document: StaffLeaveDocument, events: readonly NewEvent[]): Promise<void> {
    await this.db.runTransaction(async (tx: Transaction) => {
      tx.set(this.belgeler(ctx.studioId, document.leaveId).doc(document.id), {
        staffUserId: document.staffUserId,
        pages: document.pages,
        uploadedAt: Timestamp.fromMillis(document.uploadedAt as number),
        uploadedBy: document.uploadedBy,
      })
      this.writeEvents(ctx.studioId, tx, events)
    })
  }

  async deleteLeaveDocument(ctx: TenantContext, leaveId: string, documentId: string, events: readonly NewEvent[]): Promise<void> {
    await this.db.runTransaction(async (tx: Transaction) => {
      tx.delete(this.belgeler(ctx.studioId, leaveId).doc(documentId))
      this.writeEvents(ctx.studioId, tx, events)
    })
  }

  private belgeOku(leaveId: string, id: string, d: Record<string, unknown>): StaffLeaveDocument {
    return {
      id,
      leaveId,
      staffUserId: d.staffUserId as StaffUserId,
      pages: (d.pages as string[] | undefined) ?? [],
      uploadedAt: instant((d.uploadedAt as Timestamp).toMillis()),
      uploadedBy: d.uploadedBy as StaffUserId,
    }
  }

  private oku(id: string, d: Record<string, unknown>): StaffLeave {
    const ts = (v: unknown): number => (v as Timestamp).toMillis()
    return {
      id,
      staffUserId: d.staffUserId as StaffUserId,
      kind: d.kind as StaffLeave['kind'],
      from: instant(ts(d.from)),
      to: instant(ts(d.to)),
      note: String(d.note ?? ''),
      status: d.status as StaffLeave['status'],
      requestedAt: instant(ts(d.requestedAt)),
      decidedBy: (d.decidedBy ?? null) as StaffLeave['decidedBy'],
      decidedAt: d.decidedAt == null ? null : instant(ts(d.decidedAt)),
      decisionReason: String(d.decisionReason ?? ''),
    }
  }

  private writeEvents(sid: StudioId, tx: Transaction, events: readonly NewEvent[]): void {
    for (const e of events) {
      tx.set(this.db.collection('studios').doc(sid).collection('events').doc(newEventId()), {
        ...e,
        occurredAt: Timestamp.fromMillis(e.occurredAt as number),
        recordedAt: FieldValue.serverTimestamp(),
      })
    }
  }
}

// ── HAFTALIK VARDİYA PLANI (owner, 2026-09-14 · OR-77) ─────────────────────────────────────
//
// `staffWeekPlans/{pazartesi}`: bir hafta, bir belge. Belge kimliği tarih olduğu için "bu haftanın
// planı" bir sorgu değil, tek bir okuma — ve indeks gerektirmiyor.
export class FirestoreStaffWeekPlanRepository implements StaffWeekPlanRepository {
  constructor(private readonly db: Firestore = getFirestore()) {}

  private col(sid: StudioId): CollectionReference {
    return this.db.collection('studios').doc(sid).collection('staffWeekPlans')
  }

  async getWeekPlan(ctx: TenantContext, weekStart: string): Promise<StaffWeekPlan | null> {
    const d = await this.col(ctx.studioId).doc(weekStart).get()
    return d.exists ? this.oku(weekStart, d.data() as Record<string, unknown>) : null
  }

  async getWeekPlans(ctx: TenantContext, weekStarts: readonly string[]): Promise<readonly StaffWeekPlan[]> {
    if (weekStarts.length === 0) return []
    const snaps = await this.db.getAll(...weekStarts.map((w) => this.col(ctx.studioId).doc(w)))
    return snaps.filter((s) => s.exists).map((s) => this.oku(s.id, s.data() as Record<string, unknown>))
  }

  async updateWeekPlan(
    ctx: TenantContext,
    weekStart: string,
    decide: (current: StaffWeekPlan | null) => Result<{ readonly next: StaffWeekPlan; readonly events: readonly NewEvent[] }, DomainError>,
  ): Promise<Result<StaffWeekPlan, DomainError>> {
    const ref = this.col(ctx.studioId).doc(weekStart)
    return this.db.runTransaction(async (tx: Transaction) => {
      const snap = await tx.get(ref)
      const current = snap.exists ? this.oku(weekStart, snap.data() as Record<string, unknown>) : null
      const decided = decide(current)
      if (!decided.ok) return decided
      // Değişiklik yoksa olay da yok, yazım da yok (aynı taslağı iki kez kaydetmek bir eylem değildir).
      if (decided.value.events.length > 0) {
        const p = decided.value.next
        const ts = (v: number | null) => (v === null ? null : Timestamp.fromMillis(v))
        tx.set(ref, {
          weekStart: p.weekStart,
          status: p.status,
          draft: p.draft,
          published: p.published,
          version: p.version,
          returnReason: p.returnReason,
          updatedAt: Timestamp.fromMillis(p.updatedAt as number),
          updatedBy: p.updatedBy,
          submittedAt: ts(p.submittedAt as number | null),
          approvedAt: ts(p.approvedAt as number | null),
          approvedBy: p.approvedBy,
        })
        this.writeEvents(ctx.studioId, tx, decided.value.events)
      }
      return ok(decided.value.next)
    })
  }

  private oku(weekStart: string, d: Record<string, unknown>): StaffWeekPlan {
    const ts = (v: unknown) => (v ? instant((v as Timestamp).toMillis()) : null)
    return {
      weekStart,
      status: (d.status as StaffWeekPlan['status'] | undefined) ?? 'draft',
      draft: (d.draft as WeekPlanEntries | undefined) ?? {},
      published: (d.published as WeekPlanEntries | null | undefined) ?? null,
      version: Number(d.version ?? 0),
      returnReason: String(d.returnReason ?? ''),
      updatedAt: ts(d.updatedAt) ?? instant(0),
      updatedBy: (d.updatedBy as StaffUserId | null | undefined) ?? null,
      submittedAt: ts(d.submittedAt),
      approvedAt: ts(d.approvedAt),
      approvedBy: (d.approvedBy as StaffUserId | null | undefined) ?? null,
    }
  }

  private writeEvents(sid: StudioId, tx: Transaction, events: readonly NewEvent[]): void {
    for (const e of events) {
      tx.set(this.db.collection('studios').doc(sid).collection('events').doc(newEventId()), {
        ...e,
        occurredAt: Timestamp.fromMillis(e.occurredAt as number),
        recordedAt: FieldValue.serverTimestamp(),
      })
    }
  }
}
