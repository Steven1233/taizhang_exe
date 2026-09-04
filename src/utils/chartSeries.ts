/**
 * 看板图表系列构造（纯函数）
 * V3.5 功能 1：从 Dashboard 提取为可测纯函数——
 * 根因场景"空白年份 → 系列数组"纳入自动化测试（echarts 合并模式下系列从 N 条变少时旧系列残留）
 */
import type { Meeting } from '../types';
import { MEETING_TYPES, typeMeetingUnits } from '../types';

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
