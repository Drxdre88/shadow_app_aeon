import { useEffect } from 'react'

interface FlameConfig {
  hueRange: [number, number]
  saturation: number
  lightness: [number, number]
  hueMode?: 'split'
  splitHue?: [number, number]
}

export const FLAME_CONFIGS: Record<string, FlameConfig> = {
  fire: { hueRange: [15, 45], saturation: 100, lightness: [60, 40] },
  venom: { hueRange: [90, 130], saturation: 100, lightness: [60, 40] },
  plasma: { hueRange: [220, 280], saturation: 100, lightness: [70, 50] },
  'blood-moon': { hueRange: [340, 360], saturation: 100, lightness: [45, 25], hueMode: 'split', splitHue: [0, 15] },
}

export function useFlameEffect(containerRef: React.RefObject<HTMLDivElement | null>, variant: string, active: boolean) {
  useEffect(() => {
    if (!active || !containerRef.current) return
    const container = containerRef.current
    const config = FLAME_CONFIGS[variant]
    if (!config) return

    const onMove = (e: MouseEvent) => {
      const count = 2 + Math.floor(Math.random() * 2)
      for (let i = 0; i < count; i++) {
        const flame = document.createElement('div')
        const size = 8 + Math.random() * 12
        let hue: number
        if (config.hueMode === 'split' && config.splitHue && Math.random() > 0.5) {
          hue = config.splitHue[0] + Math.random() * (config.splitHue[1] - config.splitHue[0])
        } else {
          hue = config.hueRange[0] + Math.random() * (config.hueRange[1] - config.hueRange[0])
        }
        const offsetX = (Math.random() - 0.5) * 16
        flame.style.cssText = `
          position: fixed;
          pointer-events: none;
          left: ${e.clientX + offsetX}px;
          top: ${e.clientY}px;
          width: ${size}px;
          height: ${size * 1.4}px;
          background: radial-gradient(ellipse at bottom, hsl(${hue}, ${config.saturation}%, ${config.lightness[0]}%), hsl(${hue - 10}, ${config.saturation}%, ${config.lightness[1]}%) 60%, transparent);
          border-radius: 50% 50% 50% 50% / 60% 60% 40% 40%;
          transform: translate(-50%, -50%) scale(1);
          opacity: 0.9;
          will-change: transform, opacity;
          transition: transform 0.5s ease-out, opacity 0.5s ease-out, top 0.5s ease-out;
          filter: blur(1px);
        `
        container.appendChild(flame)
        requestAnimationFrame(() => {
          flame.style.top = `${e.clientY - 30 - Math.random() * 30}px`
          flame.style.transform = `translate(-50%, -50%) scale(0.2)`
          flame.style.opacity = '0'
        })
        setTimeout(() => flame.remove(), 550)
      }
    }

    document.addEventListener('mousemove', onMove)
    return () => document.removeEventListener('mousemove', onMove)
  }, [active, variant, containerRef])
}
