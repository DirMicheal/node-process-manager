const { exec } = require('child_process')
const { EventEmitter } = require('events')
const util = require('util')
const execAsync = util.promisify(exec)

class SystemProcessScanner extends EventEmitter {
  constructor() {
    super()
    this.nodeProcessPatterns = [
      'node.exe',
      'node',
      'nodejs.exe',
      'npm.exe',
      'npm',
      'npx.exe',
      'npx',
      'pnpm.exe',
      'pnpm',
      'yarn.exe',
      'yarn',
      'bun.exe',
      'bun',
      'deno.exe',
      'deno'
    ]
  }

  async getAllNodeProcesses() {
    try {
      const processes = await this.scanProcesses()
      const withPorts = await this.enrichWithPorts(processes)
      this.emit('scan-complete', withPorts)
      return withPorts
    } catch (e) {
      this.emit('scan-error', e)
      throw e
    }
  }

  async scanProcesses() {
    try {
      const cmd = 'wmic process where "name=\'node.exe\' or name=\'nodejs.exe\' or name=\'npm.exe\' or name=\'npx.exe\' or name=\'pnpm.exe\' or name=\'yarn.exe\' or name=\'bun.exe\' or name=\'deno.exe\'" get ProcessId,Name,CommandLine,ExecutablePath /format:csv'
      
      const { stdout } = await execAsync(cmd, {
        windowsHide: true,
        maxBuffer: 10 * 1024 * 1024,
        timeout: 10000
      })

      return this.parseWmicCsv(stdout)
    } catch (e) {
      return this.scanProcessesFallback()
    }
  }

  parseWmicCsv(stdout) {
    const lines = stdout.trim().split('\n').filter(line => line.trim())
    if (lines.length < 2) return []

    const headers = lines[0].split(',').map(h => h.trim())
    const results = []

    for (let i = 1; i < lines.length; i++) {
      const values = this.parseCsvLine(lines[i])
      if (values.length >= headers.length) {
        const proc = {}
        headers.forEach((header, idx) => {
          proc[header.trim()] = (values[idx] || '').trim()
        })
        
        const pid = parseInt(proc.ProcessId, 10)
        if (pid && !isNaN(pid)) {
          results.push({
            pid,
            name: proc.Name || '',
            commandLine: proc.CommandLine || '',
            executablePath: proc.ExecutablePath || '',
            managedByApp: false
          })
        }
      }
    }

    return results
  }

  parseCsvLine(line) {
    const result = []
    let current = ''
    let inQuotes = false
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i]
      if (char === '"') {
        inQuotes = !inQuotes
      } else if (char === ',' && !inQuotes) {
        result.push(current)
        current = ''
      } else {
        current += char
      }
    }
    result.push(current)
    return result
  }

  async scanProcessesFallback() {
    try {
      const patterns = this.nodeProcessPatterns.join(',')
      const cmd = `tasklist /FO CSV /V /FI "IMAGENAME eq node.exe" /FI "IMAGENAME eq nodejs.exe" /FI "IMAGENAME eq npm.exe" /FI "IMAGENAME eq npx.exe" /FI "IMAGENAME eq pnpm.exe" /FI "IMAGENAME eq yarn.exe"`
      const { stdout } = await execAsync(cmd, {
        windowsHide: true,
        maxBuffer: 5 * 1024 * 1024,
        timeout: 10000
      })

      const lines = stdout.trim().split('\n')
      if (lines.length < 2) return []

      const results = []
      for (let i = 1; i < lines.length; i++) {
        const values = this.parseCsvLine(lines[i])
        if (values.length >= 2) {
          const pid = parseInt(values[1], 10)
          if (pid && !isNaN(pid)) {
            results.push({
              pid,
              name: values[0] ? values[0].replace(/"/g, '') : '',
              commandLine: values.length >= 9 ? values[8].replace(/"/g, '') : '',
              executablePath: '',
              managedByApp: false
            })
          }
        }
      }
      return results
    } catch (e) {
      return []
    }
  }

  async enrichWithPorts(processes) {
    const portMap = await this.getAllListeningPorts()
    
    return processes.map(proc => {
      const ports = portMap.get(proc.pid) || []
      return {
        ...proc,
        ports,
        primaryPort: ports.length > 0 ? ports[0] : null
      }
    })
  }

  async getAllListeningPorts() {
    const portMap = new Map()
    
    try {
      const cmd = 'netstat -ano -p TCP'
      const { stdout } = await execAsync(cmd, {
        windowsHide: true,
        maxBuffer: 10 * 1024 * 1024,
        timeout: 10000
      })

      const lines = stdout.split('\n')
      
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('Active') || trimmed.startsWith('Proto')) {
          continue
        }

        const parts = trimmed.split(/\s+/)
        if (parts.length >= 5 && parts[0] === 'TCP') {
          const state = parts[3]
          const pid = parseInt(parts[4], 10)
          
          if (pid && !isNaN(pid) && (state === 'LISTENING' || state === 'ESTABLISHED')) {
            const localAddress = parts[1]
            const portMatch = localAddress.match(/:(\d+)$/)
            if (portMatch) {
              const port = parseInt(portMatch[1], 10)
              if (!portMap.has(pid)) {
                portMap.set(pid, [])
              }
              const ports = portMap.get(pid)
              if (!ports.includes(port)) {
                ports.push(port)
              }
            }
          }
        }
      }
    } catch (e) {
      console.error('获取端口信息失败:', e)
    }

    try {
      const cmd = 'netstat -ano -p UDP'
      const { stdout } = await execAsync(cmd, {
        windowsHide: true,
        maxBuffer: 10 * 1024 * 1024,
        timeout: 10000
      })

      const lines = stdout.split('\n')
      
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('Active') || trimmed.startsWith('Proto')) {
          continue
        }

        const parts = trimmed.split(/\s+/)
        if (parts.length >= 4 && parts[0] === 'UDP') {
          const pid = parseInt(parts[3], 10)
          
          if (pid && !isNaN(pid)) {
            const localAddress = parts[1]
            const portMatch = localAddress.match(/:(\d+)$/)
            if (portMatch) {
              const port = parseInt(portMatch[1], 10)
              if (!portMap.has(pid)) {
                portMap.set(pid, [])
              }
              const ports = portMap.get(pid)
              if (!ports.includes(port)) {
                ports.push(port)
              }
            }
          }
        }
      }
    } catch (e) {
      console.error('获取UDP端口信息失败:', e)
    }

    return portMap
  }

  async killProcess(pid, force = true) {
    try {
      const cmd = force ? `taskkill /F /PID ${pid}` : `taskkill /PID ${pid}`
      const { stderr } = await execAsync(cmd, {
        windowsHide: true,
        timeout: 10000
      })
      if (stderr && stderr.trim()) {
        return { success: false, error: stderr.trim() }
      }
      this.emit('process-killed', pid)
      return { success: true }
    } catch (e) {
      return { success: false, error: e.message }
    }
  }

  extractAppName(commandLine) {
    if (!commandLine) return '未知'
    
    const patterns = [
      /node\s+["']?([^\s"']+\.js)/i,
      /npm\s+run\s+(\S+)/i,
      /npm\s+start/i,
      /node\s+(\S+)/i,
      /["']([^"']+\\([^\\"']+\.js))["']/i,
    ]

    for (const pattern of patterns) {
      const match = commandLine.match(pattern)
      if (match) {
        if (match[1]) {
          const parts = match[1].split(/[\\/]/)
          return parts[parts.length - 1]
        } else if (match[0].includes('start')) {
          return 'npm start'
        }
      }
    }

    return 'Node进程'
  }

  getProcessScript(commandLine) {
    if (!commandLine) return null
    
    const jsMatch = commandLine.match(/["']?([^\s"']+\.js)["']?/i)
    if (jsMatch) return jsMatch[1]
    
    return null
  }
}

let scannerInstance = null

function initSystemProcessScanner() {
  if (!scannerInstance) {
    scannerInstance = new SystemProcessScanner()
  }
  return scannerInstance
}

function getSystemProcessScanner() {
  return scannerInstance
}

module.exports = { initSystemProcessScanner, getSystemProcessScanner }
