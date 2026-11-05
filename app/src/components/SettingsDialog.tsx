import { useState } from 'react'
import { APP_NAME, OWNER } from '../data/about'
import type { Settings } from '../data/settings'
import { useArchive } from '../state'
import { BackupSection } from './BackupPanel'
import { ColorField } from './ColorPicker'

// 설정 (F-22): 사진 영역 배경색, 그 외 배경색, 테마 색. 색은 직접 고르고 즐겨찾기로 모은다.
// 색 고르기 창은 화면 가운데에 별도 창으로 뜬다. 한 번에 하나만.

type ColorKey = 'boardBg' | 'pageBg' | 'accent'

export function SettingsDialog({ onClose }: { onClose(): void }) {
  const { settings, saveSettings, store } = useArchive()
  const [picking, setPicking] = useState<ColorKey | null>(null)
  const set = (patch: Partial<Settings>) => void saveSettings({ ...settings, ...patch })

  const field = (key: ColorKey, label: string) => (
    <ColorField
      label={label}
      kind={key}
      value={settings[key]}
      onChange={(c) => set({ [key]: c })}
      open={picking === key}
      onToggle={() => setPicking((p) => (p === key ? null : key))}
      floating
    />
  )

  return (
    <div className="modal-back" onMouseDown={onClose}>
      <div className="modal settings" onMouseDown={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <strong>설정</strong>
          <span className="spacer" />
          <button className="link" onClick={onClose}>
            닫기
          </button>
        </header>
        <section className="settings-section">
          <h3>색</h3>
          {field('boardBg', '사진 영역 배경')}
          {field('pageBg', '배경')}
          {field('accent', '테마 색')}
        </section>
        <section className="settings-section">
          <h3>메모</h3>
          <label className="memo-font-setting">글자 크기
            <input className="text-input" type="number" min={8} max={48} step={1} aria-label="메모 글자 크기"
              value={settings.noteFontSize} onChange={(e) => {
                const size = e.target.valueAsNumber
                if (Number.isFinite(size) && size >= 8 && size <= 48) set({ noteFontSize: size })
              }} /> px
          </label>
        </section>
        {store.kind === 'folder' && <BackupSection />}
        <p className="settings-about">
          {APP_NAME} · © {OWNER}
        </p>
      </div>
    </div>
  )
}
