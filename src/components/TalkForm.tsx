import { Modal, Form, Input, Select, DatePicker, Radio, Checkbox, Tooltip } from 'antd';
import { useEffect, useState } from 'react';
import { QuestionCircleOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import type { TalkRecord, Member, TalkType, TalkMethod } from '../types';
import { TALK_TYPES } from '../types';
import { db } from '../db';

const { TextArea } = Input;

interface TalkFormProps {
  open: boolean;
  editingTalk: TalkRecord | null;
  onOk: (values: TalkFormValues) => void;
  onCancel: () => void;
}

export interface TalkFormValues {
  method: TalkMethod;
  type: TalkType;
  talkerName: string[];    // tags 模式（单人取第一个）
  talkerTitle: string;
  targetNames: string[];   // 谈话对象（个别单人/集体多人）
  targetTitle: string;
  contactPerson: string;
  talkDate: dayjs.Dayjs;
  timePeriod: 'am' | 'pm';
  outline: string;
  location: string;
  isFiveMustTalk: boolean;
  remark: string;
}

export default function TalkForm({ open, editingTalk, onOk, onCancel }: TalkFormProps) {
  const [form] = Form.useForm();
  const [members, setMembers] = useState<Member[]>([]);
  const [method, setMethod] = useState<TalkMethod>('individual');

  useEffect(() => {
    db.members.toArray().then(setMembers);
  }, [open]);

  useEffect(() => {
    if (open) {
      if (editingTalk) {
        form.setFieldsValue({
          ...editingTalk,
          talkerName: editingTalk.talkerName ? [editingTalk.talkerName] : [],
          talkDate: dayjs(editingTalk.talkDate),
          timePeriod: editingTalk.timePeriod || 'am',
          isFiveMustTalk: editingTalk.isFiveMustTalk || false,
          remark: editingTalk.remark || '',
          targetNames: editingTalk.targetNames || (editingTalk.targetName ? [editingTalk.targetName] : []),
        });
        setMethod(editingTalk.method);
      } else {
        form.resetFields();
        form.setFieldsValue({ method: 'individual', timePeriod: 'am', isFiveMustTalk: false, targetNames: [] });
        setMethod('individual');
      }
    }
  }, [open, editingTalk, form]);

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      onOk(values);
      form.resetFields();
    } catch {
      // validation failed
    }
  };

  // 人员姓名建议（Select tags 选项）
  const memberSelectOptions = members.map((m) => ({
    value: m.name,
    label: `${m.name}${m.title ? `（${m.title}）` : ''}`,
  }));

  // 谈话人：选中人员建议后自动填充职务（title 字段，可编辑）；无匹配/无职务时清空
  const handleTalkerSelect = (value: string) => {
    const selected = members.find((m) => m.name === value);
    form.setFieldValue('talkerTitle', selected?.title || '');
  };

  // 个别谈话对象：选中人员建议后自动填充职务；无匹配/无职务时清空
  const handleTargetSelect = (value: string) => {
    const selected = members.find((m) => m.name === value);
    form.setFieldValue('targetTitle', selected?.title || '');
  };

  // 多对象：根据所选人员自动填充职务（顿号分隔，可编辑）；无匹配人员时清空
  const handleTargetsChange = (names: string[]) => {
    const titles = names
      .map((n) => members.find((m) => m.name === n)?.title || '')
      .filter(Boolean);
    form.setFieldValue('targetTitle', titles.join('、'));
  };

  // 切换谈话方式：集体/约谈 → 个别 时截取第一个对象，避免个别谈话带多对象
  const handleMethodChange = (nextMethod: TalkMethod) => {
    setMethod(nextMethod);
    if (nextMethod === 'individual') {
      const current: string[] = form.getFieldValue('targetNames') || [];
      if (current.length > 1) {
        const first = current[0];
        form.setFieldValue('targetNames', [first]);
        const selected = members.find((m) => m.name === first);
        form.setFieldValue('targetTitle', selected?.title || '');
      }
    }
  };

  const isMulti = method === 'collective' || method === 'organized';

  return (
    <Modal
      title={editingTalk ? '编辑谈心谈话' : '新增谈心谈话'}
      open={open}
      onOk={handleOk}
      onCancel={onCancel}
      width={700}
      destroyOnHidden
      forceRender
    >
      <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
        <Form.Item
          name="method"
          label="谈话方式"
          rules={[{ required: true, message: '请选择谈话方式' }]}
        >
          <Radio.Group onChange={(e) => handleMethodChange(e.target.value)}>
            <Radio value="individual">个别谈话</Radio>
            <Radio value="collective">集体谈话</Radio>
            <Radio value="organized">组织约谈</Radio>
          </Radio.Group>
        </Form.Item>

        <Form.Item
          name="type"
          label="谈话类型"
          rules={[{ required: true, message: '请选择谈话类型' }]}
        >
          <Select placeholder="请选择谈话类型" options={TALK_TYPES.map((t) => ({ label: t, value: t }))} />
        </Form.Item>

        <div style={{ display: 'flex', gap: 16 }}>
          <Form.Item
            name="talkerName"
            label="谈话人姓名"
            rules={[
              { required: true, type: 'array', message: '请选择或输入谈话人' },
            ]}
            style={{ flex: 1 }}
          >
            <Select
              placeholder="选择或输入谈话人"
              showSearch
              mode="tags"
              maxCount={1}
              onChange={(vals) => {
                const v = Array.isArray(vals) ? vals[0] : vals;
                if (typeof v === 'string') handleTalkerSelect(v);
              }}
              filterOption={(input, option) =>
                (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
              }
              options={memberSelectOptions}
            />
          </Form.Item>
          <Form.Item name="talkerTitle" label="谈话人职务" style={{ flex: 1 }}>
            <Input placeholder="谈话人职务（选中人员自动填充，可编辑）" />
          </Form.Item>
        </div>

        {isMulti ? (
          <div style={{ display: 'flex', gap: 16 }}>
            <Form.Item
              name="targetNames"
              label="谈话对象姓名（多人）"
              rules={[{ required: true, message: '请选择或输入谈话对象', type: 'array' }]}
              style={{ flex: 1 }}
            >
              <Select
                mode="tags"
                placeholder="选择或输入多名谈话对象"
                onChange={handleTargetsChange}
                options={memberSelectOptions}
              />
            </Form.Item>
            <Form.Item name="targetTitle" label="谈话对象职务" style={{ flex: 1 }}>
              <Input placeholder="谈话对象职务（自动填充，可编辑）" />
            </Form.Item>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 16 }}>
            <Form.Item
              name="targetNames"
              label="谈话对象姓名"
              rules={[{ required: true, message: '请选择或输入谈话对象', type: 'array' }]}
              style={{ flex: 1 }}
            >
              <Select
                placeholder="选择或输入谈话对象"
                showSearch
                mode="tags"
                maxCount={1}
                onChange={(vals) => {
                  const v = Array.isArray(vals) ? vals[0] : vals;
                  if (typeof v === 'string') {
                    handleTargetSelect(v);
                  } else {
                    // 清空对象时同步清空职务
                    form.setFieldValue('targetTitle', '');
                  }
                }}
                filterOption={(input, option) =>
                  (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
                }
                options={memberSelectOptions}
              />
            </Form.Item>
            <Form.Item name="targetTitle" label="谈话对象职务" style={{ flex: 1 }}>
              <Input placeholder="谈话对象职务（选中人员自动填充，可编辑）" />
            </Form.Item>
          </div>
        )}

        <Form.Item name="contactPerson" label="联系人">
          <Input placeholder="请输入联系人" />
        </Form.Item>

        <div style={{ display: 'flex', gap: 16 }}>
          <Form.Item
            name="talkDate"
            label="谈话时间"
            rules={[{ required: true, message: '请选择谈话时间' }]}
            style={{ flex: 1 }}
          >
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            name="timePeriod"
            label="时段"
            rules={[{ required: true, message: '请选择时段' }]}
            style={{ flex: 1 }}
          >
            <Radio.Group>
              <Radio value="am">上午</Radio>
              <Radio value="pm">下午</Radio>
            </Radio.Group>
          </Form.Item>
        </div>

        <Form.Item name="outline" label="谈话提纲">
          <TextArea rows={2} placeholder="请输入谈话提纲" />
        </Form.Item>

        <Form.Item name="location" label="谈话地点">
          <Input placeholder="请输入谈话地点" />
        </Form.Item>

        <Form.Item name="isFiveMustTalk" valuePropName="checked">
          <Checkbox>
            是否为"五必谈"？
            <Tooltip
              title={
                <div style={{ maxWidth: 360 }}>
                  岗位变动必谈；组织处置必谈；发生家庭重大变故和出现重大困难、身心健康存在突出问题必谈；发现苗头性问题或者有不良反映必谈；班子成员之间、党员之间关系紧张、闹不团结时必谈，及时做好心理疏导和思想政治工作。
                </div>
              }
            >
              <QuestionCircleOutlined style={{ marginLeft: 6, color: '#999', cursor: 'help' }} />
            </Tooltip>
          </Checkbox>
        </Form.Item>

        <Form.Item name="remark" label="备注">
          <TextArea rows={2} placeholder="请输入备注（非必填）" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
