'use client'

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, UserPlus, Crown, Trash2, Loader2, Settings, FolderPlus, FolderMinus } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import {
  getGroupMembers,
  getGroupProjects,
  inviteGroupMember,
  removeGroupMember,
  updateMemberRole,
  updateGroup,
  addProjectToGroup,
  removeProjectFromGroup,
} from '@/lib/actions/workspaces'
import { getProjects } from '@/lib/actions/projects'
import { autoSaveContact } from '@/lib/actions/contacts'
import { ContactAutocomplete } from '@/components/ui/ContactAutocomplete'

interface WorkspaceSettingsModalProps {
  isOpen: boolean
  groupId: string
  groupName: string
  isOwner: boolean
  isPersonal?: boolean
  onClose: () => void
  onUpdated?: () => void
}

type GroupMemberRow = {
  userId: string
  role: string
  name: string | null
  email: string
  image: string | null
  createdAt: Date
}

type GroupProjectRow = {
  projectId: string
  name: string
  planetImage: string | null
  ownerId: string
}

const ROLE_OPTIONS = ['editor', 'viewer'] as const

export function WorkspaceSettingsModal({ isOpen, groupId, groupName, isOwner, isPersonal, onClose, onUpdated }: WorkspaceSettingsModalProps) {
  const [tab, setTab] = useState<'members' | 'projects'>('members')
  const [members, setMembers] = useState<GroupMemberRow[]>([])
  const [groupProjects, setGroupProjects] = useState<GroupProjectRow[]>([])
  const [allProjects, setAllProjects] = useState<{ id: string; name: string }[]>([])
  const [loading, setLoading] = useState(false)
  const [email, setEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<string>('editor')
  const [inviteLoading, setInviteLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [name, setName] = useState(groupName)
  const [nameEditing, setNameEditing] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    setLoading(true)
    Promise.allSettled([
      getGroupMembers(groupId),
      getGroupProjects(groupId),
    ])
      .then(([membersResult, projectsResult]) => {
        if (membersResult.status === 'fulfilled') setMembers(membersResult.value as GroupMemberRow[])
        else setError('Failed to load members')
        if (projectsResult.status === 'fulfilled') setGroupProjects(projectsResult.value as GroupProjectRow[])
        else setError((prev) => prev ? `${prev}; failed to load projects` : 'Failed to load projects')
      })
      .finally(() => setLoading(false))
  }, [isOpen, groupId])

  useEffect(() => {
    if (!isOpen || tab !== 'projects') return
    getProjects().then((p) => setAllProjects(p.map((proj) => ({ id: proj.id, name: proj.name })))).catch(() => {})
  }, [isOpen, tab])

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = email.trim().toLowerCase()
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError('Enter a valid email')
      return
    }
    setError('')
    setSuccess('')
    setInviteLoading(true)
    try {
      await inviteGroupMember(groupId, trimmed, inviteRole)
      autoSaveContact(trimmed).catch((err) => console.error('autoSaveContact failed:', err))
      setSuccess(`Invited ${trimmed} as ${inviteRole}`)
      setEmail('')
      const updated = await getGroupMembers(groupId)
      setMembers(updated as GroupMemberRow[])
      onUpdated?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to invite')
    } finally {
      setInviteLoading(false)
    }
  }

  const handleRemove = async (userId: string) => {
    try {
      await removeGroupMember(groupId, userId)
      setMembers((prev) => prev.filter((m) => m.userId !== userId))
      onUpdated?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove')
    }
  }

  const handleRoleChange = async (userId: string, newRole: string) => {
    try {
      await updateMemberRole(groupId, userId, newRole)
      setMembers((prev) => prev.map((m) => m.userId === userId ? { ...m, role: newRole } : m))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update role')
    }
  }

  const handleRename = async () => {
    if (!name.trim() || name === groupName) { setNameEditing(false); return }
    try {
      await updateGroup(groupId, { name: name.trim() })
      setNameEditing(false)
      onUpdated?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rename')
    }
  }

  const handleAddProject = async (projectId: string) => {
    try {
      await addProjectToGroup(projectId, groupId)
      const updated = await getGroupProjects(groupId)
      setGroupProjects(updated as GroupProjectRow[])
      onUpdated?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add project')
    }
  }

  const handleRemoveProject = async (projectId: string) => {
    try {
      await removeProjectFromGroup(projectId, groupId)
      setGroupProjects((prev) => prev.filter((p) => p.projectId !== projectId))
      onUpdated?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove project')
    }
  }

  if (!isOpen) return null

  const projectIdsInGroup = new Set(groupProjects.map((p) => p.projectId))
  const availableProjects = allProjects.filter((p) => !projectIdsInGroup.has(p.id))

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-lg mx-4 rounded-2xl overflow-hidden max-h-[80vh] flex flex-col"
          style={{
            backgroundColor: 'rgba(15, 15, 25, 0.95)',
            border: '1px solid rgba(255,255,255,0.1)',
            boxShadow: '0 0 40px rgba(139, 92, 246, 0.15)',
          }}
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
            <div className="flex items-center gap-2">
              <Settings className="w-4 h-4 text-slate-400" />
              {nameEditing && isOwner ? (
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onBlur={handleRename}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleRename(); if (e.key === 'Escape') setNameEditing(false) }}
                  className="bg-transparent text-white font-semibold focus:outline-none"
                  style={{ borderBottom: '1px solid color-mix(in srgb, var(--primary) 50%, transparent)' }}
                  autoFocus
                />
              ) : (
                <h2
                  className={cn('text-white font-semibold', isOwner && 'cursor-pointer hover:text-purple-300')}
                  onDoubleClick={() => isOwner && setNameEditing(true)}
                >
                  {name}
                </h2>
              )}
            </div>
            <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex border-b border-white/10">
            {(['members', 'projects'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={cn(
                  'flex-1 px-4 py-2.5 text-xs font-medium uppercase tracking-wider transition-colors',
                  tab === t ? 'text-white border-b-2 border-purple-500' : 'text-slate-500 hover:text-slate-300'
                )}
              >
                {t}
              </button>
            ))}
          </div>

          <div className="p-5 space-y-4 overflow-y-auto">
            {error && <p className="text-xs text-red-400 px-1">{error}</p>}
            {success && <p className="text-xs text-emerald-400 px-1">{success}</p>}

            {tab === 'members' && (
              <>
                {isOwner && (
                  <form onSubmit={handleInvite} className="flex gap-2">
                    <ContactAutocomplete
                      value={email}
                      onChange={(val) => { setEmail(val); setError('') }}
                      onSelect={(selectedEmail) => { setEmail(selectedEmail); setError('') }}
                      placeholder="Invite by name or email"
                      disabled={inviteLoading}
                    />
                    <select
                      value={inviteRole}
                      onChange={(e) => setInviteRole(e.target.value)}
                      className="px-2 py-2.5 rounded-xl text-xs text-slate-300 focus:outline-none"
                      style={{ backgroundColor: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
                    >
                      {ROLE_OPTIONS.map((r) => (
                        <option key={r} value={r} className="bg-slate-900">{r}</option>
                      ))}
                    </select>
                    <button
                      type="submit"
                      disabled={inviteLoading}
                      className="px-4 py-2.5 rounded-xl text-sm font-medium flex items-center gap-2 disabled:opacity-50 transition-all hover:brightness-110"
                      style={{ backgroundColor: 'rgba(139, 92, 246, 0.2)', border: '1px solid rgba(139, 92, 246, 0.3)', color: '#a78bfa' }}
                    >
                      {inviteLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                    </button>
                  </form>
                )}

                <div className="space-y-1">
                  {loading ? (
                    <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
                  ) : members.map((m) => (
                    <div key={m.userId} className="flex items-center justify-between px-3 py-2.5 rounded-xl hover:bg-white/[0.03] transition-colors">
                      <div className="flex items-center gap-3">
                        {m.image ? (
                          <img src={m.image} alt="" className="w-7 h-7 rounded-full" />
                        ) : (
                          <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium" style={{ backgroundColor: 'color-mix(in srgb, var(--primary) 20%, transparent)', color: 'var(--primary)' }}>
                            {(m.name || m.email).charAt(0).toUpperCase()}
                          </div>
                        )}
                        <div>
                          <p className="text-sm text-white">{m.name || m.email}</p>
                          {m.name && <p className="text-xs text-slate-500">{m.email}</p>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {m.role === 'owner' ? (
                          <span className="text-xs text-slate-500 flex items-center gap-1">
                            <Crown className="w-3 h-3 text-amber-400" />
                            owner
                          </span>
                        ) : isOwner ? (
                          <select
                            value={m.role}
                            onChange={(e) => handleRoleChange(m.userId, e.target.value)}
                            className="text-xs text-slate-400 bg-transparent border border-white/10 rounded-lg px-2 py-1 focus:outline-none cursor-pointer hover:border-white/20"
                          >
                            {ROLE_OPTIONS.map((r) => (
                              <option key={r} value={r} className="bg-slate-900">{r}</option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-xs text-slate-500">{m.role}</span>
                        )}
                        {m.role !== 'owner' && isOwner && (
                          <button
                            onClick={() => handleRemove(m.userId)}
                            className="p-1 rounded hover:bg-red-500/10 text-slate-500 hover:text-red-400 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {tab === 'projects' && (
              <>
                <div className="space-y-1">
                  <p className="text-xs text-slate-500 uppercase tracking-wider px-1 mb-2">In Realm</p>
                  {groupProjects.length === 0 ? (
                    <p className="text-xs text-slate-600 px-1 py-3">No projects added yet</p>
                  ) : groupProjects.map((p) => (
                    <div key={p.projectId} className="flex items-center justify-between px-3 py-2.5 rounded-xl hover:bg-white/[0.03] transition-colors">
                      <div className="flex items-center gap-3">
                        {p.planetImage ? (
                          <img src={`/planets/${p.planetImage}`} alt="" className="w-6 h-6 rounded-full" />
                        ) : (
                          <div className="w-6 h-6 rounded-full" style={{ backgroundColor: 'color-mix(in srgb, var(--primary) 20%, transparent)' }} />
                        )}
                        <span className="text-sm text-white">{p.name}</span>
                      </div>
                      {isOwner && (
                        <button
                          onClick={() => handleRemoveProject(p.projectId)}
                          className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                        >
                          <FolderMinus className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                {isOwner && availableProjects.length > 0 && (
                  <div className="space-y-1 border-t border-white/10 pt-4">
                    <p className="text-xs text-slate-500 uppercase tracking-wider px-1 mb-2">Add to Realm</p>
                    {availableProjects.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => handleAddProject(p.id)}
                        className="w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-white/[0.05] transition-colors text-left"
                      >
                        <FolderPlus className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="text-sm text-slate-300">{p.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
