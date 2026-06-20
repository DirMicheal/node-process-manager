const { app, BrowserWindow, ipcMain, Tray, Menu, shell, nativeImage } = require('electron')
const path = require('path')
const fs = require('fs')
const { initProcessManager } = require('./processManager')
const { initPortPool } = require('./portPool')
const { initLogger } = require('./logger')
const { initConflictResolver } = require('./conflictResolver')
const { initSystemProcessScanner } = require('./systemProcessScanner')
const { initSecurityValidator } = require('./securityValidator')

let mainWindow = null
let tray = null
let logger = null
let processManager = null
let portPool = null
let conflictResolver = null
let systemScanner = null
let securityValidator = null

const isDev = process.env.NODE_ENV === 'development'

function createTrayIcon() {
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
    width: 1100,
    height: 750,
    minWidth: 900,
    minHeight: 650,
    title: 'Node进程管理器',
    frame: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
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
      label: '扫描系统进程',
      click: async () => {
        if (systemScanner && mainWindow && !mainWindow.isDestroyed()) {
          try {
            const processes = await systemScanner.getAllNodeProcesses()
            mainWindow.webContents.send('system:processes-scanned', processes)
          } catch (e) {}
        }
      }
    },
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

function sendStatusChange() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('process:status-change')
  }
}

function sendProcessLog(id, level, message) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('process:log', id, level, message)
  }
}

function setupIpcHandlers() {
  ipcMain.handle('process:list', async () => {
    return processManager ? processManager.list() : []
  })

  ipcMain.handle('process:start', async (event, id) => {
    if (typeof id !== 'string' || id.length === 0) {
      throw new Error('无效的进程ID')
    }
    return processManager ? processManager.start(id) : null
  })

  ipcMain.handle('process:stop', async (event, id) => {
    if (typeof id !== 'string' || id.length === 0) {
      throw new Error('无效的进程ID')
    }
    return processManager ? processManager.stop(id) : null
  })

  ipcMain.handle('process:restart', async (event, id) => {
    if (typeof id !== 'string' || id.length === 0) {
      throw new Error('无效的进程ID')
    }
    return processManager ? processManager.restart(id) : null
  })

  ipcMain.handle('process:add', async (event, config) => {
    if (!config || typeof config !== 'object') {
      throw new Error('无效的配置')
    }
    try {
      return processManager ? processManager.add(config) : null
    } catch (e) {
      throw new Error(e.message)
    }
  })

  ipcMain.handle('process:remove', async (event, id) => {
    if (typeof id !== 'string' || id.length === 0) {
      throw new Error('无效的进程ID')
    }
    return processManager ? processManager.remove(id) : null
  })

  ipcMain.handle('process:update', async (event, id, config) => {
    if (typeof id !== 'string' || id.length === 0) {
      throw new Error('无效的进程ID')
    }
    if (!config || typeof config !== 'object') {
      throw new Error('无效的配置')
    }
    try {
      return processManager ? processManager.update(id, config) : null
    } catch (e) {
      throw new Error(e.message)
    }
  })

  ipcMain.handle('process:logs', async (event, id, lines) => {
    if (typeof id !== 'string' || id.length === 0) {
      return []
    }
    const safeLines = typeof lines === 'number' ? Math.min(Math.max(lines, 10), 1000) : 200
    return logger ? logger.getProcessLogs(id, safeLines) : []
  })

  ipcMain.handle('portpool:status', async () => {
    return portPool ? portPool.getStatus() : null
  })

  ipcMain.handle('portpool:allocate', async (event, preferred) => {
    if (preferred !== null && preferred !== undefined) {
      const num = parseInt(preferred, 10)
      if (isNaN(num) || num < 1 || num > 65535) {
        throw new Error('无效的端口号')
      }
    }
    return portPool ? portPool.allocate(preferred, 'ui-request') : null
  })

  ipcMain.handle('portpool:release', async (event, port) => {
    const num = parseInt(port, 10)
    if (isNaN(num)) {
      return false
    }
    return portPool ? portPool.release(port) : false
  })

  ipcMain.handle('conflict:check', async (event, port) => {
    const num = parseInt(port, 10)
    if (isNaN(num) || num < 1 || num > 65535) {
      return { hasConflict: false, port }
    }
    return conflictResolver ? conflictResolver.check(port) : { hasConflict: false, port }
  })

  ipcMain.handle('conflict:resolve', async (event, port, mode) => {
    const num = parseInt(port, 10)
    if (isNaN(num) || num < 1 || num > 65535) {
      return { success: false, error: '无效的端口号' }
    }
    if (mode !== 'auto' && mode !== 'force') {
      return { success: false, error: '无效的冲突模式' }
    }
    return conflictResolver ? conflictResolver.resolve(port, mode) : { success: false, error: '服务不可用' }
  })

  ipcMain.handle('conflict:list', async () => {
    return conflictResolver ? conflictResolver.listConflicts() : []
  })

  ipcMain.handle('system:scanProcesses', async () => {
    if (!systemScanner) return []
    
    try {
      const systemProcesses = await systemScanner.getAllNodeProcesses()
      const managedProcesses = processManager ? processManager.list() : []
      const managedPids = new Set(managedProcesses.filter(p => p.pid).map(p => p.pid))

      return systemProcesses.map(proc => ({
        ...proc,
        managedByApp: managedPids.has(proc.pid),
        displayName: proc.name.includes('.') ? proc.name : `${proc.name}.exe`,
        appName: systemScanner.extractAppName(proc.commandLine),
        script: systemScanner.getProcessScript(proc.commandLine)
      }))
    } catch (e) {
      if (logger) {
        logger.error('system-scanner', `扫描系统进程失败: ${e.message}`)
      }
      return []
    }
  })

  ipcMain.handle('system:killProcess', async (event, pid, force) => {
    const numPid = parseInt(pid, 10)
    if (isNaN(numPid) || numPid < 1) {
      return { success: false, error: '无效的PID' }
    }
    return systemScanner ? systemScanner.killProcess(numPid, force !== false) : { success: false, error: '服务不可用' }
  })

  ipcMain.handle('app:openPath', async (event, p) => {
    if (typeof p !== 'string' || p.length === 0) return false
    const safePath = path.normalize(p)
    if (!path.isAbsolute(safePath)) return false
    return shell.openPath(safePath)
  })

  ipcMain.handle('app:openExternal', async (event, url) => {
    if (typeof url !== 'string' || url.length === 0) return false
    if (!/^https?:\/\//i.test(url)) {
      throw new Error('仅允许打开HTTP/HTTPS链接')
    }
    if (url.length > 2048) {
      throw new Error('URL过长')
    }
    return shell.openExternal(url)
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
    return mainWindow ? mainWindow.isMaximized() : false
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

  ipcMain.handle('app:importSystemProcess', async (event, systemProc) => {
    if (!systemProc || typeof systemProc !== 'object') {
      throw new Error('无效的系统进程信息')
    }

    if (!systemScanner) return null

    const pid = parseInt(systemProc.pid, 10)
    if (isNaN(pid)) {
      throw new Error('无效的PID')
    }

    const config = {
      name: systemProc.displayName || systemProc.appName || `导入进程-${pid}`,
      command: systemProc.executablePath?.trim() ? `"${systemProc.executablePath.trim()}"` : 'node',
      args: [],
      cwd: process.cwd(),
      port: systemProc.primaryPort || null,
      autoStart: false,
      restartOnCrash: false,
      maxRestarts: 3,
      conflictMode: 'auto'
    }

    try {
      return processManager ? processManager.add(config) : null
    } catch (e) {
      throw new Error(e.message)
    }
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
  systemScanner = initSystemProcessScanner()
  securityValidator = initSecurityValidator()

  setupIpcHandlers()
  createWindow()
  createTray()
  loadConfig()

  processManager.on('status-change', sendStatusChange)

  logger.on('log', (id, level, message) => {
    sendProcessLog(id, level, message)
  })

  systemScanner.on('scan-complete', (processes) => {
    if (logger) {
      logger.info('system', `扫描完成，发现 ${processes.length} 个Node相关进程`)
    }
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
})

app.on('before-quit', async (e) => {
  if (!app.isQuiting) {
    app.isQuiting = true
  }
  
  if (processManager) {
    await processManager.stopAll()
  }
})

process.on('uncaughtException', (err) => {
  if (logger) {
    logger.error('system', `未捕获异常: ${err.message}\n${err.stack}`)
  }
})

process.on('unhandledRejection', (reason) => {
  if (logger) {
    logger.error('system', `未处理的Promise拒绝: ${reason}`)
  }
})
