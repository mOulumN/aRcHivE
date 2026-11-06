import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { useConfirm } from '../components/Ask'
import { ColorField } from '../components/ColorPicker'
import { InfoPanel } from '../components/InfoPanel'
import { usePhotoUrl } from '../components/Thumb'
import { MemoFont, shownFont, storedFont, roundFont } from '../components/MemoFont'
import { useHold, type HoldPoint } from '../components/useHold'
import { categoriesOf, newId, tagIdsOf, type Anchor, type AnchorShape, type Entry, type ID, type Note } from '../data/types'
import { useArchive } from '../state'

// 기록 화면 (F-02~F-05): 흰 칠판 위에 사진, 사진의 한 부분을 동그라미/사각으로 짚으면
// 바깥에 메모 상자가 생기고 가는 선으로 이어진다. 레퍼런스: 주석선_01~02, 텍스트박스_01~02
//
// 좌표: 데이터는 "사진 가로 = 1" 단위, 화면에서는 BASE px을 곱해 그린다.

const BASE = 600
const NOTE_W = 0.38
const NOTE_GAP = 0.06
const MIN_ANCHOR = 0.03
const DEFAULT_ANCHOR = 0.08
const FIT_MARGIN = 16 // 처음 열 때 사진과 칠판 가장자리 사이 최소 여백(px)
const MIN_NOTE_H = 0.1
const HANDLE = 10
const REACH = 1 // 지목(동그라미·사각)은 레이어처럼 사진 밖으로도 사진 크기만큼 나갈 수 있다
const GHOST_H = 90 // 메모를 붙일 곳을 고를 때 보이는 점선 상자 높이(px)
const CORNERS = ['nw', 'ne', 'sw', 'se'] as const
type Corner = (typeof CORNERS)[number]

type Tool = 'select' | AnchorShape | 'note'
type Selection = { kind: 'anchor' | 'note'; id: ID } | null
type Cam = { x: number; y: number; s: number }
// 지목 → 메모 단계: 도형을 먼저 놓고(adjust) 옆의 확인 박스로 확정하면, 메모를 붙일 곳을 고른다(place).
// 도형은 확정 전까지 저장하지 않는 임시 상태다(데이터 구조 변경 없음).
type Pending = { a: Anchor; attachTo: ID | null; phase: 'adjust' | 'place'; ghost: { x: number; y: number } }
type Drag =
  | { type: 'pan'; sx: number; sy: number; cam: Cam }
  | { type: 'moveGhost'; sx: number; sy: number; orig: { x: number; y: number } }
  | { type: 'placeTap'; sx: number; sy: number; cam: Cam; moved: boolean }
  | { type: 'draw'; shape: AnchorShape; x: number; y: number; attachTo: ID | null }
  | { type: 'moveAnchor'; id: ID; sx: number; sy: number; orig: Anchor }
  | { type: 'resizeAnchor'; id: ID; corner: Corner; sx: number; sy: number; orig: Anchor }
  | { type: 'moveNote'; id: ID; sx: number; sy: number; orig: Note }
  | { type: 'resizeNote'; id: ID; sx: number; sy: number; orig: Note; startH: number }

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const ZOOM_STEP = 1.25 // 확대·축소 버튼 한 번에 곱하는 배율

export function Board({ entry }: { entry: Entry }) {
  const { updateEntry, photos, series, tags, deleteEntry, go, view, settings } = useArchive()
  const confirm = useConfirm()
  const tagCount = tagIdsOf(entry).filter((id) => tags.some((t) => t.id === id)).length
  const photo = photos.get(entry.photoId)
  const url = usePhotoUrl(entry.photoId, 'full')
  const ratio = photo ? photo.height / photo.width : 1
  const PH = BASE * ratio

  const wrap = useRef<HTMLDivElement>(null)
  const [cam, setCam] = useState<Cam>({ x: 0, y: 0, s: 1 })
  const camRef = useRef(cam)
  camRef.current = cam
  const [tool, setTool] = useState<Tool>('select')
  const [sel, setSel] = useState<Selection>(null)
  // 그리는 중인 지목. 손을 아주 빨리 떼도 놓치지 않게 ref에도 같이 둔다.
  const [draft, setDraftState] = useState<Anchor | null>(null)
  const draftRef = useRef<Anchor | null>(null)
  const setDraft = (a: Anchor | null) => {
    draftRef.current = a
    setDraftState(a)
  }
  const [pending, setPendingState] = useState<Pending | null>(null)
  const pendingRef = useRef<Pending | null>(null)
  const setPending = (p: Pending | null) => {
    pendingRef.current = p
    setPendingState(p)
  }
  const [focusNote, setFocusNote] = useState<ID | null>(null)
  const [heights, setHeights] = useState<Record<ID, number>>({})
  const drag = useRef<Drag | null>(null)
  const latest = useRef(entry)
  latest.current = entry
  const touches = useRef(new Map<number, { x: number; y: number }>())
  const multiTouch = useRef(false)
  const pinch = useRef<{ distance: number; cam: Cam; wx: number; wy: number } | null>(null)

  const selectedNote = sel?.kind === 'note' ? entry.notes.find((n) => n.id === sel.id) : undefined
  const freeNote = selectedNote && !selectedNote.anchorId ? selectedNote : undefined
  const selectedAnchor = sel?.kind === 'anchor' ? entry.anchors.find((a) => a.id === sel.id) : undefined
  const [infoOpen, setInfoOpen] = useState(false)
  const [toolsOpen, setToolsOpen] = useState(false)
  const [noteColorOpen, setNoteColorOpen] = useState(false)
  const seriesName =
    categoriesOf(entry)
      .map((id) => series.find((s) => s.id === id)?.name)
      .filter(Boolean)
      .join(', ') || '카테고리 없음'

  const patch = useCallback((change: Partial<Entry>) => updateEntry({ ...latest.current, ...change }), [updateEntry])
  // 도형을 옮기거나 키울 때: 아직 확정 전인 임시 도형이면 화면 상태만, 아니면 기록에 쓴다.
  const writeAnchor = (a: Anchor) => {
    const p = pendingRef.current
    if (p && p.a.id === a.id) setPending({ ...p, a })
    else patch({ anchors: latest.current.anchors.map((x) => (x.id === a.id ? a : x)) })
  }

  // 처음 열 때 사진을 화면에 맞춘다(오른쪽에 메모 자리를 남김).
  // 세로로 긴 사진은 메모 글씨가 너무 작아지지 않게 위쪽부터 보여 주고 아래는 끌어서 본다.
  const moved = useRef(false)
  const fit = useCallback(() => {
    const el = wrap.current
    if (!el) return
    const w = el.clientWidth
    const h = el.clientHeight
    // 사진은 화면 가운데에, 화면 밖으로 나가지 않게(가로·세로 모두 안에 들어오게). 기본 크기(폭의 55%)보다 키우지는 않는다.
    // 메모는 사진 기준 위치 그대로라 사진 옆에 있다(화면 밖이면 끌어서 본다). 메모 글자 크기는 배율과 무관하게 일정하다.
    if (w <= 0 || h <= 0) return // 숨겨져 크기가 0일 때는 배율을 계산하지 않는다(음수 배율 방지)
    const s = Math.max(0.05, Math.min((w * 0.55) / BASE, (w - 2 * FIT_MARGIN) / BASE, (h - 2 * FIT_MARGIN) / PH))
    setCam({ s, x: (w - BASE * s) / 2, y: (h - PH * s) / 2 })
    moved.current = false
  }, [PH])
  useLayoutEffect(() => {
    fit()
    setSel(null)
    setTool('select')
    setPending(null)
  }, [entry.id, fit])
  // 화면 크기가 바뀌면, 사용자가 아직 움직이지 않았을 때만 다시 맞춘다.
  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(() => !moved.current && fit())
    ro.observe(el)
    return () => ro.disconnect()
  }, [fit])

  const toWorld = (cx: number, cy: number) => {
    const r = wrap.current!.getBoundingClientRect()
    const c = camRef.current
    return { x: (cx - r.left - c.x) / c.s, y: (cy - r.top - c.y) / c.s }
  }

  const touchGeometry = () => {
    const [a, b] = [...touches.current.values()]
    const rect = wrap.current!.getBoundingClientRect()
    return { distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
      x: (a.x + b.x) / 2 - rect.left, y: (a.y + b.y) / 2 - rect.top }
  }
  const touchDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'touch') return
    touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (touches.current.size !== 2) return
    const d = drag.current
    if (d?.type === 'moveNote' || d?.type === 'resizeNote') patch({ notes: latest.current.notes.map((n) => n.id === d.id ? d.orig : n) })
    if (d?.type === 'moveAnchor' || d?.type === 'resizeAnchor') writeAnchor(d.orig)
    drag.current = null; setDraft(null); multiTouch.current = true
    window.dispatchEvent(new Event('archive:gesture'))
    const g = touchGeometry(), c = camRef.current
    pinch.current = { distance: g.distance, cam: c, wx: (g.x - c.x) / c.s, wy: (g.y - c.y) / c.s }
    for (const id of touches.current.keys()) { try { e.currentTarget.setPointerCapture(id) } catch { /* 합성 이벤트 */ } }
    e.preventDefault(); e.stopPropagation()
  }
  const touchMove = (e: RPointerEvent<HTMLDivElement>) => {
    if (!touches.current.has(e.pointerId)) return
    touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const start = pinch.current
    if (start && touches.current.size >= 2) {
      const g = touchGeometry(), s = clamp(start.cam.s * g.distance / start.distance, 0.1, 6)
      moved.current = true
      setCam({ s, x: g.x - start.wx * s, y: g.y - start.wy * s })
    }
    if (multiTouch.current) { e.preventDefault(); e.stopPropagation() }
  }
  const touchUp = (e: RPointerEvent<HTMLDivElement>) => {
    if (!touches.current.has(e.pointerId)) return
    if (multiTouch.current) { e.preventDefault(); e.stopPropagation() }
    touches.current.delete(e.pointerId)
    if (touches.current.size < 2) pinch.current = null
    if (!touches.current.size) multiTouch.current = false
  }

  useEffect(() => {
    let timer: number | undefined
    const reveal = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        if (!window.matchMedia('(max-width: 767px)').matches) return
        const active = document.activeElement as HTMLElement | null
        if (!active?.closest('.note') || !wrap.current?.contains(active)) return
        const r = active.getBoundingClientRect(), area = wrap.current.getBoundingClientRect()
        const dy = r.top < area.top + 12 ? area.top + 12 - r.top
          : r.bottom > area.bottom - 12 ? area.bottom - 12 - r.bottom : 0
        if (dy) setCam((c) => ({ ...c, y: c.y + dy }))
      }, 80)
    }
    window.visualViewport?.addEventListener('resize', reveal)
    wrap.current?.addEventListener('focusin', reveal)
    const element = wrap.current
    return () => {
      window.clearTimeout(timer)
      window.visualViewport?.removeEventListener('resize', reveal)
      element?.removeEventListener('focusin', reveal)
    }
  }, [])

  // 휠 = 확대/축소 (마우스 위치 기준)
  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      const c = camRef.current
      const s = clamp(c.s * Math.exp(-e.deltaY * 0.0015), 0.1, 6)
      const px = e.clientX - r.left
      const py = e.clientY - r.top
      moved.current = true
      setCam({ s, x: px - (px - c.x) * (s / c.s), y: py - (py - c.y) * (s / c.s) })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // 버튼 확대·축소: 칠판 가운데 기준 (휠과 같은 범위)
  const zoomBy = (factor: number) => {
    const el = wrap.current
    if (!el) return
    const c = camRef.current
    const s = clamp(c.s * factor, 0.1, 6)
    const px = el.clientWidth / 2
    const py = el.clientHeight / 2
    moved.current = true
    setCam({ s, x: px - (px - c.x) * (s / c.s), y: py - (py - c.y) * (s / c.s) })
  }

  // 새 메모를 사진 오른쪽에, 다른 메모와 겹치지 않게 놓는다.
  const placeNote = (y: number): { x: number; y: number } => {
    const x = 1 + NOTE_GAP
    const column = latest.current.notes.filter((n) => n.x > 1).sort((a, b) => a.y - b.y)
    let top = y
    for (const n of column) {
      const h = (heights[n.id] ?? 90) / BASE
      if (top < n.y + h + 0.02 && top + 0.12 > n.y) top = n.y + h + 0.03
    }
    return { x, y: top }
  }

  const nextOrder = () => Math.max(0, ...latest.current.notes.map((n) => n.order)) + 1

  const addNote = (pos: { x: number; y: number }, anchorId: ID | null, extraAnchor?: Anchor) => {
    // 만드는 순간 보이는 글자 크기(설정값)를 그 메모에 저장한다. 이후엔 칸과 같은 비율로 확대·축소된다.
    const note: Note = { id: newId(), text: '', x: pos.x, y: pos.y, w: NOTE_W, color: '#ffffff', order: nextOrder(), anchorId,
      fontSize: roundFont(settings.noteFontSize / camRef.current.s) }
    patch({
      anchors: extraAnchor ? [...latest.current.anchors, extraAnchor] : latest.current.anchors,
      notes: [...latest.current.notes, note],
    })
    setSel({ kind: 'note', id: note.id })
    setFocusNote(note.id)
  }

  const onPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.button !== 1) return
    const target = e.target as HTMLElement
    if (target.closest('.note, [data-anchor], .anchor-handle, .info-panel, .info-toggle, .anchor-confirm, .note-ghost')) return
    const p = toWorld(e.clientX, e.clientY)
    const onPhoto = p.x >= 0 && p.x <= BASE && p.y >= 0 && p.y <= PH

    if (e.button === 0 && pendingRef.current?.phase === 'place') {
      // 메모 붙일 곳 고르기: 빈 곳을 짧게 누르면 그 자리에 붙이고, 끌면 화면만 옮긴다.
      drag.current = { type: 'placeTap', sx: e.clientX, sy: e.clientY, cam: camRef.current, moved: false }
    } else if (e.button === 0 && (tool === 'circle' || tool === 'rect') && onPhoto) {
      setPending(null)
      // 점 없는 메모를 고른 채로 짚으면, 새 메모 대신 그 메모에 연결한다(F-23).
      drag.current = { type: 'draw', shape: tool, x: p.x, y: p.y,
        attachTo: (window.matchMedia('(max-width: 767px)').matches ? selectedNote : freeNote)?.id ?? null }
      setDraft({ id: 'draft', shape: tool, x: p.x / BASE, y: p.y / BASE, w: 0, h: 0 })
    } else if (e.button === 0 && tool === 'note') {
      addNote({ x: p.x / BASE, y: p.y / BASE }, null)
      setTool('select')
      return
    } else {
      drag.current = { type: 'pan', sx: e.clientX, sy: e.clientY, cam: camRef.current }
      setSel(null)
      ;(document.activeElement as HTMLElement | null)?.blur()
    }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    const s = camRef.current.s
    if (d.type === 'pan') {
      moved.current = true
      setCam({ ...d.cam, x: d.cam.x + e.clientX - d.sx, y: d.cam.y + e.clientY - d.sy })
    } else if (d.type === 'placeTap') {
      if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 6) d.moved = true
      if (d.moved) {
        moved.current = true
        setCam({ ...d.cam, x: d.cam.x + e.clientX - d.sx, y: d.cam.y + e.clientY - d.sy })
      }
    } else if (d.type === 'moveGhost') {
      const cur = pendingRef.current
      if (cur) setPending({ ...cur, ghost: { x: d.orig.x + (e.clientX - d.sx) / s / BASE, y: d.orig.y + (e.clientY - d.sy) / s / BASE } })
    } else if (d.type === 'draw') {
      const p = toWorld(e.clientX, e.clientY)
      const x2 = clamp(p.x, -REACH * BASE, (1 + REACH) * BASE)
      const y2 = clamp(p.y, -REACH * PH, (1 + REACH) * PH)
      setDraft({
        id: 'draft',
        shape: d.shape,
        x: Math.min(d.x, x2) / BASE,
        y: Math.min(d.y, y2) / BASE,
        w: Math.abs(x2 - d.x) / BASE,
        h: Math.abs(y2 - d.y) / BASE,
      })
    } else if (d.type === 'moveAnchor') {
      const dx = (e.clientX - d.sx) / s / BASE
      const dy = (e.clientY - d.sy) / s / BASE
      const a = { ...d.orig, x: clamp(d.orig.x + dx, -REACH, 1 + REACH - d.orig.w), y: clamp(d.orig.y + dy, -REACH * ratio, (1 + REACH) * ratio - d.orig.h) }
      writeAnchor(a)
    } else if (d.type === 'resizeAnchor') {
      const p = toWorld(e.clientX, e.clientY)
      const px = clamp(p.x / BASE, -REACH, 1 + REACH)
      const py = clamp(p.y / BASE, -REACH * ratio, (1 + REACH) * ratio)
      const o = d.orig
      // 끌고 있는 모서리 반대편은 고정한다.
      const fx = d.corner.includes('e') ? o.x : o.x + o.w
      const fy = d.corner.includes('s') ? o.y : o.y + o.h
      const a = {
        ...o,
        x: Math.min(fx, px),
        y: Math.min(fy, py),
        w: Math.max(MIN_ANCHOR, Math.abs(px - fx)),
        h: Math.max(MIN_ANCHOR, Math.abs(py - fy)),
      }
      writeAnchor(a)
    } else if (d.type === 'moveNote') {
      const n = { ...d.orig, x: d.orig.x + (e.clientX - d.sx) / s / BASE, y: d.orig.y + (e.clientY - d.sy) / s / BASE }
      patch({ notes: latest.current.notes.map((x) => (x.id === n.id ? n : x)) })
    } else if (d.type === 'resizeNote') {
      const n = {
        ...d.orig,
        w: Math.max(0.15, d.orig.w + (e.clientX - d.sx) / s / BASE),
        h: Math.max(MIN_NOTE_H, d.startH + (e.clientY - d.sy) / s / BASE),
      }
      patch({ notes: latest.current.notes.map((x) => (x.id === n.id ? n : x)) })
    }
  }

  // 메모를 붙일 자리가 정해졌다: 도형과 메모를 함께 만들고 바로 글을 쓰게 한다(별도 완료 단계 없음).
  const commitPlace = (pos: { x: number; y: number }) => {
    const p = pendingRef.current
    if (!p) return
    setPending(null)
    addNote({ x: pos.x, y: pos.y }, p.a.id, p.a)
  }

  // 도형 확인: 점 없는 메모에 연결하는 경우는 바로 연결하고, 아니면 메모 붙일 곳을 고르게 한다.
  const confirmPending = () => {
    const p = pendingRef.current
    if (!p || p.phase !== 'adjust') return
    if (p.attachTo) {
      const cur = latest.current
      const oldAnchor = cur.notes.find((n) => n.id === p.attachTo)?.anchorId
      const keptAnchors = oldAnchor && !cur.notes.some((n) => n.id !== p.attachTo && n.anchorId === oldAnchor)
        ? cur.anchors.filter((x) => x.id !== oldAnchor) : cur.anchors
      patch({
        anchors: [...keptAnchors, p.a],
        notes: cur.notes.map((n) => (n.id === p.attachTo ? { ...n, anchorId: p.a.id, photoLinked: false } : n)),
      })
      setSel({ kind: 'note', id: p.attachTo })
      setPending(null)
      return
    }
    setPending({ ...p, phase: 'place', ghost: placeNote(p.a.y) })
  }
  const confirmRef = useRef(confirmPending)
  confirmRef.current = confirmPending

  const onPointerUp = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    drag.current = null
    if (d?.type === 'moveGhost') {
      const cur = pendingRef.current
      if (cur) commitPlace(cur.ghost)
      return
    }
    if (d?.type === 'placeTap') {
      if (!d.moved) {
        const w = toWorld(e.clientX, e.clientY)
        commitPlace({ x: w.x / BASE, y: w.y / BASE })
      }
      return
    }
    const drawn = draftRef.current
    if (d?.type !== 'draw' || !drawn) return
    let a: Anchor = { ...drawn, id: newId() }
    if (a.w < MIN_ANCHOR && a.h < MIN_ANCHOR) {
      // 클릭만 했으면 그 자리에 기본 크기로 짚는다.
      const cx = d.x / BASE
      const cy = d.y / BASE
      a = {
        ...a,
        x: clamp(cx - DEFAULT_ANCHOR / 2, -REACH, 1 + REACH - DEFAULT_ANCHOR),
        y: clamp(cy - DEFAULT_ANCHOR / 2, -REACH * ratio, (1 + REACH) * ratio - DEFAULT_ANCHOR),
        w: DEFAULT_ANCHOR,
        h: Math.min(DEFAULT_ANCHOR, ratio),
      }
    }
    setDraft(null)
    setTool('select')
    setSel(null)
    // 바로 메모를 만들지 않고, 도형을 키우고 옮길 수 있게 임시로 둔다(확인 박스가 옆에 뜬다).
    setPending({ a, attachTo: d.attachTo, phase: 'adjust', ghost: { x: 1 + NOTE_GAP, y: a.y } })
  }

  const startPendingDrag = (e: RPointerEvent) => {
    const p = pendingRef.current
    if (!p || tool !== 'select') return
    e.stopPropagation()
    drag.current = { type: 'moveAnchor', id: p.a.id, sx: e.clientX, sy: e.clientY, orig: p.a }
    wrap.current?.setPointerCapture(e.pointerId)
  }
  const startGhostDrag = (e: RPointerEvent) => {
    const p = pendingRef.current
    if (!p) return
    e.stopPropagation()
    e.preventDefault()
    drag.current = { type: 'moveGhost', sx: e.clientX, sy: e.clientY, orig: p.ghost }
    wrap.current?.setPointerCapture(e.pointerId)
  }
  const chooseTool = (t: Tool) => {
    setPending(null) // 다른 도구를 고르면 확정 전 도형은 버린다
    setTool(t !== 'select' && t === tool ? 'select' : t) // 켜진 도구를 다시 누르면 꺼진다(폰에는 "선택" 버튼이 없다)
  }

  const startAnchorDrag = (e: RPointerEvent, a: Anchor) => {
    if (tool !== 'select') return
    e.stopPropagation()
    setSel({ kind: 'anchor', id: a.id })
    drag.current = { type: 'moveAnchor', id: a.id, sx: e.clientX, sy: e.clientY, orig: a }
    wrap.current?.setPointerCapture(e.pointerId)
  }

  const startAnchorResize = (e: RPointerEvent, a: Anchor, corner: Corner) => {
    e.stopPropagation()
    drag.current = { type: 'resizeAnchor', id: a.id, corner, sx: e.clientX, sy: e.clientY, orig: a }
    wrap.current?.setPointerCapture(e.pointerId)
  }

  const startNoteDrag = (e: RPointerEvent, n: Note, resize = false) => {
    e.stopPropagation()
    e.preventDefault()
    setSel({ kind: 'note', id: n.id })
    drag.current = resize
      ? { type: 'resizeNote', id: n.id, sx: e.clientX, sy: e.clientY, orig: n, startH: (heights[n.id] ?? 90) / BASE }
      : { type: 'moveNote', id: n.id, sx: e.clientX, sy: e.clientY, orig: n }
    wrap.current?.setPointerCapture(e.pointerId)
  }

  // 글자 크기 조절: shown은 지금 배율에서 눈에 보이는 px. 저장은 배율 100% 기준으로 바꿔 그 메모에만 쓴다.
  const setNoteFont = (shown: number) => {
    if (!selectedNote) return
    const id = selectedNote.id
    patch({ notes: latest.current.notes.map((n) => (n.id === id ? { ...n, fontSize: storedFont(shown, camRef.current.s) } : n)) })
  }

  // 터치로 메모 본문을 꾹 누르면 그 메모를 옮기기 시작한다(NoteBox의 onHoldMove).
  const startNoteHold = (p: HoldPoint, n: Note) => {
    setSel({ kind: 'note', id: n.id })
    drag.current = { type: 'moveNote', id: n.id, sx: p.clientX, sy: p.clientY, orig: n }
    try { wrap.current?.setPointerCapture(p.pointerId) } catch { /* 합성 이벤트 */ }
  }

  const removeSelected = useCallback(() => {
    if (!sel) return
    const cur = latest.current
    if (sel.kind === 'anchor') {
      // 짚은 곳을 지워도 메모 글은 남긴다(점 없는 메모가 됨).
      patch({
        anchors: cur.anchors.filter((a) => a.id !== sel.id),
        notes: cur.notes.map((n) => (n.anchorId === sel.id ? { ...n, anchorId: null } : n)),
      })
    } else {
      const note = cur.notes.find((n) => n.id === sel.id)
      const notes = cur.notes.filter((n) => n.id !== sel.id)
      const orphan = note?.anchorId && !notes.some((n) => n.anchorId === note.anchorId)
      patch({ notes, anchors: orphan ? cur.anchors.filter((a) => a.id !== note!.anchorId) : cur.anchors })
    }
    setSel(null)
  }, [sel, patch])

  // 단축키: Delete/Backspace 지우기, Esc 선택 해제, V/C/R/N 도구
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.tagName === 'SELECT') {
        if (e.key === 'Escape') t.blur()
        return
      }
      if (document.querySelector('.modal-back')) return
      if (e.key === 'Enter' && pendingRef.current?.phase === 'adjust') {
        e.preventDefault()
        confirmRef.current()
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') removeSelected()
      else if (e.key === 'Escape') {
        setPending(null)
        setSel(null)
        setTool('select')
      } else if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        const map: Record<string, Tool> = { v: 'select', c: 'circle', r: 'rect', n: 'note' }
        const next = map[e.key.toLowerCase()]
        if (next) {
          setPending(null) // 도구를 바꾸면 확정 전 도형은 버린다(버튼으로 바꿀 때와 같게)
          setTool(next)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [removeSelected])

  const back = () =>
    // 프로젝트 보드에서 연 사진이면 그 프로젝트로 돌아간다
    go(
      view.screen === 'project'
        ? { screen: 'project', projectId: view.projectId, entryId: null }
        : { screen: 'archive', filter: view.screen === 'archive' ? view.filter : 'all', entryId: null },
    )

  const handlesFor = (a: Anchor) => CORNERS.map((c) => {
    const hs = HANDLE / cam.s
    const cx = (a.x + (c.includes('e') ? a.w : 0)) * BASE
    const cy = (a.y + (c.includes('s') ? a.h : 0)) * BASE
    return (
      <rect key={c} className={`anchor-handle h-${c}`} x={cx - hs / 2} y={cy - hs / 2} width={hs} height={hs}
        vectorEffect="non-scaling-stroke" onPointerDown={(e) => startAnchorResize(e, a, c)} />
    )
  })
  const anchorsById = new Map(entry.anchors.map((a) => [a.id, a]))
  const sortedNotes = [...entry.notes].sort((a, b) => a.order - b.order)
  const numberOf = new Map(sortedNotes.map((n, i) => [n.id, i + 1]))

  return (
    <section className={`board-pane ${selectedNote ? 'note-editing' : ''}`}>
      <header className="pane-head board-tools">
        <button className="link" onClick={back}>
          목록
        </button>
        <div className="tool-group" role="group" aria-label="도구">
          <ToolButton tool="select" cur={tool} set={chooseTool} label="선택" keyHint="V" />
          <ToolButton tool="circle" cur={tool} set={chooseTool} label={freeNote ? '○ 동그라미 연결' : '○ 동그라미'} keyHint="C" />
          <ToolButton tool="rect" cur={tool} set={chooseTool} label={freeNote ? '□ 사각 연결' : '□ 사각'} keyHint="R" />
          <ToolButton tool="note" cur={tool} set={chooseTool} label="메모" keyHint="N" />
        </div>
        <div className="mobile-only phone-record-tools" role="group" aria-label="기록 도구">
          <ToolButton tool="circle" cur={tool} set={chooseTool} label="○" keyHint="C" />
          <ToolButton tool="rect" cur={tool} set={chooseTool} label="□" keyHint="R" />
          <ToolButton tool="note" cur={tool} set={chooseTool} label="메모" keyHint="N" />
        </div>
        <button className="link mobile-only more-tools" aria-label="더보기" aria-expanded={toolsOpen} onClick={() => setToolsOpen((v) => !v)}>···</button>
        <div className={`board-secondary ${toolsOpen ? 'open' : ''}`}>
        <button className="link mobile-only" onClick={() => setToolsOpen(false)}>완료</button>
        {selectedNote && (
          <div className="desktop-memo-tools">
            {!selectedNote.anchorId && <button className={`btn ghost ${selectedNote.photoLinked ? 'on' : ''}`}
              aria-pressed={!!selectedNote.photoLinked}
              onClick={() => patch({ notes: latest.current.notes.map((n) => n.id === selectedNote.id ? { ...n, photoLinked: !n.photoLinked } : n) })}>
              {selectedNote.photoLinked ? '사진 연결 해제' : '사진 연결'}
            </button>}
            <span className="divider" />
            <div className="tool-color">
              <ColorField
                label="메모 색"
                kind="note"
                value={selectedNote.color}
                onChange={(c) =>
                  patch({ notes: latest.current.notes.map((n) => (n.id === selectedNote.id ? { ...n, color: c } : n)) })
                }
              />
            </div>
            <MemoFont shown={shownFont(selectedNote.fontSize ?? settings.noteFontSize, cam.s)} onChange={setNoteFont} />
          </div>
        )}
        <span className="spacer" />
        {sel && (
          <button className="link" onClick={removeSelected}>
            선택 지우기
          </button>
        )}
        <button className="link desktop-only" onClick={() => zoomBy(1 / ZOOM_STEP)} aria-label="축소" title="축소">
          −
        </button>
        <span className="zoom-pct desktop-only">{Math.round(cam.s * 100)}%</span>
        <button className="link desktop-only" onClick={() => zoomBy(ZOOM_STEP)} aria-label="확대" title="확대">
          +
        </button>
        <button className="link desktop-only" onClick={fit}>
          맞춤
        </button>
        <button
          className="link danger"
          onClick={() => {
            void confirm('이 사진과 메모를 모두 삭제할까요?', { detail: '되돌릴 수 없어요.', ok: '삭제', danger: true }).then((ok) => {
              if (ok) void deleteEntry(entry.id).then(back)
            })
          }}
        >
          기록 지우기
        </button>
        </div>
      </header>

      {selectedNote && <div className="mobile-only memo-menu" role="group" aria-label="메모 메뉴">
        {!noteColorOpen && <MemoFont className="memo-font-float" shown={shownFont(selectedNote.fontSize ?? settings.noteFontSize, cam.s)} onChange={setNoteFont} />}
        <button className={`btn ghost ${selectedNote.photoLinked ? 'on' : ''}`} onClick={() => {
          const cur = latest.current
          patch({ notes: cur.notes.map((n) => n.id === selectedNote.id ? { ...n, anchorId: null, photoLinked: !n.photoLinked } : n),
            anchors: selectedNote.anchorId && !cur.notes.some((n) => n.id !== selectedNote.id && n.anchorId === selectedNote.anchorId)
              ? cur.anchors.filter((a) => a.id !== selectedNote.anchorId) : cur.anchors })
        }}>{selectedNote.photoLinked ? '연결 해제' : '사진 연결'}</button>
        <button className={`btn ghost ${tool === 'circle' ? 'on' : ''}`} aria-label="동그라미 연결" onClick={() => setTool('circle')}>○</button>
        <button className={`btn ghost ${tool === 'rect' ? 'on' : ''}`} aria-label="사각 연결" onClick={() => setTool('rect')}>□</button>
        <button className="btn ghost" onClick={() => setNoteColorOpen((v) => !v)}>메모 색</button>
        <button className="btn ghost" onClick={removeSelected}>삭제</button>
        <button className="btn ghost" onClick={() => { setSel(null); setTool('select'); setNoteColorOpen(false); (document.activeElement as HTMLElement)?.blur() }}>완료</button>
        {noteColorOpen && <div className="memo-menu-color">
          <ColorField label="메모 색" kind="note" open onToggle={() => setNoteColorOpen(false)} value={selectedNote.color}
            onChange={(color) => patch({ notes: latest.current.notes.map((n) => n.id === selectedNote.id ? { ...n, color } : n) })} />
        </div>}
      </div>}

      <div
        ref={wrap}
        className={`board tool-${tool}`}
        onPointerDown={onPointerDown}
        onPointerDownCapture={touchDown}
        onPointerMoveCapture={touchMove}
        onPointerUpCapture={touchUp}
        onPointerCancelCapture={touchUp}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => { drag.current = null; setDraft(null) }}
      >
        <button className={`info-toggle ${infoOpen ? 'on' : ''}`} onClick={() => setInfoOpen((o) => !o)}>
          <span>{seriesName}</span>
          {tagCount > 0 && <span className="info-count">태그 {tagCount}</span>}
        </button>
        {infoOpen && <InfoPanel entry={entry} onChange={patch} onClose={() => setInfoOpen(false)} />}
        <div
          className="world"
          style={{ transform: `translate(${cam.x}px, ${cam.y}px) scale(${cam.s})`, width: BASE, height: PH }}
        >
          {url ? (
            <img className="board-photo" src={url} alt="" draggable={false} style={{ width: BASE, height: PH }} />
          ) : (
            <div className="board-photo loading-photo" style={{ width: BASE, height: PH }} />
          )}

          <svg className="marks" width={BASE} height={PH} overflow="visible">
            {sortedNotes.map((n) => {
              const a: Anchor | undefined = n.anchorId ? anchorsById.get(n.anchorId)
                : n.photoLinked ? { id: entry.id, shape: 'rect', x: 0, y: 0, w: 1, h: ratio } : undefined
              if (!a) return null
              const [x1, y1, x2, y2] = linkLine(a, n, heights[n.id] ?? 90)
              return (
                <line key={`l-${n.id}`} x1={x1} y1={y1} x2={x2} y2={y2} className="link-line" vectorEffect="non-scaling-stroke" />
              )
            })}
            {entry.anchors.map((a) => (
              <AnchorShapeView
                key={a.id}
                a={a}
                selected={sel?.kind === 'anchor' && sel.id === a.id}
                interactive={tool === 'select'}
                onPointerDown={(e) => startAnchorDrag(e, a)}
              />
            ))}
            {draft && <AnchorShapeView a={draft} selected={false} interactive={false} />}
            {/* 고른 지목의 네 모서리를 끌면 크기가 바뀐다 (F-27) */}
            {selectedAnchor && tool === 'select' && handlesFor(selectedAnchor)}
            {pending && <AnchorShapeView a={pending.a} selected interactive={tool === 'select'} onPointerDown={startPendingDrag} />}
            {pending?.phase === 'adjust' && tool === 'select' && handlesFor(pending.a)}
            {pending?.phase === 'place' && (() => {
              const [x1, y1, x2, y2] = linkLine(pending.a, { x: pending.ghost.x, y: pending.ghost.y, w: NOTE_W } as Note, GHOST_H)
              return <line x1={x1} y1={y1} x2={x2} y2={y2} className="link-line ghost" vectorEffect="non-scaling-stroke" />
            })()}
          </svg>

          {entry.notes.map((n) => (
            <NoteBox
              key={n.id}
              note={n}
              fontSize={n.fontSize ?? settings.noteFontSize}
              number={numberOf.get(n.id) ?? 0}
              selected={sel?.kind === 'note' && sel.id === n.id}
              autoFocus={focusNote === n.id}
              onFocused={() => {
                setFocusNote(null)
                setSel({ kind: 'note', id: n.id })
              }}
              onText={(text) => patch({ notes: latest.current.notes.map((x) => (x.id === n.id ? { ...x, text } : x)) })}
              onHeight={(h) => setHeights((prev) => (prev[n.id] === h ? prev : { ...prev, [n.id]: h }))}
              onMove={(e) => startNoteDrag(e, n)}
              onResize={(e) => startNoteDrag(e, n, true)}
              onHoldMove={(p) => startNoteHold(p, n)}
            />
          ))}
          {pending?.phase === 'place' && (
            <div className="note-ghost" onPointerDown={startGhostDrag}
              style={{ left: pending.ghost.x * BASE, top: pending.ghost.y * BASE, width: NOTE_W * BASE, height: GHOST_H }} />
          )}
        </div>
        {pending && <PendingBar pending={pending} cam={cam} area={wrap.current} onCancel={() => setPending(null)} onConfirm={confirmPending} />}
      </div>
    </section>
  )
}

// 도형(또는 붙일 자리) 바로 옆에 뜨는 작은 확인 박스. 칠판을 움직이거나 도형을 옮겨도 따라다니고, 화면 밖으로 나가지 않는다.
function PendingBar({ pending, cam, area, onCancel, onConfirm }: {
  pending: Pending; cam: Cam; area: HTMLDivElement | null; onCancel(): void; onConfirm(): void
}) {
  const adjust = pending.phase === 'adjust'
  const box = adjust
    ? { x: pending.a.x * BASE, y: pending.a.y * BASE, w: pending.a.w * BASE, h: pending.a.h * BASE }
    : { x: pending.ghost.x * BASE, y: pending.ghost.y * BASE, w: NOTE_W * BASE, h: GHOST_H }
  const bw = adjust ? 130 : 66
  const bh = 40
  const W = area?.clientWidth ?? 0
  const H = area?.clientHeight ?? 0
  let left = cam.x + (box.x + box.w) * cam.s + 10
  let top = cam.y + (box.y + box.h) * cam.s + 10
  if (W && left + bw > W - 8) left = cam.x + box.x * cam.s - bw - 10 // 오른쪽이 모자라면 왼쪽으로
  if (H && top + bh > H - 8) top = cam.y + box.y * cam.s - bh - 10 // 아래가 모자라면 위로
  left = clamp(left, 8, Math.max(8, W - bw - 8))
  top = clamp(top, 8, Math.max(8, H - bh - 8))
  return (
    <div className="anchor-confirm" role="group" aria-label={adjust ? '지목 확인' : '메모 붙이기'} style={{ left, top }}
      onPointerDown={(e) => e.stopPropagation()}>
      <button className="btn ghost" onClick={onCancel}>취소</button>
      {adjust && <button className="btn" onClick={onConfirm}>확인</button>}
    </div>
  )
}

// 짚은 곳의 테두리에서 메모 상자의 가장 가까운 점까지 선을 긋는다.
function linkLine(a: Anchor, n: Note, noteHeightPx: number): [number, number, number, number] {
  const cx = (a.x + a.w / 2) * BASE
  const cy = (a.y + a.h / 2) * BASE
  const nx = n.x * BASE
  const ny = n.y * BASE
  const ex = clamp(cx, nx, nx + n.w * BASE)
  const ey = clamp(cy, ny, ny + noteHeightPx)
  const dx = ex - cx
  const dy = ey - cy
  const rx = (a.w * BASE) / 2
  const ry = (a.h * BASE) / 2
  if (dx === 0 && dy === 0) return [cx, cy, ex, ey]
  const t =
    a.shape === 'circle'
      ? 1 / Math.sqrt((dx / Math.max(rx, 0.01)) ** 2 + (dy / Math.max(ry, 0.01)) ** 2)
      : Math.min(dx ? rx / Math.abs(dx) : Infinity, dy ? ry / Math.abs(dy) : Infinity)
  const k = Math.min(1, t)
  return [cx + dx * k, cy + dy * k, ex, ey]
}

function AnchorShapeView({
  a,
  selected,
  interactive,
  onPointerDown,
}: {
  a: Anchor
  selected: boolean
  interactive: boolean
  onPointerDown?: (e: RPointerEvent<SVGElement>) => void
}) {
  const props = {
    'data-anchor': a.id,
    className: `anchor ${selected ? 'selected' : ''} ${interactive ? 'interactive' : ''}`,
    vectorEffect: 'non-scaling-stroke' as const,
    onPointerDown,
  }
  return a.shape === 'circle' ? (
    <ellipse {...props} cx={(a.x + a.w / 2) * BASE} cy={(a.y + a.h / 2) * BASE} rx={(a.w / 2) * BASE} ry={(a.h / 2) * BASE} />
  ) : (
    <rect {...props} x={a.x * BASE} y={a.y * BASE} width={a.w * BASE} height={a.h * BASE} />
  )
}

function NoteBox({
  note,
  fontSize,
  number,
  selected,
  autoFocus,
  onFocused,
  onText,
  onHeight,
  onMove,
  onResize,
  onHoldMove,
}: {
  note: Note
  fontSize: number
  number: number
  selected: boolean
  autoFocus: boolean
  onFocused(): void
  onText(text: string): void
  onHeight(h: number): void
  onMove(e: RPointerEvent): void
  onResize(e: RPointerEvent): void
  onHoldMove(p: HoldPoint): void
}) {
  const box = useRef<HTMLDivElement>(null)
  const ta = useRef<HTMLTextAreaElement>(null)
  const hold = useHold()

  useLayoutEffect(() => {
    const t = ta.current
    if (!t) return
    t.style.height = 'auto'
    t.style.height = `${t.scrollHeight}px`
  }, [note.text, note.w, note.h, fontSize])

  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => onHeight(el.offsetHeight))
    ro.observe(el)
    return () => ro.disconnect()
  })

  useEffect(() => {
    if (autoFocus) ta.current?.focus()
  }, [autoFocus])

  return (
    <div
      ref={box}
      className={`note ${selected ? 'selected' : ''} ${hold.held === note.id ? 'lifted' : ''}`}
      style={{
        left: note.x * BASE,
        top: note.y * BASE,
        width: note.w * BASE,
        minHeight: note.h ? note.h * BASE : undefined,
        background: note.color,
      }}
    >
      <div className="note-bar" onPointerDown={onMove}>
        <span>{String(number).padStart(2, '0')}</span>
      </div>
      <textarea ref={ta} style={{ fontSize }} value={note.text} rows={2} onFocus={onFocused} onChange={(e) => onText(e.target.value)}
        {...hold.bind(note.id, (p) => { ta.current?.blur(); onHoldMove(p) })} />
      <span className="note-resize" onPointerDown={onResize} aria-label="크기 조절" />
    </div>
  )
}

function ToolButton({ tool, cur, set, label, keyHint }: { tool: Tool; cur: Tool; set(t: Tool): void; label: string; keyHint: string }) {
  return (
    <button className={`tool ${cur === tool ? 'on' : ''}`} onClick={() => set(tool)} title={`${label} (${keyHint})`}>
      {label}
    </button>
  )
}
