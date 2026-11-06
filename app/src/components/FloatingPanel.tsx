import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

export function FloatingPanel({ title, className, onDone, onCancel, actions, children }: {
  title: string; className: string; onDone(): void; onCancel?(): void; actions?: ReactNode; children: ReactNode
}) {
  const [collapsed, setCollapsed] = useState(false)
  const box = useRef<HTMLElement>(null)

  // 폰: 아래에 뜨는 창이 맨 아래 사진을 가리지 않도록, 창 높이만큼을 바깥 화면(--panel-pad)에 알려 둔다.
  // 맵·갤러리가 그만큼 아래로 더 스크롤된다. 창이 접히거나 닫히면 줄어든다.
  useLayoutEffect(() => {
    const el = box.current
    const host = el?.parentElement
    if (!el || !host) return
    const sync = () => host.style.setProperty('--panel-pad', `${el.offsetHeight + 8}px`)
    sync()
    const ro = new ResizeObserver(sync)
    ro.observe(el)
    return () => {
      ro.disconnect()
      host.style.removeProperty('--panel-pad')
    }
  }, [])

  return <aside ref={box} className={`info-panel floating-panel ${className} ${collapsed ? 'collapsed' : ''}`} onPointerDown={(e) => e.stopPropagation()}>
    <header className="floating-panel-head">
      <strong>{title}</strong><span className="spacer" />{actions}
      <button className="link" onClick={() => setCollapsed((v) => !v)} aria-expanded={!collapsed}>{collapsed ? '펼치기' : '접기'}</button>
      {onCancel && <button className="link" onClick={onCancel}>취소</button>}
      <button className="link" onClick={onDone}>완료</button>
    </header>
    {!collapsed && <div className="floating-panel-body">{children}</div>}
  </aside>
}
