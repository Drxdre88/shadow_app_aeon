'use client'

import { Loader2, UserPlus, Crown, Trash2, Clock } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { timeAgo } from '@/lib/utils/timeAgo'
import { ContactAutocomplete } from '@/components/ui/ContactAutocomplete'
import { RealmColorPicker, RealmIconPicker } from './RealmPickers'

export type GroupMemberRow = {
  userId: string
  role: string
  name: string | null
  email: string
  image: string | null
  createdAt: Date
}

export type PendingInviteRow = {
  id: string
  email: string
  role: string
  expiresAt: Date
  createdAt: Date
}

const ROLE_OPTIONS = ['editor', 'viewer'] as const

interface MembersTabProps {
  isOwner: boolean
  isPersonal?: boolean
  loading: boolean
  members: GroupMemberRow[]
  pendingInvites: PendingInviteRow[]
  email: string
  inviteRole: string
  inviteLoading: boolean
  color: string
  icon: string
  onEmailChange: (val: string) => void
  onRoleChange: (role: string) => void
  onInvite: (e: React.FormEvent) => void
  onRemoveMember: (userId: string) => void
  onMemberRoleChange: (userId: string, newRole: string) => void
  onColorChange: (color: string) => void
  onIconChange: (icon: string) => void
}

export function MembersTab({
  isOwner,
  isPersonal,
  loading,
  members,
  pendingInvites,
  email,
  inviteRole,
  inviteLoading,
  color,
  icon,
  onEmailChange,
  onRoleChange,
  onInvite,
  onRemoveMember,
  onMemberRoleChange,
  onColorChange,
  onIconChange,
}: MembersTabProps) {
  return (
    <>
      {isOwner && !isPersonal && (
        <div className="space-y-3 pb-3 border-b border-white/10">
          <RealmColorPicker selected={color} onSelect={onColorChange} />
          <RealmIconPicker selected={icon} onSelect={onIconChange} />
        </div>
      )}

      {isOwner && (
        <form onSubmit={onInvite} className="flex gap-2">
          <ContactAutocomplete
            value={email}
            onChange={(val) => onEmailChange(val)}
            onSelect={(selectedEmail) => onEmailChange(selectedEmail)}
            placeholder="Invite by name or email"
            disabled={inviteLoading}
          />
          <select
            value={inviteRole}
            onChange={(e) => onRoleChange(e.target.value)}
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
                // eslint-disable-next-line @next/next/no-img-element
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
              <div className="flex flex-col items-end gap-0.5">
                {m.role === 'owner' ? (
                  <span className="text-xs text-slate-500 flex items-center gap-1">
                    <Crown className="w-3 h-3 text-amber-400" />
                    owner
                  </span>
                ) : isOwner ? (
                  <select
                    value={m.role}
                    onChange={(e) => onMemberRoleChange(m.userId, e.target.value)}
                    className="text-xs text-slate-400 bg-transparent border border-white/10 rounded-lg px-2 py-1 focus:outline-none cursor-pointer hover:border-white/20"
                  >
                    {ROLE_OPTIONS.map((r) => (
                      <option key={r} value={r} className="bg-slate-900">{r}</option>
                    ))}
                  </select>
                ) : (
                  <span className="text-xs text-slate-500">{m.role}</span>
                )}
                <span className="text-[10px] text-slate-600">joined {timeAgo(m.createdAt)}</span>
              </div>
              {m.role !== 'owner' && isOwner && (
                <button
                  onClick={() => onRemoveMember(m.userId)}
                  className="p-1 rounded hover:bg-red-500/10 text-slate-500 hover:text-red-400 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {isOwner && pendingInvites.length > 0 && (
        <div className="space-y-1 border-t border-white/10 pt-3 mt-3">
          <p className="text-xs text-slate-500 uppercase tracking-wider px-1 mb-2">Pending Invites</p>
          {pendingInvites.map((inv) => (
            <div key={inv.id} className="flex items-center justify-between px-3 py-2 rounded-xl hover:bg-white/[0.03] transition-colors">
              <div className="flex items-center gap-3">
                <div className="w-7 h-7 rounded-full flex items-center justify-center bg-amber-500/10">
                  <Clock className="w-3.5 h-3.5 text-amber-400" />
                </div>
                <div>
                  <p className="text-sm text-white/70">{inv.email}</p>
                  <p className="text-[10px] text-slate-600">expires {timeAgo(inv.expiresAt)}</p>
                </div>
              </div>
              <span className="text-xs text-slate-500">{inv.role}</span>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
