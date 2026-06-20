const net = require('net')
const { EventEmitter } = require('events')

class PortPool extends EventEmitter {
  constructor() {
    super()
    this.minPort = 3000
    this.maxPort = 4000
    this.allocatedPorts = new Map()
    this.availablePorts = []
    this.initPool()
  }

  initPool() {
    for (let port = this.minPort; port <= this.maxPort; port++) {
      this.availablePorts.push(port)
    }
  }

  async isPortAvailable(port) {
    return new Promise((resolve) => {
      const server = net.createServer()
      
      server.once('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          resolve(false)
        } else {
          resolve(false)
        }
      })

      server.once('listening', () => {
        server.close()
        resolve(true)
      })

      server.listen(port, '127.0.0.1')
    })
  }

  async findAvailablePort(startPort = null) {
    const start = startPort || this.minPort
    
    for (let port = start; port <= this.maxPort; port++) {
      if (!this.allocatedPorts.has(port)) {
        const available = await this.isPortAvailable(port)
        if (available) {
          return port
        }
      }
    }

    for (let port = this.minPort; port < start; port++) {
      if (!this.allocatedPorts.has(port)) {
        const available = await this.isPortAvailable(port)
        if (available) {
          return port
        }
      }
    }

    return null
  }

  async allocate(preferredPort = null, owner = null) {
    if (preferredPort) {
      const available = await this.isPortAvailable(preferredPort)
      if (available && !this.allocatedPorts.has(preferredPort)) {
        this.allocatedPorts.set(preferredPort, {
          owner,
          allocatedAt: Date.now()
        })
        this.emit('allocate', preferredPort, owner)
        return preferredPort
      }
    }

    const port = await this.findAvailablePort()
    if (port) {
      this.allocatedPorts.set(port, {
        owner,
        allocatedAt: Date.now()
      })
      this.emit('allocate', port, owner)
      return port
    }

    throw new Error('没有可用的端口')
  }

  release(port) {
    if (this.allocatedPorts.has(port)) {
      const info = this.allocatedPorts.get(port)
      this.allocatedPorts.delete(port)
      this.emit('release', port, info.owner)
      return true
    }
    return false
  }

  isAllocated(port) {
    return this.allocatedPorts.has(port)
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
      allocatedPorts: allocatedList
    }
  }

  setRange(min, max) {
    this.minPort = min
    this.maxPort = max
    this.availablePorts = []
    this.initPool()
    this.emit('range-change', min, max)
  }

  clear() {
    this.allocatedPorts.clear()
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

module.exports = { initPortPool, getPortPool }
