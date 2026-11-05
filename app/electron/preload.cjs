// 화면(웹)에 폴더 저장 기능만 좁게 열어 준다. (src/data/folderStore.ts의 ArchiveFs와 짝)
const { contextBridge, ipcRenderer } = require('electron')

const call =
  (channel) =>
  (...args) =>
    ipcRenderer.invoke(channel, ...args)

contextBridge.exposeInMainWorld('archiveFs', {
  getFolder: call('fs:getFolder'),
  defaultFolder: call('fs:defaultFolder'),
  useFolder: call('fs:useFolder'),
  chooseFolder: call('fs:chooseFolder'),
  readData: call('fs:readData'),
  writeData: call('fs:writeData'),
  writeFile: call('fs:writeFile'),
  readFile: call('fs:readFile'),
  deleteFile: call('fs:deleteFile'),
  openFolder: call('fs:openFolder'),
})
