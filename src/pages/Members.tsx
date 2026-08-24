import { useState, useEffect, useCallback } from 'react';
import { Table, Button, Input, Select, Space, Tag, Modal, Upload, message, Radio } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, UploadOutlined, DownloadOutlined, SearchOutlined } from '@ant-design/icons';
import type { Member, MemberStatus } from '../types';
import { MEMBER_STATUS_LABEL, MEMBER_STATUS_COLOR, sortPartyGroups } from '../types';
import { db, normalizeMember } from '../db';
import { addLog } from '../utils/logHelper';
import { appendStatusChange } from '../utils/memberStatus';
import MemberForm from '../components/MemberForm';
import { v4 as uuidv4 } from 'uuid';

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
  // 删除弹窗状态（V3.2：支持彻底删除录入有误人员）
  const [deleteTarget, setDeleteTarget] = useState<Member | null>(null);
  const [deleteMeetingCount, setDeleteMeetingCount] = useState(0);
  const [deleteMode, setDeleteMode] = useState<'resign' | 'purge'>('resign');
  const [deleting, setDeleting] = useState(false);

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

  // 删除人员（V3.2：弹窗选择"标记离职"或"彻底删除"）
  const handleDelete = async (member: Member) => {
    const meetingCount = await db.meetings
      .filter((m) => m.participants.some((p) => p.memberId === member.id))
      .count();
    setDeleteMeetingCount(meetingCount);
    setDeleteMode('resign');
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
        // 标记离职：保留会议记录（现有逻辑）
        const today = new Date().toISOString().substring(0, 10);
        await db.members.update(deleteTarget.id, {
          status: 'resigned' as MemberStatus,
          statusHistory: appendStatusChange(deleteTarget, 'resigned', today),
          updatedAt: new Date().toISOString(),
        });
        await addLog('DELETE_MEMBER', `删除人员：${deleteTarget.name}（有${deleteMeetingCount}条会议记录，标记为离职）`, {
          memberId: deleteTarget.id,
          meetingCount: deleteMeetingCount,
        });
        message.success(`已将 ${deleteTarget.name} 标记为离职（关联${deleteMeetingCount}条会议记录已保留）`);
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
    Modal.confirm({
      title: '确认批量删除',
      content: `确认删除选中的 ${selectedRowKeys.length} 名人员？无关联会议记录的人员将被彻底删除，有关联记录的将标记为离职。`,
      okText: '确认删除',
      cancelText: '取消',
      onOk: async () => {
        let permanentCount = 0;
        let resignCount = 0;
        for (const id of selectedRowKeys) {
          const member = await db.members.get(id as string);
          if (!member) continue;
          const meetingCount = await db.meetings
            .filter((m) => m.participants.some((p) => p.memberId === id))
            .count();
          if (meetingCount > 0) {
            const today = new Date().toISOString().substring(0, 10);
            await db.members.update(id as string, {
              status: 'resigned' as MemberStatus,
              statusHistory: appendStatusChange(member, 'resigned', today),
              updatedAt: new Date().toISOString(),
            });
            resignCount++;
          } else {
            await db.members.delete(id as string);
            permanentCount++;
          }
        }
        await addLog('BATCH_DELETE_MEMBER', `批量删除：彻底删除${permanentCount}人，标记离职${resignCount}人`, {
          ids: selectedRowKeys,
        });
        message.success(`已处理 ${selectedRowKeys.length} 名人员（彻底删除${permanentCount}人，标记离职${resignCount}人）`);
        setSelectedRowKeys([]);
        loadMembers();
      },
    });
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
    statusChangeDate?: { format: (fmt: string) => string };
  }) => {
    const now = new Date().toISOString();
    const dept = (values.department || '').trim();
    const changeDate = values.statusChangeDate?.format('YYYY-MM-DD');
    // 剔除 statusChangeDate，仅保留实体字段
    const { statusChangeDate: _omit, ...entityValues } = values;

    if (editingMember) {
      // 状态变化时追加状态历史记录
      const statusChanged = values.status !== editingMember.status;
      const statusHistory = statusChanged
        ? appendStatusChange(editingMember, values.status, changeDate || now.substring(0, 10))
        : editingMember.statusHistory;
      await db.members.update(editingMember.id, {
        ...entityValues,
        department: dept,
        statusHistory,
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
          const rows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet);
          const now = new Date().toISOString();
          let count = 0;
          for (const row of rows) {
            if (row['姓名']) {
              await db.members.add({
                id: uuidv4(),
                name: row['姓名'] || '',
                // 兼容"职务"（旧模板）和"部室"（新模板）两种列名
                title: row['部室'] || row['职务'] || '',
                // 兼容"部门/支部"（V3.2新模板）和"部门"（旧模板）两种列名
                department: row['部门/支部'] || row['部门'] || '',
                phone: row['联系电话'] || '',
                status: 'active',
                partyGroup: row['党小组'] || '',
                isGroupLeader: row['党小组组长'] === '是',
                committeeRole: row['支委职务'] || '',
                statusHistory: [{ status: 'active', date: now.substring(0, 10) }],
                createdAt: now,
                updatedAt: now,
              });
              count++;
            }
          }
          await addLog('IMPORT_MEMBERS', `批量导入${count}名人员`);
          message.success(`成功导入 ${count} 名人员`);
          loadMembers();
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
      const ws = XLSX.utils.json_to_sheet([
        { 姓名: '', 部室: '', '部门/支部': '', 党小组: '', 党小组组长: '', 支委职务: '', 联系电话: '' },
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

      {/* 删除方式选择弹窗（V3.2：支持彻底删除录入有误人员） */}
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
                <Radio value="resign">标记离职（推荐）— 保留 {deleteMeetingCount} 条会议记录，人员状态改为离职</Radio>
                <Radio value="purge">彻底删除 — 删除人员档案，并从 {deleteMeetingCount} 条会议记录的参会名单中移除</Radio>
              </Space>
            </Radio.Group>
            {deleteMode === 'purge' && (
              <p style={{ color: '#ff4d4f', marginTop: 8, fontWeight: 500 }}>
                警告：彻底删除不可恢复，相关会议的出勤统计将同步更新！
              </p>
            )}
          </div>
        )}
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
