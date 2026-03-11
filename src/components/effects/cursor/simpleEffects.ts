import { useEffect, useRef } from 'react'

export interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  maxLife: number
  size: number
  el: HTMLDivElement
}

export function useGlowFollower(containerRef: React.RefObject<HTMLDivElement | null>, color: string, active: boolean) {
  const posRef = useRef({ x: -200, y: -200 })
  const targetRef = useRef({ x: -200, y: -200 })
  const rafRef = useRef<number>(0)
  const followerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!active || !containerRef.current) return

    const follower = document.createElement('div')
    follower.style.cssText = `
      position: fixed;
      width: 40px;
      height: 40px;
      border-radius: 50%;
      pointer-events: none;
      transform: translate(-50%, -50%);
      background: ${color};
      opacity: 0.3;
      filter: blur(20px);
      transition: background 0.3s;
      will-change: transform;
    `
    containerRef.current.appendChild(follower)
    followerRef.current = follower

    let isAnimating = false
    const onMove = (e: MouseEvent) => {
      targetRef.current = { x: e.clientX, y: e.clientY }
      if (!isAnimating) {
        isAnimating = true
        rafRef.current = requestAnimationFrame(animate)
      }
    }
    document.addEventListener('mousemove', onMove)

    const animate = () => {
      const dx = targetRef.current.x - posRef.current.x
      const dy = targetRef.current.y - posRef.current.y
      posRef.current.x += dx * 0.15
      posRef.current.y += dy * 0.15
      if (followerRef.current) {
        followerRef.current.style.transform = `translate(calc(${posRef.current.x}px - 50%), calc(${posRef.current.y}px - 50%))`
      }
      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
        rafRef.current = requestAnimationFrame(animate)
      } else {
        isAnimating = false
      }
    }

    return () => {
      document.removeEventListener('mousemove', onMove)
      cancelAnimationFrame(rafRef.current)
      follower.remove()
      followerRef.current = null
    }
  }, [active, color, containerRef])
}

export function useParticles(containerRef: React.RefObject<HTMLDivElement | null>, color: string, active: boolean) {
  const particlesRef = useRef<Particle[]>([])
  const rafRef = useRef<number>(0)

  useEffect(() => {
    if (!active || !containerRef.current) return

    const container = containerRef.current

    const spawnParticle = (x: number, y: number) => {
      if (particlesRef.current.length >= 20) {
        const oldest = particlesRef.current.shift()
        if (oldest) {
          oldest.el.remove()
        }
      }

      const el = document.createElement('div')
      const size = 4 + Math.random() * 2
      el.style.cssText = `
        position: fixed;
        width: ${size}px;
        height: ${size}px;
        border-radius: 50%;
        pointer-events: none;
        background: ${color};
        opacity: 0.8;
        will-change: transform, opacity;
        transform: translate(-50%, -50%) translate(${x}px, ${y}px);
      `
      container.appendChild(el)

      particlesRef.current.push({
        x,
        y,
        vx: (Math.random() - 0.5) * 2,
        vy: -1 - Math.random() * 2,
        life: 1,
        maxLife: 30 + Math.random() * 20,
        size,
        el,
      })
    }

    const onMove = (e: MouseEvent) => {
      if (Math.random() > 0.4) {
        spawnParticle(e.clientX, e.clientY)
        startAnimation()
      }
    }
    document.addEventListener('mousemove', onMove)

    let isAnimating = false
    const animate = () => {
      particlesRef.current = particlesRef.current.filter((p) => {
        p.x += p.vx
        p.y += p.vy
        p.vy += 0.05
        p.life -= 1 / p.maxLife
        if (p.life <= 0) {
          p.el.remove()
          return false
        }
        p.el.style.opacity = String(p.life * 0.8)
        p.el.style.transform = `translate(-50%, -50%) translate(${p.x}px, ${p.y}px)`
        return true
      })
      if (particlesRef.current.length > 0) {
        rafRef.current = requestAnimationFrame(animate)
      } else {
        isAnimating = false
      }
    }

    const startAnimation = () => {
      if (!isAnimating) {
        isAnimating = true
        rafRef.current = requestAnimationFrame(animate)
      }
    }

    return () => {
      document.removeEventListener('mousemove', onMove)
      cancelAnimationFrame(rafRef.current)
      particlesRef.current.forEach((p) => p.el.remove())
      particlesRef.current = []
    }
  }, [active, color, containerRef])
}

export function useTrail(containerRef: React.RefObject<HTMLDivElement | null>, color: string, active: boolean) {
  const pointsRef = useRef<HTMLDivElement[]>([])

  useEffect(() => {
    if (!active || !containerRef.current) return
    const container = containerRef.current
    const TRAIL_LENGTH = 12

    for (let i = 0; i < TRAIL_LENGTH; i++) {
      const dot = document.createElement('div')
      const size = 8 - i * 0.5
      const opacity = 0.6 - i * 0.04
      dot.style.cssText = `
        position: fixed;
        pointer-events: none;
        width: ${Math.max(2, size)}px;
        height: ${Math.max(2, size)}px;
        border-radius: 50%;
        background: ${color};
        opacity: ${Math.max(0.05, opacity)};
        transform: translate(-50%, -50%);
        will-change: transform;
        left: -100px;
        top: -100px;
      `
      container.appendChild(dot)
      pointsRef.current.push(dot)
    }

    const positions = Array.from({ length: TRAIL_LENGTH }, () => ({ x: -100, y: -100 }))
    let rafId = 0
    let isAnimating = false

    const onMove = (e: MouseEvent) => {
      positions[0] = { x: e.clientX, y: e.clientY }
      if (!isAnimating) {
        isAnimating = true
        rafId = requestAnimationFrame(animate)
      }
    }

    const animate = () => {
      for (let i = positions.length - 1; i > 0; i--) {
        positions[i].x += (positions[i - 1].x - positions[i].x) * 0.35
        positions[i].y += (positions[i - 1].y - positions[i].y) * 0.35
      }
      pointsRef.current.forEach((dot, i) => {
        if (positions[i]) {
          dot.style.left = `${positions[i].x}px`
          dot.style.top = `${positions[i].y}px`
        }
      })

      const lastDx = Math.abs(positions[0].x - positions[positions.length - 1].x)
      const lastDy = Math.abs(positions[0].y - positions[positions.length - 1].y)
      if (lastDx > 0.5 || lastDy > 0.5) {
        rafId = requestAnimationFrame(animate)
      } else {
        isAnimating = false
      }
    }

    document.addEventListener('mousemove', onMove)
    return () => {
      document.removeEventListener('mousemove', onMove)
      cancelAnimationFrame(rafId)
      pointsRef.current.forEach((d) => d.remove())
      pointsRef.current = []
    }
  }, [active, color, containerRef])
}

export function useNeonLine(containerRef: React.RefObject<HTMLDivElement | null>, color: string, active: boolean) {
  const prevPos = useRef({ x: -100, y: -100 })

  useEffect(() => {
    if (!active || !containerRef.current) return
    const container = containerRef.current

    const onMove = (e: MouseEvent) => {
      const dx = e.clientX - prevPos.current.x
      const dy = e.clientY - prevPos.current.y
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (dist < 8) return

      const line = document.createElement('div')
      const angle = Math.atan2(dy, dx) * (180 / Math.PI)
      line.style.cssText = `
        position: fixed;
        pointer-events: none;
        left: ${prevPos.current.x}px;
        top: ${prevPos.current.y}px;
        width: ${Math.min(dist, 30)}px;
        height: 2px;
        background: ${color};
        transform-origin: left center;
        transform: rotate(${angle}deg);
        opacity: 0.7;
        filter: blur(0.5px);
        box-shadow: 0 0 6px ${color};
        will-change: opacity;
        transition: opacity 0.4s ease-out;
      `
      container.appendChild(line)
      requestAnimationFrame(() => { line.style.opacity = '0' })
      setTimeout(() => line.remove(), 500)

      prevPos.current = { x: e.clientX, y: e.clientY }
    }

    document.addEventListener('mousemove', onMove)
    return () => document.removeEventListener('mousemove', onMove)
  }, [active, color, containerRef])
}

export function useIce(containerRef: React.RefObject<HTMLDivElement | null>, active: boolean) {
  useEffect(() => {
    if (!active || !containerRef.current) return
    const container = containerRef.current

    const onMove = (e: MouseEvent) => {
      if (Math.random() > 0.4) return
      const shard = document.createElement('div')
      const size = 4 + Math.random() * 8
      const angle = Math.random() * 360
      const dist = 10 + Math.random() * 25
      const tx = Math.cos(angle * Math.PI / 180) * dist
      const ty = Math.sin(angle * Math.PI / 180) * dist
      shard.style.cssText = `
        position: fixed;
        pointer-events: none;
        left: ${e.clientX}px;
        top: ${e.clientY}px;
        width: ${size}px;
        height: ${size * 0.4}px;
        background: linear-gradient(135deg, rgba(147,197,253,0.9), rgba(219,234,254,0.6));
        clip-path: polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%);
        transform: translate(-50%, -50%) rotate(${angle}deg) scale(1);
        opacity: 1;
        will-change: transform, opacity;
        transition: transform 0.4s ease-out, opacity 0.4s ease-out;
        box-shadow: 0 0 4px rgba(147,197,253,0.5);
      `
      container.appendChild(shard)
      requestAnimationFrame(() => {
        shard.style.transform = `translate(calc(-50% + ${tx}px), calc(-50% + ${ty}px)) rotate(${angle + 45}deg) scale(0.3)`
        shard.style.opacity = '0'
      })
      setTimeout(() => shard.remove(), 500)
    }

    document.addEventListener('mousemove', onMove)
    return () => document.removeEventListener('mousemove', onMove)
  }, [active, containerRef])
}

export function usePortal(containerRef: React.RefObject<HTMLDivElement | null>, color: string, active: boolean) {
  const rafRef = useRef<number>(0)
  const particlesRef = useRef<{ el: HTMLDivElement; angle: number; radius: number; speed: number; life: number }[]>([])
  const mouseRef = useRef({ x: -200, y: -200 })

  useEffect(() => {
    if (!active || !containerRef.current) return
    const container = containerRef.current

    const onMove = (e: MouseEvent) => {
      mouseRef.current = { x: e.clientX, y: e.clientY }
      if (particlesRef.current.length < 20 && Math.random() > 0.5) {
        const el = document.createElement('div')
        const size = 3 + Math.random() * 4
        el.style.cssText = `
          position: fixed;
          pointer-events: none;
          width: ${size}px;
          height: ${size}px;
          border-radius: 50%;
          background: ${color};
          opacity: 0.7;
          will-change: transform;
          box-shadow: 0 0 ${size}px ${color};
        `
        container.appendChild(el)
        particlesRef.current.push({
          el,
          angle: Math.random() * Math.PI * 2,
          radius: 15 + Math.random() * 20,
          speed: 0.03 + Math.random() * 0.04,
          life: 60 + Math.random() * 40,
        })
      }
    }

    let isAnimating = false
    const animate = () => {
      particlesRef.current = particlesRef.current.filter((p) => {
        p.angle += p.speed
        p.radius *= 0.995
        p.life--
        if (p.life <= 0) { p.el.remove(); return false }
        const x = mouseRef.current.x + Math.cos(p.angle) * p.radius
        const y = mouseRef.current.y + Math.sin(p.angle) * p.radius
        p.el.style.left = `${x}px`
        p.el.style.top = `${y}px`
        p.el.style.opacity = String(Math.min(0.7, p.life / 30))
        return true
      })
      if (particlesRef.current.length > 0) {
        rafRef.current = requestAnimationFrame(animate)
      } else {
        isAnimating = false
      }
    }

    const startAnim = () => {
      if (!isAnimating) { isAnimating = true; rafRef.current = requestAnimationFrame(animate) }
    }

    const onMoveWrap = (e: MouseEvent) => { onMove(e); startAnim() }

    document.addEventListener('mousemove', onMoveWrap)
    return () => {
      document.removeEventListener('mousemove', onMoveWrap)
      cancelAnimationFrame(rafRef.current)
      particlesRef.current.forEach((p) => p.el.remove())
      particlesRef.current = []
    }
  }, [active, color, containerRef])
}
