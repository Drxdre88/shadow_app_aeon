'use client'

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Settings } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import {
  getGroupMembers,
  getGroupProjects,
  inviteGroupMember,
  removeGroupMember,
  updateMemberRole,
  updateGroup,
  deleteGroup,
  addProjectToGroup,
  removeProjectFromGroup,
  setProjectVisibility,
  getPendingRealmInvites,
  cancelRealmInvite,
  resendRealmInvite,
  getProjectAccessList,
  updateProjectAccessList,
} from '@/lib/actions/workspaces'
import { getProjects } from '@/lib/actions/projects'
import { autoSaveContact } from '@/lib/actions/contacts'
import { MembersTab } from './MembersTab'
import { ProjectsTab } from './ProjectsTab'
import type { GroupMemberRow, PendingInviteRow } from './MembersTab'
import type { GroupProjectRow } from './ProjectsTab'

interface WorkspaceSettingsModalProps {
  isOpen: boolean
  groupId: string
  groupName: string
  groupColor?: string
  groupIcon?: string | null
  isOwner: boolean
  isPersonal?: boolean
  currentUserId: string
  onClose: () => void
  onUpdated?: () => void
}

export function WorkspaceSettingsModal({ isOpen, groupId, groupName, groupColor, groupIcon, isOwner, isPersonal, currentUserId, onClose, onUpdated }: WorkspaceSettingsModalProps) {
  const [tab, setTab] = useState<'members' | 'projects'>('members')
  const [members, setMembers] = useState<GroupMemberRow[]>([])
  const [groupProjects, setGroupProjects] = useState<GroupProjectRow[]>([])
  const [allProjects, setAllProjects] = useState<{ id: string; name: string }[]>([])
  const [pendingInvites, setPendingInvites] = useState<PendingInviteRow[]>([])
  const [projectAccessLists, setProjectAccessLists] = useState<Record<string, { userId: string }[]>>({})
  const [loading, setLoading] = useState(false)
  const [email, setEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<string>('editor')
  const [inviteLoading, setInviteLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [name, setName] = useState(groupName)
  const [color, setColor] = useState(groupColor || 'purple')
  const [icon, setIcon] = useState(groupIcon || 'orbit')
  const [nameEditing, setNameEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [resendingInviteId, setResendingInviteId] = useState<string | null>(null)
  const [cancellingInviteId, setCancellingInviteId] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen) return
    setConfirmDelete(false)
    setLoading(true)
    Promise.allSettled([
      getGroupMembers(groupId),
      getGroupProjects(groupId),
      isOwner ? getPendingRealmInvites(groupId) : Promise.resolve([]),
    ])
      .then(([membersResult, projectsResult, invitesResult]) => {
        if (membersResult.status === 'fulfilled') setMembers(membersResult.value as GroupMemberRow[])
        else setError('Failed to load members')
        if (projectsResult.status === 'fulfilled') setGroupProjects(projectsResult.value as GroupProjectRow[])
        else setError((prev) => prev ? `${prev}; failed to load projects` : 'Failed to load projects')
        if (invitesResult.status === 'fulfilled') setPendingInvites(invitesResult.value as PendingInviteRow[])
      })
      .finally(() => setLoading(false))
  }, [isOpen, groupId, isOwner])

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
      const result = await inviteGroupMember(groupId, trimmed, inviteRole)
      autoSaveContact(trimmed).catch((err) => console.error('autoSaveContact failed:', err))
      if (result.type === 'invited') {
        setSuccess(`Invite sent to ${trimmed} (they need to sign up)`)
        if (isOwner) {
          const invites = await getPendingRealmInvites(groupId)
          setPendingInvites(invites as PendingInviteRow[])
        }
      } else {
        setSuccess(`Added ${trimmed} as ${inviteRole}`)
        const updated = await getGroupMembers(groupId)
        setMembers(updated as GroupMemberRow[])
      }
      setEmail('')
      onUpdated?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to invite')
    } finally {
      setInviteLoading(false)
    }
  }

  const handleResendInvite = async (inviteId: string) => {
    setError('')
    setSuccess('')
    setResendingInviteId(inviteId)
    try {
      await resendRealmInvite(groupId, inviteId)
      const invites = await getPendingRealmInvites(groupId)
      setPendingInvites(invites as PendingInviteRow[])
      setSuccess('Invite resent')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resend invite')
    } finally {
      setResendingInviteId(null)
    }
  }

  const handleCancelInvite = async (inviteId: string) => {
    setError('')
    setSuccess('')
    setCancellingInviteId(inviteId)
    try {
      await cancelRealmInvite(groupId, inviteId)
      setPendingInvites((prev) => prev.filter((i) => i.id !== inviteId))
      setSuccess('Invite cancelled')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel invite')
    } finally {
      setCancellingInviteId(null)
    }
  }

  const handleRemoveMember = async (userId: string) => {
    try {
      await removeGroupMember(groupId, userId)
      setMembers((prev) => prev.filter((m) => m.userId !== userId))
      onUpdated?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove')
    }
  }

  const handleMemberRoleChange = async (userId: string, newRole: string) => {
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

  const handleColorChange = async (newColor: string) => {
    setColor(newColor)
    try {
      await updateGroup(groupId, { color: newColor })
      onUpdated?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update color')
    }
  }

  const handleIconChange = async (newIcon: string) => {
    setIcon(newIcon)
    try {
      await updateGroup(groupId, { icon: newIcon })
      onUpdated?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update icon')
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

  const handleSetVisibility = async (projectId: string, visibility: 'all' | 'members_only') => {
    try {
      await setProjectVisibility(projectId, groupId, visibility)
      setGroupProjects((prev) => prev.map((p) => p.projectId === projectId ? { ...p, visibility } : p))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update visibility')
    }
  }

  const handleLoadAccessList = async (projectId: string) => {
    try {
      const list = await getProjectAccessList(projectId, groupId)
      setProjectAccessLists((prev) => ({ ...prev, [projectId]: list.map((m) => ({ userId: m.userId })) }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load access list')
    }
  }

  const handleUpdateAccessList = async (projectId: string, userIds: string[]) => {
    try {
      await updateProjectAccessList(projectId, groupId, userIds)
      setProjectAccessLists((prev) => ({ ...prev, [projectId]: userIds.map((userId) => ({ userId })) }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update access list')
    }
  }

  const handleDelete = async () => {
    if (!confirmDelete) { setConfirmDelete(true); return }
    setDeleting(true)
    try {
      await deleteGroup(groupId)
      onUpdated?.()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete realm')
      setDeleting(false)
      setConfirmDelete(false)
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
              <MembersTab
                isOwner={isOwner}
                isPersonal={isPersonal}
                loading={loading}
                members={members}
                pendingInvites={pendingInvites}
                email={email}
                inviteRole={inviteRole}
                inviteLoading={inviteLoading}
                color={color}
                icon={icon}
                resendingInviteId={resendingInviteId}
                cancellingInviteId={cancellingInviteId}
                onEmailChange={(val) => { setEmail(val); setError('') }}
                onRoleChange={setInviteRole}
                onInvite={handleInvite}
                onRemoveMember={handleRemoveMember}
                onMemberRoleChange={handleMemberRoleChange}
                onColorChange={handleColorChange}
                onIconChange={handleIconChange}
                onResendInvite={handleResendInvite}
                onCancelInvite={handleCancelInvite}
              />
            )}

            {tab === 'projects' && (
              <ProjectsTab
                isOwner={isOwner}
                groupProjects={groupProjects}
                availableProjects={availableProjects}
                realmMembers={members.map((m) => ({ userId: m.userId, name: m.name, email: m.email, image: m.image }))}
                currentUserId={currentUserId}
                onAddProject={handleAddProject}
                onRemoveProject={handleRemoveProject}
                onSetVisibility={handleSetVisibility}
                onUpdateAccessList={handleUpdateAccessList}
                projectAccessLists={projectAccessLists}
                onLoadAccessList={handleLoadAccessList}
              />
            )}

            {isOwner && !isPersonal && (
              <div className="border-t border-white/10 pt-4 mt-4">
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className={cn(
                    'w-full px-4 py-2.5 rounded-xl text-sm font-medium transition-all',
                    confirmDelete
                      ? 'bg-red-500/20 border border-red-500/40 text-red-400 hover:bg-red-500/30'
                      : 'bg-white/[0.03] border border-white/[0.08] text-slate-500 hover:text-red-400 hover:border-red-500/30',
                    deleting && 'opacity-50'
                  )}
                >
                  {deleting ? 'Deleting...' : confirmDelete ? 'Confirm Delete Realm' : 'Delete Realm'}
                </button>
                {confirmDelete && (
                  <p className="text-[10px] text-red-400/60 text-center mt-1">Projects will be unassigned, not deleted</p>
                )}
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
