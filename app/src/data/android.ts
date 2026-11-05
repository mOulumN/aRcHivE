import type { ArchiveFs } from './folderStore'

declare global {
  interface Window {
    archiveAndroid?: { request(json: string): string }
    archiveExportResult?: (saved: boolean, error: string | null) => void
    archiveFolderResult?: (label: string | null, error: string | null) => void
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
    readData: async () => call<string | null>('readData'),
    writeData: async (json) => { call('writeData', { json }) },
    writeFile: async (rel, data) => { call('writeFile', { rel, data: await encode(data) }) },
    readFile: async (rel) => {
      const data = call<string | null>('readFile', { rel })
      if (data === null) return null
      const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
      return bytes.buffer
    },
    deleteFile: async (rel) => { call('deleteFile', { rel }) },
    openFolder: async () => {},
  }
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
