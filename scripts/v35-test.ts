/**
 * V3.5 数据驱动验证脚本
 * 覆盖：月度趋势系列纯函数（空白年份→空数组 / 各类型计次 / 套会拆分 / 年份过滤 / 无数据类型剔除）、
 *       版本号单一来源（package.json ↔ vite define 注入 ↔ Settings/backup）、单实例锁静态结构校验
 * 运行：V=$(node -p "JSON.stringify(require('./package.json').version)") && \
 *       npx esbuild scripts/v35-test.ts --bundle --platform=node --format=cjs \
 *         --define:__APP_VERSION__="$V" --outfile=/tmp/v35-test.cjs && node /tmp/v35-test.cjs
 * （backup.ts 引用构建期注入的 __APP_VERSION__，测试打包时以 package.json 版本注入，保持单一来源）
 */
// 注意：fake-indexeddb/auto 必须最先导入（backup.ts → db 的 Dexie 实例化需要 global.indexedDB）
import 'fake-indexeddb/auto';
import fs from 'fs';
import path from 'path';
import type { Meeting } from '../src/types';
import { buildMonthStackSeries } from '../src/utils/chartSeries';
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
  check('package.json version = 3.5.0', pkg.version, '3.5.0');
  check('backup.ts APP_VERSION = 注入值（3.5.0）', APP_VERSION, '3.5.0');
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

// ==================== 主流程 ====================

async function main() {
  console.log('========== V3.5 专项测试 ==========');
  testBuildMonthStackSeries();
  testVersionSingleSource();
  testSingleInstanceLock();

  console.log('\n========== 结果 ==========');
  console.log(`通过: ${pass}，失败: ${fail}`);
  if (fail > 0) process.exit(1);
}

void main();
