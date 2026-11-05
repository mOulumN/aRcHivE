import { unzipSync, zipSync, strToU8, strFromU8, type Zippable } from 'fflate'
import type { Store } from './store'
import { parseMapNotes, pruneMapNotes } from './mapNotes'
import { saveAndroidBackup } from './android'
import { isId, MAIN_MAP, normalizeProject, type Snapshot } from './types'

// 백업 파일(.zip) 안 모양:
//   data.json, photos/<id>.<확장자>, thumbs/<id>.webp
// data.json의 meta에는 옮겨 갈 설정만 넣는다: 색·즐겨찾기(settings), 맵 기준 태그(map:main).
// (마지막 백업 날짜, 영구 저장 여부 같은 기기별 값은 넣지 않는다)

const PORTABLE_META = ['settings', 'map:main', 'map:bases', 'map:notes']

export async function exportBackup(store: Store): Promise<Blob> {
  const snap = await store.load()
  const meta = Object.fromEntries(PORTABLE_META.filter((k) => snap.meta?.[k]).map((k) => [k, snap.meta![k]]))
  const files: Zippable = { 'data.json': strToU8(JSON.stringify({ ...snap, meta }, null, 1)) }
  for (const p of snap.photos) {
    const full = await store.readPhoto(p.id, 'full')
    const thumb = await store.readPhoto(p.id, 'thumb')
    if (full) files[`photos/${p.id}.${p.ext}`] = new Uint8Array(await full.arrayBuffer())
    if (thumb) files[`thumbs/${p.id}.webp`] = new Uint8Array(await thumb.arrayBuffer())
  }
  // 사진은 이미 압축된 파일이라 다시 압축하지 않는다(level 0).
  const zipped = zipSync(files, { level: 0 })
  return new Blob([zipped as Uint8Array<ArrayBuffer>], { type: 'application/zip' })
}

export interface ImportResult {
  added: number
  skipped: number
}

// 이미 있는 기록(같은 id)은 건너뛰고, 없는 것만 더한다. 덮어쓰지 않는다.
export async function importBackup(store: Store, file: Blob): Promise<ImportResult> {
  const files = unzipSync(new Uint8Array(await file.arrayBuffer()))
  const raw = files['data.json']
  if (!raw) throw new Error('aRcHivE 백업 파일이 아니에요 (data.json 없음)')
  const incoming = JSON.parse(strFromU8(raw)) as Snapshot
  const current = await store.load()

  const haveSeries = new Set(current.series.map((s) => s.id))
  const haveEntries = new Set(current.entries.map((e) => e.id))
  const havePhotos = new Set(current.photos.map((p) => p.id))

  for (const s of incoming.series ?? []) {
    if (isId(s.id) && !haveSeries.has(s.id)) await store.saveSeries(s)
  }
  // 설정: 이 기기에 아직 없는 것만 가져온다(지금 쓰는 색·기준 태그를 덮어쓰지 않는다)
  for (const k of PORTABLE_META) {
    if (k === 'map:notes') continue // 사진을 가져온 뒤 연결을 정리한다
    const v = incoming.meta?.[k]
    if (k === 'map:bases' && v && current.meta?.[k]) {
      try {
        const source = JSON.parse(v) as Record<string, unknown>
        const target = JSON.parse(current.meta[k]) as Record<string, unknown>
        const merged = Object.fromEntries(Object.entries({ ...source, ...target }).filter(([, ids]) => Array.isArray(ids) && ids.every((id) => typeof id === 'string')))
        await store.setMeta(k, JSON.stringify(merged))
      } catch { /* 손상된 기준 설정은 현재 설정을 유지 */ }
      continue
    }
    if (v && !current.meta?.[k]) await store.setMeta(k, v)
  }
  const haveTags = new Set((current.tags ?? []).map((t) => t.id))
  for (const t of incoming.tags ?? []) {
    if (isId(t.id) && !haveTags.has(t.id)) await store.saveTag(t)
  }

  let added = 0
  let skipped = 0
  const addedEntries: string[] = []
  for (const e of incoming.entries ?? []) {
    const photo = incoming.photos.find((p) => p.id === e.photoId)
    if (!isId(e.id) || !photo || !isId(photo.id) || haveEntries.has(e.id)) {
      skipped++
      continue
    }
    if (!havePhotos.has(photo.id)) {
      const full = files[`photos/${photo.id}.${photo.ext}`]
      const thumb = files[`thumbs/${photo.id}.webp`]
      if (!full || !thumb) {
        skipped++
        continue
      }
      await store.addPhoto(
        photo,
        new Blob([full as Uint8Array<ArrayBuffer>], { type: photo.type }),
        new Blob([thumb as Uint8Array<ArrayBuffer>], { type: 'image/webp' }),
      )
    }
    await store.saveEntry(e)
    for (const p of incoming.placements ?? []) {
      if (p.entryId === e.id && (p.mapId === MAIN_MAP || p.mapId.startsWith('category:'))) await store.savePlacement(p) // 프로젝트 위치는 아래에서 프로젝트와 함께
    }
    addedEntries.push(e.id)
    added++
  }

  // 프로젝트: 이미 있는 건 건너뛴다. 담은 기록은 지금 있는 것만 남기고, 그 프로젝트의 사진 위치도 함께 가져온다.
  const haveProjects = new Set((current.projects ?? []).map((p) => p.id))
  const entryIds = new Set([...haveEntries, ...addedEntries])
  for (const p of incoming.projects ?? []) {
    if (!isId(p.id) || haveProjects.has(p.id)) continue
    const norm = normalizeProject(p) // 예전 백업(메모 하나에 사진 하나)도 읽는다
    await store.saveProject({
      ...norm,
      entryIds: (norm.entryIds ?? []).filter((id) => entryIds.has(id)),
      notes: norm.notes.map((n) => ({ ...n, entryIds: n.entryIds.filter((id) => entryIds.has(id)) })),
    })
    for (const pl of incoming.placements ?? []) {
      if (pl.mapId === p.id && entryIds.has(pl.entryId)) await store.savePlacement(pl)
    }
  }
  if (incoming.meta?.['map:notes']) {
    const restored = await store.load()
    const notes = pruneMapNotes(parseMapNotes(incoming.meta['map:notes']), restored.entries)
    await store.setMeta('map:notes', JSON.stringify({ ...notes, ...parseMapNotes(current.meta?.['map:notes']) }))
  }
  return { added, skipped }
}

export async function downloadBlob(blob: Blob, name: string): Promise<boolean> {
  if (window.archiveAndroid) return saveAndroidBackup(blob, name)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return true
}
