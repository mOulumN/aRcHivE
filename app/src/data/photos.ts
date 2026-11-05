import type { Store } from './store'
import type { ID, PhotoKind, PhotoMeta } from './types'
import { newId } from './types'

const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
}

const THUMB_MAX = 480

export const isImageFile = (f: File) => f.type in EXT_BY_TYPE

function extOf(file: File) {
  const fromName = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (/^[a-z0-9]{2,5}$/.test(fromName)) return fromName
  return EXT_BY_TYPE[file.type] ?? 'img'
}

// 원본은 그대로 두고, 보관함용 작은 사본(긴 변 480px, 투명 유지)을 만든다.
export async function preparePhoto(file: File): Promise<{ meta: PhotoMeta; thumb: Blob }> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, THUMB_MAX / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  const thumb = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('작은 사본 만들기 실패'))), 'image/webp', 0.85),
  )
  const meta: PhotoMeta = {
    id: newId(),
    name: file.name,
    type: file.type,
    ext: extOf(file),
    width: bitmap.width,
    height: bitmap.height,
    createdAt: Date.now(),
  }
  bitmap.close()
  return { meta, thumb }
}

// 사진 주소(object URL)를 한 번만 만들고 재사용한다.
const urlCache = new Map<string, Promise<string | null>>()

export function photoUrl(store: Store, id: ID, kind: PhotoKind) {
  const key = `${kind}:${id}`
  let hit = urlCache.get(key)
  if (!hit) {
    hit = store.readPhoto(id, kind).then((b) => (b ? URL.createObjectURL(b) : null))
    urlCache.set(key, hit)
  }
  return hit
}

export function forgetPhotoUrls(id: ID) {
  for (const kind of ['full', 'thumb'] as const) {
    const key = `${kind}:${id}`
    urlCache.get(key)?.then((u) => u && URL.revokeObjectURL(u))
    urlCache.delete(key)
  }
}
