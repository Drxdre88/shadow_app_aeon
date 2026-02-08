'use client'

import Link from 'next/link'
import { Sparkles, Calendar, Clock, Users } from 'lucide-react'
import { GlowCard } from '@/components/ui/GlowCard'
import { NeonButton } from '@/components/ui/NeonButton'
import { ThemeSelector } from '@/components/ui/ThemeSelector'

export default function HomePage() {
  return (
    <div className="min-h-screen p-8">
      <div className="fixed top-4 right-4 z-50 flex items-center gap-3">
        <Link href="/login">
          <NeonButton color="purple" size="sm" variant="outline">
            Sign In
          </NeonButton>
        </Link>
        <ThemeSelector />
      </div>

      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-[500px] h-[500px] bg-glow-primary/20 rounded-full blur-[100px] animate-glow-breathe" />
        <div className="absolute bottom-1/4 right-1/4 w-[500px] h-[500px] bg-glow-secondary/20 rounded-full blur-[100px] animate-glow-breathe" style={{ animationDelay: '2s' }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[300px] h-[300px] bg-glow-accent/10 rounded-full blur-[80px] animate-glow-breathe" style={{ animationDelay: '1s' }} />
      </div>

      <div className="max-w-6xl mx-auto relative z-10">
        <div className="text-center mb-12">
          <div className="flex items-center justify-center gap-3 mb-4">
            <Sparkles className="w-12 h-12 text-glow-primary" />
            <h1 className="text-6xl font-bold bg-gradient-to-r from-glow-primary via-glow-secondary to-glow-accent bg-clip-text text-transparent">
              Aeon
            </h1>
          </div>
          <p className="text-xl text-slate-400">Beautiful project timelines and task management</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
          <GlowCard accentColor="purple" glowIntensity="md" showAccentLine hover>
            <div className="text-center p-4">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-purple-500/20 mb-4">
                <Calendar className="w-6 h-6 text-purple-400" />
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">Gantt Charts</h3>
              <p className="text-sm text-slate-400">Visualize project timelines with drag-and-drop tasks</p>
            </div>
          </GlowCard>

          <GlowCard accentColor="cyan" glowIntensity="md" showAccentLine hover>
            <div className="text-center p-4">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-cyan-500/20 mb-4">
                <Clock className="w-6 h-6 text-cyan-400" />
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">Task Boards</h3>
              <p className="text-sm text-slate-400">Organize work with kanban-style task management</p>
            </div>
          </GlowCard>

          <GlowCard accentColor="pink" glowIntensity="md" showAccentLine hover>
            <div className="text-center p-4">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-pink-500/20 mb-4">
                <Users className="w-6 h-6 text-pink-400" />
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">Team Ready</h3>
              <p className="text-sm text-slate-400">Built for teams with real-time collaboration</p>
            </div>
          </GlowCard>
        </div>

        <div className="text-center">
          <GlowCard accentColor="none" className="inline-block p-8">
            <h2 className="text-2xl font-bold text-white mb-4">Foundation Ready</h2>
            <p className="text-slate-400 mb-6 max-w-2xl">
              Aeon foundation is initialized with multi-theme system, Archon-inspired glow effects,
              and production-ready component architecture.
            </p>
            <div className="flex gap-4 justify-center">
              <Link href="/demo">
                <NeonButton color="purple" glowIntensity="lg">
                  Try Demo
                </NeonButton>
              </Link>
              <Link href="/login">
                <NeonButton color="none" variant="outline">
                  Sign In
                </NeonButton>
              </Link>
            </div>
          </GlowCard>
        </div>
      </div>
    </div>
  )
}
