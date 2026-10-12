# energy — "bugün kaç kalori yaktın?" (owner, 2026-10-13)

The member's own daily account of what her body spent: the resting figure, plus what she **declares**
she did — steps, a ticked programme day, a session on a cardio machine.

## Public API

`startEnergyTracking` · `updateEnergyProfile` · `stopEnergyTracking` · `logEnergySteps` ·
`logEnergyCardio` · `removeEnergyCardio` · `setEnergyWorkoutMinutes` · `energyDays` (read).
Pure arithmetic: `basalKcal` · `stepsKcal` · `workoutKcal` · `cardioKcal` · `estimateWorkoutMinutes` · `dayView`.

## The invariants this module owns

1. **Health data never enters an event.** Weight, height, body fat — and every number computed from
   them. Steps beside the calories they produced give the weight back with one division, so events
   carry neither; they record that something was declared, for which day, of what kind.
2. **Everything here is a declaration, never an observation (#11).** It feeds this screen only. It is
   never added to attendance, occupancy or continuity — those read check-ins and nothing else.
3. **Refused, never clamped.** A slipped decimal ("640" kg) clamped to a ceiling would be a confident
   wrong number every day afterwards. Out of range ⇒ the field is named and nothing is stored.
4. **Consent or nothing.** `decideStartTracking` refuses without it; the UI cannot forget it.
5. **Stopping erases.** The profile and every day are deleted; one event says it happened.
6. **A day is a snapshot.** `weightKg` and `basalKcal` are stamped when the day is first written; a
   later profile change does not rewrite an earlier day.
7. **Activity is counted net of rest.** The day already counts 24 resting hours; an hour at 3.5 MET
   adds 2.5. A machine's displayed figure is gross and has the resting burn taken off it too.
8. **The workout log stays the one record that she trained.** A ticked programme day is derived at
   read time, never copied; only her *correction to its duration* is stored here.
9. **Sex is data on the profile, never assumed in code.** The first studio is women-only and its
   wizard does not ask; the caller supplies it.

## Not here (yet)

Calorie/protein targets and meal plans (step 2 — admin-assigned, waiting on content). Steps read from
the phone's health store. Food logging.
