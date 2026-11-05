import { useMemo, useState } from 'react'
import type { ID } from '../data/types'
import { FloatingPanel } from './FloatingPanel'

// 맵 기준 태그 고르기 (F-16): 지금 맵에 있는 사진들이 가진 태그를 사진 수와 함께 미리 보여 주고, 거기서 누르는 순서대로 고른다.
// (카테고리·태그를 드롭다운으로만 고르게 하는 규칙의 예외: 사용자가 "있는 태그와 개수를 미리 보고 고르게" 요청)

export interface TagCount {
  id: ID
  name: string
  count: number // 지금 맵에 있는 사진 중 이 태그를 가진 수
}

export function BaseTagPicker({
  tags,
  selected,
  names,
  onToggle,
  onClose,
}: {
  tags: TagCount[]
  selected: ID[]
  names: Map<ID, string> // 선택된 태그의 이름 (맵에 지금 없는 태그도 칩으로 보이게)
  onToggle(id: ID): void
  onClose(): void
}) {
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const rows = useMemo(
    () =>
      tags
        .filter((t) => t.name.toLowerCase().includes(q))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ko')),
    [tags, q],
  )

  return (
    <FloatingPanel title="기준 태그" className="map-base" onDone={onClose}>
      <div className="pick">
        {selected.length > 0 && (
          <div className="tag-flow">
            {selected.map((id, i) => (
              <span key={id} className="tag">
                <span className="tag-order">{i + 1}</span>
                {names.get(id) ?? id}
                <button onClick={() => onToggle(id)} aria-label={`${names.get(id) ?? id} 빼기`}>
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="pick-drop base-list">
        <input
          className="pick-search"
          value={query}
          placeholder="검색"
          onChange={(e) => setQuery(e.target.value)}
          aria-label="기준 태그 검색"
        />
        <ul className="pick-list" role="listbox" aria-multiselectable>
          {rows.map((t) => {
            const on = selected.includes(t.id)
            return (
              <li key={t.id} role="option" aria-selected={on}>
                <button className={`pick-row ${on ? 'on' : ''}`} onClick={() => onToggle(t.id)}>
                  <span className="pick-check">{on ? '✓' : ''}</span>
                  <span className="pick-name">{t.name}</span>
                  <span className="pick-count">( {String(t.count).padStart(2, '0')} )</span>
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </FloatingPanel>
  )
}
