import { registerCelebration } from './registry'
import type { CelebrationContext } from './types'

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3)
const easeIn = (t: number) => t * t * t
const easeInOut = (t: number) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
const easeOutBack = (t: number) => {
  const c1 = 1.70158
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
}
const easeOutElastic = (t: number) => {
  if (t === 0 || t === 1) return t
  return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1
}

registerCelebration({
  id: 'checkmark-pulse',
  name: 'Checkmark Pulse',
  category: 'business',
  duration: 1200,
  render: ({ ctx, originX, originY, width, height, progress }: CelebrationContext) => {
    const scaleProgress = Math.min(progress / 0.5, 1)
    const scale = easeOutElastic(scaleProgress)
    const size = 56

    const pulseCount = 3
    for (let i = 0; i < pulseCount; i++) {
      const delay = i * 0.12
      const pulseStart = 0.25 + delay
      if (progress < pulseStart) continue
      const pulseProgress = Math.min((progress - pulseStart) / 0.6, 1)
      const pulseRadius = size * 0.9 + pulseProgress * size * 1.8
      const pulseOpacity = (1 - pulseProgress) * 0.5

      ctx.save()
      ctx.beginPath()
      ctx.arc(originX, originY, pulseRadius, 0, Math.PI * 2)
      ctx.strokeStyle = `rgba(34, 197, 94, ${pulseOpacity})`
      ctx.lineWidth = 2.5 - i * 0.5
      ctx.stroke()
      ctx.restore()
    }

    ctx.save()
    ctx.translate(originX, originY)
    ctx.scale(scale, scale)

    const glowRadius = size * 1.1
    const glowGrad = ctx.createRadialGradient(0, 0, size * 0.2, 0, 0, glowRadius)
    glowGrad.addColorStop(0, 'rgba(34, 197, 94, 0.28)')
    glowGrad.addColorStop(0.5, 'rgba(34, 197, 94, 0.12)')
    glowGrad.addColorStop(1, 'rgba(34, 197, 94, 0)')
    ctx.beginPath()
    ctx.arc(0, 0, glowRadius, 0, Math.PI * 2)
    ctx.fillStyle = glowGrad
    ctx.fill()

    const bgGrad = ctx.createRadialGradient(0, -size * 0.1, 0, 0, 0, size * 0.85)
    bgGrad.addColorStop(0, 'rgba(20, 83, 45, 0.95)')
    bgGrad.addColorStop(1, 'rgba(15, 55, 30, 0.92)')
    ctx.beginPath()
    ctx.arc(0, 0, size * 0.85, 0, Math.PI * 2)
    ctx.fillStyle = bgGrad
    ctx.fill()

    ctx.beginPath()
    ctx.arc(0, 0, size * 0.85, 0, Math.PI * 2)
    ctx.strokeStyle = 'rgba(74, 222, 128, 0.6)'
    ctx.lineWidth = 2
    ctx.stroke()

    const checkProgress = Math.min(progress / 0.6, 1)
    const totalLength = (size * 0.38) + (size * 0.62)

    ctx.save()
    ctx.shadowColor = '#4ade80'
    ctx.shadowBlur = 14
    ctx.beginPath()
    ctx.moveTo(-size * 0.34, 0)
    ctx.lineTo(-size * 0.04, size * 0.34)
    ctx.lineTo(size * 0.38, -size * 0.3)
    ctx.strokeStyle = '#4ade80'
    ctx.lineWidth = 5.5
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.setLineDash([totalLength])
    ctx.lineDashOffset = totalLength * (1 - easeOut(checkProgress))
    ctx.stroke()
    ctx.setLineDash([])
    ctx.restore()

    ctx.restore()
  }
})

registerCelebration({
  id: 'stock-rise',
  name: 'Stock Rise',
  category: 'business',
  duration: 1800,
  render: ({ ctx, originX, originY, width, height, progress }: CelebrationContext) => {
    const chartWidth = 180
    const chartHeight = 90
    const chartX = originX - chartWidth / 2
    const chartY = originY - chartHeight - 20

    const lineProgress = easeInOut(Math.min(progress / 0.7, 1))
    const points: { x: number; y: number }[] = [
      { x: 0, y: 0.85 },
      { x: 0.12, y: 0.78 },
      { x: 0.22, y: 0.72 },
      { x: 0.35, y: 0.58 },
      { x: 0.48, y: 0.52 },
      { x: 0.6, y: 0.38 },
      { x: 0.72, y: 0.28 },
      { x: 0.85, y: 0.18 },
      { x: 1.0, y: 0.08 },
    ]

    ctx.save()
    const fillGrad = ctx.createLinearGradient(chartX, chartY, chartX, chartY + chartHeight)
    fillGrad.addColorStop(0, 'rgba(34, 197, 94, 0.22)')
    fillGrad.addColorStop(1, 'rgba(34, 197, 94, 0)')

    const visiblePoints = points.filter(p => p.x <= lineProgress)
    if (visiblePoints.length >= 2) {
      ctx.beginPath()
      ctx.moveTo(chartX + points[0].x * chartWidth, chartY + points[0].y * chartHeight)
      for (let i = 1; i < visiblePoints.length; i++) {
        ctx.lineTo(chartX + points[i].x * chartWidth, chartY + points[i].y * chartHeight)
      }
      const lastPt = visiblePoints[visiblePoints.length - 1]
      ctx.lineTo(chartX + lastPt.x * chartWidth, chartY + chartHeight)
      ctx.lineTo(chartX + points[0].x * chartWidth, chartY + chartHeight)
      ctx.closePath()
      ctx.fillStyle = fillGrad
      ctx.fill()
    }

    if (visiblePoints.length >= 2) {
      ctx.save()
      ctx.shadowColor = '#22c55e'
      ctx.shadowBlur = 8
      ctx.beginPath()
      ctx.moveTo(chartX + points[0].x * chartWidth, chartY + points[0].y * chartHeight)
      for (let i = 1; i < visiblePoints.length; i++) {
        ctx.lineTo(chartX + points[i].x * chartWidth, chartY + points[i].y * chartHeight)
      }
      ctx.strokeStyle = '#4ade80'
      ctx.lineWidth = 2.5
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.stroke()
      ctx.restore()
    }
    ctx.restore()

    const numbers = ['+1', '+2', '+5', '+10', '+3', '+7', '+15', '+4']
    const offsets = [-55, -28, 8, 42, -70, 20, -10, 55]
    const speedMult = [1.0, 0.85, 1.1, 0.95, 0.75, 1.05, 0.9, 1.15]
    const startTimes = [0.05, 0.12, 0.2, 0.3, 0.08, 0.22, 0.35, 0.15]
    const fontSizes = [18, 14, 22, 26, 13, 20, 30, 15]

    for (let i = 0; i < numbers.length; i++) {
      const localStart = startTimes[i]
      if (progress < localStart) continue
      const localProgress = Math.min((progress - localStart) / (0.65 * speedMult[i]), 1)
      const riseY = easeOut(localProgress) * 130
      const opacity = localProgress < 0.5 ? easeOut(localProgress * 2) : 1 - easeIn((localProgress - 0.5) * 2)

      ctx.save()
      ctx.globalAlpha = opacity * 0.95
      ctx.font = `bold ${fontSizes[i]}px -apple-system, system-ui, sans-serif`
      ctx.fillStyle = '#4ade80'
      ctx.shadowColor = '#22c55e'
      ctx.shadowBlur = 10
      ctx.textAlign = 'center'
      ctx.fillText(numbers[i], originX + offsets[i], originY - riseY)
      ctx.restore()

      const arrowX = originX + offsets[i] + (fontSizes[i] > 20 ? 26 : 18)
      const arrowY = originY - riseY + 4
      const arrowSize = fontSizes[i] > 20 ? 8 : 6

      ctx.save()
      ctx.globalAlpha = opacity * 0.85
      ctx.shadowColor = '#22c55e'
      ctx.shadowBlur = 8
      ctx.beginPath()
      ctx.moveTo(arrowX, arrowY)
      ctx.lineTo(arrowX - arrowSize * 0.5, arrowY + arrowSize)
      ctx.lineTo(arrowX + arrowSize * 0.5, arrowY + arrowSize)
      ctx.closePath()
      ctx.fillStyle = '#4ade80'
      ctx.fill()
      ctx.restore()
    }
  }
})

registerCelebration({
  id: 'rubber-stamp',
  name: 'Rubber Stamp',
  category: 'business',
  duration: 1400,
  render: ({ ctx, originX, originY, width, height, progress, elapsed }: CelebrationContext) => {
    const stampRadius = 62
    const impactTime = 0.38

    const overallOpacity = progress > 0.7 ? 1 - easeIn((progress - 0.7) / 0.3) : 1

    const dropProgress = Math.min(progress / impactTime, 1)
    const stampDropY = easeOut(dropProgress) * 90

    const startY = originY - 160
    const currentY = startY + stampDropY

    const shakeActive = progress > impactTime && elapsed < (impactTime * 1400) + 120
    let shakeX = 0
    let shakeY = 0
    if (shakeActive) {
      const shakePhase = (elapsed - impactTime * 1400) / 120
      const shakeAmp = 2.5 * (1 - shakePhase)
      shakeX = Math.sin(shakePhase * Math.PI * 6) * shakeAmp
      shakeY = Math.cos(shakePhase * Math.PI * 4) * shakeAmp * 0.5
    }

    if (progress > impactTime) {
      const splatProgress = Math.min((progress - impactTime) / 0.45, 1)

      const splatCount = 24
      for (let i = 0; i < splatCount; i++) {
        const angle = (i / splatCount) * Math.PI * 2 + i * 0.3
        const dist = (stampRadius * 0.85 + (i % 3) * 12) * easeOut(splatProgress)
        const splatX = originX + Math.cos(angle) * dist + shakeX
        const splatY = originY + Math.sin(angle) * dist * 0.45 + shakeY
        const splatR = (2.5 + (i % 4) * 1.2) * (1 - splatProgress * 0.4)
        const splatOpacity = (1 - splatProgress * 0.7) * overallOpacity

        ctx.save()
        ctx.globalAlpha = splatOpacity
        ctx.beginPath()
        ctx.arc(splatX, splatY, splatR, 0, Math.PI * 2)
        ctx.fillStyle = '#dc2626'
        ctx.shadowColor = '#ef4444'
        ctx.shadowBlur = 4
        ctx.fill()
        ctx.restore()
      }

      const inkTrailCount = 12
      for (let i = 0; i < inkTrailCount; i++) {
        const angle = (i / inkTrailCount) * Math.PI * 2 + 0.15
        const nearDist = stampRadius * 0.88 * easeOut(splatProgress)
        const farDist = nearDist + (8 + i % 5 * 4) * easeOut(splatProgress)
        const trailOpacity = (0.6 - splatProgress * 0.5) * overallOpacity
        if (trailOpacity <= 0) continue

        ctx.save()
        ctx.globalAlpha = trailOpacity
        ctx.beginPath()
        ctx.moveTo(originX + Math.cos(angle) * nearDist + shakeX, originY + Math.sin(angle) * nearDist * 0.45 + shakeY)
        ctx.lineTo(originX + Math.cos(angle) * farDist + shakeX, originY + Math.sin(angle) * farDist * 0.45 + shakeY)
        ctx.strokeStyle = '#ef4444'
        ctx.lineWidth = 1.5 + i % 3
        ctx.lineCap = 'round'
        ctx.stroke()
        ctx.restore()
      }
    }

    ctx.save()
    ctx.translate(shakeX, shakeY)
    ctx.globalAlpha = overallOpacity

    ctx.save()
    ctx.shadowColor = 'rgba(220, 38, 38, 0.5)'
    ctx.shadowBlur = 20
    ctx.beginPath()
    ctx.arc(originX, currentY, stampRadius, 0, Math.PI * 2)
    ctx.strokeStyle = '#dc2626'
    ctx.lineWidth = 4.5
    ctx.stroke()
    ctx.restore()

    ctx.save()
    ctx.beginPath()
    ctx.arc(originX, currentY, stampRadius - 8, 0, Math.PI * 2)
    ctx.strokeStyle = 'rgba(220, 38, 38, 0.35)'
    ctx.lineWidth = 1.5
    ctx.stroke()
    ctx.restore()

    const textOpacity = progress > impactTime ? Math.min((progress - impactTime) / 0.12, 1) : 0

    if (textOpacity > 0) {
      ctx.save()
      ctx.globalAlpha = textOpacity * overallOpacity
      ctx.shadowColor = '#dc2626'
      ctx.shadowBlur = 12
      ctx.font = `900 28px -apple-system, system-ui, sans-serif`
      ctx.fillStyle = '#dc2626'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.letterSpacing = '4px'
      ctx.fillText('DONE', originX, currentY + 2)
      ctx.restore()
    }

    const bgFill = ctx.createRadialGradient(originX, currentY, 0, originX, currentY, stampRadius - 6)
    bgFill.addColorStop(0, 'rgba(153, 27, 27, 0.18)')
    bgFill.addColorStop(1, 'rgba(153, 27, 27, 0.06)')
    ctx.beginPath()
    ctx.arc(originX, currentY, stampRadius - 6, 0, Math.PI * 2)
    ctx.fillStyle = bgFill
    ctx.fill()

    ctx.restore()
  }
})

registerCelebration({
  id: 'gold-seal',
  name: 'Gold Seal',
  category: 'business',
  duration: 1600,
  render: ({ ctx, originX, originY, width, height, progress }: CelebrationContext) => {
    const sealRadius = 58
    const expandProgress = easeOutBack(Math.min(progress / 0.35, 1))

    const moltenProgress = Math.min(progress / 0.3, 1)
    const currentRadius = sealRadius * easeOut(moltenProgress)

    ctx.save()
    const outerGlow = ctx.createRadialGradient(originX, originY, 0, originX, originY, sealRadius * 1.6 * expandProgress)
    outerGlow.addColorStop(0, 'rgba(255, 215, 0, 0.3)')
    outerGlow.addColorStop(0.5, 'rgba(218, 165, 32, 0.15)')
    outerGlow.addColorStop(1, 'rgba(184, 134, 11, 0)')
    ctx.beginPath()
    ctx.arc(originX, originY, sealRadius * 1.6 * expandProgress, 0, Math.PI * 2)
    ctx.fillStyle = outerGlow
    ctx.fill()
    ctx.restore()

    const sealGrad = ctx.createRadialGradient(originX - sealRadius * 0.25, originY - sealRadius * 0.25, 0, originX, originY, currentRadius)
    sealGrad.addColorStop(0, '#FFE55C')
    sealGrad.addColorStop(0.3, '#FFD700')
    sealGrad.addColorStop(0.65, '#DAA520')
    sealGrad.addColorStop(1, '#B8860B')

    ctx.save()
    ctx.shadowColor = '#FFD700'
    ctx.shadowBlur = 24
    ctx.beginPath()
    ctx.arc(originX, originY, currentRadius, 0, Math.PI * 2)
    ctx.fillStyle = sealGrad
    ctx.fill()
    ctx.restore()

    const embossProgress = easeInOut(Math.min((progress - 0.25) / 0.4, 1))
    if (embossProgress > 0) {
      const starPoints = 8
      ctx.save()
      ctx.globalAlpha = embossProgress
      ctx.translate(originX, originY)

      ctx.save()
      ctx.shadowColor = 'rgba(255, 255, 200, 0.6)'
      ctx.shadowBlur = 6
      ctx.beginPath()
      for (let i = 0; i < starPoints * 2; i++) {
        const angle = (i * Math.PI) / starPoints - Math.PI / 2
        const r = i % 2 === 0 ? sealRadius * 0.72 : sealRadius * 0.48
        if (i === 0) ctx.moveTo(Math.cos(angle) * r, Math.sin(angle) * r)
        else ctx.lineTo(Math.cos(angle) * r, Math.sin(angle) * r)
      }
      ctx.closePath()
      ctx.strokeStyle = 'rgba(255, 248, 180, 0.7)'
      ctx.lineWidth = 2
      ctx.stroke()
      ctx.restore()

      ctx.save()
      ctx.shadowColor = 'rgba(255, 255, 200, 0.5)'
      ctx.shadowBlur = 4
      ctx.beginPath()
      ctx.arc(0, 0, sealRadius * 0.38, 0, Math.PI * 2)
      ctx.strokeStyle = 'rgba(255, 250, 200, 0.75)'
      ctx.lineWidth = 1.5
      ctx.stroke()
      ctx.restore()

      const shieldW = sealRadius * 0.36
      const shieldH = sealRadius * 0.44
      ctx.save()
      ctx.shadowColor = 'rgba(255, 255, 200, 0.7)'
      ctx.shadowBlur = 6
      ctx.beginPath()
      ctx.moveTo(0, -shieldH * 0.9)
      ctx.lineTo(shieldW * 0.85, -shieldH * 0.35)
      ctx.lineTo(shieldW * 0.85, shieldH * 0.2)
      ctx.quadraticCurveTo(shieldW * 0.85, shieldH * 0.85, 0, shieldH)
      ctx.quadraticCurveTo(-shieldW * 0.85, shieldH * 0.85, -shieldW * 0.85, shieldH * 0.2)
      ctx.lineTo(-shieldW * 0.85, -shieldH * 0.35)
      ctx.closePath()
      ctx.strokeStyle = 'rgba(255, 250, 200, 0.8)'
      ctx.lineWidth = 2
      ctx.stroke()
      ctx.restore()

      ctx.restore()
    }

    const shimmerProgress = easeInOut(Math.min((progress - 0.5) / 0.38, 1))
    if (shimmerProgress > 0 && shimmerProgress < 1) {
      const shimmerX = (originX - sealRadius) + shimmerProgress * sealRadius * 2.4
      ctx.save()
      ctx.beginPath()
      ctx.arc(originX, originY, currentRadius, 0, Math.PI * 2)
      ctx.clip()
      const shimmerGrad = ctx.createLinearGradient(shimmerX - 30, 0, shimmerX + 30, 0)
      shimmerGrad.addColorStop(0, 'rgba(255, 255, 255, 0)')
      shimmerGrad.addColorStop(0.5, 'rgba(255, 255, 240, 0.45)')
      shimmerGrad.addColorStop(1, 'rgba(255, 255, 255, 0)')
      ctx.fillStyle = shimmerGrad
      ctx.fillRect(shimmerX - 30, originY - sealRadius, 60, sealRadius * 2)
      ctx.restore()
    }

    const particlePhase = Math.max(0, (progress - 0.5))
    if (particlePhase > 0) {
      const particleCount = 22
      for (let i = 0; i < particleCount; i++) {
        const seed = i * 137.508
        const angle = (seed % 360) * (Math.PI / 180)
        const speed = 55 + (seed % 45)
        const delay = (i % 5) * 0.04
        const localP = Math.max(0, Math.min((particlePhase - delay) / 0.5, 1))
        if (localP <= 0) continue

        const px = originX + Math.cos(angle) * speed * easeOut(localP)
        const py = originY + Math.sin(angle) * speed * easeOut(localP) - 35 * localP * localP
        const particleOpacity = (1 - localP) * 0.9
        const particleR = (2 + (i % 3) * 0.8) * (1 - localP * 0.5)

        const goldColors = ['#FFD700', '#DAA520', '#FFE55C', '#B8860B', '#FFC200']
        ctx.save()
        ctx.globalAlpha = particleOpacity
        ctx.shadowColor = '#FFD700'
        ctx.shadowBlur = 8
        ctx.beginPath()
        ctx.arc(px, py, particleR, 0, Math.PI * 2)
        ctx.fillStyle = goldColors[i % goldColors.length]
        ctx.fill()
        ctx.restore()
      }
    }

    ctx.save()
    ctx.beginPath()
    ctx.arc(originX, originY, currentRadius, 0, Math.PI * 2)
    ctx.strokeStyle = '#FFE55C'
    ctx.lineWidth = 2.5
    ctx.shadowColor = '#FFD700'
    ctx.shadowBlur = 12
    ctx.stroke()
    ctx.restore()
  }
})

registerCelebration({
  id: 'briefcase-snap',
  name: 'Briefcase Snap',
  category: 'business',
  duration: 1200,
  render: ({ ctx, originX, originY, width, height, progress }: CelebrationContext) => {
    const bW = 88
    const bH = 64
    const bR = 7
    const handleW = 32
    const handleH = 14
    const claspW = 14
    const claspH = 8

    const snapTime = 0.42
    const lidCloseProgress = easeOut(Math.min(progress / snapTime, 1))
    const lidAngle = (1 - lidCloseProgress) * (-Math.PI * 0.52)

    const overallOpacity = progress > 0.75 ? 1 - easeIn((progress - 0.75) / 0.25) : 1

    if (progress > snapTime) {
      const flashProgress = easeOut(Math.min((progress - snapTime) / 0.25, 1))
      const flashOpacity = (1 - flashProgress) * 0.65

      const flashGrad = ctx.createRadialGradient(originX, originY, 0, originX, originY, bW * 1.8 * flashProgress)
      flashGrad.addColorStop(0, `rgba(255, 215, 0, ${flashOpacity})`)
      flashGrad.addColorStop(0.4, `rgba(255, 200, 0, ${flashOpacity * 0.6})`)
      flashGrad.addColorStop(1, 'rgba(255, 180, 0, 0)')

      ctx.save()
      ctx.globalAlpha = 1
      ctx.beginPath()
      ctx.arc(originX, originY, bW * 1.8 * flashProgress, 0, Math.PI * 2)
      ctx.fillStyle = flashGrad
      ctx.fill()
      ctx.restore()
    }

    if (progress > snapTime) {
      const sparkPhase = (progress - snapTime) / 0.55
      const sparkCount = 20
      for (let i = 0; i < sparkCount; i++) {
        const baseAngle = (i / sparkCount) * Math.PI * 2
        const speed = 38 + (i % 4) * 12
        const delay = (i % 5) * 0.025
        const localP = Math.max(0, Math.min((sparkPhase - delay) / 0.8, 1))
        if (localP <= 0) continue

        const sx = originX + Math.cos(baseAngle) * speed * easeOut(localP)
        const sy = originY + Math.sin(baseAngle) * speed * easeOut(localP) - 28 * localP * localP
        const sparkOpacity = (1 - localP) * overallOpacity
        const sparkR = (1.8 + (i % 3) * 0.6) * (1 - localP * 0.6)

        ctx.save()
        ctx.globalAlpha = sparkOpacity
        ctx.shadowColor = '#FFD700'
        ctx.shadowBlur = 10
        ctx.beginPath()
        ctx.arc(sx, sy, sparkR, 0, Math.PI * 2)
        ctx.fillStyle = i % 2 === 0 ? '#FFD700' : '#FFC200'
        ctx.fill()
        ctx.restore()
      }
    }

    ctx.save()
    ctx.globalAlpha = overallOpacity

    const drawRoundRect = (x: number, y: number, w: number, h: number, r: number) => {
      ctx.beginPath()
      ctx.moveTo(x + r, y)
      ctx.lineTo(x + w - r, y)
      ctx.quadraticCurveTo(x + w, y, x + w, y + r)
      ctx.lineTo(x + w, y + h - r)
      ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
      ctx.lineTo(x + r, y + h)
      ctx.quadraticCurveTo(x, y + h, x, y + h - r)
      ctx.lineTo(x, y + r)
      ctx.quadraticCurveTo(x, y, x + r, y)
      ctx.closePath()
    }

    const bX = originX - bW / 2
    const bY = originY - bH / 2

    const bodyGrad = ctx.createLinearGradient(bX, bY + bH * 0.5, bX, bY + bH)
    bodyGrad.addColorStop(0, '#2d3748')
    bodyGrad.addColorStop(1, '#1a202c')

    drawRoundRect(bX, bY + bH * 0.5, bW, bH * 0.5, bR)
    ctx.fillStyle = bodyGrad
    ctx.fill()
    ctx.strokeStyle = '#4a5568'
    ctx.lineWidth = 1.5
    ctx.stroke()

    ctx.save()
    ctx.translate(originX, bY + bH * 0.5)
    ctx.rotate(lidAngle)

    const lidGrad = ctx.createLinearGradient(0, -bH * 0.5, 0, 0)
    lidGrad.addColorStop(0, '#3d4f63')
    lidGrad.addColorStop(1, '#2d3748')

    drawRoundRect(-bW / 2, -bH * 0.5, bW, bH * 0.5, bR)
    ctx.fillStyle = lidGrad
    ctx.fill()
    ctx.strokeStyle = '#4a5568'
    ctx.lineWidth = 1.5
    ctx.stroke()

    ctx.beginPath()
    ctx.moveTo(-handleW / 2, -bH * 0.5)
    ctx.lineTo(-handleW / 2, -bH * 0.5 - handleH)
    ctx.quadraticCurveTo(-handleW / 2, -bH * 0.5 - handleH - 8, 0, -bH * 0.5 - handleH - 8)
    ctx.quadraticCurveTo(handleW / 2, -bH * 0.5 - handleH - 8, handleW / 2, -bH * 0.5 - handleH)
    ctx.lineTo(handleW / 2, -bH * 0.5)
    ctx.strokeStyle = '#718096'
    ctx.lineWidth = 4
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.stroke()

    ctx.restore()

    const claspSnapped = lidCloseProgress > 0.9
    const claspGlowOpacity = claspSnapped && progress > snapTime ? Math.min((progress - snapTime) / 0.15, 1) * 0.8 : 0

    ctx.save()
    if (claspGlowOpacity > 0) {
      ctx.shadowColor = '#FFD700'
      ctx.shadowBlur = 16 * claspGlowOpacity
    }
    drawRoundRect(originX - claspW / 2, bY + bH * 0.5 - claspH / 2, claspW, claspH, 3)
    const claspGrad = ctx.createLinearGradient(originX - claspW / 2, 0, originX + claspW / 2, 0)
    claspGrad.addColorStop(0, '#B8860B')
    claspGrad.addColorStop(0.4, '#FFD700')
    claspGrad.addColorStop(1, '#DAA520')
    ctx.fillStyle = claspGrad
    ctx.fill()
    ctx.strokeStyle = '#FFE55C'
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.restore()

    ctx.restore()
  }
})
