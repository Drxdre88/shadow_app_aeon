'use client'

import { useState, useEffect, useCallback } from 'react'
import { useHasMounted } from '@/lib/utils/useHasMounted'
import { Command } from 'cmdk'
import { useRouter, usePathname } from 'next/navigation'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  LayoutGrid, Calendar, Lightbulb, Trophy, Activity,
  Search, Settings, ArrowRight,
} from 'lucide-react'
import { getProjects } from '@/lib/actions/projects'
import { useBoardStore } from '@/lib/store/boardStore'

interface ProjectItem {
  id: string
  name: string
  group: string | null
  planetImage: string | null
}

export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [projects, setProjects] = useState<ProjectItem[]>([])
  const mounted = useHasMounted()
  const router = useRouter()
  const pathname = usePathname()
  const tasks = useBoardStore((s) => s.tasks)

  const projectMatch = pathname.match(/\/project\/([^/]+)/)
  const currentProjectId = projectMatch?.[1] || null

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((o) => !o)
      }
      const tag = (e.target as HTMLElement).tagName
      if (e.key === '/' && !e.metaKey && !e.ctrlKey && tag !== 'INPUT' && tag !== 'TEXTAREA' && !(e.target as HTMLElement).isContentEditable) {
        e.preventDefault()
        setOpen(true)
      }
    }
    document.addEventListener('keydown', down)
    return () => document.removeEventListener('keydown', down)
  }, [])

  useEffect(() => {
    if (!open) return
    getProjects().then((p) =>
      setProjects(p.map((proj) => ({ id: proj.id, name: proj.name, group: proj.group, planetImage: proj.planetImage })))
    )
  }, [open])

  const runAction = useCallback((fn: () => void) => {
    fn()
    setOpen(false)
  }, [])

  if (!mounted) return null

  const tabs = [
    { id: 'board', label: 'Board', icon: LayoutGrid },
    { id: 'gantt', label: 'Gantt', icon: Calendar },
    { id: 'canvas', label: 'Canvas', icon: Lightbulb },
    { id: 'trophy', label: 'Trophy', icon: Trophy },
    { id: 'velocity', label: 'Velocity', icon: Activity },
  ]

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[300] bg-black/60 backdrop-blur-sm flex items-start justify-center pt-[15vh]"
          onClick={() => setOpen(false)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -10 }}
            transition={{ duration: 0.15 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-[520px] mx-4"
          >
            <Command
              className="rounded-2xl overflow-hidden border border-white/10 bg-[#0f0f19]/95 backdrop-blur-xl shadow-[0_0_60px_rgba(139,92,246,0.15)]"
              loop
            >
              <div className="flex items-center gap-3 px-4 border-b border-white/10">
                <Search className="w-4 h-4 text-slate-500 shrink-0" />
                <Command.Input
                  placeholder="Search tasks, projects, actions..."
                  className="w-full py-3.5 bg-transparent text-sm text-white placeholder-slate-500 focus:outline-none"
                  autoFocus
                />
                <kbd className="text-[10px] text-slate-600 border border-white/10 rounded px-1.5 py-0.5 shrink-0">ESC</kbd>
              </div>

              <Command.List className="max-h-[360px] overflow-y-auto p-2">
                <Command.Empty className="py-8 text-center text-sm text-slate-500">
                  No results found.
                </Command.Empty>

                {currentProjectId && tasks.length > 0 && (
                  <Command.Group heading="Tasks" className="[&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-slate-600 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5">
                    {tasks.slice(0, 20).map((t) => (
                      <Command.Item
                        key={t.id}
                        value={`task ${t.name}`}
                        onSelect={() => runAction(() => {
                          useBoardStore.getState().selectTask(t.id)
                          requestAnimationFrame(() => {
                            const el = document.querySelector(`[data-task-id="${t.id}"]`)
                            if (el) {
                              el.scrollIntoView({ behavior: 'smooth', block: 'center' })
                              const btn = el.querySelector('button[class*="hover:bg-white"]') as HTMLButtonElement
                              btn?.click()
                            }
                          })
                        })}
                        className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-slate-300 cursor-pointer data-[selected=true]:bg-white/[0.06] data-[selected=true]:text-white transition-colors"
                      >
                        <div
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: t.color.startsWith('#') ? t.color : undefined }}
                        />
                        <span className="truncate">{t.name}</span>
                      </Command.Item>
                    ))}
                  </Command.Group>
                )}

                <Command.Group heading="Projects" className="[&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-slate-600 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5">
                  {projects.map((p) => (
                    <Command.Item
                      key={p.id}
                      value={`project ${p.name} ${p.group || ''}`}
                      onSelect={() => runAction(() => router.push(`/project/${p.id}`))}
                      className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-slate-300 cursor-pointer data-[selected=true]:bg-white/[0.06] data-[selected=true]:text-white transition-colors"
                    >
                      {p.planetImage ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img src={`/planets/${p.planetImage}`} alt="" className="w-4 h-4 rounded-full shrink-0" />
                      ) : (
                        <div className="w-4 h-4 rounded-full bg-purple-500/20 shrink-0" />
                      )}
                      <span className="truncate">{p.name}</span>
                      {p.group && <span className="text-[10px] text-slate-600 ml-auto shrink-0">{p.group}</span>}
                    </Command.Item>
                  ))}
                </Command.Group>

                {currentProjectId && (
                  <Command.Group heading="Navigate" className="[&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-slate-600 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5">
                    {tabs.map((tab) => (
                      <Command.Item
                        key={tab.id}
                        value={`go to ${tab.label}`}
                        onSelect={() => runAction(() => {
                          const tabButtons = document.querySelectorAll('header button')
                          tabButtons.forEach((btn) => {
                            if (btn.textContent?.trim().toLowerCase() === tab.label.toLowerCase()) {
                              ;(btn as HTMLButtonElement).click()
                            }
                          })
                        })}
                        className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-slate-300 cursor-pointer data-[selected=true]:bg-white/[0.06] data-[selected=true]:text-white transition-colors"
                      >
                        <tab.icon className="w-4 h-4 text-slate-500 shrink-0" />
                        <span>{tab.label}</span>
                        <ArrowRight className="w-3 h-3 text-slate-600 ml-auto" />
                      </Command.Item>
                    ))}
                  </Command.Group>
                )}

                <Command.Group heading="Actions" className="[&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-slate-600 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5">
                  <Command.Item
                    value="go to dashboard"
                    onSelect={() => runAction(() => router.push('/dashboard'))}
                    className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-slate-300 cursor-pointer data-[selected=true]:bg-white/[0.06] data-[selected=true]:text-white transition-colors"
                  >
                    <LayoutGrid className="w-4 h-4 text-slate-500 shrink-0" />
                    <span>Go to Dashboard</span>
                  </Command.Item>
                  <Command.Item
                    value="open settings"
                    onSelect={() => runAction(() => {
                      const settingsBtn = document.querySelector('[data-settings-trigger]') as HTMLButtonElement
                      settingsBtn?.click()
                    })}
                    className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-slate-300 cursor-pointer data-[selected=true]:bg-white/[0.06] data-[selected=true]:text-white transition-colors"
                  >
                    <Settings className="w-4 h-4 text-slate-500 shrink-0" />
                    <span>Open Settings</span>
                  </Command.Item>
                </Command.Group>
              </Command.List>

              <div className="flex items-center gap-4 px-4 py-2 border-t border-white/10 text-[10px] text-slate-600">
                <span className="flex items-center gap-1"><kbd className="border border-white/10 rounded px-1">↑↓</kbd> navigate</span>
                <span className="flex items-center gap-1"><kbd className="border border-white/10 rounded px-1">↵</kbd> select</span>
                <span className="flex items-center gap-1"><kbd className="border border-white/10 rounded px-1">esc</kbd> close</span>
              </div>
            </Command>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  )
}
