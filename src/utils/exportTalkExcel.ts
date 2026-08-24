import * as XLSX from 'xlsx-js-style';
import dayjs from 'dayjs';
import type { TalkRecord } from '../types';
import { TALK_METHOD_LABEL } from '../types';

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
        alignment: { horizontal: c >= 10 ? 'left' : 'center', vertical: 'center', wrapText: true },
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
        alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
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

/** 生成台账文件名 */
function buildFileName(start: string, end: string): string {
  const sd = dayjs(start);
  const ed = dayjs(end);
  // 同年且为整年：简化为年份
  if (sd.year() === ed.year() && sd.month() === 0 && sd.date() === 1 && ed.month() === 11 && ed.date() === 31) {
    return `谈心谈话台账_${sd.year()}年.xlsx`;
  }
  return `谈心谈话台账_${sd.format('YYYY年MM月DD日')}-${ed.format('YYYY年MM月DD日')}.xlsx`;
}

/**
 * 导出谈心谈话台账（按时间段）
 * @param start 开始日期 YYYY-MM-DD
 * @param end 结束日期 YYYY-MM-DD
 * @param talks 全部谈话记录（内部过滤时间段）
 */
export async function exportTalkLedger(start: string, end: string, talks: TalkRecord[]): Promise<void> {
  const wb = XLSX.utils.book_new();
  const subtitlePeriod = `统计时间段：${dayjs(start).format('YYYY年MM月DD日')} - ${dayjs(end).format('YYYY年MM月DD日')}`;

  const rangeTalks = talks
    .filter((t) => t.talkDate >= start && t.talkDate <= end)
    .sort((a, b) => a.talkDate.localeCompare(b.talkDate));

  // ============ Sheet 1: 谈心谈话明细 ============
  const headers1 = [
    '序号', '谈话时间', '谈话方式', '谈话类型',
    '是否五必谈',
    '谈话人', '谈话人职务',
    '谈话对象', '谈话对象职务',
    '联系人', '谈话地点',
    '谈话提纲', '备注',
  ];
  const sheet1Data: (string | number)[][] = [
    [''],  // row 0: 大标题
    [''],  // row 1: 副标题
    headers1, // row 2: 表头
  ];

  rangeTalks.forEach((t, i) => {
    const targetNames = t.targetNames && t.targetNames.length > 0 ? t.targetNames : [t.targetName];
    sheet1Data.push([
      i + 1,
      `${t.talkDate}${t.timePeriod === 'pm' ? ' 下午' : ' 上午'}`,
      TALK_METHOD_LABEL[t.method] || t.method,
      t.type,
      t.isFiveMustTalk ? '是' : '否',
      t.talkerName,
      t.talkerTitle || '-',
      targetNames.filter(Boolean).join('、'),
      t.targetTitle || '-',
      t.contactPerson || '-',
      t.location || '-',
      t.outline || '',
      t.remark || '',
    ]);
  });

  // 合计行
  const indCount = rangeTalks.filter((t) => t.method === 'individual').length;
  const colCount = rangeTalks.filter((t) => t.method === 'collective').length;
  const orgCount = rangeTalks.filter((t) => t.method === 'organized').length;
  sheet1Data.push([
    '合计', '', `共 ${rangeTalks.length} 次`, '',
    `五必谈 ${rangeTalks.filter((t) => t.isFiveMustTalk).length} 次`,
    `个别谈话 ${indCount} 次`, '',
    `集体谈话 ${colCount} 次`, `组织约谈 ${orgCount} 次`,
    '', '', '', '',
  ]);

  const ws1 = XLSX.utils.aoa_to_sheet(sheet1Data);
  setColWidths(ws1, [6, 16, 10, 24, 9, 10, 14, 16, 14, 10, 16, 30, 24]);
  applyTitleStyle(ws1, 0, headers1.length, '谈心谈话台账');
  applySubtitleStyle(ws1, 1, headers1.length, `（谈心谈话明细 — ${subtitlePeriod}）`);
  applyHeaderStyle(ws1, 2, headers1.length);
  applyDataStyles(ws1, 3, sheet1Data.length - 2, headers1.length);
  applyTotalRowStyle(ws1, sheet1Data.length - 1, headers1.length);
  setRowHeights(ws1, [
    { hpt: 40 },  // 大标题
    { hpt: 24 },  // 副标题
    { hpt: 30 },  // 表头
    ...Array.from({ length: sheet1Data.length - 3 }, () => ({ hpt: 50 })),
  ]);
  XLSX.utils.book_append_sheet(wb, ws1, '谈心谈话明细');

  // ============ Sheet 2: 按月统计（含组织约谈；跨年区间按"年-月"逐月归组） ============
  const headers2 = ['月份', '个别谈话', '集体谈话', '组织约谈', '合计'];
  const sheet2Data: (string | number)[][] = [
    [''],
    [''],
    headers2,
  ];
  let totalInd = 0;
  let totalCol = 0;
  let totalOrg = 0;
  const isCrossYear = dayjs(start).year() !== dayjs(end).year();
  let cursor = dayjs(start).startOf('month');
  const endMonth = dayjs(end).endOf('month');
  while (cursor.isBefore(endMonth) || cursor.isSame(endMonth, 'month')) {
    const prefix = cursor.format('YYYY-MM');
    const monthTalks = rangeTalks.filter((t) => t.talkDate.startsWith(prefix));
    const mi = monthTalks.filter((t) => t.method === 'individual').length;
    const mc = monthTalks.filter((t) => t.method === 'collective').length;
    const mo = monthTalks.filter((t) => t.method === 'organized').length;
    totalInd += mi;
    totalCol += mc;
    totalOrg += mo;
    const rowLabel = isCrossYear ? cursor.format('YYYY年M月') : `${cursor.month() + 1}月`;
    sheet2Data.push([rowLabel, mi, mc, mo, mi + mc + mo]);
    cursor = cursor.add(1, 'month');
  }
  sheet2Data.push(['合计', totalInd, totalCol, totalOrg, totalInd + totalCol + totalOrg]);

  const ws2 = XLSX.utils.aoa_to_sheet(sheet2Data);
  setColWidths(ws2, [10, 12, 12, 12, 10]);
  applyTitleStyle(ws2, 0, headers2.length, '谈心谈话台账');
  applySubtitleStyle(ws2, 1, headers2.length, `（月度统计 — ${subtitlePeriod}）`);
  applyHeaderStyle(ws2, 2, headers2.length);
  applyDataStyles(ws2, 3, sheet2Data.length - 2, headers2.length);
  applyTotalRowStyle(ws2, sheet2Data.length - 1, headers2.length);
  setRowHeights(ws2, [
    { hpt: 40 },
    { hpt: 24 },
    { hpt: 28 },
    ...Array.from({ length: sheet2Data.length - 3 }, () => ({ hpt: 22 })),
  ]);
  XLSX.utils.book_append_sheet(wb, ws2, '月度统计');

  // ============ Sheet 3: 谈话类型统计 ============
  const headers3 = ['谈话类型', '次数', '占比'];
  const sheet3Data: (string | number)[][] = [
    [''],
    [''],
    headers3,
  ];
  const typeCount: Record<string, number> = {};
  rangeTalks.forEach((t) => { typeCount[t.type] = (typeCount[t.type] || 0) + 1; });
  const total3 = Object.values(typeCount).reduce((s, v) => s + v, 0);
  Object.entries(typeCount)
    .sort((a, b) => b[1] - a[1])
    .forEach(([type, count]) => {
      sheet3Data.push([type, count, total3 > 0 ? ((count / total3) * 100).toFixed(1) + '%' : '-']);
    });
  sheet3Data.push(['合计', total3, total3 > 0 ? '100%' : '-']);

  const ws3 = XLSX.utils.aoa_to_sheet(sheet3Data);
  setColWidths(ws3, [36, 10, 10]);
  applyTitleStyle(ws3, 0, headers3.length, '谈心谈话台账');
  applySubtitleStyle(ws3, 1, headers3.length, `（谈话类型统计 — ${subtitlePeriod}）`);
  applyHeaderStyle(ws3, 2, headers3.length);
  applyDataStyles(ws3, 3, sheet3Data.length - 2, headers3.length);
  applyTotalRowStyle(ws3, sheet3Data.length - 1, headers3.length);
  setRowHeights(ws3, [
    { hpt: 40 },
    { hpt: 24 },
    { hpt: 28 },
    ...Array.from({ length: sheet3Data.length - 3 }, () => ({ hpt: 22 })),
  ]);
  XLSX.utils.book_append_sheet(wb, ws3, '谈话类型统计');

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
