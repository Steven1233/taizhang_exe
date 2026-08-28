import { useState, useEffect, useCallback } from 'react';
import { Table, Button, Input, Select, Space, Tag, Modal, Upload, message, Radio, DatePicker, Alert } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, UploadOutlined, DownloadOutlined, SearchOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import { v4 as uuidv4 } from 'uuid';
import type { Member, MemberStatus, MemberStatusChange, MemberChangeLog } from '../types';
import { MEMBER_STATUS_LABEL, MEMBER_STATUS_COLOR, sortPartyGroups } from '../types';
import { db, normalizeMember } from '../db';
import { addLog } from '../utils/logHelper';
import { appendStatusChange } from '../utils/memberStatus';
import MemberForm from '../components/MemberForm';

// 导入行（V3.4 功能 4/7：含状态时间线与同名查重决策）
interface ImportRow {
  key: string;
  name: string;
  title: string;
  department: string;
  phone: string;
  partyGroup: string;
  isGroupLeader: boolean;
  committeeRole: string;
  status: MemberStatus;                  // 当前状态（未填状态列时为 active）
  hasStatus: boolean;                    // 是否填写了"当前状态"列（更新模式应用状态的依据）
  statusChangeDate: string;              // 状态变更日期列（可为空）
  statusHistory: MemberStatusChange[];   // 按功能 4 构建的状态时间线
  duplicateOf?: Member;                 // 本机同名人员（查重命中）
  decision: 'skip' | 'update' | 'create';  // 同名处理决策（默认跳过）
}

// 导入状态列中文 → 状态值映射（功能 4）
const IMPORT_STATUS_MAP: Record<string, MemberStatus> = {
  '在职': 'active',
  '调离': 'transferred',
  '借调': 'seconded',
  '离职': 'resigned',
};

// 退出状态选项（V3.4 功能 2c：调离/借调/离职）
const EXIT_STATUS_OPTIONS = (['transferred', 'seconded', 'resigned'] as MemberStatus[]).map(
  (v) => ({ label: MEMBER_STATUS_LABEL[v], value: v })
);

/** 解析导入的日期单元格（Date 对象 / Excel 序列号 / 常见字符串格式），失败返回空串 */
function parseImportDate(v: unknown): string {
  if (v == null || v === '') return '';
  if (v instanceof Date) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  }
  const s = String(v).trim();
  if (/^\d+$/.test(s)) {
    // 纯数字按 Excel 日期序列号处理（限定合理年份范围，避免误伤普通数字）
    const n = Number(s);
    if (n >= 20000 && n <= 80000) {
      const dt = new Date(Math.round((n - 25569) * 86400000));
      return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
    }
    return '';
  }
  const m = s.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  return '';
}

/** 功能 4：按入职日期/当前状态/状态变更日期构建导入时间线（三列留空时行为与现状完全一致） */
function buildImportHistory(
  status: MemberStatus,
  initialDate: string,
  changeDate: string,
  today: string
): MemberStatusChange[] {
  if (status === 'active') {
    return [{ status: 'active', date: initialDate || today }];
  }
  const cd = changeDate || today;
  // 有入职日期且早于状态变更日期 → 完整时间线（在职 → 退出状态）；否则首条直接记退出状态
  if (initialDate && initialDate < cd) {
    return [
      { status: 'active', date: initialDate },
      { status, date: cd },
    ];
  }
  return [{ status, date: cd }];
}

/** 功能 2b：编辑保存时自动 diff 信息字段，追加只读留痕（不参与任何统计判定） */
function buildChangeHistory(
  oldMember: Member,
  newValues: {
    name: string;
    title: string;
    department: string;
    phone: string;
    partyGroup: string;
    isGroupLeader: boolean;
    committeeRole: string;
    status: MemberStatus;
  },
  date: string
): MemberChangeLog[] {
  const diffs = [
    { field: '姓名', oldValue: oldMember.name, newValue: newValues.name },
    { field: '部室', oldValue: oldMember.title || '', newValue: newValues.title || '' },
    { field: '部门/支部', oldValue: oldMember.department || '', newValue: newValues.department || '' },
    { field: '党小组', oldValue: oldMember.partyGroup || '', newValue: newValues.partyGroup || '' },
    { field: '支委职务', oldValue: oldMember.committeeRole || '', newValue: newValues.committeeRole || '' },
    { field: '党小组组长', oldValue: oldMember.isGroupLeader ? '是' : '否', newValue: newValues.isGroupLeader ? '是' : '否' },
    { field: '联系电话', oldValue: oldMember.phone || '', newValue: newValues.phone || '' },
    { field: '状态', oldValue: MEMBER_STATUS_LABEL[oldMember.status], newValue: MEMBER_STATUS_LABEL[newValues.status] },
  ].filter((d) => d.oldValue !== d.newValue);
  if (diffs.length === 0) return oldMember.changeHistory || [];
  const logs = oldMember.changeHistory ? [...oldMember.changeHistory] : [];
  diffs.forEach((d) => logs.push({ date, ...d }));
  return logs;
}

/** 展示用部门文本（兼容旧版数组格式） */
function displayDept(d: unknown): string {
  const s = Array.isArray(d) ? d.filter(Boolean).join('、') : String(d || '');
  return s || '-';
}

export default function Members() {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [filterDept, setFilterDept] = useState<string>('');
  const [filterGroup, setFilterGroup] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<MemberStatus | ''>('');
  const [formOpen, setFormOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<Member | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  // 删除弹窗状态（V3.2：支持彻底删除录入有误人员；V3.4 功能 2c：保留信息时状态与日期可选）
  const [deleteTarget, setDeleteTarget] = useState<Member | null>(null);
  const [deleteMeetingCount, setDeleteMeetingCount] = useState(0);
  const [deleteMode, setDeleteMode] = useState<'resign' | 'purge'>('resign');
  const [deleteStatus, setDeleteStatus] = useState<MemberStatus>('resigned');
  const [deleteDate, setDeleteDate] = useState<Dayjs | null>(null);
  const [deleting, setDeleting] = useState(false);
  // 批量删除弹窗（V3.4 功能 2c：只弹一次窗，统一应用所选状态与日期）
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
  const [batchDeleteStatus, setBatchDeleteStatus] = useState<MemberStatus>('resigned');
  const [batchDeleteDate, setBatchDeleteDate] = useState<Dayjs | null>(null);
  const [batchDeleting, setBatchDeleting] = useState(false);
  // 导入查重弹窗（V3.4 功能 7：同名人员处理选择）
  const [pendingImport, setPendingImport] = useState<{ rows: ImportRow[]; now: string } | null>(null);

  const loadMembers = useCallback(async () => {
    try {
      setLoading(true);
      const data = await db.members.toArray();
      setMembers(data.map((m) => normalizeMember(m)));
    } catch (err) {
      console.error('加载人员数据失败:', err);
      message.error('加载人员数据失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMembers();
  }, [loadMembers]);

  const filtered = members.filter((m) => {
    const mDept = Array.isArray(m.department) ? m.department.join('、') : (m.department || '');
    if (searchText && !m.name.includes(searchText) && !(m.phone || '').includes(searchText) && !(m.title || '').includes(searchText)) return false;
    if (filterDept && mDept !== filterDept) return false;
    if (filterGroup && m.partyGroup !== filterGroup) return false;
    if (filterStatus && m.status !== filterStatus) return false;
    return true;
  });

  const handleAdd = () => {
    setEditingMember(null);
    setFormOpen(true);
  };

  const handleEdit = (member: Member) => {
    setEditingMember(member);
    setFormOpen(true);
  };

  // 删除人员（V3.2：弹窗选择"标记离职"或"彻底删除"；V3.4 功能 2c：退出状态与日期可选）
  const handleDelete = async (member: Member) => {
    const meetingCount = await db.meetings
      .filter((m) => m.participants.some((p) => p.memberId === member.id))
      .count();
    setDeleteMeetingCount(meetingCount);
    setDeleteMode('resign');
    setDeleteStatus('resigned');
    setDeleteDate(dayjs());
    setDeleteTarget(member);
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      if (deleteMeetingCount === 0 || deleteMode === 'purge') {
        // 彻底删除：删除人员档案；有关联记录时同步从参会名单移除（事务执行）
        const target = deleteTarget;
        const count = deleteMeetingCount;
        await db.transaction('rw', db.members, db.meetings, async () => {
          await db.members.delete(target.id);
          if (count > 0) {
            const related = await db.meetings
              .filter((m) => m.participants.some((p) => p.memberId === target.id))
              .toArray();
            const now = new Date().toISOString();
            for (const mtg of related) {
              await db.meetings.update(mtg.id, {
                participants: mtg.participants.filter((p) => p.memberId !== target.id),
                updatedAt: now,
              });
            }
          }
        });
        await addLog(
          'DELETE_MEMBER',
          count > 0
            ? `彻底删除人员：${target.name}（同步移除${count}条参会记录）`
            : `彻底删除人员：${target.name}（无关联会议记录）`,
          { memberId: target.id, meetingCount: count }
        );
        message.success(
          count > 0
            ? `已彻底删除 ${target.name}（同步移除 ${count} 条参会记录）`
            : `已彻底删除 ${target.name}`
        );
      } else {
        // 保留信息：按所选状态与实际日期标记退出（V3.4 功能 2c，原为写死"离职 + 今天"）
        const target = deleteTarget;
        const changeDate = deleteDate
          ? deleteDate.format('YYYY-MM-DD')
          : new Date().toISOString().substring(0, 10);
        await db.members.update(target.id, {
          status: deleteStatus,
          statusHistory: appendStatusChange(target, deleteStatus, changeDate),
          updatedAt: new Date().toISOString(),
        });
        await addLog('DELETE_MEMBER', `删除人员：${target.name}（有${deleteMeetingCount}条会议记录，标记为${MEMBER_STATUS_LABEL[deleteStatus]}）`, {
          memberId: target.id,
          meetingCount: deleteMeetingCount,
        });
        message.success(`已将 ${target.name} 标记为${MEMBER_STATUS_LABEL[deleteStatus]}（关联${deleteMeetingCount}条会议记录已保留）`);
      }
      setDeleteTarget(null);
      loadMembers();
    } finally {
      setDeleting(false);
    }
  };

  const handleBatchDelete = () => {
    if (selectedRowKeys.length === 0) {
      message.warning('请先选择要删除的人员');
      return;
    }
    setBatchDeleteStatus('resigned');
    setBatchDeleteDate(dayjs());
    setBatchDeleteOpen(true);
  };

  // 批量删除确认：标记保留的人员统一应用所选状态与日期（V3.4 功能 2c）
  const handleBatchDeleteConfirm = async () => {
    const ids = selectedRowKeys.map((k) => String(k));
    setBatchDeleting(true);
    try {
      let permanentCount = 0;
      let resignCount = 0;
      const changeDate = batchDeleteDate
        ? batchDeleteDate.format('YYYY-MM-DD')
        : new Date().toISOString().substring(0, 10);
      for (const id of ids) {
        const member = await db.members.get(id);
        if (!member) continue;
        const meetingCount = await db.meetings
          .filter((m) => m.participants.some((p) => p.memberId === id))
          .count();
        if (meetingCount > 0) {
          await db.members.update(id, {
            status: batchDeleteStatus,
            statusHistory: appendStatusChange(member, batchDeleteStatus, changeDate),
            updatedAt: new Date().toISOString(),
          });
          resignCount++;
        } else {
          await db.members.delete(id);
          permanentCount++;
        }
      }
      await addLog('BATCH_DELETE_MEMBER', `批量删除：彻底删除${permanentCount}人，标记${MEMBER_STATUS_LABEL[batchDeleteStatus]}${resignCount}人`, {
        ids,
      });
      message.success(`已处理 ${ids.length} 名人员（彻底删除${permanentCount}人，标记${MEMBER_STATUS_LABEL[batchDeleteStatus]}${resignCount}人）`);
      setSelectedRowKeys([]);
      setBatchDeleteOpen(false);
      loadMembers();
    } finally {
      setBatchDeleting(false);
    }
  };

  const handleFormOk = async (values: {
    name: string;
    title: string;
    department: string;
    phone: string;
    status: MemberStatus;
    partyGroup: string;
    isGroupLeader: boolean;
    committeeRole: string;
    statusChangeDate?: Dayjs;
    statusHistory?: MemberStatusChange[];
  }) => {
    const now = new Date().toISOString();
    const dept = (values.department || '').trim();
    const changeDate = values.statusChangeDate?.format('YYYY-MM-DD');
    // 剔除 statusChangeDate 与 statusHistory，仅保留实体字段
    const { statusChangeDate: _omit, statusHistory: _omitHistory, ...entityValues } = values;

    if (editingMember) {
      // 状态历史：以弹窗"变更历史"表格整理后的时间线为基准（V3.4 功能 2a，替代原"仅追加"逻辑）
      let statusHistory = values.statusHistory;
      const statusChanged = values.status !== editingMember.status;
      if (statusChanged) {
        statusHistory = appendStatusChange(
          { ...editingMember, statusHistory },
          values.status,
          changeDate || now.substring(0, 10)
        );
      }
      const sorted = [...(statusHistory || [])].sort((a, b) => a.date.localeCompare(b.date));
      // 最终状态 = 时间线末条状态；时间线删空时回退表单所选状态兜底
      const finalStatus = sorted.length > 0 ? sorted[sorted.length - 1].status : values.status;
      // 信息变更自动留痕（V3.4 功能 2b）
      const changeHistory = buildChangeHistory(
        editingMember,
        { ...entityValues, status: finalStatus, department: dept },
        now.substring(0, 10)
      );
      await db.members.update(editingMember.id, {
        ...entityValues,
        status: finalStatus,
        department: dept,
        statusHistory: sorted,
        changeHistory,
        updatedAt: now,
      });
      await addLog('UPDATE_MEMBER', `编辑人员：${values.name}`, { memberId: editingMember.id });
      message.success('人员信息已更新');
    } else {
      // 检查是否存在同名离职人员
      const existingResigned = await db.members
        .filter((m) => m.name === values.name && m.status === 'resigned')
        .first();

      if (existingResigned) {
        Modal.confirm({
          title: '检测到同名离职人员',
          content: `数据库中已存在名为"${values.name}"的离职人员。是否恢复该人员为在职状态并更新信息？`,
          okText: '恢复并更新',
          cancelText: '新建人员',
          onOk: async () => {
            await db.members.update(existingResigned.id, {
              ...entityValues,
              department: dept,
              status: 'active' as MemberStatus,
              statusHistory: appendStatusChange(existingResigned, 'active', changeDate || now.substring(0, 10)),
              updatedAt: now,
            });
            await addLog('UPDATE_MEMBER', `恢复并更新人员：${values.name}`, {
              memberId: existingResigned.id,
            });
            message.success(`已恢复 ${values.name} 为在职状态`);
            setFormOpen(false);
            loadMembers();
          },
          onCancel: async () => {
            await createNewMember();
            setFormOpen(false);
            loadMembers();
          },
        });
        return;
      }

      // 同名人员拦截（V3.4 功能 7：不再静默新建同名记录，复用离职恢复弹窗交互模式）
      const existingSameName = await db.members.filter((m) => m.name === values.name).first();
      if (existingSameName) {
        Modal.confirm({
          title: '已存在同名人员',
          content: `数据库中已存在名为"${values.name}"的人员（当前状态：${MEMBER_STATUS_LABEL[existingSameName.status]}），是否仍新建一条人员记录？`,
          okText: '仍新建',
          cancelText: '取消',
          onOk: async () => {
            await createNewMember();
            setFormOpen(false);
            loadMembers();
          },
        });
        return;
      }

      await createNewMember();
    }

    async function createNewMember() {
      const newMember: Member = {
        id: uuidv4(),
        name: values.name,
        title: values.title || '',
        department: dept,
        phone: values.phone || '',
        status: values.status || 'active',
        partyGroup: values.partyGroup || '',
        isGroupLeader: values.isGroupLeader || false,
        committeeRole: values.committeeRole || '',
        statusHistory: [{ status: values.status || 'active', date: now.substring(0, 10) }],
        createdAt: now,
        updatedAt: now,
      };
      await db.members.add(newMember);
      await addLog('CREATE_MEMBER', `新增人员：${values.name}`, { memberId: newMember.id });
      message.success('人员已添加');
    }

    setFormOpen(false);
    loadMembers();
  };

  // 执行导入：按每行决策入库（跳过/更新本机/新建），汇总提示（V3.4 功能 7）
  const executeImport = async (rows: ImportRow[], now: string) => {
    const today = now.substring(0, 10);
    let added = 0;
    let updated = 0;
    let skipped = 0;
    for (const r of rows) {
      if (r.duplicateOf && r.decision === 'skip') {
        skipped++;
        continue;
      }
      if (r.duplicateOf && r.decision === 'update') {
        // 更新：仅覆盖导入表中非空的字段（姓名同名的本机记录保留 id 与历史数据）
        const local = r.duplicateOf;
        const patch: Partial<Member> = { updatedAt: now };
        if (r.title) patch.title = r.title;
        if (r.department) patch.department = r.department;
        if (r.phone) patch.phone = r.phone;
        if (r.partyGroup) patch.partyGroup = r.partyGroup;
        if (r.isGroupLeader) patch.isGroupLeader = true;
        if (r.committeeRole) patch.committeeRole = r.committeeRole;
        if (r.hasStatus && r.status !== local.status) {
          patch.status = r.status;
          patch.statusHistory = appendStatusChange(local, r.status, r.statusChangeDate || today);
        }
        await db.members.update(local.id, patch);
        updated++;
        continue;
      }
      await db.members.add({
        id: uuidv4(),
        name: r.name,
        title: r.title || '',
        department: r.department || '',
        phone: r.phone || '',
        status: r.status,
        partyGroup: r.partyGroup || '',
        isGroupLeader: r.isGroupLeader,
        committeeRole: r.committeeRole || '',
        statusHistory: r.statusHistory,
        createdAt: now,
        updatedAt: now,
      });
      added++;
    }
    await addLog('IMPORT_MEMBERS', `批量导入：新增${added}人，更新${updated}人，跳过${skipped}人`);
    message.success(`导入完成：新增 ${added} 人、更新 ${updated} 人、跳过 ${skipped} 人`);
  };

  const handleImport = async (file: File) => {
    try {
      // 动态导入 xlsx-js-style，避免页面加载时失败导致白屏
      const XLSX = await import('xlsx-js-style');
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const data = new Uint8Array(e.target!.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: 'array' });
          const sheet = workbook.Sheets[workbook.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);
          const now = new Date().toISOString();
          const today = now.substring(0, 10);
          const parsed: ImportRow[] = [];
          for (const row of rows) {
            const name = String(row['姓名'] || '').trim();
            if (!name) continue;
            // 功能 4：解析入职日期/当前状态/状态变更日期，构建完整时间线（列留空维持现状）
            const initialDate = parseImportDate(row['入职日期']);
            const statusText = String(row['当前状态'] || '').trim();
            const statusChangeDate = parseImportDate(row['状态变更日期']);
            const status = IMPORT_STATUS_MAP[statusText] || 'active';
            parsed.push({
              key: uuidv4(),
              name,
              // 兼容"职务"（旧模板）和"部室"（新模板）两种列名
              title: String(row['部室'] || row['职务'] || ''),
              // 兼容"部门/支部"（V3.2新模板）和"部门"（旧模板）两种列名
              department: String(row['部门/支部'] || row['部门'] || ''),
              phone: String(row['联系电话'] || ''),
              partyGroup: String(row['党小组'] || ''),
              isGroupLeader: row['党小组组长'] === '是',
              committeeRole: String(row['支委职务'] || ''),
              status,
              hasStatus: !!IMPORT_STATUS_MAP[statusText],
              statusChangeDate,
              statusHistory: buildImportHistory(status, initialDate, statusChangeDate, today),
              decision: 'skip',
            });
          }
          if (parsed.length === 0) {
            message.warning('未解析到有效人员数据，请确认文件包含"姓名"列');
            return;
          }
          // 功能 7：按姓名比对本机人员库
          const allMembers = await db.members.toArray();
          parsed.forEach((r) => {
            r.duplicateOf = allMembers.find((m) => m.name === r.name);
          });
          if (!parsed.some((r) => r.duplicateOf)) {
            // 无同名：直接导入
            await executeImport(parsed, now);
            loadMembers();
          } else {
            // 有同名：弹窗逐人选择处理方式（默认跳过）
            setPendingImport({ rows: parsed, now });
          }
        } catch {
          message.error('导入失败，请检查文件格式');
        }
      };
      reader.readAsArrayBuffer(file);
    } catch {
      message.error('导入模块加载失败');
    }
    return false;
  };

  const handleDownloadTemplate = async () => {
    try {
      // 动态导入 xlsx-js-style
      const XLSX = await import('xlsx-js-style');
      const wb = XLSX.utils.book_new();
      // V3.4 功能 4：新增入职日期/当前状态/状态变更日期三个可选列（留空行为与旧模板一致）
      const ws = XLSX.utils.json_to_sheet([
        { 姓名: '', 部室: '', '部门/支部': '', 党小组: '', 党小组组长: '', 支委职务: '', 联系电话: '', 入职日期: '', 当前状态: '', 状态变更日期: '' },
      ]);
      XLSX.utils.book_append_sheet(wb, ws, '人员名单');
      const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      const blob = new Blob([wbout], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = '人员导入模板.xlsx';
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      message.error('模板下载失败');
    }
  };

  // 导入查重弹窗：同名行与汇总（V3.4 功能 7）
  const dupImportRows = pendingImport?.rows.filter((r) => r.duplicateOf) ?? [];
  const importSummary = (() => {
    if (!pendingImport) return null;
    const skipCount = dupImportRows.filter((r) => r.decision === 'skip').length;
    const updateCount = dupImportRows.filter((r) => r.decision === 'update').length;
    return { added: pendingImport.rows.length - skipCount - updateCount, updated: updateCount, skipped: skipCount };
  })();

  const setImportDecision = (key: string, decision: ImportRow['decision']) => {
    setPendingImport((prev) =>
      prev ? { ...prev, rows: prev.rows.map((r) => (r.key === key ? { ...r, decision } : r)) } : prev
    );
  };

  const setAllImportDecisions = (decision: ImportRow['decision']) => {
    setPendingImport((prev) =>
      prev ? { ...prev, rows: prev.rows.map((r) => (r.duplicateOf ? { ...r, decision } : r)) } : prev
    );
  };

  const handleImportConfirm = async () => {
    if (!pendingImport) return;
    const { rows, now } = pendingImport;
    setPendingImport(null);
    try {
      await executeImport(rows, now);
    } catch {
      message.error('导入失败，请检查文件格式');
    }
    loadMembers();
  };

  // 部门去重：兼容数组/字符串，trim后去重，过滤空字符串，排序
  const departments = [...new Set(
    members
      .map((m) => {
        const d = m.department;
        if (Array.isArray(d)) return d.filter(Boolean).join('、').trim();
        return (d || '').trim();
      })
      .filter((d) => d && d.length > 0)
  )].sort((a, b) => a.localeCompare(b, 'zh'));

  // 党小组去重：trim后去重，过滤空值，按党小组序号排序
  const partyGroups = sortPartyGroups(
    [...new Set(
      members
        .map((m) => (m.partyGroup || '').trim())
        .filter((g) => g && g.length > 0)
    )]
  );

  const statusOptions = (Object.entries(MEMBER_STATUS_LABEL) as [MemberStatus, string][]).map(
    ([value, label]) => ({ label, value })
  );

  const columns = [
    { title: '姓名', dataIndex: 'name', key: 'name', width: 100 },
    { title: '部室', dataIndex: 'title', key: 'title', width: 100 },
    { title: '部门/支部', dataIndex: 'department', key: 'department', width: 120 },
    {
      title: '党小组', dataIndex: 'partyGroup', key: 'partyGroup', width: 110,
      render: (v: string) => v || '-',
    },
    {
      title: '党小组组长', dataIndex: 'isGroupLeader', key: 'isGroupLeader', width: 100,
      render: (v: boolean) => v ? <Tag color="blue">是</Tag> : '-',
    },
    {
      title: '支委职务', dataIndex: 'committeeRole', key: 'committeeRole', width: 110,
      render: (v: string) => v ? <Tag color="red">{v}</Tag> : '-',
    },
    { title: '联系电话', dataIndex: 'phone', key: 'phone', width: 120 },
    {
      title: '状态', dataIndex: 'status', key: 'status', width: 80,
      render: (status: MemberStatus) => (
        <Tag color={MEMBER_STATUS_COLOR[status]}>{MEMBER_STATUS_LABEL[status]}</Tag>
      ),
    },
    {
      title: '操作', key: 'actions', width: 160,
      render: (_: unknown, record: Member) => (
        <Space>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => handleEdit(record)}>
            编辑
          </Button>
          <Button
            type="link"
            size="small"
            danger
            icon={<DeleteOutlined />}
            onClick={() => handleDelete(record)}
          >
            删除
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div className="toolbar">
        <div className="toolbar-left">
          <Input
            placeholder="搜索姓名/电话/部室"
            prefix={<SearchOutlined />}
            style={{ width: 180 }}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            allowClear
          />
          <Select
            placeholder="部门/支部筛选"
            style={{ width: 140 }}
            value={filterDept || undefined}
            onChange={(v) => setFilterDept(v || '')}
            allowClear
            options={departments.map((d) => ({ label: d, value: d }))}
          />
          <Select
            placeholder="党小组筛选"
            style={{ width: 130 }}
            value={filterGroup || undefined}
            onChange={(v) => setFilterGroup(v || '')}
            allowClear
            options={partyGroups.map((g) => ({ label: g, value: g }))}
          />
          <Select
            placeholder="状态筛选"
            style={{ width: 100 }}
            value={filterStatus || undefined}
            onChange={(v) => setFilterStatus(v || '')}
            allowClear
            options={statusOptions}
          />
        </div>
        <div className="toolbar-right">
          {selectedRowKeys.length > 0 && (
            <Button danger onClick={handleBatchDelete}>
              批量删除（{selectedRowKeys.length}）
            </Button>
          )}
          <Upload beforeUpload={handleImport} showUploadList={false} accept=".xlsx,.xls">
            <Button icon={<UploadOutlined />}>批量导入</Button>
          </Upload>
          <Button icon={<DownloadOutlined />} onClick={handleDownloadTemplate}>
            下载模板
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>
            新增人员
          </Button>
        </div>
      </div>

      <Table
        columns={columns}
        dataSource={filtered}
        rowKey="id"
        loading={loading}
        rowSelection={{
          selectedRowKeys,
          onChange: (keys) => setSelectedRowKeys(keys),
        }}
        pagination={{ pageSize: 15, showTotal: (total) => `共 ${total} 人` }}
      />

      {/* 删除方式选择弹窗（V3.2：支持彻底删除录入有误人员；V3.4 功能 2c：退出状态与日期可选） */}
      <Modal
        title={`删除人员：${deleteTarget?.name ?? ''}`}
        open={!!deleteTarget}
        onOk={handleDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
        okText={deleteMeetingCount === 0 || deleteMode === 'purge' ? '彻底删除' : '确认'}
        cancelText="取消"
        okButtonProps={{ danger: deleteMeetingCount === 0 || deleteMode === 'purge' }}
        confirmLoading={deleting}
      >
        {deleteMeetingCount === 0 ? (
          <p>
            该人员无关联会议记录，确认彻底删除？
            <span style={{ color: '#ff4d4f' }}>此操作不可恢复。</span>
          </p>
        ) : (
          <div>
            <p>
              该人员关联 <b>{deleteMeetingCount}</b> 条会议记录，请选择处理方式：
            </p>
            <Radio.Group value={deleteMode} onChange={(e) => setDeleteMode(e.target.value)}>
              <Space direction="vertical">
                <Radio value="resign">保留信息（推荐）— 标记状态退出花名册，考勤按时间线分段统计</Radio>
                <Radio value="purge">彻底删除 — 删除人员档案，并从 {deleteMeetingCount} 条会议记录的参会名单中移除</Radio>
              </Space>
            </Radio.Group>
            {deleteMode === 'resign' && (
              <div style={{ background: '#fafafa', border: '1px solid #f0f0f0', borderRadius: 8, padding: 14, marginTop: 12 }}>
                <Space size={24} wrap>
                  <div>
                    <div style={{ fontSize: 13, color: 'rgba(0, 0, 0, 0.65)', marginBottom: 5 }}>退出时状态</div>
                    <Select
                      style={{ width: 120 }}
                      value={deleteStatus}
                      onChange={(v) => setDeleteStatus(v)}
                      options={EXIT_STATUS_OPTIONS}
                    />
                  </div>
                  <div>
                    <div style={{ fontSize: 13, color: 'rgba(0, 0, 0, 0.65)', marginBottom: 5 }}>状态变更日期</div>
                    <DatePicker
                      value={deleteDate}
                      onChange={(d) => setDeleteDate(d)}
                      disabledDate={(d) => d.isAfter(dayjs(), 'day')}
                    />
                  </div>
                </Space>
                <p style={{ fontSize: 12, color: 'rgba(0, 0, 0, 0.45)', margin: '9px 0 0', lineHeight: 1.7 }}>
                  默认今天，可回填实际日期；该日期前的会议仍计入考勤，之后不计入。删错后可在编辑弹窗的变更历史中修正。
                </p>
              </div>
            )}
            {deleteMode === 'purge' && (
              <p style={{ color: '#ff4d4f', marginTop: 8, fontWeight: 500 }}>
                警告：彻底删除不可恢复，相关会议的出勤统计将同步更新！
              </p>
            )}
          </div>
        )}
      </Modal>

      {/* 批量删除弹窗（V3.4 功能 2c：只弹一次窗，标记保留的人员统一应用所选状态与日期） */}
      <Modal
        title="确认批量删除"
        open={batchDeleteOpen}
        onOk={handleBatchDeleteConfirm}
        onCancel={() => setBatchDeleteOpen(false)}
        okText="确认删除"
        cancelText="取消"
        okButtonProps={{ danger: true }}
        confirmLoading={batchDeleting}
      >
        <p>
          确认删除选中的 <b>{selectedRowKeys.length}</b> 名人员？无关联会议记录的人员将被彻底删除，
          有关联记录的将按下方选择标记退出（保留信息）。
        </p>
        <div style={{ background: '#fafafa', border: '1px solid #f0f0f0', borderRadius: 8, padding: 14 }}>
          <Space size={24} wrap>
            <div>
              <div style={{ fontSize: 13, color: 'rgba(0, 0, 0, 0.65)', marginBottom: 5 }}>退出时状态</div>
              <Select
                style={{ width: 120 }}
                value={batchDeleteStatus}
                onChange={(v) => setBatchDeleteStatus(v)}
                options={EXIT_STATUS_OPTIONS}
              />
            </div>
            <div>
              <div style={{ fontSize: 13, color: 'rgba(0, 0, 0, 0.65)', marginBottom: 5 }}>状态变更日期</div>
              <DatePicker
                value={batchDeleteDate}
                onChange={(d) => setBatchDeleteDate(d)}
                disabledDate={(d) => d.isAfter(dayjs(), 'day')}
              />
            </div>
          </Space>
          <p style={{ fontSize: 12, color: 'rgba(0, 0, 0, 0.45)', margin: '9px 0 0', lineHeight: 1.7 }}>
            批量删除：标记保留的人员统一应用此处选择的状态与日期（不逐人弹窗）；删错后可在编辑弹窗的变更历史中修正。
          </p>
        </div>
      </Modal>

      {/* 导入查重弹窗（V3.4 功能 7：同名人员处理选择，支持批量设置） */}
      <Modal
        title="导入人员"
        open={!!pendingImport}
        onCancel={() => setPendingImport(null)}
        width={760}
        footer={
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <span style={{ marginRight: 'auto', fontSize: 13, color: 'rgba(0, 0, 0, 0.55)' }}>
              本次结果：新增 {importSummary?.added ?? 0} 人 · 更新 {importSummary?.updated ?? 0} 人 · 跳过 {importSummary?.skipped ?? 0} 人
            </span>
            <Button onClick={() => setPendingImport(null)}>取消</Button>
            <Button type="primary" style={{ marginLeft: 8 }} onClick={handleImportConfirm}>
              确认导入
            </Button>
          </div>
        }
      >
        <p style={{ marginBottom: 12 }}>
          检测到 <b>{dupImportRows.length}</b> 名同名人员，请选择处理方式：
        </p>
        <div style={{ marginBottom: 12 }}>
          <Space>
            <Button size="small" onClick={() => setAllImportDecisions('skip')}>全部跳过</Button>
            <Button size="small" onClick={() => setAllImportDecisions('update')}>全部用导入更新</Button>
            <Button size="small" onClick={() => setAllImportDecisions('create')}>全部新建</Button>
            <span style={{ fontSize: 12, color: 'rgba(0, 0, 0, 0.35)' }}>（默认跳过）</span>
          </Space>
        </div>
        <Table
          size="small"
          rowKey="key"
          dataSource={dupImportRows}
          pagination={false}
          columns={[
            { title: '导入姓名', dataIndex: 'name', key: 'name', width: 90 },
            {
              title: '导入信息', key: 'importInfo',
              render: (_: unknown, r: ImportRow) => `${r.department ? displayDept(r.department) : '-'} · ${MEMBER_STATUS_LABEL[r.status]}`,
            },
            {
              title: '本机信息', key: 'localInfo',
              render: (_: unknown, r: ImportRow) =>
                r.duplicateOf
                  ? `${displayDept(r.duplicateOf.department)} · ${MEMBER_STATUS_LABEL[r.duplicateOf.status]}`
                  : '-',
            },
            {
              title: '处理', key: 'decision', width: 200,
              render: (_: unknown, r: ImportRow) => (
                <Radio.Group value={r.decision} onChange={(e) => setImportDecision(r.key, e.target.value)}>
                  <Radio value="skip">跳过</Radio>
                  <Radio value="update">更新</Radio>
                  <Radio value="create">新建</Radio>
                </Radio.Group>
              ),
            },
          ]}
        />
        <Alert
          type="info"
          showIcon
          style={{ marginTop: 12 }}
          message={'「更新」仅覆盖导入表中非空的字段（本机记录保留 id 与历史数据）；「新建」将产生同名两条记录，请谨慎选择。'}
        />
      </Modal>

      <MemberForm
        open={formOpen}
        editingMember={editingMember}
        onOk={handleFormOk}
        onCancel={() => setFormOpen(false)}
      />
    </div>
  );
}
