/**
 * V3.4 数据驱动验证脚本
 * 覆盖：状态时点规则修正、appendStatusChange 去重修复、误标窗口删除后考勤恢复、
 *       Excel 备份 BACKUP_JSON 整库往返、融合字段级冲突/空白补齐/疑似重复、
 *       组长 Excel 解析校验（姓名匹配/非法日期行号拦截/出勤以名单为准）、导入时间线语义
 * 运行：npx esbuild scripts/v34-test.ts --bundle --platform=node --format=cjs --outfile=/tmp/v34-test.cjs && node /tmp/v34-test.cjs
 */
// 注意：fake-indexeddb/auto 必须最先导入（Dexie 实例化时需要 global.indexedDB）
import 'fake-indexeddb/auto';
import type { Meeting, Member, Participant, TalkRecord } from '../src/types';
import { isActiveAt, appendStatusChange, countActiveAttendance } from '../src/utils/memberStatus';
import type { BackupData } from '../src/utils/backup';
import { createAutoBackupExcel, parseBackupFileUnified } from '../src/utils/backup';
import { previewMerge, executeMerge } from '../src/utils/mergeData';
import { parseGroupExcelFile } from '../src/utils/importGroupExcel';
import { db } from '../src/db';

// ==================== 断言工具 ====================
let pass = 0;
let fail = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.error(`  ✗ ${label}\n      期望: ${JSON.stringify(expected)}\n      实际: ${JSON.stringify(actual)}`); }
}

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

const mkMeeting = (over: Partial<Meeting> & { id: string; date: string }): Meeting => ({
  name: '', type: ['党课'], partyGroups: [], time: '09:00 - 10:00', location: '党员活动室',
  host: '张三', recorder: '李四', topic: '测试议题', summary: '', resolution: '',
  participants: [], createdAt: '2025-01-01T00:00:00', updatedAt: '2025-01-01T00:00:00',
  ...over,
});

const mkParticipant = (over: Partial<Participant> & { memberId: string; name: string }): Participant => ({
  status: 'attended', isTemporary: false, ...over,
});

async function clearDb() {
  await Promise.all([db.members.clear(), db.meetings.clear(), db.talkRecords.clear(), db.operationLogs.clear()]);
}

/** Node 环境构造 File（Node 20+ 全局有 File） */
function toFile(blob: Blob, name: string): File {
  return new File([blob], name, { type: blob.type });
}

// ==================== T1/T2：memberStatus 规则修正与去重修复 ====================
async function testMemberStatusRules() {
  console.log('\n[1] isActiveAt 规则修正（早于首条记录沿用首条状态）');
  const firstTransferred = mkMember({
    id: 'm-t', name: '钱九',
    status: 'transferred',
    statusHistory: [{ status: 'transferred', date: '2025-06-01' }], // 导入即调离（首条非在职）
  });
  check('首条=调离：调离前的会议不计在职', isActiveAt(firstTransferred, '2025-01-01'), false);
  check('首条=调离：调离后同样不计在职', isActiveAt(firstTransferred, '2025-08-01'), false);

  const firstActive = mkMember({ id: 'm-a', name: '赵八' }); // 无历史，当前在职
  check('无历史+当前在职：早期会议在职', isActiveAt(firstActive, '2020-01-01'), true);

  console.log('\n[2] appendStatusChange 去重修复（基准=变更日期时点状态，同日覆盖，恒按日期正序）');
  const historyMember = mkMember({
    id: 'm-h', name: '孙十',
    statusHistory: [
      { status: 'active', date: '2024-01-01' },
      { status: 'seconded', date: '2025-06-01' },
      { status: 'active', date: '2025-09-01' },
    ],
  });
  // 补录早于末位的"在职"（该时点本就在职）→ 不产生新记录（去重基准正确）
  const noDup = appendStatusChange(historyMember, 'active', '2025-03-01');
  check('时点状态相同：不新增记录', noDup.length, 3);
  // 补录早于末位的"借调"（真实状态变化）→ 按日期插入正确位置
  const inserted = appendStatusChange(historyMember, 'seconded', '2025-03-01');
  check('时点状态不同：按日期插入', inserted.map((h) => h.date), ['2024-01-01', '2025-03-01', '2025-06-01', '2025-09-01']);
  // 同日已存在 → 直接覆盖，不出现同日两条
  const overwritten = appendStatusChange(historyMember, 'active', '2025-06-01');
  check('同日记录覆盖', overwritten.filter((h) => h.date === '2025-06-01').map((h) => h.status), ['active']);
}

// ==================== T3：误标窗口删除后考勤恢复（场景 1） ====================
async function testMislabelRecovery() {
  console.log('\n[3] 误标借调 → 删除该行 → 考勤恢复');
  const mislabeled = mkMember({
    id: 'm1', name: '李四',
    statusHistory: [
      { status: 'active', date: '2024-01-01' },
      { status: 'seconded', date: '2025-03-01' }, // 误标
      { status: 'active', date: '2025-09-01' },
    ],
  });
  const meeting = mkMeeting({
    id: 'mt1', date: '2025-05-10',
    participants: [mkParticipant({ memberId: 'm1', name: '李四' })],
  });
  const before = countActiveAttendance(meeting, [mislabeled]);
  check('误标窗口内：不计入应到', before.shouldAttend, 0);

  // 变更历史可编辑：删除误标行（及回归行），时间线回到全程在职
  const fixed: Member = {
    ...mislabeled,
    status: 'active',
    statusHistory: mislabeled.statusHistory!.filter((h) => h.date === '2024-01-01'),
  };
  const after = countActiveAttendance(meeting, [fixed]);
  check('删除误标行后：恢复计入应到/实到', [after.shouldAttend, after.attended], [1, 1]);
}

// ==================== T4：Excel 备份 BACKUP_JSON 整库往返（场景 3） ====================
async function testExcelBackupRoundTrip() {
  console.log('\n[4] Excel 自动备份：BACKUP_JSON 隐藏表整库无损恢复');
  const backup: BackupData = {
    appVersion: '3.4.0',
    schemaVersion: 3,
    backupTime: '2026-08-26T20:00:00.000Z',
    tables: {
      members: {
        count: 1,
        data: [mkMember({
          id: 'm1', name: '张三', phone: '13800000000', partyGroup: '第三党小组',
          statusHistory: [{ status: 'active', date: '2021-03-01' }],
          changeHistory: [{ date: '2026-05-10', field: '党小组', oldValue: '第二党小组', newValue: '第三党小组' }],
        })],
      },
      meetings: {
        count: 1,
        data: [mkMeeting({
          id: 'mt1', date: '2026-08-01', name: '专题组织生活会', type: ['主题党日活动', '党课'],
          participants: [mkParticipant({ memberId: 'm1', name: '张三', departmentSnapshot: '综合部', titleSnapshot: '综合部室' })],
        })],
      },
      operationLogs: { count: 0, data: [] },
      talkRecords: {
        count: 1,
        data: [{ id: 'tk1', talkDate: '2026-08-10', talkerName: '张三', targetName: '李四', targetNames: ['李四'], content: '内容', createdAt: '2026-08-10', updatedAt: '2026-08-10' } as unknown as TalkRecord],
      },
    },
  };

  const blob = await createAutoBackupExcel(backup);
  const parsed = await parseBackupFileUnified(toFile(blob, '自动备份_测试.xlsx'));
  check('xlsx 识别为 excel-json 备份', parsed.success && parsed.source, 'excel-json');
  if (parsed.success) {
    check('整库 JSON 往返：人员状态历史无损', parsed.data.tables.members.data[0].statusHistory, backup.tables.members.data[0].statusHistory);
    check('整库 JSON 往返：变更历史无损', parsed.data.tables.members.data[0].changeHistory, backup.tables.members.data[0].changeHistory);
    check('整库 JSON 往返：参会部门快照无损', parsed.data.tables.meetings.data[0].participants[0].departmentSnapshot, '综合部');
    check('整库 JSON 往返：谈话 targets 无损', parsed.data.tables.talkRecords.data[0].targetNames, ['李四']);
  }

  // 无 BACKUP_JSON 的 xlsx（组长手工表/台账导出）→ 恢复入口拦截并引导融合
  const XLSX = await import('xlsx-js-style');
  const plain = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(plain, XLSX.utils.aoa_to_sheet([['会议名称', '会议日期', '参会人员名单'], ['测试会', '2026-08-01', '']]), 'Sheet1');
  const plainBlob = new Blob([XLSX.write(plain, { bookType: 'xlsx', type: 'array' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const rejected = await parseBackupFileUnified(toFile(plainBlob, '组长台账.xlsx'));
  check('无隐藏表 xlsx：恢复拦截 + 引导融合入口', [rejected.success === false, (rejected as { notBackupFile?: boolean }).notBackupFile], [true, true]);
}

// ==================== T5：融合字段级冲突 / 空白补齐 / 疑似重复（场景 9/10） ====================
async function testMergeFieldLevel() {
  console.log('\n[5] 融合：字段级冲突 + 空白自动补齐 + 疑似重复提示');
  await clearDb();
  const localMember = mkMember({ id: 'm1', name: '张三', partyGroup: '第二党小组', phone: '' });
  const localMember2 = mkMember({ id: 'm2', name: '李四', committeeRole: '组织委员' });
  const localMeeting = mkMeeting({ id: 'mt-local', date: '2026-07-01', name: '专题组织生活会' });
  await db.members.bulkAdd([localMember, localMember2]);
  await db.meetings.add(localMeeting);

  const backup: BackupData = {
    appVersion: '3.4.0', schemaVersion: 3, backupTime: '2026-08-26T21:00:00.000Z',
    tables: {
      members: {
        count: 2,
        data: [
          { ...localMember, partyGroup: '第三党小组', phone: '13900000000', status: 'seconded', statusHistory: [{ status: 'seconded', date: '2026-06-01' }] }, // 冲突：党小组；补齐：电话；状态差异
          { ...localMember2, committeeRole: '宣传委员' }, // 冲突：支委职务（选择保留本机）
        ],
      },
      meetings: {
        count: 2,
        data: [
          mkMeeting({ id: 'mt-dup', date: '2026-07-01', name: '专题组织生活会' }), // 疑似重复（id 不同、日期+名称相同）
          mkMeeting({ id: 'mt-new', date: '2026-08-15', name: '八月党课' }),       // 正常新增
        ],
      },
      operationLogs: { count: 0, data: [] },
      talkRecords: { count: 0, data: [] },
    },
  };

  const preview = await previewMerge(backup);
  check('冲突检测：张三-党小组 / 李四-支委职务', preview.conflicts.map((c) => `${c.memberName}-${c.fieldLabel}`).sort(), ['张三-党小组', '李四-支委职务']);
  check('空白补齐检测：张三-联系电话', preview.autoFilled.map((a) => `${a.memberName}-${a.fieldLabel}`), ['张三-联系电话']);
  check('疑似重复会议：同日期同名称 1 条', preview.duplicateMeetings.length, 1);
  check('状态差异仅提示：张三', preview.statusDiffs.map((s) => s.memberName), ['张三']);
  check('新增会议 2 / 跳过 0', [preview.addMeetings, preview.skipMeetings], [2, 0]);

  // 执行融合：张三-党小组采用备份；李四-支委职务保留本机
  const result = await executeMerge(backup, [
    { memberId: 'm1', field: 'partyGroup', use: 'backup' },
    { memberId: 'm2', field: 'committeeRole', use: 'local' },
  ]);
  check('融合执行成功且更新 1 人（李四无变化不写入）', [result.success, result.updatedMembers], [true, 1]);

  const merged = await db.members.toArray();
  const zhang = merged.find((m) => m.id === 'm1')!;
  const li = merged.find((m) => m.id === 'm2')!;
  check('张三：党小组采用备份值', zhang.partyGroup, '第三党小组');
  check('张三：空白电话自动补齐', zhang.phone, '13900000000');
  check('张三：状态不被自动融合（本机 active 保持）', zhang.status, 'active');
  check('李四：冲突保留本机值', li.committeeRole, '组织委员');
  const meetingCount = await db.meetings.count();
  check('会议并入后共 3 条（本机1+新增2）', meetingCount, 3);
}

// ==================== T6：组长 Excel 解析校验（场景 11） ====================
async function testGroupExcelParse() {
  console.log('\n[6] 组长 Excel 融合导入：姓名匹配 / 非法日期行号拦截 / 出勤以名单为准');
  await clearDb();
  await db.members.bulkAdd([
    mkMember({ id: 'm1', name: '张三' }),
    mkMember({ id: 'm2', name: '李四', partyGroup: '第二党小组' }),
  ]);
  await db.meetings.add(mkMeeting({ id: 'mt-local', date: '2026-07-01', name: '七月组织生活会' }));

  const HEADERS = ['序号', '会议名称', '会议日期', '会议时间', '会议类型', '所属党小组', '会议地点', '主持人', '记录人', '会议议题', '会议决议/结论', '应到人数', '实到人数', '请假人数', '缺席人数', '出勤率', '参会人员名单'];
  const mkRow = (name: string, date: string, list: string, nums: [number, number, number, number] = [3, 2, 1, 0]) =>
    [1, name, date, '09:00-10:00', '党课', '第一党小组', '活动室', '张三', '李四', '议题', '', ...nums, '', list];

  const XLSX = await import('xlsx-js-style');
  const buildFile = (rows: (string | number)[][]) => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([HEADERS, ...rows]), '会议记录');
    return toFile(new Blob([XLSX.write(wb, { bookType: 'xlsx', type: 'array' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), '组长台账.xlsx');
  };

  // 6a 非法日期 → 整表拦截并给出 Excel 行号
  const badDate = await parseGroupExcelFile(buildFile([
    mkRow('八月党课', '2026-08-15', '参会：张三、李四'),
    mkRow('错误行', '2026/13/99', '参会：张三'),
  ]));
  check('非法日期：整表拦截', badDate.success && badDate.result.ok, false);
  if (badDate.success) {
    check('非法日期：提示 Excel 行号（表头第1行，数据从第2行起）', badDate.result.errors[0].row >= 3, true);
  }

  // 6b 合法文件：姓名匹配 / 未匹配名单 / 出勤差异以名单为准 / 疑似重复
  const ok = await parseGroupExcelFile(buildFile([
    mkRow('七月组织生活会', '2026-07-01', '参会：张三、李四\n请假：王五(事假)', [3, 2, 1, 0]),   // 四列与名单一致（与本机疑似重复）
    mkRow('八月党课', '2026-08-15', '参会：张三、李四\n缺席：赵六', [99, 2, 0, 1]),              // 应到99与名单不符
  ]));
  check('合法文件解析成功', ok.success && ok.result.ok, true);
  if (ok.success && ok.result.ok) {
    check('解析出 2 条会议', ok.result.meetings.length, 2);
    const m2 = ok.result.meetings[1];
    check('参会名单解析：3 人（出席2+缺席1）', m2.participants.length, 3);
    check('本机人员按 memberId 匹配且非临时', [m2.participants[0].memberId, m2.participants[0].isTemporary], ['m1', false]);
    check('未匹配姓名列出（王五/赵六）', ok.result.unmatchedNames.sort(), ['王五', '赵六']);
    check('疑似重复会议提示 1 条（同日期同名称）', ok.result.duplicates.length, 1);
    check('出勤四列与名单不一致：以名单为准并提示', ok.result.attendanceFixes.length, 1);
  }
}

// ==================== T7：批量导入时间线语义（场景 2） ====================
async function testImportTimeline() {
  console.log('\n[7] 导入含入职日期/当前状态列：构建时间线后回填判定正确');
  // 模拟导入解析产物：入职日期 2020-01-01 在职 + 2025-06-01 调离
  const imported = mkMember({
    id: 'm-i', name: '王五', status: 'transferred',
    statusHistory: [
      { status: 'active', date: '2020-01-01' },
      { status: 'transferred', date: '2025-06-01' },
    ],
  });
  check('入职后-调离前：计在职', isActiveAt(imported, '2025-01-01'), true);
  check('调离后：不计在职', isActiveAt(imported, '2025-08-01'), false);
  check('入职前：沿用首条（在职）', isActiveAt(imported, '2019-01-01'), true);

  // 三列留空 → 行为与现状一致（无历史，按当前状态判定）
  const blank = mkMember({ id: 'm-b', name: '赵六' });
  check('留空导入：等同现状（当前在职则全程在职）', isActiveAt(blank, '2020-06-01'), true);
}

// ==================== 主流程 ====================
(async () => {
  console.log('========== V3.4 验证开始 ==========');
  await testMemberStatusRules();
  await testMislabelRecovery();
  await testExcelBackupRoundTrip();
  await testMergeFieldLevel();
  await testGroupExcelParse();
  await testImportTimeline();
  console.log('\n========== 结果 ==========');
  console.log(`通过 ${pass} 项，失败 ${fail} 项`);
  if (fail > 0) process.exit(1);
})().catch((err) => { console.error('测试执行异常:', err); process.exit(1); });
