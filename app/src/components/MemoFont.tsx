// 메모 글자 크기 조절 (임시 위치: 메모를 고르면 폰은 하단 탭 위 왼쪽, 컴퓨터는 도구 줄).
// 숫자는 "지금 배율에서 눈에 보이는 크기(px)". 누르면 1px씩 바뀌고, 그 메모에만 저장된다.
// 메모의 글자는 사진·칸과 같은 비율로 커지고 작아지므로(저장값은 배율 100% 기준 px) 배율이 달라도 모양이 그대로다.

export const MEMO_FONT_MIN = 6 // 눈에 보이는 크기 기준
export const MEMO_FONT_MAX = 80

export const roundFont = (v: number) => Math.round(v * 10) / 10

// 저장값(배율 100% 기준 px) ↔ 지금 보이는 px
export const shownFont = (stored: number, zoom: number) => Math.round(stored * zoom)
export const storedFont = (shown: number, zoom: number) => roundFont(shown / zoom)

export function MemoFont({ shown, onChange, className = '' }: { shown: number; onChange(shown: number): void; className?: string }) {
  const set = (v: number) => onChange(Math.min(MEMO_FONT_MAX, Math.max(MEMO_FONT_MIN, v)))
  return (
    <div className={`memo-font ${className}`} role="group" aria-label="메모 글자 크기" onPointerDown={(e) => e.stopPropagation()}>
      <span className="memo-font-label">글자 {shown}</span>
      <button className="btn ghost" aria-label="글자 작게" disabled={shown <= MEMO_FONT_MIN} onClick={() => set(shown - 1)}>−</button>
      <button className="btn ghost" aria-label="글자 크게" disabled={shown >= MEMO_FONT_MAX} onClick={() => set(shown + 1)}>+</button>
    </div>
  )
}
