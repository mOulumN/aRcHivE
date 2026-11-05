import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { isHex, type ColorKind } from '../data/settings'
import { useArchive } from '../state'

// 우리 디자인의 색 고르기 창 (규칙: 브라우저 기본 창 대신 이것을 쓴다)
// 위: 채도·밝기 사각형, 가운데: 색상 막대, 아래: 색 코드와 즐겨찾기

type HSV = { h: number; s: number; v: number }

function hexToHsv(hex: string): HSV {
  const n = parseInt(hex.slice(1), 16)
  const r = ((n >> 16) & 255) / 255
  const g = ((n >> 8) & 255) / 255
  const b = (n & 255) / 255
  const max = Math.max(r, g, b)
  const d = max - Math.min(r, g, b)
  let h = 0
  if (d) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h = (h * 60 + 360) % 360
  }
  return { h, s: max ? d / max : 0, v: max }
}

function hsvToHex({ h, s, v }: HSV) {
  const f = (k: number) => {
    const x = (k + h / 60) % 6
    return v - v * s * Math.max(0, Math.min(x, 4 - x, 1))
  }
  return `#${[f(5), f(3), f(1)].map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('')}`
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

export function ColorPicker({ value, onChange, kind }: { value: string; onChange(hex: string): void; kind: ColorKind }) {
  const { settings, saveSettings } = useArchive()
  const [hsv, setHsv] = useState<HSV>(() => hexToHsv(value))
  const [text, setText] = useState(value)
  const last = useRef(value)

  // 바깥에서 값이 바뀌면(즐겨찾기 클릭 등) 따라간다.
  useEffect(() => {
    if (value !== last.current) {
      last.current = value
      setHsv(hexToHsv(value))
      setText(value)
    }
  }, [value])

  const emit = (next: HSV) => {
    setHsv(next)
    const hex = hsvToHex(next)
    last.current = hex
    setText(hex)
    onChange(hex)
  }

  const dragOn = (el: HTMLElement, e: RPointerEvent, apply: (x: number, y: number) => void) => {
    try {
      el.setPointerCapture(e.pointerId)
    } catch {
      // 펜·터치 등에서 잡기에 실패해도 색은 바꾼다
    }
    const r = el.getBoundingClientRect()
    const move = (cx: number, cy: number) => apply(clamp01((cx - r.left) / r.width), clamp01((cy - r.top) / r.height))
    move(e.clientX, e.clientY)
    const onMove = (ev: PointerEvent) => move(ev.clientX, ev.clientY)
    const onUp = () => {
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
    }
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
  }

  // 즐겨찾기는 이 색을 고르는 곳(kind)의 목록에만 더하고 뺀다
  const list = settings.favorites[kind]
  const fav = list.includes(value.toLowerCase())
  const toggleFav = () =>
    void saveSettings({
      ...settings,
      favorites: {
        ...settings.favorites,
        [kind]: fav ? list.filter((c) => c !== value.toLowerCase()) : [...list, value.toLowerCase()],
      },
    })

  return (
    <div className="picker">
      <div
        className="picker-sv"
        style={{ background: `hsl(${hsv.h} 100% 50%)` }}
        onPointerDown={(e) => dragOn(e.currentTarget, e, (x, y) => emit({ ...hsv, s: x, v: 1 - y }))}
      >
        <span className="picker-dot" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }} />
      </div>
      <div className="picker-hue" onPointerDown={(e) => dragOn(e.currentTarget, e, (x) => emit({ ...hsv, h: x * 359.9 }))}>
        <span className="picker-bar" style={{ left: `${(hsv.h / 360) * 100}%` }} />
      </div>
      <div className="picker-row">
        <span className="swatch" style={{ background: value }} />
        <input
          className="text-input picker-hex"
          value={text}
          spellCheck={false}
          onChange={(e) => {
            const t = e.target.value.trim()
            setText(t)
            const hex = t.startsWith('#') ? t : `#${t}`
            if (isHex(hex)) {
              last.current = hex.toLowerCase()
              setHsv(hexToHsv(hex))
              onChange(hex.toLowerCase())
            }
          }}
        />
        <button className={`btn ghost picker-fav ${fav ? 'on' : ''}`} onClick={toggleFav}>
          {fav ? '★ 즐겨찾기' : '☆ 즐겨찾기'}
        </button>
      </div>
    </div>
  )
}

// 즐겨찾기 색 줄 + 지금 색 칸(누르면 색 고르기 창이 열림)
// floating: 설정 창처럼 창 옆에 걸친 별도 창으로 띄움. open/onToggle을 주면 바깥에서 하나만 열리게 조절.
export function ColorField({
  label,
  kind,
  value,
  onChange,
  open: openProp,
  onToggle,
  floating,
}: {
  label: string
  kind: ColorKind // 즐겨찾기를 따로 두는 색 종류
  value: string
  onChange(hex: string): void
  open?: boolean
  onToggle?(): void
  floating?: boolean
}) {
  const { settings } = useArchive()
  const [openSelf, setOpenSelf] = useState(false)
  const open = openProp ?? openSelf
  const setOpen = (fn: (o: boolean) => boolean) => (onToggle ? onToggle() : setOpenSelf(fn))
  return (
    <div className="color-field">
      <div className="color-row">
        {label && <span className="color-label">{label}</span>}
        <button
          className={`swatch current ${open ? 'on' : ''}`}
          style={{ background: value }}
          onClick={() => setOpen((o) => !o)}
          aria-label={`${label} 색 고르기`}
          aria-expanded={open}
        />
        {settings.favorites[kind].length > 0 && <span className="divider" />}
        <div className="swatches">
          {settings.favorites[kind].map((c) => (
            <button
              key={c}
              className={`swatch ${value.toLowerCase() === c ? 'on' : ''}`}
              style={{ background: c }}
              onClick={() => onChange(c)}
              aria-label={`${label} ${c}`}
            />
          ))}
        </div>
      </div>
      {open &&
        (floating ? (
          <div className="modal-back picker-back" onMouseDown={(e) => { e.stopPropagation(); setOpen(() => false) }}>
            <div className="modal picker-modal" onMouseDown={(e) => e.stopPropagation()}>
              <div className="picker-float-head">
                <strong>{label}</strong>
                <button className="info-close" onClick={() => setOpen(() => false)} aria-label="닫기">
                  ✕
                </button>
              </div>
              <ColorPicker value={value} onChange={onChange} kind={kind} />
            </div>
          </div>
        ) : (
          <ColorPicker value={value} onChange={onChange} kind={kind} />
        ))}
    </div>
  )
}
