import Dexie, { type Table } from 'dexie'
import type { Store } from './store'
import {
  categoriesOf,
  withCategories,
  type Entry,
  type PhotoMeta,
  type Placement,
  type Project,
  type Series,
  type Tag,
} from './types'

// 웹 미리보기용 저장. 크롬 기록 삭제에 취약하므로 중요한 사진은 넣지 않는다(규칙).

type PhotoRow = PhotoMeta & { full: Blob; thumb: Blob }

class ArchiveDB extends Dexie {
  series!: Table<Series, string>
  tags!: Table<Tag, string>
  placements!: Table<Placement, string>
  projects!: Table<Project, string>
  entries!: Table<Entry, string>
  photos!: Table<PhotoRow, string>
  meta!: Table<{ key: string; value: string }, string>

  constructor() {
    super('aRcHivE')
    this.version(1).stores({ series: 'id', entries: 'id, seriesId', photos: 'id', meta: 'key' })
    this.version(2).stores({ tags: 'id' })
    this.version(3).stores({ placements: 'id, mapId, entryId' })
    this.version(4).stores({ projects: 'id' })
  }
}

export function createBrowserStore(): Store {
  const db = new ArchiveDB()
  let persistAsked = false

  return {
    kind: 'browser',
    describe: () => '이 브라우저 안 (웹 미리보기용)',

    async load() {
      const [series, tags, placements, projects, entries, rows, metaRows] = await Promise.all([
        db.series.toArray(),
        db.tags.toArray(),
        db.placements.toArray(),
        db.projects.toArray(),
        db.entries.toArray(),
        db.photos.toArray(),
        db.meta.toArray(),
      ])
      const photos = rows.map(({ full: _f, thumb: _t, ...meta }) => meta)
      const meta = Object.fromEntries(metaRows.map((m) => [m.key, m.value]))
      return { version: 1, series, tags, placements, projects, entries, photos, meta }
    },

    async saveProject(project) {
      await db.projects.put(project)
    },

    async deleteProject(id) {
      await db.transaction('rw', db.projects, db.placements, async () => {
        await db.projects.delete(id)
        await db.placements.where('mapId').equals(id).delete()
      })
    },

    async savePlacement(placement) {
      await db.placements.put(placement)
    },

    async deletePlacements(mapId, entryIds) {
      const rows = db.placements.where('mapId').equals(mapId)
      if (entryIds) await rows.filter((p) => entryIds.includes(p.entryId)).delete()
      else await rows.delete()
    },

    async saveTag(tag) {
      await db.tags.put(tag)
    },

    async deleteTag(id) {
      await db.transaction('rw', db.tags, db.entries, async () => {
        await db.tags.delete(id)
        await db.entries.toCollection().modify((e) => {
          if (e.tagIds?.includes(id)) e.tagIds = e.tagIds.filter((x) => x !== id)
        })
      })
    },

    async saveSeries(series) {
      await db.series.put(series)
    },

    async deleteSeries(id) {
      await db.transaction('rw', db.series, db.entries, async () => {
        await db.series.delete(id)
        await db.entries.toCollection().modify((e) => {
          const ids = categoriesOf(e)
          if (ids.includes(id)) Object.assign(e, withCategories(e, ids.filter((x) => x !== id)))
        })
      })
    },

    async saveEntry(entry) {
      await db.entries.put(entry)
    },

    async deleteEntry(entry) {
      await db.transaction('rw', db.entries, db.photos, db.placements, async () => {
        await db.placements.where('entryId').equals(entry.id).delete()
        await db.entries.delete(entry.id)
        await db.photos.delete(entry.photoId)
      })
    },

    async addPhoto(meta, full, thumb) {
      await db.photos.put({ ...meta, full, thumb })
      if (!persistAsked && navigator.storage?.persist) {
        persistAsked = true
        const granted = await navigator.storage.persist()
        await db.meta.put({ key: 'persist', value: granted ? 'granted' : 'denied' })
      }
    },

    async readPhoto(id, kind) {
      const row = await db.photos.get(id)
      return row ? row[kind] : null
    },

    async getMeta(key) {
      return (await db.meta.get(key))?.value ?? null
    },

    async setMeta(key, value) {
      await db.meta.put({ key, value })
    },
  }
}
