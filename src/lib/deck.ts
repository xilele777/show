export interface CardPose {
  x: number
  z: number
  rotateY: number
  scale: number
  shade: number
  opacity: number
  zIndex: number
  visible: boolean
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function wrapIndex(index: number, total: number): number {
  if (total <= 0) return 0
  return ((Math.round(index) % total) + total) % total
}

export function circularOffset(index: number, position: number, total: number, loop: boolean): number {
  let diff = index - position
  if (loop && total > 0) {
    diff = ((diff % total) + total) % total
    if (diff > total / 2) diff -= total
  }
  return diff
}

export function cardPose(rel: number, unit: number, intro = 1): CardPose {
  const abs = Math.abs(rel)
  const clamped = Math.min(abs, 3.2)
  const sign = Math.sign(rel)
  const visible = abs <= 3.1
  const spread = Math.min(abs, 1) * unit + Math.max(0, abs - 1) * unit * 0.58
  const edgeOpacity = abs <= 2.2 ? 1 : Math.max(0, 1 - (abs - 2.2) * 1.1)
  const introOpacity = abs < 0.5 ? 1 : clamp(intro * intro, 0, 1)

  return {
    x: sign * spread * intro,
    z: -clamped * 115,
    rotateY: -clamp(rel * 24, -34, 34) * intro,
    scale: Math.max(0.68, 1 - clamped * 0.13) * (0.94 + 0.06 * intro),
    shade: Math.min(0.48, clamped * 0.16),
    opacity: visible ? edgeOpacity * introOpacity : 0,
    zIndex: Math.round(50 - clamped * 10),
    visible
  }
}

export function rubberBand(overshoot: number, limit = 0.32): number {
  if (overshoot <= 0) return 0
  return limit * (1 - 1 / (overshoot / limit + 1))
}

export function springStep(
  position: number,
  velocity: number,
  target: number,
  dt: number,
  stiffness = 210,
  damping = 27
): [number, number] {
  const acceleration = -stiffness * (position - target) - damping * velocity
  const nextVelocity = velocity + acceleration * dt
  return [position + nextVelocity * dt, nextVelocity]
}

export function projectTarget(start: number, position: number, velocity: number, maxJump = 5): number {
  const base = Math.round(start)
  let next = Math.round(position + velocity * 0.22)
  if (next === base) {
    const moved = position - start
    if (Math.abs(velocity) > 1.2) next = base + Math.sign(velocity)
    else if (Math.abs(moved) > 0.16) next = base + Math.sign(moved)
  }
  return clamp(next, base - maxJump, base + maxJump)
}

export function easeOutExpo(t: number): number {
  return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)
}
