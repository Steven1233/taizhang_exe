import type { Member, MemberStatus, MemberStatusChange } from '../types';

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
