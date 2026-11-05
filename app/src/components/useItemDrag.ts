import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { ID } from '../data/types'

// 보드 위 항목(사진·메모)을 끌어 옮기는 공용 동작: 맵(F-31)과 프로젝트 보드(F-33)가 같이 쓴다.
//  - 4px 미만으로 움직이면 누르기, 그 이상이면 끌기.
//  - 손을 뗀 위치로 최종 위치를 계산한다(중간 이동 이벤트가 없어도 끌기로 인정).
//  - min 왼쪽·위로는 끌 수 없다 (저장 좌표가 음수가 되지 않게).

const DRAG_START = 4

export interface DragItem {
  id: ID
  x: number // 왼쪽 위
  y: number
  w: number
  h: number
}

export interface DragState extends DragItem {
  sx: number
  sy: number
  left: number // 끌기 시작할 때 왼쪽 위
  top: number
  moved: boolean
  minX: number
  minY: number
}

// scale: 보드 확대·축소 배율. 손 이동량(화면 px)을 보드 좌표로 바꾸려고 나눈다.
export function useItemDrag(min: { x: number; y: number }, onDrop: (d: DragState) => void, scale = 1) {
  const [drag, setDrag] = useState<DragState | null>(null)
  const ref = useRef<DragState | null>(null)
  const dragged = useRef(false) // 방금 끌었으면 이어서 오는 click은 무시
  useEffect(() => {
    const cancel = () => { ref.current = null; setDrag(null) }
    window.addEventListener('archive:gesture', cancel)
    return () => window.removeEventListener('archive:gesture', cancel)
  }, [])

  const follow = (d: DragState, e: ReactPointerEvent<HTMLElement>): DragState => {
    const dx = (e.clientX - d.sx) / scale
    const dy = (e.clientY - d.sy) / scale
    if (!d.moved && Math.hypot(dx * scale, dy * scale) < DRAG_START) return d
    return { ...d, moved: true, x: Math.max(d.minX, d.left + dx), y: Math.max(d.minY, d.top + dy) }
  }

  const bind = (it: DragItem) => ({
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
      if (e.button !== 0) return
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {
        // 이미 끝난 포인터 등: 캡처 없이도 아래 window 이벤트로 끝까지 따라간다
      }
      dragged.current = false
      ref.current = { ...it, sx: e.clientX, sy: e.clientY, left: it.x, top: it.y, moved: false, minX: min.x, minY: min.y }
    },
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => {
      const d = ref.current
      if (!d) return
      const next = follow(d, e)
      ref.current = next
      if (next.moved) setDrag(next)
    },
    onPointerUp: (e: ReactPointerEvent<HTMLElement>) => {
      const start = ref.current
      ref.current = null
      setDrag(null)
      if (!start || e.type === 'pointercancel') return
      const d = follow(start, e)
      if (!d.moved) return
      dragged.current = true
      window.setTimeout(() => (dragged.current = false), 60) // 놓은 직후에 오는 click만 무시
      onDrop(d)
    },
    onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => {
      ref.current = null
      setDrag(null)
      void e
    },
  })

  // click 핸들러 맨 앞에서: 끌고 난 뒤의 click이면 true (그 click은 무시해야 한다)
  const consumeClick = () => {
    if (!dragged.current) return false
    dragged.current = false
    return true
  }

  // 진행 중인 끌기를 없던 일로 한다 (꾹 눌러 프로젝트로 끌기가 시작될 때 위치 이동과 겹치지 않게)
  const cancel = () => {
    ref.current = null
    setDrag(null)
  }

  return { drag, bind, consumeClick, cancel }
}
