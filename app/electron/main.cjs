// aRcHivE 컴퓨터 프로그램 (Electron)
// 화면은 웹으로 만든 것(dist/)을 그대로 띄우고, 사진·기록은 사용자가 고른 폴더에 파일로 저장한다.

const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron')
const path = require('node:path')
const fs = require('node:fs/promises')

// 시험할 때 실제 설정·문서 폴더를 건드리지 않도록 바꿔 끼울 수 있게 한다.
if (process.env.ARCHIVE_USER_DATA) app.setPath('userData', process.env.ARCHIVE_USER_DATA)

const configPath = () => path.join(app.getPath('userData'), 'config.json')
const defaultFolder = () => process.env.ARCHIVE_DEFAULT_FOLDER || path.join(app.getPath('documents'), 'aRcHivE')
let folder = null

async function loadConfig() {
  try {
    const c = JSON.parse(await fs.readFile(configPath(), 'utf8'))
    if (c.folder) {
      await fs.access(c.folder)
      folder = c.folder
    }
  } catch {
    folder = null
  }
}

async function setFolder(p) {
  await fs.mkdir(path.join(p, 'photos'), { recursive: true })
  await fs.mkdir(path.join(p, 'thumbs'), { recursive: true })
  folder = p
  await fs.mkdir(path.dirname(configPath()), { recursive: true })
  await fs.writeFile(configPath(), JSON.stringify({ folder: p }, null, 1))
  return p
}

// 화면 쪽에서 오는 경로는 정해진 모양만 허용한다(폴더 밖 파일 접근 차단).
const REL = /^(photos\/[0-9a-f-]{36}\.[a-z0-9]{2,5}|thumbs\/[0-9a-f-]{36}\.webp)$/
function resolveRel(rel) {
  if (!folder) throw new Error('저장 폴더가 정해지지 않았어요')
  if (typeof rel !== 'string' || !REL.test(rel)) throw new Error('허용되지 않는 경로예요')
  return path.join(folder, ...rel.split('/'))
}

const dataFile = () => path.join(folder, 'data.json')

function registerIpc() {
  ipcMain.handle('fs:getFolder', () => folder)
  ipcMain.handle('fs:defaultFolder', () => defaultFolder())
  ipcMain.handle('fs:useFolder', (_e, p) => {
    if (p !== defaultFolder()) throw new Error('기본 폴더만 바로 쓸 수 있어요')
    return setFolder(p)
  })
  ipcMain.handle('fs:chooseFolder', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const r = await dialog.showOpenDialog(win, {
      title: 'aRcHivE 저장 폴더 고르기',
      defaultPath: app.getPath('documents'),
      properties: ['openDirectory', 'createDirectory'],
    })
    if (r.canceled || !r.filePaths[0]) return null
    return setFolder(r.filePaths[0])
  })
  // 저장 폴더 바꾸기: 새 폴더에 이미 기록이 있으면 그대로 쓰고, 비어 있으면 지금 내용을 복사해 간다(원래 폴더는 그대로 둔다).
  ipcMain.handle('fs:changeFolder', async (e) => {
    if (!folder) throw new Error('저장 폴더가 정해지지 않았어요')
    const win = BrowserWindow.fromWebContents(e.sender)
    const r = await dialog.showOpenDialog(win, {
      title: 'aRcHivE 저장 폴더 바꾸기',
      defaultPath: path.dirname(folder),
      properties: ['openDirectory', 'createDirectory'],
    })
    if (r.canceled || !r.filePaths[0]) return null
    const next = path.resolve(r.filePaths[0])
    const cur = path.resolve(folder)
    const key = (p) => p.toLowerCase().replace(/[\\/]+$/, '')
    if (key(next) === key(cur)) return { folder: cur, mode: 'same' }
    const inside = (a, b) => key(a).startsWith(key(b) + path.sep)
    if (inside(next, cur) || inside(cur, next)) throw new Error('지금 폴더의 안쪽이나 바깥쪽은 고를 수 없어요. 다른 위치를 골라 주세요')
    const exists = await fs.access(path.join(next, 'data.json')).then(() => true, () => false)
    if (exists) {
      await setFolder(next)
      return { folder: next, mode: 'existing' }
    }
    await fs.mkdir(next, { recursive: true })
    await fs.cp(path.join(cur, 'photos'), path.join(next, 'photos'), { recursive: true }).catch(() => {})
    await fs.cp(path.join(cur, 'thumbs'), path.join(next, 'thumbs'), { recursive: true }).catch(() => {})
    await fs.copyFile(dataFile(), path.join(next, 'data.json')).catch((err) => {
      if (err.code !== 'ENOENT') throw err
    })
    await setFolder(next)
    return { folder: next, mode: 'copied' }
  })
  ipcMain.handle('fs:readData', async () => {
    if (!folder) return null
    try {
      return await fs.readFile(dataFile(), 'utf8')
    } catch {
      return null
    }
  })
  // 쓰는 중 꺼져도 깨지지 않게 임시 파일에 쓰고 바꿔 넣는다. 직전 내용은 data.prev.json으로 남긴다.
  ipcMain.handle('fs:writeData', async (_e, json) => {
    if (!folder) throw new Error('저장 폴더가 정해지지 않았어요')
    if (typeof json !== 'string') throw new Error('잘못된 데이터')
    JSON.parse(json)
    const tmp = path.join(folder, 'data.json.tmp')
    await fs.writeFile(tmp, json, 'utf8')
    await fs.copyFile(dataFile(), path.join(folder, 'data.prev.json')).catch(() => {})
    await fs.rename(tmp, dataFile())
  })
  ipcMain.handle('fs:writeFile', async (_e, rel, data) => {
    await fs.writeFile(resolveRel(rel), Buffer.from(data))
  })
  ipcMain.handle('fs:readFile', async (_e, rel) => {
    try {
      return new Uint8Array(await fs.readFile(resolveRel(rel)))
    } catch {
      return null
    }
  })
  ipcMain.handle('fs:deleteFile', async (_e, rel) => {
    await fs.rm(resolveRel(rel), { force: true })
  })
  ipcMain.handle('fs:openFolder', async () => {
    if (folder) await shell.openPath(folder)
  })
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: 'aRcHivE',
    backgroundColor: '#ffffff',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  win.setMenuBarVisibility(false)
  // 프로그램 안에서 다른 사이트로 이동하거나 새 창을 여는 것을 막는다.
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  const devUrl = process.env.ARCHIVE_DEV_URL
  if (devUrl) void win.loadURL(devUrl)
  else void win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })
  app.whenReady().then(async () => {
    await loadConfig()
    registerIpc()
    createWindow()
  })
  app.on('window-all-closed', () => app.quit())
}
