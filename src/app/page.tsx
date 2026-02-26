'use client'

import Link from 'next/link'
import Image from 'next/image'
import { Calendar, Clock, Users } from 'lucide-react'
import { GlowCard } from '@/components/ui/GlowCard'
import { NeonButton } from '@/components/ui/NeonButton'
import { ThemeSelector } from '@/components/ui/ThemeSelector'
import { GlassStage } from '@/components/ui/GlassStage'
import aeonLogo from '@/assets/aeon.png'
import chimaeraLogo from '@/assets/chimaera.png'

export default function HomePage() {
  return (
    <div className="min-h-screen p-8">
      <GlassStage
        blobConfig={{
          blobs: [
            { position: 'top-[25%] left-[25%]', size: 'w-[500px] h-[500px]', color: 'glow', opacity: 0.15 },
            { position: 'bottom-[25%] right-[25%]', size: 'w-[500px] h-[500px]', color: 'primary', opacity: 0.12, delay: 2 },
            { position: 'top-[50%] left-[50%]', size: 'w-[300px] h-[300px]', color: 'accent', opacity: 0.08, delay: 1 },
          ]
        }}
      />
      <div className="fixed top-4 right-4 z-50 flex items-center gap-3">
        <Link href="/login">
          <NeonButton color="purple" size="sm" variant="outline">
            Sign In
          </NeonButton>
        </Link>
        <ThemeSelector />
      </div>

      <div className="max-w-6xl mx-auto relative z-10">
        <div className="text-center mb-12">
          <div className="flex items-center justify-center gap-4 mb-2">
            <Image
              src={aeonLogo}
              alt="Aeon"
              width={56}
              height={56}
              className="rounded-lg"
              style={{
                filter: 'drop-shadow(0 0 12px var(--glow-color))',
              }}
            />
            <h1
              className="text-6xl font-bold"
              style={{
                color: '#8a8f98',
                textShadow: '0 0 20px rgba(138, 143, 152, 0.4), 0 0 40px rgba(138, 143, 152, 0.2), 0 2px 4px rgba(0,0,0,0.5)',
              }}
            >
              Aeon
            </h1>
          </div>
          <div className="flex items-center justify-center gap-1.5 mb-4">
            <Image
              src={chimaeraLogo}
              alt="Chimaera"
              width={16}
              height={16}
              className="rounded-sm"
              style={{ filter: 'drop-shadow(0 0 4px rgba(13, 148, 136, 0.5))' }}
            />
            <span
              className="text-xs font-medium"
              style={{
                color: '#0d9488',
                textShadow: '0 0 8px rgba(13, 148, 136, 0.4)',
              }}
            >
              Chimaera Apps
            </span>
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
