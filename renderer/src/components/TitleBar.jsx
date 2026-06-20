function TitleBar() {
  const handleMinimize = () => {
    if (window.electronAPI?.app) {
      window.electronAPI.app.minimize()
    }
  }

  const handleMaximize = () => {
    if (window.electronAPI?.app) {
      window.electronAPI.app.maximize()
    }
  }

  const handleClose = () => {
    if (window.electronAPI?.app) {
      window.electronAPI.app.close()
    }
  }

  return (
    <div className="title-bar">
      <div className="title">Node 进程管理器</div>
      <div className="window-controls">
        <button onClick={handleMinimize} title="最小化">─</button>
        <button onClick={handleMaximize} title="最大化">▢</button>
        <button className="close" onClick={handleClose} title="关闭">✕</button>
      </div>
    </div>
  )
}

export default TitleBar
