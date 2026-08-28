/**
 * 组长填报 Excel 解析与校验（V3.4 功能 8c）
 *
 * 一个解析器通吃三种来源（均为现有台账 17 列字段结构）：
 * - 组长手工填报表（downloadGroupTemplate 生成的模板）
 * - 自动备份 Excel（含 BACKUP_JSON 隐藏表的优先走整库融合，无隐藏表的按台账解析）
 * - 台账导出文件回导核对（取第一个明细主表，分类子表为其子集不重复解析）
 *
 * 校验规则：
 * - 参会姓名按本机人员管理匹配（与会议表单 matchMember 同口径），不自动新建人员；
 *   匹配不到的姓名列入"未匹配"，由用户逐人选择按临时人员并入或取消该人
 * - 会议日期非法 / 会议类型不在可选值 / 参会名单分栏格式错误 → 列出 Excel 行号与原因，整表拦截
 * - 应到/实到/请假/缺席四列与名单分栏人数不一致 → 以名单明细为准，差异行列出提示
 * - 与本机"日期+名称"相同的会议 → 疑似重复提示（正常并入，不拦截）
 */

import { v4 as uuidv4 } from 'uuid';
import { db } from '../db';
import type { Meeting, Member, Participant } from '../types';
import { MEETING_TYPES, migrateMeetingTypeName } from '../types';
import { DETAIL_HEADERS, DETAIL_COL_WIDTHS, setColWidths, applyHeaderStyle } from './exportExcel';
import { addLog } from './logHelper';

// ==================== 类型定义 ====================

/** 格式错误（含 Excel 行号与原因；存在任一错误即整表拦截） */
export interface GroupExcelRowError {
  row: number;
  reason: string;
}

/** 出勤四列与名单分栏不一致的差异提示（以名单明细为准） */
export interface GroupExcelAttendanceFix {
  row: number;
  detail: string;
}

/** 与本机"日期+名称"相同的疑似重复会议（正常并入，建议手动清理） */
export interface GroupExcelDuplicate {
  row: number;
  date: string;
  name: string;
}

/** 未匹配姓名的处理方式（校验报告弹窗逐人选择） */
export type UnmatchedNameDecision = 'temporary' | 'skip';

/** 解析校验结果 */
export interface GroupExcelParseResult {
  /** false = 存在格式错误（非法日期/类型/名单格式），整表拦截要求修正后重导 */
  ok: boolean;
  /** 解析出的会议记录（未匹配姓名的参与者以临时人员标记，不自动新建人员） */
  meetings: Meeting[];
  /** 本机匹配不到的姓名（去重） */
  unmatchedNames: string[];
  /** 格式错误明细 */
  errors: GroupExcelRowError[];
  /** 出勤四列差异提示 */
  attendanceFixes: GroupExcelAttendanceFix[];
  /** 疑似重复会议 */
  duplicates: GroupExcelDuplicate[];
}

// ==================== 姓名匹配（与会议表单 matchMember 同口径） ====================

/** 姓名匹配：精确 → 包含（唯一命中）→ 去空格（唯一命中） */
function matchMemberByName(members: Member[], name: string): Member | undefined {
  const exact = members.find((m) => m.name === name);
  if (exact) return exact;
  const includes = members.filter((m) => m.name.includes(name) || name.includes(m.name));
  if (includes.length === 1) return includes[0];
  const normalized = name.replace(/\s+/g, '');
  const noSpace = members.filter(
    (m) => m.name.replace(/\s+/g, '').includes(normalized) || normalized.includes(m.name.replace(/\s+/g, '')),
  );
  if (noSpace.length === 1) return noSpace[0];
  return undefined;
}

// ==================== 单元格值解析 ====================

/** 常用类型别名容错（简写 → 标准类型名；migrateMeetingTypeName 已含旧版映射） */
const MEETING_TYPE_ALIASES: Record<string, string> = {
  '支委会': '支部委员会',
  '党员大会': '支部党员大会',
  '党日活动': '主题党日活动',
};

/** 会议日期单元格值 → YYYY-MM-DD；非法返回 null（支持文本/Excel 日期序列/Date，容错 / 与 年月日 分隔） */
function normalizeDateCell(v: unknown): string | null {
  if (v == null || v === '') return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  // cellDates 模式下的日期单元格
  if (v instanceof Date) {
    return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  }
  // Excel 1900 日期系统序列值（数字日期单元格）
  if (typeof v === 'number' && isFinite(v)) {
    const ms = Math.round((v - 25569) * 86400000); // 25569 = 1970-01-01 的 Excel 序列值
    if (ms < 0) return null;
    const d = new Date(ms);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  const m = String(v).trim().match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const da = Number(m[3]);
  // 组合合法性校验（大小月 / 闰年）
  const dt = new Date(Date.UTC(y, mo - 1, da));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== da) return null;
  return `${y}-${pad(mo)}-${pad(da)}`;
}

/** 会议类型列解析：按分隔符拆开，逐一映射校验；非法返回 error */
function parseMeetingTypes(raw: string): { types: string[]; error?: string } {
  const parts = String(raw || '')
    .split(/[、,，;；/]/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return { types: [], error: '会议类型为空' };
  const types: string[] = [];
  for (const p of parts) {
    const mapped = MEETING_TYPE_ALIASES[p] || migrateMeetingTypeName(p);
    if (!(MEETING_TYPES as string[]).includes(mapped)) {
      return { types: [], error: `会议类型"${p}"不在可选值内（${MEETING_TYPES.join('/')}）` };
    }
    if (!types.includes(mapped)) types.push(mapped);
  }
  return { types };
}

// ==================== 参会名单解析 ====================

interface RosterName {
  name: string;
  isGuest: boolean;
  leaveReason?: string;
}

interface ParsedRoster {
  attended: RosterName[];
  leave: RosterName[];
  absent: RosterName[];
}

/**
 * 解析参会人员名单（与台账导出同款分栏格式，每栏一行）：
 * 参会：张三、李四 / 出席：王五(列席) / 请假：赵六(事假) / 缺席：钱七
 * 名字以 、 ， , ； ; 分隔；列席标 (列席)；请假原因以括号标注
 */
function parseRoster(raw: string): { roster: ParsedRoster | null; error?: string } {
  const text = String(raw || '').trim();
  const empty: ParsedRoster = { attended: [], leave: [], absent: [] };
  if (!text) return { roster: empty };
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const roster: ParsedRoster = { attended: [], leave: [], absent: [] };
  for (const line of lines) {
    const m = line.match(/^(参会|出席|请假|缺席)\s*[:：]\s*(.*)$/);
    if (!m) {
      return {
        roster: null,
        error: `参会人员名单格式错误（"${line.slice(0, 14)}"须以 参会：/请假：/缺席： 分栏开头，每栏一行）`,
      };
    }
    const bucket = m[1] === '请假' ? roster.leave : m[1] === '缺席' ? roster.absent : roster.attended;
    const names = m[2].split(/[、,，;；]/).map((s) => s.trim()).filter(Boolean);
    for (const item of names) {
      if (m[1] === '请假') {
        const lm = item.match(/^(.+?)[(（]([^()（）]+)[)）]$/);
        if (lm) bucket.push({ name: lm[1].trim(), isGuest: false, leaveReason: lm[2].trim() });
        else bucket.push({ name: item, isGuest: false });
      } else {
        const isGuest = /[(（]列席[)）]\s*$/.test(item);
        const name = item.replace(/[(（]列席[)）]\s*$/, '').trim();
        bucket.push({ name, isGuest });
      }
    }
  }
  return { roster };
}

/** 数值列解析（应到/实到等四列容错读取），非法返回 null */
function toCount(v: string): number | null {
  if (v == null || String(v).trim() === '' || String(v).trim() === '-') return null;
  const n = Number(String(v).trim());
  return isFinite(n) ? n : null;
}

// ==================== 主解析流程 ====================

/**
 * 解析并校验组长填报 Excel（会议台账 17 列格式）
 * 返回校验报告：格式错误整表拦截；未匹配姓名与疑似重复逐条列出供确认
 */
export async function parseGroupExcelFile(file: File): Promise<
  { success: true; result: GroupExcelParseResult } | { success: false; error: string }
> {
  try {
    const XLSX = await import('xlsx-js-style');
    const buffer = await file.arrayBuffer();
    const wb = XLSX.read(new Uint8Array(buffer), { type: 'array', cellDates: true });

    const [localMembers, localMeetings] = await Promise.all([
      db.members.toArray(),
      db.meetings.toArray(),
    ]);
    const localMeetingKeys = new Set(localMeetings.map((m) => `${m.date}|${(m.name || '').trim()}`));

    // 逐 sheet 找第一个含 17 列台账表头的工作表（组长模板表头上方有说明行、
    // 台账导出含大标题/副标题行，扫描前 12 行兼容两种；台账导出的分类子表为主表子集，不重复解析）
    for (const sheetName of wb.SheetNames) {
      const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], { header: 1, defval: '' });
      const headerRowIdx = rows.findIndex(
        (r) =>
          r.some((c) => String(c).trim() === '会议名称') &&
          r.some((c) => String(c).trim() === '参会人员名单'),
      );
      if (headerRowIdx < 0 || headerRowIdx >= 12) continue;

      // 表头 → 列索引映射
      const colMap = new Map<string, number>();
      (rows[headerRowIdx] as unknown[]).forEach((c, i) => {
        const h = String(c ?? '').trim();
        if (h) colMap.set(h, i);
      });
      const cell = (row: unknown[], header: string): string => {
        const idx = colMap.get(header);
        return idx === undefined ? '' : String(row[idx] ?? '').trim();
      };
      const rawCell = (row: unknown[], header: string): unknown => {
        const idx = colMap.get(header);
        return idx === undefined ? undefined : row[idx];
      };

      const meetings: Meeting[] = [];
      const errors: GroupExcelRowError[] = [];
      const attendanceFixes: GroupExcelAttendanceFix[] = [];
      const duplicates: GroupExcelDuplicate[] = [];
      const unmatchedSet = new Set<string>();
      const now = new Date().toISOString();

      for (let i = headerRowIdx + 1; i < rows.length; i++) {
        const row = rows[i] as unknown[];
        const excelRowNo = i + 1; // Excel 实际行号（1-based）
        const nameRaw = cell(row, '会议名称');
        const rosterRaw = cell(row, '参会人员名单');
        // 跳过完全空行与模板示例行（名称以"（示例）"开头）
        if (!nameRaw && !cell(row, '会议日期') && !rosterRaw) continue;
        if (/^[（(]示例[)）]/.test(nameRaw)) continue;

        // ---- 逐项校验（任一错误记录行号，本行不入库） ----
        const rowErrors: string[] = [];
        const date = normalizeDateCell(rawCell(row, '会议日期'));
        if (!date) {
          rowErrors.push(`会议日期非法（"${cell(row, '会议日期')}"），须为 YYYY-MM-DD 格式的合法日期`);
        }
        const typeResult = parseMeetingTypes(cell(row, '会议类型'));
        if (typeResult.error) rowErrors.push(typeResult.error);
        const rosterResult = parseRoster(rosterRaw);
        if (rosterResult.error) rowErrors.push(rosterResult.error);
        if (rowErrors.length > 0) {
          rowErrors.forEach((reason) => errors.push({ row: excelRowNo, reason }));
          continue;
        }
        const roster = rosterResult.roster!;
        const meetingDate = date as string; // 上方校验已排除非法日期（null）

        // ---- 姓名匹配：按本机人员库匹配，不自动新建人员 ----
        const participants: Participant[] = [];
        const pushParticipant = (p: RosterName, status: Participant['status']) => {
          const member = matchMemberByName(localMembers, p.name);
          if (member) {
            participants.push({
              memberId: member.id,
              name: member.name,
              status,
              isTemporary: false,
              leaveReason: p.leaveReason,
              isGuest: p.isGuest,
            });
          } else {
            // 本机无此人：按临时人员并入待确认（用户可在报告中选择取消该人）
            unmatchedSet.add(p.name);
            participants.push({
              memberId: '',
              name: p.name,
              status,
              isTemporary: true,
              leaveReason: p.leaveReason,
              isGuest: p.isGuest,
            });
          }
        };
        roster.attended.forEach((p) => pushParticipant(p, 'attended'));
        roster.leave.forEach((p) => pushParticipant(p, 'leave'));
        roster.absent.forEach((p) => pushParticipant(p, 'absent'));

        // ---- 出勤四列比对：以名单明细为准，差异仅提示 ----
        const expected = {
          应到: roster.attended.length + roster.leave.length + roster.absent.length,
          实到: roster.attended.length,
          请假: roster.leave.length,
          缺席: roster.absent.length,
        };
        const diffs: string[] = [];
        (['应到', '实到', '请假', '缺席'] as const).forEach((key) => {
          const actual = toCount(cell(row, `${key}人数`));
          if (actual !== null && actual !== expected[key]) {
            diffs.push(`${key} ${actual} → ${expected[key]}`);
          }
        });
        if (diffs.length > 0) {
          attendanceFixes.push({ row: excelRowNo, detail: `${diffs.join('、')}（已按名单明细导入）` });
        }

        // ---- 疑似重复：与本机"日期+名称"相同 ----
        const meetingName = nameRaw === '-' ? '' : nameRaw;
        if (meetingName && localMeetingKeys.has(`${meetingDate}|${meetingName}`)) {
          duplicates.push({ row: excelRowNo, date: meetingDate, name: meetingName });
        }

        meetings.push({
          id: uuidv4(),
          name: meetingName,
          type: typeResult.types,
          partyGroups: cell(row, '所属党小组')
            .split(/[、,，;；]/)
            .map((s) => s.trim())
            .filter(Boolean),
          date: meetingDate,
          time: cell(row, '会议时间') === '-' ? '' : cell(row, '会议时间'),
          location: cell(row, '会议地点') === '-' ? '' : cell(row, '会议地点'),
          host: cell(row, '主持人') === '-' ? '' : cell(row, '主持人'),
          recorder: cell(row, '记录人') === '-' ? '' : cell(row, '记录人'),
          topic: cell(row, '会议议题') === '-' ? '' : cell(row, '会议议题'),
          summary: '',
          resolution: cell(row, '会议决议/结论'),
          participants,
          createdAt: now,
          updatedAt: now,
        });
      }

      return {
        success: true,
        result: {
          ok: errors.length === 0,
          meetings,
          unmatchedNames: [...unmatchedSet],
          errors,
          attendanceFixes,
          duplicates,
        },
      };
    }

    return {
      success: false,
      error: '未找到台账表头（须包含"会议名称"与"参会人员名单"列），请使用「下载组长填报模板」生成的模板填写',
    };
  } catch {
    return { success: false, error: 'Excel 文件解析失败，请确认文件未损坏' };
  }
}

/**
 * 按用户对未匹配姓名的处理决定过滤参与者并导入会议
 * @param meetings 解析出的会议
 * @param decisions 未匹配姓名 → 处理方式（temporary=按临时人员并入 / skip=取消该人）
 * @returns 实际导入条数
 */
export async function importGroupMeetings(
  meetings: Meeting[],
  decisions: Record<string, UnmatchedNameDecision> = {},
): Promise<number> {
  // 取消该人：从参会名单中移除对应临时人员（不自动新建人员）
  const skippedNames = new Set(
    Object.entries(decisions)
      .filter(([, d]) => d === 'skip')
      .map(([name]) => name),
  );
  const finalMeetings = meetings.map((m) => ({
    ...m,
    participants: m.participants.filter((p) => !(p.isTemporary && skippedNames.has(p.name))),
  }));

  if (finalMeetings.length > 0) {
    await db.meetings.bulkAdd(finalMeetings);
    await addLog('MERGE_DATA', `Excel 台账融合导入：新增会议 ${finalMeetings.length} 条`);
  }
  return finalMeetings.length;
}

// ==================== 组长填报模板下载 ====================

/** 生成并下载组长填报模板（17 列台账字段 + 填写说明行 + 示例行 1 条，与台账导出同字段结构） */
export async function downloadGroupTemplate(): Promise<void> {
  const XLSX = await import('xlsx-js-style');
  const wb = XLSX.utils.book_new();

  const instructions =
    '填写说明：① 会议日期格式 YYYY-MM-DD；② 会议类型从可选值中填写（' +
    MEETING_TYPES.join('/') +
    '，多类型用"、"分隔）；③ 参会人员名单按分栏格式填写，每栏一行：参会：张三、李四 / 请假：王五(事假) / 缺席：赵六；' +
    '列席人员姓名后加(列席)；④ 下方示例行仅供参考，导入时自动跳过。';

  // 示例行（导入时按"（示例）"前缀自动跳过）
  const exampleRow: (string | number)[] = [
    1, '（示例）三支部党员大会', '2026-01-15', '14:30-16:30', '支部党员大会', '第一党小组',
    '党员活动室', '张三', '李四', '学习上级会议精神', '形成会议决议', 12, 10, 1, 1, '83.3%',
    '参会：张三、李四、王五(列席)\n请假：赵六(事假)\n缺席：钱七',
  ];

  const aoa: (string | number)[][] = [
    [instructions],   // 说明行（合并 17 列）
    DETAIL_HEADERS,   // 表头（与台账导出同 17 列）
    exampleRow,       // 示例行
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  // 说明行合并整行
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: DETAIL_HEADERS.length - 1 } }];
  setColWidths(ws, DETAIL_COL_WIDTHS);
  // 表头样式与台账导出一致
  applyHeaderStyle(ws, 1, DETAIL_HEADERS.length);
  // 说明行样式（灰底、自动换行）
  const a1 = ws['A1'] as any; // xlsx-js-style 无类型声明（动态导入为 any），单元格对象按 any 处理
  if (a1) {
    a1.s = {
      font: { sz: 10, name: '微软雅黑', color: { rgb: '666666' } },
      fill: { fgColor: { rgb: 'FFF2F0' } },
      alignment: { horizontal: 'left', vertical: 'center', wrapText: true },
      border: {
        top: { style: 'thin', color: { rgb: 'E8C8C8' } },
        bottom: { style: 'thin', color: { rgb: 'E8C8C8' } },
        left: { style: 'thin', color: { rgb: 'E8C8C8' } },
        right: { style: 'thin', color: { rgb: 'E8C8C8' } },
      },
    };
  }
  ws['!rows'] = [{ hpt: 72 }, { hpt: 30 }, { hpt: 60 }];

  XLSX.utils.book_append_sheet(wb, ws, '会议记录明细');
  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = '党小组组长填报模板.xlsx';
  a.click();
  URL.revokeObjectURL(url);
}
