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

    // 页面加载完成后启动自动备份调度器（V3.4 功能 1：轮询配置 + 定时写备份）
    mainWindow.webContents.on('did-finish-load', () => {
      void initAutoBackup();
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

// ==================== 自动备份常量（V3.4 功能 1，调度器实现见后文） ====================

const AUTO_BACKUP_CFG_KEY = 'auto_backup_cfg';
const AUTO_BACKUP_TRIGGER_KEY = 'auto_backup_trigger';
const AUTO_BACKUP_LAST_KEY = 'auto_backup_last';
const AUTO_BACKUP_PREFIX = '自动备份_党建工作台账_';
/** 自动备份文件名（时间戳对：json 与 xlsx 成对出现记为一份） */
const AUTO_BACKUP_FILE_RE = /^自动备份_党建工作台账_(\d{8}_\d{6})\.(json|xlsx)$/;
const AUTO_BACKUP_POLL_MS = 2000;

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

// 选择同步文件夹（V3.4：同时作为自动备份目标文件夹的通用目录选择对话框）
ipcMain.handle('sync:select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择文件夹',
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
// V3.4：排除自动备份生成的文件（自动备份_ 前缀），防止重复融合导入
ipcMain.handle('sync:list-backup-files', async (_event, folderPath) => {
  try {
    if (!isValidFolderPath(folderPath)) return { success: false, error: '文件夹不存在或不可访问' };
    const files = fs
      .readdirSync(folderPath)
      .filter((f) => f.toLowerCase().endsWith('.json'))
      .filter((f) => !f.startsWith(AUTO_BACKUP_PREFIX));
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

// ==================== 定时自动备份调度器（V3.4 功能 1） ====================
// 配置与"立即备份"触发标志由渲染进程写入 localStorage，主进程轮询读取
// （preload 未暴露通用 IPC 通道，故采用轮询 + window.__autoBackupBridge 数据桥通信）。
// 备份内容由渲染进程生成，主进程负责原子写入目标文件夹并滚动清理超量备份。

let autoBackupPollTimer = null;
let autoBackupTimer = null;
let autoBackupDailyTimer = null;
let autoBackupCfgSig = '';
let autoBackupLastTrigger = '';
let autoBackupLastRunAt = 0;   // 上次备份完成时间戳（防止页面刷新后重复备份）
let autoBackupDailyDate = ''; // daily8 模式当日已执行标记
let autoBackupRunning = false;

/** 自动备份默认目标文件夹：绿色版 = exe 同级 backups\；安装版 = 文档\党建工作台账备份\ */
function getAutoBackupDefaultFolder() {
  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
  if (portableDir && fs.existsSync(portableDir)) {
    return path.join(portableDir, 'backups');
  }
  return path.join(app.getPath('documents'), '党建工作台账备份');
}

/** 本地日期字符串 YYYY-MM-DD */
function todayStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 备份文件名时间戳 YYYYMMDD_HHMMSS */
function formatAutoBackupStamp(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** 从渲染进程 localStorage 读取自动备份状态（配置 / 手动触发标志 / 上次备份状态） */
async function readAutoBackupState() {
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  const raw = await mainWindow.webContents.executeJavaScript(
    `(function(){ try { return JSON.stringify({cfg: localStorage.getItem('${AUTO_BACKUP_CFG_KEY}'), trigger: localStorage.getItem('${AUTO_BACKUP_TRIGGER_KEY}')}); } catch (e) { return null; } })()`
  );
  if (!raw) return null;
  const state = JSON.parse(raw);
  let cfg = null;
  try {
    cfg = state.cfg ? JSON.parse(state.cfg) : null;
  } catch {
    cfg = null;
  }
  return { cfg, trigger: state.trigger || '' };
}

/** 向渲染进程 localStorage 回写上次备份执行状态（设置页展示） */
function writeAutoBackupLast(state) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const payload = JSON.stringify(JSON.stringify(state));
  mainWindow.webContents
    .executeJavaScript(
      `(function(){ try { localStorage.setItem('${AUTO_BACKUP_LAST_KEY}', ${payload}); } catch (e) {} })()`
    )
    .catch(() => {});
}

/** 首次进入自动填入默认配置（默认不启用，路径可改） */
async function ensureAutoBackupCfgInit() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const raw = await mainWindow.webContents.executeJavaScript(
    `(function(){ try { return localStorage.getItem('${AUTO_BACKUP_CFG_KEY}'); } catch (e) { return null; } })()`
  );
  let cfg = null;
  try {
    cfg = raw ? JSON.parse(raw) : null;
  } catch {
    cfg = null;
  }
  const patch = !cfg
    ? { enabled: false, folderPath: getAutoBackupDefaultFolder(), interval: 'daily8', keep: 30, format: 'json' }
    : typeof cfg.folderPath === 'string' && cfg.folderPath
      ? null
      : { ...cfg, folderPath: getAutoBackupDefaultFolder() };
  if (patch) {
    const payload = JSON.stringify(JSON.stringify(patch));
    await mainWindow.webContents
      .executeJavaScript(
        `(function(){ try { localStorage.setItem('${AUTO_BACKUP_CFG_KEY}', ${payload}); } catch (e) {} })()`
      )
      .catch(() => {});
  }
}

/** 安全写入：先写临时文件再原子重命名（避免产生半写损坏文件） */
function writeAtomic(filePath, data) {
  const tmpPath = `${filePath}.tmp_${Date.now()}`;
  fs.writeFileSync(tmpPath, data);
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      // 临时文件清理失败可忽略
    }
    throw err;
  }
}

/** 滚动清理：按文件名时间戳分组，超出保留份数自动删除最旧一组（JSON+Excel 成对删除） */
function rollCleanupAutoBackups(folder, keep) {
  try {
    const keepCount = Number(keep) > 0 ? Number(keep) : 30;
    const files = fs.readdirSync(folder).filter((f) => AUTO_BACKUP_FILE_RE.test(f));
    const groups = new Map();
    files.forEach((f) => {
      const stamp = f.match(AUTO_BACKUP_FILE_RE)[1];
      if (!groups.has(stamp)) groups.set(stamp, []);
      groups.get(stamp).push(f);
    });
    const stamps = [...groups.keys()].sort(); // 定长时间戳，字典序即时间序
    const excess = stamps.length - keepCount;
    for (let i = 0; i < excess; i++) {
      groups.get(stamps[i]).forEach((f) => {
        try {
          fs.unlinkSync(path.join(folder, f));
        } catch {
          // 单个删除失败忽略，下次清理再试
        }
      });
    }
  } catch (err) {
    console.warn('自动备份滚动清理失败:', err.message);
  }
}

/** 执行一次自动备份：拉取渲染进程生成的备份内容 → 原子写入 → 滚动清理 → 回写状态 */
async function runAutoBackup(cfg, trigger) {
  if (autoBackupRunning) return;
  if (!cfg || !cfg.folderPath) {
    writeAutoBackupLast({ time: new Date().toISOString(), ok: false, error: '未设置备份文件夹', trigger: trigger || '' });
    return;
  }
  autoBackupRunning = true;
  try {
    // 经渲染进程数据桥拉取备份内容（IndexedDB 数据仅渲染进程可读）
    const payload = await mainWindow.webContents.executeJavaScript(
      `(window.__autoBackupBridge ? window.__autoBackupBridge(${JSON.stringify(cfg.format || 'json')}) : null)`
    );
    if (!payload || !payload.json) throw new Error('无法从应用获取备份数据');

    fs.mkdirSync(cfg.folderPath, { recursive: true });
    const stamp = formatAutoBackupStamp(new Date());
    const files = [];
    const jsonName = `${AUTO_BACKUP_PREFIX}${stamp}.json`;
    writeAtomic(path.join(cfg.folderPath, jsonName), payload.json);
    files.push(jsonName);
    if (cfg.format === 'json+excel' && payload.excelBase64) {
      const xlsxName = `${AUTO_BACKUP_PREFIX}${stamp}.xlsx`;
      writeAtomic(path.join(cfg.folderPath, xlsxName), Buffer.from(payload.excelBase64, 'base64'));
      files.push(xlsxName);
    }

    rollCleanupAutoBackups(cfg.folderPath, cfg.keep);
    autoBackupLastRunAt = Date.now();
    writeAutoBackupLast({ time: new Date().toISOString(), ok: true, files, trigger: trigger || '' });
  } catch (err) {
    writeAutoBackupLast({
      time: new Date().toISOString(),
      ok: false,
      error: (err && err.message) || '备份执行失败',
      trigger: trigger || '',
    });
  } finally {
    autoBackupRunning = false;
  }
}

function stopAutoBackupScheduler() {
  if (autoBackupTimer) {
    clearInterval(autoBackupTimer);
    autoBackupTimer = null;
  }
  if (autoBackupDailyTimer) {
    clearInterval(autoBackupDailyTimer);
    autoBackupDailyTimer = null;
  }
}

/** 依据配置重启调度（配置变化 / 页面加载完成时调用） */
function restartAutoBackupScheduler(cfg) {
  stopAutoBackupScheduler();
  if (!cfg || !cfg.enabled) return;

  if (cfg.interval === 'startup') {
    // 仅启动时备份一次：10 分钟内已备份过则跳过（防止页面刷新重复备份）
    if (Date.now() - autoBackupLastRunAt > 10 * 60 * 1000) {
      void runAutoBackup(cfg);
    }
    return;
  }

  if (cfg.interval === 'daily8') {
    // 每 60 秒检查时刻：到达每天 8 点后且当日未备份则触发（本地时区）
    autoBackupDailyTimer = setInterval(() => {
      const now = new Date();
      const today = todayStr();
      if (now.getHours() >= 8 && autoBackupDailyDate !== today) {
        autoBackupDailyDate = today;
        void runAutoBackup(cfg);
      }
    }, 60 * 1000);
    return;
  }

  // 周期模式（30min / 1h）：刷新页面后若已超过周期未备份则立即补一次
  const ms = cfg.interval === '30min' ? 30 * 60 * 1000 : 60 * 60 * 1000;
  if (Date.now() - autoBackupLastRunAt > ms) {
    void runAutoBackup(cfg);
  }
  autoBackupTimer = setInterval(() => {
    void runAutoBackup(cfg);
  }, ms);
}

/** 轮询渲染进程：处理手动触发 + 配置变化（重启调度器） */
async function pollAutoBackup() {
  const state = await readAutoBackupState();
  if (!state) return;
  const cfg = state.cfg;

  // 手动触发（"立即备份一次"按钮）：触发标志变化即执行
  if (state.trigger && state.trigger !== autoBackupLastTrigger) {
    autoBackupLastTrigger = state.trigger;
    await runAutoBackup(cfg, state.trigger);
  }

  // 配置变化 → 同步上次备份时间并重启调度器
  const sig = JSON.stringify(cfg);
  if (sig !== autoBackupCfgSig) {
    autoBackupCfgSig = sig;
    stopAutoBackupScheduler();
    if (cfg && cfg.enabled) {
      // 读取上次备份状态，恢复"已备份时间"标记（daily8 当日已执行 / startup 防重复）
      try {
        const lastRaw = await mainWindow.webContents.executeJavaScript(
          `(function(){ try { return localStorage.getItem('${AUTO_BACKUP_LAST_KEY}'); } catch (e) { return null; } })()`
        );
        if (lastRaw) {
          const last = JSON.parse(lastRaw);
          if (last && last.time) {
            const lastMs = Date.parse(last.time);
            if (lastMs > 0) autoBackupLastRunAt = lastMs;
            const lastDate = new Date(lastMs);
            if (last.ok && lastDate.toDateString() === new Date().toDateString() && lastDate.getHours() >= 8) {
              autoBackupDailyDate = todayStr();
            }
          }
        }
      } catch {
        // 状态读取失败不影响调度
      }
      restartAutoBackupScheduler(cfg);
    }
  }
}

/** 页面加载完成后初始化：补默认配置 → 立即轮询一次 → 周期轮询 */
async function initAutoBackup() {
  await ensureAutoBackupCfgInit();
  await pollAutoBackup();
  if (autoBackupPollTimer) clearInterval(autoBackupPollTimer);
  autoBackupPollTimer = setInterval(() => {
    void pollAutoBackup();
  }, AUTO_BACKUP_POLL_MS);
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  stopAutoBackupScheduler();
  if (autoBackupPollTimer) {
    clearInterval(autoBackupPollTimer);
    autoBackupPollTimer = null;
  }
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
