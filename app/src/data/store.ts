import type { Entry, ID, PhotoKind, PhotoMeta, Placement, Project, Series, Snapshot, Tag } from './types'

// 화면은 이 약속만 알고, 실제로 어디에 저장되는지는 모른다.
// 웹 미리보기 = 브라우저 저장, 컴퓨터 프로그램 = 내가 고른 폴더.
export interface Store {
  kind: 'browser' | 'folder'
  describe(): string
  load(): Promise<Snapshot>
  saveSeries(series: Series): Promise<void>
  deleteSeries(id: ID): Promise<void>
  saveTag(tag: Tag): Promise<void>
  deleteTag(id: ID): Promise<void> // 사진에서도 이 태그를 뺀다
  savePlacement(placement: Placement): Promise<void>
  deletePlacements(mapId: string, entryIds?: ID[]): Promise<void> // entryIds를 빼면 그 맵의 고정 전부
  saveProject(project: Project): Promise<void>
  deleteProject(id: ID): Promise<void> // 그 프로젝트의 사진 위치도 함께 지운다
  saveEntry(entry: Entry): Promise<void>
  deleteEntry(entry: Entry): Promise<void>
  addPhoto(meta: PhotoMeta, full: Blob, thumb: Blob): Promise<void>
  readPhoto(id: ID, kind: PhotoKind): Promise<Blob | null>
  getMeta(key: string): Promise<string | null>
  setMeta(key: string, value: string): Promise<void>
}
