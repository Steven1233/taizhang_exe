/**
 * V3.3 数据驱动验证脚本
 * 覆盖：时间线在职口径、套会拆开计次、Excel 台账结构（新增子表/名单分栏/口径统一）、Word 报告导出
 * 运行：npx esbuild scripts/v33-test.ts --bundle --platform=node --format=cjs --outfile=/tmp/v33-test.cjs && node /tmp/v33-test.cjs
 */
import type { Meeting, Member, Participant } from '../src/types';
import { typeMeetingUnits, meetingTotalUnits } from '../src/types';
import { isActiveAt, countActiveAttendance, membersActiveDuring } from '../src/utils/memberStatus';

// ==================== 测试数据 ====================

const mkMember = (over: Partial<Member> & { id: string; name: string }): Member => ({
  title: '测试部室',
  department: '第一党支部',
  phone: '',
  status: 'active',
  partyGroup: '第一党小组',
  isGroupLeader: false,
  committeeRole: '',
  createdAt: '2024-01-01T00:00:00',
  updatedAt: '2024-01-01T00:00:00',
  ...over,
});

// 张三：全程在职；李四：2025-03 借调、2025-09 回归；王五：2025-06 调离；赵六：在职但从未参会
const members: Member[] = [
  mkMember({ id: 'm1', name: '张三' }),
  mkMember({
    id: 'm2', name: '李四',
    status: 'active',
    statusHistory: [
      { status: 'active', date: '2024-01-01' },
      { status: 'seconded', date: '2025-03-01' },
      { status: 'active', date: '2025-09-01' },
    ],
  }),
  mkMember({
    id: 'm3', name: '王五',
    status: 'transferred',
    statusHistory: [
      { status: 'active', date: '2024-01-01' },
      { status: 'transferred', date: '2025-06-01' },
    ],
  }),
  mkMember({ id: 'm4', name: '赵六' }),
];

const mkParticipant = (over: Partial<Participant> & { memberId: string; name: string }): Participant => ({
  status: 'attended',
  isTemporary: false,
  ...over,
});

const mkMeeting = (over: Partial<Meeting> & { id: string; date: string }): Meeting => ({
  name: '',
  type: ['党课'],
  partyGroups: [],
  time: '09:00 - 10:00',
  location: '党员活动室',
  host: '张三',
  recorder: '李四',
  topic: '测试议题',
  summary: '',
  resolution: '',
  participants: [],
  createdAt: '2025-01-01T00:00:00',
  updatedAt: '2025-01-01T00:00:00',
  ...over,
});

// M1：套会（支部党员大会+党小组会×3组+党课+主题党日活动）→ 计 6 次
const m1 = mkMeeting({
  id: 'mt1', date: '2025-02-10',
  type: ['支部党员大会', '党小组会', '党课', '主题党日活动'],
  partyGroups: ['第一党小组', '第二党小组', '第三党小组'],
  participants: [
    mkParticipant({ memberId: 'm1', name: '张三' }),
    mkParticipant({ memberId: 'm2', name: '李四' }),                    // 2月在职
    mkParticipant({ memberId: 'm3', name: '王五', status: 'leave', leaveReason: '出差' }), // 2月在职
    mkParticipant({ memberId: 'temp1', name: '钱七', isTemporary: true }), // 临时人员
  ],
});
// M2：5月党小组会（李四借调中、王五在职）
const m2 = mkMeeting({
  id: 'mt2', date: '2025-05-15',
  type: ['党小组会'],
  partyGroups: ['第一党小组'],
  participants: [
    mkParticipant({ memberId: 'm1', name: '张三' }),
    mkParticipant({ memberId: 'm2', name: '李四' }),   // 借调期间：不计入
    mkParticipant({ memberId: 'm3', name: '王五' }),   // 调离前：计入
  ],
});
// M3：10月党课（李四已回归、王五已调离）
const m3 = mkMeeting({
  id: 'mt3', date: '2025-10-20',
  type: ['党课'],
  participants: [
    mkParticipant({ memberId: 'm1', name: '张三' }),
    mkParticipant({ memberId: 'm2', name: '李四', status: 'leave', leaveReason: '休假' }), // 回归后：计入
    mkParticipant({ memberId: 'm3', name: '王五' }),   // 调离后：不计入
  ],
});
const meetings = [m1, m2, m3];

// ==================== 断言工具 ====================

let passCount = 0;
let failCount = 0;
const failures: string[] = [];

function check(desc: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passCount++;
    console.log(`  ✓ ${desc}`);
  } else {
    failCount++;
    failures.push(`${desc}：期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
    console.log(`  ✗ ${desc}：期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
  }
}

function section(title: string): void {
  console.log(`\n=== ${title} ===`);
}

// ==================== 1. isActiveAt 时间线判定 ====================

section('1. isActiveAt 时间线在职判定');
check('李四 2025-02（借调前在职）', isActiveAt(members[1], '2025-02-10'), true);
check('李四 2025-05（借调中不计）', isActiveAt(members[1], '2025-05-15'), false);
check('李四 2025-10（回归后计入）', isActiveAt(members[1], '2025-10-20'), true);
check('王五 2025-05（调离前在职）', isActiveAt(members[2], '2025-05-15'), true);
check('王五 2025-10（调离后不计）', isActiveAt(members[2], '2025-10-20'), false);
check('张三任意日期在职', isActiveAt(members[0], '2025-10-20'), true);
check('无历史+当前离职 → false', isActiveAt(mkMember({ id: 'x', name: 'x', status: 'resigned' }), '2025-01-01'), false);

// ==================== 2. typeMeetingUnits / meetingTotalUnits 套会计次 ====================

section('2. 套会拆开计次');
check('M1 党小组会计 3 次', typeMeetingUnits(m1, '党小组会'), 3);
check('M1 支部党员大会计 1 次', typeMeetingUnits(m1, '支部党员大会'), 1);
check('未关联党小组的党小组会计 1 次', typeMeetingUnits(mkMeeting({ id: 'y', date: '2025-01-01', type: ['党小组会'] }), '党小组会'), 1);
check('M1 总计 6 次（1+3+1+1）', meetingTotalUnits(m1), 6);
check('M2 总计 1 次', meetingTotalUnits(m2), 1);
check('M3 总计 1 次', meetingTotalUnits(m3), 1);
check('年度会议总数 = 8', meetings.reduce((s, m) => s + meetingTotalUnits(m), 0), 8);

// ==================== 3. countActiveAttendance 时间线出勤口径 ====================

section('3. countActiveAttendance（应到/实到/请假/缺席）');
const a1 = countActiveAttendance(m1, members);
check('M1：应到3（张三+李四+王五，临时钱七不计）', a1.shouldAttend, 3);
check('M1：实到2', a1.attended, 2);
check('M1：请假1', a1.leave, 1);
check('M1：缺席0', a1.absent, 0);
const a2 = countActiveAttendance(m2, members);
check('M2：应到2（李四借调不计）', a2.shouldAttend, 2);
check('M2：实到2', a2.attended, 2);
const a3 = countActiveAttendance(m3, members);
check('M3：应到2（王五调离不计）', a3.shouldAttend, 2);
check('M3：实到1（李四请假）', a3.attended, 1);
check('M3：请假1', a3.leave, 1);
const all = meetings.map((m) => countActiveAttendance(m, members));
check('年度平均出勤率 = 5/7', (all.reduce((s, x) => s + x.attended, 0) / all.reduce((s, x) => s + x.shouldAttend, 0) * 100).toFixed(1), '71.4');

// ==================== 4. membersActiveDuring 统计行范围 ====================

section('4. membersActiveDuring（时间线口径行范围）');
const scoped = membersActiveDuring(members, meetings).map((m) => m.name);
check('行范围含张三/李四/王五/赵六（赵六在职）', scoped, ['张三', '李四', '王五', '赵六']);
check('无会议时空范围', membersActiveDuring(members, []).length, 0);

// ==================== 5. Excel 台账端到端（结构/口径/名单排版） ====================

section('5. Excel 台账导出');

// 模拟浏览器下载环境
const captured: { name: string; data: Uint8Array }[] = [];
(globalThis as Record<string, unknown>).document = {
  createElement: () => {
    const el: Record<string, unknown> = {
      href: '',
      download: '',
      click() {
        captured.push({ name: String(el.download), data: (el.__blob as Uint8Array) });
      },
    };
    return el;
  },
};
(globalThis as Record<string, unknown>).URL = {
  createObjectURL: (blob: Blob) => {
    // 记录到 pending，click 时通过闭包关联——这里简化：暂存最新 blob
    (globalThis as Record<string, unknown>).__pendingBlob = blob;
    return 'blob:mock';
  },
  revokeObjectURL: () => {},
};

// 注：exportExcel 使用 a.href = url; a.download = name; a.click()
// 为捕获文件内容，重写 createElement 让 click 前 url→blob 映射可用
const origCreate = (globalThis as Record<string, unknown>).document.createElement;
(globalThis as Record<string, unknown>).document.createElement = () => {
  const el: Record<string, unknown> = {
    _href: '',
    _download: '',
    set href(v: string) { el._href = v; },
    get href() { return el._href as string; },
    set download(v: string) { el._download = v; },
    get download() { return el._download as string; },
    click() {
      const blob = (globalThis as Record<string, unknown>).__pendingBlob as Blob;
      // Blob.arrayBuffer 是异步的——同步捕获改为在 URL.createObjectURL 里缓存 arrayBuffer 不可行，
      // 改为：在 click 里触发异步导出任务
      blob.arrayBuffer().then((buf) => {
        captured.push({ name: String(el._download), data: new Uint8Array(buf) });
        (globalThis as Record<string, unknown>).__excelReady = true;
      });
    },
  };
  return el;
};
void origCreate;

async function main() {
  const { exportAnnualLedger } = await import('../src/utils/exportExcel');
  await exportAnnualLedger('2025-01-01', '2025-12-31', meetings, members);
  // 等待异步 click 内的 arrayBuffer 完成
  for (let i = 0; i < 50 && captured.length === 0; i++) {
    await new Promise((r) => setTimeout(r, 50));
  }

  const XLSX = await import('xlsx-js-style');
  const file = captured[0];
  check('生成了台账文件（党建工作台账_2025年.xlsx）', file?.name, '党建工作台账_2025年.xlsx');
  const wb = XLSX.read(file.data, { type: 'array' });
  const sheetNames = wb.SheetNames;
  check('Sheet 顺序（明细→支委会无→党员大会→3个党小组会→党课→组织生活会无→民主生活会无→党日活动→考勤→月度→类型）',
    sheetNames,
    ['会议记录明细', '党员大会', '第一党小组会', '第二党小组会', '第三党小组会', '党课', '主题党日活动', '参会考勤统计', '月度汇总', '会议类型统计']);

  // --- 会议记录明细：M1 行口径与名单分栏 ---
  const wsMain = wb.Sheets['会议记录明细'];
  const mainAoA = XLSX.utils.sheet_to_json<string[]>(wsMain, { header: 1, blankrows: true });
  // 第4行（索引3）为 M1（按日期升序 02-10 在前）
  const m1Row = mainAoA[3];
  check('M1 应到 3', m1Row[11], 3);
  check('M1 实到 2', m1Row[12], 2);
  check('M1 请假 1', m1Row[13], 1);
  const list = String(m1Row[16]);
  check('M1 名单含参会段（出席+临时，顿号分隔）', list.includes('参会：张三、李四、钱七'), true);
  check('M1 名单含请假段（含原因）', list.includes('请假：王五(出差)'), true);
  check('M1 名单两段以换行分隔', list.includes('\n'), true);
  check('M1 名单不含缺席段', list.includes('缺席：'), false);
  // M3（10-20，第三行索引5）名单含请假+回归人员
  const m3Row = mainAoA[5];
  check('M3 应到 2（王五调离不计）', m3Row[11], 2);
  check('M3 名单请假段含李四', String(m3Row[16]).includes('请假：李四(休假)'), true);
  // 合计行（最后一行）
  const totalRow = mainAoA[mainAoA.length - 1];
  check('明细合计应到 7（3+2+2）', totalRow[11], 7);
  check('明细合计实到 5', totalRow[12], 5);

  // --- 主题党日子表：表头"活动内容" ---
  const wsDay = wb.Sheets['主题党日活动'];
  const dayAoA = XLSX.utils.sheet_to_json<string[]>(wsDay, { header: 1, blankrows: true });
  check('党日子表表头含"活动内容"', dayAoA[2].includes('活动内容'), true);
  check('党日子表表头不含"会议议题"', dayAoA[2].includes('会议议题'), false);
  // 非空行数 - 4（大标题+副标题+表头+合计行）= 数据记录数
  check('党日子表仅 1 条记录', dayAoA.filter((r) => r.length > 0).length - 4, 1);
  check('党日子表末行为合计行', dayAoA[dayAoA.length - 1][0], '合计');

  // --- 党课子表 ---
  const wsLecture = wb.Sheets['党课'];
  const lecAoA = XLSX.utils.sheet_to_json<string[]>(wsLecture, { header: 1, blankrows: true });
  check('党课子表含"会议议题"表头', lecAoA[2].includes('会议议题'), true);
  check('党课子表 2 条记录（M1+M3）', lecAoA.filter((r) => r.length > 0).length - 4, 2);
  check('党课子表末行为合计行', lecAoA[lecAoA.length - 1][0], '合计');

  // --- 参会考勤统计：时间线口径 ---
  const wsAtt = wb.Sheets['参会考勤统计'];
  const attAoA = XLSX.utils.sheet_to_json<string[]>(wsAtt, { header: 1, blankrows: true });
  const findAttRow = (name: string) => attAoA.find((r) => r[1] === name);
  const zhang = findAttRow('张三');
  check('张三：应参加 3', zhang?.[4], 3);
  check('张三：出席 3', zhang?.[5], 3);
  check('张三：出勤率 100.0%', zhang?.[8], '100.0%');
  const li = findAttRow('李四');
  check('李四：应参加 2（借调期间5月会议剔除）', li?.[4], 2);
  check('李四：出席 1（2月出席、10月请假）', li?.[5], 1);
  check('李四：请假 1', li?.[6], 1);
  check('李四：出勤率 50.0%', li?.[8], '50.0%');
  const wang = findAttRow('王五');
  check('王五：应参加 2（调离后10月会议剔除）', wang?.[4], 2);
  check('王五：出席 1', wang?.[5], 1);
  check('王五：请假 1', wang?.[6], 1);
  check('赵六在统计行内（应参加 0）', findAttRow('赵六')?.[4], 0);

  // --- 月度汇总：套会计次 + 时间线口径 ---
  const wsMonth = wb.Sheets['月度汇总'];
  const monthAoA = XLSX.utils.sheet_to_json<string[]>(wsMonth, { header: 1, blankrows: true });
  const febRow = monthAoA.find((r) => r[0] === '2月');
  check('2月会议次数 = 6（套会拆开）', febRow?.[1], 6);
  check('2月累计应到 = 3', febRow?.[2], 3);
  check('2月累计实到 = 2', febRow?.[3], 2);
  const mayRow = monthAoA.find((r) => r[0] === '5月');
  check('5月会议次数 = 1', mayRow?.[1], 1);
  check('5月累计应到 = 2', mayRow?.[2], 2);
  const octRow = monthAoA.find((r) => r[0] === '10月');
  check('10月会议次数 = 1', octRow?.[1], 1);
  check('10月累计应到 = 2', octRow?.[2], 2);
  const sumRow = monthAoA[monthAoA.length - 1];
  check('月度合计会议次数 = 8（= 看板会议总数）', sumRow?.[1], 8);
  check('月度合计应到 = 7', sumRow?.[2], 7);
  check('月度合计实到 = 5', sumRow?.[3], 5);

  // --- 会议类型统计：套会拆开计次 ---
  const wsType = wb.Sheets['会议类型统计'];
  const typeAoA = XLSX.utils.sheet_to_json<string[]>(wsType, { header: 1, blankrows: true });
  const findTypeRow = (t: string) => typeAoA.find((r) => r[0] === t);
  check('党小组会计 4 次（M1 展开3 + M2 一次）', findTypeRow('党小组会')?.[1], 4);
  check('党课计 2 次', findTypeRow('党课')?.[1], 2);
  check('支部党员大会计 1 次', findTypeRow('支部党员大会')?.[1], 1);
  check('主题党日活动计 1 次', findTypeRow('主题党日活动')?.[1], 1);
  const typeTotalRow = typeAoA[typeAoA.length - 1];
  check('类型统计合计 = 8（= 看板会议总数）', typeTotalRow?.[1], 8);

  // ==================== 6. Word 看板报告导出 ====================

  section('6. Word 看板报告导出');
  const { exportDashboardReport } = await import('../src/utils/exportWord');
  const wordCaptured: { name: string; header: string }[] = [];
  (globalThis as Record<string, unknown>).document.createElement = () => {
    const el: Record<string, unknown> = {
      _download: '',
      set download(v: string) { el._download = v; },
      get download() { return el._download as string; },
      click() {
        const blob = (globalThis as Record<string, unknown>).__pendingBlob as Blob;
        blob.arrayBuffer().then((buf) => {
          const u8 = new Uint8Array(buf);
          wordCaptured.push({
            name: String(el._download),
            header: String.fromCharCode(...u8.slice(0, 2)),
          });
        });
      },
    };
    return el;
  };
  const stats = { totalMeetings: 8, avgAttendance: 71.4, activeMembers: 2, monthMeetings: 0 };
  const typeStats = [
    { name: '党小组会', value: 4 },
    { name: '党课', value: 2 },
    { name: '支部党员大会', value: 1 },
    { name: '主题党日活动', value: 1 },
  ];
  const monthStats = Array.from({ length: 12 }, (_, i) => ({
    month: `${i + 1}月`,
    count: i === 1 ? 6 : i === 4 ? 1 : i === 9 ? 1 : 0,
  }));
  const rankingData = [
    { name: '张三', rate: 100 },
    { name: '李四', rate: 50 },
    { name: '王五', rate: 50 },
  ];
  await exportDashboardReport(2025, stats, typeStats, monthStats, rankingData, meetings, members);
  for (let i = 0; i < 50 && wordCaptured.length === 0; i++) {
    await new Promise((r) => setTimeout(r, 50));
  }
  check('生成了 Word 报告文件', wordCaptured[0]?.name, '2025年度党建工作台账报告.docx');
  check('Word 文件为有效 docx（PK zip 头）', wordCaptured[0]?.header, 'PK');

  // ==================== 汇总 ====================

  console.log(`\n========== 测试汇总 ==========`);
  console.log(`通过：${passCount}  失败：${failCount}`);
  if (failures.length > 0) {
    console.log('失败项：');
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error('测试执行异常：', e);
  process.exit(1);
});
