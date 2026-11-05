import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { tagIdsOf, type Entry, type ID, type ProjectNote } from '../data/types'
import { useArchive } from '../state'
import { useConfirm } from './Ask'
import { BaseTagPicker } from './BaseTagPicker'
import { useEntryDrag } from './EntryDrag'
import { computeLayout } from './mapLayout'
import { MapNoteLayer, MapNoteMenu, useMapNotes } from './MapNotes'
import { PaneHeader } from './PaneHeader'
import { SelectPanel } from './SelectPanel'
import { Thumb } from './Thumb'
import { useItemDrag } from './useItemDrag'
import { useSelection } from './useSelection'
import { useZoom, ZoomControl } from './useZoom'

// 카테고리(전체·카테고리 없음 포함)와 프로젝트가 함께 쓰는 사진 화면 (F-39).
// 갤러리 ⇄ 맵 전환, 선택, 꾹 눌러 끌기, 확대·축소, 기준 태그, 자동 정리, 메모가 모두 여기 한 곳에 있다.
// 범위마다 다른 것(제목, 사진 목록, 위치·기준·메모 저장 키, 사진 크기, 사진을 넣는 버튼, 기록 열기)만 바깥에서 받는다.

export interface ScopePaneProps {
  scopeId: ID // 고정 위치·기준 태그가 저장되는 키 (MAIN_MAP, category:<id>, 프로젝트 id 등)
  title: string
  list: Entry[]
  long: number // 맵에서 사진 긴 변
  absolutePins: boolean // true면 고정 위치를 원점 보정 없이 저장 좌표 그대로 쓴다(프로젝트)
  notes: ProjectNote[]
  onNotes: (notes: ProjectNote[]) => void
  source: { fromCategory?: ID | null; fromProject?: ID } // 끌어 놓을 때 출발 범위
  add: ReactNode // 사진 넣기·담기 버튼
  onOpen: (id: ID) => void
  onRemove?: { label: string; run: (id: ID) => void } // 사진 위 ✕ (프로젝트에서 빼기)
  children?: ReactNode // 이 범위만의 창(사진 담기 창 등)
}

export function ScopePane({ scopeId, title, list, long, absolutePins, notes, onNotes, source, add, onOpen, onRemove, children }: ScopePaneProps) {
  const { tags, photos, mapBase, setMapBase, placements, pinEntry, clearPins, mode } = useArchive()
  const confirm = useConfirm()
  const dnd = useEntryDrag()
  const sel = useSelection()
  const [baseOpen, setBaseOpen] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)
  const z = useZoom(scroller)

  const order = useMemo(() => list.map((e) => e.id), [list])
  const selectedIds = useMemo(() => order.filter((id) => sel.ids.has(id)), [order, sel.ids])
  useEffect(() => {
    if (selectedIds.length !== sel.ids.size) sel.setAll(selectedIds) // 목록에서 빠진 사진은 선택에서도 뺀다
  }, [selectedIds, sel.ids, sel.setAll])

  const known = useMemo(() => new Set(tags.map((t) => t.id)), [tags])
  const base = useMemo(() => (mapBase[scopeId] ?? []).filter((id) => known.has(id)), [mapBase, scopeId, known])
  const pins = useMemo(() => placements.filter((p) => p.mapId === scopeId), [placements, scopeId])
  const layout = useMemo(
    () => computeLayout(list, tags, base, photos, new Map(pins.map((p) => [p.entryId, { x: p.x, y: p.y }])), { long, absolutePins }),
    [list, tags, base, photos, pins, long, absolutePins])
  const pinCount = pins.length

  const memo = useMapNotes(notes, onNotes, scroller, z.zoom)
  const { linking, setLinking } = memo
  useEffect(() => {
    setLinking(null)
    setBaseOpen(false)
  }, [mode, setLinking])

  // 끌면 그 자리에 고정. 저장 좌표 = 화면 가운데 좌표 - 원점 (원점은 맵 전체 위치가 바뀌어도 고정이 따라가게 하는 값)
  const { drag, bind, consumeClick, cancel } = useItemDrag(
    layout.origin,
    (d) => void pinEntry(scopeId, d.id, d.x + d.w / 2 - layout.origin.x, d.y + d.h / 2 - layout.origin.y),
    z.zoom,
  )

  const tagCounts = useMemo(() => {
    const n = new Map<ID, number>()
    for (const e of list) for (const id of tagIdsOf(e)) n.set(id, (n.get(id) ?? 0) + 1)
    return tags.filter((t) => n.has(t.id)).map((t) => ({ id: t.id, name: t.name, count: n.get(t.id) ?? 0 }))
  }, [list, tags])
  const tagNames = useMemo(() => new Map(tags.map((t) => [t.id, t.name])), [tags])

  const holdPayload = (id: ID, photoId: ID) => () => ({
    ids: sel.on && sel.ids.has(id) ? selectedIds : [id], photoId, ...source,
  })
  const open = (id: ID, shift: boolean) => {
    const wasDrag = consumeClick()
    const wasHold = dnd.consumeClick()
    if (wasDrag || wasHold) return
    if (sel.on) sel.click(id, order, shift)
    else if (!memo.connect(id)) onOpen(id)
  }
  // 위치 끌기와 꾹 누르기를 한 사진에 같이 건다. 꾹 누르기가 시작되면 위치 끌기는 취소한다.
  const handlersFor = (it: { entryId: ID; photoId: ID; x: number; y: number; w: number; h: number }) => {
    const hold = dnd.bind(holdPayload(it.entryId, it.photoId), cancel)
    if (sel.on || linking) return hold // 선택·연결 중엔 위치를 옮기지 않는다
    const move = bind({ id: it.entryId, x: it.x, y: it.y, w: it.w, h: it.h })
    return {
      onPointerDown: (e: ReactPointerEvent<HTMLElement>) => (move.onPointerDown(e), hold.onPointerDown(e)),
      onPointerMove: (e: ReactPointerEvent<HTMLElement>) => (move.onPointerMove(e), hold.onPointerMove(e)),
      onPointerUp: (e: ReactPointerEvent<HTMLElement>) => (move.onPointerUp(e), hold.onPointerUp(e)),
      onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => (move.onPointerCancel(e), hold.onPointerCancel(e)),
    }
  }
  const tidy = async () => {
    if (await confirm(`고정한 위치 ${pinCount}개를 모두 풀고 자동으로 정리할까요?`, { ok: '정리' })) void clearPins(scopeId)
  }
  const toggleBase = (id: ID) => setMapBase(scopeId, base.includes(id) ? base.filter((x) => x !== id) : [...base, id])
  const toggleAll = () => selectedIds.length === list.length ? sel.clear() : sel.setAll(order)
  const dismiss = (e: { target: EventTarget; currentTarget: EventTarget }) => e.target === e.currentTarget && memo.dismiss()

  const map = mode === 'map'
  const width = Math.max(layout.width, ...notes.map((n) => n.x + n.w + 160))
  const height = Math.max(layout.height, ...notes.map((n) => n.y + Math.max(n.h ?? 160, 56 + n.text.split('\n').length * 20) + 160))
  const linkedTo = linking ? notes.find((n) => n.id === linking) : undefined
  const allSelected = selectedIds.length === list.length && list.length > 0

  return (
    <section className={`gallery map-pane ${map && memo.selected && !sel.on ? 'note-editing' : ''}`}>
      <PaneHeader title={title} count={list.length} primary={<>
        <button className={`btn ghost ${sel.on ? 'on' : ''}`} aria-pressed={sel.on} onClick={() => {
          memo.dismiss(); setBaseOpen(false); sel.toggleMode()
        }}>선택{sel.on && selectedIds.length > 0 ? ` ${selectedIds.length}` : ''}</button>
        {map && <button className="btn ghost" onClick={memo.add}>메모 +</button>}
        {add}
      </>} secondary={<>
        {map && <ZoomControl {...z} />}
        {sel.on && <button className="link" onClick={toggleAll}>{allSelected ? '모두 해제' : '모두 선택'}</button>}
        {map && pinCount > 0 && <button className="btn ghost" onClick={() => void tidy()}>자동 정리</button>}
        {map && <button className={`btn ghost ${baseOpen ? 'on' : ''}`} onClick={() => setBaseOpen((v) => !v)} aria-expanded={baseOpen}>
          기준{base.length > 0 && <span className="info-count"> {base.length}</span>}
        </button>}
      </>} />

      {map && !sel.on && <MapNoteMenu editor={memo} />}
      {sel.on && selectedIds.length > 0 && <SelectPanel ids={selectedIds} onClose={sel.clear} onDone={sel.toggleMode}
        allSelected={selectedIds.length === list.length} onSelectAll={toggleAll} />}

      {!map && <div className="gallery-grid">
        {list.map((entry) => <button key={entry.id} data-entry={entry.id}
          className={`gallery-cell ${sel.ids.has(entry.id) ? 'selected' : ''} ${sel.on ? 'selecting' : ''}`}
          {...dnd.bind(holdPayload(entry.id, entry.photoId))}
          onClick={(e) => open(entry.id, e.shiftKey)}><Thumb photoId={entry.photoId} alt="" /></button>)}
      </div>}

      {baseOpen && <BaseTagPicker tags={tagCounts} selected={base} names={tagNames} onToggle={toggleBase} onClose={() => setBaseOpen(false)} />}

      {/* 맵은 숨겨서 두어, 갤러리로 갔다 와도 배치·스크롤·확대·메모 상태가 그대로다 */}
      <div className="map-scroll" ref={scroller} style={{ display: map ? undefined : 'none' }} onPointerDown={dismiss}>
        <div style={{ width: width * z.zoom, height: height * z.zoom }}>
          <div className="map-world" style={{ width, height, transform: `scale(${z.zoom})`, transformOrigin: '0 0' }} onPointerDown={dismiss}>
            <MapNoteLayer editor={memo} width={width} height={height} selecting={sel.on}
              items={layout.items.map((it) => ({ id: it.entryId, w: it.w, h: it.h,
                x: drag?.moved && drag.id === it.entryId ? drag.x : it.x, y: drag?.moved && drag.id === it.entryId ? drag.y : it.y }))} />
            {layout.items.map((it) => {
              const dragging = !!drag?.moved && drag.id === it.entryId
              return (
                <div key={it.entryId} data-entry={it.entryId} role="button" tabIndex={0}
                  className={`map-item ${it.pinned || dragging ? 'pinned' : ''} ${dragging ? 'dragging' : ''} ${sel.on && sel.ids.has(it.entryId) ? 'selected' : ''} ${linking ? 'linkable' : ''} ${linkedTo?.entryIds.includes(it.entryId) ? 'linked' : ''}`}
                  style={{ left: dragging ? drag.x : it.x, top: dragging ? drag.y : it.y, width: it.w, height: it.h, zIndex: it.z }}
                  {...handlersFor(it)}
                  onClick={(e) => open(it.entryId, e.shiftKey)}
                  onKeyDown={(e) => {
                    if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return
                    e.preventDefault(); open(it.entryId, e.shiftKey)
                  }}>
                  <Thumb photoId={it.photoId} alt="" />
                  {onRemove && !sel.on && <button className="pb-remove" aria-label={onRemove.label} title={onRemove.label}
                    onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onRemove.run(it.entryId) }}>✕</button>}
                </div>
              )
            })}
            {layout.labels.map((l) => <span key={l.key} className="map-label" style={{ left: l.x, top: l.y }}>{l.text}</span>)}
          </div>
        </div>
      </div>
      {children}
    </section>
  )
}
