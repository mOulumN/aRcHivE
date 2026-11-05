import { useCallback, useEffect, useRef, useState } from 'react'
import { downloadBlob, exportBackup, importBackup } from '../data/backup'
import { useArchive } from '../state'
import { useNotice } from './Ask'

// 백업 (F-13): 컴퓨터 프로그램에서만. 웹 버전은 디자인 확인용이라 백업이 없다.

const DAY = 24 * 60 * 60 * 1000
export const BACKUP_WARN_DAYS = 7

export function useBackupStatus() {
  const { store, entries } = useArchive()
  const [last, setLast] = useState<number | null>(null)
  const refresh = useCallback(async () => {
    const v = await store.getMeta('lastBackup')
    setLast(v ? Number(v) : null)
  }, [store])
  useEffect(() => {
    void refresh()
  }, [refresh, entries.length])
  const days = last === null ? null : Math.floor((Date.now() - last) / DAY)
  const overdue = store.kind === 'folder' && entries.length > 0 && (days === null || days >= BACKUP_WARN_DAYS)
  return { last, days, overdue, refresh }
}

const dateStamp = () => {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function BackupSection() {
  const archive = useArchive()
  const notice = useNotice()
  const status = useBackupStatus()
  const [busy, setBusy] = useState<string | null>(null)
  const file = useRef<HTMLInputElement>(null)

  const doExport = async () => {
    setBusy('내보내는 중…')
    try {
      await archive.flush()
      if (!(await downloadBlob(await exportBackup(archive.store), `aRcHivE-backup-${dateStamp()}.zip`))) return
      await archive.store.setMeta('lastBackup', String(Date.now()))
      await status.refresh()
    } catch (e) {
      await notice(`백업하지 못했어요: ${(e as Error).message}`)
    } finally {
      setBusy(null)
    }
  }

  const doImport = async (f: File) => {
    setBusy('가져오는 중…')
    try {
      await archive.flush()
      const r = await importBackup(archive.store, f)
      await archive.reload()
      await notice(`새 기록 ${r.added}개${r.skipped ? ` · 건너뜀 ${r.skipped}개` : ''}`)
    } catch (e) {
      await notice(`가져오지 못했어요: ${(e as Error).message}`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="settings-section">
      <h3>백업</h3>
      <dl className="settings-dl">
        <dt>마지막 백업</dt>
        <dd>{status.days === null ? '없음' : status.days === 0 ? '오늘' : `${status.days}일 전`}</dd>
        <dt>저장 위치</dt>
        <dd className="path" title={archive.store.describe()}>
          {archive.store.describe()}
        </dd>
      </dl>
      <div className="settings-buttons">
        <button className="btn ghost" disabled={!!busy} onClick={() => void doExport()}>
          {busy ?? '내보내기'}
        </button>
        <button className="btn ghost" disabled={!!busy} onClick={() => file.current?.click()}>
          가져오기
        </button>
        {!window.archiveAndroid && <button className="btn ghost" onClick={() => void window.archiveFs?.openFolder()}>
          폴더 열기
        </button>}
      </div>
      <input
        ref={file}
        type="file"
        accept=".zip,application/zip"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void doImport(f)
          e.target.value = ''
        }}
      />
    </section>
  )
}
