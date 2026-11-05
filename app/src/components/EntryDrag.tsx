import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { categoriesOf, type ID } from '../data/types'
import { useArchive } from '../state'
import { useChoose } from './Ask'
import { Thumb } from './Thumb'

// 사진을 꾹 눌러(0.45초) 왼쪽 목록의 프로젝트·카테고리 줄 위에 놓으면 거기에 담긴다.
// 출발점: 갤러리·맵·프로젝트 보드의 사진. 짧게 누르면 기록 열기, 누른 채 움직이면(맵·프로젝트) 위치 이동이라서, 가만히 꾹 눌러야 시작된다.
// 목적지는 data-drop-project / data-drop-category 가 붙은 요소(왼쪽 목록의 줄).
//  - 프로젝트 줄: 그 프로젝트에 담는다(참조 추가, 출발한 곳은 그대로).
//  - 카테고리 줄: 그 카테고리를 더한다. 단, 특정 카테고리를 보다가 다른 카테고리로 놓으면
//    "옮기기(원래 카테고리에서 빼기)"인지 "추가하기(두 카테고리 모두)"인지 묻는다.

const HOLD_MS = 450 // 이만큼 가만히 누르고 있으면 끌기 시작
const SLOP = 6 // 누르는 동안 이 이상(px) 움직이면 꾹 누르기가 아니다

export interface DragPayload {
  ids: ID[]
  photoId: ID // 끌 때 따라다니는 대표 사진
  fromCategory?: ID | null // 특정 카테고리 화면에서 출발했다면 그 카테고리
  fromProject?: ID | null // 프로젝트 보드에서 출발했다면 그 프로젝트
}

interface Bound {
  onPointerDown(e: ReactPointerEvent<HTMLElement>): void
  onPointerMove(e: ReactPointerEvent<HTMLElement>): void
  onPointerUp(e: ReactPointerEvent<HTMLElement>): void
  onPointerCancel(e: ReactPointerEvent<HTMLElement>): void
}

interface EntryDragApi {
  bind(get: () => DragPayload, onActivate?: () => void): Bound
  consumeClick(): boolean // 끌고 난 뒤의 click이면 true (그 click은 무시)
  overTarget: ID | null // 지금 사진이 올라가 있는 프로젝트·카테고리 (줄 강조용)
  dropped: ID | null // 방금 담긴 프로젝트·카테고리 (잠깐 강조)
}

const Ctx = createContext<EntryDragApi>({
  bind: () => ({ onPointerDown() {}, onPointerMove() {}, onPointerUp() {}, onPointerCancel() {} }),
  consumeClick: () => false,
  overTarget: null,
  dropped: null,
})
export const useEntryDrag = () => useContext(Ctx)

type Target = { kind: 'project' | 'category'; id: ID }

const targetAt = (x: number, y: number): Target | null => {
  const el = document.elementFromPoint(x, y)
  const p = (el?.closest('[data-drop-project]') as HTMLElement | null)?.dataset.dropProject
  if (p) return { kind: 'project', id: p }
  const c = (el?.closest('[data-drop-category]') as HTMLElement | null)?.dataset.dropCategory
  return c ? { kind: 'category', id: c } : null
}

export function EntryDragProvider({ children }: { children: ReactNode }) {
  const { entries, series, addToProject, editCategories } = useArchive()
  const choose = useChoose()
  const [active, setActive] = useState<(DragPayload & { x: number; y: number }) | null>(null)
  const [overTarget, setOver] = useState<ID | null>(null)
  const [dropped, setDropped] = useState<ID | null>(null)
  const { projects } = useArchive()
  const [destination, setDestination] = useState<DragPayload | null>(null)
  const [query, setQuery] = useState('')
  const [placing, setPlacing] = useState(false)
  const pending = useRef<{ timer: number; sx: number; sy: number } | null>(null)
  const justDragged = useRef(false)
  const touchPointers = useRef(new Set<number>())
  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return
      touchPointers.current.add(e.pointerId)
      if (touchPointers.current.size > 1) window.dispatchEvent(new Event('archive:gesture'))
    }
    const up = (e: PointerEvent) => touchPointers.current.delete(e.pointerId)
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('pointerup', up, true)
    window.addEventListener('pointercancel', up, true)
    return () => {
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('pointerup', up, true)
      window.removeEventListener('pointercancel', up, true)
    }
  }, [])

  // 놓았을 때 할 일. 끌기 도중엔 화면이 다시 그려지므로 항상 최신 값을 쓰도록 ref에 둔다.
  const dropRef = useRef<(t: Target, p: DragPayload) => Promise<boolean>>(async () => false)
  dropRef.current = async (t, p) => {
    if (t.kind === 'project') {
      if (p.fromProject === t.id) return false // 같은 프로젝트
      await addToProject(t.id, p.ids)
      return true
    }
    if (p.fromCategory === t.id) return false // 같은 카테고리
    const lacking = p.ids.filter((id) => !categoriesOf(entries.find((e) => e.id === id) ?? ({} as never)).includes(t.id))
    const from = p.fromCategory
    if (from) {
      // 특정 카테고리를 보다가 다른 카테고리에 놓음: 옮길지, 복수 카테고리로 더할지 묻는다
      const to = series.find((s) => s.id === t.id)?.name ?? ''
      const fromName = series.find((s) => s.id === from)?.name ?? ''
      const answer = await choose(`${p.ids.length}장을 "${to}" 카테고리로`, [
        { value: 'move', label: '옮기기' },
        { value: 'add', label: '추가하기' },
      ], `옮기기: "${fromName}"에서 빼고 "${to}"로 · 추가하기: 두 카테고리 모두에 속해요`)
      if (!answer) return false
      await editCategories(p.ids, [t.id], answer === 'move' ? [from] : [])
      return true
    }
    if (lacking.length === 0) return false // 이미 모두 이 카테고리
    await editCategories(p.ids, [t.id], [])
    return true
  }

  const cancelPending = useCallback(() => {
    if (pending.current) window.clearTimeout(pending.current.timer)
    pending.current = null
  }, [])

  const bind = useCallback(
    (get: () => DragPayload, onActivate?: () => void): Bound => ({
      onPointerDown: (e) => {
        if (e.button !== 0) return
        if (e.pointerType === 'touch' && touchPointers.current.size > 1) return
        justDragged.current = false
        cancelPending()
        const sx = e.clientX
        const sy = e.clientY
        const timer = window.setTimeout(() => {
          pending.current = null
          onActivate?.()
          if (window.matchMedia('(max-width: 767px)').matches) {
            justDragged.current = true
            setQuery('')
            setDestination(get())
          } else setActive({ ...get(), x: sx, y: sy })
        }, HOLD_MS)
        pending.current = { timer, sx, sy }
      },
      onPointerMove: (e) => {
        const p = pending.current
        if (p && Math.hypot(e.clientX - p.sx, e.clientY - p.sy) > SLOP) cancelPending()
      },
      onPointerUp: () => {
        cancelPending()
        window.setTimeout(() => (justDragged.current = false), 60)
      },
      onPointerCancel: cancelPending,
    }),
    [cancelPending],
  )

  const consumeClick = useCallback(() => {
    if (!justDragged.current) return false
    justDragged.current = false
    return true
  }, [])

  useEffect(() => {
    const cancel = () => cancelPending()
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setDestination(null) }
    window.addEventListener('archive:gesture', cancel)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('archive:gesture', cancel)
      window.removeEventListener('keydown', key)
    }
  }, [cancelPending])

  const chooseDestination = async (target: Target) => {
    if (!destination || placing) return
    setPlacing(true)
    try { await dropRef.current(target, destination); setDestination(null) }
    finally { setPlacing(false) }
  }

  // 끌기가 시작된 동안: 포인터를 따라다니고, 놓으면 목적지에 담는다. Esc는 취소.
  const started = active !== null
  const payloadRef = useRef<DragPayload | null>(null)
  payloadRef.current = active
  useEffect(() => {
    if (!started) return
    const prevSelect = document.body.style.userSelect
    document.body.style.userSelect = 'none'
    document.body.classList.add('dragging-entries')
    const move = (e: PointerEvent) => {
      setActive((a) => (a ? { ...a, x: e.clientX, y: e.clientY } : a))
      setOver(targetAt(e.clientX, e.clientY)?.id ?? null)
    }
    const finish = (target: Target | null) => {
      // 놓은 직후에 이어서 오는 click만 무시하고, 곧 지운다 (누르기 없이 오는 키보드 click을 삼키지 않게)
      justDragged.current = true
      window.setTimeout(() => (justDragged.current = false), 60)
      const payload = payloadRef.current
      setActive(null)
      setOver(null)
      if (!target || !payload) return
      void dropRef.current(target, payload).then((done) => {
        if (!done) return
        setDropped(target.id)
        window.setTimeout(() => setDropped(null), 900)
      })
    }
    const up = (e: PointerEvent) => finish(targetAt(e.clientX, e.clientY))
    const cancel = () => finish(null)
    const key = (e: KeyboardEvent) => e.key === 'Escape' && finish(null)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('keydown', key)
    return () => {
      document.body.style.userSelect = prevSelect
      document.body.classList.remove('dragging-entries')
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('keydown', key)
    }
  }, [started])

  const api = useMemo<EntryDragApi>(() => ({ bind, consumeClick, overTarget, dropped }), [bind, consumeClick, overTarget, dropped])

  return (
    <Ctx.Provider value={api}>
      {children}
      {destination && <div className="destination-back" onPointerDown={() => { if (!placing) setDestination(null) }}>
        <section className="destination-sheet" role="dialog" aria-modal="true" aria-label="사진 담을 곳" onPointerDown={(e) => e.stopPropagation()}>
          <header className="modal-head"><strong>{destination.ids.length}장 선택</strong><span className="spacer" />
            <button className="link" disabled={placing} onClick={() => setDestination(null)}>취소</button></header>
          <input className="text-input" aria-label="목적지 검색" placeholder="검색" value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className="destination-list">
            <div className="pick-label">프로젝트</div>
            {projects.filter((p) => p.name.toLowerCase().includes(query.trim().toLowerCase())).map((p) => <button className="destination-row" key={p.id}
              disabled={placing || p.id === destination.fromProject} onClick={() => void chooseDestination({ kind: 'project', id: p.id })}>
              {p.name}{p.id === destination.fromProject ? ' (현재)' : ''}
            </button>)}
            <div className="pick-label">카테고리</div>
            {series.filter((s) => s.name.toLowerCase().includes(query.trim().toLowerCase())).map((s) => <button className="destination-row" key={s.id}
              disabled={placing || s.id === destination.fromCategory} onClick={() => void chooseDestination({ kind: 'category', id: s.id })}>
              {s.name}{s.id === destination.fromCategory ? ' (현재)' : ''}
            </button>)}
          </div>
        </section>
      </div>}
      {active && (
        <div className="entry-ghost" style={{ left: active.x + 14, top: active.y + 14 }}>
          <Thumb photoId={active.photoId} alt="" />
          {active.ids.length > 1 && <span className="entry-ghost-count">{active.ids.length}</span>}
        </div>
      )}
    </Ctx.Provider>
  )
}
