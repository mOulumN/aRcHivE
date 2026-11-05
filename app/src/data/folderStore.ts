import type { Store } from './store'
import { categoriesOf, withCategories, type PhotoMeta, type Snapshot } from './types'

// 컴퓨터 프로그램용 저장. 내가 고른 폴더 안에
//   data.json            기록·계열·메모 전부
//   photos/<id>.<확장자>  사진 원본
//   thumbs/<id>.webp      보관함용 작은 사본
// 으로 저장한다. 실제 파일 읽기/쓰기는 프로그램(electron/main.cjs)이 한다.

export interface ArchiveFs {
  getFolder(): Promise<string | null>
  chooseFolder(): Promise<string | null>
  defaultFolder(): Promise<string>
  useFolder(path: string): Promise<string>
  readData(): Promise<string | null>
  writeData(json: string): Promise<void>
  writeFile(rel: string, data: ArrayBuffer): Promise<void>
  readFile(rel: string): Promise<ArrayBuffer | null>
  deleteFile(rel: string): Promise<void>
  openFolder(): Promise<void>
}

declare global {
  interface Window {
    archiveFs?: ArchiveFs
  }
}

const photoPath = (p: PhotoMeta) => `photos/${p.id}.${p.ext}`
const thumbPath = (id: string) => `thumbs/${id}.webp`

export function createFolderStore(fs: ArchiveFs, folder: string): Store {
  let data: Snapshot = { version: 1, series: [], tags: [], placements: [], projects: [], entries: [], photos: [], meta: {} }
  // 쓰기가 겹치지 않도록 한 줄로 세운다.
  let queue: Promise<void> = Promise.resolve()
  const persist = () => {
    const json = JSON.stringify(data, null, 1)
    queue = queue.catch(() => {}).then(() => fs.writeData(json))
    return queue
  }

  return {
    kind: 'folder',
    describe: () => folder,

    async load() {
      await queue
      const raw = await fs.readData()
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<Snapshot>
        data = {
          version: 1,
          series: parsed.series ?? [],
          tags: parsed.tags ?? [],
          placements: parsed.placements ?? [],
          projects: parsed.projects ?? [],
          entries: parsed.entries ?? [],
          photos: parsed.photos ?? [],
          meta: parsed.meta ?? {},
        }
      }
      return structuredClone(data)
    },

    async saveSeries(series) {
      data.series = [...data.series.filter((s) => s.id !== series.id), series]
      await persist()
    },

    async deleteSeries(id) {
      data.series = data.series.filter((s) => s.id !== id)
      data.entries = data.entries.map((e) => {
        const ids = categoriesOf(e)
        return ids.includes(id) ? withCategories(e, ids.filter((x) => x !== id)) : e
      })
      await persist()
    },

    async saveTag(tag) {
      data.tags = [...(data.tags ?? []).filter((t) => t.id !== tag.id), tag]
      await persist()
    },

    async deleteTag(id) {
      data.tags = (data.tags ?? []).filter((t) => t.id !== id)
      data.entries = data.entries.map((e) => (e.tagIds?.includes(id) ? { ...e, tagIds: e.tagIds.filter((x) => x !== id) } : e))
      await persist()
    },

    async saveProject(project) {
      const list = data.projects ?? []
      const i = list.findIndex((p) => p.id === project.id)
      data.projects = i >= 0 ? list.map((p) => (p.id === project.id ? project : p)) : [...list, project]
      await persist()
    },

    async deleteProject(id) {
      data.projects = (data.projects ?? []).filter((p) => p.id !== id)
      data.placements = (data.placements ?? []).filter((p) => p.mapId !== id)
      await persist()
    },

    async savePlacement(placement) {
      data.placements = [...(data.placements ?? []).filter((p) => p.id !== placement.id), placement]
      await persist()
    },

    async deletePlacements(mapId, entryIds) {
      data.placements = (data.placements ?? []).filter((p) => p.mapId !== mapId || (entryIds && !entryIds.includes(p.entryId)))
      await persist()
    },

    async saveEntry(entry) {
      const i = data.entries.findIndex((e) => e.id === entry.id)
      if (i >= 0) data.entries[i] = entry
      else data.entries.push(entry)
      await persist()
    },

    async deleteEntry(entry) {
      const photo = data.photos.find((p) => p.id === entry.photoId)
      data.entries = data.entries.filter((e) => e.id !== entry.id)
      data.placements = (data.placements ?? []).filter((p) => p.entryId !== entry.id)
      data.photos = data.photos.filter((p) => p.id !== entry.photoId)
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
      await persist()
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
      await persist()
    },
  }
}
