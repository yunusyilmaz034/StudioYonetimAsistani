// The energy module's public door (owner, 2026-10-13) — the member's own daily account of what she
// burned. Everything in it is her DECLARATION; none of it is attendance. Health data never enters an
// event. Read README.md first.
export type {
  CardioEntry,
  CardioMachine,
  EnergyDay,
  EnergyDayView,
  EnergyGoal,
  EnergyProfile,
  EnergySex,
  StepsEntry,
  WorkoutLine,
} from './domain/types'
export { CARDIO_MACHINES, ENERGY_GOALS } from './domain/types'
export * from './events'
export { ageOn, basalKcal, cardioKcal, dayView, estimateWorkoutMinutes, roundForDisplay, stepsKcal, workoutKcal } from './domain/calc'
export {
  ENERGY_LIMITS,
  decideLogCardio,
  decideLogSteps,
  decideRemoveCardio,
  decideSetWorkoutMinutes,
  decideStartTracking,
  decideStopTracking,
  decideUpdateProfile,
  energyDayId,
} from './domain/decide'
export type { CardioInput, ProfileInput } from './domain/decide'
export {
  energyDays,
  energyToday,
  logEnergyCardio,
  logEnergySteps,
  removeEnergyCardio,
  setEnergyWorkoutMinutes,
  startEnergyTracking,
  stopEnergyTracking,
  updateEnergyProfile,
} from './application'
export type { EnergyDeps, EnergyRepository, TickedWorkout, WorkoutSource } from './application'
export { FirestoreEnergyRepository } from './infrastructure/repos'
export { TrainingWorkoutSource } from './infrastructure/workout-source'
