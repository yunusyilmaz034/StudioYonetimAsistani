import type { TenantContext } from '../../../shared'
import type { TrainingRepository } from '../../training'
import type { TickedWorkout, WorkoutSource } from '../application/ports'
import { estimateWorkoutMinutes } from '../domain/calc'

/**
 * Ticked programme days, read through the training module's public door.
 *
 * The workout log stays the ONE record that she trained: this copies nothing, so undoing a day there
 * removes it from her energy account with nothing to keep in step. A log whose programme or version
 * can no longer be found still counts — she did train — with a neutral label and no exercises to
 * estimate from, which `estimateWorkoutMinutes` turns into its floor.
 */
export class TrainingWorkoutSource implements WorkoutSource {
  constructor(private readonly training: Pick<TrainingRepository, 'listWorkoutLogsByMember' | 'getProgram'>) {}

  async tickedBetween(ctx: TenantContext, memberId: string, from: string, to: string): Promise<readonly TickedWorkout[]> {
    const logs = (await this.training.listWorkoutLogsByMember(ctx, memberId)).filter(
      (l) => l.undoneAt === null && l.performedOn >= from && l.performedOn <= to,
    )
    const programIds = [...new Set(logs.map((l) => l.programId))]
    const programs = new Map(await Promise.all(programIds.map(async (id) => [id, await this.training.getProgram(ctx, id)] as const)))
    return logs.map((l) => {
      const program = programs.get(l.programId) ?? null
      const day = program?.versions.find((v) => v.version === l.programVersion)?.days.find((d) => d.order === l.dayOrder) ?? null
      return {
        workoutLogId: l.id,
        date: l.performedOn,
        label: [program?.title, day?.name].filter(Boolean).join(' · ') || 'Antrenman',
        estimatedMinutes: estimateWorkoutMinutes(day?.exercises ?? []),
      }
    })
  }
}
