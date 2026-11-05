import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { forgetPhotoUrls, preparePhoto } from './data/photos'
import { applySettings, DEFAULT_SETTINGS, parseSettings, type Settings } from './data/settings'
import type { Store } from './data/store'
import { REMOTE_CHANGED } from './data/folderStore'
import { parseMapNotes, pruneMapNotes, type MapNotes } from './data/mapNotes'
import { groupKeyOf } from './components/mapLayout'
import {
  categoriesOf,
  MAIN_MAP,
  migrateTags,
  newId,
  normalizeProject,
  placementId,
  tagIdsOf,
  withCategories,
  type Entry,
  type ID,
  type PhotoMeta,
  type Placement,
  type Project,
  type ProjectNote,
  type Series,
  type Tag,
} from './data/types'

// 화면 이동: 홈 / 보관 화면(계열 갤러리 또는 사진 기록) / 프로젝트 보드(또는 그 안에서 연 사진 기록)
export type SeriesFilter = ID | 'all' | 'none'
export type View =
  | { screen: 'home' }
  | { screen: 'archive'; filter: SeriesFilter; entryId: ID | null }
  | { screen: 'project'; projectId: ID; entryId: ID | null }

// 보관 화면의 보기 방식(F-30). 데이터를 바꾸지 않는 선택 상태라 저장하지 않는다.
export type ViewMode = 'gallery' | 'map'

// 맵의 기준 태그(F-16): 순서대로 저장. 전체 맵 하나만 있어서 meta의 한 칸을 쓴다.
const MAP_BASE_KEY = 'map:main'
const parseMapBase = (raw: string | null): ID[] => {
  try {
    const v = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(v) ? v.filter((x): x is ID => typeof x === 'string') : []
  } catch {
    return []
  }
}

export const entriesFor = (entries: Entry[], filter: SeriesFilter) =>
  entries.filter((e) => {
    const ids = categoriesOf(e)
    return filter === 'all' ? true : filter === 'none' ? ids.length === 0 : ids.includes(filter)
  })

const SAVE_DELAY = 500

interface Archive {
  store: Store
  series: Series[]
  entries: Entry[]
  photos: Map<ID, PhotoMeta>
  view: View
  go(view: View): void
  // 넣은 사진마다 개별 기록이 생긴다. 카테고리(여러 개)·태그는 모든 사진에 똑같이 붙는다(묶음 저장).
  addPhotos(files: File[], categoryIds: ID[], onProgress?: (done: number) => void, tagIds?: ID[]): Promise<Entry[]>
  createSeries(name: string): Promise<Series>
  renameSeries(id: ID, name: string): Promise<void>
  deleteSeries(id: ID): Promise<void>
  tags: Tag[]
  createTag(name: string): Promise<Tag>
  renameTag(id: ID, name: string): Promise<void> // 이미 있는 이름이면 그 태그로 합친다
  deleteTag(id: ID): Promise<void>
  mode: ViewMode
  setMode(mode: ViewMode): void
  mapBase: Record<string, ID[]> // 화면별 기준 태그
  setMapBase(mapId: string, ids: ID[]): void
  mapNotes: MapNotes
  setMapNotes(mapId: string, notes: ProjectNote[]): void
  placements: Placement[] // 맵 위치 고정 (고정 없는 사진은 자동 배치)
  pinEntry(mapId: string, entryId: ID, x: number, y: number): Promise<void>
  clearPins(mapId: string): Promise<void> // 자동 정리: 그 맵의 고정 전부 풀기
  projects: Project[]
  createProject(name: string, entryIds?: ID[]): Promise<Project> // entryIds: 처음부터 담을 기록
  renameProject(id: ID, name: string): Promise<void>
  deleteProject(id: ID): Promise<void>
  updateProject(project: Project): void // 메모 글 같은 자잘한 수정: 잠깐 모아서 저장
  addToProject(projectId: ID, entryIds: ID[]): Promise<void> // 이미 담은 사진은 건너뜀
  removeFromProject(projectId: ID, entryId: ID | ID[]): Promise<void> // 참조만 뺀다. 사진·기록은 그대로
  editCategories(entryIds: ID[], add: ID[], remove: ID[]): Promise<void> // 여러 사진의 카테고리를 한꺼번에
  updateEntry(entry: Entry): void
  deleteEntry(id: ID): Promise<void>
  reload(): Promise<void>
  flush(): Promise<void>
  settings: Settings
  saveSettings(settings: Settings): Promise<void>
}

const Ctx = createContext<Archive | null>(null)

export function useArchive() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('ArchiveProvider 밖에서 사용됨')
  return ctx
}

export function ArchiveProvider({ store, children }: { store: Store; children: ReactNode }) {
  const [series, setSeries] = useState<Series[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [placements, setPlacements] = useState<Placement[]>([])
  const [mapBase, setMapBaseState] = useState<Record<string, ID[]>>({})
  const [mapNotes, setMapNotesState] = useState<MapNotes>({})
  const mapNotesRef = useRef<MapNotes>({})
  const notesTimer = useRef<number | undefined>(undefined)
  const notesPending = useRef(false)
  const [mode, setMode] = useState<ViewMode>('gallery')
  const [projects, setProjects] = useState<Project[]>([])
  const [entries, setEntries] = useState<Entry[]>([])
  const [photos, setPhotos] = useState<Map<ID, PhotoMeta>>(new Map())
  const [view, setView] = useState<View>({ screen: 'home' })
  const [loaded, setLoaded] = useState(false)
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const timers = useRef(new Map<ID, number>())
  const settingsTimer = useRef<number | undefined>(undefined)
  const pendingSettings = useRef<Settings | null>(null)

  useEffect(() => applySettings(settings), [settings])

  const writeMapNotes = useCallback((next: MapNotes) => {
    mapNotesRef.current = next
    setMapNotesState(next)
    notesPending.current = true
    window.clearTimeout(notesTimer.current)
    notesTimer.current = window.setTimeout(() => {
      notesPending.current = false
      void store.setMeta('map:notes', JSON.stringify(mapNotesRef.current))
    }, SAVE_DELAY)
  }, [store])

  useEffect(() => {
    if (loaded) void store.setMeta('map:bases', JSON.stringify(mapBase))
  }, [store, loaded, mapBase])

  // 읽기+변환을 한 줄로 세운다. 두 번이 겹치면 둘 다 "아직 안 바뀐" 데이터를 읽고 태그를 중복해서 만들게 된다.
  const reloadQueue = useRef<Promise<unknown>>(Promise.resolve())
  const reload = useCallback(() => {
    const run = reloadQueue.current.then(async () => {
      if (notesPending.current) {
        window.clearTimeout(notesTimer.current)
        await store.setMeta('map:notes', JSON.stringify(mapNotesRef.current))
        notesPending.current = false
      }
      const snap = await store.load()
      setSettings(parseSettings(snap.meta?.settings ?? null))
      // 예전 글자 태그를 태그 목록으로 바꾼다 (F-29). 목록을 먼저 저장해야 기록이 가리킬 곳이 있다.
      const migrated = migrateTags(snap.entries, snap.tags ?? [])
      for (const t of migrated.created) await store.saveTag(t)
      for (const e of migrated.changed) await store.saveEntry(e)
      setSeries(snap.series.sort((a, b) => a.order - b.order))
      setTags(migrated.tags.sort((a, b) => a.order - b.order))
      const positions = [...(snap.placements ?? [])]
      // 예전 공통 맵의 위치를 각 카테고리로 한 번만 복사한다.
      if (!snap.meta?.['map:bases']) {
        for (const filter of ['none', ...snap.series.map((s) => s.id)]) {
          const ids = new Set(entriesFor(migrated.entries, filter).map((e) => e.id))
          for (const old of (snap.placements ?? []).filter((p) => p.mapId === MAIN_MAP && ids.has(p.entryId))) {
            const mapId = `category:${filter}`
            const p = { ...old, mapId, id: placementId(mapId, old.entryId) }
            if (!positions.some((q) => q.id === p.id)) {
              await store.savePlacement(p)
              positions.push(p)
            }
          }
        }
      }
      setPlacements(positions)
      setProjects((snap.projects ?? []).map(normalizeProject).sort((a, b) => a.order - b.order))
      const legacyBase = parseMapBase(snap.meta?.[MAP_BASE_KEY] ?? null)
      const bases: Record<string, ID[]> = {}
      try {
        const raw = JSON.parse(snap.meta?.['map:bases'] ?? '{}') as Record<string, unknown>
        for (const [key, ids] of Object.entries(raw ?? {})) {
          if (Array.isArray(ids)) bases[key] = ids.filter((id): id is ID => typeof id === 'string')
        }
      } catch { /* 예전 백업은 공통 기준을 초기값으로 사용 */ }
      for (const key of [MAIN_MAP, 'category:none', ...snap.series.map((s) => `category:${s.id}`)]) {
        if (!Object.hasOwn(bases, key)) bases[key] = [...legacyBase]
      }
      setMapBaseState(bases)
      const notes = pruneMapNotes(parseMapNotes(snap.meta?.['map:notes']), migrated.entries)
      mapNotesRef.current = notes
      setMapNotesState(notes)
      setEntries(migrated.entries.sort((a, b) => b.createdAt - a.createdAt))
      setPhotos(new Map(snap.photos.map((p) => [p.id, p])))
      setLoaded(true)
    })
    reloadQueue.current = run.catch(() => {})
    return run
  }, [store])

  useEffect(() => {
    void reload()
  }, [reload])

  // 창을 닫기 전에 저장 대기 중인 것을 바로 저장한다.
  const pending = useRef(new Map<ID, Entry>())
  const pendingProjects = useRef(new Map<ID, Project>())
  const flush = useCallback(async () => {
      const writes: Promise<unknown>[] = []
      if (pendingSettings.current) {
        window.clearTimeout(settingsTimer.current)
        writes.push(store.setMeta('settings', JSON.stringify(pendingSettings.current)))
        pendingSettings.current = null
      }
      if (notesPending.current) {
        window.clearTimeout(notesTimer.current)
        notesPending.current = false
        writes.push(store.setMeta('map:notes', JSON.stringify(mapNotesRef.current)))
      }
      for (const [id, entry] of pending.current) {
        window.clearTimeout(timers.current.get(id))
        writes.push(store.saveEntry(entry))
      }
      pending.current.clear()
      for (const [id, project] of pendingProjects.current) {
        window.clearTimeout(timers.current.get(id))
        writes.push(store.saveProject(project))
      }
      pendingProjects.current.clear()
      await Promise.all(writes)
  }, [store])
  useEffect(() => {
    const save = () => { void flush() }
    const hide = () => { if (document.visibilityState === 'hidden') save() }
    window.addEventListener('beforeunload', save)
    window.addEventListener('archive:flush', save)
    document.addEventListener('visibilitychange', hide)
    return () => {
      window.removeEventListener('beforeunload', save)
      window.removeEventListener('archive:flush', save)
      document.removeEventListener('visibilitychange', hide)
    }
  }, [flush])

  // 같은 폴더를 다른 기기도 쓴다: 다른 기기에서 바뀐 게 합쳐지면 다시 읽고, 앱으로 돌아올 때 확인한다.
  useEffect(() => {
    if (!store.refresh) return
    let busy = false
    const onRemote = () => {
      if (busy) return
      busy = true
      void flush().then(reload).finally(() => { busy = false })
    }
    let last = 0
    const check = () => {
      if (document.visibilityState !== 'visible' || Date.now() - last < 5000) return
      last = Date.now()
      void store.refresh?.()
    }
    window.addEventListener(REMOTE_CHANGED, onRemote)
    window.addEventListener('focus', check)
    // 인터넷이 다시 연결되면 폰에만 저장해 둔 변경을 올린다.
    const online = () => { last = 0; check() }
    window.addEventListener('online', online)
    document.addEventListener('visibilitychange', check)
    return () => {
      window.removeEventListener(REMOTE_CHANGED, onRemote)
      window.removeEventListener('online', online)
      window.removeEventListener('focus', check)
      document.removeEventListener('visibilitychange', check)
    }
  }, [store, flush, reload])

  const value = useMemo<Archive>(() => {
    const addPhotos = async (files: File[], categoryIds: ID[], onProgress?: (done: number) => void, tagIds: ID[] = []) => {
      const created: Entry[] = []
      const newPhotos: PhotoMeta[] = []
      for (const file of files) {
        onProgress?.(created.length)
        const { meta, thumb } = await preparePhoto(file)
        await store.addPhoto(meta, file, thumb)
        const now = Date.now()
        const entry: Entry = {
          id: newId(),
          photoId: meta.id,
          seriesId: categoryIds[0] ?? null,
          seriesIds: [...categoryIds],
          createdAt: now,
          updatedAt: now,
          homeX: null,
          homeY: null,
          boardColor: '#ffffff',
          tagIds: [...tagIds],
          anchors: [],
          notes: [],
        }
        await store.saveEntry(entry)
        created.push(entry)
        newPhotos.push(meta)
      }
      setPhotos((prev) => new Map([...prev, ...newPhotos.map((p) => [p.id, p] as const)]))
      setEntries((prev) => [...created.slice().reverse(), ...prev])
      return created
    }

    const createSeries = async (name: string) => {
      const s: Series = {
        id: newId(),
        name: name.trim(),
        parentId: null,
        order: series.length ? Math.max(...series.map((x) => x.order)) + 1 : 0,
        createdAt: Date.now(),
      }
      await store.saveSeries(s)
      setSeries((prev) => [...prev, s])
      return s
    }

    const renameSeries = async (id: ID, name: string) => {
      const s = series.find((x) => x.id === id)
      if (!s) return
      const next = { ...s, name: name.trim() }
      await store.saveSeries(next)
      setSeries((prev) => prev.map((x) => (x.id === id ? next : x)))
    }

    const deleteSeries = async (id: ID) => {
      // 저장 대기 중인 옛 카테고리가 삭제 뒤 되살아나지 않게 먼저 반영한다.
      await flush()
      await store.deleteSeries(id)
      setSeries((prev) => prev.filter((x) => x.id !== id))
      const remaining = { ...mapNotesRef.current }
      delete remaining[`category:${id}`]
      writeMapNotes(pruneMapNotes(remaining, entries.map((e) => withCategories(e, categoriesOf(e).filter((c) => c !== id)))))
      await releasePins(`category:${id}`)
      setEntries((prev) =>
        prev.map((e) => {
          const ids = categoriesOf(e)
          return ids.includes(id) ? withCategories(e, ids.filter((x) => x !== id)) : e
        }),
      )
    }

    const lower = (s: string) => s.trim().toLowerCase()

    const createTag = async (name: string) => {
      const found = tags.find((t) => lower(t.name) === lower(name))
      if (found) return found
      const t: Tag = {
        id: newId(),
        name: name.trim(),
        order: tags.length ? Math.max(...tags.map((x) => x.order)) + 1 : 0,
        createdAt: Date.now(),
      }
      await store.saveTag(t)
      setTags((prev) => [...prev, t])
      return t
    }

    // 맵 위치 고정 (F-31). 고정한 사진은 자동 배치 대신 그 자리에 놓인다.
    const pinEntry = async (mapId: string, entryId: ID, x: number, y: number) => {
      const p: Placement = { id: placementId(mapId, entryId), mapId, entryId, x, y }
      setPlacements((prev) => [...prev.filter((q) => q.id !== p.id), p])
      await store.savePlacement(p)
    }

    // entryIds를 빼면 그 맵의 고정 전부(자동 정리)
    const releasePins = async (mapId: string, entryIds?: ID[]) => {
      setPlacements((prev) => prev.filter((p) => p.mapId !== mapId || (entryIds && !entryIds.includes(p.entryId))))
      await store.deletePlacements(mapId, entryIds)
    }

    // 태그가 바뀌어 맵에서 속한 묶음이 달라졌으면 그 사진의 고정을 푼다. 안 풀면 "makeup" 태그를 뺐는데도
    // makeup 묶음 자리에 남는 모순이 생긴다. 묶음이 그대로면(관계없는 태그를 더하는 등) 고정을 유지한다.
    const releaseIfRegrouped = (before: Entry, after: Entry) => {
      const known = new Set(tags.map((t) => t.id))
      for (const p of placements.filter((p) => p.entryId === after.id)) {
        const base = (mapBase[p.mapId] ?? []).filter((id) => known.has(id))
        if (groupKeyOf(before, base) !== groupKeyOf(after, base)) void releasePins(p.mapId, [after.id])
      }
    }

    // ---- 프로젝트 (F-33) ----
    // 화면엔 바로 반영하고, immediate가 아니면 저장은 잠깐 모아서 한다(메모 글 쓰는 중에 계속 저장하지 않게).
    const writeProject = (p: Project, immediate: boolean) => {
      setProjects((prev) => prev.map((x) => (x.id === p.id ? p : x)))
      window.clearTimeout(timers.current.get(p.id))
      if (immediate) {
        pendingProjects.current.delete(p.id)
        return store.saveProject(p)
      }
      pendingProjects.current.set(p.id, p)
      timers.current.set(
        p.id,
        window.setTimeout(() => {
          pendingProjects.current.delete(p.id)
          void store.saveProject(p)
        }, SAVE_DELAY),
      )
      return Promise.resolve()
    }

    // 처음부터 담을 사진을 넘길 수 있다(방금 만든 프로젝트는 아직 화면 상태에 없어서 만든 직후 addToProject로는 못 담는다)
    const createProject = async (name: string, entryIds: ID[] = []) => {
      const p: Project = {
        id: newId(),
        name: name.trim(),
        order: projects.length ? Math.max(...projects.map((x) => x.order)) + 1 : 0,
        createdAt: Date.now(),
        entryIds: [...new Set(entryIds)],
        notes: [],
      }
      await store.saveProject(p)
      setProjects((prev) => [...prev, p])
      return p
    }

    const renameProject = async (id: ID, name: string) => {
      const p = projects.find((x) => x.id === id)
      if (p) await writeProject({ ...p, name: name.trim() }, true)
    }

    const deleteProject = async (id: ID) => {
      window.clearTimeout(timers.current.get(id))
      pendingProjects.current.delete(id)
      await store.deleteProject(id)
      setProjects((prev) => prev.filter((x) => x.id !== id))
      setPlacements((prev) => prev.filter((pl) => pl.mapId !== id))
    }

    // 새로 담은 사진은 격자의 다음 빈 자리에 놓는다. 이미 담았거나 없는 기록은 건너뛴다.
    const addToProject = async (projectId: ID, entryIds: ID[]) => {
      const p = projects.find((x) => x.id === projectId)
      if (!p) return
      const have = new Set(p.entryIds)
      const fresh = [...new Set(entryIds)].filter((id) => !have.has(id) && entries.some((e) => e.id === id))
      if (fresh.length === 0) return
      await writeProject({ ...p, entryIds: [...p.entryIds, ...fresh] }, true)
    }

    // 여러 장을 한 번에 뺀다. 한 장씩 따로 부르면 서로의 결과를 덮어쓰므로 묶어서 처리한다.
    const removeFromProject = async (projectId: ID, entryId: ID | ID[]) => {
      const p = projects.find((x) => x.id === projectId)
      if (!p) return
      const gone = new Set(Array.isArray(entryId) ? entryId : [entryId])
      await writeProject(
        {
          ...p,
          entryIds: p.entryIds.filter((id) => !gone.has(id)),
          notes: p.notes.map((n) => (n.entryIds.some((x) => gone.has(x)) ? { ...n, entryIds: n.entryIds.filter((x) => !gone.has(x)) } : n)),
        },
        true,
      )
      await releasePins(projectId, [...gone])
    }

    // 여러 사진의 카테고리를 한꺼번에 더하고 뺀다 (선택 창). 저장 대기 중이던 옛 내용이 되살아나지 않게 대기를 비운다.
    const editCategories = async (entryIds: ID[], add: ID[], remove: ID[]) => {
      const target = new Set(entryIds)
      const drop = new Set(remove)
      const changed = entries
        .filter((e) => target.has(e.id))
        .map((e) => withCategories({ ...e, updatedAt: Date.now() }, [...new Set([...categoriesOf(e), ...add])].filter((id) => !drop.has(id))))
      for (const e of changed) {
        window.clearTimeout(timers.current.get(e.id))
        pending.current.delete(e.id)
        await store.saveEntry(e)
      }
      const byId = new Map(changed.map((e) => [e.id, e]))
      setEntries((prev) => prev.map((e) => byId.get(e.id) ?? e))
      writeMapNotes(pruneMapNotes(mapNotesRef.current, entries.map((e) => byId.get(e.id) ?? e)))
    }

    // 태그를 쓰는 기록을 한꺼번에 고쳐 저장한다. 저장 대기 중이던 옛 내용이 되살아나지 않게 대기를 비운다.
    const rewriteTagged = async (tagId: ID, fn: (ids: ID[]) => ID[]) => {
      const before = entries.filter((e) => tagIdsOf(e).includes(tagId))
      const changed = before.map((e) => ({ ...e, tagIds: fn(tagIdsOf(e)), updatedAt: Date.now() }))
      for (const [i, e] of changed.entries()) {
        window.clearTimeout(timers.current.get(e.id))
        pending.current.delete(e.id)
        await store.saveEntry(e)
        releaseIfRegrouped(before[i], e)
      }
      const byId = new Map(changed.map((e) => [e.id, e]))
      setEntries((prev) => prev.map((e) => byId.get(e.id) ?? e))
    }

    const renameTag = async (id: ID, name: string) => {
      const t = tags.find((x) => x.id === id)
      if (!t) return
      const other = tags.find((x) => x.id !== id && lower(x.name) === lower(name))
      if (other) {
        await rewriteTagged(id, (ids) => [...new Set(ids.map((x) => (x === id ? other.id : x)))])
        await store.deleteTag(id)
        setTags((prev) => prev.filter((x) => x.id !== id))
        for (const [key, base] of Object.entries(mapBase)) {
          if (base.includes(id)) setMapBase(key, [...new Set(base.map((x) => x === id ? other.id : x))])
        }
        return
      }
      const next = { ...t, name: name.trim() }
      await store.saveTag(next)
      setTags((prev) => prev.map((x) => (x.id === id ? next : x)))
    }

    const deleteTag = async (id: ID) => {
      await rewriteTagged(id, (ids) => ids.filter((x) => x !== id))
      await store.deleteTag(id)
      setTags((prev) => prev.filter((x) => x.id !== id))
      for (const [key, base] of Object.entries(mapBase)) {
        if (base.includes(id)) setMapBase(key, base.filter((x) => x !== id))
      }
    }

    const setMapBase = (mapId: string, ids: ID[]) => {
      setMapBaseState((prev) => ({ ...prev, [mapId]: ids }))
    }

    const updateEntry = (entry: Entry) => {
      const next = { ...entry, updatedAt: Date.now() }
      const prev = entries.find((e) => e.id === entry.id)
      if (prev && categoriesOf(prev).join() !== categoriesOf(next).join()) {
        writeMapNotes(pruneMapNotes(mapNotesRef.current, entries.map((e) => e.id === next.id ? next : e)))
      }
      if (prev && prev.tagIds !== next.tagIds) releaseIfRegrouped(prev, next)
      setEntries((prev) => prev.map((e) => (e.id === next.id ? next : e)))
      pending.current.set(next.id, next)
      window.clearTimeout(timers.current.get(next.id))
      timers.current.set(
        next.id,
        window.setTimeout(() => {
          pending.current.delete(next.id)
          void store.saveEntry(next)
        }, SAVE_DELAY),
      )
    }

    const deleteEntry = async (id: ID) => {
      const entry = entries.find((e) => e.id === id)
      if (!entry) return
      window.clearTimeout(timers.current.get(id))
      pending.current.delete(id)
      await store.deleteEntry(entry)
      forgetPhotoUrls(entry.photoId)
      setEntries((prev) => prev.filter((e) => e.id !== id))
      writeMapNotes(pruneMapNotes(mapNotesRef.current, entries.filter((e) => e.id !== id)))
      setPlacements((prev) => prev.filter((p) => p.entryId !== id))
      // 프로젝트에 담겨 있었다면 거기서도 뺀다 (메모 연결도 끊는다)
      for (const p of projects) {
        if (!p.entryIds.includes(id) && !p.notes.some((n) => n.entryIds.includes(id))) continue
        void writeProject(
          {
            ...p,
            entryIds: p.entryIds.filter((x) => x !== id),
            notes: p.notes.map((n) => (n.entryIds.includes(id) ? { ...n, entryIds: n.entryIds.filter((x) => x !== id) } : n)),
          },
          true,
        )
      }
      setPhotos((prev) => {
        const next = new Map(prev)
        next.delete(entry.photoId)
        return next
      })
    }

    // 색 고르기 창을 끄는 동안 계속 바뀌므로, 화면엔 바로 반영하고 저장은 잠깐 모아서 한다.
    const saveSettings = async (next: Settings) => {
      setSettings(next)
      pendingSettings.current = next
      window.clearTimeout(settingsTimer.current)
      settingsTimer.current = window.setTimeout(() => {
        pendingSettings.current = null
        void store.setMeta('settings', JSON.stringify(next))
      }, SAVE_DELAY)
    }

    return {
      store,
      settings,
      saveSettings,
      series,
      entries,
      photos,
      view,
      go: setView,
      addPhotos,
      createSeries,
      renameSeries,
      deleteSeries,
      tags,
      createTag,
      renameTag,
      deleteTag,
      mode,
      setMode,
      mapBase,
      setMapBase,
      mapNotes,
      setMapNotes: (mapId, notes) => writeMapNotes({ ...mapNotesRef.current, [mapId]: notes }),
      placements,
      pinEntry,
      clearPins: (mapId: string) => releasePins(mapId),
      projects,
      createProject,
      renameProject,
      deleteProject,
      updateProject: (p: Project) => void writeProject(p, false),
      addToProject,
      removeFromProject,
      editCategories,
      updateEntry,
      deleteEntry,
      reload,
      flush,
    }
  }, [store, series, tags, entries, photos, view, reload, settings, mode, mapBase, placements, projects, mapNotes, writeMapNotes, flush])

  if (!loaded) return <div className="loading">aRcHivE</div>
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

// 태그별 사진 수 (태그 관리 창용)
export function useTagCounts() {
  const { entries } = useArchive()
  return useMemo(() => {
    const counts = new Map<ID, number>()
    for (const e of entries) for (const id of tagIdsOf(e)) counts.set(id, (counts.get(id) ?? 0) + 1)
    return counts
  }, [entries])
}

// 계열별 사진 수 (상위 12개 메뉴, 왼쪽 리스트 개수 표시용)
export function useSeriesCounts() {
  const { entries } = useArchive()
  return useMemo(() => {
    const counts = new Map<ID | null, number>()
    for (const e of entries) {
      const ids = categoriesOf(e)
      if (ids.length === 0) counts.set(null, (counts.get(null) ?? 0) + 1)
      for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1)
    }
    return counts
  }, [entries])
}
