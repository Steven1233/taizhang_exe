import type { Member, Meeting, MemberStatus, MemberStatusChange } from '../types';

/**
 * 判断人员在指定日期时点是否在职（按状态历史追溯）
 *
 * 规则：
 * - 无历史记录：按当前 status 判断
 * - 有历史：取变更日期 <= 指定日期 的最近一次变更状态
 * - 指定日期早于首次记录：视为在职（入职前默认在职）
 */
export function isActiveAt(member: Member, date: string): boolean {
  const history = member.statusHistory;
  if (!history || history.length === 0) {
    return member.status === 'active';
  }
  const changes = [...history]
    .sort((a, b) => a.date.localeCompare(b.date))
    .filter((c) => c.date <= date);
  if (changes.length === 0) return true;
  return changes[changes.length - 1].status === 'active';
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
  let shouldAttend = 0;
  let attended = 0;
  let leave = 0;
  let absent = 0;
  meeting.participants.forEach((p) => {
    if (p.isTemporary) return;
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
 * 统计期内任一会议日期时点在职的人员集合（V3.3 时间线口径行范围）
 * 含期内已调离、借调中、借调回归者——保证历史台账出勤数据完整
 */
export function membersActiveDuring(members: Member[], meetings: Meeting[]): Member[] {
  return members.filter((m) => meetings.some((mtg) => isActiveAt(m, mtg.date)));
}

/**
 * 追加状态变更记录（若状态未变化则不追加）
 * 返回更新后的 statusHistory 数组
 */
export function appendStatusChange(
  member: Member,
  newStatus: MemberStatus,
  changeDate: string
): MemberStatusChange[] {
  const history = member.statusHistory && member.statusHistory.length > 0
    ? [...member.statusHistory]
    : [{ status: member.status || 'active', date: (member.createdAt || changeDate).substring(0, 10) }];
  const last = history[history.length - 1];
  if (last && last.status === newStatus) {
    return history;  // 状态未变化
  }
  history.push({ status: newStatus, date: changeDate });
  return history;
}
