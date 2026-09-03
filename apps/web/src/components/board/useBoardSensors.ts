import { useSensor, useSensors, MouseSensor, TouchSensor } from '@dnd-kit/core'

// The board's card-drag activation tuning, shared by every surface that drags
// cards (the board itself and the Zen focus layer) so the gesture never
// diverges between them.
//
// MouseSensor (not PointerSensor) on purpose: PointerSensor also claims touch
// pointers, and its 5px distance constraint would start a drag on the first
// finger movement — exactly the gesture that should scroll a column. Touch
// input goes exclusively through TouchSensor's long-press activation: hold
// 250ms to lift a card, swipe within the delay to scroll (movement past the
// tolerance aborts activation and the browser pans natively, since cards use
// touch-action: manipulation instead of none). Tolerance 8px absorbs finger
// tremble during the hold — dnd-kit docs recommend a looser tolerance with
// delay-based touch activation.
export function useBoardSensors() {
  return useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } })
  )
}
