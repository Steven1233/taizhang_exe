import type { Member, Meeting, MemberStatus, MemberStatusChange } from '../types';

/**
 * 判断人员在指定日期时点是否在职（按状态历史追溯）
 *
 * 规则：
 * - 无历史记录：按当前 status 判断
 * - 有历史：取变更日期 <= 指定日期 的最近一次变更状态
 * - 指定日期早于首条记录：沿用首条记录状态（V3.4 规则修正：
 *   原默认视为在职，首条即调离/借调者调离前的会议不再误计在职）
 */
export function isActiveAt(member: Member, date: string): boolean {
  const history = member.statusHistory;
  if (!history || history.length === 0) {
    return member.status === 'active';
  }
  const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
  const changes = sorted.filter((c) => c.date <= date);
  if (changes.length === 0) return sorted[0].status === 'active'; // 早于首条：沿用首条状态
  return changes[changes.length - 1].status === 'active';
}

/**
 * 返回人员在指定日期时点的具体状态（V3.5.3：组织架构时间线判定）
 *
 * 规则与 isActiveAt 同源，仅返回值不同（active/seconded/transferred/resigned）：
 * - 无历史记录：返回当前 status
 * - 有历史：取变更日期 <= 指定日期 的最近一次变更状态
 * - 指定日期早于首条记录：沿用首条记录状态
 */
export function statusAt(member: Member, date: string): MemberStatus {
  const history = member.statusHistory;
  if (!history || history.length === 0) {
    return member.status || 'active';
  }
  const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
  const changes = sorted.filter((c) => c.date <= date);
  if (changes.length === 0) return sorted[0].status; // 早于首条：沿用首条状态
  return changes[changes.length - 1].status;
}

/**
 * 人员指定日期时点所属党小组（V3.5.4：党小组会子表套会按小组过滤）
 *
 * 口径（严谨性）：
 * - 快照优先由调用方处理（participant.partyGroupSnapshot）
 * - 无快照时按「信息变更留痕」中党小组变更日期回溯，
 *   避免人员后续调组后旧会议记录被整组误归属
 * - 无变更留痕：沿用当前党小组
 */
export function partyGroupAt(member: Member, date: string): string {
  const logs = (member.changeHistory || [])
    .filter((h) => h.field === '党小组')
    .sort((a, b) => a.date.localeCompare(b.date));
  if (logs.length === 0) return (member.partyGroup || '').trim();
  const effective = logs.filter((h) => h.date <= date);
  if (effective.length > 0) return (effective[effective.length - 1].newValue || '').trim();
  // 早于首条变更：沿用首条变更前的值
  return (logs[0].oldValue || '').trim();
}

/**
 * 按指定参会者子集统计出勤（V3.5.4：党小组会子表套会按小组过滤）
 *
 * 口径同 countActiveAttendance：
 * - 临时人员不计入
 * - 按会议日期时点判定在职（调离/借调/离职期间不计入，回归后恢复）
 */
export function countAttendanceOf(
  meeting: Meeting,
  members: Member[],
  include: (p: Meeting['participants'][number]) => boolean = (p) => !p.isTemporary
): { shouldAttend: number; attended: number; leave: number; absent: number } {
  let shouldAttend = 0;
  let attended = 0;
  let leave = 0;
  let absent = 0;
  meeting.participants.forEach((p) => {
    if (!include(p)) return;
    const m = members.find((mm) => mm.id === p.memberId);
    if (!m || !isActiveAt(m, meeting.date)) return;
    shouldAttend++;
    if (p.status === 'attended') attended++;
    else if (p.status === 'leave') leave++;
    else absent++;
  });
  return { shouldAttend, attended, leave, absent };
}

/**
 * 统计一场会议的出勤（V3.3 时间线在职口径）
 *
 * 仅统计按会议日期时点判定为在职的正式成员：
 * - 调离/借调/离职期间的人员不计入（离开期间不考勤）
 * - 离开前及回归后的人员照常计入
 * - 临时人员（未匹配人员库）不计入
 */
export function countActiveAttendance(
  meeting: Meeting,
  members: Member[]
): { shouldAttend: number; attended: number; leave: number; absent: number } {
  return countAttendanceOf(meeting, members);
}

/**
 * 统计期内任一会议日期时点在职的人员集合（V3.3 时间线口径行范围）
 * 含期内已调离、借调中、借调回归者——保证历史台账出勤数据完整
 */
export function membersActiveDuring(members: Member[], meetings: Meeting[]): Member[] {
  return members.filter((m) => meetings.some((mtg) => isActiveAt(m, mtg.date)));
}

/** 人员入职/入库日期（首条状态记录日期，无状态历史时取创建日期） */
function entryDateOf(member: Member): string {
  const history = member.statusHistory && member.statusHistory.length > 0
    ? [...member.statusHistory].sort((a, b) => a.date.localeCompare(b.date))
    : null;
  return history ? history[0].date : (member.createdAt || '').substring(0, 10);
}

/** 人员在参考时点是否已入职（V3.5.5：统计时段行范围与看板排行共用） */
export function hasEnteredBy(member: Member, refDate: string): boolean {
  const entryDate = entryDateOf(member);
  return !entryDate || entryDate <= refDate;
}

/**
 * 判断人员在参考时点是否在职且已入职（V3.5.5：数据看板出勤率排行年度口径）
 *
 * 口径：
 * - 未入职：首条状态记录日期（无状态历史时取创建日期）晚于参考时点 → 不计入
 * - 状态追溯：isActiveAt 时间线判定（借调/调离/离职期间不计入，回归后恢复）
 * - 无状态历史的旧数据按当前状态兜底（与 isActiveAt 一致）
 */
export function isActiveMemberAt(member: Member, refDate: string): boolean {
  if (!hasEnteredBy(member, refDate)) return false; // 参考时点尚未入职
  return isActiveAt(member, refDate);
}

/**
 * 人员是否在统计时段内任一时点在职（V3.5.5：参会考勤统计行范围）
 *
 * 口径：
 * - 时段末尚未入职 → 不在统计时段内，排除
 * - 时段内任一时点状态为在职 → 列入；借调/调离/离职期间不计为在职，
 *   但期内恢复在职仍列入（保留历史台账出勤数据完整性）
 * - 判定点：入职日或时段起点、时段终点、时段内每次状态变更日期
 */
export function isActiveDuring(member: Member, start: string, end: string): boolean {
  if (!hasEnteredBy(member, end)) return false;
  const entryDate = entryDateOf(member);
  const from = entryDate && entryDate > start ? entryDate : start;
  if (from > end) return false;
  const dates = new Set<string>([from, end]);
  (member.statusHistory || []).forEach((c) => {
    if (c.date >= from && c.date <= end) dates.add(c.date);
  });
  return [...dates].some((d) => isActiveAt(member, d));
}

/** 参会考勤统计行范围（V3.5.5：仅列入统计时段内曾在职的人员） */
export function attendanceStatsMembers(members: Member[], start: string, end: string): Member[] {
  return members.filter((m) => isActiveDuring(m, start, end));
}

/**
 * 统计参考时点在职的党员数（V3.5.2：数据看板「在职党员总数」年度口径）
 *
 * 口径（年报口径）：
 * - 入库时点：首条状态记录日期（无状态历史时取创建日期）不晚于参考时点，
 *   该时点尚未入职/组织关系未转入的人员不计入
 * - 状态追溯：isActiveAt 时间线判定（借调期间不计入，回归后恢复，调离/离职后不计入）
 * - 无状态历史的旧数据按当前状态兜底（与 isActiveAt 一致）
 */
export function countActiveMembersAt(members: Member[], refDate: string): number {
  return members.filter((m) => isActiveMemberAt(m, refDate)).length;
}

/**
 * 追加状态变更记录（若状态未变化则不追加）
 *
 * V3.4 修复：去重基准由"数组末位"改为"变更日期时点的既有状态"——
 * 回溯补录早于末位的变更时不再判断失真；返回数组恒按日期正序。
 * - 变更日期与既有记录同日：覆盖该条状态（避免同日两条）
 * - 变更日期早于首条记录：以首条状态为基准（与 isActiveAt 口径一致）
 */
export function appendStatusChange(
  member: Member,
  newStatus: MemberStatus,
  changeDate: string
): MemberStatusChange[] {
  const base = member.statusHistory && member.statusHistory.length > 0
    ? [...member.statusHistory]
    : [{ status: member.status || 'active', date: (member.createdAt || changeDate).substring(0, 10) }];
  const history = base.sort((a, b) => a.date.localeCompare(b.date));
  // 同日已有记录：直接覆盖状态
  const existingIdx = history.findIndex((c) => c.date === changeDate);
  if (existingIdx >= 0) {
    const updated = [...history];
    updated[existingIdx] = { status: newStatus, date: changeDate };
    return updated;
  }
  // 去重基准：变更日期时点的既有状态（早于首条时沿用首条状态）
  const changes = history.filter((c) => c.date <= changeDate);
  const baseline = changes.length > 0 ? changes[changes.length - 1].status : history[0].status;
  if (baseline === newStatus) {
    return history; // 该时点已是目标状态，无需追加
  }
  history.push({ status: newStatus, date: changeDate });
  // 追加后重排，保证返回数组恒按日期正序（回溯补录早于末位的变更时插入正确位置）
  return history.sort((a, b) => a.date.localeCompare(b.date));
}
