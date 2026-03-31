'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Mail, User } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { searchContacts } from '@/lib/actions/contacts'

const isSafeImageUrl = (url: string) => url.startsWith('https://') || url.startsWith('/')

interface ContactResult {
  id: string
  contactEmail: string
  contactUserId: string | null
  displayName: string | null
  userName: string | null
  userImage: string | null
}

interface ContactAutocompleteProps {
  value: string
  onChange: (value: string) => void
  onSelect?: (email: string, displayName?: string) => void
  placeholder?: string
  disabled?: boolean
  className?: string
}

export function ContactAutocomplete({
  value, onChange, onSelect, placeholder = 'Email or name...', disabled, className,
}: ContactAutocompleteProps) {
  const [results, setResults] = useState<ContactResult[]>([])
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const doSearch = useCallback((query: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      try {
        const data = await searchContacts(query)
        setResults(data as ContactResult[])
        setOpen(true)
        setActiveIndex(-1)
      } catch {
        setResults([])
      }
    }, 200)
  }, [])

  useEffect(() => {
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [])

  const handleInputChange = (val: string) => {
    onChange(val)
    if (val.trim().length > 0) {
      doSearch(val)
    } else {
      setResults([])
      setOpen(false)
    }
  }

  const handleSelect = (contact: ContactResult) => {
    const name = contact.displayName || contact.userName || undefined
    onChange(contact.contactEmail)
    onSelect?.(contact.contactEmail, name)
    setOpen(false)
    setResults([])
  }

  const handleSelectRaw = () => {
    const trimmed = value.trim()
    if (trimmed) {
      onSelect?.(trimmed)
      setOpen(false)
      setResults([])
    }
  }

  const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
  const showRawOption = value.trim().length > 0 && isValidEmail && !results.some((r) => r.contactEmail === value.trim().toLowerCase())

  const totalItems = results.length + (showRawOption ? 1 : 0)

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open || totalItems === 0) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => (i + 1) % totalItems)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => (i - 1 + totalItems) % totalItems)
    } else if (e.key === 'Enter') {
      if (activeIndex >= 0 && activeIndex < results.length) {
        e.preventDefault()
        handleSelect(results[activeIndex])
      } else if (showRawOption && (activeIndex === results.length || activeIndex === -1)) {
        e.preventDefault()
        handleSelectRaw()
      }
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (listRef.current && !listRef.current.contains(e.target as Node) &&
          inputRef.current && !inputRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <div className="relative flex-1">
      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => handleInputChange(e.target.value)}
        onFocus={() => { if (value.trim()) doSearch(value) }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        className={cn(
          'w-full py-2.5 pl-9 pr-3 rounded-xl text-sm text-white placeholder-slate-500',
          'focus:outline-none focus:ring-2 focus:ring-white/20 disabled:opacity-50',
          className,
        )}
        style={{ backgroundColor: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
        autoComplete="off"
      />

      {open && totalItems > 0 && (
        <div
          ref={listRef}
          className="absolute z-50 left-0 right-0 mt-1 rounded-xl overflow-hidden max-h-[240px] overflow-y-auto"
          style={{
            backgroundColor: 'rgba(15, 15, 25, 0.98)',
            border: '1px solid rgba(255,255,255,0.1)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          }}
        >
          {results.map((contact, i) => {
            const name = contact.displayName || contact.userName
            const initial = (name || contact.contactEmail).charAt(0).toUpperCase()
            return (
              <button
                key={contact.id}
                type="button"
                onClick={() => handleSelect(contact)}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors',
                  i === activeIndex ? 'bg-white/10' : 'hover:bg-white/[0.05]'
                )}
              >
                {contact.userImage && isSafeImageUrl(contact.userImage) ? (
                  <img src={contact.userImage} alt="" className="w-7 h-7 rounded-full flex-shrink-0" />
                ) : (
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium flex-shrink-0"
                    style={{ backgroundColor: 'color-mix(in srgb, var(--primary) 20%, transparent)', color: 'var(--primary)' }}
                  >
                    {initial}
                  </div>
                )}
                <div className="min-w-0">
                  {name && <p className="text-sm text-white truncate">{name}</p>}
                  <p className={cn('text-xs truncate', name ? 'text-slate-500' : 'text-sm text-white')}>
                    {contact.contactEmail}
                  </p>
                </div>
              </button>
            )
          })}

          {showRawOption && (
            <button
              type="button"
              onClick={handleSelectRaw}
              className={cn(
                'w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors border-t border-white/5',
                activeIndex === results.length ? 'bg-white/10' : 'hover:bg-white/[0.05]'
              )}
            >
              <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 bg-emerald-500/15">
                <User className="w-3.5 h-3.5 text-emerald-400" />
              </div>
              <p className="text-sm text-slate-300">
                Invite <span className="text-white font-medium">{value.trim()}</span>
              </p>
            </button>
          )}
        </div>
      )}
    </div>
  )
}
