/**
 * 测试数据生成器：生成可通过「数据备份恢复」整库导入的测试备份（schemaVersion 3）
 *
 * 覆盖场景：
 * - 人员：4 种状态（在职/调离/借调/离职）、借调回归、借调未归、导入即调离、
 *         无 statusHistory 兜底、中途入职、部门调动（快照口径）、信息变更留痕、
 *         支委职务、党小组组长、空电话/空职务、空党小组（不编组）
 * - 会议：全部 9 种类型、套会（多类型单条）、党小组会多组联合/未关联、
 *         2024-2026 连续月份 + 2027/2031（验证 v3.5.1 年份选择器）、
 *         出勤/请假(含原因)/缺席/列席(isGuest)/临时人员(isTemporary)、
 *         部门快照（2026+ 有、2024/2025 无）、无名称会议
 * - 谈心谈话：3 种方式 × 6 种类型、单/多对象、上午/下午、五必谈、备注
 * - 操作日志：多种类型 + 成功/失败
 *
 * 运行：
 *   V=$(node -p "JSON.stringify(require('./package.json').version)") && \
 *   npx esbuild scripts/generate-test-data.ts --bundle --platform=node --format=cjs \
 *     --define:__APP_VERSION__="$V" --outfile=/tmp/gen-test-data.cjs && \
 *   node /tmp/gen-test-data.cjs
 */
import 'fake-indexeddb/auto';
import fs from 'fs';
import path from 'path';
import type { Member, Meeting, TalkRecord, OperationLog, Participant } from '../src/types';
import { MEETING_TYPES, PARTY_GROUPS } from '../src/types';
import { isActiveAt } from '../src/utils/memberStatus';
import { parseBackupFile } from '../src/utils/backup';

// ==================== 确定性随机（可复现） ====================

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20260912);
const ri = (min: number, max: number) => min + Math.floor(rnd() * (max - min + 1));
const pick = <T,>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)];

let uuidSeq = 0;
function uuid(prefix: string): string {
  uuidSeq++;
  const hex = () => Math.floor(rnd() * 16).toString(16);
  const seg = (n: number) => Array.from({ length: n }, hex).join('');
  return `${prefix}${uuidSeq}${seg(4)}-${seg(4)}-4${seg(3)}-${seg(4)}-${seg(8)}`;
}

const pad = (n: number) => String(n).padStart(2, '0');
const d = (y: number, m: number, day: number) => `${y}-${pad(m)}-${pad(day)}`;

// ==================== 组织架构定义 ====================

const DEPARTMENTS = [
  '综合管理部', '人力资源部', '财务部', '信息技术部', '市场部',
  '风险管理部', '审计部', '运营管理部', '法务部', '安全监管部',
];
// 部门 → 部室（细分科室）
const TITLES: Record<string, string[]> = {
  '综合管理部': ['综合科', '文书档案科', '行政科'],
  '人力资源部': ['人事科', '培训科'],
  '财务部': ['会计科', '预算科'],
  '信息技术部': ['系统运维科', '数据管理科'],
  '市场部': ['市场拓展科', '客户服务科'],
  '风险管理部': ['风险评估科', '合规科'],
  '审计部': ['内审科'],
  '运营管理部': ['运营调度科', '质量管理科'],
  '法务部': ['法律事务科'],
  '安全监管部': ['安全管理科'],
};

const GROUPS = ['第一党小组', '第二党小组', '第三党小组', '第四党小组', '第五党小组'];

// 46 人名单：(姓名, 部门, 党小组, 支委职务, 是否组长)
type RosterEntry = { name: string; dept: string; group: string; role: string; leader: boolean };
const ROSTER: RosterEntry[] = [
  // 支委班子（6）
  { name: '周建国', dept: '综合管理部', group: '第一党小组', role: '支部书记', leader: false },
  { name: '李红梅', dept: '人力资源部', group: '', role: '支部副书记', leader: false },
  { name: '王志强', dept: '财务部', group: '第二党小组', role: '组织委员', leader: false },
  { name: '赵雪梅', dept: '信息技术部', group: '第三党小组', role: '宣传委员', leader: false },
  { name: '陈刚', dept: '风险管理部', group: '第四党小组', role: '纪检委员', leader: false },
  { name: '刘洋', dept: '市场部', group: '第五党小组', role: '青年委员', leader: false },
  // 党小组组长（5）
  { name: '孙德华', dept: '综合管理部', group: '第一党小组', role: '', leader: true },
  { name: '钱丽华', dept: '财务部', group: '第二党小组', role: '', leader: true },
  { name: '张伟', dept: '信息技术部', group: '第三党小组', role: '', leader: true },
  { name: '吴桂英', dept: '审计部', group: '第四党小组', role: '', leader: true },
  { name: '严志刚', dept: '运营管理部', group: '第五党小组', role: '', leader: true },
  // 第一党小组（8）
  { name: '郑海涛', dept: '综合管理部', group: '第一党小组', role: '', leader: false },
  { name: '蒋明辉', dept: '市场部', group: '第一党小组', role: '', leader: false },
  { name: '何秀珍', dept: '人力资源部', group: '第一党小组', role: '', leader: false },
  { name: '许建军', dept: '安全监管部', group: '第一党小组', role: '', leader: false },
  { name: '张桂香', dept: '运营管理部', group: '第一党小组', role: '', leader: false },
  { name: '贺永强', dept: '综合管理部', group: '第一党小组', role: '', leader: false },
  { name: '龚丽萍', dept: '法务部', group: '第一党小组', role: '', leader: false },
  { name: '雷明', dept: '信息技术部', group: '第一党小组', role: '', leader: false },
  // 第二党小组（8）
  { name: '王秀兰', dept: '财务部', group: '第二党小组', role: '', leader: false },
  { name: '韩志远', dept: '财务部', group: '第二党小组', role: '', leader: false },
  { name: '秦晓东', dept: '市场部', group: '第二党小组', role: '', leader: false },
  { name: '白雪梅', dept: '人力资源部', group: '第二党小组', role: '', leader: false },
  { name: '朱国强', dept: '风险管理部', group: '第二党小组', role: '', leader: false },
  { name: '尤桂芳', dept: '审计部', group: '第二党小组', role: '', leader: false },
  { name: '施立新', dept: '财务部', group: '第二党小组', role: '', leader: false },
  { name: '曹丽娟', dept: '运营管理部', group: '第二党小组', role: '', leader: false },
  // 第三党小组（8）
  { name: '冯建军', dept: '信息技术部', group: '第三党小组', role: '', leader: false },
  { name: '孔祥明', dept: '信息技术部', group: '第三党小组', role: '', leader: false },
  { name: '沈玉兰', dept: '数据管理科' as string, group: '第三党小组', role: '', leader: false }, // 占位，下面会修正
  { name: '魏东升', dept: '信息技术部', group: '第三党小组', role: '', leader: false },
  { name: '陶春兰', dept: '市场部', group: '第三党小组', role: '', leader: false },
  { name: '顾建军', dept: '安全监管部', group: '第三党小组', role: '', leader: false },
  { name: '董国栋', dept: '信息技术部', group: '第三党小组', role: '', leader: false },
  { name: '金秀英', dept: '市场部', group: '第三党小组', role: '', leader: false },
  // 第四党小组（6）
  { name: '杨春花', dept: '审计部', group: '第四党小组', role: '', leader: false },
  { name: '吕国华', dept: '风险管理部', group: '第四党小组', role: '', leader: false },
  { name: '周文杰', dept: '法务部', group: '第四党小组', role: '', leader: false },
  { name: '马淑芬', dept: '运营管理部', group: '第四党小组', role: '', leader: false },
  { name: '黄志明', dept: '风险管理部', group: '第四党小组', role: '', leader: false },
  { name: '谢春燕', dept: '审计部', group: '第四党小组', role: '', leader: false },
  // 第五党小组（5）
  { name: '孙晓峰', dept: '市场部', group: '第五党小组', role: '', leader: false },
  { name: '吴海燕', dept: '运营管理部', group: '第五党小组', role: '', leader: false },
  { name: '郑雅琴', dept: '安全监管部', group: '第五党小组', role: '', leader: false },
  { name: '冯俊杰', dept: '市场部', group: '第五党小组', role: '', leader: false },
  { name: '杜凤英', dept: '运营管理部', group: '第五党小组', role: '', leader: false },
];
// 修正占位数据
ROSTER.find((r) => r.name === '沈玉兰')!.dept = '信息技术部';

// ==================== 人员生成 ====================

const FOUNDING_DATE = '2024-01-15';
/** 特殊状态时间线（姓名 → 变更序列）；未列出的初始成员默认 [active@2024-01-15] */
const SPECIAL_STATUS: Record<string, { status: Member['status']; date: string }[]> = {
  // 借调后回归
  '王秀兰': [
    { status: 'active', date: '2024-01-15' },
    { status: 'seconded', date: '2025-03-10' },
    { status: 'active', date: '2025-09-01' },
  ],
  // 借调未归
  '冯建军': [
    { status: 'active', date: '2024-01-15' },
    { status: 'seconded', date: '2026-01-06' },
  ],
  // 调离（不同时点）
  '蒋明辉': [
    { status: 'active', date: '2024-01-15' },
    { status: 'transferred', date: '2024-11-20' },
  ],
  '沈玉兰': [
    { status: 'active', date: '2024-01-15' },
    { status: 'transferred', date: '2025-06-15' },
  ],
  // 离职
  '杨春花': [
    { status: 'active', date: '2024-01-15' },
    { status: 'resigned', date: '2025-08-10' },
  ],
  '韩志远': [
    { status: 'active', date: '2024-01-15' },
    { status: 'resigned', date: '2026-01-20' },
  ],
  // 导入即调离（首条即非在职：调离前的会议不计在职，V3.4 口径）
  '孔祥明': [
    { status: 'transferred', date: '2024-06-01' },
  ],
};
/** 无 statusHistory 的成员（测试"无历史按当前状态判定"兜底） */
const NO_HISTORY = new Set(['郑海涛', '尤桂芳']);
/** 中途入职成员（姓名 → 入职日期，首条状态即入职日） */
const LATE_JOINERS: Record<string, string> = {
  '顾建军': '2025-01-06',
  '秦晓东': '2025-06-02',
  '白雪梅': '2026-03-02',
};
/** 部门调动（姓名 → 调动日期 + 新部门；用于部门快照口径测试） */
const DEPT_CHANGES: Record<string, { date: string; from: string; to: string }> = {
  '孙德华': { date: '2026-05-11', from: '综合管理部', to: '市场部' },
  '赵雪梅': { date: '2026-07-06', from: '信息技术部', to: '风险管理部' },
};

function buildMembers(): Member[] {
  return ROSTER.map((r) => {
    const id = uuid('m-');
    const isLate = LATE_JOINERS[r.name] !== undefined;
    const createdAt = isLate
      ? `${LATE_JOINERS[r.name]}T${pad(ri(8, 17))}:${pad(ri(0, 59))}:00.000Z`
      : `2024-01-15T${pad(ri(8, 17))}:${pad(ri(0, 59))}:00.000Z`;

    let statusHistory: Member['statusHistory'];
    if (NO_HISTORY.has(r.name)) {
      statusHistory = undefined; // 无历史兜底场景
    } else if (SPECIAL_STATUS[r.name]) {
      statusHistory = SPECIAL_STATUS[r.name];
    } else if (isLate) {
      statusHistory = [{ status: 'active', date: LATE_JOINERS[r.name] }];
    } else {
      statusHistory = [{ status: 'active', date: FOUNDING_DATE }];
    }

    const lastChange = statusHistory ? statusHistory[statusHistory.length - 1] : null;
    const status = lastChange ? lastChange.status : 'active';

    // 部门调动者的当前部门为调动后部门
    const deptChange = DEPT_CHANGES[r.name];
    const dept = deptChange ? deptChange.to : r.dept;

    // 信息变更留痕（部分成员）
    let changeHistory: Member['changeHistory'];
    if (deptChange) {
      changeHistory = [{ date: deptChange.date, field: '部门', oldValue: deptChange.from, newValue: deptChange.to }];
    } else if (r.name === '张桂香') {
      changeHistory = [
        { date: '2025-03-04', field: '党小组', oldValue: '第三党小组', newValue: '第一党小组' },
        { date: '2026-02-18', field: '联系电话', oldValue: '13812340001', newValue: '13998007766' },
      ];
    }

    return {
      id,
      name: r.name,
      title: pick(TITLES[dept] || TITLES[r.dept]),
      department: dept,
      phone: rnd() < 0.15 ? '' : `1${pick(['38', '39', '36', '58', '87'])}${String(ri(10000000, 99999999))}`,
      status,
      partyGroup: r.group,
      isGroupLeader: r.leader,
      committeeRole: r.role,
      statusHistory,
      changeHistory,
      createdAt,
      updatedAt: lastChange
        ? `${lastChange.date}T10:00:00.000Z`
        : (changeHistory ? `${changeHistory[changeHistory.length - 1].date}T10:00:00.000Z` : createdAt),
    } as Member;
  });
}

/** 会议时点部门（优先按调动时间线还原） */
function deptAt(member: Member, date: string): string {
  const ch = DEPT_CHANGES[member.name];
  if (ch) return date >= ch.date ? ch.to : ch.from;
  return member.department;
}

// ==================== 参会人员构建 ====================

const LEAVE_REASONS = ['出差', '事假', '病假', '年休假', '外出培训', '驻外执勤'];
const TEMP_NAMES = ['驻局纪检组张组长', '上级党委组织部刘干事', '兄弟支部观摩代表王林', '共建社区党委李书记'];

function buildParticipants(
  date: string,
  members: Member[],
  scope: Member[],
  opts: { withSnapshot: boolean; guestCount?: number; tempCount?: number }
): Participant[] {
  // scope 已按"时点在职"过滤；再排除时点尚未入职者
  const eligible = scope.filter((m) => isActiveAt(m, date) && m.createdAt.substring(0, 10) <= date);
  const guests = new Set(eligible.slice(0, opts.guestCount || 0).map((m) => m.id));

  const result: Participant[] = eligible.map((m) => {
    if (guests.has(m.id)) {
      return { memberId: m.id, name: m.name, status: 'attended' as const, isTemporary: false, isGuest: true };
    }
    const roll = rnd();
    let p: Participant;
    if (roll < 0.9) {
      p = { memberId: m.id, name: m.name, status: 'attended', isTemporary: false };
    } else if (roll < 0.97) {
      p = { memberId: m.id, name: m.name, status: 'leave', isTemporary: false, leaveReason: pick(LEAVE_REASONS) };
    } else {
      p = { memberId: m.id, name: m.name, status: 'absent', isTemporary: false };
    }
    if (opts.withSnapshot) {
      (p as Participant & { departmentSnapshot?: string }).departmentSnapshot = deptAt(m, date);
      (p as Participant & { titleSnapshot?: string }).titleSnapshot = m.title;
    }
    return p;
  });

  for (let i = 0; i < (opts.tempCount || 0); i++) {
    result.push({
      memberId: `temp_${Date.parse('2026-01-01')}_${Math.floor(rnd() * 1e8).toString(36)}`,
      name: pick(TEMP_NAMES),
      status: 'attended',
      isTemporary: true,
    });
  }
  return result;
}

// ==================== 会议生成 ====================

const LOCATIONS = ['党员活动室', '预警中心3楼5号会议室（党员之家）', '第一会议室', '第二会议室', '报告厅'];
const TIMES = ['09:00 - 10:30', '14:30 - 16:00', '10:00 - 12:00', '15:00 - 17:00', '09:30 - 11:30'];

const PARTY_DAY_NAMES: Record<number, string> = {
  1: '"回顾入党初心、展望新年征程"主题党日活动',
  2: '学习中央一号文件精神主题党日活动',
  3: '学雷锋志愿服务主题党日活动',
  4: '缅怀革命先烈主题党日活动',
  5: '劳动最光荣主题党日活动',
  6: '"迎七一·践初心"主题党日活动',
  7: '庆祝建党周年暨"七一"主题党日活动',
  8: '拥军优属主题党日活动',
  9: '抗战胜利纪念主题党日活动',
  10: '庆国庆主题党日活动',
  11: '廉洁家风主题党日活动',
  12: '年度总结评议主题党日活动',
};
const PARTY_CLASS_TOPICS: Record<number, string[]> = {
  2024: ['深入学习贯彻党的二十大精神专题党课', '党纪学习教育专题党课', '学习贯彻党的二十届三中全会精神专题党课'],
  2025: ['学习贯彻党的二十届三中全会精神解读专题党课', '深入贯彻中央八项规定精神专题党课', '学习新修订《中国共产党纪律处分条例》专题党课'],
  2026: ['学习党的创新理论专题党课', '深入贯彻中央八项规定精神学习教育专题党课', '学习贯彻党的二十届四中全会精神专题党课'],
  2027: ['新年度思想政治建设专题党课', '党建工作责任制专题党课'],
  2031: ['面向2035远景目标的思想动员专题党课', '全面从严治党组织建设专题党课'],
};
const COMMITTEE_TOPICS = [
  '研究支部月度重点工作安排、发展党员事宜及党费收缴情况',
  '研究"三会一课"计划落实、党员教育管理和积极分子培养考察事宜',
  '研究支部标准化建设、党员民主评议结果审核及整改措施',
  '研究意识形态工作、职工思想动态分析及帮困慰问事宜',
  '研究年度党建工作要点分解、责任清单及考核办法',
];
const OTHER_MEETING_NAMES = [
  '年度党建工作部署会', '巡察整改专题推进会', '意识形态工作分析研判会',
  '党建述职评议考核工作会议', '发展对象确定和培养考察工作会议',
];

function meetingBase(date: string, type: string[], name: string, host: string, recorder: string, topic: string): Meeting {
  return {
    id: uuid('mt-'),
    name,
    type,
    partyGroups: [],
    date,
    time: pick(TIMES),
    location: pick(LOCATIONS),
    host,
    recorder,
    topic,
    summary: '',
    resolution: '',
    participants: [],
    createdAt: `${date}T18:00:00.000Z`,
    updatedAt: `${date}T18:00:00.000Z`,
  };
}

function buildMeetings(members: Member[]): Meeting[] {
  const meetings: Meeting[] = [];
  const byName = (n: string) => members.find((m) => m.name === n)!;
  const secretary = byName('周建国');
  const deputy = byName('李红梅');
  const org = byName('王志强');
  const propa = byName('赵雪梅');
  const youth = byName('刘洋');
  const committee = members.filter((m) => m.committeeRole !== '');
  const leaders: Record<string, Member> = {};
  GROUPS.forEach((g) => { const l = members.find((m) => m.partyGroup === g && m.isGroupLeader); if (l) leaders[g] = l; });
  const youthGroup = members.filter((m) => ['孙晓峰', '吴海燕', '郑雅琴', '冯俊杰', '杜凤英', '刘洋', '雷明', '陶春兰', '金秀英', '顾建军', '秦晓东', '白雪梅'].includes(m.name));

  const all = (date: string, m: Meeting, opts: { guestCount?: number; tempCount?: number } = {}) => {
    m.participants = buildParticipants(date, members, members, {
      withSnapshot: date >= '2026-01-01',
      guestCount: opts.guestCount ?? (rnd() < 0.4 ? ri(1, 2) : 0),
      tempCount: opts.tempCount ?? (rnd() < 0.3 ? 1 : 0),
    });
  };

  // 各年份月度计划（month: 1-12；endMonth 控制当年生成到几月）
  const YEAR_PLANS: { year: number; endMonth: number; full: boolean }[] = [
    { year: 2024, endMonth: 12, full: true },
    { year: 2025, endMonth: 12, full: true },
    { year: 2026, endMonth: 9, full: true },
    { year: 2027, endMonth: 6, full: false },  // 稀疏年份（默认窗口外，验证年份选择器）
    { year: 2031, endMonth: 12, full: false }, // 远未来年份（v3.5.1 修复验证场景）
  ];

  let quarterClassIdx = 0;
  let otherIdx = 0;

  for (const plan of YEAR_PLANS) {
    const { year } = plan;
    const partyClassTopics = PARTY_CLASS_TOPICS[year];
    const anniversary = year - 1921;

    for (let month = 1; month <= plan.endMonth; month++) {
      // ---- 支委会（每月，day 5±2）----
      if (plan.full || month % 2 === 1) {
        const date = d(year, month, ri(4, 7));
        const m = meetingBase(date, ['支部委员会'], `${year}年${month}月支部委员会会议`,
          secretary.name, org.name, pick(COMMITTEE_TOPICS));
        m.resolution = '经支委会研究，同意按计划推进各项党建工作；党费收缴情况正常。';
        m.participants = buildParticipants(date, members, committee, { withSnapshot: date >= '2026-01-01' });
        meetings.push(m);
      }

      // ---- 主题党日（每月，day 12±3；季度月与党课套会）----
      if (plan.full || month === 3 || month === 6) {
        const isQuarter = month % 3 === 0;
        const date = d(year, month, ri(10, 15));
        const type = isQuarter ? ['主题党日活动', '党课'] : ['主题党日活动'];
        const name = month === 7
          ? `庆祝建党${anniversary}周年暨"七一"主题党日活动`
          : `${year}年${month}月${PARTY_DAY_NAMES[month]}`;
        const m = meetingBase(date, type, name, secretary.name, propa.name,
          isQuarter ? partyClassTopics[quarterClassIdx % partyClassTopics.length] : '落实"第一议题"制度，开展月度主题党日活动');
        if (isQuarter) quarterClassIdx++;
        all(date, m, { tempCount: isQuarter ? 1 : 0 });
        meetings.push(m);
      }

      // ---- 支部党员大会（3/7/12 月；7 月与党课、主题党日大套会）----
      if (plan.full ? [3, 7, 12].includes(month) : month === 3) {
        if (month === 7) continue; // 7 月套会由下方专门生成
        const date = d(year, month, ri(18, 24));
        const seq = month === 3 ? '一' : '二';
        const m = meetingBase(date, ['支部党员大会'], `${year}年第${seq}次支部党员大会`,
          secretary.name, org.name, month === 12 ? '审议支部年度工作总结、下年度工作计划及民主评议结果' : '传达上级党委决议，讨论表决支部重大事项');
        m.resolution = '大会表决通过支部工作报告及相关事项。';
        all(date, m, { tempCount: 1 });
        meetings.push(m);
      }

      // ---- 党小组会（完整年份：偶数月单组轮流、奇数月三组联合；稀疏年份少量）----
      if (plan.full && month % 2 === 0) {
        const group = GROUPS[(month / 2 - 1) % GROUPS.length];
        const date = d(year, month, ri(8, 20));
        const m = meetingBase(date, ['党小组会'], `${group}${year}年${month}月党小组学习会`,
          leaders[group].name, pick(members.filter((x) => x.partyGroup === group)).name,
          '集中学习党的创新理论，交流学习心得体会');
        m.partyGroups = [group];
        const scope = members.filter((x) => x.partyGroup === group);
        m.participants = buildParticipants(date, members, scope, {
          withSnapshot: date >= '2026-01-01',
          guestCount: rnd() < 0.3 ? 1 : 0,
        });
        meetings.push(m);
      }
      if (plan.full && month % 2 === 1) {
        const groups = month % 4 === 1
          ? [GROUPS[0], GROUPS[1], GROUPS[2]]
          : [GROUPS[3], GROUPS[4]];
        const date = d(year, month, ri(8, 20));
        const m = meetingBase(date, ['党小组会'],
          `${year}年${month}月${groups.map((g) => g.replace('党小组', '')).join('、')}党小组联合学习会`,
          leaders[groups[0]].name, pick(members.filter((x) => groups.includes(x.partyGroup))).name,
          '联合开展理论学习，交流党小组建设经验');
        m.partyGroups = groups;
        const scope = members.filter((x) => groups.includes(x.partyGroup));
        m.participants = buildParticipants(date, members, scope, { withSnapshot: date >= '2026-01-01' });
        meetings.push(m);
      }
      // 未关联党小组的党小组会（partyGroups 空数组边界场景，每年 2 条）
      if (plan.full && (month === 4 || month === 10)) {
        const date = d(year, month, ri(8, 20));
        const scope = members.filter((x) => x.partyGroup === GROUPS[4]);
        const m = meetingBase(date, ['党小组会'], `${year}年${month}月党小组集中学习`,
          leaders[GROUPS[4]].name, pick(scope).name, '集中学习党章党规，开展学习交流');
        m.partyGroups = []; // 未关联党小组（历史遗留数据形态）
        m.participants = buildParticipants(date, members, scope, { withSnapshot: date >= '2026-01-01' });
        meetings.push(m);
      }

      // ---- 青年理论学习小组（2/5/8/11 月）----
      if (plan.full && [2, 5, 8, 11].includes(month)) {
        const date = d(year, month, ri(14, 22));
        const q = Math.ceil(month / 3);
        const m = meetingBase(date, ['青年理论学习小组学习会'], `${year}年青年理论学习小组第${q}季度学习会`,
          youth.name, '孙晓峰', '开展青年理论学习，交流读书心得，研讨岗位建功行动');
        m.participants = buildParticipants(date, members, youthGroup, { withSnapshot: date >= '2026-01-01' });
        meetings.push(m);
      }

      // ---- 组织生活会（12 月）/ 民主生活会（1 月）----
      if (plan.full && month === 12) {
        const date = d(year, 12, ri(20, 27));
        const m = meetingBase(date, ['组织生活会'], `${year}年度组织生活会和民主评议党员`,
          secretary.name, org.name, '开展批评与自我批评，进行党员民主评议');
        m.summary = '全体党员逐一进行对照检查，开展相互批评，评议结果均为合格及以上。';
        all(date, m);
        meetings.push(m);
      }
      if (plan.full && month === 1) {
        const date = d(year, 1, ri(15, 22));
        const m = meetingBase(date, ['民主生活会'], `${year - 1}年度民主生活会`,
          secretary.name, deputy.name, '领导班子对照检查，开展批评与自我批评，制定整改措施');
        m.resolution = '形成整改清单 6 项，明确责任人和整改时限。';
        all(date, m);
        meetings.push(m);
      }

      // ---- 七一大套会（完整年份 7 月）：[支部党员大会, 党课, 主题党日活动] ----
      if (plan.full && month === 7) {
        const date = d(year, 7, 1);
        const m = meetingBase(date, ['支部党员大会', '党课', '主题党日活动'],
          `庆祝建党${anniversary}周年暨"七一"表彰大会`,
          secretary.name, propa.name, '重温入党誓词，表彰优秀共产党员，讲授"七一"专题党课');
        m.resolution = '大会表彰优秀共产党员 5 名，号召全体党员学习先进、争当先锋。';
        all(date, m, { tempCount: 1 });
        meetings.push(m);
      }

      // ---- 其他会议（每年 2-3 条）----
      if (plan.full && [3, 6, 11].includes(month)) {
        const date = d(year, month, ri(5, 25));
        const name = OTHER_MEETING_NAMES[otherIdx % OTHER_MEETING_NAMES.length];
        otherIdx++;
        const m = meetingBase(date, ['其他会议'], `${year}${name}`,
          pick([secretary.name, deputy.name]), propa.name, '部署推进党建工作重点任务');
        all(date, m);
        meetings.push(m);
      }
    }

    // ---- 少量无名称会议（name 为空，边界场景）----
    if (plan.full) {
      const date = d(year, 9, ri(5, 20));
      const m = meetingBase(date, ['党课'], '', secretary.name, propa.name, '形势政策教育专题辅导');
      all(date, m);
      meetings.push(m);
    }
  }

  // ---- 2031 年定向补充：各类型各 1 条（v3.5.1 年份选择器验证）----
  const y2031: { month: number; day: number; type: string[]; name: string }[] = [
    { month: 2, day: 20, type: ['支部委员会'], name: '2031年2月支部委员会会议' },
    { month: 4, day: 15, type: ['党小组会'], name: '第一党小组2031年4月党小组学习会' },
    { month: 5, day: 10, type: ['党课', '主题党日活动'], name: '2031年"五一"专题党课暨主题党日活动' },
    { month: 7, day: 1, type: ['支部党员大会', '党课', '主题党日活动'], name: '庆祝建党110周年暨"七一"表彰大会' },
    { month: 8, day: 12, type: ['组织生活会'], name: '2030年度组织生活会和民主评议党员' },
    { month: 10, day: 18, type: ['青年理论学习小组学习会'], name: '2031年青年理论学习小组第四季度学习会' },
    { month: 11, day: 8, type: ['民主生活会'], name: '2030年度民主生活会' },
    { month: 12, day: 5, type: ['其他会议'], name: '2031年度党建工作部署会' },
  ];
  for (const t of y2031) {
    const date = d(2031, t.month, t.day);
    const scope = t.type.includes('支部委员会')
      ? committee
      : t.type.includes('党小组会')
        ? members.filter((x) => x.partyGroup === GROUPS[0])
        : t.type.includes('青年理论学习小组学习会')
          ? youthGroup
          : members;
    const m = meetingBase(date, t.type, t.name,
      t.type.includes('党小组会') ? leaders[GROUPS[0]].name : secretary.name,
      t.type.includes('青年理论学习小组学习会') ? '孙晓峰' : org.name,
      '开展组织生活，落实"三会一课"制度');
    if (t.type.includes('党小组会')) m.partyGroups = [GROUPS[0]];
    m.participants = buildParticipants(date, members, scope, { withSnapshot: true, tempCount: 1 });
    meetings.push(m);
  }

  return meetings.sort((a, b) => a.date.localeCompare(b.date));
}

// ==================== 谈心谈话生成 ====================

const TALK_OUTLINES = [
  '了解近期思想动态和工作情况',
  '听取对支部工作和班子成员的意见建议',
  '新任职同志任职廉政谈话',
  '借调期间工作生活情况回访',
  '入党积极分子培养考察谈话',
  '年度考核结果反馈谈话',
  '岗位调整后适应情况了解',
  '谈心谈话制度落实情况交流',
];
const FIVE_MUST_OUTLINES = [
  '受处分处理人员回访教育谈话',
  '家庭发生重大变故职工关心关爱谈话',
  '长期病休人员慰问谈话',
  '新提拔干部任前廉政谈话',
  '群众反映问题核实了解谈话',
];
const TALK_LOCATIONS = ['党员活动室', '书记办公室', '预警中心3楼5号会议室（党员之家）', '谈心谈话室'];
const TALK_TYPES_ALL: TalkRecord['type'][] = [
  '领导班子成员之间', '领导班子成员与下一级领导班子成员之间', '党支部委员之间',
  '党支部委员和党员之间', '党员和党员之间', '党支部委员、党员和群众之间',
];

function buildTalks(members: Member[]): TalkRecord[] {
  const talks: TalkRecord[] = [];
  const secretary = members.find((m) => m.name === '周建国')!;
  const deputy = members.find((m) => m.name === '李红梅')!;
  const org = members.find((m) => m.name === '王志强')!;
  const talkers = [secretary, secretary, secretary, deputy, deputy, org]; // 书记为主
  const candidates = members.filter((m) => m.name !== '周建国');

  const yearPlans: { year: number; endMonth: number; count: number }[] = [
    { year: 2024, endMonth: 12, count: 14 },
    { year: 2025, endMonth: 12, count: 20 },
    { year: 2026, endMonth: 9, count: 26 },
    { year: 2031, endMonth: 12, count: 8 },
  ];

  let typeCursor = 0;
  for (const plan of yearPlans) {
    for (let i = 0; i < plan.count; i++) {
      const month = ri(1, plan.endMonth);
      const date = d(plan.year, month, ri(1, 28));
      const method: TalkRecord['method'] = rnd() < 0.6 ? 'individual' : rnd() < 0.65 ? 'collective' : 'organized';
      const type = method === 'individual'
        ? pick(['党支部委员和党员之间', '党员和党员之间', '党支部委员和党员之间'] as TalkRecord['type'][])
        : TALK_TYPES_ALL[typeCursor++ % TALK_TYPES_ALL.length];

      const talker = pick(talkers);
      const targetCount = method === 'individual' ? 1 : ri(2, 5);
      const shuffled = [...candidates].sort(() => rnd() - 0.5);
      const targets = shuffled.slice(0, targetCount);
      const isFive = rnd() < 0.18;
      const outline = isFive ? pick(FIVE_MUST_OUTLINES) : pick(TALK_OUTLINES);
      // 集体谈话/组织约谈对象含"群众"类型时，混入群众姓名（不在人员库，仅谈话对象）
      const targetNames = targets.map((t) => t.name);
      if (type === '党支部委员、党员和群众之间' && rnd() < 0.7) {
        targetNames.push(pick(['群众代表刘成', '职工代表汪洋', '群众代表田静']));
      }

      talks.push({
        id: uuid('tk-'),
        method,
        type,
        talkerName: talker.name,
        talkerTitle: talker.committeeRole,
        targetName: targetNames.join('、'),
        targetNames,
        targetTitle: pick(['党员', '预备党员', '入党积极分子', '支部委员', '青年职工', '群众']),
        contactPerson: method === 'organized' && rnd() < 0.5 ? pick(['钱丽华', '吴桂英', '严志刚']) : '',
        talkDate: date,
        timePeriod: rnd() < 0.65 ? 'am' : 'pm',
        outline,
        location: pick(TALK_LOCATIONS),
        content: rnd() < 0.6
          ? `${outline}。谈话对象汇报了近期思想、工作和学习情况，总体状态良好。谈话人提出下一步努力方向和具体要求。`
          : '',
        isFiveMustTalk: isFive,
        remark: rnd() < 0.2 ? '已建立谈话台账，后续跟踪回访' : '',
        createdAt: `${date}T16:00:00.000Z`,
        updatedAt: `${date}T16:00:00.000Z`,
      });
    }
  }
  return talks.sort((a, b) => a.talkDate.localeCompare(b.talkDate));
}

// ==================== 操作日志生成 ====================

function buildLogs(meetings: Meeting[], members: Member[]): OperationLog[] {
  const logs: OperationLog[] = [];
  const log = (ts: string, type: OperationLog['type'], description: string, detail: string, result: 'success' | 'failure' = 'success') => {
    logs.push({ id: uuid('log-'), timestamp: ts, type, description, detail, result });
  };

  log('2024-01-15T09:00:00.000Z', 'IMPORT_MEMBERS', '导入支部初始党员名单', `批量导入 ${members.length} 名党员基础信息`);
  log('2024-01-20T10:30:00.000Z', 'ADD_MEETING_TYPE', '新增会议类型', '新增自定义会议类型：青年理论学习小组学习会');
  const m2024 = meetings.filter((m) => m.date.startsWith('2024'));
  log('2024-12-28T16:00:00.000Z', 'EXPORT_LEDGER', '导出年度台账', `导出 2024 年度党建工作台账（${m2024.length} 条会议记录）`);
  log('2024-12-28T16:10:00.000Z', 'BACKUP_DATA', '手动备份', '导出全部数据 JSON 备份');
  log('2025-01-05T09:20:00.000Z', 'RESET_DATA', '清空数据', '清空前已确认备份');
  log('2025-01-05T09:25:00.000Z', 'RESTORE_DATA', '恢复备份', '从备份文件恢复全部数据');
  log('2025-03-10T11:00:00.000Z', 'UPDATE_MEMBER', '更新人员状态', '王秀兰 借调至上级单位（状态：在职→借调）');
  log('2025-04-15T15:00:00.000Z', 'IMPORT_MEMBERS', '导入人员名单失败', 'Excel 文件格式不兼容，导入已终止', 'failure');
  log('2025-06-15T10:00:00.000Z', 'UPDATE_MEMBER', '更新人员状态', '沈玉兰 工作调动（状态：在职→调离）');
  log('2025-07-01T17:30:00.000Z', 'EXPORT_DASHBOARD', '导出数据看板报告', '导出 2025 年上半年数据看板 Word 报告');
  log('2025-08-10T09:40:00.000Z', 'UPDATE_MEMBER', '更新人员状态', '杨春花 离职（状态：在职→离职）');
  log('2025-09-01T08:50:00.000Z', 'UPDATE_MEMBER', '更新人员状态', '王秀兰 借调期满返回（状态：借调→在职）');
  log('2025-10-12T14:00:00.000Z', 'MERGE_DATA', '数据融合', '组长台账导入：新增会议 2 条、疑似重复 1 条已跳过');
  log('2025-12-30T16:30:00.000Z', 'EXPORT_LEDGER', '导出年度台账', '导出 2025 年度党建工作台账');
  log('2026-01-06T09:10:00.000Z', 'UPDATE_MEMBER', '更新人员状态', '冯建军 借调至集团总部（状态：在职→借调）');
  log('2026-01-20T10:20:00.000Z', 'UPDATE_MEMBER', '更新人员状态', '韩志远 辞职（状态：在职→离职）');
  log('2026-02-18T11:30:00.000Z', 'UPDATE_MEMBER', '更新人员信息', '张桂香 修改联系电话');
  log('2026-03-02T09:00:00.000Z', 'CREATE_MEMBER', '新增党员', '白雪梅 组织关系转入本支部');
  log('2026-03-15T15:40:00.000Z', 'BACKUP_EXCEL', '手动 Excel 备份', '导出含隐藏表 BACKUP_JSON 的整库 Excel 备份');
  log('2026-04-10T10:00:00.000Z', 'AUTO_MERGE_DATA', '自动融合', '检测到组长侧同步文件，自动融合新增会议 3 条');
  log('2026-05-11T09:30:00.000Z', 'UPDATE_MEMBER', '更新人员信息', '孙德华 部门由综合管理部调整至市场部');
  log('2026-06-20T14:30:00.000Z', 'EXPORT_TALK', '导出谈心谈话台账', '导出 2026 年上半年谈心谈话台账');
  log('2026-07-06T09:00:00.000Z', 'UPDATE_MEMBER', '更新人员信息', '赵雪梅 部门由信息技术部调整至风险管理部');
  log('2026-08-01T16:00:00.000Z', 'BACKUP_DATA', '手动备份', '导出全部数据 JSON 备份');
  log('2026-08-15T10:10:00.000Z', 'CREATE_MEETING', '新增会议记录', meetings.length ? `新增会议：${meetings[meetings.length - 1].name || '(未命名)'}` : '新增会议记录');
  log('2026-08-20T11:00:00.000Z', 'UPDATE_TALK', '修改谈心谈话记录', '补充谈话内容备注');
  log('2026-09-01T09:00:00.000Z', 'DELETE_MEETING', '删除会议记录', '误录会议已删除（内容移入回收说明）');
  log('2026-09-05T14:20:00.000Z', 'RESTORE_EXCEL', '从 Excel 备份恢复失败', 'BACKUP_JSON 隐藏表数据块校验失败', 'failure');
  log('2026-09-08T10:00:00.000Z', 'BATCH_DELETE_MEMBER', '批量删除人员', '清理重复导入人员 2 名');
  log('2026-09-10T15:00:00.000Z', 'EXPORT_DASHBOARD', '导出数据看板报告', '导出 2026 年数据看板 Word 报告');
  return logs;
}

// ==================== 组装备份 + 校验 + 写出 ====================

function main() {
  const members = buildMembers();
  const meetings = buildMeetings(members);
  const talks = buildTalks(members);
  const logs = buildLogs(meetings, members);

  const backup = {
    appVersion: __APP_VERSION__,
    schemaVersion: 3,
    backupTime: '2026-09-12T12:00:00.000Z',
    tables: {
      members: { count: members.length, data: members },
      meetings: { count: meetings.length, data: meetings },
      operationLogs: { count: logs.length, data: logs },
      talkRecords: { count: talks.length, data: talks },
    },
  };

  // ---- 内部一致性校验 ----
  const errors: string[] = [];
  const memberIds = new Set(members.map((m) => m.id));
  const groupSet = new Set(GROUPS);
  const typeSet = new Set(MEETING_TYPES as string[]);

  meetings.forEach((m, i) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(m.date)) errors.push(`会议[${i}] 日期格式非法: ${m.date}`);
    m.type.forEach((t) => { if (!typeSet.has(t)) errors.push(`会议[${m.name || i}] 含非法类型: ${t}`); });
    (m.partyGroups || []).forEach((g) => { if (!groupSet.has(g)) errors.push(`会议[${m.name}] 含非法党小组: ${g}`); });
    m.participants.forEach((p) => {
      if (!p.isTemporary && !memberIds.has(p.memberId)) errors.push(`会议[${m.name}] 参会人 ${p.name} memberId 不存在`);
    });
  });
  talks.forEach((t, i) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t.talkDate)) errors.push(`谈话[${i}] 日期格式非法: ${t.talkDate}`);
  });
  if (errors.length > 0) {
    console.error('数据校验失败：');
    errors.forEach((e) => console.error('  ✗ ' + e));
    process.exit(1);
  }

  // ---- 写出文件 ----
  const outPath = path.resolve(process.cwd(), '党建工作台账_测试数据备份.json');
  const json = JSON.stringify(backup, null, 2);
  fs.writeFileSync(outPath, json, 'utf-8');

  // ---- 回读 + 走应用真实导入解析链路校验 ----
  const reparsed = parseBackupFile(JSON.parse(fs.readFileSync(outPath, 'utf-8')));
  if (!reparsed.success) {
    console.error('✗ 备份文件无法通过应用导入解析：', reparsed.error);
    process.exit(1);
  }
  const parsed = reparsed.data;
  const countMatch = parsed.tables.members.count === members.length
    && parsed.tables.meetings.count === meetings.length
    && parsed.tables.talkRecords.count === talks.length
    && parsed.tables.operationLogs.count === logs.length;
  if (!countMatch) {
    console.error('✗ 回读数量不一致');
    process.exit(1);
  }

  // ---- 统计摘要 ----
  const byYear: Record<string, number> = {};
  meetings.forEach((m) => { const y = m.date.substring(0, 4); byYear[y] = (byYear[y] || 0) + 1; });
  const byType: Record<string, number> = {};
  meetings.forEach((m) => m.type.forEach((t) => { byType[t] = (byType[t] || 0) + 1; }));
  const byStatus: Record<string, number> = {};
  members.forEach((m) => { byStatus[m.status] = (byStatus[m.status] || 0) + 1; });
  const byMethod: Record<string, number> = {};
  talks.forEach((t) => { byMethod[t.method] = (byMethod[t.method] || 0) + 1; });

  const has2031 = byYear['2031'] !== undefined;
  const multiType = meetings.filter((m) => m.type.length > 1).length;
  const unlinkedGroupMeeting = meetings.filter((m) => m.type.includes('党小组会') && (m.partyGroups || []).length === 0).length;
  const withSnapshot = meetings.filter((m) => m.date >= '2026-01-01' && m.participants.some((p) => p.departmentSnapshot !== undefined)).length;
  const noName = meetings.filter((m) => !m.name).length;

  console.log('========== 测试数据备份生成完成 ==========');
  console.log(`文件: ${outPath}`);
  console.log(`大小: ${(fs.statSync(outPath).size / 1024 / 1024).toFixed(2)} MB`);
  console.log(`人员 ${members.length} 人（在职 ${byStatus['active'] || 0} / 调离 ${byStatus['transferred'] || 0} / 借调 ${byStatus['seconded'] || 0} / 离职 ${byStatus['resigned'] || 0}）`);
  console.log(`会议 ${meetings.length} 条（套会 ${multiType} / 未关联党小组会 ${unlinkedGroupMeeting} / 无名称 ${noName} / 含部门快照会议 ${withSnapshot}）`);
  console.log(`谈心谈话 ${talks.length} 条（个别 ${(byMethod['individual'] || 0)} / 集体 ${(byMethod['collective'] || 0)} / 组织约谈 ${(byMethod['organized'] || 0)}）`);
  console.log(`操作日志 ${logs.length} 条`);
  console.log('\n会议按年份：');
  Object.keys(byYear).sort().forEach((y) => console.log(`  ${y}: ${byYear[y]} 条`));
  console.log('\n会议按类型（套会拆项计）：');
  Object.entries(byType).sort((a, b) => b[1] - a[1]).forEach(([t, c]) => console.log(`  ${t}: ${c}`));
  console.log(`\n✓ 已通过应用导入解析链路校验（parseBackupFile，schemaVersion=${parsed.schemaVersion}）`);
  console.log(has2031 ? '✓ 含 2031 年数据（验证年份选择器修复）' : '✗ 缺少 2031 年数据');
}

main();
