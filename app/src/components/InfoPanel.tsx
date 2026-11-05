import { useMemo } from 'react'
import { categoriesOf, tagIdsOf, withCategories, type Entry } from '../data/types'
import { useArchive } from '../state'
import { MultiPick } from './MultiPick'
import { FloatingPanel } from './FloatingPanel'

// 기록 화면 플로팅 창 (F-26): 맨 위 카테고리(여러 개, F-28), 그 아래 태그(F-29 태그 목록).
// 둘 다 검색 드롭다운으로 고르거나 새로 만든다. 창 높이는 내용만큼.

export function InfoPanel({ entry, onChange, onClose }: { entry: Entry; onChange(next: Entry): void; onClose(): void }) {
  const { series, entries, createSeries, tags: tagList, createTag } = useArchive()
  const { projects, createProject, addToProject, removeFromProject } = useArchive()
  const inProjects = projects.filter((p) => p.entryIds.includes(entry.id)).map((p) => p.id)
  const cats = categoriesOf(entry)
  const tagIds = tagIdsOf(entry)
  const known = useMemo(() => new Set(tagList.map((t) => t.id)), [tagList])
  const tags = tagIds.filter((id) => known.has(id))

  // 태그 목록: 같은 카테고리에서 쓴 태그를 앞에, 그 외는 뒤에
  const tagOptions = useMemo(() => {
    const near = new Set<string>()
    for (const e of entries) {
      if (categoriesOf(e).some((id) => cats.includes(id))) for (const id of tagIdsOf(e)) near.add(id)
    }
    const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'ko')
    const sorted = [...tagList.filter((t) => near.has(t.id)).sort(byName), ...tagList.filter((t) => !near.has(t.id)).sort(byName)]
    return sorted.map((t) => ({ id: t.id, label: t.name }))
  }, [entries, cats, tagList])

  const toggleCat = (id: string) =>
    onChange(withCategories(entry, cats.includes(id) ? cats.filter((x) => x !== id) : [...cats, id]))

  const createCat = async (name: string) => {
    const s = series.find((x) => x.name === name) ?? (await createSeries(name))
    if (!cats.includes(s.id)) onChange(withCategories(entry, [...cats, s.id]))
  }

  const toggleTag = (id: string) => onChange({ ...entry, tagIds: tags.includes(id) ? tags.filter((x) => x !== id) : [...tags, id] })

  const createTagHere = async (name: string) => {
    const t = await createTag(name)
    if (!tags.includes(t.id)) onChange({ ...entry, tagIds: [...tags, t.id] })
  }

  // 프로젝트에 담기·빼기 (F-33). 프로젝트는 기록 안이 아니라 프로젝트 쪽에 저장되므로 onChange를 거치지 않는다.
  const toggleProject = (id: string) => void (inProjects.includes(id) ? removeFromProject(id, entry.id) : addToProject(id, [entry.id]))

  const createProjectHere = async (name: string) => {
    await createProject(name, [entry.id])
  }

  return (
    <FloatingPanel title="사진 정보" className="photo-info" onDone={onClose}>
      <MultiPick
        label="카테고리"
        options={series.map((s) => ({ id: s.id, label: s.name }))}
        selected={cats}
        onToggle={toggleCat}
        onCreate={createCat}
      />
      <MultiPick label="태그" options={tagOptions} selected={tags} onToggle={toggleTag} onCreate={createTagHere} />
      <MultiPick
        label="프로젝트"
        options={projects.map((p) => ({ id: p.id, label: p.name }))}
        selected={inProjects}
        onToggle={toggleProject}
        onCreate={createProjectHere}
      />
    </FloatingPanel>
  )
}
