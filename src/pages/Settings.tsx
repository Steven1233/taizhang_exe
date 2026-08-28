import { useState, useEffect } from 'react';
import { Card, Button, Upload, Modal, Input, message, Divider, Tag, Radio, Select, Switch, Space, Alert, Popover, Table } from 'antd';
import {
  UploadOutlined, ExclamationCircleOutlined, FileTextOutlined,
  FileExcelOutlined, MergeOutlined, FolderOpenOutlined, SyncOutlined, SettingOutlined,
  ClockCircleOutlined, DownloadOutlined,
} from '@ant-design/icons';
import { db } from '../db';
import { addLog } from '../utils/logHelper';
import {
  createBackup, createBackupExcel, parseBackupFile, parseBackupFileUnified,
  parseMergeExcelSource, getBackupSummary,
  loadAutoBackupConfig, saveAutoBackupConfig, loadAutoBackupLast,
  AUTO_BACKUP_INTERVAL_OPTIONS, AUTO_BACKUP_KEEP_OPTIONS, AUTO_BACKUP_TRIGGER_KEY,
} from '../utils/backup';
import type {
  BackupScope, BackupData, AutoBackupConfig, AutoBackupLastState,
  BackupSourceKind,
} from '../utils/backup';
import { previewMerge, executeMerge } from '../utils/mergeData';
import type { MergePreview, MergeResult, MergeConflict, MergeConflictResolution } from '../utils/mergeData';
import { parseGroupExcelFile, importGroupMeetings, downloadGroupTemplate } from '../utils/importGroupExcel';
import type { GroupExcelParseResult, UnmatchedNameDecision } from '../utils/importGroupExcel';
import {
  loadAutoSyncConfig, saveAutoSyncConfig, pickSyncFolder, isDesktopEnvironment,
  autoSyncManager, AUTO_MERGE_INTERVAL_OPTIONS,
} from '../utils/autoSync';
import type { AutoMergeInterval } from '../utils/autoSync';

function backupFileName(ext: string, scope: BackupScope): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const dateStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  // V3.2：文件名体现导出范围
  const scopeLabel = scope === 'all' ? '全部数据' : scope === 'meetings' ? '仅会议记录' : '仅谈心谈话';
  return `党建台账备份_${scopeLabel}_${dateStr}.${ext}`;
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

/** 备份来源标签（恢复确认弹窗展示） */
function sourceLabel(source: BackupSourceKind): string {
  if (source === 'excel-json') return 'Excel 整库备份（读 BACKUP_JSON 隐藏表，无损恢复）';
  if (source === 'excel-legacy') return 'Excel 备份（旧版逐表格式）';
  return 'JSON 备份';
}

export default function Settings() {
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [resetConfirmText, setResetConfirmText] = useState('');
  const [backupScope, setBackupScope] = useState<BackupScope>('all');
  const [backingUp, setBackingUp] = useState(false);

  // ---- 数据融合（组长数据同步） ----
  const [mergePreview, setMergePreview] = useState<MergePreview | null>(null);
  const [mergePendingData, setMergePendingData] = useState<BackupData | null>(null);
  const [mergeResult, setMergeResult] = useState<MergeResult | null>(null);
  const [merging, setMerging] = useState(false);
  // 字段级冲突解决选择（V3.4 8a）：键 `${memberId}|${field}` → local/backup，默认本机
  const [conflictChoices, setConflictChoices] = useState<Record<string, 'local' | 'backup'>>({});
  // Excel 台账融合校验报告（V3.4 8c）
  const [groupReport, setGroupReport] = useState<{ fileName: string; result: GroupExcelParseResult } | null>(null);
  const [groupDecisions, setGroupDecisions] = useState<Record<string, UnmatchedNameDecision>>({});
  const [importingGroup, setImportingGroup] = useState(false);

  // ---- 定时自动备份（V3.4 功能 1） ----
  const [backupCfg, setBackupCfg] = useState<AutoBackupConfig>(() => loadAutoBackupConfig());
  const [backupLast, setBackupLast] = useState<AutoBackupLastState | null>(() => loadAutoBackupLast());
  // 手动"立即备份一次"的触发标识：主进程执行完成后回写状态并在此轮询结果
  const [pendingBackupTrigger, setPendingBackupTrigger] = useState('');

  // ---- 定时自动融合配置 ----
  const [autoEnabled, setAutoEnabled] = useState(false);
  const [autoFolder, setAutoFolder] = useState('');
  const [autoInterval, setAutoInterval] = useState<AutoMergeInterval>('1h');
  const [checkingNow, setCheckingNow] = useState(false);
  const isDesktop = isDesktopEnvironment();

  useEffect(() => {
    const config = loadAutoSyncConfig();
    setAutoEnabled(config.enabled);
    setAutoFolder(config.folderPath);
    setAutoInterval(config.interval);
  }, []);

  // 融合预览打开时初始化冲突选择（默认本机）
  useEffect(() => {
    if (mergePreview) {
      const init: Record<string, 'local' | 'backup'> = {};
      mergePreview.conflicts.forEach((c) => {
        init[`${c.memberId}|${c.field}`] = 'local';
      });
      setConflictChoices(init);
    }
  }, [mergePreview]);

  // Excel 校验报告打开时初始化未匹配姓名处理（默认按临时人员并入）
  useEffect(() => {
    if (groupReport) {
      const init: Record<string, UnmatchedNameDecision> = {};
      groupReport.result.unmatchedNames.forEach((n) => {
        init[n] = 'temporary';
      });
      setGroupDecisions(init);
    }
  }, [groupReport]);

  // 手动"立即备份一次"后轮询结果（主进程回写 localStorage 的 AUTO_BACKUP_LAST_KEY）
  useEffect(() => {
    if (!pendingBackupTrigger) return;
    const timer = setInterval(() => {
      const last = loadAutoBackupLast();
      if (last && last.trigger === pendingBackupTrigger) {
        setBackupLast(last);
        setPendingBackupTrigger('');
        if (last.ok) {
          message.success({ key: 'auto-backup', content: `备份完成：${(last.files || []).join('、')}` });
        } else {
          message.error({ key: 'auto-backup', content: `备份失败：${last.error || '未知错误'}` });
        }
      }
    }, 1500);
    return () => clearInterval(timer);
  }, [pendingBackupTrigger]);

  // 周期刷新上次备份状态（调度器自动执行的备份状态也在此展示）
  useEffect(() => {
    const timer = setInterval(() => setBackupLast(loadAutoBackupLast()), 5000);
    return () => clearInterval(timer);
  }, []);

  // ==================== 备份 ====================

  const handleBackup = async (format: 'json' | 'excel') => {
    setBackingUp(true);
    try {
      if (format === 'json') {
        const blob = await createBackup(backupScope);
        downloadBlob(blob, backupFileName('json', backupScope));
        await addLog('BACKUP_DATA', `数据备份（JSON，${backupScope === 'all' ? '全部数据' : backupScope === 'meetings' ? '仅会议记录' : '仅谈心谈话'}）`);
      } else {
        const blob = await createBackupExcel(backupScope);
        downloadBlob(blob, backupFileName('xlsx', backupScope));
        await addLog('BACKUP_EXCEL', `数据备份（Excel，${backupScope === 'all' ? '全部数据' : backupScope === 'meetings' ? '仅会议记录' : '仅谈心谈话'}）`);
      }
      message.success(`备份成功（${format === 'json' ? 'JSON' : 'Excel'} 格式）`);
    } catch {
      message.error('备份失败');
    } finally {
      setBackingUp(false);
    }
  };

  // ==================== 恢复（V3.4：.json / .xlsx 统一入口，xlsx 优先读 BACKUP_JSON 隐藏表） ====================

  const doRestore = async (data: BackupData, source: BackupSourceKind, migrated: boolean) => {
    const { tables } = data;
    await db.transaction(
      'rw',
      db.members, db.meetings, db.operationLogs, db.talkRecords,
      async () => {
        await db.members.clear();
        await db.meetings.clear();
        await db.operationLogs.clear();
        await db.talkRecords.clear();
        await db.members.bulkAdd(tables.members.data);
        await db.meetings.bulkAdd(tables.meetings.data);
        if (tables.operationLogs.data.length > 0) {
          await db.operationLogs.bulkAdd(tables.operationLogs.data);
        }
        if (tables.talkRecords.data.length > 0) {
          await db.talkRecords.bulkAdd(tables.talkRecords.data);
        }
      },
    );
    const isExcel = source !== 'json';
    await addLog(
      isExcel ? 'RESTORE_EXCEL' : 'RESTORE_DATA',
      `数据恢复（${sourceLabel(source)}${migrated ? '，旧版格式自动迁移' : ''}）`,
    );
    message.success('数据恢复成功，即将刷新页面');
    setTimeout(() => window.location.reload(), 1500);
  };

  const handleRestore = async (file: File) => {
    const parsed = await parseBackupFileUnified(file);
    if (!parsed.success) {
      if (parsed.notBackupFile) {
        // 无 BACKUP_JSON 隐藏表的 xlsx（组长手工表、台账导出）→ 引导至融合入口
        Modal.warning({
          title: '非备份文件',
          content: parsed.error,
        });
      } else {
        message.error(parsed.error);
      }
      return false;
    }

    const summary = getBackupSummary(parsed.data);
    // 子集备份（仅会议/仅谈话）恢复将清空本机人员等其他数据，需额外警示
    const isSubsetBackup =
      parsed.data.tables.members.data.length === 0 &&
      (parsed.data.tables.meetings.data.length > 0 || parsed.data.tables.talkRecords.data.length > 0);
    Modal.confirm({
      title: '确认恢复数据',
      icon: <ExclamationCircleOutlined />,
      width: 480,
      content: (
        <div>
          <p style={{ marginBottom: 12, color: '#666' }}>
            即将恢复以下备份数据，当前所有数据将被覆盖：
          </p>
          <div style={{ background: '#fafafa', padding: 12, borderRadius: 6, marginBottom: 8 }}>
            <p>
              {parsed.source === 'json' ? <FileTextOutlined /> : <FileExcelOutlined />}
              {' '}备份版本：{summary.appVersion}（Schema v{summary.schemaVersion}）· {sourceLabel(parsed.source)}
            </p>
            <p>备份时间：{new Date(summary.backupTime).toLocaleString('zh-CN')}</p>
            <p>人员：{summary.memberCount} 人 | 会议：{summary.meetingCount} 条</p>
            <p>谈心谈话：{summary.talkCount} 条 | 操作日志：{summary.logCount} 条</p>
          </div>
          {isSubsetBackup && (
            <Alert
              style={{ marginBottom: 8 }}
              type="warning"
              showIcon
              message={'该备份为子集备份（仅会议记录或仅谈心谈话），恢复后将清空本机人员等其他数据！建议使用「数据融合」合并子集备份，而非恢复。'}
            />
          )}
          {parsed.migrated && (
            <Tag color="orange" style={{ marginBottom: 8 }}>
              旧版格式 — 将自动迁移为当前格式
            </Tag>
          )}
          <p style={{ color: '#ff4d4f', fontWeight: 500 }}>此操作不可撤销，确认恢复？</p>
        </div>
      ),
      okText: '确认恢复',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: () => doRestore(parsed.data, parsed.source, parsed.migrated),
    });
    return false;
  };

  // ==================== 手动融合（V3.4 8c：同时接受 .json 备份与 .xlsx 台账） ====================

  const handleMergeFile = async (file: File) => {
    // Excel：优先识别备份格式（BACKUP_JSON 隐藏表 / 旧版"备份信息"表）走整库融合，
    // 否则按组长台账格式（17 列）解析校验后导入
    if (/\.xlsx$/i.test(file.name)) {
      const backupParsed = await parseMergeExcelSource(file);
      if (backupParsed) {
        const preview = await previewMerge(backupParsed.data);
        setMergePendingData(backupParsed.data);
        setMergePreview(preview);
        return false;
      }
      const groupParsed = await parseGroupExcelFile(file);
      if (!groupParsed.success) {
        message.error(groupParsed.error);
        return false;
      }
      setGroupReport({ fileName: file.name, result: groupParsed.result });
      return false;
    }

    // JSON 备份融合
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const raw = JSON.parse(e.target!.result as string);
        const result = parseBackupFile(raw);
        if (!result.success) {
          message.error(result.error);
          return;
        }
        const preview = await previewMerge(result.data);
        setMergePendingData(result.data);
        setMergePreview(preview);
      } catch {
        message.error('备份文件解析失败，请确认文件未损坏');
      }
    };
    reader.readAsText(file);
    return false;
  };

  /** 冲突批量设置：全部保留本机 / 全部采用备份 */
  const setAllConflictUse = (use: 'local' | 'backup') => {
    const next: Record<string, 'local' | 'backup'> = {};
    (mergePreview?.conflicts || []).forEach((c) => {
      next[`${c.memberId}|${c.field}`] = use;
    });
    setConflictChoices(next);
  };

  const handleConfirmMerge = async () => {
    if (!mergePendingData) return;
    setMerging(true);
    try {
      // 冲突解决：仅回传用户明确选择"备份"的字段（默认本机为准）
      const resolutions: MergeConflictResolution[] = [];
      (mergePreview?.conflicts || []).forEach((c) => {
        if (conflictChoices[`${c.memberId}|${c.field}`] === 'backup') {
          resolutions.push({ memberId: c.memberId, field: c.field, use: 'backup' });
        }
      });
      const result = await executeMerge(mergePendingData, resolutions);
      setMergePreview(null);
      setMergePendingData(null);
      if (result.success) {
        setMergeResult(result);
        await addLog(
          'MERGE_DATA',
          `数据融合：新增会议${result.addMeetings}条、人员${result.addMembers}人、谈话${result.addTalks}条，` +
          `跳过会议${result.skipMeetings}条、人员${result.skipMembers}人、谈话${result.skipTalks}条，` +
          `字段级更新人员${result.updatedMembers}人`,
        );
      } else {
        message.error(`融合失败：${result.error}`);
      }
    } finally {
      setMerging(false);
    }
  };

  // ==================== Excel 台账融合导入（V3.4 8c） ====================

  const handleDownloadTemplate = async () => {
    try {
      await downloadGroupTemplate();
      message.success('组长填报模板已下载（17 列台账字段 + 填写说明 + 示例行）');
    } catch {
      message.error('模板下载失败');
    }
  };

  const handleConfirmGroupImport = async () => {
    if (!groupReport || !groupReport.result.ok) return;
    setImportingGroup(true);
    try {
      const count = await importGroupMeetings(groupReport.result.meetings, groupDecisions);
      setGroupReport(null);
      message.success(`Excel 台账导入完成：新增会议 ${count} 条`);
    } catch {
      message.error('导入失败，请重试');
    } finally {
      setImportingGroup(false);
    }
  };

  // ==================== 定时自动备份（V3.4 功能 1） ====================

  /** 配置即改即存（主进程每 2 秒轮询 localStorage 生效） */
  const applyBackupCfg = (patch: Partial<AutoBackupConfig>) => {
    const next = { ...backupCfg, ...patch };
    setBackupCfg(next);
    saveAutoBackupConfig(next);
  };

  const handleBackupPickFolder = async () => {
    const folder = await pickSyncFolder();
    if (folder) {
      applyBackupCfg({ folderPath: folder });
      message.success(`已设置备份文件夹：${folder}`);
    }
  };

  /** 立即备份一次：写入触发标志，由主进程执行（写入目标文件夹 + 滚动清理） */
  const handleBackupNow = () => {
    if (!backupCfg.folderPath) {
      message.warning('请先选择备份文件夹');
      return;
    }
    const trigger = String(Date.now());
    localStorage.setItem(AUTO_BACKUP_TRIGGER_KEY, trigger);
    setPendingBackupTrigger(trigger);
    message.loading({ key: 'auto-backup', content: '正在执行备份…', duration: 0 });
  };

  /** 下次备份时间提示（依据频率与上次备份时间推算） */
  const nextBackupHint = (cfg: AutoBackupConfig, last: AutoBackupLastState | null): string => {
    if (!cfg.enabled) return '';
    if (cfg.interval === 'startup') return '下次：应用启动时';
    if (cfg.interval === 'daily8') return '下次：每天 08:00';
    if (!last || !last.ok) return '';
    const ms = cfg.interval === '30min' ? 30 * 60 * 1000 : 60 * 60 * 1000;
    return `下次：约 ${new Date(Date.parse(last.time) + ms).toLocaleString('zh-CN')}`;
  };

  // ==================== 定时自动融合 ====================

  const applyAutoConfig = (next: { enabled?: boolean; folderPath?: string; interval?: AutoMergeInterval }) => {
    const config = {
      enabled: next.enabled ?? autoEnabled,
      folderPath: next.folderPath ?? autoFolder,
      interval: next.interval ?? autoInterval,
    };
    setAutoEnabled(config.enabled);
    setAutoFolder(config.folderPath);
    setAutoInterval(config.interval);
    saveAutoSyncConfig(config);
    autoSyncManager.start();
  };

  const handlePickFolder = async () => {
    const folder = await pickSyncFolder();
    if (folder) {
      applyAutoConfig({ folderPath: folder });
      message.success(`已设置同步文件夹：${folder}`);
    }
  };

  const handleCheckNow = async () => {
    setCheckingNow(true);
    try {
      const report = await autoSyncManager.checkNow();
      if (!report.folderOk) {
        message.warning(report.folderError || '无法访问同步文件夹');
        return;
      }
      if (report.filesFound === 0) {
        message.info('同步文件夹中暂无待处理的备份文件');
        return;
      }
      const okCount = report.reports.filter((r) => r.ok).length;
      const failCount = report.reports.length - okCount;
      if (failCount === 0) {
        message.success(`已融合 ${okCount} 个备份文件`);
      } else {
        message.warning(`融合完成：成功 ${okCount} 个，失败 ${failCount} 个（详见操作日志）`);
      }
    } finally {
      setCheckingNow(false);
    }
  };

  // ==================== 重置 ====================

  const handleReset = async () => {
    if (resetConfirmText !== '确认重置') {
      message.warning('请输入"确认重置"');
      return;
    }
    await db.transaction(
      'rw',
      db.members, db.meetings, db.operationLogs, db.talkRecords,
      async () => {
        await db.members.clear();
        await db.meetings.clear();
        await db.operationLogs.clear();
        await db.talkRecords.clear();
      },
    );
    await addLog('RESET_DATA', '数据重置');
    setResetModalOpen(false);
    setResetConfirmText('');
    message.success('数据已重置，即将刷新页面');
    setTimeout(() => window.location.reload(), 1500);
  };

  const scopeHelp = (
    <div style={{ maxWidth: 260 }}>
      <p style={{ margin: '4px 0' }}><b>全部数据：</b>人员、会议、谈话、操作日志（管理员整机备份）</p>
      <p style={{ margin: '4px 0' }}><b>仅会议记录：</b>组长侧日常同步推荐，文件小、融合时不会带入组长侧人员数据</p>
      <p style={{ margin: '4px 0' }}><b>仅谈心谈话：</b>仅导出谈话记录</p>
    </div>
  );

  // 字段级冲突表格列（V3.4 8a：逐条切换采用本机/备份）
  const conflictColumns = [
    { title: '人员', dataIndex: 'memberName', width: 90 },
    { title: '字段', dataIndex: 'fieldLabel', width: 100 },
    { title: '本机值', dataIndex: 'localValue', ellipsis: true },
    { title: '备份值', dataIndex: 'backupValue', ellipsis: true },
    {
      title: '采用',
      width: 150,
      render: (_: unknown, r: MergeConflict) => (
        <Radio.Group
          size="small"
          optionType="button"
          buttonStyle="solid"
          value={conflictChoices[`${r.memberId}|${r.field}`] || 'local'}
          onChange={(e) =>
            setConflictChoices((prev) => ({
              ...prev,
              [`${r.memberId}|${r.field}`]: e.target.value as 'local' | 'backup',
            }))
          }
          options={[
            { label: '本机', value: 'local' },
            { label: '备份', value: 'backup' },
          ]}
        />
      ),
    },
  ];

  // Excel 校验报告：格式错误列表列
  const groupErrorColumns = [
    { title: 'Excel 行号', dataIndex: 'row', width: 90 },
    { title: '问题原因', dataIndex: 'reason' },
  ];

  // Excel 校验报告：未匹配姓名处理列（不自动新建人员，由用户逐人决定）
  const unmatchedColumns = [
    { title: '姓名', dataIndex: 'name', width: 100 },
    {
      title: '处理',
      render: (_: unknown, record: { name: string }) => (
        <Radio.Group
          value={groupDecisions[record.name] || 'temporary'}
          onChange={(e) =>
            setGroupDecisions((prev) => ({
              ...prev,
              [record.name]: e.target.value as UnmatchedNameDecision,
            }))
          }
          options={[
            { label: '按临时人员并入', value: 'temporary' },
            { label: '取消该人', value: 'skip' },
          ]}
        />
      ),
    },
  ];

  return (
    <div>
      <Card title="数据备份" style={{ marginBottom: 16 }}>
        <p style={{ color: '#666', marginBottom: 12 }}>
          将当前数据导出为备份文件，支持 JSON（结构完整，用于恢复与融合）和 Excel（表格可读，用于存档与恢复）两种格式，建议定期备份。
        </p>
        <Space wrap style={{ marginBottom: 16 }}>
          <span>导出范围：</span>
          <Radio.Group
            value={backupScope}
            onChange={(e) => setBackupScope(e.target.value)}
            optionType="button"
            buttonStyle="solid"
            options={[
              { label: '全部数据', value: 'all' },
              { label: '仅会议记录', value: 'meetings' },
              { label: '仅谈心谈话', value: 'talks' },
            ]}
          />
          <Popover content={scopeHelp} title="导出范围说明">
            <Button type="link" size="small" icon={<SettingOutlined />}>范围说明</Button>
          </Popover>
        </Space>
        <div>
          <Space>
            <Button type="primary" icon={<FileTextOutlined />} loading={backingUp} onClick={() => handleBackup('json')}>
              导出 JSON 备份
            </Button>
            <Button icon={<FileExcelOutlined />} loading={backingUp} onClick={() => handleBackup('excel')}>
              导出 Excel 备份
            </Button>
          </Space>
        </div>

        <Divider style={{ margin: '16px 0' }} />

        <p style={{ color: '#666', marginBottom: 12 }}>
          <ClockCircleOutlined style={{ marginRight: 6, color: '#1677ff' }} />
          <b>定时自动备份：</b>按设定频率自动将整库数据备份到指定文件夹，超出保留份数自动清理最旧备份，无需手动操作。
        </p>
        {isDesktop ? (
          <Space direction="vertical" style={{ width: '100%' }} size={12}>
            <Space wrap>
              <span>自动备份：</span>
              <Switch checked={backupCfg.enabled} onChange={(checked) => applyBackupCfg({ enabled: checked })} />
              <span style={{ margin: '0 8px 0 16px' }}>频率：</span>
              <Select
                style={{ width: 130 }}
                value={backupCfg.interval}
                disabled={!backupCfg.enabled}
                onChange={(v) => applyBackupCfg({ interval: v })}
                options={AUTO_BACKUP_INTERVAL_OPTIONS}
              />
              <span style={{ margin: '0 8px 0 16px' }}>保留份数：</span>
              <Select
                style={{ width: 90 }}
                value={backupCfg.keep}
                disabled={!backupCfg.enabled}
                onChange={(v) => applyBackupCfg({ keep: v })}
                options={AUTO_BACKUP_KEEP_OPTIONS.map((k) => ({ value: k, label: `${k} 份` }))}
              />
              <span style={{ margin: '0 8px 0 16px' }}>格式：</span>
              <Radio.Group
                value={backupCfg.format}
                disabled={!backupCfg.enabled}
                onChange={(e) => applyBackupCfg({ format: e.target.value })}
                optionType="button"
                buttonStyle="solid"
                options={[
                  { label: 'JSON', value: 'json' },
                  { label: 'JSON + Excel', value: 'json+excel' },
                ]}
              />
            </Space>
            <Space wrap>
              <span>备份文件夹：</span>
              <Button icon={<FolderOpenOutlined />} onClick={handleBackupPickFolder}>
                {backupCfg.folderPath ? '更换文件夹' : '选择备份文件夹'}
              </Button>
              {backupCfg.folderPath && (
                <Tag color="blue" style={{ maxWidth: 420, whiteSpace: 'normal' }}>
                  {backupCfg.folderPath}
                </Tag>
              )}
            </Space>
            <Space wrap>
              <Button
                icon={<ClockCircleOutlined />}
                loading={!!pendingBackupTrigger}
                disabled={!backupCfg.folderPath}
                onClick={handleBackupNow}
              >
                立即备份一次
              </Button>
              <span style={{ color: '#999', fontSize: 12 }}>
                {backupLast
                  ? `上次备份：${new Date(backupLast.time).toLocaleString('zh-CN')} ${backupLast.ok ? '成功' : `失败（${backupLast.error || '未知错误'}）`}`
                  : '上次备份：尚无记录'}
                {nextBackupHint(backupCfg, backupLast) ? ` · ${nextBackupHint(backupCfg, backupLast)}` : ''}
              </span>
            </Space>
            {backupCfg.enabled && !backupCfg.folderPath && (
              <Alert type="warning" showIcon message="已开启自动备份但未设置备份文件夹，请选择文件夹后生效" />
            )}
            <p style={{ color: '#999', fontSize: 12, margin: 0 }}>
              两种格式均可整库恢复；Excel 版另含人读台账（整库数据存于隐藏工作表 BACKUP_JSON，恢复入口可直接读取）。配置修改后自动保存，由后台调度执行。
            </p>
          </Space>
        ) : (
          <Alert
            type="info"
            showIcon
            message="定时自动备份仅在桌面应用（安装版/绿色版）中可用。当前为浏览器模式，请使用上方手动导出备份。"
          />
        )}
      </Card>

      <Card title="数据恢复" style={{ marginBottom: 16 }}>
        <p style={{ color: '#666', marginBottom: 16 }}>
          选择之前导出的备份文件进行数据恢复，支持 <b>.json</b> 与 <b>.xlsx</b> 两种格式（xlsx 优先读取 BACKUP_JSON 隐藏表整库无损恢复）。恢复将<b>覆盖</b>当前所有数据，请谨慎操作。
        </p>
        <Upload beforeUpload={handleRestore} showUploadList={false} accept=".json,.xlsx">
          <Button icon={<UploadOutlined />}>选择备份文件恢复（.json / .xlsx）</Button>
        </Upload>
      </Card>

      <Card
        title={<span><MergeOutlined style={{ color: '#d4380d', marginRight: 6 }} />数据融合（党小组组长数据同步）</span>}
        style={{ marginBottom: 16 }}
      >
        <p style={{ color: '#666', marginBottom: 12 }}>
          支持 <b>.json 备份</b>与 <b>.xlsx 台账</b>两种来源：JSON 备份按记录 ID 智能合并（相同人员做字段级融合，本机非空白字段为准）；
          Excel 台账（组长手工填报表 / 自动备份 Excel / 台账导出回导）按 17 列格式解析校验后导入。融合<b>不覆盖</b>本机已有数据。
        </p>
        <Space wrap>
          <Upload beforeUpload={handleMergeFile} showUploadList={false} accept=".json,.xlsx">
            <Button type="primary" icon={<MergeOutlined />}>选择文件融合（.json / .xlsx）</Button>
          </Upload>
          <Button icon={<DownloadOutlined />} onClick={handleDownloadTemplate}>
            下载组长填报模板
          </Button>
        </Space>

        <Divider style={{ margin: '16px 0' }} />

        <p style={{ color: '#666', marginBottom: 12 }}>
          <SyncOutlined style={{ marginRight: 6, color: '#1677ff' }} />
          <b>定时自动融合：</b>将组长发来的备份文件放入同步文件夹，应用按设定频率自动扫描并融合，处理成功的文件自动标记 .merged 后缀。
        </p>
        {isDesktop ? (
          <Space direction="vertical" style={{ width: '100%' }} size={12}>
            <Space wrap>
              <span>定时融合：</span>
              <Switch
                checked={autoEnabled}
                onChange={(checked) => applyAutoConfig({ enabled: checked })}
              />
              <span style={{ margin: '0 8px 0 16px' }}>检查频率：</span>
              <Select
                style={{ width: 140 }}
                value={autoInterval}
                disabled={!autoEnabled}
                onChange={(v) => applyAutoConfig({ interval: v })}
                options={AUTO_MERGE_INTERVAL_OPTIONS}
              />
              <Button
                icon={<SyncOutlined />}
                loading={checkingNow}
                disabled={!autoEnabled || !autoFolder}
                onClick={handleCheckNow}
              >
                立即检查
              </Button>
            </Space>
            <Space wrap>
              <span>同步文件夹：</span>
              <Button icon={<FolderOpenOutlined />} onClick={handlePickFolder}>
                {autoFolder ? '更换文件夹' : '选择同步文件夹'}
              </Button>
              {autoFolder && (
                <Tag color="blue" style={{ maxWidth: 420, whiteSpace: 'normal' }}>
                  {autoFolder}
                </Tag>
              )}
            </Space>
            {autoEnabled && !autoFolder && (
              <Alert type="warning" showIcon message="已开启定时融合但未设置同步文件夹，请选择文件夹后生效" />
            )}
          </Space>
        ) : (
          <Alert
            type="info"
            showIcon
            message="定时自动融合仅在桌面应用（安装版/绿色版）中可用。当前为浏览器模式，请使用上方手动融合功能。"
          />
        )}
      </Card>

      <Card title="数据重置">
        <p style={{ color: '#666', marginBottom: 16 }}>
          清空所有数据（人员、会议记录、谈心谈话、操作日志），此操作不可撤销。
        </p>
        <Button danger onClick={() => setResetModalOpen(true)}>
          重置所有数据
        </Button>
      </Card>

      <Divider />

      <div style={{ textAlign: 'center', color: '#999', fontSize: 12 }}>
        党建工作台账应用 v3.1 | 所有数据存储在本地
      </div>

      {/* 融合预览与冲突处理弹窗（V3.4 8a/8b：字段级冲突逐条选择 + 疑似重复提示） */}
      <Modal
        title={
          mergePreview && mergePreview.conflicts.length > 0
            ? `确认融合数据（${mergePreview.conflicts.length} 处字段冲突）`
            : '确认融合数据'
        }
        open={!!mergePreview}
        width={680}
        onCancel={() => {
          setMergePreview(null);
          setMergePendingData(null);
        }}
        onOk={handleConfirmMerge}
        okText="执行融合"
        cancelText="取消"
        confirmLoading={merging}
      >
        {mergePreview && (
          <div>
            <p style={{ marginBottom: 12, color: '#666' }}>
              备份版本 {mergePreview.appVersion}（Schema v{mergePreview.schemaVersion}），
              备份时间 {new Date(mergePreview.backupTime).toLocaleString('zh-CN')}，融合统计如下：
            </p>
            <div style={{ background: '#fafafa', padding: 12, borderRadius: 6, marginBottom: 8 }}>
              <p>新增会议：<b style={{ color: '#389e0d' }}>{mergePreview.addMeetings}</b> 条（已存在跳过 {mergePreview.skipMeetings} 条）</p>
              <p>新增人员：<b style={{ color: '#389e0d' }}>{mergePreview.addMembers}</b> 人（已存在跳过 {mergePreview.skipMembers} 人）</p>
              <p>新增谈话：<b style={{ color: '#389e0d' }}>{mergePreview.addTalks}</b> 条（已存在跳过 {mergePreview.skipTalks} 条）</p>
            </div>
            {mergePreview.autoFilled.length > 0 && (
              <Alert
                style={{ marginBottom: 8 }}
                type="info"
                showIcon
                message={`已自动补齐本机空白字段 ${mergePreview.autoFilled.length} 处（无需确认）：${mergePreview.autoFilled.map((f) => `${f.memberName}（${f.fieldLabel}）`).join('、')}`}
              />
            )}
            {mergePreview.conflicts.length > 0 && (
              <div style={{ marginBottom: 8 }}>
                <Space style={{ marginBottom: 8 }} wrap>
                  <span style={{ color: '#666' }}>字段冲突（本机与备份均有值且不同，默认保留本机）：</span>
                  <Button size="small" onClick={() => setAllConflictUse('local')}>全部保留本机</Button>
                  <Button size="small" onClick={() => setAllConflictUse('backup')}>全部采用备份</Button>
                </Space>
                <Table
                  size="small"
                  rowKey={(r) => `${r.memberId}|${r.field}`}
                  columns={conflictColumns}
                  dataSource={mergePreview.conflicts}
                  pagination={false}
                  scroll={{ y: 240 }}
                />
              </div>
            )}
            {mergePreview.duplicateMeetings.length > 0 && (
              <Alert
                style={{ marginBottom: 8 }}
                type="warning"
                showIcon
                message={`疑似重复会议 ${mergePreview.duplicateMeetings.length} 条：${mergePreview.duplicateMeetings.map((d) => `「${d.date} ${d.name}」`).join('、')}。将正常并入，建议融合后手动清理多余记录。`}
              />
            )}
            {mergePreview.duplicateTalks.length > 0 && (
              <Alert
                style={{ marginBottom: 8 }}
                type="warning"
                showIcon
                message={`疑似重复谈话 ${mergePreview.duplicateTalks.length} 条：${mergePreview.duplicateTalks.map((d) => `「${d.date} ${d.talker}→${d.targets}」`).join('、')}。将正常并入，建议融合后手动清理多余记录。`}
              />
            )}
            {mergePreview.statusDiffs.length > 0 && (
              <p style={{ color: '#999', fontSize: 12 }}>
                状态差异不自动融合：{mergePreview.statusDiffs.map((s) => `${s.memberName}（本机：${s.localLabel} / 备份：${s.backupLabel}）`).join('、')}——请融合后在人员编辑弹窗的变更历史中核对。
              </p>
            )}
            {mergePreview.sameNameMembers.length > 0 && (
              <Alert
                style={{ marginBottom: 8 }}
                type="warning"
                showIcon
                message={`以下人员与本机同名但记录 ID 不同，将作为新人员并入，请融合后手动核查：${mergePreview.sameNameMembers.join('、')}`}
              />
            )}
            <p style={{ color: '#666' }}>相同 ID 的记录保留本机版本（冲突字段按上表选择应用），不会覆盖你的修改。</p>
          </div>
        )}
      </Modal>

      {/* 融合结果报告弹窗 */}
      <Modal
        title="融合完成"
        open={!!mergeResult}
        width={520}
        footer={<Button type="primary" onClick={() => setMergeResult(null)}>知道了</Button>}
        onCancel={() => setMergeResult(null)}
      >
        {mergeResult && (
          <div>
            <div style={{ background: '#f6ffed', border: '1px solid #b7eb8f', padding: 12, borderRadius: 6, marginBottom: 12 }}>
              <p style={{ margin: 0 }}><b>新增会议：</b>{mergeResult.addMeetings} 条</p>
              <p style={{ margin: 0 }}><b>新增人员：</b>{mergeResult.addMembers} 人</p>
              <p style={{ margin: 0 }}><b>新增谈话：</b>{mergeResult.addTalks} 条</p>
              <p style={{ margin: 0 }}><b>字段级更新人员：</b>{mergeResult.updatedMembers} 人（含自动补齐空白字段 {mergeResult.autoFilled.length} 处）</p>
              <p style={{ margin: 0, color: '#999' }}>跳过（本机已存在）：会议 {mergeResult.skipMeetings} 条、人员 {mergeResult.skipMembers} 人、谈话 {mergeResult.skipTalks} 条</p>
            </div>
            {mergeResult.duplicateMeetings.length > 0 && (
              <Alert
                style={{ marginBottom: 8 }}
                type="warning"
                showIcon
                message={`疑似重复会议 ${mergeResult.duplicateMeetings.length} 条（已并入，建议手动清理）：${mergeResult.duplicateMeetings.map((d) => `「${d.date} ${d.name}」`).join('、')}`}
              />
            )}
            {mergeResult.duplicateTalks.length > 0 && (
              <Alert
                style={{ marginBottom: 8 }}
                type="warning"
                showIcon
                message={`疑似重复谈话 ${mergeResult.duplicateTalks.length} 条（已并入，建议手动清理）：${mergeResult.duplicateTalks.map((d) => `「${d.date} ${d.talker}→${d.targets}」`).join('、')}`}
              />
            )}
            {mergeResult.statusDiffs.length > 0 && (
              <Alert
                style={{ marginBottom: 8 }}
                type="info"
                showIcon
                message={`状态差异（不自动融合，请在人员编辑弹窗的变更历史中核对）：${mergeResult.statusDiffs.map((s) => `${s.memberName}（本机：${s.localLabel} / 备份：${s.backupLabel}）`).join('、')}`}
              />
            )}
            {mergeResult.sameNameMembers.length > 0 && (
              <Alert
                type="warning"
                showIcon
                message={`同名人员已并入，请在人员管理中核查：${mergeResult.sameNameMembers.join('、')}`}
              />
            )}
          </div>
        )}
      </Modal>

      {/* Excel 台账融合校验报告弹窗（V3.4 8c） */}
      <Modal
        title={`校验报告 — ${groupReport?.fileName || ''}`}
        open={!!groupReport}
        width={640}
        onCancel={() => setGroupReport(null)}
        footer={
          groupReport?.result.ok
            ? [
                <Button key="back" onClick={() => setGroupReport(null)}>返回修改</Button>,
                <Button key="ok" type="primary" loading={importingGroup} onClick={handleConfirmGroupImport}>
                  确认导入（{groupReport.result.meetings.length} 条）
                </Button>,
              ]
            : [<Button key="back" type="primary" onClick={() => setGroupReport(null)}>返回修改</Button>]
        }
      >
        {groupReport && (
          <div>
            <Space wrap style={{ marginBottom: 12 }}>
              <Tag color={groupReport.result.meetings.length > 0 ? 'green' : 'default'}>
                可导入会议 {groupReport.result.meetings.length} 条
              </Tag>
              <Tag color={groupReport.result.unmatchedNames.length > 0 ? 'orange' : 'green'}>
                未匹配姓名 {groupReport.result.unmatchedNames.length} 人
              </Tag>
              <Tag color={groupReport.result.duplicates.length > 0 ? 'orange' : 'green'}>
                疑似重复 {groupReport.result.duplicates.length} 条
              </Tag>
              <Tag color={groupReport.result.errors.length > 0 ? 'red' : 'green'}>
                格式问题 {groupReport.result.errors.length} 处
              </Tag>
            </Space>

            {groupReport.result.errors.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <Alert
                  type="error"
                  showIcon
                  style={{ marginBottom: 8 }}
                  message="存在格式错误，整表拦截——请修正下列问题后重新导入"
                />
                <Table
                  size="small"
                  rowKey={(e) => `${e.row}-${e.reason}`}
                  columns={groupErrorColumns}
                  dataSource={groupReport.result.errors}
                  pagination={false}
                />
              </div>
            )}

            {groupReport.result.unmatchedNames.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <p style={{ marginBottom: 8, color: '#666' }}>
                  以下姓名在本机人员库中未匹配到（不自动新建人员），请逐人选择处理方式：
                </p>
                <Table
                  size="small"
                  rowKey="name"
                  columns={unmatchedColumns}
                  dataSource={groupReport.result.unmatchedNames.map((n) => ({ name: n }))}
                  pagination={false}
                />
              </div>
            )}

            {groupReport.result.duplicates.length > 0 && (
              <Alert
                style={{ marginBottom: 12 }}
                type="warning"
                showIcon
                message={`疑似重复会议 ${groupReport.result.duplicates.length} 条（与本机同日期同名称，正常并入，建议导入后手动清理）：${groupReport.result.duplicates.map((d) => `第${d.row}行「${d.date} ${d.name}」`).join('；')}`}
              />
            )}

            {groupReport.result.attendanceFixes.length > 0 && (
              <Alert
                style={{ marginBottom: 12 }}
                type="info"
                showIcon
                message={`出勤四列（应到/实到/请假/缺席）与名单分栏人数不一致 ${groupReport.result.attendanceFixes.length} 处，已按名单明细为准导入：${groupReport.result.attendanceFixes.map((f) => `第${f.row}行 ${f.detail}`).join('；')}`}
              />
            )}

            <p style={{ color: '#999', fontSize: 12, margin: 0 }}>
              参会姓名按本机人员管理匹配（与会议表单同口径）；日期 / 会议类型 / 参会名单分栏格式错误将整表拦截并列出 Excel 行号，修正后重新导入。
            </p>
          </div>
        )}
      </Modal>

      <Modal
        title="确认数据重置"
        open={resetModalOpen}
        onOk={handleReset}
        onCancel={() => {
          setResetModalOpen(false);
          setResetConfirmText('');
        }}
        okText="确认重置"
        cancelText="取消"
        okButtonProps={{ danger: true }}
      >
        <p style={{ marginBottom: 12 }}>此操作将清空所有数据且不可恢复。请输入"确认重置"以继续：</p>
        <Input
          value={resetConfirmText}
          onChange={(e) => setResetConfirmText(e.target.value)}
          placeholder="请输入：确认重置"
        />
      </Modal>
    </div>
  );
}
