'use client'

import { useRef } from 'react'
import { useThemeStore } from '@/stores/themeStore'
import { useGlowFollower, useParticles, useTrail, useNeonLine, useIce, usePortal } from './simpleEffects'
import { useFlameEffect } from './flameEffect'
import { useSmokeEffect } from './smokeEffect'

export function CursorEffect() {
  const { cursorEffect, cursorColor, colors, smokeVolume } = useThemeStore()
  const containerRef = useRef<HTMLDivElement>(null)
  const effectColor = cursorColor || colors.glowColor

  const glowActive = cursorEffect === 'glow' || cursorEffect === 'combo'
  const particlesActive = cursorEffect === 'particles' || cursorEffect === 'combo'
  const trailActive = cursorEffect === 'trail'
  const neonActive = cursorEffect === 'neon'
  const iceActive = cursorEffect === 'ice'
  const portalActive = cursorEffect === 'portal'

  const fireActive = cursorEffect === 'fire'
  const venomActive = cursorEffect === 'venom'
  const plasmaActive = cursorEffect === 'plasma'
  const bloodMoonActive = cursorEffect === 'blood-moon'

  const smokeActive = cursorEffect === 'smoke'
  const infernoSmokeActive = cursorEffect === 'inferno-smoke'
  const venomSmokeActive = cursorEffect === 'venom-smoke'
  const plasmaSmokeActive = cursorEffect === 'plasma-smoke'
  const bloodMoonSmokeActive = cursorEffect === 'blood-moon-smoke'
  const customSmokeActive = cursorEffect === 'custom-smoke'

  useGlowFollower(containerRef, effectColor, glowActive)
  useParticles(containerRef, effectColor, particlesActive)
  useTrail(containerRef, effectColor, trailActive)
  useNeonLine(containerRef, effectColor, neonActive)
  useFlameEffect(containerRef, 'fire', fireActive)
  useIce(containerRef, iceActive)
  usePortal(containerRef, effectColor, portalActive)
  useFlameEffect(containerRef, 'venom', venomActive)
  useFlameEffect(containerRef, 'plasma', plasmaActive)
  useFlameEffect(containerRef, 'blood-moon', bloodMoonActive)
  useSmokeEffect(containerRef, 'smoke', smokeActive, smokeVolume)
  useSmokeEffect(containerRef, 'inferno-smoke', infernoSmokeActive, smokeVolume)
  useSmokeEffect(containerRef, 'venom-smoke', venomSmokeActive, smokeVolume)
  useSmokeEffect(containerRef, 'plasma-smoke', plasmaSmokeActive, smokeVolume)
  useSmokeEffect(containerRef, 'blood-moon-smoke', bloodMoonSmokeActive, smokeVolume)
  useSmokeEffect(containerRef, 'custom-smoke', customSmokeActive, smokeVolume, effectColor)

  if (cursorEffect === 'none') return null

  return (
    <div
      ref={containerRef}
      className="pointer-events-none fixed inset-0 z-[100]"
    />
  )
}
