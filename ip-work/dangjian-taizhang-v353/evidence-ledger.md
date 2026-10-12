# 证据台账（Evidence Ledger）

> 案件：党建工作台账应用 软件著作权登记
> 更新日期：2026-10-12
> 状态取值：`SUPPORTED`（一手材料直接支持）｜`INFERRED`（由已登记事实推得，附前提）｜`USER_CONFIRMED`｜`UNKNOWN`（材料不足）｜`CONFLICT`｜`OUT_OF_SCOPE`
> 规则：任何写入交付物的陈述必须在本表可查；`INFERRED`/`UNKNOWN` 不得写成确定事实。

## 一、软件身份与版本

| ID | 事实 | 状态 | 来源 / 依据 |
| --- | --- | --- | --- |
| F001 | 软件当前版本号为 3.5.3 | SUPPORTED | S006 `package.json` `"version": "3.5.3"` |
| F002 | 应用产品名为"党建工作台账" | SUPPORTED | S006 `build.productName = "党建工作台账"` |
| F003 | 项目标识（package name）为 `party-building-ledger` | SUPPORTED | S006 `"name": "party-building-ledger"` |
| F004 | 项目描述为"党建工作台账应用 - 基层党组织会议记录与统计管理" | SUPPORTED | S006 `"description"` |
| F005 | 应用以桌面应用形态发布，打包目标为 Windows x64（NSIS 安装版 + portable 绿色版） | SUPPORTED | S006 `build.win.target`；S012 工作流 `--win --x64` |
| F006 | 版本 3.5.3 于 2026-09-25 发布 | SUPPORTED | S013（v3.5.3 published_at = 2026-09-25） |
| F007 | 有发布记录的最早版本为 3.2.0，发布于 2026-08-24 | SUPPORTED | S013 |
| F008 | 软件首次发表日期 | UNKNOWN | 本地 Git 历史丢失；S013 仅可追溯至 3.2.0（2026-08-24），更早版本无证据 → 见 Q003 |
| F009 | 版本号展示在"数据管理"页页脚，且运行时显示为 v3.5.3 | SUPPORTED | 源码 `src/pages/Settings.tsx` 使用 `__APP_VERSION__`；S014 截图 `10-settings-bottom.png` 页脚实读为"党建工作台账应用 v3.5.3" |

## 二、源代码规模（源程序总量）

| ID | 事实 | 状态 | 来源 / 依据 |
| --- | --- | --- | --- |
| F010 | `src/` 目录源代码共 10,269 行 | SUPPORTED | S005，`wc -l` 实测（.ts/.tsx/.css） |
| F011 | `electron/` 目录源代码共 527 行 | SUPPORTED | S005，`wc -l` 实测（main.cjs 508 + preload.cjs 19） |
| F012 | 源程序总量合计 **10,796 行**（不含配置类文件） | SUPPORTED | F010 + F011 |
| F013 | 源程序按显示宽度折行后为 11,404 行 | SUPPORTED | 生成脚本 `build_code_doc.py` 实测输出 |
| F014 | 源文件数：`src/` 33 个 + `electron/` 2 个 | SUPPORTED | S005，`find` 实测 |

## 三、源程序文档（交付物）合规性

| ID | 事实 | 状态 | 来源 / 依据 |
| --- | --- | --- | --- |
| F015 | 源程序文档取材于 S005 真实源码，按固定文件顺序（入口→布局→页面→组件→数据层→类型→工具→Electron 主进程）连续拼接 | SUPPORTED | `build_code_doc.py` `FILE_ORDER` |
| F016 | 文档共 60 页，每页恰为 50 行，正文合计 3,000 行（前 30 页 1,500 行 + 后 30 页 1,500 行） | SUPPORTED | `verify_code_doc.py` 实测：正文段落 3,000、分页符 59、全部页面均为 50 行；并经 LibreOffice 转 PDF 后用 PyMuPDF 逐页复核：**总页数 60，60 页全部为 50 行，无不足 50 行的页** |
| F017 | 页面为 A4（21.0×29.7cm）纵向，四边距 1.2cm | SUPPORTED | `verify_code_doc.py` 实测；PDF 页面尺寸复核 21.0×29.7cm |
| F018 | 正文无超过设定宽度（95 个半角单位）的行，不存在自动换行溢出 | SUPPORTED | `verify_code_doc.py` 实测：超宽行数 = 0；PDF 逐页行数与正文段落数一致（50=50），印证无折行 |
| F019 | 文档在正文中插入了 38 行标记（37 行文件路径标记 + 1 行"以下为源程序末尾 30 页"标记），占 3,000 行的 1.27%，均为 `//` 形式注释 | SUPPORTED | `build_code_doc.py`；实测 37 个源文件 + 1 行分段标记 |
| F020 | 为保证"每页不低于 50 行"，源程序文档做了两项纯格式归一化：① 剔除空行；② 将超过 95 个半角显示宽度的长行按显示宽度折行（不丢字符）。**未增删、未改写任何代码字符** | SUPPORTED | `build_code_doc.py` `collect_lines()` / `hard_wrap()`；已在 questions.md Q019 中告知 |
| F055 | 源程序文档单页占用高度 700pt（50 行 × 14pt），小于可用高度 773.9pt（29.7cm−2×1.2cm），故不存在内容溢出 | SUPPORTED | 实测 PDF：每页 50 行、行距 14pt、总页数 60（若溢出则页数必然大于 60） |
| F056 | 《使用说明书》共 22 页，A4 纵向，内嵌系统截图 12 张（对应 10 个页面/界面） | SUPPORTED | LibreOffice 转 PDF 实测 22 页；docx 内嵌图片实测 12 张 |
| F057 | 《计算机软件著作权登记申请表（填写稿）》共 4 页，A4 纵向 | SUPPORTED | LibreOffice 转 PDF 实测 4 页 |
| F058 | 申请表字数约束全部满足：开发目的 46 字（限 50）、面向领域 39 字（限 50）、主要功能 1,161 字（需 ≥500）、技术特点 80 字（限 100） | SUPPORTED | `build_application_form.py` 生成时实测并输出 |

## 四、软件功能与技术事实（写入说明书/申请表的部分）

| ID | 事实 | 状态 | 来源 / 依据 |
| --- | --- | --- | --- |
| F021 | 左侧导航菜单共 7 项，依次为：数据看板、组织架构、人员管理、会议管理、谈心谈话、操作日志、数据管理 | SUPPORTED | `src/layouts/MainLayout.tsx` `menuItems`；S014 截图 01–10 左侧菜单实见 |
| F022 | 组织架构为独立页面（路由 `/orgchart`），非数据看板内嵌模块 | SUPPORTED | `src/App.tsx` 路由；`src/pages/OrgChartPage.tsx`；S011 V3.5.3 方案 |
| F023 | 组织架构为四层树：书记 → 副书记 → 支委委员 → 党小组；支持展开查看组员、显示人数、组长置顶标记、支委职务标记、借调标记、未编组归集 | SUPPORTED | `src/components/OrgChart.tsx`、`src/utils/orgChart.ts`；S014 截图 `03-orgchart-top.png`、`03-orgchart-members.png` |
| F024 | 组织架构人员范围＝当前在职 + 借调；调离/离职不显示；书记空缺时节点常显"空缺"，副书记空缺时隐藏 | SUPPORTED | `src/utils/orgChart.ts`；S011 V3.5.3 方案"口径决策"表 |
| F025 | 会议类型共 9 种：支部党员大会、支部委员会、党小组会、党课、组织生活会、民主生活会、主题党日活动、青年理论学习小组学习会、其他会议 | SUPPORTED | `src/types/index.ts` `MEETING_TYPES` |
| F026 | 人员状态共 4 种：在职(active)、调离(transferred)、借调(seconded)、离职(resigned) | SUPPORTED | `src/types/index.ts` `MemberStatus` / `MEMBER_STATUS_LABEL` |
| F027 | 支委职务共 9 种：支部书记、支部副书记、组织委员、宣传委员、青年委员、纪检委员、保密委员、统战委员、群工委员 | SUPPORTED | `src/types/index.ts` `COMMITTEE_ROLES` |
| F028 | 谈心谈话分 3 种方式：个别谈话、集体谈话、组织约谈 | SUPPORTED | `src/types/index.ts` `TalkMethod` |
| F029 | 出勤状态分 3 种：出席、请假、缺席；另有"列席"标记 | SUPPORTED | `src/types/index.ts` `AttendanceStatus`、`Participant.isGuest`；S014 截图 `07-meeting-form.png` |
| F030 | 出勤统计采用"按会议日期时点判定在职"的时间线口径，调离/借调/离职期间不计入，离开前及回归后计入；临时人员不计入；列席计入出席 | SUPPORTED | `src/utils/memberStatus.ts` `isActiveAt`/`countActiveAttendance`；S008 V3.3 第 2.3 节 |
| F031 | 会议总数按"套会拆开"计次，党小组会按关联党小组数计次 | SUPPORTED | `src/types/index.ts` `typeMeetingUnits`/`meetingTotalUnits`；S008 V3.3 第 2.4 节 |
| F032 | "在职党员总数"按所选年度时点统计：当前年＝截至目前，历史年＝年末 | SUPPORTED | `src/pages/Dashboard.tsx`（`activeRefDate`/`activeLabel`）、`countActiveMembersAt`；S011 V3.5.2 方案 |
| F033 | 出勤对比支持党小组 / 部室 / 部门·支部三个维度切换，默认党小组 | SUPPORTED | `src/utils/chartSeries.ts` `AttendanceDimension`/`buildDimensionAttendanceRates`；`src/pages/Dashboard.tsx` `dimMeta`；S011 V3.5.2 方案 |
| F034 | 参会记录保存部门、部室、党小组快照，统计优先读快照，人员调动不改写历史 | SUPPORTED | `src/types/index.ts` `Participant.departmentSnapshot/titleSnapshot/partyGroupSnapshot`；S009 V3.4 第 4.2 节 |
| F035 | 数据备份支持 JSON 与 Excel 两种格式与三种导出范围（全部数据/仅会议记录/仅谈心谈话） | SUPPORTED | `src/pages/Settings.tsx`；S014 截图 `10-settings-top.png` 实见 |
| F036 | 数据恢复支持 .json 与 .xlsx（xlsx 读取内嵌隐藏表整库恢复），恢复覆盖当前数据 | SUPPORTED | S014 截图 `10-settings-top.png` 文案实见；S009 V3.4 第 2.2 节 |
| F037 | 数据融合支持 JSON 与 Excel 两种来源，按记录标识去重、不覆盖本机已有数据，并提供"组长填报模板"下载 | SUPPORTED | S014 截图 `10-settings-bottom.png` 文案实见；S009 V3.4 第 2.3 节 |
| F038 | 提供定时自动备份与定时自动融合（仅桌面应用环境可用，浏览器模式下降级为手动） | SUPPORTED | S014 截图 `10-settings-top.png`/`10-settings-bottom.png` 提示条实见；S009 V3.4 第 2.1 节 |
| F039 | 操作日志覆盖人员/会议/谈话/导出/备份/恢复/融合等操作，含成功与失败结果 | SUPPORTED | `src/types/index.ts` `OperationType`（23 项）；S014 截图 `09-logs.png` |
| F040 | 年度台账导出内容含明细主表 + 支委会/党员大会/各党小组会/党课/组织生活会/民主生活会/主题党日活动子表 + 参会考勤统计/月度汇总/会议类型统计 | SUPPORTED | `src/utils/exportExcel.ts`；S008 V3.3 第 3.3 节 |
| F041 | 数据看板可导出 Word 统计报告 | SUPPORTED | `src/utils/exportWord.ts`；S008 V3.3 第 2.1 节 |
| F042 | 应用具备单实例锁（同一数据目录重复启动时聚焦已有窗口） | SUPPORTED | S010 V3.5 第四节；S006/S005 `electron/main.cjs` |
| F043 | 数据库为浏览器本地 IndexedDB（Dexie），名为 `PartyBuildingLedger`，含 members/meetings/operationLogs/talkRecords 四张表，具备 V1→V2→V3 自动迁移 | SUPPORTED | S005 `src/db/index.ts` |

## 五、开发与运行环境事实

| ID | 事实 | 状态 | 来源 / 依据 |
| --- | --- | --- | --- |
| F044 | 编程语言：TypeScript（含 TSX/JSX）、CSS、HTML；Electron 主进程为 CommonJS JavaScript | SUPPORTED | S005 文件扩展名；S006 `"type": "module"` |
| F045 | 前端框架与技术栈：React 19、Ant Design 6、ECharts 6、React Router 7、Dexie 4、Day.js、electron 39 | SUPPORTED | S006 dependencies/devDependencies |
| F046 | 构建工具：Vite 8 + TypeScript 编译器；桌面打包：electron-builder 26 | SUPPORTED | S006 devDependencies、scripts |
| F047 | 云端构建环境为 windows-latest，Node.js 20，x64 | SUPPORTED | S012 |
| F048 | 开发所用操作系统 | INFERRED（低置信） | 依据打包目标与 CI 环境为 Windows，推断开发与验证在 Windows 桌面环境进行；**未见直接记录** → 见 Q006 |
| F049 | 开发硬件环境 / 运行硬件环境 | UNKNOWN | 无直接材料 → 见 Q006 |

## 六、截图采集方法与真实性

| ID | 事实 | 状态 | 来源 / 依据 |
| --- | --- | --- | --- |
| F050 | 截图为真实运行界面采集：本地启动 Vite 开发服务器（`http://localhost:5199/`），经浏览器访问并截屏 | SUPPORTED | 本次操作记录；服务器命令 `npx vite --port 5199` |
| F051 | 截图前向应用写入了真实测试数据（S015）：members 46、meetings 156、operationLogs 30、talkRecords 68，写入后各页面显示真实业务数据 | SUPPORTED | 播种脚本 `source/seed-browser.js` 返回 `SEED_OK {"members":46,"meetings":156,"operationLogs":30,"talkRecords":68}`；截图内数据行实见 |
| F052 | 截图未经过任何合成、绘制或 AI 生成；仅做了等比例裁剪（不缩放像素）以适配尺寸 | SUPPORTED | 采集记录；采集后未对画面内容做任何修改 |
| F053 | 截图清单（10 张）：01 数据看板、02 数据看板下半、03 组织架构（2 张：层级 / 组员）、04 人员管理、05 新增人员表单、06 会议管理、07 新增会议表单、08 谈心谈话、09 操作日志、10 数据管理（2 张） | SUPPORTED | `software-copyright/screenshots/` |
| F054 | 部分截图因采集环境视口高度限制，采用"顶部 + 下半屏"分段截取（01/02、03/10），两段之间存在少量区域重叠 | SUPPORTED | 采集记录 |

## 七、冲突与更正记录

| ID | 事项 | 处理 |
| --- | --- | --- |
| C001 | S007 Code Wiki 标注版本为 3.2.0，其"6 个子页面"描述与 3.5.3 实际 7 个菜单项冲突 | 以源码 F021 与实际截图为准；Code Wiki 仅作背景 |
| C002 | 截图采集过程中，采集方一度将数据管理页页脚版本号读为"v0.3.1" | 已放大原图逐字核对，实为"**v3.5.3**"（见 F009）；采集方读值作废 |
| C003 | 会话环境提示"今天为 2026-09-13"，而系统实测时间为 2026-10-12 | 以系统实测 2026-10-12 为工作日期；交付物未使用任何"今天"字样作为事实 |