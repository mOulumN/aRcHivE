import { useMemo, useState } from 'react'
import { categoriesOf, tagIdsOf, type ID } from '../data/types'
import { useArchive } from '../state'
import { MultiPick } from './MultiPick'
import { Thumb } from './Thumb'

// 프로젝트에 사진 담기 (F-33): 아직 안 담은 사진을 골라 한꺼번에 담는다.
// 카테고리·태그로 좁혀서 볼 수 있다. 사진은 복사되지 않고 참조만 담긴다.

export function ProjectPicker({ projectId, onClose }: { projectId: ID; onClose(): void }) {
  const { projects, entries, series, tags, addToProject } = useArchive()
  const [category, setCategory] = useState('')
  const [tagFilter, setTagFilter] = useState<ID[]>([])
  const [checked, setChecked] = useState<Set<ID>>(new Set())

  const project = projects.find((p) => p.id === projectId)
  const candidates = useMemo(() => {
    const have = new Set(project?.entryIds ?? [])
    return entries.filter(
      (e) =>
        !have.has(e.id) &&
        (!category || categoriesOf(e).includes(category)) &&
        (tagFilter.length === 0 || tagIdsOf(e).some((t) => tagFilter.includes(t))),
    )
  }, [entries, project, category, tagFilter])

  const toggle = (id: ID) =>
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const shownChecked = candidates.filter((e) => checked.has(e.id))
  const allOn = candidates.length > 0 && shownChecked.length === candidates.length

  const tagOptions = useMemo(
    () => tags.map((t) => ({ id: t.id, label: t.name })).sort((a, b) => a.label.localeCompare(b.label, 'ko')),
    [tags],
  )

  const save = async () => {
    await addToProject(projectId, [...checked])
    onClose()
  }

  return (
    <div className="modal-back" onMouseDown={onClose}>
      <div className="modal batch" onMouseDown={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <strong>사진 담기</strong>
          <span className="muted"> · {candidates.length}장</span>
          <span className="spacer" />
          <button
            className="link"
            onClick={() =>
              setChecked((prev) => {
                const next = new Set(prev)
                for (const e of candidates) {
                  if (allOn) next.delete(e.id)
                  else next.add(e.id)
                }
                return next
              })
            }
          >
            {allOn ? '모두 해제' : '모두 선택'}
          </button>
        </header>

        <div className="picker-filters">
          <label className="field">
            카테고리
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">전체</option>
              {series.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <MultiPick
            label="태그"
            options={tagOptions}
            selected={tagFilter}
            onToggle={(id) => setTagFilter((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))}
          />
        </div>

        <div className="batch-grid">
          {candidates.map((e) => (
            <label key={e.id} className={`batch-cell ${checked.has(e.id) ? 'on' : ''}`}>
              <input type="checkbox" checked={checked.has(e.id)} onChange={() => toggle(e.id)} />
              <Thumb photoId={e.photoId} alt="" />
            </label>
          ))}
        </div>

        <footer className="modal-foot">
          <span className="spacer" />
          <button className="btn ghost" onClick={onClose}>
            닫기
          </button>
          <button className="btn" disabled={checked.size === 0} onClick={() => void save()}>
            담기 {checked.size > 0 ? checked.size : ''}
          </button>
        </footer>
      </div>
    </div>
  )
}
