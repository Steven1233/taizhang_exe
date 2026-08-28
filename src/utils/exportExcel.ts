import * as XLSX from 'xlsx-js-style';
import dayjs from 'dayjs';
import type { Meeting, Member } from '../types';
import { sortPartyGroups, typeMeetingUnits, meetingTotalUnits } from '../types';
import { countActiveAttendance, membersActiveDuring, isActiveAt } from './memberStatus';

// ==================== 样式辅助 ====================

/** 设置列宽（导出供组长模板/备份 Excel 复用） */
export function setColWidths(ws: XLSX.WorkSheet, widths: number[]) {
  ws['!cols'] = widths.map((w) => ({ wch: w }));
}

/** 表头行样式（导出供组长模板/备份 Excel 复用） */
export function applyHeaderStyle(ws: XLSX.WorkSheet, rowIdx: number, colCount: number) {
  for (let c = 0; c < colCount; c++) {
    const addr = XLSX.utils.encode_cell({ r: rowIdx, c });
    if (!ws[addr]) continue;
    ws[addr].s = {
      font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 11, name: '微软雅黑' },
      fill: { fgColor: { rgb: 'C00000' } },
      alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
      border: {
        top: { style: 'thin', color: { rgb: 'D46B6A' } },
        bottom: { style: 'thin', color: { rgb: 'D46B6A' } },
        left: { style: 'thin', color: { rgb: 'D46B6A' } },
        right: { style: 'thin', color: { rgb: 'D46B6A' } },
      },
    };
  }
}

function applyDataStyles(ws: XLSX.WorkSheet, startRow: number, endRow: number, colCount: number) {
  for (let r = startRow; r <= endRow; r++) {
    const isEven = (r - startRow) % 2 === 0;
    for (let c = 0; c < colCount; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      if (!ws[addr]) {
        ws[addr] = { t: 's', v: '' };
      }
      ws[addr].s = {
        font: { sz: 10, name: '微软雅黑' },
        fill: isEven ? { fgColor: { rgb: 'FFFBFA' } } : { fgColor: { rgb: 'FFFFFF' } },
        alignment: { horizontal: c === 0 ? 'center' : 'left', vertical: 'center', wrapText: true },
        border: {
          top: { style: 'thin', color: { rgb: 'E8C8C8' } },
          bottom: { style: 'thin', color: { rgb: 'E8C8C8' } },
          left: { style: 'thin', color: { rgb: 'E8C8C8' } },
          right: { style: 'thin', color: { rgb: 'E8C8C8' } },
        },
      };
    }
  }
}

function setRowHeights(ws: XLSX.WorkSheet, heights: { hpt: number }[]) {
  ws['!rows'] = heights.map(({ hpt }) => ({ hpt }));
}

// 应用大标题行样式（合并单元格）
function applyTitleStyle(ws: XLSX.WorkSheet, rowIdx: number, colCount: number, text: string) {
  ws['!merges'] = ws['!merges'] || [];
  ws['!merges'].push({ s: { r: rowIdx, c: 0 }, e: { r: rowIdx, c: colCount - 1 } });
  const addr = XLSX.utils.encode_cell({ r: rowIdx, c: 0 });
  ws[addr] = { t: 's', v: text };
  ws[addr].s = {
    font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 18, name: '微软雅黑' },
    fill: { fgColor: { rgb: 'C00000' } },
    alignment: { horizontal: 'center', vertical: 'center' },
  };
}

// 应用副标题行样式（合并单元格，含统计时间段）
function applySubtitleStyle(ws: XLSX.WorkSheet, rowIdx: number, colCount: number, text: string) {
  ws['!merges'] = ws['!merges'] || [];
  ws['!merges'].push({ s: { r: rowIdx, c: 0 }, e: { r: rowIdx, c: colCount - 1 } });
  const addr = XLSX.utils.encode_cell({ r: rowIdx, c: 0 });
  ws[addr] = { t: 's', v: text };
  ws[addr].s = {
    font: { bold: false, color: { rgb: '666666' }, sz: 11, name: '微软雅黑' },
    fill: { fgColor: { rgb: 'FFF2F0' } },
    alignment: { horizontal: 'center', vertical: 'center' },
  };
}

// 合计行样式
function applyTotalRowStyle(ws: XLSX.WorkSheet, rowIdx: number, colCount: number) {
  for (let c = 0; c < colCount; c++) {
    const addr = XLSX.utils.encode_cell({ r: rowIdx, c });
    if (ws[addr]) {
      ws[addr].s = {
        font: { bold: true, sz: 11, color: { rgb: 'C00000' }, name: '微软雅黑' },
        fill: { fgColor: { rgb: 'FFF2F0' } },
        alignment: { horizontal: 'center', vertical: 'center' },
        border: {
          top: { style: 'medium', color: { rgb: 'C00000' } },
          bottom: { style: 'medium', color: { rgb: 'C00000' } },
          left: { style: 'thin', color: { rgb: 'D46B6A' } },
          right: { style: 'thin', color: { rgb: 'D46B6A' } },
        },
      };
    }
  }
}

// ==================== 台账文件名 ====================

function buildFileName(start: string, end: string): string {
  const sd = dayjs(start);
  const ed = dayjs(end);
  if (sd.year() === ed.year() && sd.month() === 0 && sd.date() === 1 && ed.month() === 11 && ed.date() === 31) {
    return `党建工作台账_${sd.year()}年.xlsx`;
  }
  return `党建工作台账_${sd.format('YYYY年MM月DD日')}-${ed.format('YYYY年MM月DD日')}.xlsx`;
}

// ==================== 会议明细表（主表/子表通用） ====================

/** 台账 17 列表头（V3.4 导出：组长填报模板 / 备份 Excel / 台账导出共用同字段结构） */
export const DETAIL_HEADERS = [
  '序号', '会议名称', '会议日期', '会议时间', '会议类型', '所属党小组',
  '会议地点', '主持人', '记录人', '会议议题', '会议决议/结论',
  '应到人数', '实到人数', '请假人数', '缺席人数', '出勤率', '参会人员名单',
];
/** 台账明细列宽（导出供组长模板复用） */
export const DETAIL_COL_WIDTHS = [6, 24, 12, 14, 18, 14, 22, 10, 10, 30, 30, 8, 8, 8, 8, 8, 50];

/** 构建一行会议数据（V3.3：出勤统计按时间线在职口径；名单按"参会/请假/缺席"分栏换行） */
function buildMeetingRow(m: Meeting, seq: number, members: Member[]): (string | number)[] {
  // V3.3：按会议日期时点判定在职，离开期间不计入考勤统计；临时人员不计入
  const { shouldAttend, attended, leave, absent } = countActiveAttendance(m, members);
  const rate = shouldAttend > 0 ? ((attended / shouldAttend) * 100).toFixed(1) + '%' : '-';

  // V3.3：参会人员名单按状态分栏换行（参会 = 出席 + 列席）
  const attendedNames: string[] = [];
  const leaveNames: string[] = [];
  const absentNames: string[] = [];
  m.participants.forEach((p) => {
    if (p.status === 'leave') {
      leaveNames.push(p.leaveReason ? `${p.name}(${p.leaveReason})` : p.name);
    } else if (p.status === 'absent') {
      absentNames.push(p.name);
    } else {
      attendedNames.push(p.isGuest ? `${p.name}(列席)` : p.name);
    }
  });
  const listParts: string[] = [];
  if (attendedNames.length > 0) listParts.push(`参会：${attendedNames.join('、')}`);
  if (leaveNames.length > 0) listParts.push(`请假：${leaveNames.join('、')}`);
  if (absentNames.length > 0) listParts.push(`缺席：${absentNames.join('、')}`);
  const attendeeList = listParts.join('\n');

  const partyGroups = m.partyGroups && m.partyGroups.length > 0 ? m.partyGroups.join('、') : '';

  return [
    seq,
    m.name || '-',
    m.date,
    m.time || '-',
    Array.isArray(m.type) ? m.type.join('、') : String(m.type),
    partyGroups,
    m.location,
    m.host,
    m.recorder || '-',
    m.topic,
    m.resolution || '',
    shouldAttend,
    attended,
    leave,
    absent,
    rate,
    attendeeList,
  ];
}

/** 生成会议明细 Sheet（主表与子表结构一致；V3.4 导出供自动备份 Excel 复用） */
export function buildDetailSheet(
  meetings: Meeting[],
  subtitlePrefix: string,
  subtitlePeriod: string,
  members: Member[],
  headerOverrides?: Record<string, string>
): XLSX.WorkSheet | null {
  if (meetings.length === 0) return null;

  const headers = headerOverrides
    ? DETAIL_HEADERS.map((h) => headerOverrides[h] || h)
    : DETAIL_HEADERS;

  const sheetData: (string | number)[][] = [
    [''],  // 大标题
    [''],  // 副标题
    headers,
  ];

  meetings.forEach((m, i) => {
    sheetData.push(buildMeetingRow(m, i + 1, members));
  });

  // 合计行（V3.3：时间线在职口径）
  let totalAll = 0;
  let totalAttended = 0;
  let totalLeave = 0;
  let totalAbsent = 0;
  meetings.forEach((m) => {
    const { shouldAttend, attended, leave, absent } = countActiveAttendance(m, members);
    totalAll += shouldAttend;
    totalAttended += attended;
    totalLeave += leave;
    totalAbsent += absent;
  });
  const avgRate = totalAll > 0 ? ((totalAttended / totalAll) * 100).toFixed(1) + '%' : '-';
  sheetData.push([
    '合计', '', '', '', '', '', '', '', '', '', '',
    totalAll, totalAttended, totalLeave, totalAbsent, avgRate, '',
  ]);

  const ws = XLSX.utils.aoa_to_sheet(sheetData);
  setColWidths(ws, DETAIL_COL_WIDTHS);
  applyTitleStyle(ws, 0, headers.length, '党建工作台账');
  applySubtitleStyle(ws, 1, headers.length, `（${subtitlePrefix} — ${subtitlePeriod}）`);
  applyHeaderStyle(ws, 2, headers.length);
  applyDataStyles(ws, 3, sheetData.length - 2, headers.length);
  applyTotalRowStyle(ws, sheetData.length - 1, headers.length);
  setRowHeights(ws, [
    { hpt: 40 },
    { hpt: 24 },
    { hpt: 30 },
    ...Array.from({ length: sheetData.length - 3 }, () => ({ hpt: 45 })),
  ]);
  return ws;
}

// ==================== 分类子表（V3.4 提取：台账导出与自动备份 Excel 共用） ====================

/** 按会议类型追加分类子表（支委会/党员大会/各党小组会/党课/组织生活会/民主生活会/主题党日活动） */
export function appendCategorySheets(
  wb: XLSX.WorkBook,
  meetings: Meeting[],
  subtitlePeriod: string,
  members: Member[]
): void {
  // 支委会
  const committeeMeetings = meetings.filter((m) => m.type.includes('支部委员会'));
  const wsCommittee = buildDetailSheet(committeeMeetings, '支委会', subtitlePeriod, members);
  if (wsCommittee) XLSX.utils.book_append_sheet(wb, wsCommittee, '支委会');

  // 党员大会
  const memberMeetingMeetings = meetings.filter((m) => m.type.includes('支部党员大会'));
  const wsMemberMeeting = buildDetailSheet(memberMeetingMeetings, '党员大会', subtitlePeriod, members);
  if (wsMemberMeeting) XLSX.utils.book_append_sheet(wb, wsMemberMeeting, '党员大会');

  // 各党小组会（动态生成所有有数据的党小组子表）
  const groupMeetingMeetings = meetings.filter((m) => m.type.includes('党小组会'));
  const allGroups = new Set<string>();
  groupMeetingMeetings.forEach((m) => {
    (m.partyGroups || []).forEach((g) => {
      if (g) allGroups.add(g);
    });
  });
  sortPartyGroups([...allGroups]).forEach((group) => {
    const groupMeetings = groupMeetingMeetings.filter(
      (m) => (m.partyGroups || []).includes(group)
    );
    const wsGroup = buildDetailSheet(groupMeetings, `${group}会`, subtitlePeriod, members);
    if (wsGroup) XLSX.utils.book_append_sheet(wb, wsGroup, `${group}会`);
  });

  // 党课（V3.3 新增子表）
  const partyLectureMeetings = meetings.filter((m) => m.type.includes('党课'));
  const wsPartyLecture = buildDetailSheet(partyLectureMeetings, '党课', subtitlePeriod, members);
  if (wsPartyLecture) XLSX.utils.book_append_sheet(wb, wsPartyLecture, '党课');

  // 组织生活会
  const organizationalMeetings = meetings.filter((m) => m.type.includes('组织生活会'));
  const wsOrganizational = buildDetailSheet(organizationalMeetings, '组织生活会', subtitlePeriod, members);
  if (wsOrganizational) XLSX.utils.book_append_sheet(wb, wsOrganizational, '组织生活会');

  // 民主生活会
  const democraticMeetings = meetings.filter((m) => m.type.includes('民主生活会'));
  const wsDemocratic = buildDetailSheet(democraticMeetings, '民主生活会', subtitlePeriod, members);
  if (wsDemocratic) XLSX.utils.book_append_sheet(wb, wsDemocratic, '民主生活会');

  // 主题党日活动（V3.3 新增子表："会议议题"列改为"活动内容"）
  const partyDayMeetings = meetings.filter((m) => m.type.includes('主题党日活动'));
  const wsPartyDay = buildDetailSheet(partyDayMeetings, '主题党日活动', subtitlePeriod, members, {
    '会议议题': '活动内容',
  });
  if (wsPartyDay) XLSX.utils.book_append_sheet(wb, wsPartyDay, '主题党日活动');
}

// ==================== 主导出函数 ====================

/**
 * 导出年度党建工作台账（按时间段，含分类子表）
 * @param start 开始日期 YYYY-MM-DD
 * @param end 结束日期 YYYY-MM-DD
 */
export async function exportAnnualLedger(
  start: string,
  end: string,
  meetings: Meeting[],
  members: Member[]
): Promise<void> {
  const wb = XLSX.utils.book_new();
  const subtitlePeriod = `统计时间段：${dayjs(start).format('YYYY年MM月DD日')} - ${dayjs(end).format('YYYY年MM月DD日')}`;

  const yearMeetings = meetings
    .filter((m) => m.date >= start && m.date <= end)
    .sort((a, b) => a.date.localeCompare(b.date));

  // ============ Sheet 1: 会议记录明细 ============
  const wsMain = buildDetailSheet(yearMeetings, '会议记录明细', subtitlePeriod, members);
  if (wsMain) {
    XLSX.utils.book_append_sheet(wb, wsMain, '会议记录明细');
  }

  // ============ 分类子表（字段与会议记录明细一致） ============
  appendCategorySheets(wb, yearMeetings, subtitlePeriod, members);

  // ============ 参会考勤统计 ============
  const headers2 = ['序号', '姓名', '部室', '部门/支部', '应参加次数', '实际出席次数', '请假次数', '缺席次数', '出勤率'];
  const sheet2Data: (string | number)[][] = [
    [''],
    [''],
    headers2,
  ];

  // V3.3：时间线在职口径——行范围为"统计期内任一会议日期时点在职"的人员
  // （含期内已调离、借调中、借调回归者，保证历史台账出勤数据完整）
  const scopedMembers = membersActiveDuring(members, yearMeetings);
  const memberStats = scopedMembers.map((member) => {
    let shouldAttend = 0;
    let attended = 0;
    let leave = 0;
    let absent = 0;
    // V3.4 功能6：记录统计期内最新一次带快照的参会记录（部门/部室优先读快照，人员换部门不改写历史）
    let snapDept: string | undefined;
    let snapTitle: string | undefined;
    yearMeetings.forEach((meeting) => {
      if (!isActiveAt(member, meeting.date)) return; // 离开期间不计入，离开前/回归后照常计入
      const p = meeting.participants.find((pp) => pp.memberId === member.id);
      if (p) {
        shouldAttend++;
        if (p.status === 'attended') attended++;
        else if (p.status === 'leave') leave++;
        else if (p.status === 'absent') absent++;
        if (p.departmentSnapshot !== undefined || p.titleSnapshot !== undefined) {
          snapDept = p.departmentSnapshot;
          snapTitle = p.titleSnapshot;
        }
      }
    });
    const rate = shouldAttend > 0 ? ((attended / shouldAttend) * 100).toFixed(1) + '%' : '-';
    return { member, shouldAttend, attended, leave, absent, rate: shouldAttend > 0 ? (attended / shouldAttend) * 100 : -1, rateStr: rate, snapDept, snapTitle };
  }).sort((a, b) => b.rate - a.rate);

  memberStats.forEach((s, i) => {
    // V3.4 功能6：部门/部室优先读快照，旧数据无快照回退当前值
    const dept = s.snapDept !== undefined
      ? s.snapDept
      : Array.isArray(s.member.department)
        ? s.member.department.filter(Boolean).join('、')
        : (s.member.department || '');
    const title = s.snapTitle !== undefined ? s.snapTitle : (s.member.title || '');
    sheet2Data.push([
      i + 1, s.member.name, title || '-', dept || '-',
      s.shouldAttend, s.attended, s.leave, s.absent, s.rateStr,
    ]);
  });

  const ws2 = XLSX.utils.aoa_to_sheet(sheet2Data);
  setColWidths(ws2, [6, 10, 14, 14, 12, 12, 10, 10, 10]);
  applyTitleStyle(ws2, 0, headers2.length, '党建工作台账');
  applySubtitleStyle(ws2, 1, headers2.length, `（参会考勤统计 — ${subtitlePeriod}）`);
  applyHeaderStyle(ws2, 2, headers2.length);
  applyDataStyles(ws2, 3, sheet2Data.length - 1, headers2.length);
  setRowHeights(ws2, [
    { hpt: 40 },
    { hpt: 24 },
    { hpt: 28 },
    ...Array.from({ length: sheet2Data.length - 3 }, () => ({ hpt: 22 })),
  ]);
  XLSX.utils.book_append_sheet(wb, ws2, '参会考勤统计');

  // ============ 月度汇总（跨年区间按"年-月"逐月归组，合计=各月行之和） ============
  const headers3 = ['月份', '会议次数', '累计应到', '累计实到', '平均出勤率'];
  const sheet3Data: (string | number)[][] = [
    [''],
    [''],
    headers3,
  ];
  const isCrossYear = dayjs(start).year() !== dayjs(end).year();
  // 从 start 月迭代到 end 月（跨年时生成多行，标注年月）
  let cursor = dayjs(start).startOf('month');
  const endMonth = dayjs(end).endOf('month');
  let sumMeetings = 0;
  let sumShould = 0;
  let sumAttended = 0;
  while (cursor.isBefore(endMonth) || cursor.isSame(endMonth, 'month')) {
    const monthKey = cursor.format('YYYY-MM');
    const monthMeetings = yearMeetings.filter((mm) => mm.date.startsWith(monthKey));
    // V3.3：会议次数按套会拆开计次（= 各类型计次单位之和）；出勤按时间线在职口径
    const mCount = monthMeetings.reduce((s, mm) => s + meetingTotalUnits(mm), 0);
    let mAttended = 0;
    let mTotal = 0;
    monthMeetings.forEach((mm) => {
      const { shouldAttend, attended } = countActiveAttendance(mm, members);
      mTotal += shouldAttend;
      mAttended += attended;
    });
    const mRate = mTotal > 0 ? ((mAttended / mTotal) * 100).toFixed(1) + '%' : '-';
    const rowLabel = isCrossYear ? cursor.format('YYYY年M月') : `${cursor.month() + 1}月`;
    sheet3Data.push([rowLabel, mCount, mTotal, mAttended, mRate]);
    sumMeetings += mCount;
    sumShould += mTotal;
    sumAttended += mAttended;
    cursor = cursor.add(1, 'month');
  }
  // 合计行 = 各月行之和（与月度行数据自洽）
  const sumRate = sumShould > 0 ? ((sumAttended / sumShould) * 100).toFixed(1) + '%' : '-';
  sheet3Data.push(['合计', sumMeetings, sumShould, sumAttended, sumRate]);

  const ws3 = XLSX.utils.aoa_to_sheet(sheet3Data);
  setColWidths(ws3, [10, 12, 12, 12, 12]);
  applyTitleStyle(ws3, 0, headers3.length, '党建工作台账');
  applySubtitleStyle(ws3, 1, headers3.length, `（月度汇总 — ${subtitlePeriod}）`);
  applyHeaderStyle(ws3, 2, headers3.length);
  applyDataStyles(ws3, 3, sheet3Data.length - 2, headers3.length);
  applyTotalRowStyle(ws3, sheet3Data.length - 1, headers3.length);
  setRowHeights(ws3, [
    { hpt: 40 },
    { hpt: 24 },
    { hpt: 28 },
    ...Array.from({ length: sheet3Data.length - 3 }, () => ({ hpt: 22 })),
  ]);
  XLSX.utils.book_append_sheet(wb, ws3, '月度汇总');

  // ============ 会议类型统计 ============
  const headers4 = ['会议类型', '会议次数', '占比'];
  const sheet4Data: (string | number)[][] = [
    [''],
    [''],
    headers4,
  ];
  const typeCount: Record<string, number> = {};
  // V3.3：按套会拆开计次（党小组会按关联党小组数展开），合计 = 看板会议总数
  yearMeetings.forEach((m) => {
    const types = Array.isArray(m.type) ? m.type : [String(m.type)];
    types.forEach((t) => { typeCount[t] = (typeCount[t] || 0) + typeMeetingUnits(m, t); });
  });
  const typeTotal = Object.values(typeCount).reduce((s, v) => s + v, 0);
  Object.entries(typeCount)
    .sort((a, b) => b[1] - a[1])
    .forEach(([type, count]) => {
      sheet4Data.push([type, count, typeTotal > 0 ? ((count / typeTotal) * 100).toFixed(1) + '%' : '-']);
    });
  sheet4Data.push(['合计', typeTotal, typeTotal > 0 ? '100%' : '-']);

  const ws4 = XLSX.utils.aoa_to_sheet(sheet4Data);
  setColWidths(ws4, [24, 12, 12]);
  applyTitleStyle(ws4, 0, headers4.length, '党建工作台账');
  applySubtitleStyle(ws4, 1, headers4.length, `（会议类型统计 — ${subtitlePeriod}）`);
  applyHeaderStyle(ws4, 2, headers4.length);
  applyDataStyles(ws4, 3, sheet4Data.length - 2, headers4.length);
  applyTotalRowStyle(ws4, sheet4Data.length - 1, headers4.length);
  setRowHeights(ws4, [
    { hpt: 40 },
    { hpt: 24 },
    { hpt: 28 },
    ...Array.from({ length: sheet4Data.length - 3 }, () => ({ hpt: 22 })),
  ]);
  XLSX.utils.book_append_sheet(wb, ws4, '会议类型统计');

  // 使用 write + Blob 方式下载，确保浏览器和Electron环境兼容
  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([wbout], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = buildFileName(start, end);
  a.click();
  URL.revokeObjectURL(url);
}
