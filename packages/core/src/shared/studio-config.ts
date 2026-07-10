// Studio-level configuration. Phase 1 carries a fixed UTC offset (AD-52): Türkiye
// is UTC+3 year-round (no DST since 2016). When a Studio entity gains an IANA
// timezone, `utcOffsetMinutes` is derived from it — a seamless migration, because
// stored `startsAt` values are already UTC Instants and templates are already
// wall-clock only.
export interface StudioConfig {
  readonly utcOffsetMinutes: number
}

// The single named source of the Phase 1 offset — never inline a magic number.
export const DEFAULT_STUDIO_CONFIG: StudioConfig = {
  utcOffsetMinutes: 180, // Europe/Istanbul, UTC+3
}
