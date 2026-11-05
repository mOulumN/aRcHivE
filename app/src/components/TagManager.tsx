import { useState } from 'react'
import type { Tag } from '../data/types'
import { useArchive, useTagCounts } from '../state'
import { useAsk, useConfirm } from './Ask'

// 태그 관리 (F-29): 전체 태그 목록. 이름 바꾸기, 지우기, 새로 만들기.
// 이미 있는 이름으로 바꾸면 그 태그로 합쳐진다. 늘어날 수 있는 목록이라 검색으로 좁힌다.

export function TagManager({ onClose }: { onClose(): void }) {
  const { tags, createTag, renameTag, deleteTag } = useArchive()
  const counts = useTagCounts()
  const ask = useAsk()
  const confirm = useConfirm()
  const [query, setQuery] = useState('')

  const q = query.trim().toLowerCase()
  const shown = tags
    .filter((t) => t.name.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'))

  const add = async () => {
    const name = await ask('새 태그')
    if (name) await createTag(name)
  }

  const rename = async (t: Tag) => {
    const name = await ask('태그 이름', t.name)
    if (!name || name === t.name) return
    const other = tags.find((x) => x.id !== t.id && x.name.toLowerCase() === name.toLowerCase())
    if (other) {
      const ok = await confirm(`"${other.name}" 태그가 이미 있어요. "${t.name}"의 사진을 "${other.name}"으로 합칠까요?`, { ok: '합치기' })
      if (!ok) return
    }
    await renameTag(t.id, name)
  }

  const remove = async (t: Tag) => {
    const ok = await confirm(`"${t.name}" 태그를 진짜 삭제할까요?`, { detail: '사진에서도 빠져요.', ok: '삭제', danger: true })
    if (!ok) return
    await deleteTag(t.id)
  }

  return (
    <div className="modal-back" onMouseDown={onClose}>
      <div className="modal tag-manager" onMouseDown={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <strong>태그</strong>
          <span className="spacer" />
          <button className="link" onClick={() => void add()}>
            새 태그
          </button>
          <button className="link" onClick={onClose}>
            닫기
          </button>
        </header>
        <input className="text-input" value={query} placeholder="검색" onChange={(e) => setQuery(e.target.value)} aria-label="태그 검색" />
        <ul className="tag-manage-list">
          {shown.map((t) => (
            <li key={t.id} className="tag-manage-row">
              <span className="tag-manage-name">{t.name}</span>
              <span className="series-count">( {String(counts.get(t.id) ?? 0).padStart(2, '0')} )</span>
              <span className="spacer" />
              <button onClick={() => void rename(t)} aria-label={`${t.name} 이름 바꾸기`} title="이름 바꾸기">
                (수정)
              </button>
              <button onClick={() => void remove(t)} aria-label={`${t.name} 지우기`} title="지우기">
                ✕
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
