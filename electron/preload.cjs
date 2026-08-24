const { contextBridge, ipcRenderer } = require('electron');

// 暴露安全的 API 给渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  isElectron: true,

  // 数据融合（同步文件夹）相关：受限文件系统访问
  // 选择同步文件夹（弹出系统对话框），返回所选路径或 null
  selectSyncFolder: () => ipcRenderer.invoke('sync:select-folder'),
  // 列出文件夹中的备份文件（仅 .json），返回文件名数组
  listBackupFiles: (folderPath) => ipcRenderer.invoke('sync:list-backup-files', folderPath),
  // 读取同步文件夹内的备份文件内容（路径安全校验：必须在 folderPath 内）
  readBackupFile: (folderPath, fileName) => ipcRenderer.invoke('sync:read-backup-file', folderPath, fileName),
  // 将已融合文件重命名（追加 .merged 后缀）
  markFileMerged: (folderPath, fileName) => ipcRenderer.invoke('sync:mark-file-merged', folderPath, fileName),
  // 校验文件夹路径存在且可读
  checkFolder: (folderPath) => ipcRenderer.invoke('sync:check-folder', folderPath),
});
