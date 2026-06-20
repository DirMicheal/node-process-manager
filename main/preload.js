const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  process: {
    list: () => ipcRenderer.invoke('process:list'),
    start: (id) => ipcRenderer.invoke('process:start', id),
    stop: (id) => ipcRenderer.invoke('process:stop', id),
    restart: (id) => ipcRenderer.invoke('process:restart', id),
    add: (config) => ipcRenderer.invoke('process:add', config),
    remove: (id) => ipcRenderer.invoke('process:remove', id),
    update: (id, config) => ipcRenderer.invoke('process:update', id, config),
    logs: (id, lines) => ipcRenderer.invoke('process:logs', id, lines),
    onStatusChange: (callback) => {
      ipcRenderer.on('process:status-change', callback)
      return () => ipcRenderer.removeListener('process:status-change', callback)
    },
    onLog: (callback) => {
      ipcRenderer.on('process:log', callback)
      return () => ipcRenderer.removeListener('process:log', callback)
    }
  },
  portPool: {
    status: () => ipcRenderer.invoke('portpool:status'),
    allocate: (preferred) => ipcRenderer.invoke('portpool:allocate', preferred),
    release: (port) => ipcRenderer.invoke('portpool:release', port)
  },
  conflict: {
    check: (port) => ipcRenderer.invoke('conflict:check', port),
    resolve: (port, mode) => ipcRenderer.invoke('conflict:resolve', port, mode),
    list: () => ipcRenderer.invoke('conflict:list')
  },
  app: {
    openPath: (p) => ipcRenderer.invoke('app:openPath', p),
    openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
    minimize: () => ipcRenderer.invoke('app:minimize'),
    maximize: () => ipcRenderer.invoke('app:maximize'),
    close: () => ipcRenderer.invoke('app:close')
  }
})
