// Sensitive-topic gate switch (client-safe; no DB imports): opt-in, default
// OFF, one boolean inside the user_preferences jsonb. The only writer is
// lib/data/kairos-sensitive.ts.
export const SENSITIVE_GATE_PREF_KEY = 'kairosSensitiveGate'
export const SENSITIVE_GATE_DEFAULT = false
