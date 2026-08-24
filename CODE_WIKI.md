# 党建工作台账应用 - Code Wiki

> **项目名称**: party-building-ledger  
> **当前版本**: 3.2.0  
> **最后更新**: 2026-08-24

---

## 1. 项目概述

### 1.1 项目简介
本项目是一款面向基层党组织的**党建工作台账管理系统**，用于管理党员信息、会议记录、谈心谈话记录，并提供数据统计看板、台账导出（Excel/Word）、数据备份恢复、跨端数据融合等能力。

### 1.2 核心能力
- **人员管理**：党员信息维护、状态历史（在职/调离/借调/离职）、党小组划分、支委职务管理
- **会议管理**：9类会议记录（支部党员大会、支委会、党小组会、党课、组织生活会、民主生活会、主题党日活动、青年理论学习小组学习会、其他会议）、智能参会人员识别、出勤统计
- **谈心谈话**：个别谈话/集体谈话/组织约谈三种方式，支持"五必谈"标记
- **数据看板**：ECharts 可视化图表，含会议趋势、类型分布、出勤率排行等
- **台账导出**：按时间段导出年度 Excel 台账（多 Sheet 明细+统计），看板 Word 报告导出
- **数据备份**：JSON/Excel 双格式备份与恢复，V1/V2/V3 数据自动迁移
- **数据融合**：党小组组长与管理员数据同步，支持手动融合 + 定时自动融合（Electron 桌面端）
- **操作审计**：全量操作日志

---

## 2. 技术栈

| 类别 | 技术 | 版本 |
|------|------|------|
| 前端框架 | React | ^19.2.17 |
| 路由 | React Router DOM | ^7.18.1 |
| UI 组件库 | Ant Design | ^6.5.2 |
| 图标库 | @ant-design/icons | ^6.3.2 |
| 图表库 | ECharts + echarts-for-react | ^6.1.0 / ^3.0.6 |
| 桌面端 | Electron | ^39.2.7 |
| 数据库 | Dexie（IndexedDB 封装） | ^4.4.4 |
| 日期处理 | Day.js | ^1.11.21 |
| 构建工具 | Vite | ^8.1.1 |
| 语言 | TypeScript | ~6.0.2 |
| 打包（Electron） | electron-builder | ^26.0.12 |
| Excel 处理 | xlsx / xlsx-js-style / exceljs | ^0.18.5 / ^1.2.0 / ^4.4.0 |
| Word 处理 | docx | ^9.7.1 |
| 唯一 ID | uuid | ^14.0.1 |

---

## 3. 项目整体架构

### 3.1 架构图

```
┌─────────────────────────────────────────────────────────────┐
│                        Electron 主进程                        │
│  (electron/main.cjs)                                         │
│  ┌──────────────┐  ┌────────────────────────────────────┐   │
│  │ 窗口管理      │  │ IPC: sync:select-folder / list-    │   │
│  │ 绿色版数据持久│  │ backup-files / read-backup-file    │   │
│  │ 化(userData) │  │ / mark-file-merged / check-folder  │   │
│  └──────────────┘  └────────────────────────────────────┘   │
└──────────────────────────┬──────────────────────────────────┘
                           │ IPC (contextBridge)
┌──────────────────────────▼──────────────────────────────────┐
│                      渲染进程 (React SPA)                    │
│  ┌───────────────────────────────────────────────────────┐  │
│  │                    App 路由层                           │  │
│  │  HashRouter → MainLayout → 6 个子页面                  │  │
│  └───────────────────────────────────────────────────────┘  │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │  UI 组件层    │  │  页面层       │  │  工具函数层        │  │
│  │  components/ │  │  pages/      │  │  utils/           │  │
│  └──────────────┘  └──────────────┘  └───────────────────┘  │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │  数据层       │  │  类型定义     │  │  布局/主题        │  │
│  │  db/index.ts  │  │  types/      │  │  layouts/         │  │
│  └──────────────┘  └──────────────┘  └───────────────────┘  │
│  ┌───────────────────────────────────────────────────────┐  │
│  │              Dexie → IndexedDB (浏览器本地存储)          │  │
│  │   members / meetings / operationLogs / talkRecords     │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 目录结构

```
/workspace/
├── electron/                      # Electron 主进程代码（CommonJS）
│   ├── main.cjs                   # 主进程入口：窗口管理 + 数据融合 IPC
│   └── preload.cjs                # 预加载脚本：暴露 electronAPI 给渲染进程
├── public/
│   └── icon.svg                   # 应用图标
├── src/
│   ├── components/                # 可复用表单组件
│   │   ├── ErrorBoundary.tsx      # React 错误边界
│   │   ├── MeetingForm.tsx        # 会议录入表单（含智能参会解析）
│   │   ├── MemberForm.tsx         # 人员录入表单
│   │   └── TalkForm.tsx           # 谈心谈话录入表单
│   ├── db/
│   │   └── index.ts               # Dexie 数据库定义 + 版本迁移 + 规范化函数
│   ├── layouts/
│   │   └── MainLayout.tsx         # 主布局（侧边栏菜单 + Header + Content）
│   ├── pages/                     # 6 个主页面
│   │   ├── Dashboard.tsx          # 数据看板（ECharts 可视化）
│   │   ├── Members.tsx            # 人员管理页
│   │   ├── Meetings.tsx           # 会议管理页
│   │   ├── Talks.tsx              # 谈心谈话管理页
│   │   ├── Logs.tsx               # 操作日志页
│   │   └── Settings.tsx           # 数据管理（备份/恢复/融合/自动同步）
│   ├── types/
│   │   └── index.ts               # TypeScript 类型定义 + 常量
│   ├── utils/                     # 工具函数
│   │   ├── autoSync.ts            # 定时自动融合调度器（Electron 端）
│   │   ├── backup.ts              # 备份/恢复 + 版本迁移 + JSON/Excel 解析
│   │   ├── exportExcel.ts         # 年度台账 Excel 导出（多 Sheet）
│   │   ├── exportTalkExcel.ts     # 谈心谈话记录 Excel 导出
│   │   ├── exportWord.ts          # 看板 Word 报告导出
│   │   ├── logHelper.ts           # 操作日志写入封装
│   │   ├── memberStatus.ts        # 人员状态历史计算（按日期追溯在职）
│   │   └── mergeData.ts           # 数据融合核心策略（去重合并）
│   ├── App.tsx                    # 路由配置（6 条路由 + 错误边界）
│   ├── App.css                    # 全局样式
│   └── main.tsx                   # React 入口：HashRouter + ConfigProvider(zhCN, 红主题)
├── index.html                     # Vite 入口 HTML
├── package.json                   # 依赖 + 脚本 + electron-builder 配置
├── tsconfig.json                  # TypeScript 配置（严格模式）
├── vite.config.ts                 # Vite 配置（base: './'）
└── index.html                     # 应用入口
```

---

## 4. 主要模块职责

### 4.1 Electron 层（electron/）

#### 4.1.1 [main.cjs](file:///workspace/electron/main.cjs)
**职责**：
- 窗口创建与生命周期管理（延迟显示避免白屏、ready-to-show）
- **绿色版数据持久化**：检测 `PORTABLE_EXECUTABLE_DIR`，将 `userData` 重定向到 exe 同级目录
- 生产环境多路径候选加载 `dist/index.html`
- 外部链接在系统浏览器打开（`setWindowOpenHandler`）
- **数据融合 IPC 通道**（安全受限文件系统访问）：
  | IPC 通道 | 功能 | 安全措施 |
  |---------|------|---------|
  | `sync:select-folder` | 弹出系统目录选择对话框 | - |
  | `sync:check-folder` | 校验文件夹路径存在且可读 | 绝对路径校验 |
  | `sync:list-backup-files` | 列出文件夹内 `.json` 文件 | 存在性校验 + 仅 .json |
  | `sync:read-backup-file` | 读取备份文件内容 | `isSafeFileName`：禁止 `/` `\` `..` |
  | `sync:mark-file-merged` | 已融合文件重命名为 `.merged` 后缀 | 同上路径安全校验 |

#### 4.1.2 [preload.cjs](file:///workspace/electron/preload.cjs)
**职责**：使用 `contextBridge.exposeInMainWorld` 向渲染进程安全暴露 `window.electronAPI`：
```typescript
window.electronAPI = {
  platform, isElectron: true,
  selectSyncFolder, listBackupFiles, readBackupFile,
  markFileMerged, checkFolder
}
```

### 4.2 数据层（db/）

#### 4.2.1 [index.ts](file:///workspace/src/db/index.ts)

**数据库类** `PartyBuildingDB extends Dexie`：
- **数据库名**：`PartyBuildingLedger`
- **4 张数据表**：
  | 表名 | 主键 | 索引 | 说明 |
  |-----|------|------|------|
  | `members` | id | name, department, status, partyGroup, committeeRole | 党员信息 |
  | `meetings` | id | *type, date, host | 会议记录（type 多值索引） |
  | `operationLogs` | id | timestamp, type | 操作日志 |
  | `talkRecords` | id | talkDate, type, talkerName, targetName | 谈心谈话 |

**3 个数据版本（Schema 自动迁移）**：
- **Version 1**（V1.0）：基础三表，无 talkRecords
- **Version 2**（V2.0）：新增 talkRecords，members 加 partyGroup/committeeRole/isGroupLeader 字段；meetings.type 从 string → string[]；members.department 从数组 → 字符串
- **Version 3**（V3.0）：
  - meetings：新增 name/partyGroups 字段，类型名迁移（民主评议党员→民主生活会 等）
  - members：新增 statusHistory 状态变更历史数组
  - talkRecords：新增 timePeriod/isFiveMustTalk/remark/targetNames 字段

**规范化辅助函数**：
- `normalizeMeetingTypes(meeting)`：确保 meeting.type 始终为字符串数组且类型名已迁移
- `normalizeMeetingPartyGroups(meeting)`：确保 partyGroups 始终为数组（兼容旧 partyGroup 单值）
- `normalizeMember(member)`：确保 department 始终为字符串（兼容旧数组格式）

### 4.3 类型定义层（types/）

#### 4.3.1 [index.ts](file:///workspace/src/types/index.ts)

**核心实体接口**：

| 接口 | 关键字段 | 说明 |
|------|---------|------|
| `Member` | id, name, title, department, phone, status, partyGroup, isGroupLeader, committeeRole, statusHistory, createdAt, updatedAt | 党员信息 |
| `Participant` | memberId, name, status, isTemporary, leaveReason, isGuest | 会议参会人员 |
| `Meeting` | id, name, type[], partyGroups[], date, time, location, host, recorder, topic, summary, resolution, participants[], createdAt, updatedAt | 会议记录 |
| `TalkRecord` | id, method, type, talkerName, talkerTitle, targetName, targetNames[], contactPerson, talkDate, timePeriod, outline, location, content, isFiveMustTalk, remark | 谈心谈话 |
| `OperationLog` | id, timestamp, type, description, detail, result | 操作日志 |

**枚举常量**：
- `MeetingType`：9 种预设会议类型
- `AttendanceStatus`：`attended` / `leave` / `absent`
- `MemberStatus`：`active`(在职) / `transferred`(调离) / `seconded`(借调) / `resigned`(离职)
- `TalkMethod`：`individual`(个别) / `collective`(集体) / `organized`(组织约谈)
- `OperationType`：27 种操作类型枚举（CREATE_*, UPDATE_*, DELETE_*, EXPORT_*, IMPORT_*, BACKUP_*, RESTORE_*, MERGE_*, AUTO_* 等）

**工具函数**：
- `migrateMeetingTypeName(t)`：V2.0→V3.0 类型名映射
- `partyGroupOrder(group)`：党小组序号提取（"第三党小组"→3）
- `sortPartyGroups(groups)`：党小组排序（预设序号优先，自定义按拼音）

### 4.4 工具函数层（utils/）

#### 4.4.1 [backup.ts](file:///workspace/src/utils/backup.ts) — 备份与恢复

**备份格式（当前 Schema Version = 3）**：
```json
{
  "appVersion": "3.2.0",
  "schemaVersion": 3,
  "backupTime": "ISO8601",
  "tables": {
    "members":        { "count": N, "data": [...] },
    "meetings":       { "count": N, "data": [...] },
    "operationLogs":  { "count": N, "data": [...] },
    "talkRecords":    { "count": N, "data": [...] }
  }
}
```

**导出函数**：
- `createBackup(scope: 'all'|'meetings'|'talks')` → `Promise<Blob>`：JSON 备份，支持子集导出（组长侧）
- `createBackupExcel(scope)` → `Promise<Blob>`：Excel 备份（4 Sheet：人员/会议记录/谈心谈话/备份信息）

**导入函数**：
- `parseBackupFile(raw)`：检测格式（V1/V2/unknown），自动迁移到 V3，返回 `{success, data, migrated}`
- `parseBackupExcelFile(file)`：解析 Excel 备份，还原为 BackupData 格式

**辅助函数**：
- `getBackupSummary(backup)`：返回备份文件统计摘要
- `serializeParticipants()` / `parseParticipants()`：参会人员文本序列化/反序列化
- `migrateV1ToCurrent()` / `upgradeV2ToV3()`：版本迁移实现

#### 4.4.2 [mergeData.ts](file:///workspace/src/utils/mergeData.ts) — 数据融合

**场景**：党小组组长导出子集备份（仅会议/谈话），管理员侧执行**非覆盖融合**。

**合并策略**：
| 对象 | 策略 |
|------|------|
| 会议记录 / 人员 / 谈心谈话 | 按 id 去重——本机不存在则并入；id 相同**保留本机版本**（管理员侧优先） |
| 人员同名不同 id | 不自动合并，结果报告中 `sameNameMembers` 列出提示手动处理 |
| 操作日志 | 不并入（融合操作本身记录新日志） |

**关键函数**：
- `previewMerge(backup)` → `Promise<MergePreview>`：预览差异统计（不写库），含 add*/skip*/sameNameMembers
- `executeMerge(backup)` → `Promise<MergeResult>`：事务写入（bulkAdd 仅添加本机不存在的 id）

#### 4.4.3 [autoSync.ts](file:///workspace/src/utils/autoSync.ts) — 定时自动融合调度器

**配置持久化**（localStorage）：
- `sync_folder_path`：同步文件夹路径
- `auto_merge_enabled`：开关
- `auto_merge_interval`：频率（`30min` / `1h` / `daily8` / `startup`）
- `merged_files_list`：已处理文件名清单（双保险，容量 200 条 LRU）

**核心类** `AutoSyncManager`：
- `start(onReport)`：启动调度，按 interval 配置定时器；启动时立即执行一次
- `stop()`：清除所有定时器
- `checkNow()`：手动"立即检查"
- `runAutoSyncCheck()`：扫描文件夹 → 读取 JSON → parseBackupFile → executeMerge → 重命名 .merged + 清单记录

#### 4.4.4 [exportExcel.ts](file:///workspace/src/utils/exportExcel.ts) — 年度台账 Excel 导出

**导出内容（7~N 个 Sheet）**：
1. **会议记录明细**：主表，含序号/名称/日期/类型/地点/主持人/议题/决议/出勤统计/参会名单
2. **支委会**：分类子表（结构同上）
3. **党员大会**：分类子表
4. **各党小组会**：动态按党小组生成多个子表
5. **组织生活会**：分类子表
6. **民主生活会**：分类子表
7. **参会考勤统计**：按人员维度（应参加/实到/请假/缺席/出勤率）
8. **月度汇总**：按月统计（会议次数/累计应到/累计实到/平均出勤率）
9. **会议类型统计**：各类型次数与占比

**样式**：红色党建主题（表头背景 #C00000，白字加粗），奇偶行交替，合计行红色加粗。

#### 4.4.5 [memberStatus.ts](file:///workspace/src/utils/memberStatus.ts) — 人员状态历史

**核心逻辑**：
- `isActiveAt(member, date)`：按 `statusHistory` 追溯某日期时点人员是否在职（变更历史按日期取最近一条；早于首条记录默认在职）
- `appendStatusChange(member, newStatus, changeDate)`：追加状态变更记录（状态未变化则不追加）

#### 4.4.6 [logHelper.ts](file:///workspace/src/utils/logHelper.ts) — 操作日志

**函数** `addLog(type, description, detail?, result?)`：统一写入 operationLogs 表，自动生成 id 和 timestamp。

### 4.5 UI 组件层（components/）

#### 4.5.1 [MeetingForm.tsx](file:///workspace/src/components/MeetingForm.tsx) — 会议表单

**核心特性**：
1. **会议类型**：多选 + tags 模式，支持自定义类型（localStorage 持久化）
2. **党小组会**：联动出现"所属党小组"多选（可多选，按序号排序）
3. **参会人员管理**（集成式表格）：
   - 搜索添加：回车精确匹配→唯一命中直接添加；多命中→提示点选；无匹配→添加临时人员（带 * 标记）
   - 快捷操作：一键全选（在职）、选择支委委员、选择党小组人员、一键取消
   - 表格列：姓名/部室/党小组/列席复选框/出席情况下拉/请假原因/删除
4. **智能文本解析**（`parseAttendanceText`）：
   - 粘贴参会接龙文本 → 识别"参会/出席/请假/缺勤/列席"段落
   - 序号格式全容错：`1.` `1、` `(1)` `（1）` `1)` `01.`
   - 支持括号内请假原因：`张三（休假）`
   - 仅填请假人员：其余在职人员默认出席
   - 冲突检测：同时出现在出席与请假段→按请假处理
5. **复用上一条**：一键复用最近会议记录（日期需手动改）
6. **自定义地点**：AutoComplete，新地点自动保存为预设，可删除

#### 4.5.2 [MemberForm.tsx](file:///workspace/src/components/MemberForm.tsx) — 人员表单

**字段**：姓名、部室、部门/支部（AutoComplete）、联系电话、党小组、支委职务、党小组组长复选框、状态。

**状态变更历史**：编辑时若状态发生变化，强制要求选择"状态变更日期"，变更记录追加到 statusHistory，用于按会议日期判断在职状态。

#### 4.5.3 [TalkForm.tsx](file:///workspace/src/components/TalkForm.tsx) — 谈心谈话表单

**谈话方式** Radio 切换：
- `个别谈话`：单人谈话对象（maxCount=1）
- `集体谈话` / `组织约谈`：多谈话对象 tags 模式

**智能联动**：
- 谈话人选中人员建议后自动填充职务
- 多谈话对象：所选人员职务自动用顿号拼接
- 切换个别谈话时自动截取第一个对象

**字段**：谈话方式、谈话类型（6 种预设）、谈话人+职务、谈话对象+职务、联系人、日期、时段(上/下午)、提纲、地点、"五必谈"复选框（附 Tooltip 说明）、备注。

### 4.6 页面层（pages/）

| 页面 | 路由 | 核心功能 |
|------|------|---------|
| [Dashboard.tsx](file:///workspace/src/pages/Dashboard.tsx) | `/dashboard` `/` | 年份选择、关键指标卡片（会议总数/当月会议/平均出勤率）、ECharts：会议类型饼图、月度趋势堆叠柱状图、出勤率排行（按人/按部门）、Word 报告导出 |
| [Members.tsx](file:///workspace/src/pages/Members.tsx) | `/members` | 人员列表（表格）、搜索筛选、新增/编辑/删除、批量删除、状态色标记、状态历史查看、Excel 导入人员 |
| [Meetings.tsx](file:///workspace/src/pages/Meetings.tsx) | `/meetings` | 会议列表（按日期倒序）、类型筛选、日期范围筛选、新增/编辑/删除、年度台账 Excel 导出 |
| [Talks.tsx](file:///workspace/src/pages/Talks.tsx) | `/talks` | 谈心谈话列表、方式/类型筛选、新增/编辑/删除、Excel 导出 |
| [Logs.tsx](file:///workspace/src/pages/Logs.tsx) | `/logs` | 操作日志列表（倒序）、类型筛选、时间范围筛选、成功/失败状态 |
| [Settings.tsx](file:///workspace/src/pages/Settings.tsx) | `/settings` | 数据管理中心：JSON/Excel 备份导出、备份恢复（带预览）、数据融合（预览+执行）、自动同步配置（仅 Electron 端：选文件夹+频率+立即检查）、数据重置 |

### 4.7 布局层与路由层

#### [MainLayout.tsx](file:///workspace/src/layouts/MainLayout.tsx)
- Ant Design Layout：左侧可折叠 Sider（Logo + 6 项菜单）、顶部 Header（折叠按钮 + 标题）、Content（`<Outlet/>`）
- 应用启动时调用 `autoSyncManager.start(handleReport)`，自动融合完成后发送右下角通知 + 写入操作日志

#### [App.tsx](file:///workspace/src/App.tsx)
```
Routes
└── Route MainLayout
    ├── /          → Dashboard  (ErrorBoundary)
    ├── /dashboard → Dashboard
    ├── /members   → Members
    ├── /meetings  → Meetings
    ├── /talks     → Talks
    ├── /logs      → Logs
    ├── /settings  → Settings
    └── *          → Navigate /
```
每个页面路由均包裹 `<ErrorBoundary>`。

#### [main.tsx](file:///workspace/src/main.tsx)
```
ReactDOM.createRoot
└── React.StrictMode
    └── ConfigProvider (locale=zhCN, theme={colorPrimary: #CC0000})
        └── HashRouter
            └── App
```

---

## 5. 关键类与函数索引

### 5.1 数据库类
| 类/函数 | 文件 | 说明 |
|---------|------|------|
| `PartyBuildingDB` | [db/index.ts](file:///workspace/src/db/index.ts#L5-L88) | Dexie 数据库类，3 个版本 Schema 迁移 |
| `db` (单例) | [db/index.ts](file:///workspace/src/db/index.ts#L90) | 全局数据库实例 |
| `normalizeMeetingTypes()` | [db/index.ts](file:///workspace/src/db/index.ts#L93-L100) | 会议类型规范化 |
| `normalizeMember()` | [db/index.ts](file:///workspace/src/db/index.ts#L113-L121) | 人员信息规范化 |

### 5.2 备份与融合
| 函数 | 文件 | 说明 |
|------|------|------|
| `createBackup()` | [backup.ts](file:///workspace/src/utils/backup.ts#L68-L95) | 导出 JSON 备份 |
| `createBackupExcel()` | [backup.ts](file:///workspace/src/utils/backup.ts#L132-L218) | 导出 Excel 备份（4 Sheet） |
| `parseBackupFile()` | [backup.ts](file:///workspace/src/utils/backup.ts#L596-L628) | 解析 JSON 备份（V1/V2→V3 自动迁移） |
| `parseBackupExcelFile()` | [backup.ts](file:///workspace/src/utils/backup.ts#L286-L410) | 解析 Excel 备份 |
| `previewMerge()` | [mergeData.ts](file:///workspace/src/utils/mergeData.ts#L41-L94) | 融合预览（统计差异） |
| `executeMerge()` | [mergeData.ts](file:///workspace/src/utils/mergeData.ts#L97-L136) | 事务执行融合 |

### 5.3 自动同步调度
| 类/函数 | 文件 | 说明 |
|---------|------|------|
| `AutoSyncManager` | [autoSync.ts](file:///workspace/src/utils/autoSync.ts#L196-L271) | 定时融合调度器类 |
| `autoSyncManager` | [autoSync.ts](file:///workspace/src/utils/autoSync.ts#L273) | 全局单例 |
| `runAutoSyncCheck()` | [autoSync.ts](file:///workspace/src/utils/autoSync.ts#L111-L177) | 单次扫描与融合执行 |

### 5.4 人员状态
| 函数 | 文件 | 说明 |
|------|------|------|
| `isActiveAt()` | [memberStatus.ts](file:///workspace/src/utils/memberStatus.ts#L11-L21) | 按日期追溯在职状态 |
| `appendStatusChange()` | [memberStatus.ts](file:///workspace/src/utils/memberStatus.ts#L27-L41) | 追加状态变更历史 |

### 5.5 导出
| 函数 | 文件 | 说明 |
|------|------|------|
| `exportAnnualLedger()` | [exportExcel.ts](file:///workspace/src/utils/exportExcel.ts#L217-L415) | 年度台账 Excel 导出（多 Sheet） |
| `addLog()` | [logHelper.ts](file:///workspace/src/utils/logHelper.ts#L5-L23) | 写入操作日志 |

### 5.6 表单核心（智能解析）
| 函数 | 文件 | 说明 |
|------|------|------|
| `parseAttendanceText()` | [MeetingForm.tsx](file:///workspace/src/components/MeetingForm.tsx#L163-L216) | 参会接龙文本智能解析 |
| `extractNames()` | [MeetingForm.tsx](file:///workspace/src/components/MeetingForm.tsx#L108-L119) | 姓名提取（序号/分隔符全容错） |
| `matchMember()` | [MeetingForm.tsx](file:///workspace/src/components/MeetingForm.tsx#L219-L233) | 姓名三级匹配（精确→包含→去空格） |

---

## 6. 依赖关系图

```
main.tsx (入口)
 ├── App.tsx (路由)
 │   ├── MainLayout.tsx
 │   │   ├── autoSync.ts ←────┐
 │   │   │   └── mergeData.ts  │
 │   │   │       └── db/index  │
 │   │   │       └── backup.ts─┘
 │   │   └── Outlet → 6 Pages
 │   │       ├── Dashboard.tsx
 │   │       │   ├── echarts-for-react
 │   │       │   ├── db/index
 │   │       │   ├── exportWord.ts
 │   │       │   └── logHelper.ts
 │   │       ├── Members.tsx
 │   │       │   ├── MemberForm.tsx
 │   │       │   ├── db/index
 │   │       │   └── memberStatus.ts
 │   │       ├── Meetings.tsx
 │   │       │   ├── MeetingForm.tsx
 │   │       │   ├── exportExcel.ts
 │   │       │   └── db/index
 │   │       ├── Talks.tsx
 │   │       │   ├── TalkForm.tsx
 │   │       │   ├── exportTalkExcel.ts
 │   │       │   └── db/index
 │   │       ├── Logs.tsx
 │   │       │   └── db/index
 │   │       └── Settings.tsx
 │   │           ├── backup.ts (JSON/Excel 备份恢复)
 │   │           ├── mergeData.ts (融合)
 │   │           ├── autoSync.ts (自动同步)
 │   │           └── db/index
 │   └── ErrorBoundary.tsx (包裹每个页面)
 └── ConfigProvider (antd 中文+红主题)
```

---

## 7. 项目运行方式

### 7.1 环境要求
- Node.js >= 18
- npm >= 9

### 7.2 安装依赖
```bash
cd /workspace
npm install
```

### 7.3 开发模式

#### 方式一：纯 Web 开发（浏览器模式，Electron 特性不可用）
```bash
npm run dev
```
- 启动 Vite 开发服务器：`http://localhost:5173`
- 自动融合、文件对话框等 Electron 功能会被降级或禁用

#### 方式二：Electron 桌面开发
```bash
npm run dev:electron
```
- 并发启动 Vite（5173）+ Electron 窗口
- 主窗口自动加载 `http://localhost:5173`
- DevTools 自动以 detached 模式打开
- Electron 数据融合 IPC 可用

### 7.4 构建生产版本

#### 纯 Web 构建
```bash
npm run build
```
- 输出目录：`/workspace/dist`
- TypeScript 编译 → Vite 打包

#### Electron 桌面安装包构建
```bash
npm run build:electron
```
1. 先执行 `npm run build` 生成 dist
2. 调用 electron-builder 打包
3. 输出目录：`/workspace/build-output`
4. Windows 目标产物：
   - **NSIS 安装版**：`党建工作台账_3.2.0_x64.exe`
     - 非一键安装、允许自定义目录、创建桌面/开始菜单快捷方式、简体中文
   - **绿色便携版**：`党建工作台账_3.2.0_绿色版.exe`
     - 数据自动保存到 exe 同级 `userData/` 目录（不依赖系统 AppData）

### 7.5 预览生产构建
```bash
npm run preview
```
本地预览 Vite 构建产物。

---

## 8. 数据流与核心流程

### 8.1 会议录入流程
```
用户打开 MeetingForm
  → 加载 members 列表 + 预设地点 + 自定义类型
  → 选择会议类型（含党小组会联动）
  → 选择日期（candidateMembers 按该日期时点在职状态过滤）
  → 方式A：粘贴接龙文本 → parseAttendanceText → 预览 → 确认导入
  → 方式B：搜索添加 / 一键全选 / 选择支委 / 选择党小组人员
  → 调整每人状态（出席/请假/缺席）、列席标记、请假原因
  → 提交 → 写入库 db.meetings.add() → addLog(CREATE_MEETING)
```

### 8.2 数据融合流程（管理员侧）
```
组长导出备份 (JSON/Excel) → 放到同步文件夹
  ↓
Settings 页面: 选择备份文件 → upload
  ↓
parseBackupFile / parseBackupExcelFile
  → 检测格式 (V1/V2) → 自动迁移到 V3
  ↓
previewMerge() → 显示预览：新增X/跳过X/同名冲突人员
  ↓
用户确认 → executeMerge()
  → db.transaction rw (members, meetings, talkRecords)
  → 过滤本机已存在 id → bulkAdd 仅新增
  ↓
addLog(MERGE_DATA) → 刷新列表
```

### 8.3 定时自动融合（Electron 端）
```
App 启动 → MainLayout useEffect → autoSyncManager.start()
  → 读取 localStorage 配置 (enabled/folderPath/interval)
  → 启动时立即执行一次 (runAutoSyncCheck)
  → 设定时器 (30min/1h/daily8@8点/仅启动)
  ↓
每次检查：
  → api.listBackupFiles(folder) → *.json
  → 过滤掉 merged_files_list 中已记录的
  → 对每个文件: readBackupFile → JSON.parse → parseBackupFile
    → executeMerge → api.markFileMerged (加 .merged 后缀)
    → appendMergedList (双保险)
  ↓
完成 → onReport 回调 → 通知 + addLog(AUTO_MERGE_DATA)
```

### 8.4 按日期判断在职（出勤统计核心）
```
给定 member + meeting.date
  ↓
isActiveAt(member, meetingDate)
  → member.statusHistory 是否存在？
    ├── 不存在 → 直接看 member.status
    └── 存在 → 过滤出 date <= meetingDate 的变更记录
        ├── 0 条（meetingDate 早于首次记录）→ 默认在职
        └── N 条 → 取最近一条的 status 是否为 active
```
这确保了对调离/借调/离职人员的历史出勤统计准确无误。

---

## 9. 配置与持久化存储

### 9.1 localStorage 键值清单
| Key | 说明 | 模块 |
|-----|------|------|
| `custom_meeting_types` | 自定义会议类型数组 | MeetingForm |
| `preset_locations` | 自定义会议地点数组 | MeetingForm |
| `sync_folder_path` | 自动融合同步文件夹路径 | autoSync |
| `auto_merge_enabled` | 是否启用自动融合（true/false） | autoSync |
| `auto_merge_interval` | 频率：30min / 1h / daily8 / startup | autoSync |
| `merged_files_list` | 已处理文件组合键列表（容量 200） | autoSync |
| `auto_merge_last_daily` | daily8 模式上次执行日期（YYYY-MM-DD） | autoSync |

### 9.2 IndexedDB 数据库
- 数据库名：`PartyBuildingLedger`
- 版本：3（Dexie 自动升级）
- 存储位置：浏览器本地 / Electron `userData` 目录（绿色版重定向到 exe 同级）

### 9.3 TypeScript 编译配置（严格模式）
- `target: ES2023` / `module: ESNext`
- `strict: true`
- `noUnusedLocals: false`（开发便利）
- `noUnusedParameters: false`
- `moduleResolution: bundler`

---

## 10. 版本升级与数据迁移策略

项目内置三级向前兼容：

| 版本迁移 | 触发时机 | 迁移内容 |
|---------|---------|---------|
| **DB V1 → V2** | 打开应用时 Dexie `.upgrade()` | members 加 partyGroup/isGroupLeader/committeeRole；department 数组→字符串；status 'inactive'→'resigned'；meetings.type string→string[]；新增 talkRecords 表 |
| **DB V2 → V3** | 同上 | meetings 加 name/partyGroups、类型名迁移；members 加 statusHistory 初始化；talkRecords 加 timePeriod/isFiveMustTalk/remark/targetNames |
| **JSON 备份 V1 → 当前** | 恢复备份时 parseBackupFile() | 同 DB V1→V2 + V2→V3 全部迁移逻辑 |
| **JSON 备份 V2 → V3** | 同上 | upgradeV2ToV3()：类型名迁移 + 新字段默认值填充 |

迁移设计原则：**只补字段不改语义**，对历史记录不做破坏性变更。

---

## 11. 安全设计考量

1. **Electron 上下文隔离**：`contextIsolation: true` + `nodeIntegration: false`，渲染进程无法直接访问 Node API，仅通过 preload 暴露的白名单 API
2. **文件路径安全**：
   - `isSafeFileName()`：禁止文件名包含 `/` `\` `..`（防止路径穿越）
   - `isValidFolderPath()`：要求绝对路径 + 实际存在且为目录
   - 备份文件读取始终限定在用户选择的 folderPath 内
3. **绿色版数据隔离**：便携版数据写入 exe 同级目录，避免污染系统 AppData，U 盘携带即可完整迁移
4. **数据库事务**：融合写入使用 Dexie `db.transaction('rw', 3表, ...)` 保证原子性
5. **融合去重安全**：管理员侧优先策略——本机已有 id 绝不被外部备份覆盖，避免组长误操作覆盖管理员数据

---

## 12. 文件索引（快速导航）

| 分类 | 文件 | 关键行 |
|------|------|--------|
| 配置 | [package.json](file:///workspace/package.json) | L1-93（依赖/脚本/electron-builder） |
| 配置 | [vite.config.ts](file:///workspace/vite.config.ts) | L1-9 |
| 配置 | [tsconfig.json](file:///workspace/tsconfig.json) | L1-21 |
| 入口 | [main.tsx](file:///workspace/src/main.tsx) | L1-25 |
| 路由 | [App.tsx](file:///workspace/src/App.tsx) | L1-28 |
| 布局 | [MainLayout.tsx](file:///workspace/src/layouts/MainLayout.tsx) | L1-120 |
| 数据库 | [db/index.ts](file:///workspace/src/db/index.ts) | L1-121 |
| 类型 | [types/index.ts](file:///workspace/src/types/index.ts) | L1-253 |
| Electron 主 | [electron/main.cjs](file:///workspace/electron/main.cjs) | L1-192 |
| Electron 预加载 | [electron/preload.cjs](file:///workspace/electron/preload.cjs) | L1-19 |
| 备份 | [utils/backup.ts](file:///workspace/src/utils/backup.ts) | L1-649 |
| 融合 | [utils/mergeData.ts](file:///workspace/src/utils/mergeData.ts) | L1-136 |
| 自动同步 | [utils/autoSync.ts](file:///workspace/src/utils/autoSync.ts) | L1-273 |
| Excel 导出 | [utils/exportExcel.ts](file:///workspace/src/utils/exportExcel.ts) | L1-415 |
| 人员状态 | [utils/memberStatus.ts](file:///workspace/src/utils/memberStatus.ts) | L1-41 |
| 日志 | [utils/logHelper.ts](file:///workspace/src/utils/logHelper.ts) | L1-23 |
| 会议表单 | [components/MeetingForm.tsx](file:///workspace/src/components/MeetingForm.tsx) | L1-1057 |
| 人员表单 | [components/MemberForm.tsx](file:///workspace/src/components/MemberForm.tsx) | L1-160 |
| 谈话表单 | [components/TalkForm.tsx](file:///workspace/src/components/TalkForm.tsx) | L1-284 |
| 看板页 | [pages/Dashboard.tsx](file:///workspace/src/pages/Dashboard.tsx) | L1+ |
| 数据管理页 | [pages/Settings.tsx](file:///workspace/src/pages/Settings.tsx) | 备份/恢复/融合/自动同步配置 |

---

*本文档由 Code Wiki 生成器自动整理，版本对应 package.json 中 `3.2.0`。*
