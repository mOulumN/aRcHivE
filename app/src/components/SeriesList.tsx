import { useState } from 'react'
import type { ID } from '../data/types'
import { useArchive, useSeriesCounts, type SeriesFilter } from '../state'
import { useAsk, useConfirm } from './Ask'
import { useEntryDrag } from './EntryDrag'
import { SettingsDialog } from './SettingsDialog'
import { TagManager } from './TagManager'

// 보관 화면 왼쪽 카테고리 리스트 (F-20). 레퍼런스: 자유캔버스_01
// 다른 카테고리를 누르면 틀은 그대로 두고 오른쪽만 바뀐다. 이름 바꾸기·지우기는 줄 오른쪽에서.
// 위에서 [카테고리|프로젝트]를 골라 그 목록만 보여 주고, 그 아래 검색 칸으로 이름을 좁힌다(I-08).
// 처음엔 카테고리. 화면이 카테고리↔프로젝트로 바뀌면 목록도 지금 열린 쪽을 따른다.

type Tab = 'category' | 'project'

export function SeriesList() {
  const { series, entries, view, go, createSeries, renameSeries, deleteSeries } = useArchive()
  const { projects, createProject, renameProject, deleteProject } = useArchive()
  const counts = useSeriesCounts()
  const ask = useAsk()
  const confirm = useConfirm()
  const drag = useEntryDrag()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [tagsOpen, setTagsOpen] = useState(false)
  const tabOf = (): Tab => (view.screen === 'project' ? 'project' : 'category')
  const [tab, setTab] = useState<Tab>(tabOf)
  const [query, setQuery] = useState('')
  const [seen, setSeen] = useState(view.screen)
  if (seen !== view.screen) { // 열린 화면의 종류가 바뀌면 목록도 그쪽으로
    setSeen(view.screen)
    setTab(tabOf())
    setQuery('')
  }
  const switchTab = (next: Tab) => {
    if (next === tab) return
    setTab(next)
    setQuery('')
  }
  const q = query.trim().toLowerCase()
  const match = (name: string) => !q || name.toLowerCase().includes(q)
  const filter = view.screen === 'archive' ? view.filter : null // 프로젝트를 보는 중엔 카테고리 강조 없음
  const projectId = view.screen === 'project' ? view.projectId : null

  const open = (key: SeriesFilter) => go({ screen: 'archive', filter: key, entryId: null })

  const rename = async (id: ID, current: string) => {
    const name = await ask('카테고리 이름', current)
    if (name) await renameSeries(id, name)
  }

  const remove = async (id: ID, name: string) => {
    const ok = await confirm(`"${name}" 카테고리를 진짜 삭제할까요?`, {
      detail: '안의 사진은 "카테고리 없음"으로 옮겨져요.',
      ok: '삭제',
      danger: true,
    })
    if (!ok) return
    await deleteSeries(id)
    if (filter === id) open('all')
  }

  const add = async () => {
    const name = await ask('새 카테고리')
    if (!name) return
    const s = await createSeries(name)
    open(s.id)
  }

  const openProject = (id: ID) => go({ screen: 'project', projectId: id, entryId: null })

  const addProject = async () => {
    const name = await ask('새 프로젝트')
    if (!name) return
    openProject((await createProject(name)).id)
  }

  const renameProjectRow = async (id: ID, current: string) => {
    const name = await ask('프로젝트 이름', current)
    if (name) await renameProject(id, name)
  }

  const removeProject = async (id: ID, name: string) => {
    const ok = await confirm(`"${name}" 프로젝트를 진짜 삭제할까요?`, {
      detail: '담아 둔 사진은 그대로 남아요.',
      ok: '삭제',
      danger: true,
    })
    if (!ok) return
    if (projectId === id) open('all')
    await deleteProject(id)
  }

  const projectRow = (id: ID, name: string, n: number) => (
    <li
      key={id}
      data-drop-project={id}
      className={`series-row ${projectId === id ? 'on' : ''} ${drag.overTarget === id ? 'drop-over' : ''} ${drag.dropped === id ? 'drop-done' : ''}`}
    >
      <button className="series-item" onClick={() => openProject(id)} onDoubleClick={() => void renameProjectRow(id, name)}>
        <span className="series-name">
          {name} <span className="series-count">( {String(n).padStart(2, '0')} )</span>
        </span>
      </button>
      <span className="series-edit">
        <button onClick={() => void renameProjectRow(id, name)} aria-label={`${name} 이름 바꾸기`} title="이름 바꾸기">
          (수정)
        </button>
        <button onClick={() => void removeProject(id, name)} aria-label={`${name} 지우기`} title="지우기">
          ✕
        </button>
      </span>
    </li>
  )

  const row = (key: SeriesFilter, name: string, n: number, editable?: { id: ID }) => (
    <li
      key={key}
      data-drop-category={editable?.id}
      className={`series-row ${filter === key ? 'on' : ''} ${editable && drag.overTarget === editable.id ? 'drop-over' : ''} ${editable && drag.dropped === editable.id ? 'drop-done' : ''}`}
    >
      <button className="series-item" onClick={() => open(key)} onDoubleClick={() => editable && void rename(editable.id, name)}>
        <span className="series-name">
          {name} <span className="series-count">( {String(n).padStart(2, '0')} )</span>
        </span>
      </button>
      {editable && (
        <span className="series-edit">
          <button onClick={() => void rename(editable.id, name)} aria-label={`${name} 이름 바꾸기`} title="이름 바꾸기">
            (수정)
          </button>
          <button onClick={() => void remove(editable.id, name)} aria-label={`${name} 지우기`} title="지우기">
            ✕
          </button>
        </span>
      )}
    </li>
  )

  return (
    <aside className="side">
      <div className="side-top">
        <button className="logo small-logo" onClick={() => go({ screen: 'home' })}>
          aRcHivE
        </button>
      </div>
      <div className="side-switch">
        <div className="tool-group" role="group" aria-label="목록 종류">
          <button className={`tool ${tab === 'category' ? 'on' : ''}`} aria-pressed={tab === 'category'} onClick={() => switchTab('category')}>카테고리</button>
          <button className={`tool ${tab === 'project' ? 'on' : ''}`} aria-pressed={tab === 'project'} onClick={() => switchTab('project')}>프로젝트</button>
        </div>
        <input className="side-search" value={query} placeholder="검색" aria-label={tab === 'category' ? '카테고리 검색' : '프로젝트 검색'}
          onChange={(e) => setQuery(e.target.value)} />
      </div>
      <ul className="series-list">
        {tab === 'category' ? <>
          {match('전체') && row('all', '전체', entries.length)}
          {series.filter((s) => match(s.name)).map((s) => row(s.id, s.name, counts.get(s.id) ?? 0, { id: s.id }))}
          {(counts.get(null) ?? 0) > 0 && match('카테고리 없음') && row('none', '카테고리 없음', counts.get(null) ?? 0)}
          <li className="series-row">
            <button className="series-item add" onClick={() => void add()}>
              <span className="series-name">+ 새 카테고리</span>
            </button>
          </li>
        </> : <>
          {projects.filter((p) => match(p.name)).map((p) => projectRow(p.id, p.name, p.entryIds.length))}
          <li className="series-row">
            <button className="series-item add" onClick={() => void addProject()}>
              <span className="series-name">+ 새 프로젝트</span>
            </button>
          </li>
        </>}
      </ul>
      <div className="side-bottom">
        <button className="series-item" onClick={() => setTagsOpen(true)}>
          <span className="series-name">태그</span>
        </button>
        <button className="series-item" onClick={() => setSettingsOpen(true)}>
          <span className="series-name">설정</span>
        </button>
      </div>
      {tagsOpen && <TagManager onClose={() => setTagsOpen(false)} />}
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
    </aside>
  )
}
