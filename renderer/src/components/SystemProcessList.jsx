import { useState } from 'react'

function SystemProcessList({ processes, scanning, onRefresh, onKill, onImport }) {
  const [searchTerm, setSearchTerm] = useState('')
  const [showManaged, setShowManaged] = useState(true)

  const filteredProcesses = processes.filter(p => {
    if (!showManaged && p.managedByApp) return false
    
    if (searchTerm) {
      const term = searchTerm.toLowerCase()
      return (
        p.appName?.toLowerCase().includes(term) ||
        p.displayName?.toLowerCase().includes(term) ||
        p.script?.toLowerCase().includes(term) ||
        p.commandLine?.toLowerCase().includes(term) ||
        String(p.pid).includes(term) ||
        (p.ports || []).some(port => String(port).includes(term))
      )
    }
    return true
  })

  return (
    <div className="system-process-panel">
      <div className="system-process-header">
        <div style={{ flex: 1 }}>
          <h3 style={{ margin: 0, fontSize: '16px', color: '#2c3e50' }}>
            🔍 系统Node进程扫描
          </h3>
          <div style={{ fontSize: '12px', color: '#7f8c8d', marginTop: '4px' }}>
            发现 {processes.length} 个Node相关进程
            {processes.filter(p => p.managedByApp).length > 0 && (
              <span>，其中 {processes.filter(p => p.managedByApp).length} 个已由本应用托管</span>
            )}
          </div>
        </div>
        <div className="system-process-filters">
          <input
            type="text"
            placeholder="🔍 搜索进程名/PID/端口..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="search-input"
          />
          <label className="checkbox-inline">
            <input
              type="checkbox"
              checked={showManaged}
              onChange={e => setShowManaged(e.target.checked)}
            />
            显示已托管
          </label>
          <button
            className="btn btn-primary btn-sm"
            onClick={onRefresh}
            disabled={scanning}
          >
            {scanning ? '扫描中...' : '↻ 刷新'}
          </button>
        </div>
      </div>

      <div className="system-process-content">
        {filteredProcesses.length === 0 ? (
          <div className="empty-state">
            <div className="icon">🔍</div>
            <div className="text">
              {scanning ? '正在扫描系统进程...' : '未找到匹配的进程'}
            </div>
          </div>
        ) : (
          <div className="system-process-grid">
            {filteredProcesses.map(proc => (
              <SystemProcessCard
                key={proc.pid}
                process={proc}
                onKill={onKill}
                onImport={onImport}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function SystemProcessCard({ process, onKill, onImport }) {
  const [showCommand, setShowCommand] = useState(false)

  const truncateCommand = (cmd, maxLen = 80) => {
    if (!cmd) return ''
    if (cmd.length <= maxLen) return cmd
    return cmd.substring(0, maxLen) + '...'
  }

  return (
    <div className={`system-process-card ${process.managedByApp ? 'managed' : ''}`}>
      <div className="spc-header">
        <div className="spc-title">
          <div className="spc-icon">
            {process.displayName?.includes('npm') ? '📦' : 
             process.displayName?.includes('node') ? '🟢' : '⚙️'}
          </div>
          <div>
            <div className="spc-name">
              {process.appName || process.displayName || 'Node进程'}
              {process.managedByApp && (
                <span className="managed-badge">托管中</span>
              )}
            </div>
            {process.script && (
              <div className="spc-script" title={process.script}>
                📄 {process.script.split(/[\\/]/).pop()}
              </div>
            )}
          </div>
        </div>
        <div className="spc-actions">
          {!process.managedByApp && (
            <>
              <button
                className="btn btn-success btn-sm"
                title="导入到本应用管理"
                onClick={() => onImport(process)}
              >
                ↓ 导入
              </button>
              <button
                className="btn btn-danger btn-sm"
                title="强制终止进程"
                onClick={() => onKill(process.pid)}
              >
                ✕ 终止
              </button>
            </>
          )}
          {process.managedByApp && (
            <span className="managed-status">● 运行中</span>
          )}
        </div>
      </div>

      <div className="spc-info">
        <div className="spc-info-item">
          <span className="spc-label">PID:</span>
          <span className="spc-value">{process.pid}</span>
        </div>
        <div className="spc-info-item">
          <span className="spc-label">进程:</span>
          <span className="spc-value">{process.displayName}</span>
        </div>
        {(process.ports?.length > 0) && (
          <div className="spc-info-item">
            <span className="spc-label">端口:</span>
            <span className="spc-port-list">
              {process.ports.map((port, idx) => (
                <span key={idx} className="port-tag">{port}</span>
              ))}
            </span>
          </div>
        )}
        {process.primaryPort && (
          <div className="spc-info-item">
            <span className="spc-label">主端口:</span>
            <span className="spc-value spc-primary-port">{process.primaryPort}</span>
          </div>
        )}
      </div>

      {process.commandLine && (
        <div className="spc-command">
          <div
            className="spc-cmd-toggle"
            onClick={() => setShowCommand(!showCommand)}
          >
            {showCommand ? '▲ 隐藏命令行' : '▼ 查看命令行'}
          </div>
          {showCommand && (
            <div className="spc-cmd-content">
              {process.commandLine}
            </div>
          )}
          {!showCommand && (
            <div className="spc-cmd-preview" title={process.commandLine}>
              {truncateCommand(process.commandLine)}
            </div>
          )}
        </div>
      )}

      {process.executablePath && (
        <div className="spc-path" title={process.executablePath}>
          📍 {truncateCommand(process.executablePath, 50)}
        </div>
      )}
    </div>
  )
}

export default SystemProcessList
