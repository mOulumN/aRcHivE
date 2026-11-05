import type { Snapshot } from './types'

// 같은 폴더를 두 기기(컴퓨터·폰)가 같이 쓸 때, data.json을 통째로 덮어쓰지 않고 항목별로 합친다.
// - 항목마다 마지막으로 고친 시각(stamps)을 비교해 더 최근 것을 남긴다. 같으면 지금 기기 것을 쓴다.
// - 지운 항목은 지운 시각(deleted)을 남겨, 그보다 오래된 사본이 다른 기기에서 되살아나지 않게 한다.
// - 시각이 없는 예전 데이터는 0으로 본다. 그래서 예전 데이터도 그대로 합쳐진다(따로 바꿀 필요 없음).

export const LISTS = ['series', 'tags', 'placements', 'projects', 'entries', 'photos'] as const
export type ListName = (typeof LISTS)[number]

export const stampKey = (list: ListName | 'meta', id: string) => `${list}:${id}`

const KEEP_DELETED = 180 * 24 * 60 * 60 * 1000 // 지운 표시는 180일 뒤 정리

type Item = { id: string }

export function emptySnapshot(): Snapshot {
  return { version: 1, series: [], tags: [], placements: [], projects: [], entries: [], photos: [], meta: {}, stamps: {}, deleted: {} }
}

export function normalizeSnapshot(parsed: Partial<Snapshot>): Snapshot {
  return {
    version: 1,
    series: parsed.series ?? [],
    tags: parsed.tags ?? [],
    placements: parsed.placements ?? [],
    projects: parsed.projects ?? [],
    entries: parsed.entries ?? [],
    photos: parsed.photos ?? [],
    meta: parsed.meta ?? {},
    stamps: parsed.stamps ?? {},
    deleted: parsed.deleted ?? {},
  }
}

const maxRecord = (a: Record<string, number>, b: Record<string, number>) => {
  const out = { ...a }
  for (const [k, v] of Object.entries(b)) out[k] = Math.max(out[k] ?? 0, v)
  return out
}

// remote = 폴더에 지금 있는 것, local = 이 기기가 쓰려는 것
export function mergeSnapshots(remote: Snapshot, local: Snapshot, now = Date.now()): Snapshot {
  const rs = remote.stamps ?? {}
  const ls = local.stamps ?? {}
  const deleted = maxRecord(remote.deleted ?? {}, local.deleted ?? {})
  for (const [k, t] of Object.entries(deleted)) if (now - t > KEEP_DELETED) delete deleted[k]
  const stamps = maxRecord(rs, ls)
  const gone = (key: string, stamp: number) => deleted[key] !== undefined && deleted[key] >= stamp

  const out = emptySnapshot()
  for (const list of LISTS) {
    const r = (remote[list] ?? []) as Item[]
    const l = (local[list] ?? []) as Item[]
    const byId = new Map<string, { item: Item; stamp: number }>()
    for (const item of r) byId.set(item.id, { item, stamp: rs[stampKey(list, item.id)] ?? 0 })
    for (const item of l) {
      const stamp = ls[stampKey(list, item.id)] ?? 0
      const prev = byId.get(item.id)
      if (!prev || stamp >= prev.stamp) byId.set(item.id, { item, stamp })
    }
    const kept: Item[] = []
    for (const [id, { item, stamp }] of byId) if (!gone(stampKey(list, id), stamp)) kept.push(item)
    ;(out[list] as Item[]) = kept
  }

  const meta: Record<string, string> = {}
  const rm = remote.meta ?? {}
  const lm = local.meta ?? {}
  for (const key of new Set([...Object.keys(rm), ...Object.keys(lm)])) {
    const k = stampKey('meta', key)
    const useLocal = key in lm && (!(key in rm) || (ls[k] ?? 0) >= (rs[k] ?? 0))
    meta[key] = useLocal ? lm[key] : rm[key]
  }
  out.meta = meta
  out.stamps = stamps
  out.deleted = deleted
  return out
}

// 합친 결과가 이 기기 내용과 다른지(다른 기기에서 바뀐 게 들어왔는지)
export function differs(a: Snapshot, b: Snapshot): boolean {
  const keyed = (items: Item[]) => new Map(items.map((i) => [i.id, JSON.stringify(i)]))
  for (const list of LISTS) {
    const x = keyed((a[list] ?? []) as Item[])
    const y = keyed((b[list] ?? []) as Item[])
    if (x.size !== y.size) return true
    for (const [id, json] of x) if (y.get(id) !== json) return true
  }
  const am = a.meta ?? {}
  const bm = b.meta ?? {}
  const keys = new Set([...Object.keys(am), ...Object.keys(bm)])
  for (const k of keys) if (am[k] !== bm[k]) return true
  return false
}
