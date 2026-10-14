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
  MealEntry,
  MealItem,
  MealPortion,
  MealSlot,
  StepsEntry,
  WorkoutLine,
} from './domain/types'
export { CARDIO_MACHINES, ENERGY_GOALS, MEAL_PORTIONS, MEAL_SLOTS } from './domain/types'
export * from './events'
export { ageOn, basalKcal, cardioKcal, dayView, estimateWorkoutMinutes, mealItemKcal, minutesFromDisplayedKcal, roundForDisplay, stepsKcal, summaryIsDue, workoutKcal } from './domain/calc'
export {
  ENERGY_LIMITS,
  decideLogCardio,
  decideLogMeal,
  decideLogSteps,
  decideRemoveCardio,
  decideRemoveMeal,
  decideSetMealPrefs,
  decideSetWorkoutMinutes,
  decideUpdateMeal,
  decideStartTracking,
  decideStopTracking,
  decideUpdateProfile,
  energyDayId,
} from './domain/decide'
export type { CardioInput, MealInput, MealItemInput, ProfileInput } from './domain/decide'
export {
  energyDays,
  energyToday,
  logEnergyCardio,
  logEnergyMeal,
  logEnergySteps,
  removeEnergyCardio,
  removeEnergyMeal,
  setEnergyMealPrefs,
  updateEnergyMeal,
  setEnergyWorkoutMinutes,
  startEnergyTracking,
  stopEnergyTracking,
  updateEnergyProfile,
} from './application'
export type { EnergyDeps, EnergyRepository, TickedWorkout, WorkoutSource } from './application'
export { FirestoreEnergyRepository } from './infrastructure/repos'
export { TrainingWorkoutSource } from './infrastructure/workout-source'
