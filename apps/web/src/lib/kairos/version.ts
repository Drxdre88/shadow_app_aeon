// Single source of truth for the Kairos version pill. Log of what shipped at
// each version lives in docs/kairos/CHANGELOG.md.
export const KAIROS_VERSION = '0.10.0'

// Major.minor only, for the compact sidebar/modal pill (e.g. "0.9").
export const KAIROS_VERSION_SHORT = KAIROS_VERSION.split('.').slice(0, 2).join('.')
