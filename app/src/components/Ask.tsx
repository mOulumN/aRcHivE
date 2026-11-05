import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

// 앱 자체 입력·확인·알림 창. 브라우저 기본 prompt/confirm/alert는 컴퓨터 프로그램(Electron)에서 prompt가 안 되고,
// 웹 미리보기(내장 브라우저)에서는 아예 뜨지 않고 "아니오"로 처리되어 삭제 같은 동작이 조용히 취소된다. 그래서 직접 만든다.

type AskFn = (title: string, initial?: string) => Promise<string | null>
interface ConfirmOptions {
  detail?: string // 제목 아래 덧붙이는 결과 설명
  ok?: string // 확인 버튼 글자 (기본 "확인")
  danger?: boolean // 지우기처럼 되돌리기 어려운 동작: 처음 선택이 "취소"라서 Enter로 실수로 지우지 않는다
}
type ConfirmFn = (message: string, options?: ConfirmOptions) => Promise<boolean>
type NoticeFn = (message: string) => Promise<void>
interface Choice {
  value: string
  label: string
}
// 여러 갈래 중 하나를 고르게 한다 (예: "옮기기 / 추가하기"). 취소하면 null.
type ChooseFn = (message: string, choices: Choice[], detail?: string) => Promise<string | null>

const Ctx = createContext<AskFn>(async () => null)
const ConfirmCtx = createContext<ConfirmFn>(async () => false)
const NoticeCtx = createContext<NoticeFn>(async () => {})
const ChooseCtx = createContext<ChooseFn>(async () => null)
export const useChoose = () => useContext(ChooseCtx)
export const useAsk = () => useContext(Ctx)
export const useConfirm = () => useContext(ConfirmCtx)
export const useNotice = () => useContext(NoticeCtx)

interface ConfirmReq extends ConfirmOptions {
  message: string
  notice: boolean // 알림: 확인 버튼 하나만
  done(ok: boolean): void
}

export function AskProvider({ children }: { children: ReactNode }) {
  const [req, setReq] = useState<{ title: string; value: string; done(v: string | null): void } | null>(null)
  const [sure, setSure] = useState<ConfirmReq | null>(null)
  const [choice, setChoice] = useState<{ message: string; choices: Choice[]; detail?: string; done(v: string | null): void } | null>(null)

  const ask: AskFn = (title, initial = '') =>
    new Promise((resolve) => setReq({ title, value: initial, done: resolve }))

  const confirm: ConfirmFn = (message, options) =>
    new Promise((resolve) => setSure({ message, notice: false, done: resolve, ...options }))

  const notice: NoticeFn = (message) =>
    new Promise((resolve) => setSure({ message, notice: true, done: () => resolve() }))

  const choose: ChooseFn = (message, choices, detail) =>
    new Promise((resolve) => setChoice({ message, choices, detail, done: resolve }))

  const pickChoice = (v: string | null) => {
    choice?.done(v)
    setChoice(null)
  }

  const close = (v: string | null) => {
    req?.done(v === null ? null : v.trim() || null)
    setReq(null)
  }

  const answer = (ok: boolean) => {
    sure?.done(ok)
    setSure(null)
  }

  // Esc = 취소
  useEffect(() => {
    if (!sure) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && answer(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // Esc = 취소
  useEffect(() => {
    if (!choice) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && pickChoice(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <Ctx.Provider value={ask}>
      <ConfirmCtx.Provider value={confirm}>
        <NoticeCtx.Provider value={notice}>
          <ChooseCtx.Provider value={choose}>
          {children}
          {req && (
            <div className="modal-back" onMouseDown={() => close(null)}>
              <form
                className="modal ask"
                onMouseDown={(e) => e.stopPropagation()}
                onSubmit={(e) => {
                  e.preventDefault()
                  close(req.value)
                }}
              >
                <label className="ask-title">{req.title}</label>
                <input
                  className="text-input"
                  autoFocus
                  value={req.value}
                  onChange={(e) => setReq({ ...req, value: e.target.value })}
                  onKeyDown={(e) => e.key === 'Escape' && close(null)}
                />
                <div className="modal-foot">
                  <span className="spacer" />
                  <button type="button" className="btn ghost" onClick={() => close(null)}>
                    취소
                  </button>
                  <button type="submit" className="btn">
                    확인
                  </button>
                </div>
              </form>
            </div>
          )}
          {sure && (
            <div className="modal-back" onMouseDown={() => answer(false)}>
              <div className="modal ask" role="alertdialog" aria-label={sure.message} onMouseDown={(e) => e.stopPropagation()}>
                <div className="ask-title">{sure.message}</div>
                {sure.detail && <div className="ask-detail">{sure.detail}</div>}
                <div className="modal-foot">
                  <span className="spacer" />
                  {!sure.notice && (
                    <button className="btn ghost" autoFocus={sure.danger} onClick={() => answer(false)}>
                      취소
                    </button>
                  )}
                  <button className="btn" autoFocus={!sure.danger} onClick={() => answer(true)}>
                    {sure.ok ?? '확인'}
                  </button>
                </div>
              </div>
            </div>
          )}
          {choice && (
            <div className="modal-back" onMouseDown={() => pickChoice(null)}>
              <div className="modal ask" role="alertdialog" aria-label={choice.message} onMouseDown={(e) => e.stopPropagation()}>
                <div className="ask-title">{choice.message}</div>
                {choice.detail && <div className="ask-detail">{choice.detail}</div>}
                <div className="modal-foot">
                  <span className="spacer" />
                  <button className="btn ghost" onClick={() => pickChoice(null)}>
                    취소
                  </button>
                  {choice.choices.map((c, i) => (
                    <button key={c.value} className="btn" autoFocus={i === 0} onClick={() => pickChoice(c.value)}>
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
          </ChooseCtx.Provider>
        </NoticeCtx.Provider>
      </ConfirmCtx.Provider>
    </Ctx.Provider>
  )
}
