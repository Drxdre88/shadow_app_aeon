'use client'

import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { useThemeStore } from '@/stores/themeStore'
import { cn } from '@/lib/utils/cn'

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const { colors } = useThemeStore()

  return (
    <div className="space-y-3">
      <h3
        className="text-sm font-semibold uppercase tracking-wider"
        style={{ color: colors.primary }}
      >
        {title}
      </h3>
      <div className="border border-white/10 rounded-xl p-4 bg-white/[0.02]">
        {children}
      </div>
    </div>
  )
}

export function FeatureCard({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ElementType
  title: string
  description: string
}) {
  const { colors } = useThemeStore()

  return (
    <div className="flex gap-3 p-3 rounded-lg bg-white/[0.03] border border-white/[0.06] hover:border-white/10 transition-colors">
      <div
        className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
        style={{ backgroundColor: `${colors.primary}20` }}
      >
        <Icon className="w-4 h-4" style={{ color: colors.primary }} />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-medium text-white">{title}</p>
        <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">{description}</p>
      </div>
    </div>
  )
}

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const { colors } = useThemeStore()

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      onClick={handleCopy}
      className={cn(
        'p-1.5 rounded-md transition-all duration-200',
        copied ? 'bg-green-500/20' : 'bg-white/5 hover:bg-white/10'
      )}
    >
      {copied ? (
        <Check className="w-3.5 h-3.5 text-green-400" />
      ) : (
        <Copy className="w-3.5 h-3.5 text-slate-400" />
      )}
    </button>
  )
}

export function CodeBlock({ children, copyText }: { children: string; copyText?: string }) {
  return (
    <div className="relative group rounded-lg bg-black/40 border border-white/[0.06] overflow-hidden">
      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <CopyButton text={copyText ?? children} />
      </div>
      <pre className="p-4 text-xs text-slate-300 overflow-x-auto leading-relaxed">
        <code>{children}</code>
      </pre>
    </div>
  )
}
