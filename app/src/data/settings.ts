// 설정 (F-22): 사진 영역 배경색, 그 외 배경색, 테마 색, 즐겨찾기 색. 기기마다 따로 저장한다.
// 미리 정한 색 목록은 두지 않는다(규칙). 즐겨찾기는 사용자가 직접 추가한다.
// 즐겨찾기는 색을 고르는 곳(종류)마다 따로 둔다: 한 곳에서 추가한 색이 다른 곳 목록에 같이 생기지 않게.

export type ColorKind = 'boardBg' | 'pageBg' | 'accent' | 'note'
export const COLOR_KINDS: ColorKind[] = ['boardBg', 'pageBg', 'accent', 'note']

export interface Settings {
  boardBg: string
  pageBg: string
  accent: string
  noteFontSize: number
  favorites: Record<ColorKind, string[]>
}

export const DEFAULT_SETTINGS: Settings = {
  boardBg: '#ffffff',
  pageBg: '#ffffff',
  accent: '#fff068',
  noteFontSize: 14,
  favorites: { boardBg: [], pageBg: [], accent: [], note: [] },
}

export const isHex = (c: unknown): c is string => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c)

export function parseSettings(raw: string | null): Settings {
  if (!raw) return DEFAULT_SETTINGS
  try {
    const v = JSON.parse(raw) as Partial<Omit<Settings, 'favorites'>> & { favorites?: unknown }
    const ok = (c: unknown, d: string) => (isHex(c) ? c.toLowerCase() : d)
    const clean = (a: unknown): string[] => (Array.isArray(a) ? a.filter(isHex).map((c) => c.toLowerCase()) : [])
    // 예전 데이터는 즐겨찾기가 하나의 목록이었다 → 모든 종류에 똑같이 복사해 둔다(잃지 않게)
    const legacy = Array.isArray(v.favorites) ? clean(v.favorites) : null
    const byKind = (v.favorites ?? {}) as Partial<Record<ColorKind, unknown>>
    return {
      boardBg: ok(v.boardBg, DEFAULT_SETTINGS.boardBg),
      pageBg: ok(v.pageBg, DEFAULT_SETTINGS.pageBg),
      accent: ok(v.accent, DEFAULT_SETTINGS.accent),
      noteFontSize: typeof v.noteFontSize === 'number' && Number.isFinite(v.noteFontSize)
        ? Math.min(48, Math.max(8, v.noteFontSize)) : 14,
      favorites: {
        boardBg: legacy ?? clean(byKind.boardBg),
        pageBg: legacy ?? clean(byKind.pageBg),
        accent: legacy ?? clean(byKind.accent),
        note: legacy ?? clean(byKind.note),
      },
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

// 색이 어두우면 그 위 글자는 흰색, 밝으면 검정.
function inkOn(hex: string) {
  const n = parseInt(hex.slice(1), 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#111111' : '#ffffff'
}

export function applySettings(s: Settings) {
  const root = document.documentElement.style
  root.setProperty('--board-bg', s.boardBg)
  root.setProperty('--paper', s.pageBg)
  root.setProperty('--paper-ink', inkOn(s.pageBg))
  root.setProperty('--accent', s.accent)
  root.setProperty('--accent-ink', inkOn(s.accent))
}
