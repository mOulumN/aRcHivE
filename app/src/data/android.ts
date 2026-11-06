import type { ArchiveFs } from './folderStore'
import { mergeSnapshots, normalizeSnapshot } from './merge'
import type { Snapshot } from './types'

export const SYNC_EVENT = 'archive:sync'
export type SyncProgress = { done: number; total: number }

declare global {
  interface Window {
    archiveAndroid?: { request(json: string): string }
    archiveExportResult?: (saved: boolean, error: string | null) => void
    archiveFolderResult?: (label: string | null, error: string | null) => void
    archiveSync?: (done: number, total: number) => void
  }
}

const call = <T,>(operation: string, args: Record<string, unknown> = {}): T => {
  const reply = JSON.parse(window.archiveAndroid!.request(JSON.stringify({ operation, ...args }))) as { value: T; error?: string }
  if (reply.error) throw new Error(reply.error)
  return reply.value
}

const encode = (bytes: ArrayBuffer) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(String(reader.result).split(',')[1])
  reader.onerror = () => reject(reader.error)
  reader.readAsDataURL(new Blob([bytes]))
})

export function installAndroidBridge() {
  if (!window.archiveAndroid) return
  // 앱(MainActivity)이 이미 시스템 바 높이만큼 화면을 줄여 주므로 CSS의 안전 여백(env)을 또 더하지 않는다(E-03).
  document.documentElement.classList.add('android')
  const fs: ArchiveFs = {
    // 저장 위치를 아직 안 정했으면 null → 처음 화면에서 앱 내부 / 다른 폴더(드라이브 등)를 고른다.
    getFolder: async () => call<string | null>('getFolder'),
    defaultFolder: async () => '앱 내부',
    useFolder: async () => call<string>('useInternal'),
    chooseFolder: () => new Promise<string | null>((resolve, reject) => {
      window.archiveFolderResult = (label, error) => {
        window.archiveFolderResult = undefined
        if (error) reject(new Error(error))
        else resolve(label)
      }
      try { call('chooseFolder') }
      catch (error) { window.archiveFolderResult = undefined; reject(error) }
    }),
    // 고른 폴더(드라이브)에 data.json이 여러 개 생겼으면 전부 받아 합친다. 하나도 버리지 않는다.
    readData: async () => {
      const value = call<string | string[] | null>('readData')
      if (!Array.isArray(value)) return value
      if (value.length <= 1) return value[0] ?? null
      const snaps: Snapshot[] = []
      for (const raw of value) {
        try { snaps.push(normalizeSnapshot(JSON.parse(raw) as Partial<Snapshot>)) } catch { /* 깨진 사본은 건너뛴다(파일은 남아 있다) */ }
      }
      if (snaps.length === 0) throw new Error('저장 폴더의 기록 파일을 읽지 못했어요')
      return JSON.stringify(snaps.reduce((a, b) => mergeSnapshots(a, b)), null, 1)
    },
    writeData: async (json, merged) => { call('writeData', { json, merged: merged === true }) },
    writeFile: async (rel, data) => { call('writeFile', { rel, data: await encode(data) }) },
    readFile: async (rel) => {
      const data = call<string | null>('readFile', { rel })
      if (data === null) return null
      const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
      return bytes.buffer
    },
    deleteFile: async (rel) => { call('deleteFile', { rel }) },
    openFolder: async () => {},
    prefetch: (rels) => { try { call('prefetch', { rels }) } catch { /* 다음에 다시 시도 */ } },
    retry: () => { try { call('retry') } catch { /* 다음에 다시 시도 */ } },
  }
  // 폰이 뒤에서 사진을 주고받는 진행 상황 → 화면 하단 바(SyncBar)
  window.archiveSync = (done, total) => window.dispatchEvent(new CustomEvent(SYNC_EVENT, { detail: { done, total } }))
  window.archiveFs = fs
}

export async function saveAndroidBackup(blob: Blob, name: string): Promise<boolean> {
  const data = await encode(await blob.arrayBuffer())
  return new Promise((resolve, reject) => {
    window.archiveExportResult = (saved, error) => {
      window.archiveExportResult = undefined
      if (error) reject(new Error(error))
      else resolve(saved)
    }
    try { call('exportBackup', { name, data }) }
    catch (error) { window.archiveExportResult = undefined; reject(error) }
  })
}
