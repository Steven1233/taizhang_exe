/**
 * 定时自动融合调度器
 *
 * 在 Electron 环境下定时扫描用户指定的同步文件夹，发现新的备份文件（.json）
 * 自动执行融合（按 mergeData 策略合并入库），处理成功后重命名加 .merged 后缀。
 *
 * 配置持久化于 localStorage：
 * - sync_folder_path     同步文件夹路径
 * - auto_merge_enabled   是否开启定时自动融合
 * - auto_merge_interval  检查频率（30min / 1h / daily8 / startup）
 * - merged_files_list    已处理文件名清单（双保险，避免重命名失败后重复融合）
 */

import { parseBackupFile } from './backup';
import type { BackupData } from './backup';
import { executeMerge } from './mergeData';
import type { MergeResult } from './mergeData';

export type AutoMergeInterval = '30min' | '1h' | 'daily8' | 'startup';

export interface AutoSyncConfig {
  enabled: boolean;
  folderPath: string;
  interval: AutoMergeInterval;
}

/** 单个文件的自动融合结果 */
export interface AutoMergeFileReport {
  fileName: string;
  ok: boolean;
  error?: string;
  result?: MergeResult;
}

/** 一次检查的报告 */
export interface AutoSyncReport {
  checkedAt: string;            // 检查时间 ISO
  folderPath: string;
  folderOk: boolean;            // 文件夹是否可访问
  folderError?: string;
  filesFound: number;           // 发现的待处理文件数
  reports: AutoMergeFileReport[];
}

const LS_KEYS = {
  folderPath: 'sync_folder_path',
  enabled: 'auto_merge_enabled',
  interval: 'auto_merge_interval',
  mergedList: 'merged_files_list',
} as const;

/** Electron API 类型声明（preload 注入） */
interface ElectronSyncAPI {
  isElectron: boolean;
  selectSyncFolder: () => Promise<string | null>;
  listBackupFiles: (folderPath: string) => Promise<{ success: boolean; files?: string[]; error?: string }>;
  readBackupFile: (folderPath: string, fileName: string) => Promise<{ success: boolean; content?: string; error?: string }>;
  markFileMerged: (folderPath: string, fileName: string) => Promise<{ success: boolean; error?: string }>;
  checkFolder: (folderPath: string) => Promise<boolean>;
}

function getElectronAPI(): ElectronSyncAPI | null {
  const api = (window as unknown as { electronAPI?: ElectronSyncAPI }).electronAPI;
  return api && api.isElectron ? api : null;
}

/** 当前是否处于 Electron 桌面环境（定时融合仅在桌面应用可用） */
export function isDesktopEnvironment(): boolean {
  return getElectronAPI() !== null;
}

// ==================== 配置读写 ====================

export function loadAutoSyncConfig(): AutoSyncConfig {
  return {
    enabled: localStorage.getItem(LS_KEYS.enabled) === 'true',
    folderPath: localStorage.getItem(LS_KEYS.folderPath) || '',
    interval: (localStorage.getItem(LS_KEYS.interval) as AutoMergeInterval) || '1h',
  };
}

export function saveAutoSyncConfig(config: AutoSyncConfig) {
  localStorage.setItem(LS_KEYS.enabled, String(config.enabled));
  localStorage.setItem(LS_KEYS.folderPath, config.folderPath);
  localStorage.setItem(LS_KEYS.interval, config.interval);
}

function getMergedList(): string[] {
  try {
    return JSON.parse(localStorage.getItem(LS_KEYS.mergedList) || '[]');
  } catch {
    return [];
  }
}

function appendMergedList(key: string) {
  const list = getMergedList();
  list.push(key);
  // 仅保留最近 200 条，防止无限增长
  localStorage.setItem(LS_KEYS.mergedList, JSON.stringify(list.slice(-200)));
}

/** 已处理文件的组合键（文件夹+文件名）：更换同步文件夹后同名文件不会被误判为已处理 */
function mergedKey(folderPath: string, fileName: string): string {
  return `${folderPath}\\${fileName}`;
}

// ==================== 扫描与融合 ====================

/** 扫描同步文件夹并融合新文件（手动"立即检查"与定时检查共用） */
export async function runAutoSyncCheck(): Promise<AutoSyncReport> {
  const api = getElectronAPI();
  const config = loadAutoSyncConfig();
  const report: AutoSyncReport = {
    checkedAt: new Date().toISOString(),
    folderPath: config.folderPath,
    folderOk: false,
    filesFound: 0,
    reports: [],
  };

  if (!api) {
    report.folderError = '定时融合仅在桌面应用中可用';
    return report;
  }
  if (!config.folderPath) {
    report.folderError = '未设置同步文件夹';
    return report;
  }

  const listResult = await api.listBackupFiles(config.folderPath);
  if (!listResult.success) {
    report.folderError = listResult.error || '无法访问同步文件夹';
    return report;
  }
  report.folderOk = true;

  const merged = new Set(getMergedList());
  const pending = (listResult.files || []).filter((f) => !merged.has(mergedKey(config.folderPath, f)));
  report.filesFound = pending.length;

  for (const fileName of pending) {
    try {
      const readResult = await api.readBackupFile(config.folderPath, fileName);
      if (!readResult.success || !readResult.content) {
        report.reports.push({ fileName, ok: false, error: readResult.error || '读取失败' });
        continue;
      }

      const raw = JSON.parse(readResult.content);
      const parsed = parseBackupFile(raw);
      if (!parsed.success) {
        report.reports.push({ fileName, ok: false, error: parsed.error });
        continue;
      }

      const result = await executeMerge(parsed.data as BackupData);
      if (!result.success) {
        report.reports.push({ fileName, ok: false, error: result.error, result });
        continue;
      }
      report.reports.push({ fileName, ok: true, result });

      // 标记已处理：重命名 + 清单（双保险）
      await api.markFileMerged(config.folderPath, fileName);
      appendMergedList(mergedKey(config.folderPath, fileName));
    } catch (err) {
      report.reports.push({
        fileName,
        ok: false,
        error: err instanceof Error ? err.message : '处理失败',
      });
    }
  }

  return report;
}

/** 弹出系统对话框选择同步文件夹（仅 Electron），返回所选路径或 null */
export async function pickSyncFolder(): Promise<string | null> {
  const api = getElectronAPI();
  if (!api) return null;
  return api.selectSyncFolder();
}

// ==================== 调度器 ====================

/** interval 选项与说明 */
export const AUTO_MERGE_INTERVAL_OPTIONS: { value: AutoMergeInterval; label: string }[] = [
  { value: '30min', label: '每30分钟' },
  { value: '1h', label: '每1小时' },
  { value: 'daily8', label: '每天8点' },
  { value: 'startup', label: '仅应用启动时' },
];

class AutoSyncManager {
  private timer: ReturnType<typeof setInterval> | null = null;
  private dailyTimer: ReturnType<typeof setInterval> | null = null;
  private lastDailyRunDate = '';
  private running = false;
  private onReport: ((report: AutoSyncReport) => void) | null = null;

  /** 启动调度（依据 localStorage 配置）；开启时立即执行一次启动检查 */
  start(onReport?: (report: AutoSyncReport) => void) {
    this.stop();
    if (onReport) this.onReport = onReport;

    const config = loadAutoSyncConfig();
    if (!config.enabled || !isDesktopEnvironment()) return;

    // 启动时立即检查一次
    void this.runOnce('startup');

    if (config.interval === '30min') {
      this.timer = setInterval(() => void this.runOnce(), 30 * 60 * 1000);
    } else if (config.interval === '1h') {
      this.timer = setInterval(() => void this.runOnce(), 60 * 60 * 1000);
    } else if (config.interval === 'daily8') {
      // 每60秒检查时刻，到达每天8点后且当日未执行过则触发（本地时区）
      this.lastDailyRunDate = localStorage.getItem('auto_merge_last_daily') || '';
      this.dailyTimer = setInterval(() => {
        const now = new Date();
        const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        if (now.getHours() >= 8 && this.lastDailyRunDate !== today) {
          this.lastDailyRunDate = today;
          localStorage.setItem('auto_merge_last_daily', today);
          void this.runOnce();
        }
      }, 60 * 1000);
    }
    // 'startup'：仅启动检查，不设定时器
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.dailyTimer) {
      clearInterval(this.dailyTimer);
      this.dailyTimer = null;
    }
  }

  /** 手动触发一次检查（"立即检查"按钮），返回报告 */
  async checkNow(): Promise<AutoSyncReport> {
    return this.runOnce();
  }

  private async runOnce(_trigger?: string): Promise<AutoSyncReport> {
    // 防重入：上一次检查未完成时跳过
    if (this.running) {
      return {
        checkedAt: new Date().toISOString(),
        folderPath: loadAutoSyncConfig().folderPath,
        folderOk: false,
        folderError: '上一次检查仍在进行中',
        filesFound: 0,
        reports: [],
      };
    }
    this.running = true;
    try {
      const report = await runAutoSyncCheck();
      if (this.onReport) this.onReport(report);
      return report;
    } finally {
      this.running = false;
    }
  }
}

export const autoSyncManager = new AutoSyncManager();
