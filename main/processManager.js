const { spawn } = require('child_process')
const { EventEmitter } = require('events')
const { v4: uuidv4 } = require('uuid')
const treeKill = require('tree-kill')
const path = require('path')
const fs = require('fs')

class ProcessManager extends EventEmitter {
  constructor(logger, portPool, conflictResolver) {
    super()
    this.processes = new Map()
    this.logger = logger
    this.portPool = portPool
    this.conflictResolver = conflictResolver
    this.configFile = null
  }

  setConfigFile(configPath) {
    this.configFile = configPath
  }

  add(config) {
    const id = uuidv4()
    const processConfig = {
      id,
      name: config.name || `进程-${id.slice(0, 8)}`,
      command: config.command || 'node',
      args: config.args || [],
      cwd: config.cwd || process.cwd(),
      env: { ...process.env, ...(config.env || {}) },
      port: config.port || null,
      autoStart: config.autoStart || false,
      restartOnCrash: config.restartOnCrash || false,
      maxRestarts: config.maxRestarts || 3,
      conflictMode: config.conflictMode || 'auto',
      status: 'stopped',
      pid: null,
      startTime: null,
      restarts: 0,
      lastError: null
    }

    this.processes.set(id, processConfig)
    this.saveConfig()
    this.emit('status-change')
    
    if (this.logger) {
      this.logger.info(id, `添加进程: ${processConfig.name}`)
    }

    return processConfig
  }

  remove(id) {
    const proc = this.processes.get(id)
    if (!proc) return false

    if (proc.status === 'running') {
      this.stop(id)
    }

    if (proc.port && this.portPool) {
      this.portPool.release(proc.port)
    }

    this.processes.delete(id)
    this.saveConfig()
    this.emit('status-change')

    if (this.logger) {
      this.logger.info(id, `移除进程: ${proc.name}`)
    }

    return true
  }

  update(id, config) {
    const proc = this.processes.get(id)
    if (!proc) return null

    const wasRunning = proc.status === 'running'
    
    if (wasRunning) {
      this.stop(id)
    }

    Object.assign(proc, {
      name: config.name !== undefined ? config.name : proc.name,
      command: config.command !== undefined ? config.command : proc.command,
      args: config.args !== undefined ? config.args : proc.args,
      cwd: config.cwd !== undefined ? config.cwd : proc.cwd,
      env: config.env ? { ...process.env, ...config.env } : proc.env,
      port: config.port !== undefined ? config.port : proc.port,
      autoStart: config.autoStart !== undefined ? config.autoStart : proc.autoStart,
      restartOnCrash: config.restartOnCrash !== undefined ? config.restartOnCrash : proc.restartOnCrash,
      maxRestarts: config.maxRestarts !== undefined ? config.maxRestarts : proc.maxRestarts,
      conflictMode: config.conflictMode !== undefined ? config.conflictMode : proc.conflictMode
    })

    this.saveConfig()
    this.emit('status-change')

    if (wasRunning) {
      this.start(id)
    }

    if (this.logger) {
      this.logger.info(id, `更新进程配置: ${proc.name}`)
    }

    return proc
  }

  async start(id) {
    const proc = this.processes.get(id)
    if (!proc) return null

    if (proc.status === 'running') {
      return proc
    }

    try {
      if (proc.port && this.conflictResolver) {
        const conflict = await this.conflictResolver.check(proc.port)
        
        if (conflict.hasConflict) {
          if (proc.conflictMode === 'auto') {
            const result = await this.conflictResolver.resolve(proc.port, 'auto')
            if (result.success && result.newPort) {
              proc.port = result.newPort
              proc.env.PORT = String(result.newPort)
              if (this.logger) {
                this.logger.info(id, `端口冲突，自动切换到端口 ${result.newPort}`)
              }
            }
          } else if (proc.conflictMode === 'force') {
            const result = await this.conflictResolver.resolve(proc.port, 'force')
            if (!result.success) {
              proc.status = 'error'
              proc.lastError = '端口冲突且强制释放失败'
              this.emit('status-change')
              if (this.logger) {
                this.logger.error(id, `端口冲突，强制释放失败: ${result.error}`)
              }
              return proc
            }
          }
        }
      }

      if (proc.port && this.portPool) {
        await this.portPool.allocate(proc.port, id)
      }

      proc.status = 'starting'
      this.emit('status-change')

      const child = spawn(proc.command, proc.args, {
        cwd: proc.cwd,
        env: proc.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: process.platform === 'win32'
      })

      proc.child = child
      proc.pid = child.pid
      proc.status = 'running'
      proc.startTime = Date.now()
      proc.lastError = null

      child.stdout.on('data', (data) => {
        const message = data.toString().trim()
        if (this.logger) {
          this.logger.info(id, message)
        }
      })

      child.stderr.on('data', (data) => {
        const message = data.toString().trim()
        if (this.logger) {
          this.logger.error(id, message)
        }
      })

      child.on('exit', (code, signal) => {
        proc.status = 'stopped'
        proc.pid = null
        proc.startTime = null

        if (proc.port && this.portPool) {
          this.portPool.release(proc.port)
        }

        if (code !== 0 && code !== null) {
          proc.lastError = `进程异常退出，退出码: ${code}`
          
          if (proc.restartOnCrash && proc.restarts < proc.maxRestarts) {
            proc.restarts++
            if (this.logger) {
              this.logger.warn(id, `进程异常退出，正在重启 (${proc.restarts}/${proc.maxRestarts})...`)
            }
            setTimeout(() => {
              this.start(id)
            }, 2000)
          }
        } else {
          proc.restarts = 0
        }

        this.emit('status-change')
        
        if (this.logger) {
          this.logger.info(id, `进程退出，退出码: ${code}, 信号: ${signal}`)
        }
      })

      child.on('error', (err) => {
        proc.status = 'error'
        proc.lastError = err.message
        proc.pid = null
        proc.startTime = null
        
        if (proc.port && this.portPool) {
          this.portPool.release(proc.port)
        }

        this.emit('status-change')
        
        if (this.logger) {
          this.logger.error(id, `进程启动失败: ${err.message}`)
        }
      })

      this.emit('status-change')
      
      if (this.logger) {
        this.logger.info(id, `进程启动成功，PID: ${child.pid}`)
      }

      return proc
    } catch (e) {
      proc.status = 'error'
      proc.lastError = e.message
      this.emit('status-change')
      
      if (this.logger) {
        this.logger.error(id, `启动进程失败: ${e.message}`)
      }

      return proc
    }
  }

  async stop(id) {
    const proc = this.processes.get(id)
    if (!proc) return null

    if (proc.status !== 'running' || !proc.child) {
      proc.status = 'stopped'
      this.emit('status-change')
      return proc
    }

    try {
      proc.status = 'stopping'
      this.emit('status-change')

      await new Promise((resolve) => {
        treeKill(proc.pid, 'SIGTERM', (err) => {
          if (err) {
            treeKill(proc.pid, 'SIGKILL', () => resolve())
          } else {
            resolve()
          }
        })
      })

      proc.status = 'stopped'
      proc.pid = null
      proc.startTime = null
      proc.child = null

      if (proc.port && this.portPool) {
        this.portPool.release(proc.port)
      }

      this.emit('status-change')
      
      if (this.logger) {
        this.logger.info(id, `进程已停止`)
      }

      return proc
    } catch (e) {
      proc.status = 'error'
      proc.lastError = e.message
      this.emit('status-change')
      return proc
    }
  }

  async restart(id) {
    await this.stop(id)
    await new Promise(resolve => setTimeout(resolve, 500))
    return this.start(id)
  }

  async startAll() {
    const results = []
    for (const [id, proc] of this.processes) {
      if (proc.status !== 'running') {
        const result = await this.start(id)
        results.push(result)
      }
    }
    return results
  }

  async stopAll() {
    const results = []
    for (const [id, proc] of this.processes) {
      if (proc.status === 'running') {
        const result = await this.stop(id)
        results.push(result)
      }
    }
    return results
  }

  list() {
    return Array.from(this.processes.values()).map(p => ({
      id: p.id,
      name: p.name,
      command: p.command,
      args: p.args,
      cwd: p.cwd,
      port: p.port,
      autoStart: p.autoStart,
      restartOnCrash: p.restartOnCrash,
      maxRestarts: p.maxRestarts,
      conflictMode: p.conflictMode,
      status: p.status,
      pid: p.pid,
      startTime: p.startTime,
      restarts: p.restarts,
      lastError: p.lastError
    }))
  }

  get(id) {
    const proc = this.processes.get(id)
    if (!proc) return null
    return {
      id: proc.id,
      name: proc.name,
      command: proc.command,
      args: proc.args,
      cwd: proc.cwd,
      port: proc.port,
      autoStart: proc.autoStart,
      restartOnCrash: proc.restartOnCrash,
      maxRestarts: proc.maxRestarts,
      conflictMode: proc.conflictMode,
      status: proc.status,
      pid: proc.pid,
      startTime: proc.startTime,
      restarts: proc.restarts,
      lastError: proc.lastError
    }
  }

  saveConfig() {
    if (!this.configFile) return
    
    try {
      const data = Array.from(this.processes.values()).map(p => ({
        id: p.id,
        name: p.name,
        command: p.command,
        args: p.args,
        cwd: p.cwd,
        port: p.port,
        autoStart: p.autoStart,
        restartOnCrash: p.restartOnCrash,
        maxRestarts: p.maxRestarts,
        conflictMode: p.conflictMode
      }))
      
      fs.writeFileSync(this.configFile, JSON.stringify(data, null, 2), 'utf8')
    } catch (e) {
      console.error('保存配置失败:', e)
    }
  }

  loadConfig(configFile) {
    this.configFile = configFile
    
    try {
      if (fs.existsSync(configFile)) {
        const data = JSON.parse(fs.readFileSync(configFile, 'utf8'))
        for (const config of data) {
          const proc = {
            ...config,
            status: 'stopped',
            pid: null,
            startTime: null,
            restarts: 0,
            lastError: null,
            env: { ...process.env }
          }
          this.processes.set(config.id, proc)
        }
        
        for (const [id, proc] of this.processes) {
          if (proc.autoStart) {
            this.start(id)
          }
        }
      }
    } catch (e) {
      console.error('加载配置失败:', e)
    }
  }
}

let managerInstance = null

function initProcessManager(logger, portPool, conflictResolver) {
  if (!managerInstance) {
    managerInstance = new ProcessManager(logger, portPool, conflictResolver)
  }
  return managerInstance
}

function getProcessManager() {
  return managerInstance
}

module.exports = { initProcessManager, getProcessManager }
