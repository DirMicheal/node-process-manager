const path = require('path')

class SecurityValidator {
  constructor() {
    this.dangerousCommands = [
      'rm', 'del', 'format', 'fdisk', 'mkfs', 'dd',
      'shutdown', 'restart', 'reboot', 'poweroff',
      'reg', 'regedit', 'sc', 'net', 'netsh',
      'powershell', 'cmd.exe', 'bash', 'sh', 'zsh',
      'curl', 'wget', 'nc', 'ncat',
      'ftp', 'tftp', 'telnet',
      'mshta', 'rundll32', 'regsvr32'
    ]

    this.dangerousArgsPatterns = [
      /&&/g, /\|\|/g, /;/g, /`/g, /\$\(/g, /\$\{/g,
      /\|/g, />/g, /</g, />>/g,
      /\beval\b/i, /\bexec\b/i, /\bsystem\b/i,
      /[;&|`$><]/g
    ]
  }

  validateCommand(command) {
    if (!command || typeof command !== 'string') {
      return { valid: false, error: '命令不能为空' }
    }

    const trimmed = command.trim()
    if (!trimmed) {
      return { valid: false, error: '命令不能为空' }
    }

    if (trimmed.length > 1000) {
      return { valid: false, error: '命令长度超过限制' }
    }

    const baseName = path.basename(trimmed).toLowerCase()
    const cmdName = trimmed.toLowerCase().split('.')[0].split('\\').pop().split('/').pop()

    for (const dangerous of this.dangerousCommands) {
      if (cmdName === dangerous || baseName === `${dangerous}.exe`) {
        return { valid: false, error: `禁止使用危险命令: ${dangerous}` }
      }
    }

    return { valid: true, sanitized: trimmed }
  }

  validateArgs(args) {
    if (!Array.isArray(args)) {
      return { valid: false, error: '参数必须为数组' }
    }

    const sanitizedArgs = []

    for (let i = 0; i < args.length; i++) {
      const arg = args[i]
      
      if (typeof arg !== 'string') {
        return { valid: false, error: `参数第${i + 1}项必须为字符串` }
      }

      if (arg.length > 10000) {
        return { valid: false, error: `参数第${i + 1}项长度超过限制` }
      }

      let sanitized = arg
      
      for (const pattern of this.dangerousArgsPatterns) {
        if (pattern.test(arg)) {
          return { 
            valid: false, 
            error: `参数第${i + 1}项包含危险字符，禁止注入操作` 
          }
        }
      }

      const controlChars = /[\x00-\x1F\x7F]/.test(arg)
      if (controlChars) {
        return { valid: false, error: `参数第${i + 1}项包含非法控制字符` }
      }

      sanitizedArgs.push(sanitized)
    }

    return { valid: true, sanitized: sanitizedArgs }
  }

  validateCwd(cwd) {
    if (!cwd || typeof cwd !== 'string') {
      return { valid: false, error: '工作目录不能为空' }
    }

    const trimmed = cwd.trim()
    if (!trimmed) {
      return { valid: false, error: '工作目录不能为空' }
    }

    if (trimmed.length > 1000) {
      return { valid: false, error: '工作目录路径过长' }
    }

    const controlChars = /[\x00-\x1F\x7F]/.test(trimmed)
    if (controlChars) {
      return { valid: false, error: '工作目录包含非法控制字符' }
    }

    const pathTraversal = /\.\.\//.test(trimmed) || /\.\.\\/.test(trimmed)
    if (pathTraversal) {
      return { valid: false, error: '工作目录禁止路径穿越' }
    }

    try {
      const normalized = path.normalize(trimmed)
      return { valid: true, sanitized: normalized }
    } catch (e) {
      return { valid: false, error: '工作目录路径格式无效' }
    }
  }

  validatePort(port) {
    if (port === null || port === undefined || port === '') {
      return { valid: true, sanitized: null }
    }

    const numPort = typeof port === 'string' ? parseInt(port, 10) : port

    if (isNaN(numPort)) {
      return { valid: false, error: '端口号必须为数字' }
    }

    if (!Number.isInteger(numPort)) {
      return { valid: false, error: '端口号必须为整数' }
    }

    if (numPort < 1 || numPort > 65535) {
      return { valid: false, error: '端口号必须在1-65535之间' }
    }

    if (numPort < 1024) {
      return { 
        valid: false, 
        error: '禁止使用系统保留端口(1-1023)，请使用1024以上端口' 
      }
    }

    return { valid: true, sanitized: numPort }
  }

  validateName(name) {
    if (!name || typeof name !== 'string') {
      return { valid: false, error: '名称不能为空' }
    }

    const trimmed = name.trim()
    if (!trimmed) {
      return { valid: false, error: '名称不能为空' }
    }

    if (trimmed.length > 100) {
      return { valid: false, error: '名称长度不能超过100个字符' }
    }

    const dangerousChars = /[<>:"/\\|?*\x00-\x1F\x7F]/.test(trimmed)
    if (dangerousChars) {
      return { valid: false, error: '名称包含非法字符' }
    }

    return { valid: true, sanitized: trimmed }
  }

  validateEnv(envObj) {
    if (envObj === null || envObj === undefined) {
      return { valid: true, sanitized: {} }
    }

    if (typeof envObj !== 'object') {
      return { valid: false, error: '环境变量必须为对象' }
    }

    const sanitized = {}
    const sensitiveKeys = ['PASSWORD', 'SECRET', 'TOKEN', 'KEY', 'APIKEY', 'API_KEY', 'PRIVATE_KEY']

    for (const [key, value] of Object.entries(envObj)) {
      if (typeof key !== 'string') {
        return { valid: false, error: '环境变量键必须为字符串' }
      }

      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
        return { valid: false, error: `环境变量键名格式无效: ${key}` }
      }

      if (key.length > 200) {
        return { valid: false, error: `环境变量键名过长: ${key}` }
      }

      if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
        return { valid: false, error: `环境变量 ${key} 的值类型不支持` }
      }

      const strValue = String(value)
      if (strValue.length > 32767) {
        return { valid: false, error: `环境变量 ${key} 的值过长` }
      }

      const controlChars = /[\x00-\x1F\x7F]/.test(strValue)
      if (controlChars && sensitiveKeys.some(k => key.toUpperCase().includes(k))) {
        sanitized[key] = '***REDACTED***'
        continue
      }

      sanitized[key] = strValue
    }

    return { valid: true, sanitized }
  }

  validateProcessConfig(config) {
    const errors = []
    const sanitized = {}

    const nameResult = this.validateName(config.name)
    if (!nameResult.valid) {
      errors.push(nameResult.error)
    } else {
      sanitized.name = nameResult.sanitized
    }

    const cmdResult = this.validateCommand(config.command)
    if (!cmdResult.valid) {
      errors.push(cmdResult.error)
    } else {
      sanitized.command = cmdResult.sanitized
    }

    const argsResult = this.validateArgs(config.args || [])
    if (!argsResult.valid) {
      errors.push(argsResult.error)
    } else {
      sanitized.args = argsResult.sanitized
    }

    const cwdResult = this.validateCwd(config.cwd)
    if (!cwdResult.valid) {
      errors.push(cwdResult.error)
    } else {
      sanitized.cwd = cwdResult.sanitized
    }

    const portResult = this.validatePort(config.port)
    if (!portResult.valid) {
      errors.push(portResult.error)
    } else {
      sanitized.port = portResult.sanitized
    }

    const envResult = this.validateEnv(config.env)
    if (!envResult.valid) {
      errors.push(envResult.error)
    } else {
      sanitized.env = envResult.sanitized
    }

    sanitized.autoStart = Boolean(config.autoStart)
    sanitized.restartOnCrash = Boolean(config.restartOnCrash)
    sanitized.maxRestarts = Math.min(Math.max(parseInt(config.maxRestarts, 10) || 3, 1), 100)
    sanitized.conflictMode = config.conflictMode === 'force' ? 'force' : 'auto'

    if (errors.length > 0) {
      return { valid: false, errors }
    }

    return { valid: true, sanitized }
  }
}

let validatorInstance = null

function initSecurityValidator() {
  if (!validatorInstance) {
    validatorInstance = new SecurityValidator()
  }
  return validatorInstance
}

function getSecurityValidator() {
  return validatorInstance
}

module.exports = { initSecurityValidator, getSecurityValidator }
