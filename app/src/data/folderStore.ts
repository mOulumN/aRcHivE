import type { Store } from './store'
import { differs, emptySnapshot, mergeSnapshots, normalizeSnapshot, stampKey, type ListName } from './merge'
import { categoriesOf, withCategories, type PhotoMeta, type Snapshot } from './types'

// 컴퓨터 프로그램·폰(고른 폴더)용 저장. 내가 고른 폴더 안에
//   data.json            기록·계열·메모 전부
//   photos/<id>.<확장자>  사진 원본
//   thumbs/<id>.webp      보관함용 작은 사본
// 으로 저장한다. 실제 파일 읽기/쓰기는 프로그램(electron/main.cjs, 안드로이드 MainActivity)이 한다.
// 같은 폴더를 여러 기기가 쓸 수 있으므로, 저장할 때마다 폴더의 data.json과 항목별로 합친다(merge.ts).

export interface ArchiveFs {
  getFolder(): Promise<string | null>
  chooseFolder(): Promise<string | null>
  // 컴퓨터 프로그램만: 쓰던 폴더를 다른 곳으로 바꾼다(비어 있으면 내용 복사).
  changeFolder?(): Promise<{ folder: string; mode: 'same' | 'existing' | 'copied' } | null>
  defaultFolder(): Promise<string>
  useFolder(path: string): Promise<string>
  readData(): Promise<string | null>
  // merged: 폴더의 내용을 방금 읽어 합친 결과일 때 true(폰은 이때 겹친 data.json을 정리한다).
  writeData(json: string, merged?: boolean): Promise<void>
  writeFile(rel: string, data: ArrayBuffer): Promise<void>
  readFile(rel: string): Promise<ArrayBuffer | null>
  deleteFile(rel: string): Promise<void>
  openFolder(): Promise<void>
  // 폰만: 폴더에서 아직 안 받은 사진을 뒤에서 받아 둔다(진행은 archive:sync 이벤트로 알린다).
  prefetch?(rels: string[]): void
  // 폰만: 못 올린 사진·못 지운 사진을 다시 시도한다.
  retry?(): void
}

declare global {
  interface Window {
    archiveFs?: ArchiveFs
  }
}

// 다른 기기에서 바뀐 내용이 합쳐져 들어왔을 때 화면에 알린다(state.tsx가 다시 읽는다).
export const REMOTE_CHANGED = 'archive:remote-changed'

// 폴더에 못 올리고 폰에만 저장된 변경이 있는지 화면에 알린다(SyncBar가 "오프라인" 표시).
export const OFFLINE_EVENT = 'archive:offline'
let offlineNow = false
const setOffline = (value: boolean) => {
  if (value === offlineNow) return
  offlineNow = value
  window.dispatchEvent(new CustomEvent(OFFLINE_EVENT, { detail: value }))
}
export const isOffline = () => offlineNow

const photoPath = (p: PhotoMeta) => `photos/${p.id}.${p.ext}`
const thumbPath = (id: string) => `thumbs/${id}.webp`

export function createFolderStore(fs: ArchiveFs, folder: string): Store {
  let data: Snapshot = emptySnapshot()
  // 쓰기가 겹치지 않도록 한 줄로 세운다.
  let queue: Promise<void> = Promise.resolve()

  const readRemote = async (): Promise<Snapshot | null> => {
    const raw = await fs.readData()
    if (!raw) return null
    return normalizeSnapshot(JSON.parse(raw) as Partial<Snapshot>)
  }

  // 폰 안 사본: 드라이브에 연결되지 않을 때(오프라인)도 기록을 보고 고칠 수 있게 마지막 내용을 기기에 둔다.
  // pending이면 아직 폴더에 못 올린 변경이 있다는 뜻 → 다음에 연결되면 폴더 내용과 합쳐서 올린다.
  const cacheKey = `archive:cache:${folder}`
  const pendingKey = `archive:pending:${folder}`
  const saveCache = (pending: boolean) => {
    try {
      localStorage.setItem(cacheKey, JSON.stringify(data))
      if (pending) localStorage.setItem(pendingKey, '1')
      else localStorage.removeItem(pendingKey)
    } catch { /* 저장 공간이 없으면 사본 없이 동작 */ }
    setOffline(pending)
  }
  const readCache = (): Snapshot | null => {
    try {
      const raw = localStorage.getItem(cacheKey)
      return raw ? normalizeSnapshot(JSON.parse(raw) as Partial<Snapshot>) : null
    } catch { return null }
  }
  const hasPending = () => { try { return localStorage.getItem(pendingKey) === '1' } catch { return false } }

  // 폴더에 지금 있는 내용과 합친 뒤 저장한다. 다른 기기 것이 들어왔으면 화면에 알린다.
  // 폴더를 못 읽거나 못 쓰면(오프라인 등) 폴더는 건드리지 않고 폰 사본에만 저장해 둔다.
  // 못 읽은 채로 폴더에 쓰면 폴더의 기록을 덜 합친 내용으로 덮을 수 있다(E-01).
  const persist = () => {
    queue = queue.catch(() => {}).then(async () => {
      let remote: Snapshot | null
      try {
        remote = await readRemote()
      } catch (error) {
        console.warn('폴더를 읽지 못해 폰에만 저장', error)
        saveCache(true)
        return
      }
      if (remote) {
        const merged = mergeSnapshots(remote, data)
        const changed = differs(merged, data)
        data = merged
        if (changed) window.dispatchEvent(new Event(REMOTE_CHANGED))
      }
      try {
        await fs.writeData(JSON.stringify(data, null, 1), remote !== null)
      } catch (error) {
        console.warn('폴더에 쓰지 못해 폰에만 저장', error)
        saveCache(true)
        return
      }
      saveCache(false)
    })
    return queue
  }

  const touch = (list: ListName | 'meta', id: string) => {
    data.stamps = { ...data.stamps, [stampKey(list, id)]: Date.now() }
  }
  const remove = (list: ListName, id: string) => {
    data.deleted = { ...data.deleted, [stampKey(list, id)]: Date.now() }
  }

  // 폰: 목록에 있는 사진 중 아직 폰에 없는 것을 뒤에서 받아 둔다(작은 사본 먼저).
  const prefetch = () => {
    if (!fs.prefetch) return
    fs.prefetch([...data.photos.map((p) => thumbPath(p.id)), ...data.photos.map(photoPath)])
  }

  return {
    kind: 'folder',
    describe: () => folder,

    async load() {
      await queue.catch(() => {})
      const cached = readCache()
      let remote: Snapshot | null
      try {
        remote = await readRemote()
      } catch (error) {
        // 오프라인: 폰 사본으로 보여 준다. 사본도 없으면(처음 연결) 오류를 그대로 알린다.
        if (!cached) throw error
        console.warn('폴더를 읽지 못해 폰 사본으로 열기', error)
        data = cached
        setOffline(true)
        return structuredClone(data)
      }
      const pending = hasPending() && cached !== null
      if (remote) data = pending ? mergeSnapshots(remote, cached) : remote
      else if (pending) data = cached
      else data = emptySnapshot()
      // 못 올린 변경이 있었으면 지금 합쳐서 올린다.
      if (pending) await persist().catch(() => {})
      else saveCache(false)
      prefetch()
      return structuredClone(data)
    },

    async saveSeries(series) {
      data.series = [...data.series.filter((s) => s.id !== series.id), series]
      touch('series', series.id)
      await persist()
    },

    async deleteSeries(id) {
      data.series = data.series.filter((s) => s.id !== id)
      remove('series', id)
      data.entries = data.entries.map((e) => {
        const ids = categoriesOf(e)
        if (!ids.includes(id)) return e
        touch('entries', e.id)
        return withCategories(e, ids.filter((x) => x !== id))
      })
      await persist()
    },

    async saveTag(tag) {
      data.tags = [...(data.tags ?? []).filter((t) => t.id !== tag.id), tag]
      touch('tags', tag.id)
      await persist()
    },

    async deleteTag(id) {
      data.tags = (data.tags ?? []).filter((t) => t.id !== id)
      remove('tags', id)
      data.entries = data.entries.map((e) => {
        if (!e.tagIds?.includes(id)) return e
        touch('entries', e.id)
        return { ...e, tagIds: e.tagIds.filter((x) => x !== id) }
      })
      await persist()
    },

    async saveProject(project) {
      const list = data.projects ?? []
      const i = list.findIndex((p) => p.id === project.id)
      data.projects = i >= 0 ? list.map((p) => (p.id === project.id ? project : p)) : [...list, project]
      touch('projects', project.id)
      await persist()
    },

    async deleteProject(id) {
      data.projects = (data.projects ?? []).filter((p) => p.id !== id)
      remove('projects', id)
      for (const p of (data.placements ?? []).filter((p) => p.mapId === id)) remove('placements', p.id)
      data.placements = (data.placements ?? []).filter((p) => p.mapId !== id)
      await persist()
    },

    async savePlacement(placement) {
      data.placements = [...(data.placements ?? []).filter((p) => p.id !== placement.id), placement]
      touch('placements', placement.id)
      await persist()
    },

    async deletePlacements(mapId, entryIds) {
      const drop = (p: { mapId: string; entryId: string }) => p.mapId === mapId && (!entryIds || entryIds.includes(p.entryId))
      for (const p of (data.placements ?? []).filter(drop)) remove('placements', p.id)
      data.placements = (data.placements ?? []).filter((p) => !drop(p))
      await persist()
    },

    async saveEntry(entry) {
      const i = data.entries.findIndex((e) => e.id === entry.id)
      if (i >= 0) data.entries[i] = entry
      else data.entries.push(entry)
      touch('entries', entry.id)
      await persist()
    },

    async deleteEntry(entry) {
      const photo = data.photos.find((p) => p.id === entry.photoId)
      data.entries = data.entries.filter((e) => e.id !== entry.id)
      remove('entries', entry.id)
      for (const p of (data.placements ?? []).filter((p) => p.entryId === entry.id)) remove('placements', p.id)
      data.placements = (data.placements ?? []).filter((p) => p.entryId !== entry.id)
      data.photos = data.photos.filter((p) => p.id !== entry.photoId)
      remove('photos', entry.photoId)
      await persist()
      if (photo) {
        await fs.deleteFile(photoPath(photo))
        await fs.deleteFile(thumbPath(photo.id))
      }
    },

    async addPhoto(meta, full, thumb) {
      await fs.writeFile(photoPath(meta), await full.arrayBuffer())
      await fs.writeFile(thumbPath(meta.id), await thumb.arrayBuffer())
      data.photos = [...data.photos.filter((p) => p.id !== meta.id), meta]
      touch('photos', meta.id)
      await persist()
    },

    // 앱으로 돌아왔을 때 다른 기기에서 바뀐 게 있는지 본다(쓰지는 않는다).
    async refresh() {
      fs.retry?.()
      // 오프라인 동안 폰에만 저장한 게 있으면, 돌아왔을 때 합쳐서 올린다.
      if (hasPending()) {
        const before = JSON.stringify(data)
        await persist().catch(() => {})
        if (JSON.stringify(data) !== before) { prefetch(); window.dispatchEvent(new Event(REMOTE_CHANGED)) }
        return
      }
      queue = queue.catch(() => {}).then(async () => {
        const remote = await readRemote().catch(() => null)
        if (!remote) return
        const merged = mergeSnapshots(remote, data)
        if (!differs(merged, data)) return
        data = merged
        prefetch()
        window.dispatchEvent(new Event(REMOTE_CHANGED))
      })
      await queue
    },

    async readPhoto(id, kind) {
      const photo = data.photos.find((p) => p.id === id)
      if (!photo) return null
      const buf = await fs.readFile(kind === 'full' ? photoPath(photo) : thumbPath(id))
      if (!buf) return null
      return new Blob([buf], { type: kind === 'full' ? photo.type : 'image/webp' })
    },

    async getMeta(key) {
      return data.meta?.[key] ?? null
    },

    async setMeta(key, value) {
      data.meta = { ...data.meta, [key]: value }
      touch('meta', key)
      await persist()
    },
  }
}
