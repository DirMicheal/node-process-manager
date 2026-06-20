import { useState, useEffect } from 'react'
import ProcessList from './components/ProcessList.jsx'
import ProcessDetail from './components/ProcessDetail.jsx'
import AddProcessModal from './components/AddProcessModal.jsx'
import TitleBar from './components/TitleBar.jsx'

function App() {
  const [processes, setProcesses] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [portPoolStatus, setPortPoolStatus] = useState(null)
  const [editingProcess, setEditingProcess] = useState(null)

  const loadProcesses = async () => {
    if (window.electronAPI?.process) {
      const list = await window.electronAPI.process.list()
      setProcesses(list)
    }
  }

  const loadPortPoolStatus = async () => {
    if (window.electronAPI?.portPool) {
      const status = await window.electronAPI.portPool.status()
      setPortPoolStatus(status)
    }
  }

  useEffect(() => {
    loadProcesses()
    loadPortPoolStatus()

    if (window.electronAPI?.process) {
      const unsubscribe = window.electronAPI.process.onStatusChange(() => {
        loadProcesses()
        loadPortPoolStatus()
      })
      return unsubscribe
    }
  }, [])

  const selectedProcess = processes.find(p => p.id === selectedId)

  const handleAddProcess = async (config) => {
    if (window.electronAPI?.process) {
      const result = await window.electronAPI.process.add(config)
      if (result) {
        setSelectedId(result.id)
      }
      loadProcesses()
    }
    setShowAddModal(false)
    setEditingProcess(null)
  }

  const handleUpdateProcess = async (id, config) => {
    if (window.electronAPI?.process) {
      await window.electronAPI.process.update(id, config)
      loadProcesses()
    }
    setShowAddModal(false)
    setEditingProcess(null)
  }

  const handleDeleteProcess = async (id) => {
    if (window.confirm('确定要删除这个进程吗？')) {
      if (window.electronAPI?.process) {
        await window.electronAPI.process.remove(id)
        if (selectedId === id) {
          setSelectedId(null)
        }
        loadProcesses()
      }
    }
  }

  const handleStartProcess = async (id) => {
    if (window.electronAPI?.process) {
      await window.electronAPI.process.start(id)
      loadProcesses()
    }
  }

  const handleStopProcess = async (id) => {
    if (window.electronAPI?.process) {
      await window.electronAPI.process.stop(id)
      loadProcesses()
    }
  }

  const handleRestartProcess = async (id) => {
    if (window.electronAPI?.process) {
      await window.electronAPI.process.restart(id)
      loadProcesses()
    }
  }

  const handleEdit = (process) => {
    setEditingProcess(process)
    setShowAddModal(true)
  }

  const runningCount = processes.filter(p => p.status === 'running').length

  return (
    <div className="app">
      <TitleBar />
      
      <div className="stats-bar">
        <div className="stat-item">
          <span>总进程数:</span>
          <span className="stat-value">{processes.length}</span>
        </div>
        <div className="stat-item">
          <span>运行中:</span>
          <span className="stat-value" style={{ color: '#27ae60' }}>{runningCount}</span>
        </div>
        <div className="stat-item">
          <span>已停止:</span>
          <span className="stat-value" style={{ color: '#95a5a6' }}>{processes.length - runningCount}</span>
        </div>
        {portPoolStatus && (
          <div className="stat-item">
            <span>端口池可用:</span>
            <span className="stat-value" style={{ color: '#3498db' }}>
              {portPoolStatus.available} / {portPoolStatus.total}
            </span>
          </div>
        )}
      </div>

      <div className="main-content">
        <div className="sidebar">
          <div className="sidebar-header">
            <h2>进程列表</h2>
            <button className="add-btn" onClick={() => setShowAddModal(true)}>
              + 添加进程
            </button>
          </div>
          <ProcessList
            processes={processes}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
          <div className="sidebar-footer">
            端口范围: {portPoolStatus?.minPort || 3000} - {portPoolStatus?.maxPort || 4000}
          </div>
        </div>

        <div className="detail-panel">
          {selectedProcess ? (
            <ProcessDetail
              process={selectedProcess}
              onStart={handleStartProcess}
              onStop={handleStopProcess}
              onRestart={handleRestartProcess}
              onEdit={handleEdit}
              onDelete={handleDeleteProcess}
            />
          ) : (
            <div className="detail-body">
              <div className="empty-state">
                <div className="icon">📋</div>
                <div className="text">请选择一个进程查看详情</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {showAddModal && (
        <AddProcessModal
          process={editingProcess}
          onClose={() => {
            setShowAddModal(false)
            setEditingProcess(null)
          }}
          onSubmit={editingProcess ? handleUpdateProcess : handleAddProcess}
        />
      )}
    </div>
  )
}

export default App
