// 프로젝트 보드 (F-33) 배치 값. 사진은 사용자가 직접 놓는다. 새로 담은 사진만 빈 칸 격자의 다음 자리에 놓는다.

export const PROJECT_PHOTO = 150 // 사진 긴 변
export const NOTE_W = 200 // 메모 기본 너비
const COLS = 6
const CELL = 190
const PAD = 100

// i번째 사진의 가운데 좌표
export const slotCenter = (i: number) => ({ x: PAD + (i % COLS) * CELL, y: PAD + Math.floor(i / COLS) * CELL })
