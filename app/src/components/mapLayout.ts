import { tagIdsOf, type Entry, type ID, type PhotoMeta, type Tag } from '../data/types'

// 맵 자동 배치 (F-16). 화면과 분리된 계산만 한다.
//  - 사진은 맵에 한 곳에만: 자기 태그 중 기준 목록에서 가장 앞선 태그의 묶음으로 간다. 해당 없으면 "기타".
//  - 기준이 하나도 없으면 묶음 없이 한 덩어리로 놓는다(이름표 없음).
//  - 묶음 안은 가운데에서 바깥으로 나선형으로 겹치게 놓고, 묶음끼리는 겹치지 않게 줄지어 놓는다.
//  - 고정 위치(F-31)가 있는 사진은 그 자리에 놓고, 묶음 배치에서는 뺀다.
//  - 같은 입력이면 항상 같은 결과다(사진 순서·기준 순서로만 정해진다).

export const THUMB = 112 // 사진 긴 변
const GAP = 64 // 묶음 사이 여백
const MARGIN = 72 // 맵 바깥 여백
const ROW_MAX = 1100 // 묶음을 한 줄에 놓는 최대 폭
const GOLDEN = 2.399963 // 나선 각도(라디안)
export const REST_KEY = 'rest'

// 사진이 속하는 묶음: 자기 태그 중 기준 목록에서 가장 앞선 태그. 없으면 기타, 기준이 비면 한 덩어리.
// 위치 고정이 풀려야 하는지(묶음이 바뀌었는지) 판단할 때도 쓴다.
export function groupKeyOf(e: Entry, base: ID[]): string {
  if (base.length === 0) return 'all'
  const own = tagIdsOf(e)
  return base.find((id) => own.includes(id)) ?? REST_KEY
}

export interface MapItem {
  entryId: ID
  photoId: ID
  x: number // 맵 화면 기준 왼쪽 위
  y: number
  w: number
  h: number
  z: number
  pinned: boolean
}

export interface MapLabel {
  key: string
  text: string
  x: number
  y: number
}

export interface MapLayout {
  items: MapItem[]
  labels: MapLabel[]
  width: number
  height: number
  // 맵 화면 좌표 = 고정 저장 좌표 + origin (고정 위치 저장·읽기 때 변환)
  origin: { x: number; y: number }
}

interface Group {
  key: string
  text: string | null
  all: Entry[] // 묶음 전체. 나선 자리는 고정된 사진 몫도 남겨 둔다(고정해도 나머지가 안 움직이게)
  r: number
}

// 긴 변이 long이 되도록 사진 크기를 맞춘다 (맵·프로젝트 보드 공용)
export const fitSize = (photo: PhotoMeta | undefined, long: number) => {
  const ratio = photo && photo.width > 0 && photo.height > 0 ? photo.width / photo.height : 1
  return ratio >= 1 ? { w: long, h: long / ratio } : { w: long * ratio, h: long }
}

// long: 사진 긴 변(범위별로 다름). absolutePins: 고정 위치를 맵 원점 보정 없이 저장 좌표 그대로 쓴다(프로젝트).
export interface LayoutOptions {
  long?: number
  absolutePins?: boolean
}

export function computeLayout(
  entries: Entry[],
  tags: Tag[],
  baseIds: ID[],
  photos: Map<ID, PhotoMeta>,
  pins: Map<ID, { x: number; y: number }>,
  options: LayoutOptions = {},
): MapLayout {
  const long = options.long ?? THUMB
  const absolute = options.absolutePins ?? false
  const spiral = long * 0.8
  const sizeOf = (photo: PhotoMeta | undefined) => fitSize(photo, long)
  const tagName = new Map(tags.map((t) => [t.id, t.name]))
  const base = baseIds.filter((id) => tagName.has(id))

  // 묶음 나누기
  const groups = new Map<string, Group>()
  const order = [...base, REST_KEY, 'all']
  for (const e of entries) {
    const key = groupKeyOf(e, base)
    let g = groups.get(key)
    if (!g) {
      const text = key === 'all' ? null : key === REST_KEY ? '기타' : (tagName.get(key) ?? null)
      g = { key, text, all: [], r: 0 }
      groups.set(key, g)
    }
    g.all.push(e)
  }
  const list = order.map((k) => groups.get(k)).filter((g): g is Group => !!g)

  // 묶음 크기: 나선이 차지하는 반지름. 고정된 사진 자리도 포함해서, 고정·해제해도 묶음 배치가 그대로다.
  for (const g of list) g.r = spiral * Math.sqrt(Math.max(g.all.length - 1, 0)) + long * 0.75

  // 묶음을 줄지어 놓기
  const centers = new Map<string, { x: number; y: number }>()
  let cursorX = 0
  let cursorY = 0
  let rowH = 0
  for (const g of list) {
    const d = g.r * 2
    if (cursorX > 0 && cursorX + d > ROW_MAX) {
      cursorX = 0
      cursorY += rowH + GAP
      rowH = 0
    }
    centers.set(g.key, { x: cursorX + g.r, y: cursorY + g.r })
    cursorX += d + GAP
    rowH = Math.max(rowH, d)
  }

  // 사진 놓기
  const items: MapItem[] = []
  const labels: MapLabel[] = []
  const labelAt = new Map<string, { x: number; y: number; fixed: boolean }>()
  const total = entries.length

  for (const g of list) {
    const c = centers.get(g.key)
    g.all.forEach((e, i) => {
      if (pins.has(e.id)) return // 고정된 사진은 아래에서 제 자리에 놓는다. 나선 자리는 비워 둔다
      const { w, h } = sizeOf(photos.get(e.photoId))
      const r = spiral * Math.sqrt(i)
      const a = i * GOLDEN
      const cx = (c?.x ?? 0) + r * Math.cos(a)
      const cy = (c?.y ?? 0) + r * Math.sin(a)
      items.push({ entryId: e.id, photoId: e.photoId, x: cx - w / 2, y: cy - h / 2, w, h, z: total - i, pinned: false })
      if (!labelAt.has(g.key)) labelAt.set(g.key, { x: cx - w / 2, y: cy + h / 2, fixed: false }) // 고정 안 된 첫 사진에 이름표
    })
    for (const e of g.all) {
      const p = pins.get(e.id)
      if (!p) continue
      const { w, h } = sizeOf(photos.get(e.photoId))
      const px = absolute ? Math.max(0, p.x - w / 2) : p.x - w / 2
      const py = absolute ? Math.max(0, p.y - h / 2) : p.y - h / 2
      items.push({ entryId: e.id, photoId: e.photoId, x: px, y: py, w, h, z: total + 1, pinned: true })
      if (!labelAt.has(g.key)) labelAt.set(g.key, { x: px, y: py + h, fixed: true }) // 전부 고정이면 고정된 첫 사진에
    }
  }
  const labelFixed = new Set<string>()
  for (const g of list) {
    const at = labelAt.get(g.key)
    if (g.text && at) {
      labels.push({ key: g.key, text: g.text, x: at.x + 8, y: at.y - 14 })
      if (at.fixed) labelFixed.add(g.key)
    }
  }

  // 화면에 옮기는 값(원점). 자동 배치는 (0,0)부터 시작해 음수로 나가지 않으므로 기본은 바깥 여백(MARGIN)이다.
  // 고정 위치가 음수 쪽에 있을 때만 그만큼 더 옮긴다. 이 값이 자동 배치 결과와 상관없어야, 사진을 끌어 고정할 때
  // (묶음 모양이 바뀌어도) 놓은 자리에서 튀지 않는다.
  // absolutePins(프로젝트)는 고정 위치가 저장 좌표 그대로라 원점 보정을 받지 않는다(origin 0).
  const pinned = items.filter((i) => i.pinned)
  const dx = absolute ? MARGIN : MARGIN + Math.max(0, -Math.min(0, ...pinned.map((i) => i.x)))
  const dy = absolute ? MARGIN : MARGIN + Math.max(0, -Math.min(0, ...pinned.map((i) => i.y)))
  for (const i of items) {
    if (absolute && i.pinned) continue
    i.x += dx
    i.y += dy
  }
  for (const l of labels) {
    if (absolute && labelFixed.has(l.key)) continue
    l.x += dx
    l.y += dy
  }
  const right = items.length ? Math.max(...items.map((i) => i.x + i.w)) : 0
  const bottom = items.length ? Math.max(...items.map((i) => i.y + i.h + 14)) : 0
  const width = right + MARGIN + 80
  const height = bottom + MARGIN
  return { items, labels, width, height, origin: absolute ? { x: 0, y: 0 } : { x: dx, y: dy } }
}
