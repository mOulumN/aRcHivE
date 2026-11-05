import { useEffect, useState } from 'react'
import type { ArchiveFs } from '../data/folderStore'

// 컴퓨터 프로그램 첫 실행: 사진과 기록을 저장할 폴더 정하기 (F-15)

export function FolderSetup({ fs, onReady }: { fs: ArchiveFs; onReady(folder: string): void }) {
  const [suggest, setSuggest] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    void fs.defaultFolder().then(setSuggest)
  }, [fs])

  const run = async (action: () => Promise<string | null>) => {
    setBusy(true)
    setError('')
    try {
      const folder = await action()
      if (folder) onReady(folder)
    } catch (e) {
      setError(`폴더를 쓸 수 없어요: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="setup">
      <h1 className="logo">aRcHivE</h1>
      <p>저장 폴더</p>
      <div className="setup-path">{suggest || '…'}</div>
      {error && <div className="setup-path">{error}</div>}
      <div className="setup-buttons">
        <button className="btn" disabled={busy || !suggest} onClick={() => void run(() => fs.useFolder(suggest))}>
          이 폴더 사용
        </button>
        <button className="btn ghost" disabled={busy} onClick={() => void run(() => fs.chooseFolder())}>
          다른 폴더 고르기
        </button>
      </div>
    </div>
  )
}
