import { useEffect, useRef, useState, type MouseEvent as RMouseEvent, type PointerEvent as RPointerEvent } from 'react'

// 터치로 메모 본문을 꾹 누르면 이동이 시작된다(짧게 누르면 그대로 글 수정). 마우스는 영향 없음(윗줄로 끌기 그대로).
// - 꾹 = HOLD_MS 동안 거의 안 움직이고 누르고 있기. 그 전에 SLOP 넘게 움직이면 취소(글자 자리 잡기·스크롤 등).
// - 두 번째 손가락이 닿으면(확대·축소) 취소한다(archive:gesture).

const HOLD_MS = 380
const SLOP = 10

export interface HoldPoint {
  clientX: number
  clientY: number
  pointerId: number
}

export function useHold() {
  const pending = useRef<{ timer: number; x: number; y: number } | null>(null)
  const [held, setHeld] = useState<string | null>(null) // 지금 들어 올린(이동 중인) 대상의 키

  const clear = () => {
    if (!pending.current) return
    window.clearTimeout(pending.current.timer)
    pending.current = null
  }
  useEffect(() => {
    const cancel = () => { clear(); setHeld(null) }
    const release = () => setHeld(null)
    window.addEventListener('archive:gesture', cancel)
    window.addEventListener('pointerup', release)
    window.addEventListener('pointercancel', release)
    return () => {
      window.removeEventListener('archive:gesture', cancel)
      window.removeEventListener('pointerup', release)
      window.removeEventListener('pointercancel', release)
      clear()
    }
  }, [])

  // key: 대상 구분, onHold: 꾹 눌렀을 때 이동을 시작시킨다(el = 이벤트를 받은 요소)
  const bind = (key: string, onHold: (p: HoldPoint, el: HTMLElement) => void) => ({
    onPointerDown: (e: RPointerEvent<HTMLElement>) => {
      if (e.pointerType === 'mouse' || e.button !== 0) return
      clear()
      const el = e.currentTarget
      const p: HoldPoint = { clientX: e.clientX, clientY: e.clientY, pointerId: e.pointerId }
      pending.current = {
        x: p.clientX,
        y: p.clientY,
        timer: window.setTimeout(() => {
          pending.current = null
          setHeld(key)
          try { navigator.vibrate?.(12) } catch { /* 진동을 못 쓰는 기기 */ }
          onHold(p, el)
        }, HOLD_MS),
      }
    },
    onPointerMove: (e: RPointerEvent<HTMLElement>) => {
      const s = pending.current
      if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > SLOP) clear()
    },
    onPointerUp: clear,
    onPointerCancel: clear,
    // 터치 기기에서는 꾹 누르면 글자 선택 메뉴가 뜨지 않게 한다(꾹 = 이동)
    onContextMenu: (e: RMouseEvent<HTMLElement>) => {
      if (window.matchMedia('(pointer: coarse)').matches) e.preventDefault()
    },
  })

  return { held, bind }
}
