'use client'

import { useState, useEffect } from 'react'
import { Loader2, Camera, Save } from 'lucide-react'
import { useThemeStore } from '@/stores/themeStore'
import { getSettingsTemplate, saveSettingsTemplate } from '@/lib/actions/settingsTemplates'

const TEMPLATE_NAME = 'business_admin'

// Mirror of _hydrateFromDB's SAFE_PREF_KEYS, minus per-account data that must
// never be baked into a template stamped onto every new user (projectColors is
// keyed by the admin's own project UUIDs).
const TEMPLATE_KEYS = new Set([
  'currentTheme', 'glowSource', 'glowIntensity', 'glassOpacity', 'themeSaturation',
  'themeBrightness', 'surfaceVibrancy', 'ambientBlobs', 'fontFamily', 'dragEffect',
  'cursorEffect', 'cursorColor', 'columnWidth', 'columnHeight', 'dynamicColumnWidth',
  'dynamicColumnHeight', 'smokeVolume', 'depLineWidth', 'depLineGlow', 'depLineStyle',
  'depCanvasBlur', 'spacePlanetGlow', 'spaceOrbitSpeed', 'boardLayout',
  'depViewMode', 'completionMode', 'boardActionToasts', 'smoothUiRenders', 'shortcuts', 'priorities',
  'defaultProjectView', 'defaultProjectSort', 'cardPreviewOnHover', 'celebrationStyle', 'businessMode',
])

function snapshotCurrentPreferences() {
  const state = useThemeStore.getState() as unknown as Record<string, unknown>
  const prefs: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(state)) {
    if (!TEMPLATE_KEYS.has(key) || typeof value === 'function') continue
    prefs[key] = value
  }
  return prefs
}

export function DefaultsTemplateTab() {
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    getSettingsTemplate(TEMPLATE_NAME)
      .then((tpl) => {
        if (cancelled) return
        setDraft(JSON.stringify(tpl.preferences, null, 2))
        setStatus(tpl.exists ? 'Loaded saved template' : 'No template saved yet — showing built-in fallback')
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load template')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  const handleSnapshot = () => {
    setDraft(JSON.stringify(snapshotCurrentPreferences(), null, 2))
    setError(null)
    setStatus('Snapshot taken — review, then save')
  }

  const handleSave = async () => {
    let parsed: unknown
    try {
      parsed = JSON.parse(draft)
    } catch {
      setError('Invalid JSON')
      setStatus(null)
      return
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      setError('Template must be a JSON object')
      setStatus(null)
      return
    }
    setSaving(true)
    setError(null)
    try {
      await saveSettingsTemplate(TEMPLATE_NAME, parsed as Record<string, unknown>)
      setStatus('Template saved — applies to accounts created from now on')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save template')
      setStatus(null)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3 max-w-2xl">
      <div>
        <h4 className="text-xs font-medium text-slate-400 uppercase tracking-wider">Defaults Template</h4>
        <p className="text-[10px] text-slate-600 mt-1">
          Preferences stamped onto every new account at first login. Existing accounts are untouched.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-slate-500 py-6">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading template...
        </div>
      ) : (
        <>
          <textarea
            value={draft}
            onChange={(e) => { setDraft(e.target.value); setError(null) }}
            spellCheck={false}
            rows={16}
            className="w-full px-3 py-2 rounded-xl bg-black/30 border border-white/10 text-slate-200 text-xs font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-white/20 resize-y"
          />

          <div className="flex items-center gap-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium border border-[var(--primary)]/40 bg-[var(--primary)]/10 text-white hover:bg-[var(--primary)]/20 transition-colors disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              Save template
            </button>
            <button
              onClick={handleSnapshot}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium border border-white/10 bg-white/[0.03] text-slate-300 hover:bg-white/[0.06] transition-colors"
            >
              <Camera className="w-3.5 h-3.5" />
              Snapshot my current settings
            </button>
          </div>

          {error && <p className="text-[11px] text-red-400">{error}</p>}
          {!error && status && <p className="text-[11px] text-slate-500">{status}</p>}
        </>
      )}
    </div>
  )
}
