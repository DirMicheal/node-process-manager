function ProcessList({ processes, selectedId, onSelect }) {
  const getStatusText = (status) => {
    const map = {
      running: '运行中',
      stopped: '已停止',
      starting: '启动中',
      stopping: '停止中',
      error: '错误'
    }
    return map[status] || status
  }

  if (processes.length === 0) {
    return (
      <div className="process-list">
        <div style={{ padding: '20px', textAlign: 'center', color: '#95a5a6', fontSize: '12px' }}>
          暂无进程
        </div>
      </div>
    )
  }

  return (
    <div className="process-list">
      {processes.map(proc => (
        <div
          key={proc.id}
          className={`process-item ${selectedId === proc.id ? 'active' : ''}`}
          onClick={() => onSelect(proc.id)}
        >
          <div className="process-name">
            <span className={`status-dot ${proc.status}`}></span>
            <span title={proc.name}>{proc.name}</span>
          </div>
          <div className="process-info">
            {getStatusText(proc.status)}
            {proc.port && ` · 端口 ${proc.port}`}
          </div>
        </div>
      ))}
    </div>
  )
}

export default ProcessList
