import { useState, useEffect } from 'react';
import { Card, Button, Upload, Modal, Input, message, Divider, Tag, Radio, Select, Switch, Space, Alert, Popover } from 'antd';
import {
  UploadOutlined, ExclamationCircleOutlined, FileTextOutlined,
  FileExcelOutlined, MergeOutlined, FolderOpenOutlined, SyncOutlined, SettingOutlined,
} from '@ant-design/icons';
import { db } from '../db';
import { addLog } from '../utils/logHelper';
import { createBackup, createBackupExcel, parseBackupFile, getBackupSummary } from '../utils/backup';
import type { BackupScope, BackupData } from '../utils/backup';
import { parseBackupExcelFile } from '../utils/backup';
import { previewMerge, executeMerge } from '../utils/mergeData';
import type { MergePreview, MergeResult } from '../utils/mergeData';
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
  // 定时自动融合配置
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

  // ==================== 恢复（JSON / Excel 双格式） ====================

  const doRestore = async (data: BackupData, isExcel: boolean, migrated: boolean) => {
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
    await addLog(isExcel ? 'RESTORE_EXCEL' : 'RESTORE_DATA', `数据恢复（${isExcel ? 'Excel' : `JSON，${migrated ? '旧版迁移' : '本版格式'}`}）`);
    message.success('数据恢复成功，即将刷新页面');
    setTimeout(() => window.location.reload(), 1500);
  };

  const handleRestore = async (file: File) => {
    const isExcel = /\.xlsx$/i.test(file.name);
    if (isExcel) {
      // Excel 备份恢复
      const parsed = await parseBackupExcelFile(file);
      if (!parsed.success) {
        message.error(parsed.error);
        return false;
      }
      const summary = getBackupSummary(parsed.data);
      Modal.confirm({
        title: '确认恢复数据（Excel 备份）',
        icon: <ExclamationCircleOutlined />,
        width: 480,
        content: (
          <div>
            <p style={{ marginBottom: 12, color: '#666' }}>
              即将恢复以下 Excel 备份数据，当前所有数据将被覆盖：
            </p>
            <div style={{ background: '#fafafa', padding: 12, borderRadius: 6, marginBottom: 8 }}>
              <p><FileExcelOutlined /> 备份版本：{summary.appVersion}（Schema v{summary.schemaVersion}）</p>
              <p>备份时间：{new Date(summary.backupTime).toLocaleString('zh-CN')}</p>
              <p>人员：{summary.memberCount} 人 | 会议：{summary.meetingCount} 条</p>
              <p>谈心谈话：{summary.talkCount} 条 | 操作日志：0 条（Excel 备份不含日志）</p>
            </div>
            <p style={{ color: '#ff4d4f', fontWeight: 500 }}>此操作不可撤销，确认恢复？</p>
          </div>
        ),
        okText: '确认恢复',
        cancelText: '取消',
        okButtonProps: { danger: true },
        onOk: () => doRestore(parsed.data, true, false),
      });
      return false;
    }

    // JSON 备份恢复
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const raw = JSON.parse(e.target!.result as string);
        const result = parseBackupFile(raw);
        if (!result.success) {
          message.error(result.error);
          return;
        }
        const summary = getBackupSummary(result.data);
        // 子集备份（仅会议/仅谈话）恢复将清空本机人员等其他数据，需额外警示
        const isSubsetBackup =
          result.data.tables.members.data.length === 0 &&
          (result.data.tables.meetings.data.length > 0 || result.data.tables.talkRecords.data.length > 0);
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
                <p><FileTextOutlined /> 备份版本：{summary.appVersion}（Schema v{summary.schemaVersion}）</p>
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
              {result.migrated && (
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
          onOk: () => doRestore(result.data, false, result.migrated),
        });
      } catch {
        message.error('备份文件解析失败，请确认文件未损坏');
      }
    };
    reader.readAsText(file);
    return false;
  };

  // ==================== 手动融合 ====================

  const handleMergeFile = async (file: File) => {
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

  const handleConfirmMerge = async () => {
    if (!mergePendingData) return;
    setMerging(true);
    try {
      const result = await executeMerge(mergePendingData);
      setMergePreview(null);
      setMergePendingData(null);
      if (result.success) {
        setMergeResult(result);
        await addLog('MERGE_DATA', `数据融合：新增会议${result.addMeetings}条、人员${result.addMembers}人、谈话${result.addTalks}条，跳过会议${result.skipMeetings}条、人员${result.skipMembers}人、谈话${result.skipTalks}条`);
      } else {
        message.error(`融合失败：${result.error}`);
      }
    } finally {
      setMerging(false);
    }
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
      </Card>

      <Card title="数据恢复" style={{ marginBottom: 16 }}>
        <p style={{ color: '#666', marginBottom: 16 }}>
          选择之前导出的备份文件（JSON 或 Excel）进行数据恢复。恢复将<b>覆盖</b>当前所有数据，请谨慎操作。
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
          组长使用同一应用录入数据后导出备份文件（JSON）交给你，融合将按记录 ID 智能合并进本机数据库（<b>不覆盖</b>已有数据：相同记录保留本机版本，仅新增本机没有的记录）。
        </p>
        <Upload beforeUpload={handleMergeFile} showUploadList={false} accept=".json">
          <Button type="primary" icon={<MergeOutlined />}>选择组长备份文件融合</Button>
        </Upload>

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

      {/* 融合预览确认弹窗 */}
      <Modal
        title="确认融合数据"
        open={!!mergePreview}
        width={520}
        onCancel={() => {
          setMergePreview(null);
          setMergePendingData(null);
        }}
        onOk={handleConfirmMerge}
        okText="确认融合"
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
            {mergePreview.sameNameMembers.length > 0 && (
              <Alert
                style={{ marginBottom: 8 }}
                type="warning"
                showIcon
                message={`以下人员与本机同名但记录 ID 不同，将作为新人员并入，请融合后手动核查：${mergePreview.sameNameMembers.join('、')}`}
              />
            )}
            <p style={{ color: '#666' }}>相同 ID 的记录保留本机版本，不会覆盖你的修改。</p>
          </div>
        )}
      </Modal>

      {/* 融合结果报告弹窗 */}
      <Modal
        title="融合完成"
        open={!!mergeResult}
        width={480}
        footer={<Button type="primary" onClick={() => setMergeResult(null)}>知道了</Button>}
        onCancel={() => setMergeResult(null)}
      >
        {mergeResult && (
          <div>
            <div style={{ background: '#f6ffed', border: '1px solid #b7eb8f', padding: 12, borderRadius: 6, marginBottom: 12 }}>
              <p style={{ margin: 0 }}><b>新增会议：</b>{mergeResult.addMeetings} 条</p>
              <p style={{ margin: 0 }}><b>新增人员：</b>{mergeResult.addMembers} 人</p>
              <p style={{ margin: 0 }}><b>新增谈话：</b>{mergeResult.addTalks} 条</p>
              <p style={{ margin: 0, color: '#999' }}>跳过（本机已存在）：会议 {mergeResult.skipMeetings} 条、人员 {mergeResult.skipMembers} 人、谈话 {mergeResult.skipTalks} 条</p>
            </div>
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
