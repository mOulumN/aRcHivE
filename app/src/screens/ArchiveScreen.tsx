import { CategoryPane } from '../components/MapView'
import { ProjectBoard } from '../components/ProjectBoard'
import { SeriesList } from '../components/SeriesList'
import { useArchive } from '../state'
import { Board } from './Board'
import { useEffect, useRef, useState } from 'react'

// 보관 화면: 왼쪽 카테고리·프로젝트 리스트 + 오른쪽 영역(갤러리·맵 / 프로젝트 보드 / 사진 기록). 틀은 하나로 유지된다.

export function ArchiveScreen() {
  const { view, entries } = useArchive()
  const [drawer, setDrawer] = useState(false)
  const toggle = useRef<HTMLButtonElement>(null)
  useEffect(() => { setDrawer(false) }, [view])
  useEffect(() => {
    if (!drawer) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setDrawer(false); toggle.current?.focus() }
      if (e.key === 'Tab' && window.matchMedia('(max-width: 767px)').matches) {
        const nodes = [...document.querySelectorAll<HTMLButtonElement>('.side-wrap button:not(:disabled)')]
        const first = nodes[0], last = nodes[nodes.length - 1]
        if (e.shiftKey && (document.activeElement === first || !document.activeElement?.closest('.side-wrap'))) {
          e.preventDefault(); last?.focus()
        } else if (!e.shiftKey && (document.activeElement === last || !document.activeElement?.closest('.side-wrap'))) {
          e.preventDefault(); first?.focus()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drawer])
  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)')
    const update = () => {
      const pane = document.querySelector<HTMLElement>('.archive > .pane')
      if (pane) pane.inert = drawer && media.matches
    }
    update(); media.addEventListener('change', update)
    return () => { media.removeEventListener('change', update); const pane = document.querySelector<HTMLElement>('.archive > .pane'); if (pane) pane.inert = false }
  }, [drawer])
  if (view.screen === 'home') return null
  const entry = view.entryId ? entries.find((e) => e.id === view.entryId) : undefined
  const list =
    view.screen === 'project' ? (
      <ProjectBoard key={view.projectId} projectId={view.projectId} />
    ) : (
      <CategoryPane key={view.filter} filter={view.filter} />
    )

  return (
    <div className={`archive ${drawer ? 'drawer-open' : ''}`}>
      <button ref={toggle} className="mobile-only drawer-toggle" aria-label="목록 열기" aria-expanded={drawer} onClick={() => setDrawer((v) => !v)}>☰</button>
      {drawer && <button className="drawer-back mobile-only" aria-label="목록 닫기" onClick={() => { setDrawer(false); toggle.current?.focus() }} />}
      <div className="side-wrap">
        <button className="mobile-only drawer-close link" onClick={() => { setDrawer(false); toggle.current?.focus() }}>닫기</button>
        <SeriesList />
      </div>
      <div className="pane">{entry ? <Board entry={entry} /> : list}</div>
    </div>
  )
}
