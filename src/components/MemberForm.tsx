import { Modal, Form, Input, Select, Checkbox, AutoComplete, DatePicker } from 'antd';
import { useEffect, useState } from 'react';
import type { Dayjs } from 'dayjs';
import type { Member, MemberStatus } from '../types';
import { COMMITTEE_ROLES, PARTY_GROUPS, MEMBER_STATUS_LABEL } from '../types';
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
  }) => void;
  onCancel: () => void;
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
  const [currentStatus, setCurrentStatus] = useState<MemberStatus>('active');

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
    }).catch(() => {
      // 数据库读取失败时使用预设部门
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
      } else {
        form.resetFields();
        form.setFieldsValue({ status: 'active' as MemberStatus, isGroupLeader: false, statusChangeDate: undefined });
        setCurrentStatus('active');
      }
    }
  }, [open, editingMember, form]);

  const handleStatusChange = (value: MemberStatus) => {
    setCurrentStatus(value);
    if (value === (editingMember?.status || 'active')) {
      form.setFieldValue('statusChangeDate', undefined);
    }
  };

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      onOk(values);
      form.resetFields();
    } catch {
      // validation failed
    }
  };

  const statusOptions = (Object.entries(MEMBER_STATUS_LABEL) as [MemberStatus, string][]).map(
    ([value, label]) => ({ label, value })
  );

  const deptOptions = departments.map((d) => ({ value: d, label: d }));

  const statusChanged = editingMember && currentStatus !== editingMember.status;

  return (
    <Modal
      title={editingMember ? '编辑人员' : '新增人员'}
      open={open}
      onOk={handleOk}
      onCancel={onCancel}
      destroyOnHidden
      forceRender
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
          <Select
            placeholder="请选择党小组"
            allowClear
            options={PARTY_GROUPS.map((g) => ({ label: g, value: g }))}
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
    </Modal>
  );
}
