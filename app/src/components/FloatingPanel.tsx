import { useState, type ReactNode } from 'react'

export function FloatingPanel({ title, className, onDone, actions, children }: {
  title: string; className: string; onDone(): void; actions?: ReactNode; children: ReactNode
}) {
  const [collapsed, setCollapsed] = useState(false)
  return <aside className={`info-panel floating-panel ${className} ${collapsed ? 'collapsed' : ''}`} onPointerDown={(e) => e.stopPropagation()}>
    <header className="floating-panel-head">
      <strong>{title}</strong><span className="spacer" />{actions}
      <button className="link" onClick={() => setCollapsed((v) => !v)} aria-expanded={!collapsed}>{collapsed ? '펼치기' : '접기'}</button>
      <button className="link" onClick={onDone}>완료</button>
    </header>
    {!collapsed && <div className="floating-panel-body">{children}</div>}
  </aside>
}
