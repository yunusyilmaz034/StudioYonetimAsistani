import type { Clock, NewEvent, TenantContext } from '../../../shared'
import type { EnergyDay, EnergyProfile } from '../domain/types'

// State + events always commit together (#1). Infrastructure implements this; nothing else may.
export interface EnergyRepository {
  getProfile(ctx: TenantContext, memberId: string): Promise<EnergyProfile | null>
  /** Every member currently tracking — the evening summary walks this. */
  listProfiles(ctx: TenantContext): Promise<readonly EnergyProfile[]>
  saveProfile(ctx: TenantContext, profile: EnergyProfile, events: readonly NewEvent[]): Promise<void>
  /** Erases the profile AND every day of hers, with the event that says so. Returns nothing: it is gone. */
  eraseMember(ctx: TenantContext, memberId: string, events: readonly NewEvent[]): Promise<void>
  countDays(ctx: TenantContext, memberId: string): Promise<number>

  getDay(ctx: TenantContext, memberId: string, date: string): Promise<EnergyDay | null>
  /** Inclusive, studio-local dates. Days she entered nothing on have no document and are absent. */
  listDays(ctx: TenantContext, memberId: string, from: string, to: string): Promise<readonly EnergyDay[]>
  saveDay(ctx: TenantContext, day: EnergyDay, events: readonly NewEvent[]): Promise<void>
}

/** A programme day she ticked — read from the workout log, which stays the one record of it. */
export interface TickedWorkout {
  readonly workoutLogId: string
  readonly date: string
  readonly label: string
  readonly estimatedMinutes: number
}

/**
 * Where ticked programme days come from. A PORT, so this module never reaches into training's
 * documents: the composition root hands in an adapter over the training module's public door.
 */
export interface WorkoutSource {
  tickedBetween(ctx: TenantContext, memberId: string, from: string, to: string): Promise<readonly TickedWorkout[]>
}

export interface EnergyDeps {
  readonly repo: EnergyRepository
  readonly workouts: WorkoutSource
  readonly clock: Clock
  /** The studio's offset from UTC, in minutes — "today" is the studio's day, not the server's. */
  readonly utcOffsetMinutes: number
}
