/**
 * 看板图表系列构造（纯函数）
 * V3.5 功能 1：从 Dashboard 提取为可测纯函数——
 * 根因场景"空白年份 → 系列数组"纳入自动化测试（echarts 合并模式下系列从 N 条变少时旧系列残留）
 * V3.5.2：新增「出勤对比」三维度统计（党小组/部室/部门支部）
 */
import type { Meeting, Member, Participant } from '../types';
import { MEETING_TYPES, typeMeetingUnits } from '../types';
import { isActiveAt, membersActiveDuring } from './memberStatus';

/** 出勤对比统计维度 */
export type AttendanceDimension = 'partyGroup' | 'title' | 'department';

/** 单个维度的出勤统计结果 */
export interface DimensionAttendanceRate {
  name: string;
  attended: number;  // 出席人次
  total: number;     // 应到人次
  rate: number;      // 出勤率（百分比）
}

/** 取参会记录在指定维度上的归属值（快照优先，旧数据回退人员当前值） */
function dimensionValueOf(p: Participant, member: Member, dimension: AttendanceDimension): string {
  if (dimension === 'partyGroup') {
    return (p.partyGroupSnapshot !== undefined ? p.partyGroupSnapshot : (member.partyGroup || '')).trim();
  }
  if (dimension === 'title') {
    return (p.titleSnapshot !== undefined ? p.titleSnapshot : (member.title || '')).trim();
  }
  // department：兼容旧版数组格式（与 Dashboard 原处理一致）
  const current = member.department as unknown;
  const currentDept = Array.isArray(current)
    ? (current as unknown[]).filter(Boolean).join('、')
    : String(current || '');
  return (p.departmentSnapshot !== undefined ? p.departmentSnapshot : currentDept).trim();
}

/**
 * 构建「出勤对比」维度统计数据（V3.5.2：Dashboard 部门出勤逻辑泛化为三维度）
 *
 * 口径（与 V3.3/V3.4 既有规则一致）：
 * - 时间线在职：每场会议按该场日期 isActiveAt 判定，离开期间不计入，回归后恢复
 * - 行范围：期内任一会议日期时点在职的人员
 * - 支委会排除：类型含「支部委员会」的会议（含套会）不纳入
 * - 列席计入出席；临时人员不计入；维度值为空（未编组/空部室/空部门）不计入
 * - 结果按出勤率降序
 *
 * @param meetings 统计期内的会议（调用方按年份过滤）
 */
export function buildDimensionAttendanceRates(
  meetings: Meeting[],
  members: Member[],
  dimension: AttendanceDimension
): DimensionAttendanceRate[] {
  const rates: Record<string, { total: number; attended: number }> = {};
  membersActiveDuring(members, meetings).forEach((member) => {
    meetings.forEach((m) => {
      if (m.type.includes('支部委员会')) return; // 支委会不纳入维度出勤
      if (!isActiveAt(member, m.date)) return;    // 离开期间不计入
      const p = m.participants.find((pt) => pt.memberId === member.id);
      if (!p) return; // 未参会（含临时人员，memberId 不匹配人员库）
      const name = dimensionValueOf(p, member, dimension);
      if (!name) return; // 空值不计入该维度
      if (!rates[name]) rates[name] = { total: 0, attended: 0 };
      rates[name].total++;
      if (p.status === 'attended') rates[name].attended++;
    });
  });
  return Object.entries(rates)
    .map(([name, data]) => ({
      name,
      attended: data.attended,
      total: data.total,
      rate: data.total > 0 ? (data.attended / data.total) * 100 : 0,
    }))
    .sort((a, b) => b.rate - a.rate || a.name.localeCompare(b.name, 'zh'));
}

/** 月度会议趋势堆叠系列（结构与 ECharts bar series 对应） */
export interface MonthStackSeries {
  name: string;
  type: 'bar';
  stack: string;
  emphasis: { focus: 'series' };
  data: number[];
}

/**
 * 构建某年度"月度会议趋势"堆叠系列（V3.2 口径：党小组会按关联党小组数展开计次）
 * - 按年份过滤会议（date 以年份开头）
 * - 全年无数据的类型剔除（空白年份 → 空数组）
 * @param meetings 全量会议记录
 * @param year 统计年度
 * @returns 每个类型一条 12 个月计次数组
 */
export function buildMonthStackSeries(meetings: Meeting[], year: number): MonthStackSeries[] {
  const yearMeetings = meetings.filter((m) => m.date.startsWith(String(year)));
  const monthTypeCount = (monthKey: string, type: string) =>
    yearMeetings
      .filter((m) => m.date.substring(5, 7) === monthKey && m.type.includes(type))
      .reduce((s, m) => s + typeMeetingUnits(m, type), 0);
  return MEETING_TYPES.filter((type) =>
    Array.from({ length: 12 }, (_, i) =>
      monthTypeCount(String(i + 1).padStart(2, '0'), type)
    ).some((v) => v > 0)
  ).map((type) => ({
    name: type,
    type: 'bar' as const,
    stack: 'total',
    emphasis: { focus: 'series' as const },
    data: Array.from({ length: 12 }, (_, i) =>
      monthTypeCount(String(i + 1).padStart(2, '0'), type)
    ),
  }));
}
