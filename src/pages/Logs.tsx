import { useState, useEffect, useCallback } from 'react';
import { Table, Select, DatePicker, Input, Button, Popconfirm, message, Tag } from 'antd';
import { DeleteOutlined, SearchOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import type { OperationLog, OperationType } from '../types';
import { db } from '../db';

const { RangePicker } = DatePicker;

const typeLabels: Record<OperationType, string> = {
  CREATE_MEMBER: '新增人员',
  UPDATE_MEMBER: '编辑人员',
  DELETE_MEMBER: '删除人员',
  BATCH_DELETE_MEMBER: '批量删除人员',
  CREATE_MEETING: '新增会议',
  UPDATE_MEETING: '编辑会议',
  DELETE_MEETING: '删除会议',
  EXPORT_LEDGER: '导出台账',
  EXPORT_DASHBOARD: '导出看板',
  IMPORT_MEMBERS: '批量导入',
  BACKUP_DATA: '数据备份',
  RESTORE_DATA: '数据恢复',
  RESET_DATA: '数据重置',
  CREATE_TALK: '新增谈话',
  UPDATE_TALK: '编辑谈话',
  DELETE_TALK: '删除谈话',
  EXPORT_TALK: '导出谈话台账',
  ADD_MEETING_TYPE: '添加自定义会议类型',
  DELETE_MEETING_TYPE: '删除自定义会议类型',
  MERGE_DATA: '数据融合',
  AUTO_MERGE_DATA: '自动融合',
  BACKUP_EXCEL: '数据备份（Excel）',
  RESTORE_EXCEL: '数据恢复（Excel）',
};

const typeColors: Record<string, string> = {
  CREATE_MEMBER: 'green',
  UPDATE_MEMBER: 'blue',
  DELETE_MEMBER: 'red',
  BATCH_DELETE_MEMBER: 'red',
  CREATE_MEETING: 'green',
  UPDATE_MEETING: 'blue',
  DELETE_MEETING: 'red',
  EXPORT_LEDGER: 'purple',
  EXPORT_DASHBOARD: 'purple',
  IMPORT_MEMBERS: 'cyan',
  BACKUP_DATA: 'orange',
  RESTORE_DATA: 'orange',
  RESET_DATA: 'volcano',
  CREATE_TALK: 'green',
  UPDATE_TALK: 'blue',
  DELETE_TALK: 'red',
  EXPORT_TALK: 'purple',
  MERGE_DATA: 'cyan',
  AUTO_MERGE_DATA: 'cyan',
  BACKUP_EXCEL: 'orange',
  RESTORE_EXCEL: 'orange',
};

export default function Logs() {
  const [logs, setLogs] = useState<OperationLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [filterType, setFilterType] = useState<string>('');
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs, dayjs.Dayjs] | null>(null);
  const [searchText, setSearchText] = useState('');

  const loadLogs = useCallback(async () => {
    setLoading(true);
    const data = await db.operationLogs.toArray();
    data.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    setLogs(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  const filtered = logs.filter((log) => {
    if (filterType && log.type !== filterType) return false;
    if (dateRange) {
      const d = dayjs(log.timestamp);
      if (d.isBefore(dateRange[0]) || d.isAfter(dateRange[1])) return false;
    }
    if (searchText && !log.description.includes(searchText)) return false;
    return true;
  });

  const handleClean = async () => {
    const cutoff = dayjs().subtract(90, 'day').toISOString();
    const oldLogs = logs.filter((l) => l.timestamp < cutoff);
    await db.operationLogs.bulkDelete(oldLogs.map((l) => l.id));
    message.success(`已清理 ${oldLogs.length} 条日志`);
    loadLogs();
  };

  const columns = [
    {
      title: '时间', dataIndex: 'timestamp', key: 'timestamp', width: 170,
      render: (ts: string) => dayjs(ts).format('YYYY-MM-DD HH:mm:ss'),
    },
    {
      title: '操作类型', dataIndex: 'type', key: 'type', width: 110,
      render: (type: OperationType) => (
        <Tag color={typeColors[type] || 'default'}>{typeLabels[type] || type}</Tag>
      ),
    },
    {
      title: '操作描述', dataIndex: 'description', key: 'description', width: 300,
      render: (text: string) => <span>{text}</span>,
    },
    {
      title: '操作详情', dataIndex: 'detail', key: 'detail',
      render: (detail: string) => {
        try {
          const obj = JSON.parse(detail);
          if (Object.keys(obj).length === 0) return '-';
          return (
            <span style={{ fontSize: 12, color: '#666', maxWidth: 300, display: 'inline-block', wordBreak: 'break-all' }}>
              {JSON.stringify(obj)}
            </span>
          );
        } catch {
          return detail || '-';
        }
      },
    },
    {
      title: '结果', dataIndex: 'result', key: 'result', width: 70,
      render: (result: string) => (
        <Tag color={result === 'success' ? 'green' : 'red'}>{result === 'success' ? '成功' : '失败'}</Tag>
      ),
    },
  ];

  return (
    <div>
      <div className="toolbar">
        <div className="toolbar-left">
          <Input
            placeholder="搜索操作描述"
            prefix={<SearchOutlined />}
            style={{ width: 200 }}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            allowClear
          />
          <Select
            placeholder="操作类型"
            style={{ width: 140 }}
            value={filterType || undefined}
            onChange={(v) => setFilterType(v || '')}
            allowClear
            options={Object.entries(typeLabels).map(([value, label]) => ({ label, value }))}
          />
          <RangePicker
            value={dateRange}
            onChange={(dates) => setDateRange(dates as [dayjs.Dayjs, dayjs.Dayjs] | null)}
            placeholder={['开始日期', '结束日期']}
          />
        </div>
        <div className="toolbar-right">
          <Popconfirm
            title="确认清理90天前的日志？"
            onConfirm={handleClean}
            okText="确认"
            cancelText="取消"
          >
            <Button danger icon={<DeleteOutlined />}>清理旧日志</Button>
          </Popconfirm>
        </div>
      </div>

      <Table
        columns={columns}
        dataSource={filtered}
        rowKey="id"
        loading={loading}
        pagination={{ pageSize: 20, showTotal: (total) => `共 ${total} 条日志` }}
      />
    </div>
  );
}