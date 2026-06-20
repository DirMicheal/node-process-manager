const { contextBridge, ipcRenderer } = require('electron')

const validIpcChannels = new Set([
  'process:list',
  'process:start',
  'process:stop',
  'process:restart',
  'process:add',
  'process:remove',
  'process:update',
  'process:logs',
  'portpool:status',
  'portpool:allocate',
  'portpool:release',
  'conflict:check',
  'conflict:resolve',
  'conflict:list',
  'system:scanProcesses',
  'system:killProcess',
  'app:openPath',
  'app:openExternal',
  'app:minimize',
  'app:maximize',
  'app:close',
  'app:getLogDir',
  'app:getUserDataDir',
  'app:importSystemProcess'
])

function createSafeIpcInvoke(channel) {
  return (...args) => {
    if (!validIpcChannels.has(channel)) {
      return Promise.reject(new Error(`非法的IPC通道: ${channel}`))
    }
    return ipcRenderer.invoke(channel, ...args)
  }
}

contextBridge.exposeInMainWorld('electronAPI', {
  process: {
    list: createSafeIpcInvoke('process:list'),
    start: createSafeIpcInvoke('process:start'),
    stop: createSafeIpcInvoke('process:stop'),
    restart: createSafeIpcInvoke('process:restart'),
    add: createSafeIpcInvoke('process:add'),
    remove: createSafeIpcInvoke('process:remove'),
    update: createSafeIpcInvoke('process:update'),
    logs: createSafeIpcInvoke('process:logs'),
    onStatusChange: (callback) => {
      if (typeof callback !== 'function') return () => {}
      const wrapped = (...args) => callback(...args)
      ipcRenderer.on('process:status-change', wrapped)
      return () => ipcRenderer.removeListener('process:status-change', wrapped)
    },
    onLog: (callback) => {
      if (typeof callback !== 'function') return () => {}
      const wrapped = (...args) => callback(...args)
      ipcRenderer.on('process:log', wrapped)
      return () => ipcRenderer.removeListener('process:log', wrapped)
    }
  },
  portPool: {
    status: createSafeIpcInvoke('portpool:status'),
    allocate: createSafeIpcInvoke('portpool:allocate'),
    release: createSafeIpcInvoke('portpool:release')
  },
  conflict: {
    check: createSafeIpcInvoke('conflict:check'),
    resolve: createSafeIpcInvoke('conflict:resolve'),
    list: createSafeIpcInvoke('conflict:list')
  },
  system: {
    scanProcesses: createSafeIpcInvoke('system:scanProcesses'),
    killProcess: createSafeIpcInvoke('system:killProcess'),
    importProcess: createSafeIpcInvoke('app:importSystemProcess'),
    onProcessesScanned: (callback) => {
      if (typeof callback !== 'function') return () => {}
      const wrapped = (...args) => callback(...args)
      ipcRenderer.on('system:processes-scanned', wrapped)
      return () => ipcRenderer.removeListener('system:processes-scanned', wrapped)
    }
  },
  app: {
    openPath: createSafeIpcInvoke('app:openPath'),
    openExternal: createSafeIpcInvoke('app:openExternal'),
    minimize: createSafeIpcInvoke('app:minimize'),
    maximize: createSafeIpcInvoke('app:maximize'),
    close: createSafeIpcInvoke('app:close'),
    getLogDir: createSafeIpcInvoke('app:getLogDir'),
    getUserDataDir: createSafeIpcInvoke('app:getUserDataDir')
  }
})

Object.freeze(window.electronAPI)
