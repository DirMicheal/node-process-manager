const { app, BrowserWindow, ipcMain, Tray, Menu, shell, nativeImage } = require('electron')
const path = require('path')
const fs = require('fs')
const { initProcessManager } = require('./processManager')
const { initPortPool } = require('./portPool')
const { initLogger } = require('./logger')
const { initConflictResolver } = require('./conflictResolver')

let mainWindow = null
let tray = null
let logger = null
let processManager = null
let portPool = null
let conflictResolver = null

const isDev = process.env.NODE_ENV === 'development'

function createTrayIcon() {
  const size = 16
  const canvas = nativeImage.createEmpty()
  const icon = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABmJLR0QA/wD/AP+gvaeTAAAACXBI' +
    'WXMAAAsTAAALEwEAmpwYAAAAB3RJTUUH5gMVESkq0Q/+5gAAABl0RVh0Q29tbWVudABDcmVhdGVkIHdpdGggR0lNUFeB' +
    'DhcAAAA8SURBVDjLY2AYBaNgFIyCUTAKRsEoGAWjYBSMglEwCkbBKBgFo2AUjIJRMgpGwSgYBaNgFIyCUTAKRsEoGAUj' +
    'YBSAAAFWgABH9vT36gAAAABJRU5ErkJggg=='
  )
  return icon
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 800,
    minHeight: 600,
    title: 'Node进程管理器',
    frame: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/dist/index.html'))
  }

  mainWindow.on('close', (e) => {
    if (!app.isQuiting) {
      e.preventDefault()
      mainWindow.hide()
    }
  })

  return mainWindow
}

function createTray() {
  try {
    const icon = createTrayIcon()
    tray = new Tray(icon)
  } catch (e) {
    console.error('创建托盘失败:', e)
    return
  }

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示主窗口',
      click: () => {
        if (mainWindow) {
          mainWindow.show()
          mainWindow.focus()
        }
      }
    },
    {
      label: '启动全部进程',
      click: async () => {
        if (processManager) {
          await processManager.startAll()
        }
      }
    },
    {
      label: '停止全部进程',
      click: async () => {
        if (processManager) {
          await processManager.stopAll()
        }
      }
    },
    { type: 'separator' },
    {
      label: '打开日志目录',
      click: () => {
        if (logger) {
          shell.openPath(logger.getLogDir())
        }
      }
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        app.isQuiting = true
        app.quit()
      }
    }
  ])

  tray.setToolTip('Node进程管理器')
  tray.setContextMenu(contextMenu)

  tray.on('double-click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.focus()
      } else {
        mainWindow.show()
      }
    }
  })
}

function setupIpcHandlers() {
  ipcMain.handle('process:list', async () => {
    return processManager ? processManager.list() : []
  })

  ipcMain.handle('process:start', async (event, id) => {
    return processManager ? processManager.start(id) : null
  })

  ipcMain.handle('process:stop', async (event, id) => {
    return processManager ? processManager.stop(id) : null
  })

  ipcMain.handle('process:restart', async (event, id) => {
    return processManager ? processManager.restart(id) : null
  })

  ipcMain.handle('process:add', async (event, config) => {
    return processManager ? processManager.add(config) : null
  })

  ipcMain.handle('process:remove', async (event, id) => {
    return processManager ? processManager.remove(id) : null
  })

  ipcMain.handle('process:update', async (event, id, config) => {
    return processManager ? processManager.update(id, config) : null
  })

  ipcMain.handle('process:logs', async (event, id, lines) => {
    return logger ? logger.getProcessLogs(id, lines) : []
  })

  ipcMain.handle('portpool:status', async () => {
    return portPool ? portPool.getStatus() : null
  })

  ipcMain.handle('portpool:allocate', async (event, preferred) => {
    return portPool ? portPool.allocate(preferred) : null
  })

  ipcMain.handle('portpool:release', async (event, port) => {
    return portPool ? portPool.release(port) : null
  })

  ipcMain.handle('conflict:check', async (event, port) => {
    return conflictResolver ? conflictResolver.check(port) : null
  })

  ipcMain.handle('conflict:resolve', async (event, port, mode) => {
    return conflictResolver ? conflictResolver.resolve(port, mode) : null
  })

  ipcMain.handle('conflict:list', async () => {
    return conflictResolver ? conflictResolver.listConflicts() : []
  })

  ipcMain.handle('app:openPath', async (event, p) => {
    shell.openPath(p)
  })

  ipcMain.handle('app:openExternal', async (event, url) => {
    shell.openExternal(url)
  })

  ipcMain.handle('app:minimize', () => {
    if (mainWindow) mainWindow.minimize()
  })

  ipcMain.handle('app:maximize', () => {
    if (mainWindow) {
      if (mainWindow.isMaximized()) {
        mainWindow.unmaximize()
      } else {
        mainWindow.maximize()
      }
    }
  })

  ipcMain.handle('app:close', () => {
    if (mainWindow) mainWindow.close()
  })

  ipcMain.handle('app:getLogDir', () => {
    return logger ? logger.getLogDir() : ''
  })

  ipcMain.handle('app:getUserDataDir', () => {
    return app.getPath('userData')
  })
}

function loadConfig() {
  const userDataDir = app.getPath('userData')
  const configFile = path.join(userDataDir, 'processes.json')
  
  if (processManager) {
    processManager.loadConfig(configFile)
  }
}

app.whenReady().then(async () => {
  logger = initLogger(app.getPath('userData'))
  portPool = initPortPool()
  conflictResolver = initConflictResolver(portPool, logger)
  processManager = initProcessManager(logger, portPool, conflictResolver)

  setupIpcHandlers()
  createWindow()
  createTray()
  loadConfig()

  processManager.on('status-change', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('process:status-change')
    }
  })

  logger.on('log', (id, level, message) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('process:log', id, level, message)
    }
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
  }
})

app.on('before-quit', async (e) => {
  if (!app.isQuiting) {
    app.isQuiting = true
  }
  
  if (processManager) {
    await processManager.stopAll()
  }
})
