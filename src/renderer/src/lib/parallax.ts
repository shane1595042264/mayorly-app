import { useEffect } from 'react'
import { motionValue, useReducedMotion, useSpring, useTransform, type MotionValue } from 'motion/react'

// One pointer, normalised to -1..1 from the centre of the screen. HUD planes read it
// through springs so they lean toward the cursor like a visor. Motion values only:
// no React re-render per mouse move.

const px = motionValue(0)
const py = motionValue(0)
let bound = false

function bind() {
  if (bound) return
  bound = true
  window.addEventListener('pointermove', (e) => {
    px.set((e.clientX / window.innerWidth) * 2 - 1)
    py.set((e.clientY / window.innerHeight) * 2 - 1)
  })
}

/** Rotation in degrees for a plane that should lean by up to `deg` toward the pointer. */
export function useLean(deg: number): { rotateX: MotionValue<number>; rotateY: MotionValue<number> } {
  const reduce = useReducedMotion()
  useEffect(bind, [])
  const k = reduce ? 0 : deg
  const rx = useTransform(py, (v) => -v * k)
  const ry = useTransform(px, (v) => v * k)
  const spring = { stiffness: 90, damping: 20, mass: 0.6 }
  return { rotateX: useSpring(rx, spring), rotateY: useSpring(ry, spring) }
}
