/**
 * 数据融合（组长数据同步）核心策略
 *
 * 场景：党小组组长与管理员使用同一应用。组长导出备份文件（JSON）交给管理员，
 * 管理员执行"融合"将组长数据智能合并进本机数据库（非覆盖恢复）。
 *
 * 合并策略：
 * - 会议记录 / 人员 / 谈心谈话：按 id 去重——本机不存在则并入；id 相同保留本机版本（管理员侧优先）
 * - 人员同名不同 id：不自动合并，结果报告中列出提示手动处理
 * - 操作日志：不并入（融合操作本身记录新日志）
 */

import { db } from '../db';
import type { BackupData } from './backup';

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
}

/** 融合执行结果 */
export interface MergeResult extends MergePreview {
  success: boolean;
  error?: string;
}

/** 统计备份与本机差异（不写入数据库） */
export async function previewMerge(backup: BackupData): Promise<MergePreview> {
  const [localMemberIds, localMeetingIds, localTalkIds, localMembers] = await Promise.all([
    db.members.toCollection().primaryKeys(),
    db.meetings.toCollection().primaryKeys(),
    db.talkRecords.toCollection().primaryKeys(),
    db.members.toArray(),
  ]);

  const memberIdSet = new Set(localMemberIds as string[]);
  const meetingIdSet = new Set(localMeetingIds as string[]);
  const talkIdSet = new Set(localTalkIds as string[]);
  const localNameSet = new Set(localMembers.map((m) => m.name));

  let addMeetings = 0;
  let skipMeetings = 0;
  let addMembers = 0;
  let skipMembers = 0;
  let addTalks = 0;
  let skipTalks = 0;
  const sameNameMembers: string[] = [];

  (backup.tables.meetings?.data || []).forEach((m) => {
    if (meetingIdSet.has(m.id)) skipMeetings++;
    else addMeetings++;
  });

  (backup.tables.members?.data || []).forEach((m) => {
    if (memberIdSet.has(m.id)) {
      skipMembers++;
    } else {
      addMembers++;
      // 同名不同 id：不自动合并，提示手动处理
      if (m.name && localNameSet.has(m.name)) sameNameMembers.push(m.name);
    }
  });

  (backup.tables.talkRecords?.data || []).forEach((t) => {
    if (talkIdSet.has(t.id)) skipTalks++;
    else addTalks++;
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
  };
}

/** 执行融合（事务写入）：按 id 去重合并，已存在保留本机版本 */
export async function executeMerge(backup: BackupData): Promise<MergeResult> {
  const preview = await previewMerge(backup);
  try {
    const newMeetings = (backup.tables.meetings?.data || []).filter((m) => m.id);
    const newMembers = (backup.tables.members?.data || []).filter((m) => m.id);
    const newTalks = (backup.tables.talkRecords?.data || []).filter((t) => t.id);

    await db.transaction(
      'rw',
      db.members, db.meetings, db.talkRecords,
      async () => {
        // bulkPut 语义：不存在则新增，已存在则……为避免覆盖本机，先过滤已存在的 id
        const [localMeetingIds, localMemberIds, localTalkIds] = await Promise.all([
          db.meetings.toCollection().primaryKeys(),
          db.members.toCollection().primaryKeys(),
          db.talkRecords.toCollection().primaryKeys(),
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
      },
    );

    return { ...preview, success: true };
  } catch (err) {
    return {
      ...preview,
      success: false,
      error: err instanceof Error ? err.message : '融合写入失败',
    };
  }
}
