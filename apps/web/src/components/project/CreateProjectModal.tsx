'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Loader2, LayoutGrid, Bug, Palette, Check } from 'lucide-react'
import Image from 'next/image'
import { cn } from '@/lib/utils/cn'
import { NeonButton } from '@/components/ui/NeonButton'
import { createProject, updateProject } from '@/lib/actions/projects'
import { addProjectToGroup } from '@/lib/actions/workspaces'
import { PlanetPicker } from './PlanetPicker'
import { useRouter } from 'next/navigation'
import { useThemeStore } from '@/stores/themeStore'
import aeonLogo from '@/assets/aeon.png'
import { ColorSwatchPicker } from '@/components/board/ColorSwatchPicker'
import { AccentColor, colorConfig } from '@/lib/utils/colors'
import type { RealmInfo } from './ProjectContextMenu'

interface CreateProjectModalProps {
  isOpen: boolean
  onClose: () => void
  realms?: RealmInfo[]
  onProjectCreated?: () => void
}

export function CreateProjectModal({ isOpen, onClose, realms = [], onProjectCreated }: CreateProjectModalProps) {
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const { glowIntensity, setProjectColor } = useThemeStore()
  const mult = glowIntensity / 75
  const [template, setTemplate] = useState('default')
  const [colorPickerOpen, setColorPickerOpen] = useState(false)
  const [selectedRealmIds, setSelectedRealmIds] = useState<string[]>([])
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    planetImage: '',
    color: '#c8cdd3',
    startDate: new Date().toISOString().split('T')[0],
    endDate: `${new Date().getFullYear()}-12-31`,
  })

  const teamRealms = realms.filter((r) => !r.isPersonal)

  const handleRealmToggle = (realmId: string) => {
    setSelectedRealmIds((prev) =>
      prev.includes(realmId) ? prev.filter((id) => id !== realmId) : [...prev, realmId]
    )
  }

  const handleSubmit = async () => {
    if (!formData.name.trim() || isSubmitting) return
    setIsSubmitting(true)

    try {
      const project = await createProject({
        name: formData.name.trim(),
        description: formData.description.trim() || undefined,
        startDate: formData.startDate,
        endDate: formData.endDate,
        template,
      })
      for (const realmId of selectedRealmIds) {
        await addProjectToGroup(project.id, realmId)
      }
      if (formData.planetImage) {
        await updateProject(project.id, { planetImage: formData.planetImage })
      }
      setProjectColor(project.id, formData.color)
      setSelectedRealmIds([])
      setFormData({ name: '', description: '', planetImage: '', color: '#c8cdd3', startDate: new Date().toISOString().split('T')[0], endDate: `${new Date().getFullYear()}-12-31` })
      onProjectCreated?.()
      onClose()
      router.refresh()
      router.push(`/project/${project.id}`)
    } catch (error) {
      console.error('Failed to create project:', error)
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
                ? `0 0 ${50 * mult}px ${12 * mult}px var(--glow-color)`
                : undefined,
            }}
          >
            <div
              className="absolute top-0 left-6 right-6 h-[1.5px]"
              style={{
                background: 'linear-gradient(90deg, transparent, var(--primary), transparent)',
                boxShadow: `0 0 ${15 * mult}px ${3 * mult}px var(--glow-color)`,
              }}
            />
            <div
              className="absolute top-0 left-0 right-0 h-16 pointer-events-none"
              style={{ background: 'linear-gradient(to bottom, var(--primary-muted), transparent)' }}
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
                <h2 className="text-lg font-semibold text-white">New Project</h2>
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
                      const isIn = selectedRealmIds.includes(realm.id)
                      return (
                        <button
                          key={realm.id}
                          type="button"
                          onClick={() => handleRealmToggle(realm.id)}
                          className={cn(
                            'flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all',
                            isIn
                              ? 'bg-[var(--primary)]/15 text-[var(--primary)] border border-[var(--primary)]/30'
                              : 'bg-white/[0.05] text-slate-400 border border-white/[0.08] hover:bg-white/[0.1] hover:text-white'
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
                      style={{
                        backgroundColor: formData.color.startsWith('#') ? formData.color : colorConfig[formData.color as AccentColor]?.hex ?? '#a855f7',
                        boxShadow: `0 0 8px ${formData.color.startsWith('#') ? formData.color : colorConfig[formData.color as AccentColor]?.hex ?? '#a855f7'}60`,
                      }}
                    />
                    <Palette className="w-3.5 h-3.5" />
                  </button>
                  <ColorSwatchPicker
                    value={formData.color}
                    onChange={(color) => { setFormData({ ...formData, color }); setColorPickerOpen(false) }}
                    isOpen={colorPickerOpen}
                    onClose={() => setColorPickerOpen(false)}
                    swatchShape="circle"
                    animated
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm text-[var(--text-muted)] mb-1.5">Board Template</label>
                <div className="flex gap-2">
                  {[
                    { id: 'default', label: 'Basic', icon: LayoutGrid, desc: 'Todo, Doing, Review, Done' },
                    { id: 'devBoard', label: 'Dev Board', icon: Bug, desc: 'Bugs, Features, Analysis, In Dev, Review, Done' },
                  ].map(({ id, label, icon: Icon, desc }) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setTemplate(id)}
                      className={cn(
                        'flex-1 p-2.5 rounded-xl border transition-all text-left',
                        template === id
                          ? 'border-[var(--primary)]/50 bg-[var(--primary)]/10'
                          : 'border-white/[0.1] bg-white/[0.03] hover:bg-white/[0.06]'
                      )}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <Icon className={cn('w-3.5 h-3.5', template === id ? 'text-[var(--primary)]' : 'text-slate-400')} />
                        <span className={cn('text-xs font-medium', template === id ? 'text-white' : 'text-slate-300')}>{label}</span>
                      </div>
                      <p className="text-[10px] text-slate-500 leading-tight">{desc}</p>
                    </button>
                  ))}
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

            <div className="relative flex gap-3 mt-6">
              <NeonButton
                onClick={handleSubmit}
                disabled={!formData.name.trim() || isSubmitting}
                className="flex-1"
                color="purple"
                glowIntensity="md"
              >
                <span className="flex items-center justify-center gap-2">
                  {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
                  {isSubmitting ? 'Creating...' : 'Create Project'}
                </span>
              </NeonButton>
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
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
