import * as XLSX from 'xlsx-js-style';
import dayjs from 'dayjs';
import type { Meeting, Member } from '../types';
import { sortPartyGroups } from '../types';

// ==================== 样式辅助 ====================

function setColWidths(ws: XLSX.WorkSheet, widths: number[]) {
  ws['!cols'] = widths.map((w) => ({ wch: w }));
}

function applyHeaderStyle(ws: XLSX.WorkSheet, rowIdx: number, colCount: number) {
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

const DETAIL_HEADERS = [
  '序号', '会议名称', '会议日期', '会议时间', '会议类型', '所属党小组',
  '会议地点', '主持人', '记录人', '会议议题', '会议决议/结论',
  '应到人数', '实到人数', '请假人数', '缺席人数', '出勤率', '参会人员名单',
];
const DETAIL_COL_WIDTHS = [6, 24, 12, 14, 18, 14, 22, 10, 10, 30, 30, 8, 8, 8, 8, 8, 50];

/** 构建一行会议数据 */
function buildMeetingRow(m: Meeting, seq: number): (string | number)[] {
  const attended = m.participants.filter((p) => p.status === 'attended');
  const leave = m.participants.filter((p) => p.status === 'leave');
  const absent = m.participants.filter((p) => p.status === 'absent');
  const total = m.participants.length;
  const rate = total > 0 ? ((attended.length / total) * 100).toFixed(1) + '%' : '-';

  const attendeeList = m.participants
    .map((p) => {
      let name = p.name;
      if (p.status === 'leave') name += '(请假)';
      else if (p.status === 'absent') name += '(缺席)';
      else if (p.isGuest) name += '(列席)';
      if (p.leaveReason) name += `[${p.leaveReason}]`;
      return name;
    })
    .join('、');

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
    total,
    attended.length,
    leave.length,
    absent.length,
    rate,
    attendeeList,
  ];
}

/** 生成会议明细 Sheet（主表与子表结构一致） */
function buildDetailSheet(
  meetings: Meeting[],
  subtitlePrefix: string,
  subtitlePeriod: string
): XLSX.WorkSheet | null {
  if (meetings.length === 0) return null;

  const sheetData: (string | number)[][] = [
    [''],  // 大标题
    [''],  // 副标题
    DETAIL_HEADERS,
  ];

  meetings.forEach((m, i) => {
    sheetData.push(buildMeetingRow(m, i + 1));
  });

  // 合计行
  const totalAll = meetings.reduce((s, m) => s + m.participants.length, 0);
  const totalAttended = meetings.reduce((s, m) => s + m.participants.filter((p) => p.status === 'attended').length, 0);
  const totalLeave = meetings.reduce((s, m) => s + m.participants.filter((p) => p.status === 'leave').length, 0);
  const totalAbsent = meetings.reduce((s, m) => s + m.participants.filter((p) => p.status === 'absent').length, 0);
  const avgRate = totalAll > 0 ? ((totalAttended / totalAll) * 100).toFixed(1) + '%' : '-';
  sheetData.push([
    '合计', '', '', '', '', '', '', '', '', '', '',
    totalAll, totalAttended, totalLeave, totalAbsent, avgRate, '',
  ]);

  const ws = XLSX.utils.aoa_to_sheet(sheetData);
  setColWidths(ws, DETAIL_COL_WIDTHS);
  applyTitleStyle(ws, 0, DETAIL_HEADERS.length, '党建工作台账');
  applySubtitleStyle(ws, 1, DETAIL_HEADERS.length, `（${subtitlePrefix} — ${subtitlePeriod}）`);
  applyHeaderStyle(ws, 2, DETAIL_HEADERS.length);
  applyDataStyles(ws, 3, sheetData.length - 2, DETAIL_HEADERS.length);
  applyTotalRowStyle(ws, sheetData.length - 1, DETAIL_HEADERS.length);
  setRowHeights(ws, [
    { hpt: 40 },
    { hpt: 24 },
    { hpt: 30 },
    ...Array.from({ length: sheetData.length - 3 }, () => ({ hpt: 45 })),
  ]);
  return ws;
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
  const wsMain = buildDetailSheet(yearMeetings, '会议记录明细', subtitlePeriod);
  if (wsMain) {
    XLSX.utils.book_append_sheet(wb, wsMain, '会议记录明细');
  }

  // ============ 分类子表（字段与会议记录明细一致） ============

  // 支委会
  const committeeMeetings = yearMeetings.filter((m) => m.type.includes('支部委员会'));
  const wsCommittee = buildDetailSheet(committeeMeetings, '支委会', subtitlePeriod);
  if (wsCommittee) XLSX.utils.book_append_sheet(wb, wsCommittee, '支委会');

  // 党员大会
  const memberMeetingMeetings = yearMeetings.filter((m) => m.type.includes('支部党员大会'));
  const wsMemberMeeting = buildDetailSheet(memberMeetingMeetings, '党员大会', subtitlePeriod);
  if (wsMemberMeeting) XLSX.utils.book_append_sheet(wb, wsMemberMeeting, '党员大会');

  // 各党小组会（动态生成所有有数据的党小组子表）
  const groupMeetingMeetings = yearMeetings.filter((m) => m.type.includes('党小组会'));
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
    const wsGroup = buildDetailSheet(groupMeetings, `${group}会`, subtitlePeriod);
    if (wsGroup) XLSX.utils.book_append_sheet(wb, wsGroup, `${group}会`);
  });

  // 组织生活会
  const organizationalMeetings = yearMeetings.filter((m) => m.type.includes('组织生活会'));
  const wsOrganizational = buildDetailSheet(organizationalMeetings, '组织生活会', subtitlePeriod);
  if (wsOrganizational) XLSX.utils.book_append_sheet(wb, wsOrganizational, '组织生活会');

  // 民主生活会
  const democraticMeetings = yearMeetings.filter((m) => m.type.includes('民主生活会'));
  const wsDemocratic = buildDetailSheet(democraticMeetings, '民主生活会', subtitlePeriod);
  if (wsDemocratic) XLSX.utils.book_append_sheet(wb, wsDemocratic, '民主生活会');

  // ============ 参会考勤统计 ============
  const headers2 = ['序号', '姓名', '部室', '部门/支部', '应参加次数', '实际出席次数', '请假次数', '缺席次数', '出勤率'];
  const sheet2Data: (string | number)[][] = [
    [''],
    [''],
    headers2,
  ];

  const activeMembers = members.filter((m) => m.status === 'active');
  const memberStats = activeMembers.map((member) => {
    let shouldAttend = 0;
    let attended = 0;
    let leave = 0;
    let absent = 0;
    yearMeetings.forEach((meeting) => {
      const p = meeting.participants.find((pp) => pp.memberId === member.id);
      if (p) {
        shouldAttend++;
        if (p.status === 'attended') attended++;
        else if (p.status === 'leave') leave++;
        else if (p.status === 'absent') absent++;
      }
    });
    const rate = shouldAttend > 0 ? ((attended / shouldAttend) * 100).toFixed(1) + '%' : '-';
    return { member, shouldAttend, attended, leave, absent, rate: shouldAttend > 0 ? (attended / shouldAttend) * 100 : -1, rateStr: rate };
  }).sort((a, b) => b.rate - a.rate);

  memberStats.forEach((s, i) => {
    const dept = Array.isArray(s.member.department)
      ? s.member.department.filter(Boolean).join('、')
      : (s.member.department || '');
    sheet2Data.push([
      i + 1, s.member.name, s.member.title || '-', dept || '-',
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
    const mAttended = monthMeetings.reduce((s, mm) => s + mm.participants.filter((p) => p.status === 'attended').length, 0);
    const mTotal = monthMeetings.reduce((s, mm) => s + mm.participants.length, 0);
    const mRate = mTotal > 0 ? ((mAttended / mTotal) * 100).toFixed(1) + '%' : '-';
    const rowLabel = isCrossYear ? cursor.format('YYYY年M月') : `${cursor.month() + 1}月`;
    sheet3Data.push([rowLabel, monthMeetings.length, mTotal, mAttended, mRate]);
    sumMeetings += monthMeetings.length;
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
  yearMeetings.forEach((m) => {
    const types = Array.isArray(m.type) ? m.type : [String(m.type)];
    types.forEach((t) => { typeCount[t] = (typeCount[t] || 0) + 1; });
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
