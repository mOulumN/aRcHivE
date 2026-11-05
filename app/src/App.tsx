import { useEffect, useState } from 'react'
import { AskProvider } from './components/Ask'
import { EntryDragProvider } from './components/EntryDrag'
import { ImporterProvider } from './components/Importer'
import { createBrowserStore } from './data/browserStore'
import { createFolderStore } from './data/folderStore'
import type { Store } from './data/store'
import { ArchiveScreen } from './screens/ArchiveScreen'
import { FolderSetup } from './screens/FolderSetup'
import { Home } from './screens/Home'
import { ArchiveProvider, useArchive } from './state'
import { usePhoneViewport } from './components/usePhoneViewport'
import { SyncBar } from './components/SyncBar'

function Screens() {
  const { view, go } = useArchive()
  useEffect(() => {
    const back = (e: Event) => {
      if (view.screen === 'home') return
      e.preventDefault()
      if (view.entryId) go({ ...view, entryId: null })
      else go({ screen: 'home' })
    }
    window.addEventListener('archive:back', back)
    return () => window.removeEventListener('archive:back', back)
  }, [view, go])
  return view.screen === 'home' ? <Home /> : <ArchiveScreen />
}

export default function App() {
  usePhoneViewport()
  const fs = window.archiveFs
  // 웹 미리보기는 브라우저 저장, 컴퓨터 프로그램은 고른 폴더에 저장한다.
  const [store, setStore] = useState<Store | null>(() => (fs ? null : createBrowserStore()))
  const [needFolder, setNeedFolder] = useState(false)

  useEffect(() => {
    if (!fs) return
    void fs.getFolder().then((folder) => {
      if (folder) setStore(createFolderStore(fs, folder))
      else setNeedFolder(true)
    })
  }, [fs])

  if (fs && needFolder && !store) {
    return (
      <FolderSetup
        fs={fs}
        onReady={(folder) => {
          setNeedFolder(false)
          setStore(createFolderStore(fs, folder))
        }}
      />
    )
  }
  if (!store) return <div className="loading">aRcHivE</div>

  return (
    <ArchiveProvider store={store}>
      <AskProvider>
        <ImporterProvider>
          <EntryDragProvider>
            <Screens />
            <SyncBar />
          </EntryDragProvider>
        </ImporterProvider>
      </AskProvider>
    </ArchiveProvider>
  )
}
