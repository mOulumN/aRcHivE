import { useMemo, useState } from 'react'
import { type ID } from '../data/types'
import { useArchive } from '../state'
import { PROJECT_PHOTO } from './projectLayout'
import { ProjectPicker } from './ProjectPicker'
import { ScopePane } from './ScopePane'

// 프로젝트 화면 (F-33). 화면 동작은 카테고리와 같은 ScopePane이 하고, 여기서는 이 프로젝트의 사진 목록과 저장 키만 정한다.
// 프로젝트의 고정 위치는 예전 저장 좌표 그대로 쓴다(absolutePins).

export function ProjectBoard({ projectId }: { projectId: ID }) {
  const { projects, entries, updateProject, removeFromProject, go } = useArchive()
  const [pickerOpen, setPickerOpen] = useState(false)
  const project = projects.find((p) => p.id === projectId)
  const list = useMemo(() => project?.entryIds.flatMap((id) => {
    const entry = entries.find((e) => e.id === id)
    return entry ? [entry] : []
  }) ?? [], [project, entries])
  if (!project) return null

  return <ScopePane scopeId={projectId} title={project.name} list={list} long={PROJECT_PHOTO} absolutePins
    notes={project.notes} onNotes={(notes) => updateProject({ ...project, notes })}
    source={{ fromProject: projectId }}
    add={<button className="btn" onClick={() => setPickerOpen(true)}><span className="desktop-only">사진 담기 +</span><span className="mobile-only">담기 +</span></button>}
    onOpen={(id) => go({ screen: 'project', projectId, entryId: id })}
    onRemove={{ label: '프로젝트에서 빼기', run: (id) => void removeFromProject(projectId, id) }}>
    {pickerOpen && <ProjectPicker projectId={projectId} onClose={() => setPickerOpen(false)} />}
  </ScopePane>
}
