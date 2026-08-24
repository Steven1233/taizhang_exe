/**
 * 备份数据结构与版本迁移
 *
 * 当前 Schema 版本: 3
 * 兼容: V1.0 (schemaVersion=1)、V2.0 (schemaVersion=2) 备份文件可自动迁移到 V3.0
 *
 * 备份文件格式:
 * {
 *   appVersion: "3.0.0",       // 应用版本号
 *   schemaVersion: 3,          // 数据模式版本号（用于迁移判断）
 *   backupTime: "ISO8601",     // 备份时间
 *   tables: {
 *     members:        { count: N, data: [...] },
 *     meetings:       { count: N, data: [...] },
 *     operationLogs:  { count: N, data: [...] },
 *     talkRecords:    { count: N, data: [...] }
 *   }
 * }
 */

import { db, normalizeMember } from '../db';
import type { Member, Meeting, OperationLog, TalkRecord, Participant } from '../types';
import { migrateMeetingTypeName, MEMBER_STATUS_LABEL, TALK_METHOD_LABEL } from '../types';

// ==================== 类型定义 ====================

/** 当前应用版本 */
export const APP_VERSION = '3.2.0';

/** 当前数据模式版本 */
export const SCHEMA_VERSION = 3;

/** 备份导出范围（V3.1：组长侧可导出子集） */
export type BackupScope = 'all' | 'meetings' | 'talks';

/** 旧版备份数据（V1.0 格式） */
interface BackupV1 {
  version: string;
  timestamp: string;
  members: Record<string, unknown>[];
  meetings: Record<string, unknown>[];
  logs?: Record<string, unknown>[];
  operationLogs?: Record<string, unknown>[];
}

/** 备份包中单个表的结构 */
interface TableSnapshot<T> {
  count: number;
  data: T[];
}

/** 当前版本备份数据格式 */
export interface BackupData {
  appVersion: string;
  schemaVersion: number;
  backupTime: string;
  tables: {
    members: TableSnapshot<Member>;
    meetings: TableSnapshot<Meeting>;
    operationLogs: TableSnapshot<OperationLog>;
    talkRecords: TableSnapshot<TalkRecord>;
  };
}

// ==================== 导出备份 ====================

/** 导出当前数据为 JSON 备份文件（scope 可选：全部/仅会议/仅谈话） */
export async function createBackup(scope: BackupScope = 'all'): Promise<Blob> {
  const [allMembers, allMeetings, allOperationLogs, allTalkRecords] = await Promise.all([
    db.members.toArray(),
    db.meetings.toArray(),
    db.operationLogs.toArray(),
    db.talkRecords.toArray(),
  ]);

  const meetings = scope === 'talks' ? [] : allMeetings;
  const talkRecords = scope === 'meetings' ? [] : allTalkRecords;
  const members = scope === 'all' ? allMembers : [];
  // 子集导出（组长侧同步用）不含操作日志，保持文件轻量且不干扰管理员日志
  const operationLogs = scope === 'all' ? allOperationLogs : [];

  const backup: BackupData = {
    appVersion: APP_VERSION,
    schemaVersion: SCHEMA_VERSION,
    backupTime: new Date().toISOString(),
    tables: {
      members:        { count: members.length,        data: members },
      meetings:       { count: meetings.length,       data: meetings },
      operationLogs:  { count: operationLogs.length,  data: operationLogs },
      talkRecords:    { count: talkRecords.length,    data: talkRecords },
    },
  };

  return new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
}

// ==================== Excel 备份导出（V3.1 新增） ====================

/** 状态枚举 → 中文标签 反查表 */
const STATUS_LABEL_TO_VALUE: Record<string, Member['status']> = {
  [MEMBER_STATUS_LABEL.active]: 'active',
  [MEMBER_STATUS_LABEL.transferred]: 'transferred',
  [MEMBER_STATUS_LABEL.seconded]: 'seconded',
  [MEMBER_STATUS_LABEL.resigned]: 'resigned',
};

/** 出席状态 → 中文 */
function attendanceLabel(p: Participant): string {
  if (p.status === 'leave') return p.leaveReason ? `请假(${p.leaveReason})` : '请假';
  if (p.status === 'absent') return '缺席';
  return p.isGuest ? '列席' : '出席';
}

/** 序列化参会人员列表 → "张三:出席:memberId; 李四*:列席:" */
function serializeParticipants(participants: Participant[]): string {
  return participants
    .map((p) => {
      const name = p.isTemporary ? `${p.name}*` : p.name;
      return `${name}:${attendanceLabel(p)}:${p.memberId || ''}`;
    })
    .join('; ');
}

/** 序列化状态历史 → "在职@2026-01-01; 离职@2026-03-01" */
function serializeStatusHistory(member: Member): string {
  return (member.statusHistory || [])
    .map((h) => `${MEMBER_STATUS_LABEL[h.status]}@${h.date}`)
    .join('; ');
}

/** 导出当前数据为 Excel 备份文件（4 Sheet：人员/会议记录/谈心谈话/备份信息） */
export async function createBackupExcel(scope: BackupScope = 'all'): Promise<Blob> {
  const XLSX = await import('xlsx-js-style');

  const [allMembers, allMeetings, allTalkRecords] = await Promise.all([
    db.members.toArray(),
    db.meetings.toArray(),
    db.talkRecords.toArray(),
  ]);
  const members = scope === 'all' ? allMembers : [];
  const meetings = scope === 'talks' ? [] : allMeetings;
  const talkRecords = scope === 'meetings' ? [] : allTalkRecords;

  const wb = XLSX.utils.book_new();
  const scopeLabel = scope === 'all' ? '全部数据' : scope === 'meetings' ? '仅会议记录' : '仅谈心谈话';

  // ---- Sheet: 人员 ----
  const memberRows = members.map((m) => ({
    '姓名': m.name,
    '部室': m.title || '',
    '部门/支部': m.department || '',
    '党小组': m.partyGroup || '',
    '党小组组长': m.isGroupLeader ? '是' : '否',
    '支委职务': m.committeeRole || '',
    '联系电话': m.phone || '',
    '状态': MEMBER_STATUS_LABEL[m.status],
    '状态历史': serializeStatusHistory(m),
    '创建时间': m.createdAt,
    '更新时间': m.updatedAt,
    '记录ID': m.id,
  }));
  const wsMembers = XLSX.utils.json_to_sheet(memberRows.length > 0 ? memberRows : [{ '姓名': '' }]);
  XLSX.utils.book_append_sheet(wb, wsMembers, '人员');

  // ---- Sheet: 会议记录 ----
  const meetingRows = meetings.map((m) => ({
    '会议名称': m.name || '',
    '会议类型': m.type.join('、'),
    '所属党小组': (m.partyGroups || []).join('、'),
    '日期': m.date,
    '时间': m.time,
    '地点': m.location,
    '主持人': m.host,
    '记录人': m.recorder || '',
    '议题': m.topic,
    '决议': m.resolution || '',
    '参会人员': serializeParticipants(m.participants || []),
    '记录ID': m.id,
  }));
  const wsMeetings = XLSX.utils.json_to_sheet(meetingRows.length > 0 ? meetingRows : [{ '会议名称': '' }]);
  XLSX.utils.book_append_sheet(wb, wsMeetings, '会议记录');

  // ---- Sheet: 谈心谈话 ----
  const talkRows = talkRecords.map((t) => ({
    '谈话方式': TALK_METHOD_LABEL[t.method],
    '谈话类型': t.type,
    '谈话人': t.talkerName,
    '谈话人职务': t.talkerTitle || '',
    '谈话对象': (t.targetNames && t.targetNames.length > 0 ? t.targetNames : [t.targetName]).filter(Boolean).join('、'),
    '谈话对象职务': t.targetTitle || '',
    '联系人': t.contactPerson || '',
    '日期': t.talkDate,
    '时段': t.timePeriod === 'pm' ? '下午' : '上午',
    '提纲': t.outline,
    '地点': t.location,
    '五必谈': t.isFiveMustTalk ? '是' : '否',
    '备注': t.remark || '',
    '记录ID': t.id,
  }));
  const wsTalks = XLSX.utils.json_to_sheet(talkRows.length > 0 ? talkRows : [{ '谈话方式': '' }]);
  XLSX.utils.book_append_sheet(wb, wsTalks, '谈心谈话');

  // ---- Sheet: 备份信息（来源校验依据） ----
  const infoRows = [
    { '项目': '应用版本', '值': APP_VERSION },
    { '项目': 'Schema版本', '值': String(SCHEMA_VERSION) },
    { '项目': '备份时间', '值': new Date().toISOString() },
    { '项目': '导出范围', '值': scopeLabel },
    { '项目': '人员记录数', '值': String(members.length) },
    { '项目': '会议记录数', '值': String(meetings.length) },
    { '项目': '谈心谈话记录数', '值': String(talkRecords.length) },
  ];
  const wsInfo = XLSX.utils.json_to_sheet(infoRows);
  XLSX.utils.book_append_sheet(wb, wsInfo, '备份信息');

  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

// ==================== Excel 备份解析（V3.1 新增） ====================

/** 解析参会人员序列 → Participant[]（格式"姓名:状态:memberId"，容忍原因文本含冒号） */
function parseParticipants(text: string): Participant[] {
  if (!text || !text.trim()) return [];
  return text
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((item) => {
      // 三段式：姓名 = 第一段，memberId = 最后一段，状态 = 中间段（原因可能含冒号）
      const parts = item.split(':');
      const rawName = (parts[0] || '').trim();
      const memberId = (parts.length >= 3 ? parts[parts.length - 1] : '').trim();
      const statusText = (parts.length >= 3 ? parts.slice(1, -1).join(':') : parts[1] || '出席').trim();
      const isTemporary = rawName.endsWith('*');
      const name = isTemporary ? rawName.slice(0, -1) : rawName;

      let status: Participant['status'] = 'attended';
      let leaveReason: string | undefined;
      let isGuest = false;
      if (statusText === '请假') {
        status = 'leave';
      } else if (statusText.startsWith('请假(') && statusText.endsWith(')')) {
        status = 'leave';
        leaveReason = statusText.slice(3, -1);
      } else if (statusText === '缺席') {
        status = 'absent';
      } else if (statusText === '列席') {
        status = 'attended';
        isGuest = true;
      }

      return {
        memberId: memberId || name,  // memberId 缺失时以姓名兜底（保持统计可匹配）
        name,
        status,
        isTemporary,
        leaveReason,
        isGuest,
      };
    });
}

/** 解析状态历史序列 → MemberStatusChange[] */
function parseStatusHistory(text: string): Member['statusHistory'] {
  if (!text || !text.trim()) return [];
  return text
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((item) => {
      const [label, date] = item.split('@');
      const status = STATUS_LABEL_TO_VALUE[(label || '').trim()] || 'active';
      return { status, date: (date || '').trim() || new Date().toISOString().substring(0, 10) };
    });
}

/** 谈话方式中文 → 枚举 */
function parseTalkMethod(label: string): TalkRecord['method'] {
  if (label === '集体谈话') return 'collective';
  if (label === '组织约谈') return 'organized';
  return 'individual';
}

/** 读取 Excel 备份文件并还原为当前格式 BackupData */
export async function parseBackupExcelFile(file: File): Promise<
  | { success: true; data: BackupData }
  | { success: false; error: string }
> {
  try {
    const XLSX = await import('xlsx-js-style');
    const buffer = await file.arrayBuffer();
    const wb = XLSX.read(new Uint8Array(buffer), { type: 'array' });

    const sheetNames = wb.SheetNames;
    if (!sheetNames.includes('备份信息')) {
      return { success: false, error: '非本应用导出的 Excel 备份文件（缺少"备份信息"工作表）' };
    }

    // ---- 备份信息 ----
    const infoRows = XLSX.utils.sheet_to_json<Record<string, string>>(wb.Sheets['备份信息']);
    const info: Record<string, string> = {};
    infoRows.forEach((r) => {
      if (r['项目']) info[String(r['项目'])] = String(r['值'] ?? '');
    });
    const scope = info['导出范围'] === '仅会议记录' ? 'meetings'
      : info['导出范围'] === '仅谈心谈话' ? 'talks' : 'all';

    // ---- 人员 ----
    const members: Member[] = [];
    if (sheetNames.includes('人员') && scope === 'all') {
      const rows = XLSX.utils.sheet_to_json<Record<string, string>>(wb.Sheets['人员']);
      for (const r of rows) {
        if (!r['姓名']) continue;
        const status = STATUS_LABEL_TO_VALUE[r['状态']] || 'active';
        const now = new Date().toISOString();
        members.push({
          id: String(r['记录ID'] || ''),
          name: String(r['姓名'] || ''),
          title: String(r['部室'] || ''),
          department: String(r['部门/支部'] || ''),
          phone: String(r['联系电话'] || ''),
          status,
          partyGroup: String(r['党小组'] || ''),
          isGroupLeader: r['党小组组长'] === '是',
          committeeRole: String(r['支委职务'] || ''),
          statusHistory: parseStatusHistory(String(r['状态历史'] || '')),
          createdAt: String(r['创建时间'] || now),
          updatedAt: String(r['更新时间'] || now),
        });
      }
    }

    // ---- 会议记录 ----
    const meetings: Meeting[] = [];
    if (sheetNames.includes('会议记录') && scope !== 'talks') {
      const rows = XLSX.utils.sheet_to_json<Record<string, string>>(wb.Sheets['会议记录']);
      for (const r of rows) {
        if (!r['日期']) continue;
        const type = String(r['会议类型'] || '').split('、').map((t) => t.trim()).filter(Boolean);
        const now = new Date().toISOString();
        meetings.push({
          id: String(r['记录ID'] || ''),
          name: String(r['会议名称'] || ''),
          type: type.map((t) => migrateMeetingTypeName(t)),
          partyGroups: String(r['所属党小组'] || '').split('、').map((g) => g.trim()).filter(Boolean),
          date: String(r['日期'] || ''),
          time: String(r['时间'] || ''),
          location: String(r['地点'] || ''),
          host: String(r['主持人'] || ''),
          recorder: String(r['记录人'] || ''),
          topic: String(r['议题'] || ''),
          summary: '',
          resolution: String(r['决议'] || ''),
          participants: parseParticipants(String(r['参会人员'] || '')),
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    // ---- 谈心谈话 ----
    const talkRecords: TalkRecord[] = [];
    if (sheetNames.includes('谈心谈话') && scope !== 'meetings') {
      const rows = XLSX.utils.sheet_to_json<Record<string, string>>(wb.Sheets['谈心谈话']);
      for (const r of rows) {
        if (!r['日期']) continue;
        const targetNames = String(r['谈话对象'] || '').split('、').map((n) => n.trim()).filter(Boolean);
        const now = new Date().toISOString();
        talkRecords.push({
          id: String(r['记录ID'] || ''),
          method: parseTalkMethod(String(r['谈话方式'] || '')),
          type: (String(r['谈话类型'] || '领导班子成员之间') as TalkRecord['type']),
          talkerName: String(r['谈话人'] || ''),
          talkerTitle: String(r['谈话人职务'] || ''),
          targetName: targetNames.join('、'),
          targetNames,
          targetTitle: String(r['谈话对象职务'] || ''),
          contactPerson: String(r['联系人'] || ''),
          talkDate: String(r['日期'] || ''),
          timePeriod: r['时段'] === '下午' ? 'pm' : 'am',
          outline: String(r['提纲'] || ''),
          location: String(r['地点'] || ''),
          content: '',
          isFiveMustTalk: r['五必谈'] === '是',
          remark: String(r['备注'] || ''),
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    return {
      success: true,
      data: {
        appVersion: info['应用版本'] || APP_VERSION,
        schemaVersion: Number(info['Schema版本']) || SCHEMA_VERSION,
        backupTime: info['备份时间'] || new Date().toISOString(),
        tables: {
          members: { count: members.length, data: members },
          meetings: { count: meetings.length, data: meetings },
          operationLogs: { count: 0, data: [] },
          talkRecords: { count: talkRecords.length, data: talkRecords },
        },
      },
    };
  } catch {
    return { success: false, error: 'Excel 备份文件解析失败，请确认文件未损坏' };
  }
}

// ==================== 数据规范化（升级到 V3.0） ====================

/** 规范化 member 到 V3.0 格式（补 statusHistory） */
function normalizeMemberToV3(raw: Record<string, unknown>): Member {
  const base = normalizeMember(raw as unknown as Member);
  const statusHistory = Array.isArray(raw.statusHistory) && raw.statusHistory.length > 0
    ? (raw.statusHistory as Member['statusHistory'])
    : [{ status: base.status, date: (base.createdAt || new Date().toISOString()).substring(0, 10) }];
  return { ...base, statusHistory };
}

/** 规范化 meeting 到 V3.0 格式（类型映射、name、partyGroups） */
function normalizeMeetingToV3(raw: Record<string, unknown>): Meeting {
  const rawType = raw.type;
  let type: string[] = Array.isArray(rawType)
    ? (rawType as string[]).map((t) => migrateMeetingTypeName(t))
    : typeof rawType === 'string'
      ? [migrateMeetingTypeName(rawType)]
      : [];

  // partyGroups：优先取数组；兼容旧 partyGroup 字符串
  let partyGroups: string[];
  if (Array.isArray(raw.partyGroups)) {
    partyGroups = raw.partyGroups as string[];
  } else if (typeof raw.partyGroup === 'string' && raw.partyGroup) {
    partyGroups = [raw.partyGroup];
  } else {
    partyGroups = [];
  }

  const participants = (raw.participants as Record<string, unknown>[]) || [];
  return {
    id:           String(raw.id || ''),
    name:         String(raw.name || ''),
    type,
    partyGroups,
    date:         String(raw.date || ''),
    time:         String(raw.time || ''),
    location:     String(raw.location || ''),
    host:         String(raw.host || ''),
    recorder:     String(raw.recorder || ''),
    topic:        String(raw.topic || ''),
    summary:      String(raw.summary || ''),
    resolution:   String(raw.resolution || ''),
    participants: participants.map((p: Record<string, unknown>) => ({
      memberId:    String(p.memberId || ''),
      name:        String(p.name || ''),
      status:      (p.status as 'attended' | 'leave' | 'absent') || 'attended',
      isTemporary: Boolean(p.isTemporary),
      leaveReason: p.leaveReason ? String(p.leaveReason) : undefined,
    })),
    createdAt:    String(raw.createdAt || new Date().toISOString()),
    updatedAt:    String(raw.updatedAt || new Date().toISOString()),
  };
}

/** 规范化 talkRecord 到 V3.0 格式（补新字段默认值） */
function normalizeTalkToV3(raw: Record<string, unknown>): TalkRecord {
  const targetName = String(raw.targetName || '');
  const targetNames = Array.isArray(raw.targetNames)
    ? (raw.targetNames as string[]).filter(Boolean)
    : targetName ? [targetName] : [];
  return {
    id:            String(raw.id || ''),
    method:        (raw.method as TalkRecord['method']) || 'individual',
    type:          (raw.type as TalkRecord['type']) || '领导班子成员之间',
    talkerName:    String(raw.talkerName || ''),
    talkerTitle:   String(raw.talkerTitle || ''),
    targetName,
    targetNames,
    targetTitle:   String(raw.targetTitle || ''),
    contactPerson: String(raw.contactPerson || ''),
    talkDate:      String(raw.talkDate || ''),
    timePeriod:    (raw.timePeriod as 'am' | 'pm') || 'am',
    outline:       String(raw.outline || ''),
    location:      String(raw.location || ''),
    content:       String(raw.content || ''),
    isFiveMustTalk: Boolean(raw.isFiveMustTalk),
    remark:        String(raw.remark || ''),
    createdAt:     String(raw.createdAt || new Date().toISOString()),
    updatedAt:     String(raw.updatedAt || new Date().toISOString()),
  };
}

// ==================== 版本迁移 ====================

/** 迁移 V1 备份 → 当前格式 */
function migrateV1ToCurrent(raw: BackupV1): BackupData {
  const now = new Date().toISOString();

  // 迁移 members（V3.0：补 statusHistory）
  const members: Member[] = (raw.members || []).map((m: Record<string, unknown>) => normalizeMemberToV3({
    id:            String(m.id || ''),
    name:          String(m.name || ''),
    title:         String(m.title || ''),
    department:    Array.isArray(m.department) ? m.department.filter(Boolean).join('、') : String(m.department || ''),
    phone:         String(m.phone || ''),
    status:        (m.status === 'inactive' ? 'resigned' : m.status) || 'active',
    partyGroup:    String(m.partyGroup || ''),
    isGroupLeader: Boolean(m.isGroupLeader),
    committeeRole: String(m.committeeRole || ''),
    createdAt:     String(m.createdAt || now),
    updatedAt:     String(m.updatedAt || now),
  }));

  // 迁移 meetings（V3.0：类型映射 + name + partyGroups）
  const meetings: Meeting[] = (raw.meetings || []).map((m: Record<string, unknown>) =>
    normalizeMeetingToV3(m)
  );

  // 迁移日志
  const rawLogs = raw.operationLogs || raw.logs || [];
  const operationLogs: OperationLog[] = (rawLogs as Record<string, unknown>[]).map((l) => ({
    id:          String(l.id || ''),
    timestamp:   String(l.timestamp || now),
    type:        l.type as OperationLog['type'],
    description: String(l.description || ''),
    detail:      String(l.detail || ''),
    result:      (l.result as 'success' | 'failure') || 'success',
  }));

  return {
    appVersion: APP_VERSION,
    schemaVersion: SCHEMA_VERSION,
    backupTime: now,
    tables: {
      members:        { count: members.length,        data: members },
      meetings:       { count: meetings.length,       data: meetings },
      operationLogs:  { count: operationLogs.length,  data: operationLogs },
      talkRecords:    { count: 0,                      data: [] },
    },
  };
}

// ==================== 导入恢复 ====================

/** 检测备份文件格式 */
function detectFormat(raw: Record<string, unknown>): 'v1' | 'v2' | 'unknown' {
  // V2/V3 格式: 有 tables 字段
  if (raw.tables && typeof raw.tables === 'object') return 'v2';
  // V1 格式: 有 version + members 字段
  if (raw.version && raw.members) return 'v1';
  return 'unknown';
}

/** 验证 V2 备份数据完整性 */
function validateV2Backup(raw: Record<string, unknown>): BackupData | null {
  try {
    const tables = raw.tables as Record<string, unknown>;
    if (!tables) return null;

    const membersTable = tables.members as Record<string, unknown> | undefined;
    const meetingsTable = tables.meetings as Record<string, unknown> | undefined;

    if (!membersTable || !Array.isArray(membersTable.data)) return null;
    if (!meetingsTable || !Array.isArray(meetingsTable.data)) return null;

    return raw as unknown as BackupData;
  } catch {
    return null;
  }
}

/** 将 V2 格式备份升级为 V3.0 当前格式（类型映射+新字段默认值） */
function upgradeV2ToV3(data: BackupData): BackupData {
  const now = new Date().toISOString();
  const members: Member[] = (data.tables.members.data || []).map((m: any) => normalizeMemberToV3(m));
  const meetings: Meeting[] = (data.tables.meetings.data || []).map((m: any) => normalizeMeetingToV3(m));
  const talkRecords: TalkRecord[] = (data.tables.talkRecords?.data || []).map((t: any) => normalizeTalkToV3(t));
  const operationLogs: OperationLog[] = data.tables.operationLogs?.data || [];
  return {
    appVersion: APP_VERSION,
    schemaVersion: SCHEMA_VERSION,
    backupTime: data.backupTime || now,
    tables: {
      members:        { count: members.length,       data: members },
      meetings:       { count: meetings.length,      data: meetings },
      operationLogs:  { count: operationLogs.length, data: operationLogs },
      talkRecords:    { count: talkRecords.length,   data: talkRecords },
    },
  };
}

/** 解析并迁移备份文件为当前格式 */
export function parseBackupFile(raw: Record<string, unknown>): {
  success: true;
  data: BackupData;
  migrated: boolean;
} | {
  success: false;
  error: string;
} {
  if (!raw || typeof raw !== 'object') {
    return { success: false, error: '备份文件格式无效' };
  }

  const format = detectFormat(raw);

  if (format === 'v1') {
    // V1 格式：执行迁移
    const data = migrateV1ToCurrent(raw as unknown as BackupV1);
    return { success: true, data, migrated: true };
  }

  if (format === 'v2') {
    // V2/V3 格式：验证后使用；旧 schemaVersion 自动升级到 V3
    const data = validateV2Backup(raw);
    if (!data) {
      return { success: false, error: '备份文件数据不完整，缺少必要的数据表' };
    }
    const isOldSchema = data.schemaVersion < SCHEMA_VERSION;
    const upgraded = isOldSchema ? upgradeV2ToV3(data) : data;
    return { success: true, data: upgraded, migrated: isOldSchema };
  }

  return { success: false, error: '无法识别的备份文件格式，请确认文件来自本应用' };
}

/** 获取备份文件摘要信息 */
export function getBackupSummary(backup: BackupData): {
  memberCount: number;
  meetingCount: number;
  logCount: number;
  talkCount: number;
  backupTime: string;
  appVersion: string;
  schemaVersion: number;
} {
  return {
    memberCount:  backup.tables.members.count,
    meetingCount: backup.tables.meetings.count,
    logCount:     backup.tables.operationLogs.count,
    talkCount:    backup.tables.talkRecords.count,
    backupTime:   backup.backupTime,
    appVersion:   backup.appVersion,
    schemaVersion: backup.schemaVersion,
  };
}
