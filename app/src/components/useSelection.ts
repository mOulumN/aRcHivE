import { useState } from 'react'
import type { ID } from '../data/types'

// 갤러리·맵의 여러 장 선택. "선택" 모드를 켜면 사진을 누를 때마다 고르고(Shift+클릭은 범위), 고른 사진에 한꺼번에 작업한다.

export function useSelection() {
  const [on, setOn] = useState(false)
  const [ids, setIds] = useState<Set<ID>>(new Set())
  const [last, setLast] = useState<ID | null>(null)

  // order: 지금 화면 순서의 사진 id (Shift+클릭 범위를 이 순서로 계산)
  const click = (id: ID, order: ID[], shift: boolean) => {
    const turnOn = !ids.has(id)
    const a = last ? order.indexOf(last) : -1
    const b = order.indexOf(id)
    const range = shift && a >= 0 && b >= 0 ? order.slice(Math.min(a, b), Math.max(a, b) + 1) : [id]
    setIds((prev) => {
      const next = new Set(prev)
      for (const x of range) {
        if (turnOn) next.add(x)
        else next.delete(x)
      }
      return next
    })
    setLast(id)
  }

  const toggleMode = () => {
    setOn((v) => !v)
    setIds(new Set())
    setLast(null)
  }

  return {
    on,
    ids,
    toggleMode,
    click,
    clear: () => setIds(new Set()),
    setAll: (all: ID[]) => setIds(new Set(all)),
  }
}
