import { categoriesOf, MAIN_MAP, type Entry, type ProjectNote } from './types'

export type MapNotes = Record<string, ProjectNote[]>

export function parseMapNotes(raw?: string | null): MapNotes {
  try {
    const data = JSON.parse(raw ?? '{}') as Record<string, unknown>
    return Object.fromEntries(Object.entries(data ?? {}).filter(([, notes]) => Array.isArray(notes)).map(([key, notes]) => [key,
      (notes as ProjectNote[]).filter((n) => n && typeof n.id === 'string' && typeof n.text === 'string'
        && Number.isFinite(n.x) && Number.isFinite(n.y) && Number.isFinite(n.w) && n.w > 0)
        .map((n) => ({ ...n, entryIds: Array.isArray(n.entryIds) ? n.entryIds.filter((id) => typeof id === 'string') : [] })),
    ]))
  } catch { return {} }
}

// 사진이 범위에서 빠져도 메모 글은 남기고 연결만 해제한다.
export function pruneMapNotes(notes: MapNotes, entries: Entry[]): MapNotes {
  const byId = new Map(entries.map((e) => [e.id, e]))
  return Object.fromEntries(Object.entries(notes).map(([scope, list]) => [scope, list.map((n) => ({
    ...n,
    entryIds: n.entryIds.filter((id) => {
      const entry = byId.get(id)
      if (!entry) return false
      if (scope === MAIN_MAP) return true
      const category = scope.slice('category:'.length)
      return scope.startsWith('category:') && (category === 'none' ? categoriesOf(entry).length === 0 : categoriesOf(entry).includes(category))
    }),
  }))]))
}
