import {
  getFirestore,
  Timestamp,
  type CollectionReference,
  type DocumentData,
  type Firestore,
  type Transaction,
} from 'firebase-admin/firestore'

import { instant, newEventId, type NewEvent, type StudioId, type TenantContext } from '../../../shared'
import type { Exercise, Measurement, Program, ProgramVersion, ProgressPhoto, TrainingFeedback } from '../domain/types'

// The training module's ONLY firebase-admin importer. State document(s) + their events commit together
// (#1): a programme version published without its event, or a photo removed without its audit event,
// leaves the log lying. Photos and measurements are member PII — their VALUES live here on
// member-scoped state, never in an event (#6). The Storage FILE is not touched here; only its path.

const ts = (ms: number): Timestamp => Timestamp.fromMillis(ms)
const ms = (v: unknown): number => (v instanceof Timestamp ? v.toMillis() : typeof v === 'number' ? v : 0)

const versionTo = (v: ProgramVersion): DocumentData => ({ ...v, publishedAt: ts(v.publishedAt) })
const versionFrom = (d: DocumentData): ProgramVersion => ({ ...(d as ProgramVersion), publishedAt: instant(ms(d.publishedAt)) })

const programTo = (p: Program): DocumentData => ({
  ...p,
  versions: p.versions.map(versionTo),
  createdAt: ts(p.createdAt),
  updatedAt: ts(p.updatedAt),
})
const programFrom = (id: string, d: DocumentData): Program => ({
  ...(d as Program),
  id,
  versions: Array.isArray(d.versions) ? d.versions.map(versionFrom) : [],
  createdAt: instant(ms(d.createdAt)),
  updatedAt: instant(ms(d.updatedAt)),
})

const exerciseTo = (e: Exercise): DocumentData => ({ ...e, updatedAt: ts(e.updatedAt) })
const exerciseFrom = (id: string, d: DocumentData): Exercise => ({ ...(d as Exercise), id, updatedAt: instant(ms(d.updatedAt)) })

const measurementTo = (m: Measurement): DocumentData => ({ ...m, recordedAt: ts(m.recordedAt) })
const measurementFrom = (id: string, d: DocumentData): Measurement => ({ ...(d as Measurement), id, recordedAt: instant(ms(d.recordedAt)) })

const feedbackTo = (f: TrainingFeedback): DocumentData => ({
  ...f,
  createdAt: ts(f.createdAt),
  answeredAt: f.answeredAt ? ts(f.answeredAt) : null,
})
const feedbackFrom = (id: string, d: DocumentData): TrainingFeedback => ({
  ...(d as TrainingFeedback),
  id,
  createdAt: instant(ms(d.createdAt)),
  answeredAt: d.answeredAt ? instant(ms(d.answeredAt)) : null,
})

const photoTo = (p: ProgressPhoto): DocumentData => ({ ...p, uploadedAt: ts(p.uploadedAt) })
const photoFrom = (id: string, d: DocumentData): ProgressPhoto => ({ ...(d as ProgressPhoto), id, uploadedAt: instant(ms(d.uploadedAt)) })

export class FirestoreTrainingRepository {
  constructor(private readonly db: Firestore = getFirestore()) {}

  private col(sid: StudioId, name: string): CollectionReference {
    return this.db.collection('studios').doc(sid).collection(name)
  }
  private writeEvents(sid: StudioId, tx: Transaction, events: readonly NewEvent[]): void {
    for (const e of events) {
      tx.set(this.col(sid, 'events').doc(newEventId()), { ...e, occurredAt: ts(e.occurredAt), recordedAt: Timestamp.now() })
    }
  }

  // ── Exercise library ──
  async getExercise(ctx: TenantContext, id: string): Promise<Exercise | null> {
    const s = await this.col(ctx.studioId, 'exercises').doc(id).get()
    const d = s.data()
    return d ? exerciseFrom(id, d) : null
  }
  async listExercises(ctx: TenantContext): Promise<readonly Exercise[]> {
    const snap = await this.col(ctx.studioId, 'exercises').orderBy('nameTr').get()
    return snap.docs.map((d) => exerciseFrom(d.id, d.data()))
  }
  async saveExercise(ctx: TenantContext, exercise: Exercise, events: readonly NewEvent[]): Promise<void> {
    const sid = ctx.studioId
    await this.db.runTransaction(async (tx) => {
      tx.set(this.col(sid, 'exercises').doc(exercise.id), exerciseTo(exercise))
      this.writeEvents(sid, tx, events)
    })
  }

  // ── Programmes ──
  async getProgram(ctx: TenantContext, id: string): Promise<Program | null> {
    const s = await this.col(ctx.studioId, 'programs').doc(id).get()
    const d = s.data()
    return d ? programFrom(id, d) : null
  }
  async listProgramsByMember(ctx: TenantContext, memberId: string): Promise<readonly Program[]> {
    const snap = await this.col(ctx.studioId, 'programs').where('memberId', '==', memberId).get()
    return snap.docs.map((d) => programFrom(d.id, d.data())).sort((a, b) => b.createdAt - a.createdAt)
  }
  async listProgramsByTrainer(ctx: TenantContext, trainerId: string): Promise<readonly Program[]> {
    const snap = await this.col(ctx.studioId, 'programs').where('trainerId', '==', trainerId).get()
    return snap.docs.map((d) => programFrom(d.id, d.data())).sort((a, b) => b.createdAt - a.createdAt)
  }
  async saveProgram(ctx: TenantContext, program: Program, events: readonly NewEvent[]): Promise<void> {
    const sid = ctx.studioId
    await this.db.runTransaction(async (tx) => {
      tx.set(this.col(sid, 'programs').doc(program.id), programTo(program))
      this.writeEvents(sid, tx, events)
    })
  }

  // ── Measurements (a history — every reading a new record) ──
  async listMeasurementsByMember(ctx: TenantContext, memberId: string): Promise<readonly Measurement[]> {
    const snap = await this.col(ctx.studioId, 'measurements').where('memberId', '==', memberId).get()
    return snap.docs.map((d) => measurementFrom(d.id, d.data())).sort((a, b) => a.takenOn.localeCompare(b.takenOn))
  }
  async saveMeasurement(ctx: TenantContext, measurement: Measurement, events: readonly NewEvent[]): Promise<void> {
    const sid = ctx.studioId
    await this.db.runTransaction(async (tx) => {
      tx.set(this.col(sid, 'measurements').doc(measurement.id), measurementTo(measurement))
      this.writeEvents(sid, tx, events)
    })
  }

  // ── Feedback ──
  async getFeedback(ctx: TenantContext, id: string): Promise<TrainingFeedback | null> {
    const s = await this.col(ctx.studioId, 'trainingFeedback').doc(id).get()
    const d = s.data()
    return d ? feedbackFrom(id, d) : null
  }
  async listFeedbackByMember(ctx: TenantContext, memberId: string): Promise<readonly TrainingFeedback[]> {
    const snap = await this.col(ctx.studioId, 'trainingFeedback').where('memberId', '==', memberId).get()
    return snap.docs.map((d) => feedbackFrom(d.id, d.data())).sort((a, b) => b.createdAt - a.createdAt)
  }
  async listOpenFeedback(ctx: TenantContext): Promise<readonly TrainingFeedback[]> {
    const snap = await this.col(ctx.studioId, 'trainingFeedback').where('status', 'in', ['open', 'answered']).get()
    return snap.docs.map((d) => feedbackFrom(d.id, d.data())).sort((a, b) => b.createdAt - a.createdAt)
  }
  async saveFeedback(ctx: TenantContext, feedback: TrainingFeedback, events: readonly NewEvent[]): Promise<void> {
    const sid = ctx.studioId
    await this.db.runTransaction(async (tx) => {
      tx.set(this.col(sid, 'trainingFeedback').doc(feedback.id), feedbackTo(feedback))
      this.writeEvents(sid, tx, events)
    })
  }

  // ── Progress photos (metadata; the FILE lives in Storage, a signed URL minted on read) ──
  async getPhoto(ctx: TenantContext, id: string): Promise<ProgressPhoto | null> {
    const s = await this.col(ctx.studioId, 'progressPhotos').doc(id).get()
    const d = s.data()
    return d ? photoFrom(id, d) : null
  }
  async listPhotosByMember(ctx: TenantContext, memberId: string): Promise<readonly ProgressPhoto[]> {
    const snap = await this.col(ctx.studioId, 'progressPhotos').where('memberId', '==', memberId).get()
    return snap.docs.map((d) => photoFrom(d.id, d.data())).sort((a, b) => a.takenOn.localeCompare(b.takenOn))
  }
  async savePhoto(ctx: TenantContext, photo: ProgressPhoto, events: readonly NewEvent[]): Promise<void> {
    const sid = ctx.studioId
    await this.db.runTransaction(async (tx) => {
      tx.set(this.col(sid, 'progressPhotos').doc(photo.id), photoTo(photo))
      this.writeEvents(sid, tx, events)
    })
  }
  async deletePhoto(ctx: TenantContext, id: string, events: readonly NewEvent[]): Promise<void> {
    const sid = ctx.studioId
    await this.db.runTransaction(async (tx) => {
      tx.delete(this.col(sid, 'progressPhotos').doc(id))
      this.writeEvents(sid, tx, events)
    })
  }
}
