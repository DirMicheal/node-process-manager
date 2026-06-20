const { spawn } = require('child_process')
const { EventEmitter } = require('events')
const { v4: uuidv4 } = require('uuid')
const treeKill = require('tree-kill')
const path = require('path')
const fs = require('fs')
const { initSecurityValidator } = require('./securityValidator')
const { AsyncMutex } = require('./portPool')

class ProcessManager extends EventEmitter {
  constructor(logger, portPool, conflictResolver) {
    super()
    this.processes = new Map()
    this.logger = logger
    this.portPool = portPool
    this.conflictResolver = conflictResolver
    this.configFile = null
    this.validator = initSecurityValidator()
    this.processMutex = new AsyncMutex()
    this.allowedCommands = [
      'node', 'node.exe',
      'npm', 'npm.exe',
      'npx', 'npx.exe',
      'pnpm', 'pnpm.exe',
      'yarn', 'yarn.exe',
      'bun', 'bun.exe',
      'deno', 'deno.exe',
      'tsx', 'tsx.exe',
      'ts-node', 'ts-node.exe'
    ]
  }

  setConfigFile(configPath) {
    this.configFile = configPath
  }

  add(config) {
    const validation = this.validator.validateProcessConfig(config)
    if (!validation.valid) {
      const errorMsg = validation.errors.join('; ')
      throw new Error(`配置验证失败: ${errorMsg}`)
    }

    const sanitized = validation.sanitized
    const id = uuidv4()
    const processConfig = {
      id,
      name: sanitized.name,
      command: sanitized.command,
      args: sanitized.args,
      cwd: sanitized.cwd,
      env: sanitized.env,
      port: sanitized.port,
      autoStart: sanitized.autoStart,
      restartOnCrash: sanitized.restartOnCrash,
      maxRestarts: sanitized.maxRestarts,
      conflictMode: sanitized.conflictMode,
      status: 'stopped',
      pid: null,
      startTime: null,
      restarts: 0,
      lastError: null,
      child: null,
      restartTimer: null
    }

    this.processes.set(id, processConfig)
    this.saveConfig()
    this.emit('status-change')
    
    if (this.logger) {
      this.logger.info(id, `添加进程: ${processConfig.name} [命令: ${processConfig.command}]`)
    }

    return this.sanitizeProcessData(processConfig)
  }

  remove(id) {
    const proc = this.processes.get(id)
    if (!proc) return false

    if (proc.restartTimer) {
      clearTimeout(proc.restartTimer)
      proc.restartTimer = null
    }

    if (proc.status === 'running' || proc.status === 'starting') {
      this._stopSync(id)
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

    const validation = this.validator.validateProcessConfig(config)
    if (!validation.valid) {
      const errorMsg = validation.errors.join('; ')
      throw new Error(`配置验证失败: ${errorMsg}`)
    }

    const wasRunning = proc.status === 'running' || proc.status === 'starting'
    
    if (wasRunning) {
      this._stopSync(id)
    }

    const sanitized = validation.sanitized

    if (proc.port !== sanitized.port && proc.port && this.portPool) {
      this.portPool.release(proc.port)
    }

    Object.assign(proc, {
      name: sanitized.name,
      command: sanitized.command,
      args: sanitized.args,
      cwd: sanitized.cwd,
      env: sanitized.env,
      port: sanitized.port,
      autoStart: sanitized.autoStart,
      restartOnCrash: sanitized.restartOnCrash,
      maxRestarts: sanitized.maxRestarts,
      conflictMode: sanitized.conflictMode,
      status: 'stopped',
      pid: null,
      startTime: null,
      restarts: 0,
      lastError: null,
      child: null
    })

    this.saveConfig()
    this.emit('status-change')

    if (wasRunning) {
      this.start(id).catch(err => {
        if (this.logger) {
          this.logger.error(id, `更新后重启失败: ${err.message}`)
        }
      })
    }

    if (this.logger) {
      this.logger.info(id, `更新进程配置: ${proc.name}`)
    }

    return this.sanitizeProcessData(proc)
  }

  async start(id) {
    return this.processMutex.withLock(async () => {
      const proc = this.processes.get(id)
      if (!proc) return null

      if (proc.status === 'running') {
        return this.sanitizeProcessData(proc)
      }

      try {
        if (proc.port && this.conflictResolver) {
          const conflict = await this.conflictResolver.check(proc.port)
          
          if (conflict.hasConflict) {
            if (proc.conflictMode === 'auto') {
              const result = await this.conflictResolver.resolve(proc.port, 'auto')
              if (result.success && result.newPort) {
                proc.port = result.newPort
                proc.env = { ...proc.env, PORT: String(result.newPort) }
                if (this.logger) {
                  this.logger.info(id, `端口${result.port}冲突，自动切换到端口 ${result.newPort}`)
                }
              }
            } else if (proc.conflictMode === 'force') {
              const result = await this.conflictResolver.resolve(proc.port, 'force')
              if (!result.success) {
                proc.status = 'error'
                proc.lastError = `端口冲突且强制释放失败: ${result.error || '未知错误'}`
                this.emit('status-change')
                if (this.logger) {
                  this.logger.error(id, `端口冲突，强制释放失败: ${result.error}`)
                }
                return this.sanitizeProcessData(proc)
              }
            }
          }
        }

        if (proc.port && this.portPool) {
          try {
            await this.portPool.allocate(proc.port, id)
          } catch (e) {
            const autoPort = await this.portPool.allocate(null, id)
            proc.port = autoPort
            proc.env = { ...proc.env, PORT: String(autoPort) }
            if (this.logger) {
              this.logger.warn(id, `指定端口${proc.port}分配失败，自动使用端口 ${autoPort}`)
            }
          }
        }

        proc.status = 'starting'
        this.emit('status-change')

        const finalEnv = { ...proc.env }
        if (proc.port) {
          finalEnv.PORT = String(proc.port)
        }

        const cleanEnv = this.sanitizeEnvForSpawn(finalEnv)

        const useShell = this.requiresShell(proc.command)
        
        const child = spawn(proc.command, proc.args, {
          cwd: proc.cwd,
          env: cleanEnv,
          stdio: ['ignore', 'pipe', 'pipe'],
          shell: useShell,
          windowsHide: true,
          detached: false
        })

        proc.child = child
        proc.pid = child.pid
        proc.status = 'running'
        proc.startTime = Date.now()
        proc.lastError = null

        let stdoutBuffer = ''
        let stderrBuffer = ''

        child.stdout.on('data', (data) => {
          stdoutBuffer += data.toString()
          const lines = stdoutBuffer.split('\n')
          stdoutBuffer = lines.pop() || ''
          
          for (const line of lines) {
            const trimmed = line.trim()
            if (trimmed) {
              const safeLine = this.sanitizeLogOutput(trimmed)
              if (this.logger) {
                this.logger.info(id, safeLine)
              }
            }
          }
        })

        child.stderr.on('data', (data) => {
          stderrBuffer += data.toString()
          const lines = stderrBuffer.split('\n')
          stderrBuffer = lines.pop() || ''
          
          for (const line of lines) {
            const trimmed = line.trim()
            if (trimmed) {
              const safeLine = this.sanitizeLogOutput(trimmed)
              if (this.logger) {
                this.logger.error(id, safeLine)
              }
            }
          }
        })

        child.on('exit', (code, signal) => {
          if (stdoutBuffer.trim()) {
            const safeLine = this.sanitizeLogOutput(stdoutBuffer.trim())
            if (this.logger) {
              this.logger.info(id, safeLine)
            }
          }
          if (stderrBuffer.trim()) {
            const safeLine = this.sanitizeLogOutput(stderrBuffer.trim())
            if (this.logger) {
              this.logger.error(id, safeLine)
            }
          }

          proc.status = 'stopped'
          proc.pid = null
          proc.startTime = null
          proc.child = null

          if (proc.port && this.portPool) {
            this.portPool.release(proc.port)
          }

          if (code !== 0 && code !== null) {
            proc.lastError = `进程异常退出，退出码: ${code}`
            
            if (proc.restartOnCrash && proc.restarts < proc.maxRestarts) {
              proc.restarts++
              if (this.logger) {
                this.logger.warn(id, `进程异常退出 (code=${code})，正在重启 (${proc.restarts}/${proc.maxRestarts})...`)
              }
              proc.restartTimer = setTimeout(() => {
                proc.restartTimer = null
                this.start(id)
              }, 3000)
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
          proc.child = null
          
          if (proc.port && this.portPool) {
            this.portPool.release(proc.port)
          }

          this.emit('status-change')
          
          if (this.logger) {
            this.logger.error(id, `进程启动失败: ${err.message}`)
          }
        })

        await new Promise((resolve) => setTimeout(resolve, 500))

        this.emit('status-change')
        
        if (this.logger) {
          this.logger.info(id, `进程启动成功，PID: ${child.pid}，端口: ${proc.port || '无'}`)
        }

        return this.sanitizeProcessData(proc)
      } catch (e) {
        proc.status = 'error'
        proc.lastError = e.message
        this.emit('status-change')
        
        if (this.logger) {
          this.logger.error(id, `启动进程失败: ${e.message}`)
        }

        return this.sanitizeProcessData(proc)
      }
    })
  }

  async stop(id) {
    return this.processMutex.withLock(async () => {
      return this._stopSync(id)
    })
  }

  _stopSync(id) {
    const proc = this.processes.get(id)
    if (!proc) return null

    if (proc.restartTimer) {
      clearTimeout(proc.restartTimer)
      proc.restartTimer = null
    }

    if (proc.status !== 'running' && proc.status !== 'starting') {
      proc.status = 'stopped'
      proc.lastError = null
      this.emit('status-change')
      return this.sanitizeProcessData(proc)
    }

    try {
      proc.status = 'stopping'
      this.emit('status-change')

      if (proc.child) {
        try {
          proc.child.stdin?.end()
          proc.child.stdout?.removeAllListeners()
          proc.child.stderr?.removeAllListeners()
          proc.child.removeAllListeners()
        } catch (e) {}

        const pidToKill = proc.pid

        if (pidToKill) {
          treeKill(pidToKill, 'SIGTERM', (err) => {
            if (err) {
              treeKill(pidToKill, 'SIGKILL', () => {})
            }
          })
        }
      }

      proc.status = 'stopped'
      proc.pid = null
      proc.startTime = null
      proc.child = null
      proc.lastError = null

      if (proc.port && this.portPool) {
        this.portPool.release(proc.port)
      }

      this.emit('status-change')
      
      if (this.logger) {
        this.logger.info(id, `进程已停止`)
      }

      return this.sanitizeProcessData(proc)
    } catch (e) {
      proc.status = 'error'
      proc.lastError = e.message
      proc.pid = null
      proc.startTime = null
      proc.child = null
      this.emit('status-change')
      return this.sanitizeProcessData(proc)
    }
  }

  async restart(id) {
    await this.stop(id)
    await new Promise(resolve => setTimeout(resolve, 1000))
    return this.start(id)
  }

  async startAll() {
    const results = []
    for (const [id] of this.processes) {
      const result = await this.start(id)
      results.push(result)
    }
    return results
  }

  async stopAll() {
    const results = []
    for (const [id] of this.processes) {
      const result = await this.stop(id)
      results.push(result)
    }
    return results
  }

  list() {
    return Array.from(this.processes.values()).map(p => this.sanitizeProcessData(p))
  }

  get(id) {
    const proc = this.processes.get(id)
    return proc ? this.sanitizeProcessData(proc) : null
  }

  sanitizeProcessData(proc) {
    const safeEnv = {}
    if (proc.env) {
      const sensitiveKeys = ['PASSWORD', 'SECRET', 'TOKEN', 'KEY', 'APIKEY', 'API_KEY', 'PRIVATE_KEY', 'AUTH']
      for (const [key, value] of Object.entries(proc.env)) {
        if (sensitiveKeys.some(k => key.toUpperCase().includes(k))) {
          safeEnv[key] = '***REDACTED***'
        } else {
          safeEnv[key] = value
        }
      }
    }

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
      lastError: proc.lastError,
      env: safeEnv
    }
  }

  sanitizeEnvForSpawn(env) {
    const result = {}
    const sensitiveKeys = ['PASSWORD', 'SECRET', 'TOKEN', 'KEY', 'APIKEY', 'API_KEY', 'PRIVATE_KEY']
    
    for (const [key, value] of Object.entries(process.env)) {
      if (!sensitiveKeys.some(k => key.toUpperCase().includes(k))) {
        result[key] = value
      }
    }

    for (const [key, value] of Object.entries(env)) {
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        result[key] = String(value)
      }
    }

    return result
  }

  sanitizeLogOutput(line) {
    const patterns = [
      { regex: /(password[=:]\s*)(["']?)([^"'&\s,;]+)(\2)/gi, replacement: '$1$2***REDACTED***$4' },
      { regex: /(passwd[=:]\s*)(["']?)([^"'&\s,;]+)(\2)/gi, replacement: '$1$2***REDACTED***$4' },
      { regex: /(pwd[=:]\s*)(["']?)([^"'&\s,;]+)(\2)/gi, replacement: '$1$2***REDACTED***$4' },
      { regex: /(secret[=:]\s*)(["']?)([^"'&\s,;]+)(\2)/gi, replacement: '$1$2***REDACTED***$4' },
      { regex: /(token[=:]\s*)(["']?)([^"'&\s,;]+)(\2)/gi, replacement: '$1$2***REDACTED***$4' },
      { regex: /(api[_-]?key[=:]\s*)(["']?)([^"'&\s,;]+)(\2)/gi, replacement: '$1$2***REDACTED***$4' },
      { regex: /(apikey[=:]\s*)(["']?)([^"'&\s,;]+)(\2)/gi, replacement: '$1$2***REDACTED***$4' },
      { regex: /(auth[=:]\s*)(["']?)([^"'&\s,;]+)(\2)/gi, replacement: '$1$2***REDACTED***$4' },
      { regex: /(authorization:\s*bearer\s+)([a-zA-Z0-9._\-]+)/gi, replacement: '$1***REDACTED***' },
      { regex: /(sk-[a-zA-Z0-9]{20,})/g, replacement: '***REDACTED***' },
      { regex: /(xox[baprs]-[a-zA-Z0-9-]{10,})/g, replacement: '***REDACTED***' },
      { regex: /(-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----[\s\S]+?-----END (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----)/g, replacement: '***REDACTED PRIVATE KEY***' }
    ]

    let result = line
    for (const { regex, replacement } of patterns) {
      result = result.replace(regex, replacement)
    }
    return result
  }

  requiresShell(command) {
    const cmd = command.toLowerCase().replace(/\.exe$/, '')
    return ['npm', 'npx', 'pnpm', 'yarn'].includes(cmd)
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
      
      fs.writeFileSync(this.configFile, JSON.stringify(data, null, 2), {
        encoding: 'utf8',
        mode: 0o600
      })
    } catch (e) {
      console.error('保存配置失败:', e)
    }
  }

  loadConfig(configFile) {
    this.configFile = configFile
    
    try {
      if (fs.existsSync(configFile)) {
        const rawData = fs.readFileSync(configFile, 'utf8')
        const data = JSON.parse(rawData)
        
        if (!Array.isArray(data)) {
          throw new Error('配置文件格式无效')
        }

        for (const config of data) {
          try {
            const validation = this.validator.validateProcessConfig(config)
            if (validation.valid) {
              const sanitized = validation.sanitized
              const proc = {
                id: sanitized.id || uuidv4(),
                name: sanitized.name,
                command: sanitized.command,
                args: sanitized.args,
                cwd: sanitized.cwd,
                port: sanitized.port,
                autoStart: sanitized.autoStart,
                restartOnCrash: sanitized.restartOnCrash,
                maxRestarts: sanitized.maxRestarts,
                conflictMode: sanitized.conflictMode,
                status: 'stopped',
                pid: null,
                startTime: null,
                restarts: 0,
                lastError: null,
                child: null,
                env: sanitized.env,
                restartTimer: null
              }
              this.processes.set(proc.id, proc)
            }
          } catch (e) {
            console.error(`跳过无效配置: ${e.message}`)
          }
        }
        
        for (const [id, proc] of this.processes) {
          if (proc.autoStart) {
            this.start(id).catch(err => {
              if (this.logger) {
                this.logger.error(id, `自动启动失败: ${err.message}`)
              }
            })
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
