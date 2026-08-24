import { useState, useEffect, useCallback } from 'react';
import {
  Table, Button, Tag, Space, Input, Select, DatePicker, Modal, Popconfirm, message,
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, EyeOutlined,
  DownloadOutlined, SearchOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { v4 as uuidv4 } from 'uuid';
import type { TalkRecord, TalkType, TalkMethod } from '../types';
import { TALK_TYPES, TALK_METHOD_LABEL, TALK_METHOD_COLOR } from '../types';
import { db } from '../db';
import { addLog } from '../utils/logHelper';
import TalkForm from '../components/TalkForm';
import type { TalkFormValues } from '../components/TalkForm';
import { exportTalkLedger } from '../utils/exportTalkExcel';

const { RangePicker } = DatePicker;

export default function Talks() {
  const [talks, setTalks] = useState<TalkRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [filterType, setFilterType] = useState<TalkType | ''>('');
  const [filterMethod, setFilterMethod] = useState<TalkMethod | ''>('');
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs, dayjs.Dayjs] | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingTalk, setEditingTalk] = useState<TalkRecord | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [viewingTalk, setViewingTalk] = useState<TalkRecord | null>(null);
  const [exportRange, setExportRange] = useState<[dayjs.Dayjs, dayjs.Dayjs] | null>([
    dayjs().startOf('year'),
    dayjs().endOf('year'),
  ]);

  const loadTalks = useCallback(async () => {
    setLoading(true);
    const data = await db.talkRecords.toArray();
    data.sort((a, b) => b.talkDate.localeCompare(a.talkDate));
    setTalks(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadTalks();
  }, [loadTalks]);

  const filtered = talks.filter((t) => {
    if (searchText) {
      const kw = searchText.toLowerCase();
      const targetNames = t.targetNames || [t.targetName];
      if (
        !t.talkerName.toLowerCase().includes(kw) &&
        !targetNames.some((n) => n.toLowerCase().includes(kw)) &&
        !(t.contactPerson || '').toLowerCase().includes(kw) &&
        !(t.outline || '').toLowerCase().includes(kw)
      )
        return false;
    }
    if (filterType && t.type !== filterType) return false;
    if (filterMethod && t.method !== filterMethod) return false;
    // 时段筛选：归一化到日边界，避免当日边界记录漏筛
    if (dateRange && dateRange[0] && dateRange[1]) {
      const d = dayjs(t.talkDate).startOf('day');
      const start = dateRange[0].startOf('day');
      const end = dateRange[1].endOf('day');
      if (d.isBefore(start) || d.isAfter(end)) return false;
    }
    return true;
  });

  const handleAdd = () => {
    setEditingTalk(null);
    setFormOpen(true);
  };

  const handleEdit = (talk: TalkRecord) => {
    setEditingTalk(talk);
    setFormOpen(true);
  };

  const handleView = (talk: TalkRecord) => {
    setViewingTalk(talk);
    setDetailOpen(true);
  };

  const handleDelete = async (talk: TalkRecord) => {
    await db.talkRecords.delete(talk.id);
    await addLog('DELETE_TALK', `删除谈心谈话：${talk.talkerName} - ${talk.talkDate}`, {
      talkId: talk.id,
    });
    message.success('谈话记录已删除');
    loadTalks();
  };

  const handleFormOk = async (values: TalkFormValues) => {
    const now = new Date().toISOString();
    const targetNames = (values.targetNames || []).filter(Boolean);
    const targetNameStr = targetNames.join('、');
    const talkerName = (values.talkerName || []).filter(Boolean).join('、');

    const talkData: Omit<TalkRecord, 'id' | 'createdAt' | 'updatedAt'> = {
      method: values.method,
      type: values.type,
      talkerName,
      talkerTitle: values.talkerTitle || '',
      targetName: targetNameStr,
      targetNames,
      targetTitle: values.targetTitle || '',
      contactPerson: values.contactPerson || '',
      talkDate: values.talkDate.format('YYYY-MM-DD'),
      timePeriod: values.timePeriod || 'am',
      outline: values.outline || '',
      location: values.location || '',
      // 保留历史 content 字段（V3.0 起不再录入与展示，但旧数据不覆盖清空）
      content: editingTalk?.content || '',
      isFiveMustTalk: values.isFiveMustTalk || false,
      remark: values.remark || '',
    };

    if (editingTalk) {
      await db.talkRecords.update(editingTalk.id, { ...talkData, updatedAt: now });
      await addLog('UPDATE_TALK', `编辑谈心谈话：${talkerName} - ${values.talkDate.format('YYYY-MM-DD')}`, {
        talkId: editingTalk.id,
      });
      message.success('谈话记录已更新');
    } else {
      const newTalk: TalkRecord = {
        id: uuidv4(),
        ...talkData,
        createdAt: now,
        updatedAt: now,
      };
      await db.talkRecords.add(newTalk);
      await addLog('CREATE_TALK', `新增谈心谈话：${talkerName} - ${values.talkDate.format('YYYY-MM-DD')}`, {
        talkId: newTalk.id,
      });
      message.success('谈话记录已添加');
    }
    setFormOpen(false);
    loadTalks();
  };

  const handleExport = async () => {
    if (!exportRange || !exportRange[0] || !exportRange[1]) {
      message.warning('请先选择导出时间段');
      return;
    }
    try {
      const start = exportRange[0].format('YYYY-MM-DD');
      const end = exportRange[1].format('YYYY-MM-DD');
      const allTalks = await db.talkRecords.toArray();
      await exportTalkLedger(start, end, allTalks);
      await addLog('EXPORT_TALK', `导出谈心谈话台账（${start} 至 ${end}）`);
      // 导出后重置为当年区间（保留默认值体验，便于连续导出）
      setExportRange([dayjs().startOf('year'), dayjs().endOf('year')]);
      message.success('导出成功');
    } catch (err) {
      console.error('导出谈心谈话台账失败:', err);
      message.error('导出失败，请重试');
    }
  };

  /** 谈话对象展示（多人顿号分隔） */
  const targetDisplay = (t: TalkRecord) =>
    t.targetNames && t.targetNames.length > 0 ? t.targetNames.join('、') : t.targetName;

  const columns = [
    {
      title: '谈话时间',
      dataIndex: 'talkDate',
      key: 'talkDate',
      width: 150,
      sorter: (a: TalkRecord, b: TalkRecord) => a.talkDate.localeCompare(b.talkDate),
      render: (date: string, record: TalkRecord) =>
        `${dayjs(date).format('YYYY年MM月DD日')} ${record.timePeriod === 'pm' ? '下午' : '上午'}`,
    },
    {
      title: '谈话方式',
      dataIndex: 'method',
      key: 'method',
      width: 90,
      render: (v: TalkMethod) => (
        <Tag color={TALK_METHOD_COLOR[v]}>{TALK_METHOD_LABEL[v]}</Tag>
      ),
    },
    {
      title: '谈话类型',
      dataIndex: 'type',
      key: 'type',
      width: 200,
      render: (v: string, record: TalkRecord) => (
        <span style={{ fontSize: 12 }}>
          {v}
          {record.isFiveMustTalk && (
            <Tag color="red" style={{ marginLeft: 4, fontSize: 11 }}>五必谈</Tag>
          )}
        </span>
      ),
    },
    { title: '谈话人', dataIndex: 'talkerName', key: 'talkerName', width: 100 },
    {
      title: '谈话对象',
      key: 'targetName',
      width: 150,
      render: (_: unknown, record: TalkRecord) => targetDisplay(record),
    },
    { title: '联系人', dataIndex: 'contactPerson', key: 'contactPerson', width: 90 },
    { title: '谈话地点', dataIndex: 'location', key: 'location', width: 120 },
    {
      title: '操作',
      key: 'actions',
      width: 200,
      render: (_: unknown, record: TalkRecord) => (
        <Space>
          <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => handleView(record)}>
            查看
          </Button>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => handleEdit(record)}>
            编辑
          </Button>
          <Popconfirm
            title="确认删除该谈话记录？"
            onConfirm={() => handleDelete(record)}
            okText="确认"
            cancelText="取消"
          >
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div className="toolbar">
        <div className="toolbar-left">
          <Input
            placeholder="搜索谈话人/对象/提纲/联系人"
            prefix={<SearchOutlined />}
            style={{ width: 200 }}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            allowClear
          />
          <Select
            placeholder="谈话类型"
            style={{ width: 200 }}
            value={filterType || undefined}
            onChange={(v) => setFilterType(v || '')}
            allowClear
            options={TALK_TYPES.map((t) => ({ label: t, value: t }))}
          />
          <Select
            placeholder="谈话方式"
            style={{ width: 120 }}
            value={filterMethod || undefined}
            onChange={(v) => setFilterMethod(v || '')}
            allowClear
            options={(Object.entries(TALK_METHOD_LABEL) as [TalkMethod, string][]).map(
              ([value, label]) => ({ label, value })
            )}
          />
          <RangePicker
            value={dateRange}
            onChange={(dates) => setDateRange(dates as [dayjs.Dayjs, dayjs.Dayjs] | null)}
            placeholder={['开始日期', '结束日期']}
          />
        </div>
        <div className="toolbar-right">
          <RangePicker
            value={exportRange}
            onChange={(dates) => setExportRange(dates as [dayjs.Dayjs, dayjs.Dayjs] | null)}
            placeholder={['导出开始日期', '导出结束日期']}
          />
          <Button icon={<DownloadOutlined />} onClick={handleExport} disabled={!exportRange}>
            导出台账
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>
            新增谈话
          </Button>
        </div>
      </div>

      <Table
        columns={columns}
        dataSource={filtered}
        rowKey="id"
        loading={loading}
        pagination={{ pageSize: 15, showTotal: (total) => `共 ${total} 条记录` }}
      />

      <TalkForm
        open={formOpen}
        editingTalk={editingTalk}
        onOk={handleFormOk}
        onCancel={() => setFormOpen(false)}
      />

      {/* 详情弹窗 */}
      <Modal
        title="谈心谈话详情"
        open={detailOpen}
        onCancel={() => setDetailOpen(false)}
        footer={null}
        width={600}
      >
        {viewingTalk && (
          <div>
            <p>
              <strong>谈话方式：</strong>
              <Tag color={TALK_METHOD_COLOR[viewingTalk.method]}>
                {TALK_METHOD_LABEL[viewingTalk.method]}
              </Tag>
            </p>
            <p>
              <strong>谈话类型：</strong>
              {viewingTalk.type}
              {viewingTalk.isFiveMustTalk && (
                <Tag color="red" style={{ marginLeft: 8 }}>五必谈</Tag>
              )}
            </p>
            <p><strong>谈话人：</strong>{viewingTalk.talkerName}{viewingTalk.talkerTitle ? `（${viewingTalk.talkerTitle}）` : ''}</p>
            <p><strong>谈话对象：</strong>{targetDisplay(viewingTalk)}{viewingTalk.targetTitle ? `（${viewingTalk.targetTitle}）` : ''}</p>
            {viewingTalk.contactPerson && <p><strong>联系人：</strong>{viewingTalk.contactPerson}</p>}
            <p>
              <strong>谈话时间：</strong>
              {dayjs(viewingTalk.talkDate).format('YYYY年MM月DD日')}
              {viewingTalk.timePeriod === 'pm' ? ' 下午' : ' 上午'}
            </p>
            {viewingTalk.outline && <p><strong>谈话提纲：</strong>{viewingTalk.outline}</p>}
            {viewingTalk.location && <p><strong>谈话地点：</strong>{viewingTalk.location}</p>}
            {viewingTalk.remark && <p><strong>备注：</strong>{viewingTalk.remark}</p>}
          </div>
        )}
      </Modal>
    </div>
  );
}
