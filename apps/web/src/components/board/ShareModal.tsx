'use client'

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, UserPlus, Crown, Trash2, Loader2, Copy, Check, Clock, ImageIcon, Link2 } from 'lucide-react'
import { toPng } from 'html-to-image'
import { getProjectMembers, inviteMember, removeProjectMember, updateProjectMemberRole, getPendingInvites } from '@/lib/actions/members'
import { invalidateAssignablePeople } from '@/lib/store/membersCache'
import { createBoardSnapshot } from '@/lib/actions/snapshots'
import { autoSaveContact } from '@/lib/actions/contacts'
import { ContactAutocomplete } from '@/components/ui/ContactAutocomplete'

interface ShareModalProps {
  isOpen: boolean
  projectId: string
  projectName: string
  onClose: () => void
}

type Member = {
  userId: string
  role: string
  name: string | null
  email: string
  image: string | null
  createdAt: Date
}

type PendingInvite = {
  id: string
  email: string
  role: string
  expiresAt: Date
  createdAt: Date
}

const ROLE_OPTIONS = ['editor', 'viewer'] as const

export function ShareModal({ isOpen, projectId, projectName, onClose }: ShareModalProps) {
  const [members, setMembers] = useState<Member[]>([])
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([])
  const [email, setEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<string>('editor')
  const [loading, setLoading] = useState(false)
  const [inviteLoading, setInviteLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [copied, setCopied] = useState(false)
  const [inviteLink, setInviteLink] = useState('')
  const [exportingPng, setExportingPng] = useState(false)
  const [creatingLink, setCreatingLink] = useState(false)
  const [shareLink, setShareLink] = useState('')
  const [shareLinkCopied, setShareLinkCopied] = useState('')

  useEffect(() => {
    if (!isOpen) return
    setLoading(true)
    Promise.all([
      getProjectMembers(projectId),
      getPendingInvites(projectId).catch(() => []),
    ])
      .then(([m, p]) => {
        setMembers(m)
        setPendingInvites(p as PendingInvite[])
      })
      .catch(() => setError('Failed to load members'))
      .finally(() => setLoading(false))
  }, [isOpen, projectId])

  const handleExportPng = async () => {
    const columnsEl = document.querySelector('[data-board-columns]') as HTMLElement
    if (!columnsEl) return
    // The flex row + pinch-zoom transform live on the inner scale wrapper now;
    // neutralize both for the capture so the export is always full-scale.
    const scaleEl = document.querySelector('[data-board-scale]') as HTMLElement | null
    setExportingPng(true)

    const savedOverflow = columnsEl.style.overflow
    const savedMaxH = columnsEl.style.maxHeight
    const savedFlexWrap = scaleEl?.style.flexWrap ?? ''
    const savedTransform = scaleEl?.style.transform ?? ''
    const savedMarginRight = scaleEl?.style.marginRight ?? ''
    const savedMarginBottom = scaleEl?.style.marginBottom ?? ''

    const blurEls = columnsEl.querySelectorAll<HTMLElement>('*')
    const savedFilters: { el: HTMLElement; bd: string; filter: string }[] = []

    try {
      columnsEl.style.overflow = 'visible'
      columnsEl.style.maxHeight = 'none'
      if (scaleEl) {
        scaleEl.style.flexWrap = 'nowrap'
        scaleEl.style.transform = 'none'
        scaleEl.style.marginRight = '0'
        scaleEl.style.marginBottom = '0'
      }

      blurEls.forEach((el) => {
        const computed = getComputedStyle(el)
        if (computed.backdropFilter && computed.backdropFilter !== 'none') {
          savedFilters.push({ el, bd: el.style.backdropFilter, filter: el.style.filter })
          el.style.backdropFilter = 'none'
        }
      })

      await new Promise((r) => requestAnimationFrame(r))

      const fullW = columnsEl.scrollWidth
      const fullH = columnsEl.scrollHeight

      const dataUrl = await toPng(columnsEl, {
        pixelRatio: 2,
        backgroundColor: '#0a0a0f',
        width: fullW,
        height: fullH,
      })
      const link = document.createElement('a')
      link.download = `${projectName.replace(/[^a-zA-Z0-9]/g, '_')}_board.png`
      link.href = dataUrl
      link.click()
    } catch (err) {
      console.error('PNG export failed:', err)
    } finally {
      savedFilters.forEach(({ el, bd, filter }) => {
        el.style.backdropFilter = bd
        el.style.filter = filter
      })
      columnsEl.style.overflow = savedOverflow
      columnsEl.style.maxHeight = savedMaxH
      if (scaleEl) {
        scaleEl.style.flexWrap = savedFlexWrap
        scaleEl.style.transform = savedTransform
        scaleEl.style.marginRight = savedMarginRight
        scaleEl.style.marginBottom = savedMarginBottom
      }
      setExportingPng(false)
    }
  }

  const handleCreateShareLink = async () => {
    setCreatingLink(true)
    try {
      const result = await createBoardSnapshot(projectId)
      const link = `${window.location.origin}/share/${result.token}`
      setShareLink(link)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create share link')
    } finally {
      setCreatingLink(false)
    }
  }

  const handleCopyShareLink = () => {
    navigator.clipboard.writeText(shareLink).catch(() => {
      window.prompt('Copy this link:', shareLink)
    })
    setShareLinkCopied('copied')
    setTimeout(() => setShareLinkCopied(''), 2000)
  }

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = email.trim().toLowerCase()
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError('Enter a valid email')
      return
    }
    setError('')
    setSuccess('')
    setInviteLink('')
    setInviteLoading(true)
    try {
      const result = await inviteMember(projectId, trimmed, inviteRole)
      autoSaveContact(trimmed).catch((err) => console.error('autoSaveContact failed:', err))
      // Membership changed — refresh lists in the background instead of
      // blocking the modal on another round trip, and drop the cached
      // assignable-people list so the assignee overlay picks the change up.
      invalidateAssignablePeople(projectId)
      if (result.type === 'added') {
        setSuccess(`${trimmed} added to project`)
        getProjectMembers(projectId).then(setMembers).catch(() => {})
      } else {
        const link = `${window.location.origin}/invite/${result.token}`
        setInviteLink(link)
        setSuccess(`Invite created for ${trimmed}`)
        getPendingInvites(projectId)
          .then((updatedInvites) => setPendingInvites(updatedInvites as PendingInvite[]))
          .catch(() => {})
      }
      setEmail('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to invite')
    } finally {
      setInviteLoading(false)
    }
  }

  const handleRemove = async (targetUserId: string) => {
    // Optimistic: the row disappears immediately, restored on failure.
    const prev = members
    setMembers((p) => p.filter((m) => m.userId !== targetUserId))
    invalidateAssignablePeople(projectId)
    try {
      await removeProjectMember(projectId, targetUserId)
    } catch (err) {
      setMembers(prev)
      setError(err instanceof Error ? err.message : 'Failed to remove')
    }
  }

  const handleRoleChange = async (targetUserId: string, newRole: string) => {
    try {
      await updateProjectMemberRole(projectId, targetUserId, newRole)
      setMembers((prev) => prev.map((m) => m.userId === targetUserId ? { ...m, role: newRole } : m))
      invalidateAssignablePeople(projectId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update role')
    }
  }

  const handleCopyLink = () => {
    navigator.clipboard.writeText(inviteLink).catch(() => {
      window.prompt('Copy this link:', inviteLink)
    })
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (!isOpen) return null

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
          className="w-full max-w-md mx-4 rounded-2xl overflow-hidden max-h-[80vh] flex flex-col"
          style={{
            backgroundColor: 'rgba(15, 15, 25, 0.95)',
            border: '1px solid rgba(255,255,255,0.1)',
            boxShadow: '0 0 40px rgba(139, 92, 246, 0.15)',
          }}
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
            <div>
              <h2 className="text-white font-semibold">Share Project</h2>
              <p className="text-xs text-slate-400 mt-0.5">{projectName}</p>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-5 space-y-4 overflow-y-auto">
            <div className="space-y-2">
              <p className="text-xs text-slate-500 uppercase tracking-wider px-1">Export & Share</p>
              <div className="flex gap-2">
                <button
                  onClick={handleExportPng}
                  disabled={exportingPng}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all hover:brightness-110 disabled:opacity-50"
                  style={{
                    backgroundColor: 'rgba(16, 185, 129, 0.15)',
                    border: '1px solid rgba(16, 185, 129, 0.3)',
                    color: '#34d399',
                  }}
                >
                  {exportingPng ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImageIcon className="w-4 h-4" aria-hidden="true" />}
                  {exportingPng ? 'Exporting...' : 'Download PNG'}
                </button>
                <button
                  onClick={handleCreateShareLink}
                  disabled={creatingLink}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all hover:brightness-110 disabled:opacity-50"
                  style={{
                    backgroundColor: 'rgba(59, 130, 246, 0.15)',
                    border: '1px solid rgba(59, 130, 246, 0.3)',
                    color: '#60a5fa',
                  }}
                >
                  {creatingLink ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
                  {creatingLink ? 'Creating...' : 'Share Link (7d)'}
                </button>
              </div>

              {shareLink && (
                <div className="flex items-center gap-2 p-3 rounded-xl" style={{ backgroundColor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(59,130,246,0.2)' }}>
                  <Link2 className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />
                  <input
                    readOnly
                    value={shareLink}
                    className="flex-1 bg-transparent text-xs text-slate-300 focus:outline-none"
                  />
                  <button
                    onClick={handleCopyShareLink}
                    className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
                  >
                    {shareLinkCopied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              )}
            </div>

            <div className="border-t border-white/10 pt-4" />

            <form onSubmit={handleInvite} className="flex gap-2">
              <ContactAutocomplete
                value={email}
                onChange={(val) => { setEmail(val); setError('') }}
                onSelect={(selectedEmail) => { setEmail(selectedEmail); setError('') }}
                placeholder="Name or email"
                disabled={inviteLoading}
              />
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value)}
                className="px-2 py-2.5 rounded-xl text-xs text-slate-300 focus:outline-none focus:ring-2 focus:ring-white/20"
                style={{
                  backgroundColor: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.1)',
                }}
              >
                {ROLE_OPTIONS.map((r) => (
                  <option key={r} value={r} className="bg-slate-900">{r}</option>
                ))}
              </select>
              <button
                type="submit"
                disabled={inviteLoading}
                className="px-4 py-2.5 rounded-xl text-sm font-medium flex items-center gap-2 disabled:opacity-50 transition-all hover:brightness-110"
                style={{
                  backgroundColor: 'color-mix(in srgb, var(--primary) 20%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--primary) 30%, transparent)',
                  color: 'var(--primary)',
                }}
              >
                {inviteLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                Invite
              </button>
            </form>

            {error && <p className="text-xs text-red-400 px-1">{error}</p>}
            {success && <p className="text-xs text-emerald-400 px-1">{success}</p>}

            {inviteLink && (
              <div className="flex items-center gap-2 p-3 rounded-xl" style={{ backgroundColor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <input
                  readOnly
                  value={inviteLink}
                  className="flex-1 bg-transparent text-xs text-slate-300 focus:outline-none"
                />
                <button
                  onClick={handleCopyLink}
                  className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            )}

            <div className="space-y-1">
              <p className="text-xs text-slate-500 uppercase tracking-wider px-1 mb-2">Members</p>
              {loading ? (
                <div className="flex justify-center py-4">
                  <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
                </div>
              ) : (
                members.map((m) => (
                  <div
                    key={m.userId}
                    className="flex items-center justify-between px-3 py-2.5 rounded-xl hover:bg-white/[0.03] transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      {m.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={m.image} alt={m.name ? `${m.name}'s avatar` : 'User avatar'} referrerPolicy="no-referrer" className="w-7 h-7 rounded-full" />
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
                      ) : (
                        <select
                          value={m.role}
                          onChange={(e) => handleRoleChange(m.userId, e.target.value)}
                          className="text-xs text-slate-400 bg-transparent border border-white/10 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-white/20 cursor-pointer hover:border-white/20"
                        >
                          {ROLE_OPTIONS.map((r) => (
                            <option key={r} value={r} className="bg-slate-900">{r}</option>
                          ))}
                        </select>
                      )}
                      {m.role !== 'owner' && (
                        <button
                          onClick={() => handleRemove(m.userId)}
                          className="p-1 rounded hover:bg-red-500/10 text-slate-500 hover:text-red-400 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>

            {pendingInvites.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs text-slate-500 uppercase tracking-wider px-1 mb-2">Pending Invites</p>
                {pendingInvites.map((inv) => (
                  <div
                    key={inv.id}
                    className="flex items-center justify-between px-3 py-2.5 rounded-xl hover:bg-white/[0.03] transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-7 h-7 rounded-full bg-amber-500/10 flex items-center justify-center">
                        <Clock className="w-3.5 h-3.5 text-amber-400" />
                      </div>
                      <div>
                        <p className="text-sm text-white/70">{inv.email}</p>
                        <p className="text-xs text-slate-600">
                          {inv.role} — expires {new Date(inv.expiresAt).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
