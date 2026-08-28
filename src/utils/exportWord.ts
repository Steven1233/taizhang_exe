import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  AlignmentType,
  BorderStyle,
  HeadingLevel,
  ShadingType,
} from 'docx';
import type { Meeting, Member } from '../types';
import { countActiveAttendance } from './memberStatus';

// 主题色
const THEME_RED = 'CC0000';
const HEADER_BG = 'C00000';
const LIGHT_RED = 'FFF2F0';
const BORDER_COLOR = 'D46B6A';

function createCell(
  text: string,
  opts: {
    bold?: boolean;
    color?: string;
    bg?: string;
    align?: typeof AlignmentType[keyof typeof AlignmentType];
    fontSize?: number;
    colSpan?: number;
    width?: number;
  } = {}
): TableCell {
  const {
    bold = false,
    color = '000000',
    bg,
    align = AlignmentType.CENTER,
    fontSize = 20,
    colSpan,
  } = opts;

  return new TableCell({
    children: [
      new Paragraph({
        alignment: align,
        spacing: { before: 40, after: 40 },
        children: [
          new TextRun({
            text: text || '-',
            bold,
            color,
            size: fontSize,
            font: '微软雅黑',
          }),
        ],
      }),
    ],
    shading: bg ? { type: ShadingType.CLEAR, fill: bg } : undefined,
    columnSpan: colSpan,
    margins: { top: 60, bottom: 60, left: 80, right: 80 },
    width: opts.width ? { size: opts.width, type: WidthType.PERCENTAGE } : undefined,
  });
}

function heading(text: string, level: (typeof HeadingLevel)[keyof typeof HeadingLevel] = HeadingLevel.HEADING_2) {
  return new Paragraph({
    heading: level,
    spacing: { before: 300, after: 150 },
    children: [
      new TextRun({
        text,
        bold: true,
        color: THEME_RED,
        size: level === HeadingLevel.HEADING_1 ? 36 : 28,
        font: '微软雅黑',
      }),
    ],
  });
}

function bodyParagraph(text: string, opts: { bold?: boolean; indent?: boolean; spacing?: number } = {}) {
  return new Paragraph({
    spacing: { before: opts.spacing ?? 100, after: opts.spacing ?? 100 },
    indent: opts.indent ? { firstLine: 480 } : undefined,
    children: [
      new TextRun({
        text,
        bold: opts.bold,
        size: 22,
        font: '微软雅黑',
      }),
    ],
  });
}

const borderStyle = {
  top: { style: BorderStyle.SINGLE, size: 1, color: BORDER_COLOR },
  bottom: { style: BorderStyle.SINGLE, size: 1, color: BORDER_COLOR },
  left: { style: BorderStyle.SINGLE, size: 1, color: BORDER_COLOR },
  right: { style: BorderStyle.SINGLE, size: 1, color: BORDER_COLOR },
  insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: BORDER_COLOR },
  insideVertical: { style: BorderStyle.SINGLE, size: 1, color: BORDER_COLOR },
};

export async function exportDashboardReport(
  year: number,
  stats: {
    totalMeetings: number;
    avgAttendance: number;
    activeMembers: number;
    monthMeetings: number;
  },
  typeStats: { name: string; value: number }[],
  monthStats: { month: string; count: number }[],
  rankingData: { name: string; rate: number }[],
  meetings: Meeting[],
  members: Member[]
): Promise<void> {
  const yearMeetings = meetings.filter((m) => m.date.startsWith(String(year)));

  // === 标题 ===
  const titlePara = new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 200, after: 100 },
    children: [
      new TextRun({
        text: `${year}年度党建工作台账报告`,
        bold: true,
        size: 44,
        color: THEME_RED,
        font: '微软雅黑',
      }),
    ],
  });

  const subtitlePara = new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 100, after: 300 },
    children: [
      new TextRun({
        text: `生成日期：${new Date().toLocaleDateString('zh-CN')}`,
        size: 20,
        color: '666666',
        font: '微软雅黑',
      }),
    ],
  });

  // === 一、概览统计 ===
  const overviewTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: [
          createCell('会议总数', { bold: true, color: 'FFFFFF', bg: HEADER_BG, fontSize: 22 }),
          createCell('平均出勤率', { bold: true, color: 'FFFFFF', bg: HEADER_BG, fontSize: 22 }),
          createCell('在职党员', { bold: true, color: 'FFFFFF', bg: HEADER_BG, fontSize: 22 }),
          createCell('本月会议', { bold: true, color: 'FFFFFF', bg: HEADER_BG, fontSize: 22 }),
        ],
      }),
      new TableRow({
        children: [
          createCell(`${stats.totalMeetings} 次`, { bold: true, color: THEME_RED, fontSize: 28, bg: LIGHT_RED }),
          createCell(`${stats.avgAttendance}%`, { bold: true, color: THEME_RED, fontSize: 28, bg: LIGHT_RED }),
          createCell(`${stats.activeMembers} 人`, { bold: true, color: THEME_RED, fontSize: 28, bg: LIGHT_RED }),
          createCell(`${stats.monthMeetings} 次`, { bold: true, color: THEME_RED, fontSize: 28, bg: LIGHT_RED }),
        ],
      }),
    ],
    borders: borderStyle,
  });

  // === 二、会议类型分布 ===
  const typeRows: TableRow[] = [
    new TableRow({
      children: [
        createCell('会议类型', { bold: true, color: 'FFFFFF', bg: HEADER_BG, fontSize: 21 }),
        createCell('次数', { bold: true, color: 'FFFFFF', bg: HEADER_BG, fontSize: 21 }),
        createCell('占比', { bold: true, color: 'FFFFFF', bg: HEADER_BG, fontSize: 21 }),
      ],
    }),
  ];
  const total = typeStats.reduce((s, t) => s + t.value, 0) || 1;
  typeStats.forEach((t, i) => {
    typeRows.push(
      new TableRow({
        children: [
          createCell(t.name, { fontSize: 20, bg: i % 2 === 0 ? 'FFFBFA' : undefined }),
          createCell(`${t.value} 次`, { fontSize: 20, bg: i % 2 === 0 ? 'FFFBFA' : undefined }),
          createCell(`${((t.value / total) * 100).toFixed(1)}%`, { fontSize: 20, bg: i % 2 === 0 ? 'FFFBFA' : undefined }),
        ],
      })
    );
  });
  const typeTable = new Table({
    width: { size: 60, type: WidthType.PERCENTAGE },
    rows: typeRows,
    borders: borderStyle,
    columnWidths: [3000, 1500, 1500],
  });

  // === 三、月度会议统计 ===
  const monthRows: TableRow[] = [
    new TableRow({
      children: [
        createCell('月份', { bold: true, color: 'FFFFFF', bg: HEADER_BG, fontSize: 20 }),
        createCell('会议次数', { bold: true, color: 'FFFFFF', bg: HEADER_BG, fontSize: 20 }),
        createCell('月份', { bold: true, color: 'FFFFFF', bg: HEADER_BG, fontSize: 20 }),
        createCell('会议次数', { bold: true, color: 'FFFFFF', bg: HEADER_BG, fontSize: 20 }),
      ],
    }),
  ];
  for (let i = 0; i < 6; i++) {
    const cells: TableCell[] = [];
    for (let j = 0; j < 2; j++) {
      const idx = i + j * 6;
      const m = monthStats[idx];
      if (m) {
        cells.push(createCell(m.month, { fontSize: 20, bg: i % 2 === 0 ? 'FFFBFA' : undefined }));
        cells.push(createCell(`${m.count} 次`, { fontSize: 20, bg: i % 2 === 0 ? 'FFFBFA' : undefined }));
      }
    }
    monthRows.push(new TableRow({ children: cells }));
  }
  const monthTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: monthRows,
    borders: borderStyle,
  });

  // === 四、出勤率排行 ===
  const rankRows: TableRow[] = [
    new TableRow({
      children: [
        createCell('排名', { bold: true, color: 'FFFFFF', bg: HEADER_BG, fontSize: 20 }),
        createCell('姓名', { bold: true, color: 'FFFFFF', bg: HEADER_BG, fontSize: 20 }),
        createCell('出勤率', { bold: true, color: 'FFFFFF', bg: HEADER_BG, fontSize: 20 }),
        createCell('排名', { bold: true, color: 'FFFFFF', bg: HEADER_BG, fontSize: 20 }),
        createCell('姓名', { bold: true, color: 'FFFFFF', bg: HEADER_BG, fontSize: 20 }),
        createCell('出勤率', { bold: true, color: 'FFFFFF', bg: HEADER_BG, fontSize: 20 }),
      ],
    }),
  ];
  const halfLen = Math.ceil(rankingData.length / 2);
  for (let i = 0; i < halfLen; i++) {
    const cells: TableCell[] = [];
    const left = rankingData[i];
    const right = rankingData[i + halfLen];
    const rankBadge = (r: number) => (r <= 3 ? ['🥇', '🥈', '🥉'][r - 1] : `${r}`);
    cells.push(createCell(rankBadge(i + 1), { fontSize: 20, bold: i < 3, bg: i % 2 === 0 ? 'FFFBFA' : undefined }));
    cells.push(createCell(left.name, { fontSize: 20, bold: i < 3, bg: i % 2 === 0 ? 'FFFBFA' : undefined }));
    cells.push(createCell(`${left.rate}%`, { fontSize: 20, bold: i < 3, color: left.rate >= 90 ? '00A854' : left.rate >= 70 ? 'FA8C16' : 'F5222D', bg: i % 2 === 0 ? 'FFFBFA' : undefined }));
    if (right) {
      cells.push(createCell(rankBadge(i + 1 + halfLen), { fontSize: 20, bg: i % 2 === 0 ? 'FFFBFA' : undefined }));
      cells.push(createCell(right.name, { fontSize: 20, bg: i % 2 === 0 ? 'FFFBFA' : undefined }));
      cells.push(createCell(`${right.rate}%`, { fontSize: 20, color: right.rate >= 90 ? '00A854' : right.rate >= 70 ? 'FA8C16' : 'F5222D', bg: i % 2 === 0 ? 'FFFBFA' : undefined }));
    } else {
      cells.push(createCell('', { colSpan: 3, bg: i % 2 === 0 ? 'FFFBFA' : undefined }));
    }
    rankRows.push(new TableRow({ children: cells }));
  }
  const rankTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rankRows,
    borders: borderStyle,
  });

  // === 六、会议记录明细 ===
  const meetingHeader = new TableRow({
    children: [
      createCell('序号', { bold: true, color: 'FFFFFF', bg: HEADER_BG, fontSize: 18 }),
      createCell('会议名称', { bold: true, color: 'FFFFFF', bg: HEADER_BG, fontSize: 18 }),
      createCell('日期', { bold: true, color: 'FFFFFF', bg: HEADER_BG, fontSize: 18 }),
      createCell('会议类型', { bold: true, color: 'FFFFFF', bg: HEADER_BG, fontSize: 18 }),
      createCell('地点', { bold: true, color: 'FFFFFF', bg: HEADER_BG, fontSize: 18 }),
      createCell('主持人', { bold: true, color: 'FFFFFF', bg: HEADER_BG, fontSize: 18 }),
      createCell('议题', { bold: true, color: 'FFFFFF', bg: HEADER_BG, fontSize: 18, align: AlignmentType.LEFT }),
      createCell('出勤率', { bold: true, color: 'FFFFFF', bg: HEADER_BG, fontSize: 18 }),
    ],
  });
  const meetingRows: TableRow[] = [meetingHeader];
  const sortedMeetings = [...yearMeetings].sort((a, b) => b.date.localeCompare(a.date));
  sortedMeetings.forEach((m, i) => {
    // V3.3：时间线在职口径（按会议日期时点判定在职，离开期间不计入）
    const { shouldAttend, attended } = countActiveAttendance(m, members);
    const rate = shouldAttend > 0 ? ((attended / shouldAttend) * 100).toFixed(0) : '0';
    const bg = i % 2 === 0 ? 'FFFBFA' : undefined;
    meetingRows.push(
      new TableRow({
        children: [
          createCell(String(i + 1), { fontSize: 18, bg }),
          createCell(m.name || '-', { fontSize: 18, bg }),
          createCell(m.date, { fontSize: 18, bg }),
          createCell(Array.isArray(m.type) ? m.type.join('+') : String(m.type), { fontSize: 18, bg }),
          createCell(m.location, { fontSize: 18, bg }),
          createCell(m.host, { fontSize: 18, bg }),
          createCell(m.topic, { fontSize: 18, bg, align: AlignmentType.LEFT }),
          createCell(`${rate}%`, { fontSize: 18, bg, color: Number(rate) >= 90 ? '00A854' : Number(rate) >= 70 ? 'FA8C16' : 'F5222D', bold: true }),
        ],
      })
    );
  });
  const meetingTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: meetingRows,
    borders: borderStyle,
  });

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: '微软雅黑', size: 22 },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            margin: { top: 1000, bottom: 1000, left: 1000, right: 1000 },
          },
        },
        children: [
          titlePara,
          subtitlePara,

          heading('一、年度概览', HeadingLevel.HEADING_2),
          overviewTable,
          bodyParagraph(''),

          heading('二、会议类型分布', HeadingLevel.HEADING_2),
          typeTable,
          bodyParagraph(''),

          heading('三、月度会议统计', HeadingLevel.HEADING_2),
          monthTable,
          bodyParagraph(''),

          heading('四、出勤率排行榜', HeadingLevel.HEADING_2),
          rankTable,
          bodyParagraph(''),

          heading('五、会议记录明细', HeadingLevel.HEADING_2),
          bodyParagraph(`${year}年度共召开会议 ${stats.totalMeetings} 次：`, { bold: false }),
          meetingTable,
          bodyParagraph(''),
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            spacing: { before: 400 },
            children: [
              new TextRun({
                text: '—— 党建工作台账应用 自动生成 ——',
                color: '999999',
                size: 18,
                italics: true,
                font: '微软雅黑',
              }),
            ],
          }),
        ],
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${year}年度党建工作台账报告.docx`;
  a.click();
  URL.revokeObjectURL(url);
}
