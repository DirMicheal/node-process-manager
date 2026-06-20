const fs = require('fs')
const path = require('path')
const { EventEmitter } = require('events')

class Logger extends EventEmitter {
  constructor(logDir) {
    super()
    this.logDir = path.join(logDir, 'logs')
    this.ensureLogDir()
    this.maxLogSize = 5 * 1024 * 1024
  }

  ensureLogDir() {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true })
    }
  }

  getLogFilePath(processId) {
    return path.join(this.logDir, `${processId}.log`)
  }

  getAppLogFilePath() {
    return path.join(this.logDir, 'app.log')
  }

  formatMessage(level, message) {
    const timestamp = new Date().toLocaleString('zh-CN', { hour12: false })
    return `[${timestamp}] [${level.toUpperCase()}] ${message}\n`
  }

  info(processId, message) {
    this.write(processId, 'info', message)
  }

  warn(processId, message) {
    this.write(processId, 'warn', message)
  }

  error(processId, message) {
    this.write(processId, 'error', message)
  }

  debug(processId, message) {
    this.write(processId, 'debug', message)
  }

  write(processId, level, message) {
    const logLine = this.formatMessage(level, message)
    const logFile = this.getLogFilePath(processId)

    try {
      this.rotateIfNeeded(logFile)
      fs.appendFileSync(logFile, logLine, 'utf8')
    } catch (e) {
      console.error('Failed to write log:', e)
    }

    this.emit('log', processId, level, message)
  }

  rotateIfNeeded(logFile) {
    try {
      if (fs.existsSync(logFile)) {
        const stats = fs.statSync(logFile)
        if (stats.size > this.maxLogSize) {
          const rotatedFile = logFile + '.1'
          if (fs.existsSync(rotatedFile)) {
            fs.unlinkSync(rotatedFile)
          }
          fs.renameSync(logFile, rotatedFile)
        }
      }
    } catch (e) {
      console.error('Log rotation error:', e)
    }
  }

  getProcessLogs(processId, lines = 100) {
    const logFile = this.getLogFilePath(processId)
    if (!fs.existsSync(logFile)) {
      return []
    }

    try {
      const content = fs.readFileSync(logFile, 'utf8')
      const allLines = content.split('\n').filter(line => line.trim())
      return allLines.slice(-lines)
    } catch (e) {
      console.error('Failed to read logs:', e)
      return []
    }
  }

  clearProcessLogs(processId) {
    const logFile = this.getLogFilePath(processId)
    try {
      if (fs.existsSync(logFile)) {
        fs.writeFileSync(logFile, '', 'utf8')
      }
    } catch (e) {
      console.error('Failed to clear logs:', e)
    }
  }

  getLogDir() {
    return this.logDir
  }
}

let loggerInstance = null

function initLogger(logDir) {
  if (!loggerInstance) {
    loggerInstance = new Logger(logDir)
  }
  return loggerInstance
}

function getLogger() {
  return loggerInstance
}

module.exports = { initLogger, getLogger }
