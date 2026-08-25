// 会议类型
export type MeetingType =
  | '支部党员大会'
  | '支部委员会'
  | '党小组会'
  | '党课'
  | '组织生活会'
  | '民主生活会'
  | '主题党日活动'
  | '青年理论学习小组学习会'
  | '其他会议';

// V3.0 默认会议类型（旧类型名映射到新类型名）
export const MEETING_TYPES: MeetingType[] = [
  '支部党员大会',
  '支部委员会',
  '党小组会',
  '党课',
  '组织生活会',
  '民主生活会',
  '主题党日活动',
  '青年理论学习小组学习会',
  '其他会议',
];

/** 旧类型名 → 新类型名映射（V2.0 → V3.0） */
export const MEETING_TYPE_MIGRATION: Record<string, string> = {
  '民主评议党员': '民主生活会',
  '主题党日': '主题党日活动',
  '党日活动': '主题党日活动',
};

/** 旧类型名迁移（兼容 V2.0 数据） */
export function migrateMeetingTypeName(t: string): string {
  return MEETING_TYPE_MIGRATION[t] || t;
}

// 出勤状态
export type AttendanceStatus = 'attended' | 'leave' | 'absent';

// 人员状态
export type MemberStatus = 'active' | 'transferred' | 'seconded' | 'resigned';

export const MEMBER_STATUS_LABEL: Record<MemberStatus, string> = {
  active: '在职',
  transferred: '调离',
  seconded: '借调',
  resigned: '离职',
};

export const MEMBER_STATUS_COLOR: Record<MemberStatus, string> = {
  active: 'green',
  transferred: 'blue',
  seconded: 'orange',
  resigned: 'default',
};

// 支委职务
export const COMMITTEE_ROLES = [
  '支部书记',
  '支部副书记',
  '组织委员',
  '宣传委员',
  '青年委员',
  '纪检委员',
  '保密委员',
  '统战委员',
  '群工委员',
];

// 党小组预设
export const PARTY_GROUPS = [
  '第一党小组',
  '第二党小组',
  '第三党小组',
  '第四党小组',
  '第五党小组',
];

/** 中文数字映射（党小组序号排序用） */
const CN_NUM: Record<string, number> = {
  '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6,
  '七': 7, '八': 8, '九': 9, '十': 10, '十一': 11, '十二': 12,
};

/** 提取党小组序号（如"第三党小组"→3），非该命名格式返回 999 */
export function partyGroupOrder(group: string): number {
  const m = group.match(/^第([一二三四五六七八九十]+)党小组/);
  if (m && CN_NUM[m[1]] !== undefined) return CN_NUM[m[1]];
  return 999;
}

/** 党小组排序：预设序号优先，自定义命名按拼音排后 */
export function sortPartyGroups(groups: string[]): string[] {
  return [...groups].sort((a, b) => {
    const oa = partyGroupOrder(a);
    const ob = partyGroupOrder(b);
    if (oa !== ob) return oa - ob;
    return a.localeCompare(b, 'zh');
  });
}

/**
 * 单条会议在某类型下的计次单位（V3.3 套会拆开计次）
 * 党小组会 = 该记录关联的党小组数（未关联时计 1）；其他类型 = 1
 */
export function typeMeetingUnits(m: Meeting, type: string): number {
  if (type === '党小组会') {
    return m.partyGroups && m.partyGroups.length > 0 ? m.partyGroups.length : 1;
  }
  return 1;
}

/**
 * 单条会议的计次总数（套会拆开：各类型计次单位之和）
 * 例：一条记录类型为 [支部党员大会、党小组会（3 组）、党课、主题党日活动] → 1+3+1+1 = 6 次
 */
export function meetingTotalUnits(m: Meeting): number {
  return m.type.reduce((s, t) => s + typeMeetingUnits(m, t), 0);
}

// 操作类型
export type OperationType =
  | 'CREATE_MEMBER'
  | 'UPDATE_MEMBER'
  | 'DELETE_MEMBER'
  | 'BATCH_DELETE_MEMBER'
  | 'CREATE_MEETING'
  | 'UPDATE_MEETING'
  | 'DELETE_MEETING'
  | 'EXPORT_LEDGER'
  | 'EXPORT_DASHBOARD'
  | 'IMPORT_MEMBERS'
  | 'BACKUP_DATA'
  | 'RESTORE_DATA'
  | 'RESET_DATA'
  | 'CREATE_TALK'
  | 'UPDATE_TALK'
  | 'DELETE_TALK'
  | 'EXPORT_TALK'
  | 'ADD_MEETING_TYPE'
  | 'DELETE_MEETING_TYPE'
  | 'MERGE_DATA'
  | 'AUTO_MERGE_DATA'
  | 'BACKUP_EXCEL'
  | 'RESTORE_EXCEL';

// 人员状态变更记录
export interface MemberStatusChange {
  status: MemberStatus;  // 变更后的状态
  date: string;          // 变更日期 YYYY-MM-DD
}

// 组织人员
export interface Member {
  id: string;
  name: string;
  title: string;           // 部室（UI 标签为"部室"）
  department: string;
  phone: string;
  status: MemberStatus;
  partyGroup: string;
  isGroupLeader: boolean;
  committeeRole: string;
  statusHistory?: MemberStatusChange[];  // 状态变更历史（按时间正序）
  createdAt: string;
  updatedAt: string;
}

// 参会人员
export interface Participant {
  memberId: string;
  name: string;
  status: AttendanceStatus;
  isTemporary: boolean;
  leaveReason?: string;
  isGuest?: boolean;  // 列席人员标记（V3.1：与普通出席区分）
}

// 会议记录
export interface Meeting {
  id: string;
  name?: string;           // 会议名称（非必填）
  type: string[];
  partyGroups?: string[];  // 党小组会所属党小组（可多选）
  date: string;
  time: string;
  location: string;
  host: string;
  recorder: string;
  topic: string;
  summary: string;
  resolution: string;
  participants: Participant[];
  createdAt: string;
  updatedAt: string;
}

// 操作日志
export interface OperationLog {
  id: string;
  timestamp: string;
  type: OperationType;
  description: string;
  detail: string;
  result: 'success' | 'failure';
}

// 会议地点预设
export const PRESET_LOCATIONS = [
  '党员活动室',
  '预警中心3楼5号会议室（党员之家）',
  '第一会议室',
  '第二会议室',
  '第三会议室',
  '报告厅',
];

// 谈话方式（V3.0 新增"组织约谈"）
export type TalkMethod = 'individual' | 'collective' | 'organized';

export const TALK_METHOD_LABEL: Record<TalkMethod, string> = {
  individual: '个别谈话',
  collective: '集体谈话',
  organized: '组织约谈',
};

export const TALK_METHOD_COLOR: Record<TalkMethod, string> = {
  individual: 'blue',
  collective: 'purple',
  organized: 'orange',
};

// 谈话类型
export type TalkType =
  | '领导班子成员之间'
  | '领导班子成员与下一级领导班子成员之间'
  | '党支部委员之间'
  | '党支部委员和党员之间'
  | '党员和党员之间'
  | '党支部委员、党员和群众之间';

export const TALK_TYPES: TalkType[] = [
  '领导班子成员之间',
  '领导班子成员与下一级领导班子成员之间',
  '党支部委员之间',
  '党支部委员和党员之间',
  '党员和党员之间',
  '党支部委员、党员和群众之间',
];

// 谈心谈话记录
export interface TalkRecord {
  id: string;
  method: TalkMethod;
  type: TalkType;
  talkerName: string;
  talkerTitle: string;
  targetName: string;
  targetNames?: string[];      // 集体谈话/组织约谈的多名对象
  targetTitle: string;
  contactPerson: string;
  talkDate: string;
  timePeriod?: 'am' | 'pm';    // 上午/下午
  outline: string;
  location: string;
  content: string;
  isFiveMustTalk?: boolean;    // 是否为"五必谈"
  remark?: string;             // 备注（非必填）
  createdAt: string;
  updatedAt: string;
}
