const { exec } = require('child_process')
const { EventEmitter } = require('events')
const util = require('util')
const execAsync = util.promisify(exec)

class SystemProcessScanner extends EventEmitter {
  constructor() {
    super()
    this.baseProcessNames = [
      'node.exe', 'nodejs.exe',
      'npm.exe', 'npx.exe',
      'pnpm.exe', 'yarn.exe',
      'bun.exe', 'deno.exe',
      'tsx.exe', 'ts-node.exe'
    ]

    this.devServerKeywords = [
      'vite', 'webpack', 'webpack-dev-server', 'webpack-serve',
      'next', 'next-dev',
      'nuxt',
      'vue-cli-service', '@vue/cli-service',
      'create-react-app', 'react-scripts',
      'ng', '@angular/cli',
      'nest', 'nestjs',
      'strapi',
      'gatsby', 'develop',
      'remix',
      'svelte-kit', 'svelte',
      'astro',
      'express', 'koa', 'fastify', 'hapi', 'egg',
      'ts-node-dev', 'nodemon', 'tsx watch', 'tsx',
      'esbuild', 'rollup', 'parcel', 'snowpack',
      'dev', 'serve', 'start', 'watch',
      'http-server', 'live-server', 'browser-sync',
      'electron', 'electron-vite',
      'metro', 'expo', 'react-native',
      'storybook',
      'graphql', 'apollo-server',
      'prisma',
      'supabase'
    ]

    this.commonDevPorts = [
      3000, 3001, 3002, 3003, 3004, 3005, 3006, 3007, 3008, 3009, 3010,
      3030, 3031,
      4000, 4001, 4002, 4003, 4004, 4005, 4006, 4007, 4008, 4009, 4010,
      4200, 4300,
      5000, 5001, 5002, 5003, 5004, 5005, 5006, 5007, 5008, 5009, 5010,
      5173, 5174, 5175, 5176, 5177, 5178, 5179,
      5180, 5181, 5182,
      5500, 5501,
      6006, 6007,
      7000, 7001, 7002, 7003, 7004, 7005,
      8000, 8001, 8002, 8003, 8004, 8005, 8006, 8007, 8008, 8009, 8010,
      8080, 8081, 8082, 8083, 8084, 8085, 8086, 8087, 8088, 8089, 8090,
      8888, 8887, 8886, 8885,
      9000, 9001, 9002, 9003, 9004, 9005, 9006, 9007, 9008, 9009, 9010,
      9011, 9012, 9013, 9014, 9015,
      1337, 8443, 24678, 24679, 24680,
      1420, 1421, 1422,
      3333, 3334, 3335,
      5173, 5174, 5175, 5176, 5177, 5178, 5179, 5180, 5181, 5182, 5183, 5184, 5185,
      5678, 5679,
      7777, 7778,
      1234, 1235,
      5353,
      8787, 8788
    ]
  }

  async execSafe(cmd, options = {}) {
    try {
      const finalOpts = {
        windowsHide: true,
        maxBuffer: 30 * 1024 * 1024,
        timeout: 15000,
        encoding: 'utf8',
        ...options
      }
      const result = await execAsync(cmd, finalOpts)
      return { stdout: result.stdout || '', stderr: result.stderr || '' }
    } catch (e) {
      return { stdout: e.stdout || '', stderr: e.stderr || '', error: e }
    }
  }

  async execWithUtf8(cmd, options = {}) {
    const utf8Cmd = `chcp 65001 >nul 2>&1 && ${cmd}`
    return this.execSafe(utf8Cmd, options)
  }

  async getAllNodeProcesses() {
    try {
      const allProcesses = new Map()

      const strategies = [
        this.scanByProcessNames(),
        this.scanByBruteForceNode(),
        this.scanByCommandKeywords(),
        this.scanByAllPorts(),
        this.scanByCommonPorts(),
        this.scanByCmdProcesses(),
        this.scanByTasklist()
      ]

      const results = await Promise.allSettled(strategies)
      
      results.forEach((result, idx) => {
        if (result.status === 'fulfilled' && Array.isArray(result.value)) {
          result.value.forEach(proc => {
            if (proc && proc.pid && !allProcesses.has(proc.pid)) {
              allProcesses.set(proc.pid, proc)
            }
          })
        }
      })

      const processList = Array.from(allProcesses.values())
      const withPorts = await this.enrichWithPorts(processList)
      
      const filtered = withPorts.filter(p => this.isRelevantProcess(p))
      
      const enriched = filtered.map(proc => ({
        ...proc,
        appName: this.extractAppName(proc.commandLine),
        script: this.getProcessScript(proc.commandLine)
      }))

      this.emit('scan-complete', enriched)
      return enriched
    } catch (e) {
      this.emit('scan-error', e)
      throw e
    }
  }

  isRelevantProcess(proc) {
    const name = (proc.name || '').toLowerCase()
    const cmd = (proc.commandLine || '').toLowerCase()
    const ports = proc.ports || []
    const exePath = (proc.executablePath || '').toLowerCase()

    if (!name) return false

    for (const baseName of this.baseProcessNames) {
      if (name === baseName) return true
    }

    if (exePath.includes('node.exe') || exePath.includes('nodejs.exe')) {
      return true
    }

    if (name === 'node.exe' || name === 'node') {
      return true
    }

    if (cmd.includes('node.exe') || cmd.includes('node ') || cmd.includes('"node"')) {
      return true
    }

    if (cmd.includes('node_modules')) {
      return true
    }

    if (name.endsWith('.cmd') || name.endsWith('.bat')) {
      for (const kw of this.devServerKeywords) {
        if (cmd.includes(kw)) return true
      }
    }

    if (ports.length > 0) {
      for (const p of ports) {
        if (this.commonDevPorts.includes(p)) return true
        if (p >= 3000 && p <= 10000) return true
      }
    }

    if (cmd.length > 0) {
      for (const kw of this.devServerKeywords) {
        if (cmd.includes(' ' + kw) || cmd.includes('\\' + kw) || cmd.includes('/' + kw) ||
            cmd.includes('"' + kw) || cmd.startsWith(kw + ' ') ||
            cmd.includes(kw + '.js') || cmd.includes(kw + '.cmd') ||
            cmd.includes(kw + '.exe') || cmd.includes('bin/' + kw) ||
            cmd.includes('bin\\' + kw)) {
          return true
        }
      }
    }

    if (name === 'cmd.exe' || name === 'powershell.exe' || name === 'pwsh.exe') {
      for (const kw of this.devServerKeywords) {
        if (cmd.includes(kw)) return true
      }
    }

    return false
  }

  async scanByProcessNames() {
    const names = this.baseProcessNames
      .map(n => `name='${n}'`)
      .join(' or ')

    try {
      const cmd = `wmic process where "${names}" get ProcessId,Name,CommandLine,ExecutablePath,ParentProcessId /format:csv`
      
      const { stdout } = await this.execWithUtf8(cmd)
      return this.parseWmicCsv(stdout)
    } catch (e) {
      return []
    }
  }

  async scanByBruteForceNode() {
    try {
      const cmd = `wmic process where "name='node.exe'" get ProcessId,Name,CommandLine,ExecutablePath,ParentProcessId /format:csv`
      
      const { stdout } = await this.execWithUtf8(cmd)
      const results = this.parseWmicCsv(stdout)

      if (results.length > 0) {
        return results
      }

      const fallbackCmd = `tasklist /fi "imagename eq node.exe" /v /fo csv /nh`
      const { stdout: fallbackStdout } = await this.execSafe(fallbackCmd)
      return this.parseTasklistCsv(fallbackStdout)
    } catch (e) {
      return []
    }
  }

  async scanByCommandKeywords() {
    const keywords = [
      'vite', 'webpack', 'next', 'nuxt', 'react-scripts', 'vue-cli-service',
      'nodemon', 'ts-node', 'tsx', 'nest', 'gatsby', 'remix', 'svelte-kit',
      'astro', 'express', 'strapi', 'storybook', 'metro', 'expo',
      'esbuild', 'parcel', 'rollup', 'snowpack', 'koa', 'fastify',
      'http-server', 'live-server', 'browser-sync', 'electron-vite',
      'node_modules', 'npm run', 'pnpm run', 'yarn dev', 'yarn start',
      '.bin\\vite', '.bin\\webpack', '.bin\\next', '.bin\\nuxt'
    ]

    const allResults = []
    const seenPids = new Set()

    for (const kw of keywords) {
      try {
        const escapedKw = kw.replace(/'/g, "\\'")
        const cmd = `wmic process where "CommandLine like '%${escapedKw}%'" get ProcessId,Name,CommandLine,ExecutablePath,ParentProcessId /format:csv`
        
        const { stdout } = await this.execWithUtf8(cmd, { timeout: 8000 })
        const parsed = this.parseWmicCsv(stdout)
        
        for (const p of parsed) {
          if (!seenPids.has(p.pid)) {
            seenPids.add(p.pid)
            allResults.push(p)
          }
        }
      } catch (e) {
      }
    }

    return allResults
  }

  async scanByAllPorts() {
    try {
      const allListening = await this.getAllListeningPorts()
      const pids = Array.from(allListening.keys()).filter(p => p > 4 && p < 99999)
      
      if (pids.length === 0) return []

      const portToPid = {}
      for (const [pid, ports] of allListening.entries()) {
        for (const port of ports) {
          if (port >= 1024 && port <= 65535) {
            if (!portToPid[port]) portToPid[port] = []
            if (!portToPid[port].includes(pid)) portToPid[port].push(pid)
          }
        }
      }

      const devPortPids = new Set()
      for (const [port, pidsArr] of Object.entries(portToPid)) {
        const pNum = parseInt(port, 10)
        if (this.commonDevPorts.includes(pNum) || (pNum >= 3000 && pNum <= 10000)) {
          pidsArr.forEach(p => devPortPids.add(p))
        }
      }

      if (devPortPids.size === 0) return []

      const pidList = Array.from(devPortPids)
        .map(p => `ProcessId=${p}`)
        .join(' or ')

      const cmd = `wmic process where "${pidList}" get ProcessId,Name,CommandLine,ExecutablePath,ParentProcessId /format:csv`
      const { stdout } = await this.execWithUtf8(cmd)
      
      let processes = this.parseWmicCsv(stdout)

      const parentPids = processes
        .map(p => p.parentProcessId)
        .filter(ppid => ppid && ppid > 4)
      
      if (parentPids.length > 0) {
        const parentPidList = parentPids
          .slice(0, 50)
          .map(p => `ProcessId=${p}`)
          .join(' or ')

        try {
          const parentCmd = `wmic process where "${parentPidList}" get ProcessId,Name,CommandLine,ExecutablePath,ParentProcessId /format:csv`
          const { stdout: parentStdout } = await this.execWithUtf8(parentCmd, { timeout: 10000 })
          processes = [...processes, ...this.parseWmicCsv(parentStdout)]
        } catch (e) {}
      }

      const childPids = []
      for (const proc of processes) {
        if (proc.name && (proc.name.toLowerCase() === 'cmd.exe' || proc.name.toLowerCase().includes('powershell') ||
            proc.name.toLowerCase() === 'npm.exe' || proc.name.toLowerCase() === 'pnpm.exe' ||
            proc.name.toLowerCase() === 'yarn.exe' || proc.name.toLowerCase() === 'npx.exe')) {
          const children = await this.findChildProcesses(proc.pid)
          childPids.push(...children)
        }
      }

      if (childPids.length > 0) {
        const uniqueChildPids = [...new Set(childPids)]
          .slice(0, 100)
          .map(p => `ProcessId=${p}`)
          .join(' or ')

        try {
          const childCmd = `wmic process where "${uniqueChildPids}" get ProcessId,Name,CommandLine,ExecutablePath,ParentProcessId /format:csv`
          const { stdout: childStdout } = await this.execWithUtf8(childCmd, { timeout: 10000 })
          processes = [...processes, ...this.parseWmicCsv(childStdout)]
        } catch (e) {}
      }

      return processes
    } catch (e) {
      return []
    }
  }

  async findChildProcesses(parentPid) {
    try {
      const cmd = `wmic process where "ParentProcessId=${parentPid}" get ProcessId /format:csv`
      const { stdout } = await this.execWithUtf8(cmd, { timeout: 5000 })
      const lines = stdout.trim().split('\n').filter(l => l.trim())
      const pids = []
      
      for (let i = 1; i < lines.length; i++) {
        const match = lines[i].match(/(\d+)/)
        if (match) {
          pids.push(parseInt(match[1], 10))
        }
      }
      return pids
    } catch (e) {
      return []
    }
  }

  async scanByCommonPorts() {
    try {
      const portToPid = await this.getPidByPorts(this.commonDevPorts)
      const pids = Array.from(new Set(Object.values(portToPid).flat()))
      
      if (pids.length === 0) return []

      const pidList = pids
        .filter(p => p && p > 0 && p < 99999)
        .map(p => `ProcessId=${p}`)
        .join(' or ')

      if (!pidList) return []

      const cmd = `wmic process where "${pidList}" get ProcessId,Name,CommandLine,ExecutablePath,ParentProcessId /format:csv`
      
      const { stdout } = await this.execWithUtf8(cmd)

      let processes = this.parseWmicCsv(stdout)

      const parentPids = processes
        .map(p => p.parentProcessId)
        .filter(ppid => ppid && ppid > 4)
        .slice(0, 30)

      if (parentPids.length > 0) {
        try {
          const parentPidList = parentPids
            .map(p => `ProcessId=${p}`)
            .join(' or ')

          const parentCmd = `wmic process where "${parentPidList}" get ProcessId,Name,CommandLine,ExecutablePath,ParentProcessId /format:csv`
          const { stdout: parentStdout } = await this.execWithUtf8(parentCmd, { timeout: 10000 })
          processes.push(...this.parseWmicCsv(parentStdout))
        } catch (e) {}
      }

      return processes
    } catch (e) {
      return []
    }
  }

  async getPidByPorts(ports) {
    const portToPid = {}
    
    try {
      const { stdout: tcpStdout } = await this.execSafe('netstat -ano -p TCP')

      const lines = (tcpStdout || '').split('\n')
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('Active') || trimmed.startsWith('Proto')) continue

        const parts = trimmed.split(/\s+/)
        if (parts.length >= 5 && parts[0] === 'TCP') {
          const state = parts[3]
          const pid = parseInt(parts[4], 10)
          
          if (pid && !isNaN(pid) && (state === 'LISTENING' || state === 'ESTABLISHED')) {
            const localAddress = parts[1]
            const portMatch = localAddress.match(/:(\d+)$/)
            if (portMatch) {
              const port = parseInt(portMatch[1], 10)
              if (ports.includes(port)) {
                if (!portToPid[port]) portToPid[port] = []
                if (!portToPid[port].includes(pid)) portToPid[port].push(pid)
              }
            }
          }
        }
      }
    } catch (e) {}

    try {
      const { stdout: udpStdout } = await this.execSafe('netstat -ano -p UDP', { timeout: 10000 })

      const lines = (udpStdout || '').split('\n')
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('Active') || trimmed.startsWith('Proto')) continue

        const parts = trimmed.split(/\s+/)
        if (parts.length >= 4 && parts[0] === 'UDP') {
          const pid = parseInt(parts[3], 10)
          
          if (pid && !isNaN(pid)) {
            const localAddress = parts[1]
            const portMatch = localAddress.match(/:(\d+)$/)
            if (portMatch) {
              const port = parseInt(portMatch[1], 10)
              if (ports.includes(port)) {
                if (!portToPid[port]) portToPid[port] = []
                if (!portToPid[port].includes(pid)) portToPid[port].push(pid)
              }
            }
          }
        }
      }
    } catch (e) {}

    return portToPid
  }

  async scanByCmdProcesses() {
    try {
      const cmd = `wmic process where "name='cmd.exe' or name='powershell.exe' or name='pwsh.exe'" get ProcessId,Name,CommandLine,ExecutablePath,ParentProcessId /format:csv`
      
      const { stdout } = await this.execWithUtf8(cmd)

      let processes = this.parseWmicCsv(stdout)

      processes = processes.filter(p => {
        const cmdLine = (p.commandLine || '').toLowerCase()
        return this.devServerKeywords.some(kw => cmdLine.includes(kw))
      })

      const childPids = []
      for (const proc of processes) {
        const children = await this.findChildProcesses(proc.pid)
        childPids.push(...children)
      }

      if (childPids.length > 0) {
        const uniqueChildPids = [...new Set(childPids)]
          .slice(0, 100)
          .map(p => `ProcessId=${p}`)
          .join(' or ')

        try {
          const childCmd = `wmic process where "${uniqueChildPids}" get ProcessId,Name,CommandLine,ExecutablePath,ParentProcessId /format:csv`
          const { stdout: childStdout } = await this.execWithUtf8(childCmd, { timeout: 10000 })
          processes = [...processes, ...this.parseWmicCsv(childStdout)]
        } catch (e) {}
      }

      return processes
    } catch (e) {
      return []
    }
  }

  async scanByTasklist() {
    try {
      const results = []
      
      const nodeCmd = 'tasklist /fi "imagename eq node.exe" /v /fo csv /nh'
      const { stdout: nodeStdout } = await this.execSafe(nodeCmd)
      results.push(...this.parseTasklistCsv(nodeStdout))

      const npmCmd = 'tasklist /fi "imagename eq npm.exe" /v /fo csv /nh'
      const { stdout: npmStdout } = await this.execSafe(npmCmd)
      results.push(...this.parseTasklistCsv(npmStdout))

      const pnpmCmd = 'tasklist /fi "imagename eq pnpm.exe" /v /fo csv /nh'
      const { stdout: pnpmStdout } = await this.execSafe(pnpmCmd)
      results.push(...this.parseTasklistCsv(pnpmStdout))

      return results
    } catch (e) {
      return []
    }
  }

  parseTasklistCsv(stdout) {
    if (!stdout || !stdout.trim()) return []
    
    const lines = stdout.trim().split('\n').filter(line => line.trim())
    const results = []

    for (const line of lines) {
      const values = this.parseCsvLine(line)
      if (values.length >= 2) {
        const name = (values[0] || '').trim()
        const pidStr = (values[1] || '').trim()
        const pid = parseInt(pidStr, 10)
        
        if (name && pid && !isNaN(pid) && pid > 0) {
          const windowTitle = values.length >= 9 ? (values[8] || '').trim() : ''
          
          results.push({
            pid,
            name,
            commandLine: windowTitle,
            executablePath: '',
            parentProcessId: null,
            managedByApp: false
          })
        }
      }
    }

    return results
  }

  parseWmicCsv(stdout) {
    if (!stdout || !stdout.trim()) return []
    
    let content = stdout
    if (content.charCodeAt(0) === 0xFEFF) {
      content = content.slice(1)
    }
    content = content.replace(/\0/g, '')

    const lines = content.split(/\r?\n/).filter(line => line.trim())
    if (lines.length < 2) return []

    let headerLine = lines[0]
    let dataStart = 1

    const nodeIdx = lines.findIndex(l => l.includes('ProcessId') && l.includes('Name'))
    if (nodeIdx > 0) {
      headerLine = lines[nodeIdx]
      dataStart = nodeIdx + 1
    }

    const headers = headerLine.split(',').map(h => h.trim())
    const results = []

    for (let i = dataStart; i < lines.length; i++) {
      const values = this.parseCsvLine(lines[i])
      if (values.length >= headers.length - 1 || values.length >= 3) {
        const proc = {}
        headers.forEach((header, idx) => {
          if (idx < values.length) {
            proc[header.trim()] = (values[idx] || '').trim()
          }
        })
        
        const pid = parseInt(proc.ProcessId, 10)
        const parentProcessId = parseInt(proc.ParentProcessId, 10)
        if (pid && !isNaN(pid) && pid > 0) {
          results.push({
            pid,
            name: proc.Name || '',
            commandLine: proc.CommandLine || '',
            executablePath: proc.ExecutablePath || '',
            parentProcessId: parentProcessId || null,
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
        if (inQuotes && line[i + 1] === '"') {
          current += '"'
          i++
        } else {
          inQuotes = !inQuotes
        }
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

  async enrichWithPorts(processes) {
    const portMap = await this.getAllListeningPorts()
    
    const pids = processes.map(p => p.pid)
    const pidToPorts = new Map()
    
    for (const [pid, ports] of portMap.entries()) {
      if (pids.includes(pid)) {
        pidToPorts.set(pid, ports)
      }
    }

    const parentToChildren = {}
    processes.forEach(p => {
      if (p.parentProcessId) {
        if (!parentToChildren[p.parentProcessId]) parentToChildren[p.parentProcessId] = []
        parentToChildren[p.parentProcessId].push(p.pid)
      }
    })

    const pidToProc = new Map()
    processes.forEach(p => pidToProc.set(p.pid, p))

    return processes.map(proc => {
      let ports = pidToPorts.get(proc.pid) || []
      
      if (ports.length === 0 && parentToChildren[proc.pid]) {
        for (const childPid of parentToChildren[proc.pid]) {
          const childPorts = pidToPorts.get(childPid)
          if (childPorts && childPorts.length > 0) {
            ports = [...ports, ...childPorts]
          }
        }
      }

      if (ports.length === 0 && proc.parentProcessId) {
        let searchDepth = 0
        let currentPid = proc.parentProcessId
        while (searchDepth < 5 && currentPid && currentPid > 4) {
          const parentPorts = pidToPorts.get(currentPid)
          if (parentPorts && parentPorts.length > 0) {
            ports = [...ports, ...parentPorts]
            break
          }
          const currentProc = pidToProc.get(currentPid)
          if (!currentProc || !currentProc.parentProcessId) break
          currentPid = currentProc.parentProcessId
          searchDepth++
        }
      }

      const portSet = new Set(ports)
      ports = Array.from(portSet).sort((a, b) => a - b)

      return {
        ...proc,
        ports,
        primaryPort: ports.length > 0 ? ports[0] : null,
        processType: this.detectProcessType(proc, ports)
      }
    })
  }

  async getAllListeningPorts() {
    const portMap = new Map()
    
    try {
      const cmd = 'netstat -ano -p TCP'
      const { stdout } = await this.execSafe(cmd)

      const lines = (stdout || '').split('\n')
      
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('Active') || trimmed.startsWith('Proto')) {
          continue
        }

        const parts = trimmed.split(/\s+/)
        if (parts.length >= 5 && parts[0] === 'TCP') {
          const state = parts[3]
          const pid = parseInt(parts[4], 10)
          
          if (pid && !isNaN(pid) && state === 'LISTENING') {
            const localAddress = parts[1]
            const portMatch = localAddress.match(/:(\d+)$/)
            if (portMatch) {
              const port = parseInt(portMatch[1], 10)
              if (port > 1023 && port < 65536) {
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
      }
    } catch (e) {
    }

    try {
      const cmd = 'netstat -ano -p UDP'
      const { stdout } = await this.execSafe(cmd, { timeout: 10000 })

      const lines = (stdout || '').split('\n')
      
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
              if (port > 1023 && port < 65536) {
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
      }
    } catch (e) {
    }

    return portMap
  }

  detectProcessType(proc, ports) {
    const name = (proc.name || '').toLowerCase()
    const cmd = (proc.commandLine || '').toLowerCase()
    const type = {
      category: 'general',
      framework: null,
      description: 'Node相关进程'
    }

    if (cmd.includes('vite')) {
      type.category = 'devserver'
      type.framework = 'Vite'
      type.description = 'Vite开发服务器'
    } else if (cmd.includes('next') || cmd.includes('next.js')) {
      type.category = 'devserver'
      type.framework = 'Next.js'
      type.description = 'Next.js开发服务器'
    } else if (cmd.includes('nuxt')) {
      type.category = 'devserver'
      type.framework = 'Nuxt'
      type.description = 'Nuxt开发服务器'
    } else if (cmd.includes('vue-cli-service') || cmd.includes('@vue/cli-service')) {
      type.category = 'devserver'
      type.framework = 'Vue CLI'
      type.description = 'Vue CLI开发服务器'
    } else if (cmd.includes('react-scripts') || cmd.includes('cra') || cmd.includes('create-react-app')) {
      type.category = 'devserver'
      type.framework = 'Create React App'
      type.description = 'CRA开发服务器'
    } else if (cmd.includes('webpack-dev-server') || cmd.includes('webpack serve')) {
      type.category = 'devserver'
      type.framework = 'Webpack'
      type.description = 'Webpack开发服务器'
    } else if (cmd.includes('svelte-kit') || cmd.includes('sveltekit')) {
      type.category = 'devserver'
      type.framework = 'SvelteKit'
      type.description = 'SvelteKit开发服务器'
    } else if (cmd.includes('astro')) {
      type.category = 'devserver'
      type.framework = 'Astro'
      type.description = 'Astro开发服务器'
    } else if (cmd.includes('remix')) {
      type.category = 'devserver'
      type.framework = 'Remix'
      type.description = 'Remix开发服务器'
    } else if (cmd.includes('gatsby')) {
      type.category = 'devserver'
      type.framework = 'Gatsby'
      type.description = 'Gatsby开发服务器'
    } else if (cmd.includes('ng ') || cmd.includes('@angular/cli') || cmd.includes('ng serve')) {
      type.category = 'devserver'
      type.framework = 'Angular'
      type.description = 'Angular开发服务器'
    } else if (cmd.includes('strapi')) {
      type.category = 'devserver'
      type.framework = 'Strapi'
      type.description = 'Strapi CMS'
    } else if (cmd.includes('nest') || cmd.includes('nestjs')) {
      type.category = 'devserver'
      type.framework = 'NestJS'
      type.description = 'NestJS服务器'
    } else if (cmd.includes('storybook')) {
      type.category = 'devserver'
      type.framework = 'Storybook'
      type.description = 'Storybook组件开发'
    } else if (cmd.includes('expo') || cmd.includes('metro') || cmd.includes('react-native')) {
      type.category = 'devserver'
      type.framework = 'React Native / Expo'
      type.description = 'React Native开发'
    } else if (cmd.includes('nodemon') || cmd.includes('ts-node-dev') || cmd.includes('tsx watch')) {
      type.category = 'runner'
      type.framework = '热重载运行器'
      type.description = '代码热重载工具'
    } else if (cmd.includes('express')) {
      type.category = 'server'
      type.framework = 'Express'
      type.description = 'Express服务器'
    } else if (cmd.includes('koa')) {
      type.category = 'server'
      type.framework = 'Koa'
      type.description = 'Koa服务器'
    } else if (cmd.includes('fastify')) {
      type.category = 'server'
      type.framework = 'Fastify'
      type.description = 'Fastify服务器'
    } else if (cmd.includes('egg')) {
      type.category = 'server'
      type.framework = 'Egg.js'
      type.description = 'Egg.js服务器'
    } else if (cmd.includes('prisma')) {
      type.category = 'tool'
      type.framework = 'Prisma'
      type.description = 'Prisma ORM工具'
    } else if (cmd.includes('graphql') || cmd.includes('apollo-server')) {
      type.category = 'server'
      type.framework = 'GraphQL'
      type.description = 'GraphQL服务器'
    } else if (cmd.includes('http-server') || cmd.includes('live-server') || cmd.includes('browser-sync')) {
      type.category = 'devserver'
      type.framework = '静态服务'
      type.description = '静态文件开发服务器'
    } else if (cmd.includes('electron-vite')) {
      type.category = 'devserver'
      type.framework = 'Electron Vite'
      type.description = 'Electron Vite开发工具'
    } else if (cmd.includes('npm') || cmd.includes('pnpm') || cmd.includes('yarn')) {
      if (cmd.includes('run dev') || cmd.includes('run serve') || cmd.includes('run start') ||
          cmd.includes(' dev') || cmd.includes(' start') || cmd.includes(' serve')) {
        type.category = 'devserver'
        type.framework = '包管理器脚本'
        type.description = '通过包管理器启动的开发服务'
      } else {
        type.category = 'runner'
        type.framework = '包管理器'
        type.description = 'npm/pnpm/yarn命令'
      }
    } else if (name === 'node.exe' || name === 'node') {
      if (ports.length > 0) {
        type.category = 'server'
        type.description = 'Node.js服务器进程'
      } else {
        type.category = 'script'
        type.description = 'Node.js脚本'
      }
    }

    if (ports && ports.length > 0 && !type.framework) {
      type.description = `监听端口 ${ports.join(', ')} 的Node进程`
    }

    return type
  }

  async killProcess(pid, force = true) {
    try {
      const cmd = force ? `taskkill /F /PID ${pid}` : `taskkill /PID ${pid}`
      const { stderr } = await this.execSafe(cmd, { timeout: 10000 })
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
    if (!commandLine) return '未知进程'
    
    const patterns = [
      { regex: /vite(\s|$)/i, name: 'Vite Dev Server' },
      { regex: /next\s+dev/i, name: 'Next.js Dev Server' },
      { regex: /nuxt\s+dev/i, name: 'Nuxt Dev Server' },
      { regex: /vue-cli-service\s+serve/i, name: 'Vue Dev Server' },
      { regex: /react-scripts\s+start/i, name: 'Create React App' },
      { regex: /webpack-dev-server/i, name: 'Webpack Dev Server' },
      { regex: /webpack\s+serve/i, name: 'Webpack Dev Server' },
      { regex: /astro\s+dev/i, name: 'Astro Dev Server' },
      { regex: /svelte-kit\s+dev/i, name: 'SvelteKit Dev Server' },
      { regex: /remix\s+dev/i, name: 'Remix Dev Server' },
      { regex: /gatsby\s+develop/i, name: 'Gatsby Dev Server' },
      { regex: /ng\s+serve/i, name: 'Angular Dev Server' },
      { regex: /strapi\s+develop/i, name: 'Strapi Dev Server' },
      { regex: /nest\s+start/i, name: 'NestJS Server' },
      { regex: /storybook/i, name: 'Storybook' },
      { regex: /expo\s+start/i, name: 'Expo Dev Server' },
      { regex: /electron-vite/i, name: 'Electron Vite' },
      { regex: /http-server/i, name: 'HTTP Server' },
      { regex: /live-server/i, name: 'Live Server' },
      { regex: /browser-sync/i, name: 'Browser Sync' },
      { regex: /npm\s+run\s+(\S+)/i, name: 'npm run' },
      { regex: /pnpm\s+(\S+)/i, name: 'pnpm' },
      { regex: /yarn\s+(\S+)/i, name: 'yarn' },
      { regex: /node\s+["']?([^\s"']+\.js)/i, extract: true },
      { regex: /node\s+([^\s]+\.js)/i, extract: true },
      { regex: /ts-node\s+["']?([^\s"']+\.ts)/i, extract: true },
      { regex: /tsx\s+["']?([^\s"']+\.[jt]s)/i, extract: true },
      { regex: /nodemon\s+["']?([^\s"']+\.[jt]s)/i, extract: true },
    ]

    for (const p of patterns) {
      const match = commandLine.match(p.regex)
      if (match) {
        if (p.extract && match[1]) {
          const parts = match[1].split(/[\\/]/)
          return parts[parts.length - 1]
        } else if (p.name) {
          let name = p.name
          if (match[1] && (name === 'npm run' || name === 'pnpm' || name === 'yarn')) {
            name = `${name} ${match[1]}`
          }
          return name
        }
      }
    }

    if (commandLine.toLowerCase().includes('node_modules')) {
      const nmMatch = commandLine.match(/node_modules[\\/]([^\\/"'\s]+)/i)
      if (nmMatch) return nmMatch[1]
    }

    return 'Node进程'
  }

  getProcessScript(commandLine) {
    if (!commandLine) return null
    
    const patterns = [
      /\s([a-zA-Z]:\\[^\s"']+\.[jt]s)/i,
      /\s(\\{2}[^\s"']+\.[jt]s)/i,
      /["']([^"']+\.[jt]s)["']/i,
      /\s([^\s"']+\.[jt]s)\b/i,
      /node_modules[\\/](\S+\.(?:js|mjs|cjs|ts))/i
    ]

    for (const pattern of patterns) {
      const match = commandLine.match(pattern)
      if (match && match[1]) return match[1]
    }
    
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
