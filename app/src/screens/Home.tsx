import { useMemo } from 'react'
import { useBackupStatus } from '../components/BackupPanel'
import { useImporter } from '../components/Importer'
import { Thumb } from '../components/Thumb'
import { categoriesOf } from '../data/types'
import { useArchive, useSeriesCounts } from '../state'

// 홈 (F-08, F-19): 보기 좋은 첫 화면. 모은 사진이 여백 넓게 놓이고,
// 오른쪽 작은 메뉴에 사진이 많은 계열 12개. 레퍼런스: 그리드갤러리_03

const TOP = 12
const PER_COLUMN = 4

export function Home() {
  const { entries, series, go } = useArchive()
  const counts = useSeriesCounts()
  const { pick } = useImporter()
  const backup = useBackupStatus()

  const top = useMemo(
    () =>
      series
        .map((s) => ({ s, n: counts.get(s.id) ?? 0 }))
        .filter((x) => x.n > 0)
        .sort((a, b) => b.n - a.n || a.s.order - b.s.order)
        .slice(0, TOP),
    [series, counts],
  )
  const columns = Array.from({ length: Math.ceil(top.length / PER_COLUMN) }, (_, i) =>
    top.slice(i * PER_COLUMN, (i + 1) * PER_COLUMN),
  )

  return (
    <div className="home">
      <header className="home-head">
        <h1 className="logo">aRcHivE</h1>
        <nav className="home-menu">
          <ul>
            <li>
              <button onClick={() => go({ screen: 'archive', filter: 'all', entryId: null })}>전체 {entries.length}</button>
            </li>
            <li>
              <button onClick={pick}>사진 넣기 +</button>
            </li>
            {backup.overdue && (
              <li>
                <button className="strong" onClick={() => go({ screen: 'archive', filter: 'all', entryId: null })}>
                  백업 {backup.days === null ? '안 함' : `${backup.days}일 전`}
                </button>
              </li>
            )}
          </ul>
          {columns.map((col, i) => (
            <ul key={i}>
              {col.map(({ s, n }) => (
                <li key={s.id}>
                  <button onClick={() => go({ screen: 'archive', filter: s.id, entryId: null })}>
                    {s.name}
                    <sup>{n}</sup>
                  </button>
                </li>
              ))}
            </ul>
          ))}
        </nav>
      </header>

      {entries.length === 0 ? (
        <div className="home-empty">
          <button className="btn" onClick={pick}>
            사진 넣기 +
          </button>
        </div>
      ) : (
        <main className="home-grid">
          {entries.map((e) => (
            <button
              key={e.id}
              className="home-item"
              onClick={() => go({ screen: 'archive', filter: categoriesOf(e)[0] ?? 'none', entryId: e.id })}
            >
              <Thumb photoId={e.photoId} alt="" />
            </button>
          ))}
        </main>
      )}
    </div>
  )
}
