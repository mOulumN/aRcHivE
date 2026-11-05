import { useMemo } from 'react'
import { MAIN_MAP } from '../data/types'
import { entriesFor, useArchive, type SeriesFilter } from '../state'
import { useImporter } from './Importer'
import { THUMB } from './mapLayout'
import { ScopePane } from './ScopePane'

// 보관 화면 오른쪽: 카테고리(전체·카테고리 없음 포함)의 갤러리·맵 (F-21, F-30, F-16).
// 화면 동작은 프로젝트와 같은 ScopePane이 하고, 여기서는 이 범위의 사진 목록과 저장 키만 정한다.
// 위치·기준 태그는 'main'(전체) 또는 'category:<id>' 키로 범위마다 따로 저장된다.

export function CategoryPane({ filter }: { filter: SeriesFilter }) {
  const { entries, series, go, mapNotes, setMapNotes } = useArchive()
  const { pick } = useImporter()
  const list = useMemo(() => entriesFor(entries, filter), [entries, filter])
  const title =
    filter === 'all' ? '전체' : filter === 'none' ? '카테고리 없음' : (series.find((s) => s.id === filter)?.name ?? '')
  const scopeId = filter === 'all' ? MAIN_MAP : `category:${filter}`

  return <ScopePane scopeId={scopeId} title={title} list={list} long={THUMB} absolutePins={false}
    notes={mapNotes[scopeId] ?? []} onNotes={(next) => setMapNotes(scopeId, next)}
    source={{ fromCategory: filter !== 'all' && filter !== 'none' ? filter : null }}
    add={<button className="btn" onClick={pick}><span className="desktop-only">사진 넣기 +</span><span className="mobile-only">사진 +</span></button>}
    onOpen={(id) => go({ screen: 'archive', filter, entryId: id })} />
}
