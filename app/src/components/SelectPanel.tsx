import { useMemo } from 'react'
import { categoriesOf, type ID } from '../data/types'
import { useArchive } from '../state'
import { MultiPick } from './MultiPick'
import { FloatingPanel } from './FloatingPanel'

// 여러 장 선택 창: 고른 사진 전부를 한꺼번에 프로젝트에 담거나 카테고리에 더한다.
// 칸에 보이는 것 = 고른 사진 "전부"가 이미 속한 것. 이미 속한 걸 다시 누르면 고른 사진 전부에서 뺀다.

export function SelectPanel({ ids, onClose, onDone, onSelectAll, allSelected }: { ids: ID[]; onClose(): void; onDone?(): void; onSelectAll?(): void; allSelected?: boolean }) {
  const { entries, series, projects, createSeries, createProject, addToProject, removeFromProject, editCategories } = useArchive()

  const chosen = useMemo(() => {
    const set = new Set(ids)
    return entries.filter((e) => set.has(e.id))
  }, [entries, ids])

  const inProjects = projects.filter((p) => chosen.length > 0 && chosen.every((e) => p.entryIds.includes(e.id))).map((p) => p.id)
  const inCategories = series.filter((s) => chosen.length > 0 && chosen.every((e) => categoriesOf(e).includes(s.id))).map((s) => s.id)

  const toggleProject = (id: ID) =>
    void (inProjects.includes(id) ? removeFromProject(id, ids) : addToProject(id, ids))
  const toggleCategory = (id: ID) =>
    void (inCategories.includes(id) ? editCategories(ids, [], [id]) : editCategories(ids, [id], []))

  const createCategoryHere = async (name: string) => {
    const s = series.find((x) => x.name === name) ?? (await createSeries(name))
    await editCategories(ids, [s.id], [])
  }

  return (
    <FloatingPanel title={`${ids.length}장 선택`} className="select-panel" onDone={onDone ?? onClose} onCancel={onDone ?? onClose}
      actions={onSelectAll && <button className="link" onClick={onSelectAll}>{allSelected ? '모두 해제' : '모두 선택'}</button>}>
      <MultiPick
        label="프로젝트"
        options={projects.map((p) => ({ id: p.id, label: p.name }))}
        selected={inProjects}
        onToggle={toggleProject}
        onCreate={(name) => void createProject(name, ids)}
      />
      <MultiPick
        label="카테고리"
        options={series.map((s) => ({ id: s.id, label: s.name }))}
        selected={inCategories}
        onToggle={toggleCategory}
        onCreate={createCategoryHere}
      />
    </FloatingPanel>
  )
}
