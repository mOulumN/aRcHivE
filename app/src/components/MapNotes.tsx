import { useEffect, useRef, useState, type PointerEvent as RPointerEvent, type RefObject } from 'react'
import { newId, type ID, type ProjectNote } from '../data/types'
import { useConfirm } from './Ask'
import { ColorField } from './ColorPicker'
import { MemoFont, roundFont, shownFont, storedFont } from './MemoFont'
import { useHold } from './useHold'
import { useItemDrag } from './useItemDrag'
import { useArchive } from '../state'

export interface NotePhoto { id: ID; x: number; y: number; w: number; h: number }
const ORIGIN = { x: 0, y: 0 }

// 카테고리와 프로젝트가 공유하는 맵 메모 편집 동작. 저장 소속은 각 화면이 정한다.
export function useMapNotes(notes: ProjectNote[], onChange: (notes: ProjectNote[]) => void,
  scroller: RefObject<HTMLDivElement | null>, zoom: number) {
  const current = useRef({ notes, onChange })
  current.current = { notes, onChange }
  const [linking, setLinking] = useState<ID | null>(null)
  const [focusNote, setFocusNote] = useState<ID | null>(null)
  const [colorNote, setColorNote] = useState<ID | null>(null)
  const [selectedId, setSelectedId] = useState<ID | null>(null)
  const confirm = useConfirm()
  const { settings } = useArchive()
  const patch = (id: ID, change: Partial<ProjectNote>) => current.current.onChange(
    current.current.notes.map((n) => n.id === id ? { ...n, ...change } : n))
  const move = useItemDrag(ORIGIN, (d) => patch(d.id, { x: d.x, y: d.y }), zoom)
  const resizing = useRef<{ id: ID; x: number; y: number; w: number; h: number } | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setLinking(null); setColorNote(null) }
    }
    window.addEventListener('keydown', onKey)
    const cancelResize = () => { resizing.current = null }
    window.addEventListener('archive:gesture', cancelResize)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('archive:gesture', cancelResize)
    }
  }, [])

  const add = () => {
    // 만드는 순간 보이는 글자 크기(설정값)를 그 메모에 저장한다(이후 칸과 같은 비율로 확대·축소).
    const note: ProjectNote = { id: newId(), text: '', w: 200, color: '#ffffff', entryIds: [], fontSize: roundFont(settings.noteFontSize / zoom),
      x: (scroller.current?.scrollLeft ?? 0) / zoom + 60,
      y: (scroller.current?.scrollTop ?? 0) / zoom + 60 }
    current.current.onChange([...current.current.notes, note])
    setFocusNote(note.id)
    setSelectedId(note.id)
    setLinking(null)
  }
  const connect = (id: ID) => {
    const note = current.current.notes.find((n) => n.id === linking)
    if (!note) return false
    patch(note.id, { entryIds: note.entryIds.includes(id) ? note.entryIds.filter((x) => x !== id) : [...note.entryIds, id] })
    return true
  }
  const remove = async (id: ID) => {
    if (!(await confirm('진짜 삭제할까요?', { ok: '삭제', danger: true }))) return
    current.current.onChange(current.current.notes.filter((n) => n.id !== id))
    if (linking === id) setLinking(null)
    if (colorNote === id) setColorNote(null)
    if (selectedId === id) setSelectedId(null)
  }
  const at = (note: ProjectNote) => move.drag?.moved && move.drag.id === note.id
    ? { ...note, x: move.drag.x, y: move.drag.y } : note
  const resize = (note: ProjectNote) => ({
    onPointerDown: (e: RPointerEvent<HTMLElement>) => {
      if (e.button !== 0) return
      e.stopPropagation(); e.preventDefault()
      resizing.current = { id: note.id, x: e.clientX, y: e.clientY, w: note.w,
        h: (e.currentTarget.closest('.pb-note') as HTMLElement).offsetHeight }
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    onPointerMove: (e: RPointerEvent<HTMLElement>) => {
      const start = resizing.current
      if (!start) return
      patch(start.id, { w: Math.max(120, start.w + (e.clientX - start.x) / zoom),
        h: Math.max(84, start.h + (e.clientY - start.y) / zoom) })
    },
    onPointerUp: () => { resizing.current = null },
    onPointerCancel: () => { resizing.current = null },
  })
  const dismiss = () => {
    setSelectedId(null); setLinking(null); setColorNote(null)
    const active = document.activeElement as HTMLElement | null
    if (active?.closest('.pb-note')) active.blur()
  }
  return { notes, zoom, linking, setLinking, focusNote, colorNote, setColorNote, selectedId, setSelectedId,
    selected: notes.find((n) => n.id === selectedId), dismiss, add, connect, remove, patch, move, at, resize,
    fontOf: (n: ProjectNote) => n.fontSize ?? settings.noteFontSize,
    shownFontOf: (n: ProjectNote) => shownFont(n.fontSize ?? settings.noteFontSize, zoom),
    setFont: (n: ProjectNote, shown: number) => patch(n.id, { fontSize: storedFont(shown, zoom) }) }
}

export function MapNoteMenu({ editor }: { editor: ReturnType<typeof useMapNotes> }) {
  const note = editor.selected
  if (!note) return null
  return <div className="mobile-only memo-menu" role="group" aria-label="메모 메뉴">
    {editor.colorNote !== note.id && <MemoFont className="memo-font-float" shown={editor.shownFontOf(note)} onChange={(v) => editor.setFont(note, v)} />}
    <button className={`btn ghost ${editor.linking === note.id ? 'on' : ''}`} onClick={() => editor.setLinking(editor.linking === note.id ? null : note.id)}>
      {editor.linking === note.id ? '연결 완료' : '사진 연결'}</button>
    <button className="btn ghost" onClick={() => editor.setColorNote(editor.colorNote === note.id ? null : note.id)}>메모 색</button>
    <button className="btn ghost" onClick={() => void editor.remove(note.id)}>삭제</button>
    <button className="btn ghost" onClick={editor.dismiss}>완료</button>
    {editor.colorNote === note.id && <div className="memo-menu-color">
      <ColorField label="메모 색" kind="note" open onToggle={() => editor.setColorNote(null)} value={note.color ?? '#ffffff'} onChange={(color) => editor.patch(note.id, { color })} />
    </div>}
  </div>
}

export function MapNoteLayer({ editor, items, width, height, selecting = false }: {
  editor: ReturnType<typeof useMapNotes>; items: NotePhoto[]; width: number; height: number; selecting?: boolean
}) {
  const hold = useHold()
  const byId = new Map(items.map((it) => [it.id, it]))
  return <>
    <svg className="pb-lines map-note-lines" width={width} height={height} aria-hidden>
      {editor.notes.flatMap((note) => {
        const at = editor.at(note)
        return note.entryIds.flatMap((id) => {
          const photo = byId.get(id)
          return photo ? [<line key={`${note.id}:${id}`} x1={at.x + note.w / 2} y1={at.y + 12}
            x2={photo.x + photo.w / 2} y2={photo.y + photo.h / 2} />] : []
        })
      })}
    </svg>
    {editor.notes.map((note) => {
      const at = editor.at(note)
      const count = note.entryIds.filter((id) => byId.has(id)).length
      return <div key={note.id} data-note={note.id}
        className={`pb-note map-note ${editor.move.drag?.id === note.id ? 'dragging' : ''} ${hold.held === note.id ? 'lifted' : ''} ${editor.linking === note.id ? 'linking' : ''} ${editor.colorNote === note.id ? 'colors-open' : ''}`}
        style={{ left: at.x, top: at.y, width: note.w, minHeight: note.h, background: note.color ?? '#ffffff' }}
        onPointerDownCapture={() => editor.setSelectedId(note.id)}>
        <div className="pb-note-bar" {...editor.move.bind({ id: note.id, x: note.x, y: note.y, w: note.w, h: 24 })}>
          <button className="pb-note-btn" disabled={selecting} onPointerDown={(e) => e.stopPropagation()}
            onClick={() => editor.setLinking(editor.linking === note.id ? null : note.id)}>
            {editor.linking === note.id ? '완료' : count > 0 ? `연결 ${count}` : '연결'}
          </button>
          <button className="pb-note-btn" onPointerDown={(e) => e.stopPropagation()}
            onClick={() => editor.setColorNote(editor.colorNote === note.id ? null : note.id)}>색</button>
          <span className="pb-note-font" onPointerDown={(e) => e.stopPropagation()}>
            <button className="pb-note-btn" aria-label="글자 작게" onClick={() => editor.setFont(note, editor.shownFontOf(note) - 1)}>−</button>
            {editor.shownFontOf(note)}
            <button className="pb-note-btn" aria-label="글자 크게" onClick={() => editor.setFont(note, editor.shownFontOf(note) + 1)}>+</button>
          </span>
          <span className="spacer" />
          <button className="pb-note-btn" aria-label="메모 지우기" onPointerDown={(e) => e.stopPropagation()}
            onClick={() => void editor.remove(note.id)}>✕</button>
        </div>
        {editor.colorNote === note.id && <div className="map-note-color" onPointerDown={(e) => e.stopPropagation()}>
          <ColorField label="메모 색" kind="note" value={note.color ?? '#ffffff'} onChange={(color) => editor.patch(note.id, { color })} />
        </div>}
        <textarea className="pb-note-text" style={{ fontSize: editor.fontOf(note) }} value={note.text} autoFocus={editor.focusNote === note.id}
          onFocus={() => editor.setSelectedId(note.id)}
          onChange={(e) => editor.patch(note.id, { text: e.target.value })} aria-label="메모"
          {...hold.bind(note.id, (p, el) => {
            // 꾹 누르기 = 이동: 글쓰기 칸을 놓고 윗줄이 받는 끌기로 이어 간다. 짧게 누르면 글 수정.
            const bar = el.closest('.pb-note')?.querySelector<HTMLElement>('.pb-note-bar')
            if (!bar) return
            el.blur()
            editor.setSelectedId(note.id)
            editor.move.begin({ id: note.id, x: note.x, y: note.y, w: note.w, h: 24 }, p, bar)
          })} />
        <span className="note-resize" {...editor.resize(note)} aria-label="크기 조절" />
      </div>
    })}
  </>
}
