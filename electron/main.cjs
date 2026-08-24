const { app, BrowserWindow, shell, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow = null;

// 绿色版（portable）数据持久化：将 userData 设置到 exe 同级目录
// electron-builder 的 portable 目标会设置 PORTABLE_EXECUTABLE_DIR 环境变量
try {
  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
  if (portableDir && fs.existsSync(portableDir)) {
    const userDataPath = path.join(portableDir, 'userData');
    if (!fs.existsSync(userDataPath)) {
      fs.mkdirSync(userDataPath, { recursive: true });
    }
    // 验证目录可写
    fs.accessSync(userDataPath, fs.constants.W_OK);
    app.setPath('userData', userDataPath);
  }
} catch (err) {
  console.warn('设置 portable userData 路径失败，使用默认路径:', err.message);
}

function createWindow() {
  try {
    mainWindow = new BrowserWindow({
      width: 1280,
      height: 860,
      minWidth: 1024,
      minHeight: 680,
      title: '党建工作台账应用',
      show: false, // 延迟显示，避免白屏闪烁
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });

    // 窗口准备好后再显示，避免白屏
    mainWindow.once('ready-to-show', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
      }
    });

    // 加载前端页面
    const isDev = process.env.NODE_ENV === 'development';
    if (isDev) {
      mainWindow.loadURL('http://localhost:5173');
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    } else {
      // 生产环境：尝试多个可能的路径
      const candidates = [
        path.join(__dirname, '../dist/index.html'),
        path.join(__dirname, '../../dist/index.html'),
        path.join(__dirname, 'dist/index.html'),
      ];
      const found = candidates.find((p) => {
        try {
          return fs.existsSync(p);
        } catch {
          return false;
        }
      });
      if (found) {
        mainWindow.loadFile(found);
      } else {
        console.error('找不到 index.html，尝试过的路径：', candidates);
        mainWindow.loadFile(candidates[0]);
      }
    }

    // 在外部浏览器打开链接
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url);
      return { action: 'deny' };
    });

    // 捕获渲染进程崩溃
    mainWindow.webContents.on('render-process-gone', (event, details) => {
      console.error('渲染进程崩溃:', details);
    });

    mainWindow.on('closed', () => {
      mainWindow = null;
    });
  } catch (err) {
    console.error('创建窗口失败:', err);
  }
}

// ==================== 数据融合（同步文件夹）IPC ====================
// 仅允许访问用户选择的同步文件夹内的 .json 备份文件

/** 校验文件名安全（禁止路径分隔符、上级目录等） */
function isSafeFileName(fileName) {
  return (
    typeof fileName === 'string' &&
    fileName.length > 0 &&
    !fileName.includes('/') &&
    !fileName.includes('\\') &&
    !fileName.includes('..')
  );
}

/** 校验文件夹路径是绝对路径且存在 */
function isValidFolderPath(folderPath) {
  return (
    typeof folderPath === 'string' &&
    path.isAbsolute(folderPath) &&
    fs.existsSync(folderPath) &&
    fs.statSync(folderPath).isDirectory()
  );
}

// 选择同步文件夹
ipcMain.handle('sync:select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择数据同步文件夹',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

// 校验文件夹
ipcMain.handle('sync:check-folder', async (_event, folderPath) => {
  try {
    return isValidFolderPath(folderPath);
  } catch {
    return false;
  }
});

// 列出文件夹中的备份文件（仅 .json，不含 .merged 后缀的已处理文件）
ipcMain.handle('sync:list-backup-files', async (_event, folderPath) => {
  try {
    if (!isValidFolderPath(folderPath)) return { success: false, error: '文件夹不存在或不可访问' };
    const files = fs
      .readdirSync(folderPath)
      .filter((f) => f.toLowerCase().endsWith('.json'));
    return { success: true, files };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 读取备份文件内容（路径安全校验）
ipcMain.handle('sync:read-backup-file', async (_event, folderPath, fileName) => {
  try {
    if (!isValidFolderPath(folderPath)) return { success: false, error: '文件夹不存在或不可访问' };
    if (!isSafeFileName(fileName)) return { success: false, error: '非法文件名' };
    const filePath = path.join(folderPath, fileName);
    const content = fs.readFileSync(filePath, 'utf-8');
    return { success: true, content };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 重命名已融合文件（追加 .merged 后缀）
ipcMain.handle('sync:mark-file-merged', async (_event, folderPath, fileName) => {
  try {
    if (!isValidFolderPath(folderPath)) return { success: false, error: '文件夹不存在或不可访问' };
    if (!isSafeFileName(fileName)) return { success: false, error: '非法文件名' };
    const oldPath = path.join(folderPath, fileName);
    const newPath = `${oldPath}.merged`;
    fs.renameSync(oldPath, newPath);
    return { success: true, newPath: path.basename(newPath) };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// 捕获未处理的异常，避免静默崩溃
process.on('uncaughtException', (err) => {
  console.error('未处理异常:', err);
});
