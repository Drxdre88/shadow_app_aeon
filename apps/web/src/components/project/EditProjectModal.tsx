'use client'

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Loader2, Palette, Check, Bot } from 'lucide-react'
import Image from 'next/image'
import { cn } from '@/lib/utils/cn'
import { NeonButton } from '@/components/ui/NeonButton'
import { updateProject } from '@/lib/actions/projects'
import { addProjectToGroup, removeProjectFromGroup } from '@/lib/actions/workspaces'
import { useRouter } from 'next/navigation'
import { useThemeStore } from '@/stores/themeStore'
import aeonLogo from '@/assets/aeon.png'
import { ColorSwatchPicker } from '@/components/board/ColorSwatchPicker'
import { listProjectColumnsForHangar, setHangarBoardSettings } from '@/lib/actions/hangar'
import { parseHangarConfig, useHangarUiStore } from '@/lib/store/hangarUiStore'
import { PlanetPicker } from './PlanetPicker'
import { AccentColor, colorConfig, hexToAccent } from '@/lib/utils/colors'
import type { RealmInfo } from './ProjectContextMenu'
import type { Project } from '@/lib/db/schema'

interface EditProjectModalProps {
  isOpen: boolean
  project: Project
  onClose: () => void
  existingGroups?: string[]
  realms?: RealmInfo[]
  projectRealmIds?: string[]
  onRealmToggled?: () => void
}

export function EditProjectModal({ isOpen, project, onClose, existingGroups = [], realms = [], projectRealmIds = [], onRealmToggled }: EditProjectModalProps) {
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const { glowIntensity, projectColors, setProjectColor } = useThemeStore()
  const mult = glowIntensity / 75
  const [colorPickerOpen, setColorPickerOpen] = useState(false)
  const currentColor = (projectColors[project.id] || 'purple') as string
  const accentColor = hexToAccent(currentColor)
  const currentColorHex = currentColor.startsWith('#')
    ? currentColor
    : colorConfig[currentColor as AccentColor]?.hex ?? '#a855f7'
  const [formData, setFormData] = useState({
    name: project.name,
    description: project.description || '',
    planetImage: project.planetImage || '',
    startDate: new Date(project.startDate).toISOString().split('T')[0],
    endDate: new Date(project.endDate).toISOString().split('T')[0],
  })
  const [activeRealmIds, setActiveRealmIds] = useState<string[]>(projectRealmIds)
  const [togglingRealm, setTogglingRealm] = useState<string | null>(null)
  const [hangar, setHangar] = useState(() => parseHangarConfig(project.settings))
  // Fetched, not read from the board store: the dashboard never hydrates it,
  // so the picker would be empty exactly where boards are usually configured.
  const [boardColumns, setBoardColumns] = useState<{ id: string; name: string }[]>([])

  useEffect(() => {
    if (!isOpen) return
    let cancelled = false
    listProjectColumnsForHangar(project.id)
      .then((cols) => { if (!cancelled) setBoardColumns(cols) })
      .catch(() => { if (!cancelled) setBoardColumns([]) })
    return () => { cancelled = true }
  }, [isOpen, project.id])

  useEffect(() => {
    setActiveRealmIds(projectRealmIds)
  }, [projectRealmIds])

  const teamRealms = realms.filter((r) => !r.isPersonal)

  const handleRealmToggle = async (realmId: string) => {
    setTogglingRealm(realmId)
    const isIn = activeRealmIds.includes(realmId)
    try {
      if (isIn) {
        setActiveRealmIds((prev) => prev.filter((id) => id !== realmId))
        await removeProjectFromGroup(project.id, realmId)
      } else {
        setActiveRealmIds((prev) => [...prev, realmId])
        await addProjectToGroup(project.id, realmId)
      }
      onRealmToggled?.()
    } catch {
      setActiveRealmIds(isIn ? [...activeRealmIds, realmId] : activeRealmIds.filter((id) => id !== realmId))
    } finally {
      setTogglingRealm(null)
    }
  }

  const handleSubmit = async () => {
    if (!formData.name.trim() || isSubmitting) return
    setIsSubmitting(true)

    try {
      await updateProject(project.id, {
        name: formData.name.trim(),
        description: formData.description.trim() || null,
        startDate: formData.startDate,
        endDate: formData.endDate,
        planetImage: formData.planetImage || null,
      })
      // Auto AI config is its own action (SQL settings merge, owner-gated).
      // Trust what the SERVER stored, not the local draft: it drops a trigger
      // column that doesn't belong to this project, and a client that kept
      // believing in it would arm drops the server considers unarmed.
      const savedHangar = await setHangarBoardSettings(project.id, hangar)
      setHangar(savedHangar)
      useHangarUiStore.getState().setConfig(project.id, savedHangar)
      onClose()
      router.refresh()
    } catch (error) {
      console.error('Failed to update project:', error)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
    if (e.key === 'Escape') onClose()
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={handleKeyDown}
            className={cn(
              'w-full max-w-md p-4 sm:p-6 rounded-2xl relative overflow-hidden mx-3 sm:mx-0',
              'bg-gradient-to-b from-white/[0.08] to-black/40',
              'backdrop-blur-xl border border-white/[0.08]',
              'max-h-[90vh] overflow-y-auto'
            )}
            style={{
              boxShadow: glowIntensity > 0
                ? `0 0 ${50 * mult}px ${12 * mult}px ${currentColorHex}40`
                : undefined,
            }}
          >
            <div
              className="absolute top-0 left-6 right-6 h-[1.5px]"
              style={{
                background: `linear-gradient(90deg, transparent, ${currentColorHex}, transparent)`,
                boxShadow: `0 0 ${15 * mult}px ${3 * mult}px ${currentColorHex}60`,
              }}
            />
            <div
              className="absolute top-0 left-0 right-0 h-16 pointer-events-none"
              style={{ background: `linear-gradient(to bottom, ${currentColorHex}15, transparent)` }}
            />

            <div className="relative flex items-center justify-between mb-6">
              <div className="flex items-center gap-2">
                <Image
                  src={aeonLogo}
                  alt="Aeon"
                  width={22}
                  height={22}
                  className="rounded"
                  style={{ filter: 'drop-shadow(0 0 6px var(--glow-color))' }}
                />
                <h2 className="text-lg font-semibold text-white">Edit Project</h2>
              </div>
              <button
                onClick={onClose}
                className="p-2 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="relative space-y-4">
              <div>
                <label className="block text-sm text-[var(--text-muted)] mb-1.5">Project Name</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="My Project"
                  className={cn(
                    'w-full px-4 py-2.5 rounded-xl',
                    'bg-white/[0.05] border border-white/[0.1]',
                    'text-white placeholder-slate-500',
                    'focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/50 focus:border-[var(--primary)]/30',
                    'transition-all'
                  )}
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-sm text-[var(--text-muted)] mb-1.5">Description</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Optional description..."
                  rows={2}
                  className={cn(
                    'w-full px-4 py-2.5 rounded-xl resize-none',
                    'bg-white/[0.05] border border-white/[0.1]',
                    'text-white placeholder-slate-500',
                    'focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/50 focus:border-[var(--primary)]/30',
                    'transition-all'
                  )}
                />
              </div>

              {teamRealms.length > 0 && (
                <div>
                  <label className="block text-sm text-[var(--text-muted)] mb-1.5">Realms</label>
                  <div className="flex gap-2 flex-wrap">
                    {teamRealms.map((realm) => {
                      const isIn = activeRealmIds.includes(realm.id)
                      const isToggling = togglingRealm === realm.id
                      return (
                        <button
                          key={realm.id}
                          type="button"
                          disabled={isToggling}
                          onClick={() => handleRealmToggle(realm.id)}
                          className={cn(
                            'flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all',
                            isIn
                              ? 'bg-[var(--primary)]/15 text-[var(--primary)] border border-[var(--primary)]/30'
                              : 'bg-white/[0.05] text-slate-400 border border-white/[0.08] hover:bg-white/[0.1] hover:text-white',
                            isToggling && 'opacity-50'
                          )}
                        >
                          <div
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{ backgroundColor: realm.color.startsWith('#') ? realm.color : 'var(--primary)' }}
                          />
                          {realm.name}
                          {isIn && <Check className="w-3 h-3" />}
                        </button>
                      )
                    })}
                  </div>
                  <p className="text-[10px] text-slate-600 mt-1">Projects can belong to multiple team realms</p>
                </div>
              )}

              <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-3 space-y-3">
                <button
                  type="button"
                  onClick={() => setHangar({ ...hangar, enabled: !hangar.enabled })}
                  className="w-full flex items-center justify-between gap-3"
                  aria-pressed={hangar.enabled}
                >
                  <span className="flex items-center gap-2 min-w-0 text-left">
                    <Bot className="w-4 h-4 text-[var(--primary)] flex-shrink-0" />
                    <span>
                      <span className="block text-sm text-white">Auto AI</span>
                      <span className="block text-[10px] text-slate-500">Turn cards on this board into agent missions</span>
                    </span>
                  </span>
                  <span
                    className={cn(
                      'w-9 h-5 rounded-full relative transition-colors flex-shrink-0',
                      hangar.enabled ? 'bg-[var(--primary)]/70' : 'bg-white/15'
                    )}
                  >
                    <span
                      className={cn(
                        'absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform',
                        hangar.enabled ? 'translate-x-[18px]' : 'translate-x-0.5'
                      )}
                    />
                  </span>
                </button>

                {hangar.enabled && (
                  <div>
                    <label className="block text-xs text-[var(--text-muted)] mb-1.5">Launch column</label>
                    <select
                      value={hangar.triggerColumnId ?? ''}
                      onChange={(e) => setHangar({ ...hangar, triggerColumnId: e.target.value || null })}
                      className={cn(
                        'w-full px-3 py-2 rounded-lg text-sm [color-scheme:dark]',
                        'bg-white/[0.05] border border-white/[0.1] text-white',
                        'focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/50'
                      )}
                    >
                      <option value="">None — launch manually only</option>
                      {boardColumns.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                    <p className="text-[10px] text-slate-600 mt-1">
                      Dropping an armed mission card here launches it. Cards must have auto-run switched on individually.
                    </p>
                  </div>
                )}
              </div>

              <PlanetPicker
                value={formData.planetImage}
                onChange={(f) => setFormData({ ...formData, planetImage: f })}
              />

              <div>
                <label className="block text-sm text-[var(--text-muted)] mb-1.5">Card Color</label>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setColorPickerOpen(!colorPickerOpen)}
                    className={cn(
                      'flex items-center gap-2 px-3 py-2 rounded-xl',
                      'bg-white/[0.05] border border-white/[0.1] hover:bg-white/[0.08]',
                      'text-slate-400 hover:text-white transition-all'
                    )}
                  >
                    <div
                      className="w-5 h-5 rounded-full border border-white/20"
                      style={{ backgroundColor: currentColorHex, boxShadow: `0 0 8px ${currentColorHex}60` }}
                    />
                    <Palette className="w-3.5 h-3.5" />
                  </button>
                  <ColorSwatchPicker
                    value={currentColor}
                    onChange={(color) => { setProjectColor(project.id, color); setColorPickerOpen(false) }}
                    isOpen={colorPickerOpen}
                    onClose={() => setColorPickerOpen(false)}
                    swatchShape="circle"
                    animated
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-[var(--text-muted)] mb-1.5">Start Date</label>
                  <input
                    type="date"
                    value={formData.startDate}
                    onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                    className={cn(
                      'w-full px-4 py-2.5 rounded-xl',
                      'bg-white/[0.05] border border-white/[0.1]',
                      'text-white [color-scheme:dark]',
                      'focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/50 focus:border-[var(--primary)]/30',
                      'transition-all'
                    )}
                  />
                </div>
                <div>
                  <label className="block text-sm text-[var(--text-muted)] mb-1.5">End Date</label>
                  <input
                    type="date"
                    value={formData.endDate}
                    onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                    className={cn(
                      'w-full px-4 py-2.5 rounded-xl',
                      'bg-white/[0.05] border border-white/[0.1]',
                      'text-white [color-scheme:dark]',
                      'focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/50 focus:border-[var(--primary)]/30',
                      'transition-all'
                    )}
                  />
                </div>
              </div>
            </div>

            <div className="relative flex gap-3 mt-6 justify-end">
              <button
                onClick={onClose}
                className={cn(
                  'px-4 py-2 rounded-xl text-sm font-medium',
                  'bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.1]',
                  'text-slate-400 hover:text-white transition-all'
                )}
              >
                Cancel
              </button>
              <NeonButton
                onClick={handleSubmit}
                disabled={!formData.name.trim() || isSubmitting}
                color={accentColor}
                glowIntensity="md"
              >
                <span className="flex items-center justify-center gap-2">
                  {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
                  {isSubmitting ? 'Saving...' : 'Save'}
                </span>
              </NeonButton>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
