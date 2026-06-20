import { useState, useEffect, useRef } from 'react'

function ProcessDetail({ process, onStart, onStop, onRestart, onEdit, onDelete }) {
  const [logs, setLogs] = useState([])
  const logRef = useRef(null)
  const logsEndRef = useRef(null)

  useEffect(() => {
    loadLogs()
    const interval = setInterval(loadLogs, 2000)
    return () => clearInterval(interval)
  }, [process.id])

  useEffect(() => {
    if (window.electronAPI?.process) {
      const unsubscribe = window.electronAPI.process.onLog((_, id) => {
        if (id === process.id) {
          loadLogs()
        }
      })
      return unsubscribe
    }
  }, [process.id])

  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollTop = logsEndRef.current.scrollHeight
    }
  }, [logs])

  const loadLogs = async () => {
    if (window.electronAPI?.process) {
      const logLines = await window.electronAPI.process.logs(process.id, 200)
      setLogs(logLines)
    }
  }

  const parseLogLine = (line) => {
    const levelMatch = line.match(/\[([A-Z]+)\]/)
    let level = 'info'
    if (levelMatch) {
      const l = levelMatch[1].toLowerCase()
      if (['info', 'warn', 'error', 'debug'].includes(l)) {
        level = l
      }
    }
    return { text: line, level }
  }

  const getUptime = () => {
    if (!process.startTime) return '—'
    const diff = Date.now() - process.startTime
    const hours = Math.floor(diff / 3600000)
    const minutes = Math.floor((diff % 3600000) / 60000)
    const seconds = Math.floor((diff % 60000) / 1000)
    if (hours > 0) {
      return `${hours}小时${minutes}分${seconds}秒`
    } else if (minutes > 0) {
      return `${minutes}分${seconds}秒`
    } else {
      return `${seconds}秒`
    }
  }

  const isRunning = process.status === 'running'
  const isStarting = process.status === 'starting'
  const isStopping = process.status === 'stopping'
  const isStopped = process.status === 'stopped' || process.status === 'error'

  return (
    <>
      <div className="detail-header">
        <div className="detail-title">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
            <span className={`status-dot ${process.status}`} style={{ width: '10px', height: '10px' }}></span>
            {process.name}
          </span>
        </div>
        <div className="detail-actions">
          {isStopped && (
            <button
              className="btn btn-success"
              onClick={() => onStart(process.id)}
            >
              ▶ 启动
            </button>
          )}
          {isRunning && (
            <>
              <button
                className="btn btn-warning"
                onClick={() => onRestart(process.id)}
              >
                ↻ 重启
              </button>
              <button
                className="btn btn-danger"
                onClick={() => onStop(process.id)}
                disabled={isStopping}
              >
                {isStopping ? '停止中...' : '■ 停止'}
              </button>
            </>
          )}
          {isStarting && (
            <button className="btn btn-warning" disabled>
              启动中...
            </button>
          )}
          <button className="btn btn-default" onClick={() => onEdit(process)}>
            ✎ 编辑
          </button>
          <button className="btn btn-danger" onClick={() => onDelete(process.id)}>
            🗑 删除
          </button>
        </div>
      </div>

      <div className="detail-body">
        <div className="config-section">
          <h3>基本信息</h3>
          <div className="form-row">
            <div className="form-group">
              <label>进程名称</label>
              <input type="text" value={process.name} readOnly />
            </div>
            <div className="form-group">
              <label>状态</label>
              <input type="text" value={
                { running: '运行中', stopped: '已停止', starting: '启动中', stopping: '停止中', error: '错误' }[process.status] || process.status
              } readOnly />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>PID</label>
              <input type="text" value={process.pid || '—'} readOnly />
            </div>
            <div className="form-group">
              <label>运行时长</label>
              <input type="text" value={getUptime()} readOnly />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>端口</label>
              <input type="text" value={process.port || '—'} readOnly />
            </div>
            <div className="form-group">
              <label>冲突处理模式</label>
              <input
                type="text"
                value={process.conflictMode === 'force' ? '强制占用' : '自动迁移'}
                readOnly
              />
            </div>
          </div>
        </div>

        <div className="config-section">
          <h3>启动配置</h3>
          <div className="form-group">
            <label>命令</label>
            <input type="text" value={process.command} readOnly />
          </div>
          <div className="form-group">
            <label>参数</label>
            <textarea
              value={process.args ? process.args.join('\n') : ''}
              readOnly
              rows={3}
            />
          </div>
          <div className="form-group">
            <label>工作目录</label>
            <input type="text" value={process.cwd} readOnly />
          </div>
        </div>

        <div className="config-section">
          <h3>运行选项</h3>
          <div className="checkbox-group">
            <input type="checkbox" checked={process.autoStart} readOnly id="autoStart" />
            <label htmlFor="autoStart">自动启动</label>
          </div>
          <div className="checkbox-group">
            <input type="checkbox" checked={process.restartOnCrash} readOnly id="restartOnCrash" />
            <label htmlFor="restartOnCrash">
              崩溃自动重启 (最大 {process.maxRestarts} 次)
            </label>
          </div>
          {process.restarts > 0 && (
            <div style={{ fontSize: '12px', color: '#e67e22' }}>
              已自动重启 {process.restarts} 次
            </div>
          )}
        </div>

        {process.lastError && (
          <div style={{
            padding: '10px 12px',
            background: '#fdecea',
            borderLeft: '4px solid #e74c3c',
            marginBottom: '16px',
            fontSize: '13px',
            color: '#c0392b',
            borderRadius: '4px'
          }}>
            <strong>错误信息：</strong>{process.lastError}
          </div>
        )}

        <div className="log-section">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3>运行日志</h3>
            <button className="btn btn-default btn-sm" onClick={loadLogs}>
              刷新
            </button>
          </div>
          <div className="log-container" ref={logsEndRef}>
            {logs.length === 0 ? (
              <div style={{ color: '#666', textAlign: 'center', padding: '20px' }}>
                暂无日志
              </div>
            ) : (
              logs.map((line, index) => {
                const parsed = parseLogLine(line)
                return (
                  <div key={index} className={`log-line ${parsed.level}`}>
                    {parsed.text}
                  </div>
                )
              })
            )}
          </div>
        </div>
      </div>
    </>
  )
}

export default ProcessDetail
