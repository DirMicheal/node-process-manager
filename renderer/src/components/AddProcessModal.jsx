import { useState, useEffect } from 'react'

function AddProcessModal({ process, onClose, onSubmit }) {
  const [formData, setFormData] = useState({
    name: '',
    command: 'node',
    args: '',
    cwd: '',
    port: '',
    autoStart: false,
    restartOnCrash: false,
    maxRestarts: 3,
    conflictMode: 'auto'
  })

  const [errors, setErrors] = useState({})

  useEffect(() => {
    if (process) {
      setFormData({
        name: process.name || '',
        command: process.command || 'node',
        args: process.args ? process.args.join('\n') : '',
        cwd: process.cwd || '',
        port: process.port || '',
        autoStart: process.autoStart || false,
        restartOnCrash: process.restartOnCrash || false,
        maxRestarts: process.maxRestarts || 3,
        conflictMode: process.conflictMode || 'auto'
      })
    }
  }, [process])

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }))
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }))
    }
  }

  const validate = () => {
    const newErrors = {}
    
    if (!formData.name.trim()) {
      newErrors.name = '请输入进程名称'
    }
    
    if (!formData.command.trim()) {
      newErrors.command = '请输入启动命令'
    }
    
    if (!formData.cwd.trim()) {
      newErrors.cwd = '请输入工作目录'
    }

    if (formData.port) {
      const portNum = parseInt(formData.port, 10)
      if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
        newErrors.port = '请输入有效的端口号 (1-65535)'
      }
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    
    if (!validate()) return

    const argsList = formData.args
      .split('\n')
      .map(a => a.trim())
      .filter(a => a.length > 0)

    const config = {
      name: formData.name.trim(),
      command: formData.command.trim(),
      args: argsList,
      cwd: formData.cwd.trim(),
      port: formData.port ? parseInt(formData.port, 10) : null,
      autoStart: formData.autoStart,
      restartOnCrash: formData.restartOnCrash,
      maxRestarts: parseInt(formData.maxRestarts, 10) || 3,
      conflictMode: formData.conflictMode
    }

    if (process) {
      onSubmit(process.id, config)
    } else {
      onSubmit(config)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{process ? '编辑进程' : '添加进程'}</h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="form-group">
              <label>进程名称 *</label>
              <input
                type="text"
                value={formData.name}
                onChange={e => handleChange('name', e.target.value)}
                placeholder="例如：我的Node服务"
                style={{ borderColor: errors.name ? '#e74c3c' : '' }}
              />
              {errors.name && (
                <div style={{ color: '#e74c3c', fontSize: '12px', marginTop: '4px' }}>
                  {errors.name}
                </div>
              )}
            </div>

            <div className="form-group">
              <label>启动命令 *</label>
              <input
                type="text"
                value={formData.command}
                onChange={e => handleChange('command', e.target.value)}
                placeholder="例如：node 或 npm"
                style={{ borderColor: errors.command ? '#e74c3c' : '' }}
              />
              {errors.command && (
                <div style={{ color: '#e74c3c', fontSize: '12px', marginTop: '4px' }}>
                  {errors.command}
                </div>
              )}
            </div>

            <div className="form-group">
              <label>命令参数（每行一个）</label>
              <textarea
                value={formData.args}
                onChange={e => handleChange('args', e.target.value)}
                placeholder="例如：&#10;start&#10;--port&#10;3000"
                rows={4}
              />
            </div>

            <div className="form-group">
              <label>工作目录 *</label>
              <input
                type="text"
                value={formData.cwd}
                onChange={e => handleChange('cwd', e.target.value)}
                placeholder="例如：C:\\projects\\my-app"
                style={{ borderColor: errors.cwd ? '#e74c3c' : '' }}
              />
              {errors.cwd && (
                <div style={{ color: '#e74c3c', fontSize: '12px', marginTop: '4px' }}>
                  {errors.cwd}
                </div>
              )}
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>端口号</label>
                <input
                  type="number"
                  value={formData.port}
                  onChange={e => handleChange('port', e.target.value)}
                  placeholder="留空则自动分配"
                  style={{ borderColor: errors.port ? '#e74c3c' : '' }}
                />
                {errors.port && (
                  <div style={{ color: '#e74c3c', fontSize: '12px', marginTop: '4px' }}>
                    {errors.port}
                  </div>
                )}
              </div>

              <div className="form-group">
                <label>冲突处理模式</label>
                <select
                  value={formData.conflictMode}
                  onChange={e => handleChange('conflictMode', e.target.value)}
                >
                  <option value="auto">自动迁移（分配新端口）</option>
                  <option value="force">强制占用（终止占用进程）</option>
                </select>
              </div>
            </div>

            <div className="checkbox-group">
              <input
                type="checkbox"
                id="autoStart"
                checked={formData.autoStart}
                onChange={e => handleChange('autoStart', e.target.checked)}
              />
              <label htmlFor="autoStart">应用启动时自动启动该进程</label>
            </div>

            <div className="checkbox-group">
              <input
                type="checkbox"
                id="restartOnCrash"
                checked={formData.restartOnCrash}
                onChange={e => handleChange('restartOnCrash', e.target.checked)}
              />
              <label htmlFor="restartOnCrash">进程崩溃时自动重启</label>
            </div>

            {formData.restartOnCrash && (
              <div className="form-group" style={{ marginLeft: '24px' }}>
                <label>最大重启次数</label>
                <input
                  type="number"
                  value={formData.maxRestarts}
                  onChange={e => handleChange('maxRestarts', e.target.value)}
                  min="1"
                  max="100"
                  style={{ width: '120px' }}
                />
              </div>
            )}
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-default" onClick={onClose}>
              取消
            </button>
            <button type="submit" className="btn btn-primary">
              {process ? '保存' : '添加'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default AddProcessModal
