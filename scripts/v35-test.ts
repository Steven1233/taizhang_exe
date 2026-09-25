/**
 * V3.5 数据驱动验证脚本
 * 覆盖：月度趋势系列纯函数（空白年份→空数组 / 各类型计次 / 套会拆分 / 年份过滤 / 无数据类型剔除）、
 *       版本号单一来源（package.json ↔ vite define 注入 ↔ Settings/backup）、单实例锁静态结构校验、
 *       V3.5.1 年份选择器数据驱动、V3.5.2 在职党员年度时点计数 + 出勤对比三维度统计、
 *       V3.5.3 组织架构模块（statusAt 时间线 + buildOrgChart 四层树）
 * 运行：V=$(node -p "JSON.stringify(require('./package.json').version)") && \
 *       npx esbuild scripts/v35-test.ts --bundle --platform=node --format=cjs \
 *         --define:__APP_VERSION__="$V" --outfile=/tmp/v35-test.cjs && node /tmp/v35-test.cjs
 * （backup.ts 引用构建期注入的 __APP_VERSION__，测试打包时以 package.json 版本注入，保持单一来源）
 */
// 注意：fake-indexeddb/auto 必须最先导入（backup.ts → db 的 Dexie 实例化需要 global.indexedDB）
import 'fake-indexeddb/auto';
import fs from 'fs';
import path from 'path';
import type { Meeting, Member } from '../src/types';
import { buildMonthStackSeries, buildDimensionAttendanceRates } from '../src/utils/chartSeries';
import { countActiveMembersAt, isActiveAt, statusAt } from '../src/utils/memberStatus';
import { buildOrgChart, ORG_UNGROUPED } from '../src/utils/orgChart';
import { APP_VERSION } from '../src/utils/backup';

// ==================== 断言工具 ====================

let pass = 0;
let fail = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.error(`  ✗ ${label}\n      期望: ${JSON.stringify(expected)}\n      实际: ${JSON.stringify(actual)}`); }
}

function readProjectFile(rel: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), rel), 'utf-8');
}

// ==================== 测试数据 ====================

const mkMeeting = (over: Partial<Meeting> & { id: string; date: string }): Meeting => ({
  name: '', type: ['党课'], partyGroups: [], time: '09:00 - 10:00', location: '党员活动室',
  host: '张三', recorder: '李四', topic: '测试议题', summary: '', resolution: '',
  participants: [], createdAt: '2025-01-01T00:00:00', updatedAt: '2025-01-01T00:00:00',
  ...over,
});

const mkMember = (over: Partial<Member> & { id: string; name: string }): Member => ({
  title: '', department: '', phone: '', status: 'active', partyGroup: '', isGroupLeader: false,
  committeeRole: '', createdAt: '2024-01-15T00:00:00', updatedAt: '2024-01-15T00:00:00',
  statusHistory: [{ status: 'active', date: '2024-01-15' }],
  ...over,
});

// ==================== [1] 月度趋势系列纯函数（V3.5 功能 1 根因场景） ====================

function testBuildMonthStackSeries() {
  console.log('\n[1] buildMonthStackSeries：空白年份 → 空数组（图表残留根因场景）');
  const meetings = [
    mkMeeting({ id: 'a1', date: '2025-02-10', type: ['党课'] }),
    mkMeeting({ id: 'a2', date: '2025-05-01', type: ['党课'] }),
  ];
  check('空白年份返回空数组', buildMonthStackSeries(meetings, 2024).length, 0);
  check('全量会议为空 → 空数组', buildMonthStackSeries([], 2025).length, 0);

  console.log('\n[2] buildMonthStackSeries：有数据年份 → 各类型正确计次');
  const data2025 = buildMonthStackSeries(meetings, 2025);
  check('系列数 = 1（仅党课）', data2025.length, 1);
  check('系列名称', data2025.map((s) => s.name), ['党课']);
  check('党课月度分布（2月1次、5月1次）', data2025[0].data, [0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0]);

  const mixed = [
    ...meetings,
    mkMeeting({ id: 'a3', date: '2025-05-20', type: ['党课'] }),
    mkMeeting({ id: 'a4', date: '2025-03-15', type: ['支部委员会'] }),
  ];
  const mixedSeries = buildMonthStackSeries(mixed, 2025);
  check('混合类型系列数 = 2', mixedSeries.length, 2);
  check('系列顺序按 MEETING_TYPES 定义序', mixedSeries.map((s) => s.name), ['支部委员会', '党课']);
  check('党课月度分布（2月1次、5月2次）', mixedSeries[1].data, [0, 1, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0]);
  check('支部委员会月度分布（3月1次）', mixedSeries[0].data, [0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  check('系列结构（stack=total / 12 个月）', { stack: mixedSeries[0].stack, len: mixedSeries[0].data.length }, { stack: 'total', len: 12 });

  console.log('\n[3] buildMonthStackSeries：套会拆分计数（1 记录 3 党小组 → 党小组会计次 3）');
  const nestedMeetings = [
    mkMeeting({ id: 'a5', date: '2025-06-10', type: ['支部党员大会', '党小组会'], partyGroups: ['第一党小组', '第二党小组', '第三党小组'] }),
  ];
  const nestedSeries = buildMonthStackSeries(nestedMeetings, 2025);
  check('套会产生 2 个系列', nestedSeries.map((s) => s.name), ['支部党员大会', '党小组会']);
  check('党小组会计次 = 3（按关联党小组数展开）', nestedSeries[1].data[5], 3);

  console.log('\n[4] buildMonthStackSeries：年份过滤（其他年份会议不计入）');
  const crossYear = [
    mkMeeting({ id: 'a6', date: '2024-12-31', type: ['党课'] }),
    mkMeeting({ id: 'a7', date: '2025-01-01', type: ['党课'] }),
    mkMeeting({ id: 'a8', date: '2026-01-01', type: ['组织生活会'] }),
  ];
  const crossSeries = buildMonthStackSeries(crossYear, 2025);
  check('仅当年会议计入（系列=党课，1月1次）', crossSeries.map((s) => [s.name, ...s.data.slice(0, 1)]), [['党课', 1]]);

  console.log('\n[5] buildMonthStackSeries：全年无数据的类型剔除');
  const partialYear = buildMonthStackSeries(crossYear, 2026);
  check('2026 仅组织生活会 1 个系列', partialYear.map((s) => s.name), ['组织生活会']);
  check('组织生活会 1 月计次 1', partialYear[0].data[0], 1);
}

// ==================== [2] 版本号单一来源（V3.5 功能 2） ====================

function testVersionSingleSource() {
  console.log('\n[6] 版本号单一来源：注入值 = package.json');
  const pkg = JSON.parse(readProjectFile('package.json'));
  check('package.json version 为合法 semver', /^\d+\.\d+\.\d+$/.test(pkg.version), true);
  check('backup.ts APP_VERSION = 注入值', APP_VERSION, pkg.version);
  check('APP_VERSION 与 package.json 一致', APP_VERSION, pkg.version);

  console.log('\n[7] 源码静态校验：注入链路各环节到位、无残留硬编码');
  const viteCfg = readProjectFile('vite.config.ts');
  check('vite.config.ts 含 __APP_VERSION__ define 注入', viteCfg.includes('__APP_VERSION__: JSON.stringify(pkg.version)'), true);
  const settings = readProjectFile('src/pages/Settings.tsx');
  check('Settings.tsx 底部使用 __APP_VERSION__', settings.includes('v{__APP_VERSION__}'), true);
  check('Settings.tsx 无硬编码旧版本号 v3.1', /v3\.\d/.test(settings), false);
  const backupSrc = readProjectFile('src/utils/backup.ts');
  check('backup.ts APP_VERSION 引用注入值', backupSrc.includes('export const APP_VERSION = __APP_VERSION__'), true);
  check('backup.ts 无硬编码版本字面量', /'3\.\d\.\d'/.test(backupSrc), false);
}

// ==================== [3] 单实例锁静态结构校验（V3.5 功能 3） ====================

function testSingleInstanceLock() {
  console.log('\n[8] main.cjs 单实例锁代码结构（沙箱无法起 Electron，走包含性校验）');
  const mainCjs = readProjectFile('electron/main.cjs');
  check('调用 requestSingleInstanceLock', mainCjs.includes('app.requestSingleInstanceLock()'), true);
  check('第二实例分支静默退出 app.quit()', /if \(!gotTheLock\) \{[\s\S]*?app\.quit\(\);[\s\S]*?\} else \{/.test(mainCjs), true);
  check('监听 second-instance 事件', mainCjs.includes("app.on('second-instance'"), true);
  check('聚焦逻辑：最小化则还原', mainCjs.includes('isMinimized()) mainWindow.restore()'), true);
  check('聚焦逻辑：window.focus()', mainCjs.includes('mainWindow.focus()'), true);
  check('窗口生命周期仍由持锁实例管理（whenReady 在 else 分支内）', /else \{[\s\S]*?app\.whenReady\(\)\.then\(createWindow\);/.test(mainCjs), true);
}

// ==================== [4] 年份选择器数据驱动（V3.5.1 修复） ====================

function testYearOptionsDataDriven() {
  console.log('\n[9] Dashboard 年份选项数据驱动（修复：固定窗口选不到数据中的未来年份，如 2031）');
  const dash = readProjectFile('src/pages/Dashboard.tsx');
  check('无固定 10 项年份窗口（getFullYear() - 5 硬编码已移除）', dash.includes('getFullYear() - 5'), false);
  check('会议日期参与选项构造（meetings.map((m) => m.date)）', dash.includes('meetings.map((m) => m.date)'), true);
  check('谈心谈话日期参与选项构造（talks.map((t) => t.talkDate)）', dash.includes('talks.map((t) => t.talkDate)'), true);
  check('保留默认窗口（当前年 -5 ～ +4 前瞻）', dash.includes('i <= 4') && dash.includes('i = -5'), true);
  check('脏日期防御（Number.isInteger + 年份下限 1900）', dash.includes('Number.isInteger(y) && y >= 1900'), true);
  check('Select 选项改用 yearOptions', dash.includes('options={yearOptions}'), true);
}

// ==================== [5] 在职党员年度时点计数（V3.5.2 功能 1） ====================

function testCountActiveMembersAt() {
  console.log('\n[10] countActiveMembersAt：年度时点在职计数（年末口径 + 入库时点判定）');
  const members: Member[] = [
    mkMember({ id: 'm1', name: '张三' }),  // 创始在职
    mkMember({ id: 'm2', name: '李四', statusHistory: [{ status: 'active', date: '2025-01-06' }], createdAt: '2025-01-06T00:00:00' }),  // 中途入职
    mkMember({ id: 'm3', name: '王五', status: 'transferred', statusHistory: [{ status: 'active', date: '2024-01-15' }, { status: 'transferred', date: '2024-11-20' }] }),
    mkMember({ id: 'm4', name: '赵六', statusHistory: [{ status: 'active', date: '2024-01-15' }, { status: 'seconded', date: '2025-03-10' }, { status: 'active', date: '2025-09-01' }] }),  // 借调回归
    mkMember({ id: 'm5', name: '钱七', statusHistory: [{ status: 'active', date: '2024-01-15' }, { status: 'resigned', date: '2026-01-20' }] }),
    mkMember({ id: 'm6', name: '孙八', status: 'transferred', statusHistory: [{ status: 'transferred', date: '2024-06-01' }] }),  // 入库即调离
    mkMember({ id: 'm7', name: '周九', status: 'active', statusHistory: undefined }),  // 无状态历史
  ];

  check('2024-12-31 = 4（李四未入职、王五已调离、孙八入库即调离均不计）', countActiveMembersAt(members, '2024-12-31'), 4);
  check('2025-06-30 = 4（李四已入职、赵六借调期间不计）', countActiveMembersAt(members, '2025-06-30'), 4);
  check('2025-12-31 = 5（赵六借调回归恢复计入）', countActiveMembersAt(members, '2025-12-31'), 5);
  check('2026-12-31 = 4（钱七已离职）', countActiveMembersAt(members, '2026-12-31'), 4);
  check('早于全员入库日期 → 0', countActiveMembersAt(members, '2024-01-01'), 0);
  check('入库即调离：入库当日即调离不计', countActiveMembersAt([members[5]], '2024-06-01'), 0);
  check('无状态历史按当前状态兜底（在职计 1）', countActiveMembersAt([members[6]], '2025-01-01'), 1);
  check('无状态历史 + 创建日期晚于参考时点不计', countActiveMembersAt([{ ...members[6], createdAt: '2025-06-02T00:00:00' }], '2025-01-01'), 0);

  console.log('\n[11] countActiveMembersAt：测试数据备份集成校验（46 人名单）');
  let backup: { tables: { members: { data: Member[] } } };
  try {
    backup = JSON.parse(readProjectFile('党建工作台账_测试数据备份.json'));
  } catch {
    check('测试数据备份文件存在且可解析', false, true);
    return;
  }
  const roster = backup.tables.members.data;
  check('备份人员 46 名', roster.length, 46);
  check('2024 年末在职 41 人（5 人不计：3 未入职 + 2 已调离）', countActiveMembersAt(roster, '2024-12-31'), 41);
  check('2025 年末在职 41 人（4 调离/离职 + 1 未入职不计）', countActiveMembersAt(roster, '2025-12-31'), 41);
  check('2026 年末在职 40 人（6 调离/借调/离职不计）', countActiveMembersAt(roster, '2026-12-31'), 40);
  check('2031 年末在职 40 人（无更晚状态变更，按最后已知状态）', countActiveMembersAt(roster, '2031-12-31'), 40);
}

// ==================== [6] 出勤对比三维度统计（V3.5.2 功能 2） ====================

function testBuildDimensionAttendanceRates() {
  console.log('\n[12] buildDimensionAttendanceRates：基础聚合与排序');
  const m1 = mkMember({ id: 'p1', name: '张三', department: '综合管理部', title: '综合科', partyGroup: '第一党小组' });
  const m2 = mkMember({ id: 'p2', name: '李四', department: '综合管理部', title: '综合科', partyGroup: '第一党小组' });
  const m3 = mkMember({ id: 'p3', name: '王五', department: '财务部', title: '会计科', partyGroup: '第二党小组' });
  const meeting1 = mkMeeting({
    id: 't1', date: '2025-05-10', type: ['党课'],
    participants: [
      { memberId: 'p1', name: '张三', status: 'attended', isTemporary: false },
      { memberId: 'p2', name: '李四', status: 'leave', isTemporary: false, leaveReason: '出差' },
      { memberId: 'p3', name: '王五', status: 'attended', isTemporary: false },
    ],
  });

  const dept = buildDimensionAttendanceRates([meeting1], [m1, m2, m3], 'department');
  check('部门维度 2 个类目，按出勤率降序', dept.map((d) => d.name), ['财务部', '综合管理部']);
  check('财务部 100%（出席1/应到1）', dept[0], { name: '财务部', attended: 1, total: 1, rate: 100 });
  check('综合管理部 50%（出席1/应到2，请假计未出席）', dept[1], { name: '综合管理部', attended: 1, total: 2, rate: 50 });

  const title = buildDimensionAttendanceRates([meeting1], [m1, m2, m3], 'title');
  check('部室维度：会计科 100%、综合科 50%', title, [
    { name: '会计科', attended: 1, total: 1, rate: 100 },
    { name: '综合科', attended: 1, total: 2, rate: 50 },
  ]);

  console.log('\n[13] buildDimensionAttendanceRates：快照优先与回退');
  const moved = mkMember({ id: 'p1', name: '张三', partyGroup: '第二党小组', department: '市场部' });  // 当前已从一组/综合管理部调出
  const snapMeeting = mkMeeting({
    id: 't2', date: '2025-05-10', type: ['党小组会'],
    participants: [{ memberId: 'p1', name: '张三', status: 'attended', isTemporary: false, partyGroupSnapshot: '第一党小组', departmentSnapshot: '综合管理部' }],
  });
  check('党小组快照优先（计入第一党小组而非当前第二党小组）', buildDimensionAttendanceRates([snapMeeting], [moved], 'partyGroup').map((d) => d.name), ['第一党小组']);
  check('部门快照优先（计入综合管理部而非当前市场部）', buildDimensionAttendanceRates([snapMeeting], [moved], 'department').map((d) => d.name), ['综合管理部']);

  const legacyMeeting = mkMeeting({
    id: 't3', date: '2025-05-10', type: ['党小组会'],
    participants: [{ memberId: 'p1', name: '张三', status: 'attended', isTemporary: false }],  // 旧数据无快照
  });
  check('旧数据无快照回退当前党小组', buildDimensionAttendanceRates([legacyMeeting], [moved], 'partyGroup').map((d) => d.name), ['第二党小组']);

  console.log('\n[14] buildDimensionAttendanceRates：口径排除规则');
  const noGroup = mkMember({ id: 'p4', name: '赵六', department: '法务部', partyGroup: '' });
  const noGroupMeeting = mkMeeting({
    id: 't4', date: '2025-05-10', type: ['党课'],
    participants: [{ memberId: 'p4', name: '赵六', status: 'attended', isTemporary: false }],
  });
  check('未编组人员不计入党小组维度', buildDimensionAttendanceRates([noGroupMeeting], [noGroup], 'partyGroup'), []);
  check('未编组人员计入部门维度（法务部）', buildDimensionAttendanceRates([noGroupMeeting], [noGroup], 'department').map((d) => d.name), ['法务部']);

  const committeeMeeting = mkMeeting({
    id: 't5', date: '2025-05-10', type: ['支部委员会'],
    participants: [{ memberId: 'p1', name: '张三', status: 'attended', isTemporary: false }],
  });
  check('支委会不计入维度出勤', buildDimensionAttendanceRates([committeeMeeting], [m1], 'department'), []);
  const suiteMeeting = mkMeeting({
    id: 't6', date: '2025-05-10', type: ['支部党员大会', '支部委员会'],
    participants: [{ memberId: 'p1', name: '张三', status: 'attended', isTemporary: false }],
  });
  check('套会含支委会整条不计入', buildDimensionAttendanceRates([suiteMeeting], [m1], 'department'), []);

  const secondedM = mkMember({ id: 'p5', name: '钱七', department: '审计部', statusHistory: [{ status: 'active', date: '2024-01-15' }, { status: 'seconded', date: '2025-01-01' }] });
  const secondedMeeting = mkMeeting({
    id: 't7', date: '2025-06-01', type: ['党课'],
    participants: [{ memberId: 'p5', name: '钱七', status: 'attended', isTemporary: false }],
  });
  check('借调期间不计入', buildDimensionAttendanceRates([secondedMeeting], [secondedM], 'department'), []);

  const guestMeeting = mkMeeting({
    id: 't8', date: '2025-05-10', type: ['党课'],
    participants: [{ memberId: 'p1', name: '张三', status: 'attended', isTemporary: false, isGuest: true }],
  });
  check('列席计入出席', buildDimensionAttendanceRates([guestMeeting], [m1], 'department')[0].attended, 1);

  const tempMeeting = mkMeeting({
    id: 't9', date: '2025-05-10', type: ['党课'],
    participants: [{ memberId: 'temp_abc123', name: '外单位王林', status: 'attended', isTemporary: true }],
  });
  check('临时人员不计入', buildDimensionAttendanceRates([tempMeeting], [m1], 'department'), []);
  check('无会议 → 空数组', buildDimensionAttendanceRates([], [m1], 'partyGroup'), []);
}

// ==================== [7] V3.5.2 静态结构校验 ====================

function testV352Static() {
  console.log('\n[15] V3.5.2 静态结构校验（Dashboard 口径 / 快照链路 / Word 标签）');
  const dash = readProjectFile('src/pages/Dashboard.tsx');
  check('在职党员总数使用 countActiveMembersAt', dash.includes('countActiveMembersAt(members, activeRefDate)'), true);
  check('参考时点：当前年=当天、其他年=年末', dash.includes('year === currentYear ? todayStr : `${year}-12-31`'), true);
  check('维度状态默认党小组', dash.includes("useState<AttendanceDimension>('partyGroup')"), true);
  check('出勤对比调用 buildDimensionAttendanceRates', dash.includes('buildDimensionAttendanceRates(yearMeetings, members, dim)'), true);
  check('Segmented 三维度切换项', dash.includes("{ label: '党小组', value: 'partyGroup' }") && dash.includes("{ label: '部室', value: 'title' }") && dash.includes("{ label: '部门/支部', value: 'department' }"), true);
  check('旧部门统计实现已移除（deptChartData 无残留）', dash.includes('deptChartData'), false);

  const meetingsPage = readProjectFile('src/pages/Meetings.tsx');
  check('保存会议时写党小组快照', meetingsPage.includes('partyGroupSnapshot: p.partyGroupSnapshot ?? (m.partyGroup || \'\')'), true);
  const form = readProjectFile('src/components/MeetingForm.tsx');
  check('复用记录时清除党小组快照', form.includes('delete copy.partyGroupSnapshot'), true);
  const word = readProjectFile('src/utils/exportWord.ts');
  check('Word 报告「在职党员」标签带年度时点', word.includes('在职党员（${year}年末）'), true);
}

// ==================== [8] statusAt 时间线状态判定（V3.5.3） ====================

function testStatusAt() {
  console.log('\n[16] statusAt：时间线具体状态判定（组织架构口径）');
  const m = mkMember({
    id: 'sa1', name: '赵六',
    statusHistory: [
      { status: 'active', date: '2024-01-01' },
      { status: 'seconded', date: '2025-01-01' },
      { status: 'active', date: '2025-06-01' },
    ],
  });
  check('无状态历史 → 当前状态兜底', statusAt(mkMember({ id: 'sa2', name: '无历史', status: 'seconded', statusHistory: undefined }), '2025-01-01'), 'seconded');
  check('在职期间 = active', statusAt(m, '2024-06-01'), 'active');
  check('借调期间 = seconded', statusAt(m, '2025-03-01'), 'seconded');
  check('借调回归后 = active', statusAt(m, '2025-07-01'), 'active');
  check('早于首条 → 沿用首条状态', statusAt(m, '2023-06-01'), 'active');
  const t = mkMember({ id: 'sa3', name: '王五', status: 'transferred', statusHistory: [{ status: 'active', date: '2024-01-15' }, { status: 'transferred', date: '2024-11-20' }] });
  check('调离后 = transferred', statusAt(t, '2025-01-01'), 'transferred');

  console.log('\n[16b] statusAt 与 isActiveAt 等价性（active ⇔ true）');
  const dates = ['2023-06-01', '2024-06-01', '2025-03-01', '2025-07-01', '2026-01-01'];
  const eq = dates.every(
    (d) => (statusAt(m, d) === 'active') === isActiveAt(m, d) && (statusAt(t, d) === 'active') === isActiveAt(t, d)
  );
  check('多个时点两函数判定一致', eq, true);
}

// ==================== [9] 组织架构数据构建（V3.5.3） ====================

function testBuildOrgChart() {
  console.log('\n[17] buildOrgChart：四层结构与口径判定');
  const REF = '2026-06-30';
  const members: Member[] = [
    mkMember({ id: 'o1', name: '王建国', title: '会计科', committeeRole: '支部书记', partyGroup: '第一党小组' }),
    mkMember({ id: 'o2', name: '李明', title: '办公室', committeeRole: '支部副书记', partyGroup: '第二党小组' }),
    mkMember({ id: 'o3', name: '张丽', title: '综合科', committeeRole: '组织委员', partyGroup: '第二党小组', isGroupLeader: true }),
    mkMember({ id: 'o4', name: '张丽二', title: '综合科', committeeRole: '组织委员', partyGroup: '第二党小组' }),
    mkMember({ id: 'o5', name: '刘洋', title: '信息科', committeeRole: '宣传委员', partyGroup: '第一党小组', isGroupLeader: true }),
    mkMember({ id: 'o6', name: '陈晓', title: '信息科', committeeRole: '青年委员', partyGroup: '第三党小组', isGroupLeader: true }),
    mkMember({ id: 'o7', name: '孙芳', title: '会计科', partyGroup: '第一党小组' }),
    mkMember({ id: 'o8', name: '冯军', title: '人事科', partyGroup: '第一党小组', statusHistory: [{ status: 'active', date: '2024-01-15' }, { status: 'seconded', date: '2026-01-10' }] }),
    mkMember({ id: 'o9', name: '蒋明辉', title: '预警科', partyGroup: '第一党小组', status: 'transferred', statusHistory: [{ status: 'active', date: '2024-01-15' }, { status: 'transferred', date: '2025-06-01' }] }),
    mkMember({ id: 'o10', name: '沈明', title: '办公室', partyGroup: '' }),
  ];
  const d = buildOrgChart(members, REF);

  check('书记 1 人', d.secretaries.map((s) => s.name), ['王建国']);
  check('副书记 1 人', d.deputySecretaries.map((s) => s.name), ['李明']);
  check('支委按定义序（组织→宣传→青年）', d.committee.map((c) => c.role), ['组织委员', '宣传委员', '青年委员']);
  check('无人员职务不显示（纪检委员缺席）', d.committee.some((c) => c.role === '纪检委员'), false);
  check('同职务多人全列（组织委员 2 人）', d.committee[0].members.map((m) => m.name), ['张丽', '张丽二']);
  check('调离人员排除（汇总 9 人）', d.summary.total, 9);
  check('借调人员保留并标记', d.groups.find((g) => g.name === '第一党小组')!.members.some((m) => m.name === '冯军' && m.isSeconded), true);
  check('汇总：在职 8 借调 1', d.summary, { total: 9, active: 8, seconded: 1 });

  const g2 = d.groups.find((g) => g.name === '第二党小组')!;
  check('组长置顶（张丽为组长）', g2.leaders.map((m) => m.name), ['张丽']);
  check('人数 = 组长 + 组员', g2.count, g2.leaders.length + g2.members.length);
  const g1 = d.groups.find((g) => g.name === '第一党小组')!;
  check('组员带部室数据', g1.members.map((m) => m.title).includes('会计科'), true);

  const ug = d.groups.find((g) => g.ungrouped);
  check('未编组归集（沈明）', ug?.members.map((m) => m.name), ['沈明']);
  check('未编组节点名与排序最后', d.groups[d.groups.length - 1].name, ORG_UNGROUPED);

  console.log('\n[18] buildOrgChart：空态与空缺场景');
  check('空数据 → empty 且各层为空', buildOrgChart([], REF), { secretaries: [], deputySecretaries: [], committee: [], groups: [], summary: { total: 0, active: 0, seconded: 0 }, empty: true });
  const noSecretary = buildOrgChart([mkMember({ id: 'n1', name: '普通党员', partyGroup: '第一党小组' })], REF);
  check('书记空缺 → secretaries 为空（组件层显示空缺）', noSecretary.secretaries, []);
  check('无副书记 → 整层为空', noSecretary.deputySecretaries, []);
}

// ==================== [10] V3.5.3 静态结构校验 ====================

function testV353Static() {
  console.log('\n[19] V3.5.3 静态结构校验（Dashboard 集成 / 组件结构）');
  const dash = readProjectFile('src/pages/Dashboard.tsx');
  check('Dashboard 引入 OrgChart 组件', dash.includes("import OrgChart from '../components/OrgChart'"), true);
  check('Dashboard 底部渲染组织架构模块', dash.includes('<OrgChart members={members} />'), true);

  const comp = readProjectFile('src/components/OrgChart.tsx');
  check('组件默认收起（初始空 Set）', comp.includes('useState<Set<string>>(new Set())'), true);
  check('展开全部 / 收起全部按钮', comp.includes("'展开全部'") && comp.includes("'收起全部'"), true);
  check('数据构建走 buildOrgChart', comp.includes('buildOrgChart(members,'), true);
  check('书记空缺常显', comp.includes('vacant'), true);
  check('借调标签', comp.includes('借调'), true);
  check('组长标签与置顶', comp.includes('组长') && comp.includes('org-star'), true);
}

// ==================== 主流程 ====================

async function main() {
  console.log('========== V3.5 专项测试 ==========');
  testBuildMonthStackSeries();
  testVersionSingleSource();
  testSingleInstanceLock();
  testYearOptionsDataDriven();
  testCountActiveMembersAt();
  testBuildDimensionAttendanceRates();
  testV352Static();
  testStatusAt();
  testBuildOrgChart();
  testV353Static();

  console.log('\n========== 结果 ==========');
  console.log(`通过: ${pass}，失败: ${fail}`);
  if (fail > 0) process.exit(1);
}

void main();
