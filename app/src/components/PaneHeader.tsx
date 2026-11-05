import { useState, type ReactNode } from 'react'
import { ViewSwitch } from './ViewSwitch'

// 같은 조작을 넓은 화면에서는 머리줄에, 폰에서는 하단 바와 더보기에 둔다.
export function PaneHeader({ title, count, primary, secondary }: {
  title: ReactNode; count: number; primary: ReactNode; secondary?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  return <header className="pane-head responsive-head">
    <h2>{title}<sup>{count}</sup></h2>
    <div className="pane-primary"><ViewSwitch /><span className="spacer" />{primary}</div>
    <div className={`pane-secondary ${open ? 'open' : ''}`} onClick={(e) => {
      if ((e.target as HTMLElement).closest('button') && !(e.target as HTMLElement).closest('.zoom-ctl')) setOpen(false)
    }}>
      <button className="link mobile-only" onClick={() => setOpen(false)}>완료</button>
      {secondary}
    </div>
    {secondary && <button className="link mobile-only more-tools" aria-label="더보기" aria-expanded={open} onClick={() => setOpen((v) => !v)}>···</button>}
  </header>
}
