import { useEffect, useState } from 'react'
import { photoUrl } from '../data/photos'
import type { ID, PhotoKind } from '../data/types'
import { useArchive } from '../state'

export function usePhotoUrl(id: ID | undefined, kind: PhotoKind) {
  const { store } = useArchive()
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!id) return
    let alive = true
    void photoUrl(store, id, kind).then((u) => alive && setUrl(u))
    return () => {
      alive = false
    }
  }, [store, id, kind])
  return url
}

export function Thumb({ photoId, alt, className }: { photoId: ID; alt: string; className?: string }) {
  const url = usePhotoUrl(photoId, 'thumb')
  if (!url) return <span className={`thumb-empty ${className ?? ''}`} />
  return <img className={className} src={url} alt={alt} draggable={false} loading="lazy" />
}
