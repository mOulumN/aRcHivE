import { useArchive, type ViewMode } from '../state'

// 보기 전환 (F-30): 갤러리 / 맵. 보기만 바꾸고 데이터는 건드리지 않는다.

const MODES: { id: ViewMode; label: string }[] = [
  { id: 'gallery', label: '갤러리' },
  { id: 'map', label: '맵' },
]

export function ViewSwitch() {
  const { mode, setMode } = useArchive()
  return (
    <div className="tool-group" role="group" aria-label="보기">
      {MODES.map((m) => (
        <button key={m.id} className={`tool ${mode === m.id ? 'on' : ''}`} aria-pressed={mode === m.id} onClick={() => setMode(m.id)}>
          {m.label}
        </button>
      ))}
    </div>
  )
}
