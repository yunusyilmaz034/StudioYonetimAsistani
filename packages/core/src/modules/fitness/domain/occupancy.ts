import type { FitnessOccupancyConfig, OccupancyLevel } from './types'

// What a studio gets before its owner has set a capacity. Capacity 0 means "unset" — the level is
// then unknown (null), and the UI says so rather than inventing a band. The fractions are a sensible
// starting point a boutique studio can keep or change.
export const DEFAULT_FITNESS_CONFIG: FitnessOccupancyConfig = {
  capacity: 0,
  moderateAt: 0.4,
  busyAt: 0.7,
  veryBusyAt: 0.9,
}

// The anonymous band a headcount maps to. PURE. Returns null when capacity is unset (0 or less) —
// without a capacity there is no honest ratio, and a made-up "Sakin" would be worse than "—".
// Thresholds are read as ascending fractions of capacity; a misordered config still resolves
// deterministically because the checks run low→high.
export function occupancyLevel(occupancy: number, config: FitnessOccupancyConfig): OccupancyLevel | null {
  if (config.capacity <= 0) return null
  const ratio = Math.max(0, occupancy) / config.capacity
  if (ratio < config.moderateAt) return 'quiet'
  if (ratio < config.busyAt) return 'moderate'
  if (ratio < config.veryBusyAt) return 'busy'
  return 'very_busy'
}
