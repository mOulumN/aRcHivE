import { createContext, useContext, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { isImageFile } from '../data/photos'
import type { ID } from '../data/types'
import { useArchive } from '../state'
import { useConfirm, useNotice } from './Ask'
import { MultiPick } from './MultiPick'

// 사진 넣기 (F-01, F-07)
// 컴퓨터: 화면 어디에든 끌어다 놓기 / 버튼: 파일 고르기
// 한 장이면 바로 저장하고 그 사진을 연다. 여러 장이면 골라서 계열을 정해 저장한다.

const Ctx = createContext<{ pick(): void }>({ pick: () => {} })
export const useImporter = () => useContext(Ctx)

export function ImporterProvider({ children }: { children: ReactNode }) {
  const archive = useArchive()
  const notice = useNotice()
  const input = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [batch, setBatch] = useState<File[] | null>(null)
  const [busy, setBusy] = useState(false)

  const currentSeries: ID | null =
    archive.view.screen === 'archive' && archive.view.filter !== 'all' && archive.view.filter !== 'none'
      ? archive.view.filter
      : null

  const receive = async (list: FileList | File[]) => {
    const all = Array.from(list)
    const images = all.filter(isImageFile)
    if (images.length < all.length) {
      void notice(`사진이 아닌 파일 ${all.length - images.length}개는 뺐어요.`)
    }
    if (images.length === 0) return
    if (images.length === 1) {
      setBusy(true)
      try {
        const [entry] = await archive.addPhotos(images, currentSeries ? [currentSeries] : [])
        archive.go({ screen: 'archive', filter: entry.seriesId ?? 'none', entryId: entry.id })
      } catch (e) {
        void notice(`사진을 넣지 못했어요: ${(e as Error).message}`)
      } finally {
        setBusy(false)
      }
      return
    }
    setBatch(images)
  }

  useEffect(() => {
    let depth = 0
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files') ?? false
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth++
      setDragging(true)
    }
    const over = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault()
    }
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDragging(false)
    }
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth = 0
      setDragging(false)
      if (e.dataTransfer?.files.length) void receive(e.dataTransfer.files)
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragover', over)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragover', over)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('drop', drop)
    }
  })

  const ctx = useMemo(() => ({ pick: () => input.current?.click() }), [])

  return (
    <Ctx.Provider value={ctx}>
      {children}
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) void receive(e.target.files)
          e.target.value = ''
        }}
      />
      {dragging && <div className="drop-overlay">사진 넣기</div>}
      {busy && <div className="drop-overlay quiet">…</div>}
      {batch && (
        <BatchDialog files={batch} initialSeries={currentSeries} onDone={() => setBatch(null)} />
      )}
    </Ctx.Provider>
  )
}

// 여러 장을 넣을 때의 묶음 저장 (F-07): 사진을 골라 카테고리(여러 개)·태그를 정해 저장하면,
// 남은 사진이 다시 선택된 채로 남아 다른 카테고리·태그로 이어서 저장할 수 있다.
// 예) 15장 중 10장은 "픽셀", 5장은 "UI". Shift+클릭으로 범위를 한 번에 고른다.

function BatchDialog({ files, initialSeries, onDone }: { files: File[]; initialSeries: ID | null; onDone(): void }) {
  const archive = useArchive()
  const notice = useNotice()
  const confirm = useConfirm()
  const [left, setLeft] = useState(files)
  const [checked, setChecked] = useState<Set<File>>(() => new Set(files))
  const [cats, setCats] = useState<ID[]>(initialSeries ? [initialSeries] : [])
  const [tagSel, setTagSel] = useState<ID[]>([])
  const [saving, setSaving] = useState(false)
  const [savedCount, setSavedCount] = useState(0)
  const [progress, setProgress] = useState('')
  const lastClicked = useRef<number | null>(null) // Shift+클릭 범위의 시작

  // 미리보기 주소는 effect 안에서 만들고 닫힐 때 정리한다.
  const [urls, setUrls] = useState<Map<File, string>>(new Map())
  useEffect(() => {
    const map = new Map(files.map((f) => [f, URL.createObjectURL(f)]))
    setUrls(map)
    return () => map.forEach((u) => URL.revokeObjectURL(u))
  }, [files])

  const chosen = left.filter((f) => checked.has(f))

  // 한 장 누르기: 켜고 끈다. Shift를 누르고 누르면 마지막으로 누른 사진부터 여기까지를 같은 상태로 맞춘다.
  const clickCell = (e: ReactMouseEvent, i: number) => {
    e.preventDefault() // 브라우저 기본 체크 동작 대신 아래에서 직접 처리
    const on = !checked.has(left[i])
    const from = e.shiftKey && lastClicked.current !== null ? Math.min(lastClicked.current, i) : i
    const to = e.shiftKey && lastClicked.current !== null ? Math.max(lastClicked.current, i) : i
    setChecked((prev) => {
      const next = new Set(prev)
      for (let k = from; k <= to; k++) {
        if (on) next.add(left[k])
        else next.delete(left[k])
      }
      return next
    })
    lastClicked.current = i
  }

  const catOptions = archive.series.map((s) => ({ id: s.id, label: s.name }))
  const tagOptions = archive.tags
    .map((t) => ({ id: t.id, label: t.name }))
    .sort((a, b) => a.label.localeCompare(b.label, 'ko'))
  const flip = (list: ID[], id: ID) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id])

  const createCat = async (name: string) => {
    const s = archive.series.find((x) => x.name === name) ?? (await archive.createSeries(name))
    setCats((prev) => (prev.includes(s.id) ? prev : [...prev, s.id]))
  }
  const createTagHere = async (name: string) => {
    const t = await archive.createTag(name)
    setTagSel((prev) => (prev.includes(t.id) ? prev : [...prev, t.id]))
  }

  const save = async () => {
    if (chosen.length === 0) return
    setSaving(true)
    try {
      await archive.addPhotos(chosen, cats, (done) => setProgress(`${done + 1}/${chosen.length}`), tagSel)
      setSavedCount((n) => n + chosen.length)
      const rest = left.filter((f) => !checked.has(f))
      if (rest.length === 0) {
        archive.go({ screen: 'archive', filter: cats[0] ?? 'none', entryId: null })
        onDone()
        return
      }
      // 남은 사진은 다른 카테고리·태그로 이어서 저장할 수 있게 둔다.
      setLeft(rest)
      setChecked(new Set(rest))
      setCats([])
      setTagSel([])
      lastClicked.current = null
    } catch (e) {
      void notice(`저장하지 못했어요: ${(e as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-back">
      <div className="modal batch">
        <header className="modal-head">
          <strong>사진 {left.length}장</strong>
          {savedCount > 0 && <span className="muted"> · {savedCount}장 저장됨</span>}
          <span className="spacer" />
          <button
            className="link"
            onClick={() => setChecked(chosen.length === left.length ? new Set() : new Set(left))}
          >
            {chosen.length === left.length ? '모두 해제' : '모두 선택'}
          </button>
        </header>
        <div className="batch-grid">
          {left.map((f, i) => (
            <label
              key={`${f.name}-${f.size}-${f.lastModified}`}
              className={`batch-cell ${checked.has(f) ? 'on' : ''}`}
              onClick={(e) => clickCell(e, i)}
            >
              <input type="checkbox" checked={checked.has(f)} onChange={() => {}} tabIndex={-1} />
              {urls.get(f) ? <img src={urls.get(f)} alt={f.name} draggable={false} /> : <span className="thumb-empty" />}
              <span className="batch-name">{f.name}</span>
            </label>
          ))}
        </div>
        <div className="batch-assign">
          <MultiPick
            label="카테고리"
            options={catOptions}
            selected={cats}
            onToggle={(id) => setCats((prev) => flip(prev, id))}
            onCreate={createCat}
          />
          <MultiPick
            label="태그"
            options={tagOptions}
            selected={tagSel}
            onToggle={(id) => setTagSel((prev) => flip(prev, id))}
            onCreate={createTagHere}
          />
        </div>
        <footer className="modal-foot">
          <span className="spacer" />
          <button
            className="btn ghost"
            onClick={() => {
              if (left.length === 0) return onDone()
              void confirm(`남은 ${left.length}장은 저장하지 않고 닫을까요?`, { ok: '닫기', danger: true }).then((ok) => ok && onDone())
            }}
          >
            닫기
          </button>
          <button className="btn" disabled={saving || chosen.length === 0} onClick={() => void save()}>
            {saving ? `저장 중… ${progress}` : `선택한 ${chosen.length}장 저장`}
          </button>
        </footer>
      </div>
    </div>
  )
}
