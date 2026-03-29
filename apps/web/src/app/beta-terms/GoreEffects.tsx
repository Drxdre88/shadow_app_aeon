'use client'

import { motion } from 'framer-motion'

const BLOOD_DRIPS = [
  { left: 1, delay: 0, height: 55, duration: 3.0, width: 2.5 },
  { left: 4, delay: 0.1, height: 70, duration: 3.5, width: 3 },
  { left: 7, delay: 0.05, height: 45, duration: 2.8, width: 2 },
  { left: 10, delay: 0.2, height: 80, duration: 4.0, width: 3.5 },
  { left: 13, delay: 0.15, height: 60, duration: 3.2, width: 2.5 },
  { left: 16, delay: 0.3, height: 50, duration: 3.0, width: 2 },
  { left: 3, delay: 0.4, height: 65, duration: 3.8, width: 2 },
  { left: 9, delay: 0.25, height: 90, duration: 4.5, width: 3 },
  { left: 15, delay: 0.35, height: 42, duration: 2.6, width: 2.5 },
  { left: 6, delay: 0.5, height: 75, duration: 3.6, width: 2 },
  { left: 12, delay: 0.45, height: 58, duration: 3.1, width: 2.5 },
  { left: 18, delay: 0.6, height: 48, duration: 2.9, width: 2 },
]

const FIRST_DRIPS = Array.from({ length: 8 }, () => ({
  left: `${5 + Math.random() * 90}%`,
  width: 2 + Math.random() * 3,
  delay: 0.2 + Math.random() * 0.8,
  duration: 4 + Math.random() * 3,
  maxHeight: 15 + Math.random() * 25,
}))

const MAIN_DRIPS = Array.from({ length: 50 }, () => ({
  left: `${Math.random() * 100}%`,
  width: 3 + Math.random() * 8,
  delay: 1.5 + Math.random() * 2.5,
  duration: 4 + Math.random() * 5,
  maxHeight: 25 + Math.random() * 65,
}))

const THIN_TRAILS = Array.from({ length: 30 }, () => ({
  left: `${Math.random() * 100}%`,
  width: 1.5 + Math.random() * 2.5,
  delay: 2.5 + Math.random() * 3,
  duration: 5 + Math.random() * 4,
  maxHeight: 35 + Math.random() * 55,
}))

const CLOTS = Array.from({ length: 12 }, () => ({
  x: -8 + Math.random() * 36,
  y: 2 + Math.random() * 30,
  size: 4 + Math.random() * 10,
  delay: 0.1 + Math.random() * 0.6,
  duration: 3 + Math.random() * 2,
  elongation: 0.5 + Math.random() * 0.8,
}))

const SPLATTERS = Array.from({ length: 8 }, () => ({
  x: -5 + Math.random() * 30,
  y: 5 + Math.random() * 25,
  size: 2 + Math.random() * 4,
  delay: 0.3 + Math.random() * 0.8,
  duration: 2.5 + Math.random() * 2,
}))

export function BloodDrips() {
  return (
    <div className="absolute top-0 left-0 w-full overflow-visible pointer-events-none" style={{ zIndex: 50 }}>
      {BLOOD_DRIPS.map((drip, i) => (
        <motion.div
          key={i}
          initial={{ height: 0, opacity: 0.95 }}
          animate={{ height: drip.height, opacity: [0.95, 0.85, 0.7, 0.4, 0] }}
          transition={{
            height: { delay: drip.delay, duration: drip.duration * 0.5, ease: [0.4, 0, 0.2, 1] },
            opacity: { delay: drip.delay, duration: drip.duration, ease: 'easeOut' },
          }}
          className="absolute rounded-b-full"
          style={{ left: drip.left, top: 0, width: drip.width, background: 'linear-gradient(180deg, #ef4444 0%, #dc2626 30%, #991b1b 70%, transparent 100%)', filter: 'drop-shadow(0 0 4px rgba(239, 68, 68, 0.7))' }}
        />
      ))}
      {BLOOD_DRIPS.map((drip, i) => (
        <motion.div
          key={`blob-${i}`}
          initial={{ scale: 0, opacity: 0.9 }}
          animate={{ scale: [0, 1.2, 0.8], opacity: [0.9, 0.7, 0] }}
          transition={{ delay: drip.delay + drip.duration * 0.45, duration: 2.0, ease: 'easeOut' }}
          className="absolute rounded-full"
          style={{ left: drip.left - 1, top: drip.height, width: drip.width + 2, height: drip.width + 2, backgroundColor: '#dc2626', filter: 'drop-shadow(0 0 6px rgba(220, 38, 38, 0.6))' }}
        />
      ))}
    </div>
  )
}

export function BloodFlood() {
  return (
    <motion.div
      className="fixed inset-0 pointer-events-none overflow-hidden"
      style={{ zIndex: 100 }}
      initial={{ opacity: 1 }}
      animate={{ opacity: 0 }}
      transition={{ delay: 8, duration: 4, ease: 'easeInOut' }}
    >
      <motion.div className="absolute top-0 left-0 right-0 h-1" initial={{ opacity: 0 }} animate={{ opacity: [0, 0.4, 0.7, 0.9] }} transition={{ duration: 2, ease: 'easeIn' }} style={{ background: '#1a0000', boxShadow: '0 1px 8px rgba(40, 0, 0, 0.8)' }} />
      <motion.div className="absolute top-0 left-0 right-0" initial={{ height: 0, opacity: 0 }} animate={{ height: '100vh', opacity: [0, 0.15, 0.4, 0.7, 0.85, 0.7, 0] }} transition={{ height: { delay: 0.8, duration: 5, ease: [0.05, 0, 0.1, 1] }, opacity: { delay: 0.8, duration: 9, times: [0, 0.15, 0.3, 0.5, 0.6, 0.75, 1], ease: 'easeInOut' } }} style={{ background: 'linear-gradient(180deg, #1a0000 0%, #200202 15%, #2a0000 30%, rgba(30, 2, 2, 0.9) 50%, rgba(25, 0, 0, 0.6) 70%, rgba(20, 0, 0, 0.3) 85%, transparent 100%)' }} />
      <motion.div className="absolute top-0 left-0 right-0" initial={{ height: 0, opacity: 0 }} animate={{ height: '60vh', opacity: [0, 0.3, 0.65, 0.8, 0.6, 0] }} transition={{ height: { delay: 2, duration: 4, ease: [0.1, 0, 0.1, 1] }, opacity: { delay: 2, duration: 8, times: [0, 0.1, 0.3, 0.5, 0.7, 1], ease: 'easeInOut' } }} style={{ background: 'linear-gradient(180deg, #120000 0%, #1a0000 30%, rgba(20, 0, 0, 0.7) 60%, transparent 100%)' }} />
      <motion.div className="absolute top-0 left-0 right-0" initial={{ height: 0, opacity: 0 }} animate={{ height: '35vh', opacity: [0, 0.5, 0.9, 0.85, 0.5, 0] }} transition={{ height: { delay: 1.2, duration: 3, ease: [0.1, 0, 0.1, 1] }, opacity: { delay: 1.2, duration: 8, times: [0, 0.1, 0.3, 0.5, 0.7, 1], ease: 'easeInOut' } }} style={{ background: 'linear-gradient(180deg, #0f0000 0%, #1a0000 50%, transparent 100%)' }} />
      {FIRST_DRIPS.map((drip, i) => (
        <motion.div key={`first-${i}`} className="absolute top-0 rounded-b-full" initial={{ height: 0, opacity: 0 }} animate={{ height: `${drip.maxHeight}vh`, opacity: [0, 0.7, 0.85, 0.5, 0.2] }} transition={{ height: { delay: drip.delay, duration: drip.duration, ease: [0.15, 0, 0.1, 1] }, opacity: { delay: drip.delay, duration: drip.duration + 2, ease: 'easeOut' } }} style={{ left: drip.left, width: drip.width, background: 'linear-gradient(180deg, #1a0000, #300505, #400a0a, transparent)' }} />
      ))}
      {MAIN_DRIPS.map((drip, i) => (
        <motion.div key={`main-${i}`} className="absolute top-0 rounded-b-full" initial={{ height: 0, opacity: 0 }} animate={{ height: `${drip.maxHeight}vh`, opacity: [0, 0.9, 0.85, 0.6, 0.3] }} transition={{ height: { delay: drip.delay, duration: drip.duration, ease: [0.2, 0, 0.05, 1] }, opacity: { delay: drip.delay, duration: drip.duration + 2, ease: 'easeOut' } }} style={{ left: drip.left, width: drip.width, background: 'linear-gradient(180deg, #1a0000 0%, #2a0000 15%, #3b0505 30%, #4a0808 50%, #5c0a0a 70%, rgba(70, 8, 8, 0.4) 88%, transparent 100%)', filter: 'blur(0.3px)' }} />
      ))}
      {MAIN_DRIPS.map((drip, i) => (
        <motion.div key={`pool-${i}`} className="absolute rounded-full" initial={{ scale: 0, opacity: 0 }} animate={{ scale: [0, 1.3, 1], opacity: [0, 0.8, 0] }} transition={{ delay: drip.delay + drip.duration * 0.85, duration: 3, ease: 'easeOut' }} style={{ left: `calc(${drip.left} - ${drip.width}px)`, top: `${drip.maxHeight}vh`, width: drip.width * 3, height: drip.width * 1.8, background: 'radial-gradient(ellipse, #3b0505, #1a0000, transparent)', filter: 'blur(1.5px)' }} />
      ))}
      {THIN_TRAILS.map((drip, i) => (
        <motion.div key={`thin-${i}`} className="absolute top-0 rounded-b-full" initial={{ height: 0, opacity: 0 }} animate={{ height: `${drip.maxHeight}vh`, opacity: [0, 0.75, 0.6, 0.25] }} transition={{ height: { delay: drip.delay, duration: drip.duration, ease: [0.3, 0, 0.05, 1] }, opacity: { delay: drip.delay + 0.5, duration: drip.duration + 3, ease: 'easeOut' } }} style={{ left: drip.left, width: drip.width, background: 'linear-gradient(180deg, #1a0000, #2a0000, #3b0505, #4a0808, transparent)' }} />
      ))}
    </motion.div>
  )
}

export function BloodClots() {
  return (
    <div className="absolute top-0 left-0 w-full overflow-visible pointer-events-none" style={{ zIndex: 50 }}>
      {CLOTS.map((clot, i) => (
        <motion.div key={`clot-${i}`} initial={{ scale: 0, opacity: 0 }} animate={{ scale: [0, 1.3, 1.1, 1], opacity: [0, 0.95, 0.85, 0.7, 0] }} transition={{ delay: clot.delay, duration: clot.duration, ease: 'easeOut' }} className="absolute" style={{ left: clot.x, top: clot.y, width: clot.size, height: clot.size * clot.elongation, borderRadius: '45% 55% 50% 50% / 40% 45% 55% 60%', background: 'radial-gradient(ellipse at 35% 40%, #3b0505 0%, #2a0000 40%, #1a0000 70%, rgba(15, 0, 0, 0.8) 100%)', boxShadow: '0 0 4px rgba(40, 5, 5, 0.6), inset 0 -1px 2px rgba(60, 8, 8, 0.4)', filter: 'blur(0.3px)' }} />
      ))}
      {SPLATTERS.map((s, i) => (
        <motion.div key={`splat-${i}`} initial={{ scale: 0, opacity: 0 }} animate={{ scale: [0, 1.5, 1], opacity: [0, 0.8, 0.6, 0] }} transition={{ delay: s.delay, duration: s.duration, ease: 'easeOut' }} className="absolute rounded-full" style={{ left: s.x, top: s.y, width: s.size, height: s.size, background: '#2a0000', boxShadow: '0 0 3px rgba(30, 0, 0, 0.5)' }} />
      ))}
      {CLOTS.slice(0, 5).map((clot, i) => (
        <motion.div key={`trail-${i}`} initial={{ height: 0, opacity: 0 }} animate={{ height: 8 + clot.size, opacity: [0, 0.7, 0.4, 0] }} transition={{ delay: clot.delay + 0.5, duration: clot.duration * 0.8, ease: [0.4, 0, 0.1, 1] }} className="absolute rounded-b-full" style={{ left: clot.x + clot.size / 2 - 1, top: clot.y + clot.size * clot.elongation, width: 2, background: 'linear-gradient(180deg, #2a0000, #1a0000, transparent)' }} />
      ))}
    </div>
  )
}
