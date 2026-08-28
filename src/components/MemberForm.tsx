import { Modal, Form, Input, Select, Checkbox, AutoComplete, DatePicker, Table, Button, Tag, message } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { useEffect, useState } from 'react';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import { v4 as uuidv4 } from 'uuid';
import type { Member, MemberStatus, MemberStatusChange } from '../types';
import { COMMITTEE_ROLES, PARTY_GROUPS, MEMBER_STATUS_LABEL, sortPartyGroups } from '../types';
import { db, normalizeMember } from '../db';

interface MemberFormProps {
  open: boolean;
  editingMember: Member | null;
  onOk: (values: {
    name: string;
    title: string;
    department: string;
    phone: string;
    status: MemberStatus;
    partyGroup: string;
    isGroupLeader: boolean;
    committeeRole: string;
    statusChangeDate?: Dayjs;  // 状态变更日期（状态变化时有效）
    statusHistory?: MemberStatusChange[];  // 变更历史表格整理后的状态时间线（编辑时有效）
  }) => void;
  onCancel: () => void;
}

// 变更历史行：状态行可编辑（V3.4 功能 2a），信息变更行只读留痕（V3.4 功能 2b）
interface HistoryRow {
  key: string;
  type: 'status' | 'info';
  date: string;
  status?: MemberStatus;  // 状态行
  field?: string;         // 信息行字段标签
  oldValue?: string;
  newValue?: string;
}

const PRESET_DEPARTMENTS = [
  '第一党支部',
  '第二党支部',
  '第三党支部',
  '机关党支部',
  '退休党支部',
];

export default function MemberForm({ open, editingMember, onOk, onCancel }: MemberFormProps) {
  const [form] = Form.useForm();
  const [departments, setDepartments] = useState<string[]>(PRESET_DEPARTMENTS);
  // 党小组选项：预设 5 组 ∪ 现有人员已用组名（V3.4 功能 5，与会议表单口径一致，支持自由输入）
  const [partyGroups, setPartyGroups] = useState<string[]>([...PARTY_GROUPS]);
  const [currentStatus, setCurrentStatus] = useState<MemberStatus>('active');
  const [historyRows, setHistoryRows] = useState<HistoryRow[]>([]);

  useEffect(() => {
    if (!open) return;
    db.members.toArray().then((members) => {
      const normalized = members.map((m) => normalizeMember(m));
      const depts = [
        ...new Set(
          normalized
            .map((m) => (m.department || '').trim())
            .filter((d) => d && d.length > 0)
        ),
      ];
      setDepartments([...new Set([...PRESET_DEPARTMENTS, ...depts])]);
      const groups = new Set<string>(PARTY_GROUPS);
      normalized.forEach((m) => {
        const g = (m.partyGroup || '').trim();
        if (g) groups.add(g);
      });
      setPartyGroups(sortPartyGroups([...groups]));
    }).catch(() => {
      // 数据库读取失败时使用预设部门与党小组
    });
  }, [open]);

  useEffect(() => {
    if (open) {
      if (editingMember) {
        // 兼容旧版数组格式的 department
        const normalized = normalizeMember(editingMember);
        form.setFieldsValue({
          ...normalized,
        });
        setCurrentStatus(normalized.status);
        // 初始化变更历史：状态行（可编辑）+ 信息变更行（只读），按日期正序展示
        const rows: HistoryRow[] = [];
        (normalized.statusHistory || []).forEach((c) => {
          rows.push({ key: uuidv4(), type: 'status', date: c.date, status: c.status });
        });
        (normalized.changeHistory || []).forEach((h) => {
          rows.push({ key: uuidv4(), type: 'info', date: h.date, field: h.field, oldValue: h.oldValue, newValue: h.newValue });
        });
        rows.sort((a, b) => a.date.localeCompare(b.date));
        setHistoryRows(rows);
      } else {
        form.resetFields();
        form.setFieldsValue({ status: 'active' as MemberStatus, isGroupLeader: false, statusChangeDate: undefined });
        setCurrentStatus('active');
        setHistoryRows([]);
      }
    }
  }, [open, editingMember, form]);

  const handleStatusChange = (value: MemberStatus) => {
    setCurrentStatus(value);
    if (value === (editingMember?.status || 'active')) {
      form.setFieldValue('statusChangeDate', undefined);
    }
  };

  // 变更历史表格操作（V3.4 功能 2a：仅状态行可编辑）
  const updateHistoryRow = (key: string, patch: Partial<HistoryRow>) => {
    setHistoryRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  const removeHistoryRow = (key: string) => {
    setHistoryRows((prev) => prev.filter((r) => r.key !== key));
  };

  const addHistoryRow = () => {
    setHistoryRows((prev) => [
      ...prev,
      { key: uuidv4(), type: 'status', date: dayjs().format('YYYY-MM-DD'), status: 'active' },
    ]);
  };

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      // 校验变更历史状态行：日期不可重复、不可晚于今天（仅有的两条校验）
      const statusRows = historyRows.filter((r) => r.type === 'status');
      const today = dayjs().format('YYYY-MM-DD');
      for (const r of statusRows) {
        if (!r.date) {
          message.error('变更历史存在未选择日期的状态记录');
          return;
        }
        if (r.date > today) {
          message.error(`变更日期 ${r.date} 晚于今天，请修正`);
          return;
        }
      }
      const dates = statusRows.map((r) => r.date);
      if (new Set(dates).size !== dates.length) {
        message.error('变更历史中存在重复日期的状态记录');
        return;
      }
      // 状态行整包按日期排序后随表单提交（替代原"仅追加"逻辑）
      const statusHistory: MemberStatusChange[] = [...statusRows]
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((r) => ({ status: r.status as MemberStatus, date: r.date }));
      onOk({ ...values, statusHistory });
      form.resetFields();
      setHistoryRows([]);
    } catch {
      // validation failed
    }
  };

  const statusOptions = (Object.entries(MEMBER_STATUS_LABEL) as [MemberStatus, string][]).map(
    ([value, label]) => ({ label, value })
  );

  const deptOptions = departments.map((d) => ({ value: d, label: d }));

  const statusChanged = editingMember && currentStatus !== editingMember.status;

  const historyColumns = [
    {
      title: '类型', dataIndex: 'type', key: 'type', width: 90,
      render: (v: HistoryRow['type']) =>
        v === 'status' ? <Tag color="blue">状态</Tag> : <Tag>信息变更</Tag>,
    },
    {
      title: '变更日期', dataIndex: 'date', key: 'date', width: 168,
      render: (v: string, row: HistoryRow) =>
        row.type === 'status' ? (
          <DatePicker
            size="small"
            style={{ width: 142 }}
            value={v ? dayjs(v) : null}
            disabledDate={(d: Dayjs) => d.isAfter(dayjs(), 'day')}
            onChange={(d) => updateHistoryRow(row.key, { date: d ? d.format('YYYY-MM-DD') : '' })}
          />
        ) : (
          <span style={{ color: 'rgba(0, 0, 0, 0.65)' }}>{v}</span>
        ),
    },
    {
      title: '内容 / 状态', key: 'content',
      render: (_: unknown, row: HistoryRow) =>
        row.type === 'status' ? (
          <Select
            size="small"
            style={{ width: 110 }}
            value={row.status}
            options={statusOptions}
            onChange={(v: MemberStatus) => updateHistoryRow(row.key, { status: v })}
          />
        ) : (
          <span style={{ color: 'rgba(0, 0, 0, 0.65)' }}>
            {row.field}：{row.oldValue || '（空）'} → {row.newValue || '（空）'}
          </span>
        ),
    },
    {
      title: '操作', key: 'action', width: 64,
      render: (_: unknown, row: HistoryRow) =>
        row.type === 'status' ? (
          <Button type="link" size="small" danger icon={<DeleteOutlined />} onClick={() => removeHistoryRow(row.key)}>
            删除
          </Button>
        ) : (
          <span style={{ color: 'rgba(0, 0, 0, 0.25)' }}>—</span>
        ),
    },
  ];

  return (
    <Modal
      title={editingMember ? '编辑人员' : '新增人员'}
      open={open}
      onOk={handleOk}
      onCancel={onCancel}
      destroyOnHidden
      forceRender
      width={editingMember ? 680 : 520}
      styles={{ body: { maxHeight: 'calc(100vh - 230px)', overflowY: 'auto' } }}
    >
      <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
        <Form.Item name="name" label="姓名" rules={[{ required: true, message: '请输入姓名' }]}>
          <Input placeholder="请输入姓名" />
        </Form.Item>
        <Form.Item name="title" label="部室">
          <Input placeholder="请输入部室" />
        </Form.Item>
        <Form.Item name="department" label="部门/支部">
          <AutoComplete
            placeholder="请选择或输入部门"
            options={deptOptions}
            filterOption={(input, option) =>
              (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
            }
            style={{ width: '100%' }}
            allowClear
          />
        </Form.Item>
        <Form.Item name="phone" label="联系电话">
          <Input placeholder="请输入联系电话" />
        </Form.Item>
        <Form.Item name="partyGroup" label="党小组">
          <AutoComplete
            placeholder="请选择或输入党小组"
            options={partyGroups.map((g) => ({ value: g, label: g }))}
            filterOption={(input, option) =>
              (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
            }
            style={{ width: '100%' }}
            allowClear
          />
        </Form.Item>
        <Form.Item name="committeeRole" label="支委职务">
          <Select
            placeholder="请选择支委职务"
            allowClear
            options={COMMITTEE_ROLES.map((r) => ({ label: r, value: r }))}
          />
        </Form.Item>
        <Form.Item name="isGroupLeader" label="党小组组长" valuePropName="checked">
          <Checkbox>设为党小组组长</Checkbox>
        </Form.Item>
        <Form.Item name="status" label="状态" rules={[{ required: true, message: '请选择状态' }]}>
          <Select options={statusOptions} onChange={handleStatusChange} />
        </Form.Item>
        {statusChanged && (
          <Form.Item
            name="statusChangeDate"
            label="状态变更日期"
            rules={[{ required: true, message: '状态发生变化，请选择变更日期' }]}
            extra="状态发生变化会记录到状态历史，用于按会议时间点判断在职状态"
          >
            <DatePicker style={{ width: '100%' }} placeholder="请选择变更日期" />
          </Form.Item>
        )}
      </Form>
      {/* 变更历史（V3.4 功能 2a + 2b：状态行可编辑，信息变更行只读留痕） */}
      {editingMember && (
        <div style={{ borderTop: '1px dashed #e5e7eb', marginTop: 4, paddingTop: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, fontWeight: 600 }}>
            变更历史
            <Tag color="blue">状态行可编辑</Tag>
            <Tag>信息行只读</Tag>
          </div>
          <Table
            size="small"
            columns={historyColumns}
            dataSource={historyRows}
            rowKey="key"
            pagination={false}
            locale={{ emptyText: '暂无变更记录' }}
          />
          <Button size="small" icon={<PlusOutlined />} style={{ marginTop: 10 }} onClick={addHistoryRow}>
            添加记录
          </Button>
          <p style={{ fontSize: 12, color: 'rgba(0, 0, 0, 0.45)', margin: '8px 0 0', lineHeight: 1.7 }}>
            校验：日期不可与其他记录重复、不可晚于今天；按日期自动排序保存，参会候选名单与考勤统计自动按新时间线重算，无需迁移数据。
          </p>
        </div>
      )}
    </Modal>
  );
}
