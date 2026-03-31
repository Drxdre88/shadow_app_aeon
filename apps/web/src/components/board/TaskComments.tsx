'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Send, Trash2, Pencil, X, Check, MessageSquare } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { getComments, addComment, editComment, removeComment } from '@/lib/actions/comments'
import { toast } from '@/components/ui/Toast'

interface Comment {
  id: string
  taskId: string
  userId: string
  content: string
  createdAt: Date
  updatedAt: Date
  userName: string | null
  userImage: string | null
}

interface TaskCommentsProps {
  taskId: string
  projectId: string
}

function timeAgo(date: Date): string {
  const now = new Date()
  const diffMs = now.getTime() - new Date(date).getTime()
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(date).toLocaleDateString()
}

export function TaskComments({ taskId, projectId }: TaskCommentsProps) {
  const [comments, setComments] = useState<Comment[]>([])
  const [newComment, setNewComment] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    getComments(taskId, projectId)
      .then((data) => setComments(data as Comment[]))
      .catch(() => setComments([]))
  }, [taskId, projectId])

  const handleSubmit = useCallback(async () => {
    if (!newComment.trim() || submitting) return
    setSubmitting(true)
    try {
      const comment = await addComment(taskId, projectId, newComment.trim())
      setComments((prev) => [...prev, {
        ...comment,
        userName: 'You',
        userImage: null,
      } as Comment])
      setNewComment('')
    } catch (err) { console.error('Failed to add comment:', err); toast('Failed to add comment', { force: true }) }
    setSubmitting(false)
  }, [newComment, submitting, taskId, projectId])

  const handleEdit = useCallback(async (commentId: string) => {
    if (!editContent.trim()) return
    try {
      const updated = await editComment(commentId, taskId, projectId, editContent.trim())
      if (updated) {
        setComments((prev) =>
          prev.map((c) => c.id === commentId ? { ...c, content: editContent.trim(), updatedAt: new Date() } : c)
        )
      }
    } catch (err) { console.error('Failed to edit comment:', err); toast('Failed to edit comment', { force: true }) }
    setEditingId(null)
  }, [editContent, taskId, projectId])

  const handleDelete = useCallback(async (commentId: string) => {
    try {
      await removeComment(commentId, taskId, projectId)
      setComments((prev) => prev.filter((c) => c.id !== commentId))
    } catch (err) { console.error('Failed to delete comment:', err); toast('Failed to delete comment', { force: true }) }
  }, [taskId, projectId])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <MessageSquare className="w-4 h-4 text-slate-400" />
        <span className="text-sm font-medium text-slate-300">
          Comments {comments.length > 0 && `(${comments.length})`}
        </span>
      </div>

      {comments.length > 0 && (
        <div className="space-y-2 max-h-[200px] overflow-y-auto">
          {comments.map((comment) => (
            <div
              key={comment.id}
              className="group p-2.5 rounded-lg bg-white/5 border border-white/5 hover:border-white/10 transition-colors"
            >
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-medium" style={{ backgroundColor: 'color-mix(in srgb, var(--primary) 30%, transparent)', color: 'var(--primary)' }}>
                    {(comment.userName || '?')[0]?.toUpperCase()}
                  </div>
                  <span className="text-xs text-slate-400">{comment.userName || 'User'}</span>
                  <span className="text-[10px] text-slate-600">{timeAgo(comment.createdAt)}</span>
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => { setEditingId(comment.id); setEditContent(comment.content) }}
                    className="p-1 rounded hover:bg-white/10 text-slate-500 hover:text-slate-300 transition-colors"
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => handleDelete(comment.id)}
                    className="p-1 rounded hover:bg-red-500/10 text-slate-500 hover:text-red-400 transition-colors"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
              {editingId === comment.id ? (
                <div className="flex gap-1.5 mt-1">
                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    className="flex-1 px-2 py-1.5 rounded bg-white/5 border border-white/10 text-xs text-white resize-none focus:outline-none focus:ring-1 focus:ring-white/20"
                    rows={2}
                    autoFocus
                  />
                  <div className="flex flex-col gap-1">
                    <button
                      onClick={() => handleEdit(comment.id)}
                      className="p-1 rounded transition-colors"
                      style={{ backgroundColor: 'color-mix(in srgb, var(--primary) 20%, transparent)', color: 'var(--primary)' }}
                    >
                      <Check className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="p-1 rounded hover:bg-white/10 text-slate-500 transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-slate-300 whitespace-pre-wrap break-words">{comment.content}</p>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <textarea
          ref={inputRef}
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Add a comment..."
          rows={1}
          className={cn(
            'flex-1 px-3 py-2 rounded-lg text-xs resize-none',
            'bg-white/5 border border-white/10',
            'text-white placeholder-slate-500',
            'focus:outline-none focus:ring-1 focus:ring-white/20',
            'transition-all duration-200'
          )}
        />
        <button
          onClick={handleSubmit}
          disabled={!newComment.trim() || submitting}
          className="p-2 rounded-lg transition-all"
          style={newComment.trim() ? {
            backgroundColor: 'color-mix(in srgb, var(--primary) 20%, transparent)',
            borderColor: 'color-mix(in srgb, var(--primary) 30%, transparent)',
            border: '1px solid',
            color: 'var(--primary)',
          } : {
            backgroundColor: 'rgba(255,255,255,0.05)',
            borderColor: 'rgba(255,255,255,0.05)',
            border: '1px solid',
            color: 'rgb(71 85 105)',
            cursor: 'not-allowed',
          }}
        >
          <Send className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}
