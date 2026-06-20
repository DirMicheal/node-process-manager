const { exec } = require('child_process')
const { EventEmitter } = require('events')
const net = require('net')

class ConflictResolver extends EventEmitter {
  constructor(portPool, logger) {
    super()
    this.portPool = portPool
    this.logger = logger
    this.conflicts = new Map()
  }

  async check(port) {
    const isAvailable = await this.isPortAvailable(port)
    if (!isAvailable) {
      const pid = await this.getProcessByPort(port)
      const conflict = {
        port,
        pid,
        detectedAt: Date.now(),
        status: 'detected'
      }
      this.conflicts.set(port, conflict)
      this.emit('conflict-detected', conflict)
      return { hasConflict: true, ...conflict }
    }
    return { hasConflict: false, port }
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

      server.listen(port, '0.0.0.0')
    })
  }

  async getProcessByPort(port) {
    return new Promise((resolve) => {
      const cmd = `netstat -ano | findstr :${port} | findstr LISTENING`
      exec(cmd, (err, stdout) => {
        if (err) {
          resolve(null)
          return
        }
        
        const lines = stdout.trim().split('\n')
        if (lines.length > 0 && lines[0].trim()) {
          const parts = lines[0].trim().split(/\s+/)
          const pid = parts[parts.length - 1]
          resolve(pid)
        } else {
          resolve(null)
        }
      })
    })
  }

  async getProcessInfo(pid) {
    return new Promise((resolve) => {
      if (!pid) {
        resolve(null)
        return
      }
      
      const cmd = `tasklist /FI "PID eq ${pid}" /V /FO CSV`
      exec(cmd, (err, stdout) => {
        if (err) {
          resolve(null)
          return
        }
        
        const lines = stdout.trim().split('\n')
        if (lines.length >= 2) {
          const data = lines[1].split(',').map(s => s.replace(/"/g, ''))
          resolve({
            pid,
            name: data[0],
            memory: data[4],
            windowTitle: data[8] || ''
          })
        } else {
          resolve(null)
        }
      })
    })
  }

  async resolve(port, mode = 'auto') {
    const conflict = await this.check(port)
    
    if (!conflict.hasConflict) {
      return { success: true, port, mode, message: '端口无冲突' }
    }

    switch (mode) {
      case 'auto':
        return this.resolveAuto(port)
      case 'force':
        return this.resolveForce(port)
      default:
        return this.resolveAuto(port)
    }
  }

  async resolveAuto(port) {
    try {
      const newPort = await this.portPool.allocate(null, 'conflict-resolution')
      
      if (this.conflicts.has(port)) {
        const conflict = this.conflicts.get(port)
        conflict.status = 'auto-resolved'
        conflict.newPort = newPort
        conflict.resolvedAt = Date.now()
        this.conflicts.set(port, conflict)
      }

      this.emit('conflict-resolved', {
        port,
        newPort,
        mode: 'auto',
        message: `端口 ${port} 已冲突，自动分配新端口 ${newPort}`
      })

      if (this.logger) {
        this.logger.info('conflict-resolver', `端口${port}冲突，自动分配新端口${newPort}`)
      }

      return {
        success: true,
        port,
        newPort,
        mode: 'auto',
        message: `端口 ${port} 已冲突，自动分配新端口 ${newPort}`
      }
    } catch (e) {
      return {
        success: false,
        port,
        mode: 'auto',
        error: e.message
      }
    }
  }

  async resolveForce(port) {
    try {
      const pid = await this.getProcessByPort(port)
      
      if (!pid) {
        return {
          success: false,
          port,
          mode: 'force',
          error: '未找到占用端口的进程'
        }
      }

      const processInfo = await this.getProcessInfo(pid)
      
      const killed = await this.killProcess(pid)
      
      if (killed) {
        await this.waitForPortFree(port, 5000)
        
        if (this.conflicts.has(port)) {
          const conflict = this.conflicts.get(port)
          conflict.status = 'force-resolved'
          conflict.killedPid = pid
          conflict.processInfo = processInfo
          conflict.resolvedAt = Date.now()
          this.conflicts.set(port, conflict)
        }

        this.emit('conflict-resolved', {
          port,
          pid,
          processInfo,
          mode: 'force',
          message: `已强制终止进程 ${pid} (${processInfo?.name || '未知'})，释放端口 ${port}`
        })

        if (this.logger) {
          this.logger.warn('conflict-resolver', `强制终止进程${pid}，释放端口${port}`)
        }

        return {
          success: true,
          port,
          pid,
          processInfo,
          mode: 'force',
          message: `已强制终止进程 ${pid}，释放端口 ${port}`
        }
      } else {
        return {
          success: false,
          port,
          mode: 'force',
          error: '终止进程失败'
        }
      }
    } catch (e) {
      return {
        success: false,
        port,
        mode: 'force',
        error: e.message
      }
    }
  }

  killProcess(pid) {
    return new Promise((resolve) => {
      const cmd = `taskkill /F /PID ${pid}`
      exec(cmd, (err) => {
        if (err) {
          resolve(false)
        } else {
          resolve(true)
        }
      })
    })
  }

  waitForPortFree(port, timeout = 5000) {
    return new Promise((resolve) => {
      const startTime = Date.now()
      
      const check = async () => {
        const available = await this.isPortAvailable(port)
        if (available) {
          resolve(true)
        } else if (Date.now() - startTime > timeout) {
          resolve(false)
        } else {
          setTimeout(check, 200)
        }
      }
      
      check()
    })
  }

  listConflicts() {
    return Array.from(this.conflicts.values())
  }

  clearConflict(port) {
    this.conflicts.delete(port)
  }

  clearAllConflicts() {
    this.conflicts.clear()
  }
}

let resolverInstance = null

function initConflictResolver(portPool, logger) {
  if (!resolverInstance) {
    resolverInstance = new ConflictResolver(portPool, logger)
  }
  return resolverInstance
}

function getConflictResolver() {
  return resolverInstance
}

module.exports = { initConflictResolver, getConflictResolver }
