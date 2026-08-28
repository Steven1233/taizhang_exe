/**
 * 数据融合（组长数据同步）核心策略
 *
 * 场景：党小组组长与管理员使用同一应用。组长导出备份文件（JSON）交给管理员，
 * 管理员执行"融合"将组长数据智能合并进本机数据库（非覆盖恢复）。
 *
 * 合并策略：
 * - 会议记录 / 人员 / 谈心谈话：按 id 去重——本机不存在则并入；id 相同做人员字段级融合（V3.4 8a）
 * - 人员字段级融合（V3.4 8a）：本机非空白且与备份不同 → 以本机为准并列入冲突提醒（弹窗可批量/逐条改选备份）；
 *   本机空白、备份有值 → 自动补齐（无需确认）；两侧一致 → 无动作。
 *   状态与状态历史不参与字段融合（仅提示差异，由人员编辑弹窗的变更历史人工处理）
 * - 人员同名不同 id：不自动合并，结果报告中列出提示手动处理
 * - 疑似重复（V3.4 8b）：id 不同但"日期+名称"相同的会议、"日期+参与双方"相同的谈话 → 正常并入，报告提示手动清理
 * - 操作日志：不并入（融合操作本身记录新日志）
 */

import { db } from '../db';
import type { BackupData } from './backup';
import type { Member } from '../types';
import { MEMBER_STATUS_LABEL } from '../types';

// ==================== 字段级融合定义（V3.4 8a） ====================

/** 参与字段级融合的人员字段（姓名/部室/部门/支部/党小组/支委职务/党小组组长/联系电话） */
export type MergeFieldKey =
  | 'name'
  | 'title'
  | 'department'
  | 'partyGroup'
  | 'committeeRole'
  | 'isGroupLeader'
  | 'phone';

export const MERGE_FIELD_LABELS: Record<MergeFieldKey, string> = {
  name: '姓名',
  title: '部室',
  department: '部门/支部',
  partyGroup: '党小组',
  committeeRole: '支委职务',
  isGroupLeader: '党小组组长',
  phone: '联系电话',
};

const MERGE_FIELDS: MergeFieldKey[] = [
  'name', 'title', 'department', 'partyGroup', 'committeeRole', 'isGroupLeader', 'phone',
];

/** 字段级冲突（本机与备份同 id 人员，两侧均非空白且取值不同） */
export interface MergeConflict {
  memberId: string;
  memberName: string;
  field: MergeFieldKey;
  fieldLabel: string;
  localValue: string;
  backupValue: string;
}

/** 冲突解决选择（冲突弹窗回传；默认本机） */
export interface MergeConflictResolution {
  memberId: string;
  field: MergeFieldKey;
  use: 'local' | 'backup';
}

/** 自动补齐记录（本机空白、备份有值，无需确认） */
export interface MergeAutoFill {
  memberName: string;
  fieldLabel: string;
  value: string;
}

/** 疑似重复会议（id 不同但日期+名称相同，正常并入仅提示） */
export interface MergeDuplicateMeeting {
  date: string;
  name: string;
}

/** 疑似重复谈话（id 不同但日期+参与双方相同，正常并入仅提示） */
export interface MergeDuplicateTalk {
  date: string;
  talker: string;
  targets: string;
}

/** 人员状态差异（状态不参与字段融合，仅提示事后在编辑弹窗处理） */
export interface MergeStatusDiff {
  memberName: string;
  localLabel: string;
  backupLabel: string;
}

/** 字段是否空白（isGroupLeader 未标记视为空白，可被备份值补齐） */
function isBlankField(m: Member, field: MergeFieldKey): boolean {
  if (field === 'isGroupLeader') return !m.isGroupLeader;
  return !String(m[field] || '').trim();
}

/** 字段展示值（isGroupLeader → 是/否；其余 → 去空白文本） */
function fieldDisplayValue(m: Member, field: MergeFieldKey): string {
  if (field === 'isGroupLeader') return m.isGroupLeader ? '是' : '否';
  return String(m[field] || '').trim();
}

/** 逐字段 diff 本机与备份人员 → 冲突 / 自动补齐 / 状态差异 */
function diffMemberFields(
  local: Member,
  backup: Member
): { conflicts: MergeConflict[]; autoFills: MergeAutoFill[]; statusDiff: MergeStatusDiff | null } {
  const conflicts: MergeConflict[] = [];
  const autoFills: MergeAutoFill[] = [];
  MERGE_FIELDS.forEach((field) => {
    const localBlank = isBlankField(local, field);
    const backupBlank = isBlankField(backup, field);
    if (localBlank && !backupBlank) {
      // 本机空白、备份有值 → 自动补齐
      autoFills.push({
        memberName: local.name || backup.name,
        fieldLabel: MERGE_FIELD_LABELS[field],
        value: fieldDisplayValue(backup, field),
      });
    } else if (!localBlank && !backupBlank && fieldDisplayValue(local, field) !== fieldDisplayValue(backup, field)) {
      // 两侧均有值且不同 → 冲突提醒（默认本机为准）
      conflicts.push({
        memberId: local.id,
        memberName: local.name,
        field,
        fieldLabel: MERGE_FIELD_LABELS[field],
        localValue: fieldDisplayValue(local, field),
        backupValue: fieldDisplayValue(backup, field),
      });
    }
    // 本机有值、备份空白：保留本机，无需提醒
  });
  const statusDiff: MergeStatusDiff | null =
    local.status !== backup.status
      ? {
          memberName: local.name,
          localLabel: MEMBER_STATUS_LABEL[local.status] || local.status,
          backupLabel: MEMBER_STATUS_LABEL[backup.status] || backup.status,
        }
      : null;
  return { conflicts, autoFills, statusDiff };
}

// ==================== 预览与执行 ====================

/** 融合预览统计 */
export interface MergePreview {
  /** 备份文件信息 */
  appVersion: string;
  schemaVersion: number;
  backupTime: string;
  /** 将新增的数量 */
  addMeetings: number;
  addMembers: number;
  addTalks: number;
  /** 已存在（跳过，保留本机）的数量 */
  skipMeetings: number;
  skipMembers: number;
  skipTalks: number;
  /** 与本机人员同名但 id 不同（提示手动处理） */
  sameNameMembers: string[];
  /** 字段级冲突（默认本机为准，可在弹窗批量/逐条改选备份） */
  conflicts: MergeConflict[];
  /** 自动补齐的本机空白字段（无需确认，报告计数提示） */
  autoFilled: MergeAutoFill[];
  /** 疑似重复会议（正常并入，提示手动清理） */
  duplicateMeetings: MergeDuplicateMeeting[];
  /** 疑似重复谈话（正常并入，提示手动清理） */
  duplicateTalks: MergeDuplicateTalk[];
  /** 状态差异人员（不参与字段融合，提示事后人工处理） */
  statusDiffs: MergeStatusDiff[];
}

/** 融合执行结果 */
export interface MergeResult extends MergePreview {
  success: boolean;
  error?: string;
  /** 字段级融合被更新的本机人员数（空白补齐 + 采用备份值） */
  updatedMembers: number;
}

/** 统计备份与本机差异（不写入数据库） */
export async function previewMerge(backup: BackupData): Promise<MergePreview> {
  const [localMemberIds, localMeetingIds, localTalkIds, localMembers, localMeetings, localTalks] = await Promise.all([
    db.members.toCollection().primaryKeys(),
    db.meetings.toCollection().primaryKeys(),
    db.talkRecords.toCollection().primaryKeys(),
    db.members.toArray(),
    db.meetings.toArray(),
    db.talkRecords.toArray(),
  ]);

  const memberIdSet = new Set(localMemberIds as string[]);
  const meetingIdSet = new Set(localMeetingIds as string[]);
  const talkIdSet = new Set(localTalkIds as string[]);
  const localNameSet = new Set(localMembers.map((m) => m.name));
  const localMemberMap = new Map(localMembers.map((m) => [m.id, m]));

  let addMeetings = 0;
  let skipMeetings = 0;
  let addMembers = 0;
  let skipMembers = 0;
  let addTalks = 0;
  let skipTalks = 0;
  const sameNameMembers: string[] = [];
  const conflicts: MergeConflict[] = [];
  const autoFilled: MergeAutoFill[] = [];
  const statusDiffs: MergeStatusDiff[] = [];

  // ---- 会议：id 去重 + 疑似重复（日期+名称） ----
  const localMeetingKeys = new Set(localMeetings.map((m) => `${m.date}|${(m.name || '').trim()}`));
  const duplicateMeetings: MergeDuplicateMeeting[] = [];
  (backup.tables.meetings?.data || []).forEach((m) => {
    if (meetingIdSet.has(m.id)) {
      skipMeetings++;
      return;
    }
    addMeetings++;
    // id 不同但日期+名称相同 → 疑似重复（正常并入，仅提示）
    const key = `${m.date}|${(m.name || '').trim()}`;
    if (m.name && (m.name || '').trim() && localMeetingKeys.has(key)) {
      duplicateMeetings.push({ date: m.date, name: (m.name || '').trim() });
    }
  });

  // ---- 人员：id 去重 + 字段级融合 diff ----
  (backup.tables.members?.data || []).forEach((m) => {
    const local = localMemberMap.get(m.id);
    if (local) {
      skipMembers++;
      const diff = diffMemberFields(local, m);
      conflicts.push(...diff.conflicts);
      autoFilled.push(...diff.autoFills);
      if (diff.statusDiff) statusDiffs.push(diff.statusDiff);
    } else {
      addMembers++;
      // 同名不同 id：不自动合并，提示手动处理
      if (m.name && localNameSet.has(m.name)) sameNameMembers.push(m.name);
    }
  });

  // ---- 谈话：id 去重 + 疑似重复（日期+参与双方） ----
  const talkKey = (t: { talkDate: string; talkerName: string; targetName: string; targetNames?: string[] }) =>
    `${t.talkDate}|${t.talkerName}|${((t.targetNames && t.targetNames.length > 0 ? t.targetNames : [t.targetName]) || []).filter(Boolean).join('、')}`;
  const localTalkKeys = new Set(localTalks.map((t) => talkKey(t)));
  const duplicateTalks: MergeDuplicateTalk[] = [];
  (backup.tables.talkRecords?.data || []).forEach((t) => {
    if (talkIdSet.has(t.id)) {
      skipTalks++;
      return;
    }
    addTalks++;
    if (localTalkKeys.has(talkKey(t))) {
      duplicateTalks.push({
        date: t.talkDate,
        talker: t.talkerName,
        targets: ((t.targetNames && t.targetNames.length > 0 ? t.targetNames : [t.targetName]) || []).filter(Boolean).join('、'),
      });
    }
  });

  return {
    appVersion: backup.appVersion,
    schemaVersion: backup.schemaVersion,
    backupTime: backup.backupTime,
    addMeetings,
    addMembers,
    addTalks,
    skipMeetings,
    skipMembers,
    skipTalks,
    sameNameMembers: [...new Set(sameNameMembers)],
    conflicts,
    autoFilled,
    duplicateMeetings,
    duplicateTalks,
    statusDiffs,
  };
}

/**
 * 执行融合（事务写入）：
 * - 按 id 去重合并，新记录直接并入
 * - 同 id 人员：本机空白字段自动补齐；冲突字段默认保留本机，仅在 resolutions 中明确选择"备份"时应用备份值
 * - 状态与状态历史不参与融合
 */
export async function executeMerge(
  backup: BackupData,
  resolutions?: MergeConflictResolution[]
): Promise<MergeResult> {
  const preview = await previewMerge(backup);
  try {
    const resMap = new Map<string, 'local' | 'backup'>();
    (resolutions || []).forEach((r) => resMap.set(`${r.memberId}|${r.field}`, r.use));

    const newMeetings = (backup.tables.meetings?.data || []).filter((m) => m.id);
    const newMembers = (backup.tables.members?.data || []).filter((m) => m.id);
    const newTalks = (backup.tables.talkRecords?.data || []).filter((t) => t.id);

    let updatedMembers = 0;
    await db.transaction(
      'rw',
      db.members, db.meetings, db.talkRecords,
      async () => {
        // bulkAdd 语义：为避免覆盖本机，先过滤已存在的 id
        const [localMeetingIds, localMemberIds, localTalkIds, localMembers] = await Promise.all([
          db.meetings.toCollection().primaryKeys(),
          db.members.toCollection().primaryKeys(),
          db.talkRecords.toCollection().primaryKeys(),
          db.members.toArray(),
        ]);
        const meetingIdSet = new Set(localMeetingIds as string[]);
        const memberIdSet = new Set(localMemberIds as string[]);
        const talkIdSet = new Set(localTalkIds as string[]);

        const meetingsToAdd = newMeetings.filter((m) => !meetingIdSet.has(m.id));
        const membersToAdd = newMembers.filter((m) => !memberIdSet.has(m.id));
        const talksToAdd = newTalks.filter((t) => !talkIdSet.has(t.id));

        if (meetingsToAdd.length > 0) await db.meetings.bulkAdd(meetingsToAdd);
        if (membersToAdd.length > 0) await db.members.bulkAdd(membersToAdd);
        if (talksToAdd.length > 0) await db.talkRecords.bulkAdd(talksToAdd);

        // ---- 字段级融合（V3.4 8a）：同 id 人员空白补齐 + 冲突按选择应用 ----
        const localMemberMap = new Map(localMembers.map((m) => [m.id, m]));
        const memberUpdates: Member[] = [];
        newMembers.forEach((bm) => {
          const local = localMemberMap.get(bm.id);
          if (!local) return;
          const patch: Partial<Member> = {};
          let changed = false;
          MERGE_FIELDS.forEach((field) => {
            const localBlank = isBlankField(local, field);
            const backupBlank = isBlankField(bm, field);
            if (localBlank && !backupBlank) {
              // 本机空白 → 自动补齐备份值
              (patch as Record<string, unknown>)[field] = bm[field];
              changed = true;
            } else if (
              !localBlank && !backupBlank &&
              fieldDisplayValue(local, field) !== fieldDisplayValue(bm, field) &&
              resMap.get(`${bm.id}|${field}`) === 'backup'
            ) {
              // 冲突且用户选择采用备份
              (patch as Record<string, unknown>)[field] = bm[field];
              changed = true;
            }
          });
          if (changed) {
            memberUpdates.push({ ...local, ...patch, updatedAt: new Date().toISOString() });
          }
        });
        if (memberUpdates.length > 0) {
          await db.members.bulkPut(memberUpdates);
          updatedMembers = memberUpdates.length;
        }
      },
    );

    return { ...preview, updatedMembers, success: true };
  } catch (err) {
    return {
      ...preview,
      updatedMembers: 0,
      success: false,
      error: err instanceof Error ? err.message : '融合写入失败',
    };
  }
}
