import {
  getFirestore,
  Timestamp,
  type CollectionReference,
  type DocumentData,
  type DocumentReference,
  type Firestore,
  type WriteBatch,
} from 'firebase-admin/firestore'

import {
  instant,
  type ClassSessionId,
  type ClassTemplateId,
  type Instant,
  type NewEvent,
  type RoomId,
  type ServiceId,
  type StudioId,
  type TenantContext,
} from '../../../shared'
import { DEFAULT_TIME_ZONE } from '../../../shared'
import type { ClassSession, ClassTemplate, Room, Service, StudioSettings } from '../domain/types'
import type { SchedulingRepository } from '../application/ports'
import {
  eventToFirestore,
  roomFromFirestore,
  roomToFirestore,
  serviceFromFirestore,
  serviceToFirestore,
  sessionFromFirestore,
  sessionToFirestore,
  templateFromFirestore,
  templateToFirestore,
} from './mappers'

export class FirestoreSchedulingRepository implements SchedulingRepository {
  constructor(private readonly db: Firestore = getFirestore()) {}

  private col(sid: StudioId, name: string): CollectionReference {
    return this.db.collection('studios').doc(sid).collection(name)
  }

  private appendEvents(sid: StudioId, batch: WriteBatch, events: readonly NewEvent[]): void {
    for (const e of events) {
      const { id, data } = eventToFirestore(e)
      batch.set(this.col(sid, 'events').doc(id), data)
    }
  }

  private async commit(
    sid: StudioId,
    ref: DocumentReference,
    data: DocumentData,
    events: readonly NewEvent[],
  ): Promise<void> {
    const batch = this.db.batch()
    batch.set(ref, data)
    this.appendEvents(sid, batch, events)
    await batch.commit()
  }

  // D14 — studio settings live in ONE well-known document per studio (`/studios/{sid}/settings/studio`),
  // not scattered across the app. Absent ⇒ the studio was never provisioned with a default, and
  // the chain will refuse rather than invent one.
  async getStudioSettings(ctx: TenantContext): Promise<StudioSettings | null> {
    const s = await this.col(ctx.studioId, 'settings').doc('studio').get()
    const d = s.data()
    if (!d) return null
    return {
      studioId: ctx.studioId,
      defaultCancellationWindowHours:
        (d.defaultCancellationWindowHours as number | null | undefined) ?? null,
      lowCreditThreshold: (d.lowCreditThreshold as number | null | undefined) ?? null,
      discountCeilingPercent: (d.discountCeilingPercent as number | null | undefined) ?? null,
      defaultSessionDurationMinutes:
        (d.defaultSessionDurationMinutes as number | null | undefined) ?? null,
      // A studio provisioned before v1.27 has no stored zone. It is in Türkiye — every studio is,
      // today — and saying so is honest; inventing UTC would put its whole day three hours out.
      timeZone: (d.timeZone as string | undefined) ?? DEFAULT_TIME_ZONE,
      company: (d.company as StudioSettings['company'] | undefined) ?? null,
      workingHours: (d.workingHours as StudioSettings['workingHours'] | undefined) ?? null,
      qr: (d.qr as StudioSettings['qr'] | undefined) ?? null,
      notifications: (d.notifications as StudioSettings['notifications'] | undefined) ?? null,
    }
  }
  async saveStudioSettings(
    ctx: TenantContext,
    settings: StudioSettings,
    events: readonly NewEvent[],
  ): Promise<void> {
    await this.commit(
      ctx.studioId,
      this.col(ctx.studioId, 'settings').doc('studio'),
      {
        defaultCancellationWindowHours: settings.defaultCancellationWindowHours,
        lowCreditThreshold: settings.lowCreditThreshold,
        discountCeilingPercent: settings.discountCeilingPercent,
        defaultSessionDurationMinutes: settings.defaultSessionDurationMinutes,
        timeZone: settings.timeZone,
        company: settings.company,
        workingHours: settings.workingHours,
        qr: settings.qr,
        notifications: settings.notifications,
      },
      events,
    )
  }

  async getService(ctx: TenantContext, id: ServiceId): Promise<Service | null> {
    const s = await this.col(ctx.studioId, 'services').doc(id).get()
    const d = s.data()
    return d ? serviceFromFirestore(id, d) : null
  }
  async saveService(ctx: TenantContext, service: Service, events: readonly NewEvent[]): Promise<void> {
    await this.commit(
      ctx.studioId,
      this.col(ctx.studioId, 'services').doc(service.id),
      serviceToFirestore(service),
      events,
    )
  }

  async listServices(ctx: TenantContext): Promise<readonly Service[]> {
    const snap = await this.col(ctx.studioId, 'services').get()
    return snap.docs.map((d) => serviceFromFirestore(d.id as ServiceId, d.data()))
  }

  async getRoom(ctx: TenantContext, id: RoomId): Promise<Room | null> {
    const s = await this.col(ctx.studioId, 'rooms').doc(id).get()
    const d = s.data()
    return d ? roomFromFirestore(id, d) : null
  }
  async saveRoom(ctx: TenantContext, room: Room, events: readonly NewEvent[]): Promise<void> {
    await this.commit(
      ctx.studioId,
      this.col(ctx.studioId, 'rooms').doc(room.id),
      roomToFirestore(room),
      events,
    )
  }

  async listRooms(ctx: TenantContext): Promise<readonly Room[]> {
    const snap = await this.col(ctx.studioId, 'rooms').get()
    return snap.docs.map((d) => roomFromFirestore(d.id as RoomId, d.data()))
  }

  async getTemplate(ctx: TenantContext, id: ClassTemplateId): Promise<ClassTemplate | null> {
    const s = await this.col(ctx.studioId, 'classTemplates').doc(id).get()
    const d = s.data()
    return d ? templateFromFirestore(id, d) : null
  }
  async saveTemplate(
    ctx: TenantContext,
    template: ClassTemplate,
    events: readonly NewEvent[],
  ): Promise<void> {
    await this.commit(
      ctx.studioId,
      this.col(ctx.studioId, 'classTemplates').doc(template.id),
      templateToFirestore(template),
      events,
    )
  }

  async getSession(ctx: TenantContext, id: ClassSessionId): Promise<ClassSession | null> {
    const s = await this.col(ctx.studioId, 'classSessions').doc(id).get()
    const d = s.data()
    return d ? sessionFromFirestore(id, d) : null
  }
  async saveSession(
    ctx: TenantContext,
    session: ClassSession,
    events: readonly NewEvent[],
  ): Promise<void> {
    await this.commit(
      ctx.studioId,
      this.col(ctx.studioId, 'classSessions').doc(session.id),
      sessionToFirestore(session),
      events,
    )
  }

  async listTemplates(ctx: TenantContext): Promise<readonly ClassTemplate[]> {
    const snap = await this.col(ctx.studioId, 'classTemplates').get()
    return snap.docs.map((d) => templateFromFirestore(d.id as ClassTemplateId, d.data()))
  }

  async listSessionStartsForTemplate(
    ctx: TenantContext,
    templateId: ClassTemplateId,
  ): Promise<readonly Instant[]> {
    const snap = await this.col(ctx.studioId, 'classSessions')
      .where('templateId', '==', templateId)
      .get()
    return snap.docs.map((doc) => instant((doc.data().startsAt as Timestamp).toMillis()))
  }

  async listSessionsForDay(
    ctx: TenantContext,
    fromInclusive: Instant,
    toExclusive: Instant,
  ): Promise<readonly ClassSession[]> {
    const snap = await this.col(ctx.studioId, 'classSessions')
      .where('startsAt', '>=', Timestamp.fromMillis(fromInclusive))
      .where('startsAt', '<', Timestamp.fromMillis(toExclusive))
      .orderBy('startsAt', 'asc')
      .get()
    return snap.docs.map((doc) => sessionFromFirestore(doc.id as ClassSessionId, doc.data()))
  }

  async saveSessions(
    ctx: TenantContext,
    sessions: readonly ClassSession[],
    events: readonly NewEvent[],
  ): Promise<void> {
    const batch = this.db.batch()
    for (const s of sessions) {
      batch.set(this.col(ctx.studioId, 'classSessions').doc(s.id), sessionToFirestore(s))
    }
    this.appendEvents(ctx.studioId, batch, events)
    await batch.commit()
  }
}
