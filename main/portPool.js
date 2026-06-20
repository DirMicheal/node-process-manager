const net = require('net')
const { EventEmitter } = require('events')

class AsyncMutex {
  constructor() {
    this.queue = []
    this.locked = false
  }

  async acquire() {
    return new Promise((resolve) => {
      if (!this.locked) {
        this.locked = true
        resolve()
      } else {
        this.queue.push(resolve)
      }
    })
  }

  release() {
    if (this.queue.length > 0) {
      const next = this.queue.shift()
      next()
    } else {
      this.locked = false
    }
  }

  async withLock(fn) {
    await this.acquire()
    try {
      return await fn()
    } finally {
      this.release()
    }
  }
}

class PortPool extends EventEmitter {
  constructor() {
    super()
    this.minPort = 3000
    this.maxPort = 4000
    this.allocatedPorts = new Map()
    this.reservedPorts = new Set()
    this.mutex = new AsyncMutex()
  }

  async tryBindPort(port, host = '0.0.0.0') {
    return new Promise((resolve, reject) => {
      const server = net.createServer()
      
      server.once('error', (err) => {
        if (err.code === 'EADDRINUSE' || err.code === 'EACCES') {
          resolve({ success: false, server: null, error: err.code })
        } else {
          resolve({ success: false, server: null, error: err.message })
        }
      })

      server.once('listening', () => {
        resolve({ success: true, server })
      })

      try {
        server.listen(port, host)
      } catch (e) {
        resolve({ success: false, server: null, error: e.message })
      }
    })
  }

  async isPortAvailable(port) {
    const result = await this.tryBindPort(port)
    if (result.success && result.server) {
      await new Promise((resolve) => {
        result.server.close(() => resolve())
      })
      return true
    }
    return false
  }

  async tryAcquirePort(port, owner, timeout = 2000) {
    const startTime = Date.now()
    
    while (Date.now() - startTime < timeout) {
      if (this.allocatedPorts.has(port) || this.reservedPorts.has(port)) {
        return { success: false, reason: 'already-allocated' }
      }

      this.reservedPorts.add(port)
      
      try {
        const bindResult = await this.tryBindPort(port)
        
        if (bindResult.success && bindResult.server) {
          await new Promise((resolve) => {
            bindResult.server.close(() => resolve())
          })
          
          this.allocatedPorts.set(port, {
            owner,
            allocatedAt: Date.now()
          })
          
          return { success: true, port }
        } else {
          return { success: false, reason: bindResult.error || 'port-in-use' }
        }
      } finally {
        this.reservedPorts.delete(port)
      }
    }
    
    return { success: false, reason: 'timeout' }
  }

  async findAndAcquireAvailablePort(startPort = null, owner = null) {
    const start = startPort || this.minPort
    const candidates = []

    for (let port = start; port <= this.maxPort; port++) {
      if (!this.allocatedPorts.has(port) && !this.reservedPorts.has(port)) {
        candidates.push(port)
      }
    }

    for (let port = this.minPort; port < start; port++) {
      if (!this.allocatedPorts.has(port) && !this.reservedPorts.has(port)) {
        candidates.push(port)
      }
    }

    for (const port of candidates) {
      const result = await this.tryAcquirePort(port, owner)
      if (result.success) {
        return result
      }
      if (result.reason === 'timeout') {
        break
      }
    }

    return { success: false, reason: 'no-available-port' }
  }

  async allocate(preferredPort = null, owner = null) {
    return this.mutex.withLock(async () => {
      if (preferredPort !== null && preferredPort !== undefined) {
        const numPort = parseInt(preferredPort, 10)
        
        if (!isNaN(numPort) && numPort >= this.minPort && numPort <= this.maxPort) {
          const result = await this.tryAcquirePort(numPort, owner)
          if (result.success) {
            this.emit('allocate', numPort, owner)
            return numPort
          }
        }
      }

      const autoResult = await this.findAndAcquireAvailablePort(null, owner)
      if (autoResult.success) {
        this.emit('allocate', autoResult.port, owner)
        return autoResult.port
      }

      throw new Error(`没有可用的端口 (范围: ${this.minPort}-${this.maxPort})`)
    })
  }

  release(port) {
    const numPort = parseInt(port, 10)
    if (isNaN(numPort)) return false
    
    if (this.allocatedPorts.has(numPort)) {
      const info = this.allocatedPorts.get(numPort)
      this.allocatedPorts.delete(numPort)
      this.emit('release', numPort, info.owner)
      return true
    }
    return false
  }

  isAllocated(port) {
    const numPort = parseInt(port, 10)
    return !isNaN(numPort) && this.allocatedPorts.has(numPort)
  }

  async verifyPortStillAvailable(port) {
    const numPort = parseInt(port, 10)
    if (isNaN(numPort)) return false
    
    if (this.allocatedPorts.has(numPort)) {
      return true
    }
    
    return this.isPortAvailable(numPort)
  }

  async reconcileWithSystem(activePorts = []) {
    const systemPorts = new Set(activePorts.map(p => parseInt(p, 10)).filter(p => !isNaN(p)))
    const conflicts = []

    for (const [port, info] of this.allocatedPorts.entries()) {
      if (systemPorts.has(port)) {
        const actuallyAvailable = await this.isPortAvailable(port)
        if (!actuallyAvailable) {
          conflicts.push({
            port,
            owner: info.owner,
            allocatedAt: info.allocatedAt
          })
        }
      }
    }

    return conflicts
  }

  getStatus() {
    const total = this.maxPort - this.minPort + 1
    const allocated = this.allocatedPorts.size
    const allocatedList = Array.from(this.allocatedPorts.entries()).map(([port, info]) => ({
      port,
      owner: info.owner,
      allocatedAt: info.allocatedAt
    }))

    return {
      minPort: this.minPort,
      maxPort: this.maxPort,
      total,
      allocated,
      available: total - allocated,
      reserved: this.reservedPorts.size,
      allocatedPorts: allocatedList
    }
  }

  setRange(min, max) {
    if (typeof min !== 'number' || typeof max !== 'number' || min < 1024 || max > 65535 || min >= max) {
      throw new Error('无效的端口范围')
    }
    this.minPort = min
    this.maxPort = max
    this.emit('range-change', min, max)
  }

  clear() {
    this.allocatedPorts.clear()
    this.reservedPorts.clear()
    this.emit('clear')
  }
}

let portPoolInstance = null

function initPortPool() {
  if (!portPoolInstance) {
    portPoolInstance = new PortPool()
  }
  return portPoolInstance
}

function getPortPool() {
  return portPoolInstance
}

module.exports = { initPortPool, getPortPool, AsyncMutex }
