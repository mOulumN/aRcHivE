import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'

// 맵·프로젝트 보드의 확대·축소 (보드 전체 배율). 버튼(− + %)과 Ctrl(또는 ⌘)+휠.
// 확대·축소 때 보고 있던 지점(버튼은 화면 가운데, 휠은 마우스 위치)이 제자리에 있도록 스크롤을 맞춘다.

export const ZOOM_MIN = 0.3
export const ZOOM_MAX = 2.5
const STEP = 1.25
const clamp = (v: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v))

export function useZoom(scroller: RefObject<HTMLDivElement | null>) {
  const [zoom, setZoomState] = useState(1)
  const zoomRef = useRef(1)
  // 확대·축소 전 기준 지점: 보드 좌표(wx, wy)가 화면 위치(px, py)에 오도록 한다
  const anchor = useRef<{ wx: number; wy: number; px: number; py: number } | null>(null)

  const setZoom = (next: number, focus?: { px: number; py: number }) => {
    const el = scroller.current
    const nz = clamp(next)
    if (nz === zoomRef.current) return
    if (el) {
      const f = focus ?? { px: el.clientWidth / 2, py: el.clientHeight / 2 }
      anchor.current = { wx: (el.scrollLeft + f.px) / zoomRef.current, wy: (el.scrollTop + f.py) / zoomRef.current, px: f.px, py: f.py }
    }
    zoomRef.current = nz
    setZoomState(nz)
  }

  useLayoutEffect(() => {
    const el = scroller.current
    const a = anchor.current
    if (!el || !a) return
    el.scrollLeft = a.wx * zoom - a.px
    el.scrollTop = a.wy * zoom - a.py
    anchor.current = null
  }, [zoom, scroller])

  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return // 그냥 휠은 스크롤
      e.preventDefault()
      const r = el.getBoundingClientRect()
      setZoom(zoomRef.current * Math.exp(-e.deltaY * 0.0015), { px: e.clientX - r.left, py: e.clientY - r.top })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scroller])

  // 터치: 빈 곳 한 손가락 이동, 두 손가락은 위치 기준 확대·이동.
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const points = new Map<number, { x: number; y: number }>()
    let pan: { x: number; y: number; left: number; top: number } | null = null
    let pinch: { distance: number; zoom: number; wx: number; wy: number } | null = null
    let multi = false
    let suppressClickUntil = 0
    const geometry = () => {
      const [a, b] = [...points.values()]
      const rect = el.getBoundingClientRect()
      return { distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
        px: (a.x + b.x) / 2 - rect.left, py: (a.y + b.y) / 2 - rect.top }
    }
    const down = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return
      points.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (points.size === 2) {
        multi = true; pan = null
        suppressClickUntil = Date.now() + 500
        window.dispatchEvent(new Event('archive:gesture'))
        const g = geometry()
        pinch = { distance: g.distance, zoom: zoomRef.current,
          wx: (el.scrollLeft + g.px) / zoomRef.current, wy: (el.scrollTop + g.py) / zoomRef.current }
        for (const id of points.keys()) { try { el.setPointerCapture(id) } catch { /* 합성 이벤트 */ } }
        e.preventDefault(); e.stopPropagation()
      } else if (points.size === 1 && !(e.target as HTMLElement).closest('[data-entry], .pb-note, button, input, textarea')) {
        pan = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop }
        try { el.setPointerCapture(e.pointerId) } catch { /* 합성 이벤트 */ }
      }
    }
    const move = (e: PointerEvent) => {
      if (!points.has(e.pointerId)) return
      points.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (pinch && points.size >= 2) {
        const g = geometry(), nz = clamp(pinch.zoom * g.distance / pinch.distance)
        anchor.current = { wx: pinch.wx, wy: pinch.wy, px: g.px, py: g.py }
        zoomRef.current = nz; setZoomState(nz)
        el.scrollLeft = pinch.wx * nz - g.px; el.scrollTop = pinch.wy * nz - g.py
        e.preventDefault(); e.stopPropagation()
      } else if (pan && !multi) {
        el.scrollLeft = pan.left + pan.x - e.clientX; el.scrollTop = pan.top + pan.y - e.clientY
        e.preventDefault(); e.stopPropagation()
      } else if (multi) { e.preventDefault(); e.stopPropagation() }
    }
    const up = (e: PointerEvent) => {
      if (!points.has(e.pointerId)) return
      if (multi) { e.preventDefault(); e.stopPropagation() }
      if (multi) suppressClickUntil = Date.now() + 500
      points.delete(e.pointerId)
      if (points.size < 2) pinch = null
      if (!points.size) { multi = false; pan = null }
    }
    const click = (e: MouseEvent) => {
      if (Date.now() < suppressClickUntil) { e.preventDefault(); e.stopPropagation() }
    }
    el.addEventListener('pointerdown', down, true)
    el.addEventListener('pointermove', move, true)
    el.addEventListener('pointerup', up, true)
    el.addEventListener('pointercancel', up, true)
    el.addEventListener('click', click, true)
    return () => {
      el.removeEventListener('pointerdown', down, true); el.removeEventListener('pointermove', move, true)
      el.removeEventListener('pointerup', up, true); el.removeEventListener('pointercancel', up, true)
      el.removeEventListener('click', click, true)
    }
  }, [scroller])

  return {
    zoom,
    zoomIn: () => setZoom(zoomRef.current * STEP),
    zoomOut: () => setZoom(zoomRef.current / STEP),
    reset: () => setZoom(1),
  }
}

export function ZoomControl({ zoom, zoomIn, zoomOut, reset }: { zoom: number; zoomIn(): void; zoomOut(): void; reset(): void }) {
  return (
    <div className="zoom-ctl" role="group" aria-label="확대·축소">
      <button className="link" onClick={zoomOut} disabled={zoom <= ZOOM_MIN} aria-label="축소" title="축소">
        −
      </button>
      <button className="link zoom-pct" onClick={reset} title="100%로">
        {Math.round(zoom * 100)}%
      </button>
      <button className="link" onClick={zoomIn} disabled={zoom >= ZOOM_MAX} aria-label="확대" title="확대">
        +
      </button>
    </div>
  )
}
