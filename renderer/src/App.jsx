import { useState, useEffect } from 'react'
import ProcessList from './components/ProcessList.jsx'
import ProcessDetail from './components/ProcessDetail.jsx'
import SystemProcessList from './components/SystemProcessList.jsx'
import AddProcessModal from './components/AddProcessModal.jsx'
import TitleBar from './components/TitleBar.jsx'

function App() {
  const [processes, setProcesses] = useState([])
  const [systemProcesses, setSystemProcesses] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [portPoolStatus, setPortPoolStatus] = useState(null)
  const [editingProcess, setEditingProcess] = useState(null)
  const [activeTab, setActiveTab] = useState('managed')
  const [scanning, setScanning] = useState(false)

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

  const scanSystemProcesses = async () => {
    setScanning(true)
    try {
      if (window.electronAPI?.system) {
        const list = await window.electronAPI.system.scanProcesses()
        setSystemProcesses(list)
      }
    } finally {
      setScanning(false)
    }
  }

  useEffect(() => {
    loadProcesses()
    loadPortPoolStatus()
    scanSystemProcesses()

    const interval = setInterval(scanSystemProcesses, 10000)

    if (window.electronAPI?.process) {
      const unsubscribe = window.electronAPI.process.onStatusChange(() => {
        loadProcesses()
        loadPortPoolStatus()
      })

      const unsubscribeSys = window.electronAPI.system?.onProcessesScanned?.((procs) => {
        setSystemProcesses(procs)
      })

      return () => {
        clearInterval(interval)
        unsubscribe && unsubscribe()
        unsubscribeSys && unsubscribeSys()
      }
    }

    return () => clearInterval(interval)
  }, [])

  const selectedProcess = processes.find(p => p.id === selectedId)

  const handleAddProcess = async (config) => {
    if (window.electronAPI?.process) {
      try {
        const result = await window.electronAPI.process.add(config)
        if (result) {
          setSelectedId(result.id)
        }
        loadProcesses()
      } catch (e) {
        alert(e.message)
      }
    }
    setShowAddModal(false)
    setEditingProcess(null)
  }

  const handleUpdateProcess = async (id, config) => {
    if (window.electronAPI?.process) {
      try {
        await window.electronAPI.process.update(id, config)
        loadProcesses()
      } catch (e) {
        alert(e.message)
      }
    }
    setShowAddModal(false)
    setEditingProcess(null)
  }

  const handleDeleteProcess = async (id) => {
    if (window.confirm('确定要删除这个进程吗？该进程将被停止并从列表移除。')) {
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
      try {
        await window.electronAPI.process.start(id)
        loadProcesses()
      } catch (e) {
        alert(`启动失败: ${e.message}`)
      }
    }
  }

  const handleStopProcess = async (id) => {
    if (window.electronAPI?.process) {
      try {
        await window.electronAPI.process.stop(id)
        loadProcesses()
      } catch (e) {
        alert(`停止失败: ${e.message}`)
      }
    }
  }

  const handleRestartProcess = async (id) => {
    if (window.electronAPI?.process) {
      try {
        await window.electronAPI.process.restart(id)
        loadProcesses()
      } catch (e) {
        alert(`重启失败: ${e.message}`)
      }
    }
  }

  const handleEdit = (process) => {
    setEditingProcess(process)
    setShowAddModal(true)
  }

  const handleKillSystemProcess = async (pid) => {
    if (window.confirm(`确定要强制终止进程 PID: ${pid} 吗？此操作不可撤销。`)) {
      if (window.electronAPI?.system) {
        const result = await window.electronAPI.system.killProcess(pid, true)
        if (result.success) {
          alert('进程已终止')
          scanSystemProcesses()
        } else {
          alert(`终止失败: ${result.error || '未知错误'}`)
        }
      }
    }
  }

  const handleImportSystemProcess = async (proc) => {
    if (window.confirm(`确定要将进程 "${proc.appName || proc.displayName}" 导入管理吗？`)) {
      if (window.electronAPI?.system) {
        try {
          const result = await window.electronAPI.system.importProcess(proc)
          if (result) {
            setActiveTab('managed')
            setSelectedId(result.id)
            loadProcesses()
          }
        } catch (e) {
          alert(`导入失败: ${e.message}`)
        }
      }
    }
  }

  const runningCount = processes.filter(p => p.status === 'running').length

  return (
    <div className="app">
      <TitleBar />
      
      <div className="stats-bar">
        <div className="stat-item">
          <span>托管进程:</span>
          <span className="stat-value">{processes.length}</span>
        </div>
        <div className="stat-item">
          <span>运行中:</span>
          <span className="stat-value" style={{ color: '#27ae60' }}>{runningCount}</span>
        </div>
        <div className="stat-item">
          <span>系统进程:</span>
          <span className="stat-value" style={{ color: '#8e44ad' }}>{systemProcesses.length}</span>
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

      <div className="tab-bar">
        <button
          className={`tab-btn ${activeTab === 'managed' ? 'active' : ''}`}
          onClick={() => setActiveTab('managed')}
        >
          📋 托管进程
        </button>
        <button
          className={`tab-btn ${activeTab === 'system' ? 'active' : ''}`}
          onClick={() => {
            setActiveTab('system')
            scanSystemProcesses()
          }}
        >
          🔍 系统进程 {scanning && ' (扫描中...)'}
        </button>
      </div>

      <div className="main-content">
        {activeTab === 'managed' ? (
          <>
            <div className="sidebar">
              <div className="sidebar-header">
                <h2>托管列表</h2>
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
                    <div className="text">请选择一个进程查看详情，或点击左侧"添加进程"</div>
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          <SystemProcessList
            processes={systemProcesses}
            scanning={scanning}
            onRefresh={scanSystemProcesses}
            onKill={handleKillSystemProcess}
            onImport={handleImportSystemProcess}
          />
        )}
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
