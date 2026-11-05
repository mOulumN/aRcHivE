import { useEffect, useMemo, useRef, useState } from 'react'

// 여러 개 고르는 검색 드롭다운 (카테고리·태그 공용, 규칙: 전부 펼쳐 놓지 않는다)
// 고른 것은 사각 칸으로 줄바꿈되어 보이고, "+"를 누르면 아래에 검색창과 목록이 열린다.

export interface PickOption {
  id: string
  label: string
}

export function MultiPick({
  label,
  options,
  selected,
  onToggle,
  onCreate,
  ordered,
}: {
  label: string
  options: PickOption[]
  selected: string[]
  onToggle(id: string): void
  onCreate?(name: string): void | Promise<void> // 없으면 새로 만들기를 보여 주지 않는다
  ordered?: boolean // 고른 순서가 의미 있을 때: 칸 앞에 번호를 붙인다
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const box = useRef<HTMLDivElement>(null)

  const byId = useMemo(() => new Map(options.map((o) => [o.id, o])), [options])
  const q = query.trim().toLowerCase()
  const matches = options.filter((o) => o.label.toLowerCase().includes(q))
  const exact = options.some((o) => o.label.toLowerCase() === q)
  const canCreate = !!onCreate && q.length > 0 && !exact
  const rows = matches.length + (canCreate ? 1 : 0)

  useEffect(() => setCursor(0), [query, open])

  // 창 바깥을 누르면 닫는다.
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', onDown, true)
    return () => window.removeEventListener('pointerdown', onDown, true)
  }, [open])

  const choose = async (i: number) => {
    if (i < matches.length) onToggle(matches[i].id)
    else if (canCreate) await onCreate?.(query.trim())
    setQuery('')
  }

  return (
    <div className="pick" ref={box}>
      <div className="pick-label">{label}</div>
      <div className="tag-flow">
        {selected.map((id, i) => (
          <span key={id} className="tag">
            {ordered && <span className="tag-order">{i + 1}</span>}
            {byId.get(id)?.label ?? id}
            <button onClick={() => onToggle(id)} aria-label={`${byId.get(id)?.label ?? id} 빼기`}>
              ✕
            </button>
          </span>
        ))}
        <button className={`tag add ${open ? 'on' : ''}`} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={`${label} 고르기`}>
          +
        </button>
      </div>
      {open && (
        <div className="pick-drop">
          <input
            className="pick-search"
            autoFocus
            value={query}
            placeholder="검색"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setCursor((c) => Math.min(rows - 1, c + 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setCursor((c) => Math.max(0, c - 1))
              } else if (e.key === 'Enter') {
                e.preventDefault()
                if (rows > 0) void choose(cursor)
              } else if (e.key === 'Escape') {
                setOpen(false)
              }
            }}
            aria-label={`${label} 검색`}
          />
          <ul className="pick-list" role="listbox" aria-multiselectable>
            {matches.map((o, i) => {
              const on = selected.includes(o.id)
              return (
                <li key={o.id} role="option" aria-selected={on}>
                  <button
                    className={`pick-row ${on ? 'on' : ''} ${cursor === i ? 'cursor' : ''}`}
                    onMouseEnter={() => setCursor(i)}
                    onClick={() => void choose(i)}
                  >
                    <span className="pick-check">{on ? '✓' : ''}</span>
                    {o.label}
                  </button>
                </li>
              )
            })}
            {canCreate && (
              <li>
                <button
                  className={`pick-row create ${cursor === matches.length ? 'cursor' : ''}`}
                  onMouseEnter={() => setCursor(matches.length)}
                  onClick={() => void choose(matches.length)}
                >
                  <span className="pick-check">+</span>“{query.trim()}” 만들기
                </button>
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  )
}
