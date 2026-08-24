import Dexie from 'dexie';
import type { Member, Meeting, OperationLog, TalkRecord } from '../types';
import { migrateMeetingTypeName } from '../types';

class PartyBuildingDB extends Dexie {
  members!: Dexie.Table<Member, string>;
  meetings!: Dexie.Table<Meeting, string>;
  operationLogs!: Dexie.Table<OperationLog, string>;
  talkRecords!: Dexie.Table<TalkRecord, string>;

  constructor() {
    super('PartyBuildingLedger');

    this.version(1).stores({
      members: 'id, name, department, status',
      meetings: 'id, type, date, host',
      operationLogs: 'id, timestamp, type',
    });

    this.version(2).stores({
      members: 'id, name, department, status, partyGroup, committeeRole',
      meetings: 'id, *type, date, host',
      operationLogs: 'id, timestamp, type',
      talkRecords: 'id, talkDate, type, talkerName, targetName',
    }).upgrade(async (tx) => {
      await tx.table('members').toCollection().modify((member: any) => {
        if (member.partyGroup === undefined) member.partyGroup = '';
        if (member.isGroupLeader === undefined) member.isGroupLeader = false;
        if (member.committeeRole === undefined) member.committeeRole = '';
        if (member.status === 'inactive') member.status = 'resigned';
        // 兼容 V1.0：department 从数组转为字符串
        if (Array.isArray(member.department)) {
          member.department = member.department.filter(Boolean).join('、');
        } else if (member.department === undefined || member.department === null) {
          member.department = '';
        }
      });
      // 迁移 meetings: type 从 string 转为 string[]
      await tx.table('meetings').toCollection().modify((meeting: any) => {
        if (typeof meeting.type === 'string') {
          meeting.type = [meeting.type];
        }
      });
    });

    // V3.0：会议名称、党小组会党小组关联、类型更名、人员状态历史、谈心谈话新字段
    this.version(3).stores({
      members: 'id, name, department, status, partyGroup, committeeRole',
      meetings: 'id, *type, date, host',
      operationLogs: 'id, timestamp, type',
      talkRecords: 'id, talkDate, type, talkerName, targetName',
    }).upgrade(async (tx) => {
      // meetings：类型更名 + 新增字段
      await tx.table('meetings').toCollection().modify((meeting: any) => {
        if (meeting.name === undefined) meeting.name = '';
        // partyGroups：党小组会所属党小组（数组）
        if (meeting.partyGroups === undefined) {
          meeting.partyGroups = Array.isArray(meeting.partyGroup) ? meeting.partyGroup : [];
        }
        if (meeting.partyGroup !== undefined) delete meeting.partyGroup;
        if (Array.isArray(meeting.type)) {
          meeting.type = meeting.type.map((t: string) => migrateMeetingTypeName(t));
        } else if (typeof meeting.type === 'string') {
          meeting.type = [migrateMeetingTypeName(meeting.type)];
        }
      });
      // members：状态历史初始化
      await tx.table('members').toCollection().modify((member: any) => {
        if (member.statusHistory === undefined || !Array.isArray(member.statusHistory) || member.statusHistory.length === 0) {
          // 无历史记录的人员：以当前状态 + 记录创建时间为初始记录
          const initialDate = (member.createdAt || new Date().toISOString()).substring(0, 10);
          member.statusHistory = [
            { status: member.status || 'active', date: initialDate },
          ];
        }
      });
      // talkRecords：新增字段默认值
      await tx.table('talkRecords').toCollection().modify((talk: any) => {
        if (talk.timePeriod === undefined) talk.timePeriod = 'am';
        if (talk.isFiveMustTalk === undefined) talk.isFiveMustTalk = false;
        if (talk.remark === undefined) talk.remark = '';
        if (talk.targetNames === undefined) {
          talk.targetNames = talk.targetName ? [talk.targetName] : [];
        }
      });
    });
  }
}

export const db = new PartyBuildingDB();

/** 确保 meeting.type 总是数组且类型名已迁移（兼容旧数据） */
export function normalizeMeetingTypes(meeting: Meeting): Meeting {
  let type = meeting.type as unknown;
  if (!Array.isArray(type)) {
    type = typeof type === 'string' ? [type] : [];
  }
  const migrated = (type as string[]).map((t) => migrateMeetingTypeName(t));
  return { ...meeting, type: migrated };
}

/** 确保 meeting.partyGroups 总是数组（兼容旧数据） */
export function normalizeMeetingPartyGroups(meeting: Meeting): Meeting {
  const partyGroups = Array.isArray(meeting.partyGroups)
    ? meeting.partyGroups
    : ((meeting as unknown as { partyGroup?: string }).partyGroup
        ? [(meeting as unknown as { partyGroup: string }).partyGroup]
        : []);
  return { ...meeting, partyGroups };
}

/** 确保 member.department 总是字符串（兼容旧版数组格式） */
export function normalizeMember(member: Member): Member {
  let department = member.department as unknown;
  if (Array.isArray(department)) {
    department = (department as unknown[]).filter(Boolean).join('、');
  } else if (department === undefined || department === null) {
    department = '';
  }
  return { ...member, department: department as string };
}
