import { useEffect, useState } from 'react'
import { SYNC_EVENT, type SyncProgress } from '../data/android'
import { OFFLINE_EVENT, isOffline } from '../data/folderStore'

// 폰: 고른 폴더(드라이브)와 사진을 주고받는 동안 하단에 진행 바를 띄운다. 다 끝나면 사라진다.
// 드라이브에 연결되지 않아 폰에만 저장된 변경이 있으면 그 사실을 알린다(연결되면 자동으로 올라간다).
export function SyncBar() {
  const [p, setP] = useState<SyncProgress>({ done: 0, total: 0 })
  const [offline, setOffline] = useState(isOffline)
  useEffect(() => {
    const on = (e: Event) => setP((e as CustomEvent<SyncProgress>).detail)
    const off = (e: Event) => setOffline((e as CustomEvent<boolean>).detail)
    window.addEventListener(SYNC_EVENT, on)
    window.addEventListener(OFFLINE_EVENT, off)
    return () => {
      window.removeEventListener(SYNC_EVENT, on)
      window.removeEventListener(OFFLINE_EVENT, off)
    }
  }, [])
  if (offline) {
    return (
      <div className="sync-bar" role="status">
        <span>오프라인 · 폰에 저장했어요. 연결되면 올라가요</span>
      </div>
    )
  }
  if (p.total <= 0) return null
  const ratio = Math.min(1, p.done / p.total)
  return (
    <div className="sync-bar" role="status">
      <span>
        동기화 중 {p.done}/{p.total}
      </span>
      <div className="sync-track">
        <div className="sync-fill" style={{ width: `${ratio * 100}%` }} />
      </div>
    </div>
  )
}
