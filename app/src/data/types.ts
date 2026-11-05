// 기록 데이터 모양. 좌표 단위는 모두 "사진 가로 길이 = 1" 기준 비율이다.
// (사진을 옮기거나 확대해도 지목·메모가 같은 자리에 붙어 있게 하기 위함)

export type ID = string

export interface Series {
  id: ID
  name: string
  parentId: ID | null // F-17 하위 계열 대비. 지금은 항상 null
  order: number
  createdAt: number
}

// F-29 태그 목록. 사진은 목록의 태그 id를 가리킨다(이름을 바꿔도 묶음이 안 끊김).
export interface Tag {
  id: ID
  name: string
  order: number
  createdAt: number
}

// F-31 맵 위치 고정. 위치는 기록(Entry)이 아니라 "어느 맵의 어느 기록"별로 따로 저장한다.
// 전체 맵은 mapId = MAIN_MAP, 프로젝트(F-33)는 프로젝트 id를 쓴다. 고정이 없는 사진은 자동 배치를 따른다.
export const MAIN_MAP = 'main'

export interface Placement {
  id: string // `${mapId}:${entryId}`
  mapId: string
  entryId: ID
  x: number // 사진 가운데 좌표 (맵 기준 px, 맵 화면 배율 1일 때)
  y: number
}

export const placementId = (mapId: string, entryId: ID) => `${mapId}:${entryId}`

// F-33 프로젝트 보드. 사용자가 직접 고른 사진(기록을 참조, 복사 안 함)과 프로젝트 안 메모를 담는다.
// 사진 위치는 Placement(mapId = 프로젝트 id)에 따로 저장한다.
export interface ProjectNote {
  id: ID
  text: string
  x: number // 메모 왼쪽 위 (프로젝트 보드 기준 px)
  y: number
  w: number
  h?: number
  color?: string // 예전 메모는 흰색
  entryIds: ID[] // 이 사진들과 선으로 연결 (하나의 메모에 여러 장)
  entryId?: ID | null // 예전: 하나만 연결. 읽을 때 entryIds로 바꾼다(normalizeProject)
}

export interface Project {
  id: ID
  name: string
  order: number
  createdAt: number
  entryIds: ID[] // 담은 기록 (담은 순서)
  notes: ProjectNote[]
}

export type AnchorShape = 'circle' | 'rect'

export interface Anchor {
  id: ID
  shape: AnchorShape
  x: number
  y: number
  w: number
  h: number
}

export interface Note {
  id: ID
  text: string
  x: number
  y: number
  w: number
  h?: number | null // 사용자가 위아래로 늘린 최소 높이(F-24). 없으면 글 길이만큼
  color: string
  order: number // F-09 문서로 뽑기 대비 순서
  anchorId: ID | null
  photoLinked?: boolean // 지목 없이 사진 자체와 연결
}

export interface Entry {
  id: ID
  photoId: ID
  seriesId: ID | null // 첫 번째 카테고리(예전 데이터·백업 호환용). 실제 목록은 seriesIds
  seriesIds?: ID[] // F-28 카테고리 여러 개
  createdAt: number
  updatedAt: number
  homeX: number | null // F-16 자유 모음 대비. 지금은 항상 null
  homeY: number | null
  boardColor: string // 예전 기록별 배경색. 지금은 설정의 사진 영역 배경색을 쓴다
  tagIds?: ID[] // F-29 태그 목록의 id
  tags?: string[] // 예전 글자 태그(F-25). 켤 때 목록으로 바꾸고 비운다
  anchors: Anchor[]
  notes: Note[]
}

export interface PhotoMeta {
  id: ID
  name: string
  type: string
  ext: string
  width: number
  height: number
  createdAt: number
}

export interface Snapshot {
  version: 1
  series: Series[]
  entries: Entry[]
  photos: PhotoMeta[]
  tags?: Tag[] // 예전 데이터·백업에는 없음
  placements?: Placement[] // 예전 데이터·백업에는 없음
  projects?: Project[] // 예전 데이터·백업에는 없음
  meta?: Record<string, string>
}

export type PhotoKind = 'full' | 'thumb'

// 기록의 카테고리 목록. 예전 데이터(seriesId 하나)도 함께 읽는다.
export const categoriesOf = (e: Entry): ID[] => e.seriesIds ?? (e.seriesId ? [e.seriesId] : [])

export const withCategories = (e: Entry, ids: ID[]): Entry => ({ ...e, seriesIds: ids, seriesId: ids[0] ?? null })

// 예전 데이터(메모 하나에 사진 하나: entryId)를 여러 장(entryIds)으로 바꿔 읽는다
export const normalizeProject = (p: Project): Project => ({
  ...p,
  notes: (p.notes ?? []).map((n) => {
    const { entryId, ...rest } = n
    return { ...rest, entryIds: n.entryIds ?? (entryId ? [entryId] : []) }
  }),
})

export const tagIdsOf =(e: Entry): ID[] => e.tagIds ?? []

// 예전 글자 태그(entry.tags)를 태그 목록으로 바꾼다. 같은 이름(앞뒤 공백·대소문자 무시)은 하나로 합친다.
// 전체 결과(tags, entries)와, 저장해야 할 것(created, changed)을 돌려준다. 바꿀 게 없으면 created·changed는 빈 배열.
export function migrateTags(
  entries: Entry[],
  tags: Tag[],
): { tags: Tag[]; entries: Entry[]; created: Tag[]; changed: Entry[] } {
  const key = (s: string) => s.trim().toLowerCase()
  const byName = new Map(tags.map((t) => [key(t.name), t]))
  const created: Tag[] = []
  let order = tags.length ? Math.max(...tags.map((t) => t.order)) + 1 : 0
  const changed: Entry[] = []

  const next = entries.map((e) => {
    if (!e.tags) return e
    const ids = [...tagIdsOf(e)]
    for (const name of e.tags) {
      if (!key(name)) continue
      let t = byName.get(key(name))
      if (!t) {
        t = { id: newId(), name: name.trim(), order: order++, createdAt: Date.now() }
        byName.set(key(name), t)
        created.push(t)
      }
      if (!ids.includes(t.id)) ids.push(t.id)
    }
    const { tags: _old, ...rest } = e
    const migrated: Entry = { ...rest, tagIds: ids }
    changed.push(migrated)
    return migrated
  })
  return { tags: [...tags, ...created], entries: next, created, changed }
}

export const newId =(): ID => crypto.randomUUID()

export const isId = (v: unknown): v is ID =>
  typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v)
