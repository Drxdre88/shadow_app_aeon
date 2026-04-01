'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Orbit } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { NeonButton } from '@/components/ui/NeonButton'

interface CreateWorkspaceModalProps {
  isOpen: boolean
  onClose: () => void
  onCreate: (name: string) => Promise<void>
}

export function CreateWorkspaceModal({ isOpen, onClose, onCreate }: CreateWorkspaceModalProps) {
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async () => {
    if (!name.trim()) return
    setLoading(true)
    setError('')
    try {
      await onCreate(name.trim())
      setName('')
      onClose()
    } catch (err) {
      console.error('CreateWorkspace failed:', err)
      setError('Failed to create workspace')
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && name.trim() && !loading) handleSubmit()
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
            onClick={(e) => e.stopPropagation()}
            className={cn(
              'w-full max-w-md rounded-xl p-6',
              'bg-gradient-to-b from-white/10 to-black/40',
              'backdrop-blur-xl border border-white/10',
              'shadow-[0_0_40px_rgba(99,102,241,0.3)]'
            )}
          >
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2">
                <Orbit className="w-5 h-5 text-[var(--primary)]" />
                <h2 className="text-lg font-semibold text-white">Create Realm</h2>
              </div>
              <button
                onClick={onClose}
                aria-label="Close"
                className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm text-slate-400 mb-1.5">Realm name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="e.g. AI Engineering"
                  autoFocus
                  className={cn(
                    'w-full px-4 py-2.5 rounded-lg',
                    'bg-white/5 border border-white/10',
                    'text-white placeholder-slate-500',
                    'focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/50',
                    'transition-all duration-200'
                  )}
                />
              </div>

              {error && (
                <p className="text-sm text-red-400">{error}</p>
              )}

              <div className="flex gap-3 justify-end">
                <button
                  onClick={onClose}
                  className={cn(
                    'px-4 py-2 rounded-lg text-sm font-medium',
                    'bg-white/5 hover:bg-white/10 border border-white/10',
                    'text-slate-400 hover:text-white',
                    'transition-all duration-200'
                  )}
                >
                  Cancel
                </button>
                <NeonButton
                  onClick={handleSubmit}
                  disabled={!name.trim() || loading}
                  color="purple"
                  glowIntensity="md"
                >
                  {loading ? 'Creating...' : 'Create Realm'}
                </NeonButton>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
