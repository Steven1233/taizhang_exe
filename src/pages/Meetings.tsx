import { useState, useEffect, useCallback, useMemo } from 'react';
import { Table, Button, Tag, Space, Input, Select, DatePicker, Modal, Popconfirm, message, Tooltip } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, EyeOutlined, DownloadOutlined, SearchOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import { v4 as uuidv4 } from 'uuid';
import type { Meeting, Member, Participant, AttendanceStatus } from '../types';
import { MEETING_TYPES } from '../types';
import { db, normalizeMeetingTypes, normalizeMeetingPartyGroups, normalizeMember } from '../db';
import { addLog } from '../utils/logHelper';
import { exportAnnualLedger } from '../utils/exportExcel';
import { countActiveAttendance } from '../utils/memberStatus';
import MeetingForm from '../components/MeetingForm';
import type { MeetingFormValues } from '../components/MeetingForm';

dayjs.locale('zh-cn');

const { RangePicker } = DatePicker;

/** 读取自定义会议类型（localStorage） */
function getCustomMeetingTypes(): string[] {
  try {
    const stored = localStorage.getItem('custom_meeting_types');
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

export default function Meetings() {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [filterType, setFilterType] = useState<string[]>([]);
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs, dayjs.Dayjs] | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingMeeting, setEditingMeeting] = useState<Meeting | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [viewingMeeting, setViewingMeeting] = useState<Meeting | null>(null);
  const [exportRange, setExportRange] = useState<[dayjs.Dayjs, dayjs.Dayjs] | null>([
    dayjs().startOf('year'),
    dayjs().endOf('year'),
  ]);
  // 自定义类型版本（删除后刷新筛选下拉）
  const [typeVersion, setTypeVersion] = useState(0);

  const loadMeetings = useCallback(async () => {
    setLoading(true);
    const data = await db.meetings.toArray();
    data.sort((a, b) => b.date.localeCompare(a.date));
    setMeetings(data.map((m) => normalizeMeetingPartyGroups(normalizeMeetingTypes(m))));
    setMembers((await db.members.toArray()).map(normalizeMember));
    setTypeVersion((v) => v + 1);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadMeetings();
  }, [loadMeetings]);

  // 表单关闭时刷新筛选下拉的自定义类型（表单内可能增删了自定义类型）
  useEffect(() => {
    if (!formOpen) setTypeVersion((v) => v + 1);
  }, [formOpen]);

  // 筛选下拉的会议类型（默认+自定义）
  const filterTypeOptions = useMemo(
    () => [...MEETING_TYPES, ...getCustomMeetingTypes()],
    [typeVersion]  // eslint-disable-line react-hooks/exhaustive-deps
  );

  const filtered = meetings.filter((m) => {
    if (searchText) {
      const kw = searchText.toLowerCase();
      if (
        !(m.name || '').toLowerCase().includes(kw) &&
        !m.host.includes(kw) &&
        !m.topic.includes(kw) &&
        !m.location.includes(kw) &&
        !m.type.some((t) => t.includes(kw))
      )
        return false;
    }
    if (filterType.length > 0) {
      const hasType = filterType.some((ft) => m.type.includes(ft));
      if (!hasType) return false;
    }
    if (dateRange && dateRange[0] && dateRange[1]) {
      const d = dayjs(m.date).startOf('day');
      if (d.isBefore(dateRange[0].startOf('day')) || d.isAfter(dateRange[1].endOf('day'))) return false;
    }
    return true;
  });

  const handleAdd = () => {
    setEditingMeeting(null);
    setFormOpen(true);
  };

  const handleEdit = (meeting: Meeting) => {
    setEditingMeeting(meeting);
    setFormOpen(true);
  };

  const handleView = (meeting: Meeting) => {
    setViewingMeeting(meeting);
    setDetailOpen(true);
  };

  const handleDelete = async (meeting: Meeting) => {
    await db.meetings.delete(meeting.id);
    await addLog('DELETE_MEETING', `删除会议：${meeting.type.join('、')} - ${meeting.date}`, {
      meetingId: meeting.id,
    });
    message.success('会议记录已删除');
    loadMeetings();
  };

  const handleFormOk = async (values: MeetingFormValues) => {
    const now = new Date().toISOString();
    const timeStr = `${values.timeRange[0].format('HH:mm')} - ${values.timeRange[1].format('HH:mm')}`;

    const meetingData: Omit<Meeting, 'id' | 'createdAt' | 'updatedAt'> = {
      name: (values.name || '').trim(),
      type: values.type,
      partyGroups: values.partyGroups || [],
      date: values.date.format('YYYY-MM-DD'),
      time: timeStr,
      location: values.location,
      host: values.host,
      recorder: values.recorder || '',
      topic: values.topic,
      summary: '',
      resolution: values.resolution || '',
      participants: values.participants,
    };

    if (editingMeeting) {
      await db.meetings.update(editingMeeting.id, { ...meetingData, updatedAt: now });
      await addLog('UPDATE_MEETING', `编辑会议：${values.type.join('、')} - ${values.date.format('YYYY-MM-DD')}`, {
        meetingId: editingMeeting.id,
      });
      message.success('会议记录已更新');
    } else {
      const newMeeting: Meeting = {
        id: uuidv4(),
        ...meetingData,
        createdAt: now,
        updatedAt: now,
      };
      await db.meetings.add(newMeeting);
      await addLog('CREATE_MEETING', `新增会议：${values.type.join('、')} - ${values.date.format('YYYY-MM-DD')}`, {
        meetingId: newMeeting.id,
      });
      message.success('会议记录已添加');
    }
    setFormOpen(false);
    loadMeetings();
  };

  const handleExport = async () => {
    if (!exportRange || !exportRange[0] || !exportRange[1]) {
      message.warning('请先选择导出时间段');
      return;
    }
    try {
      const start = exportRange[0].format('YYYY-MM-DD');
      const end = exportRange[1].format('YYYY-MM-DD');
      const allMembers = await db.members.toArray();
      const allMeetings = await db.meetings.toArray();
      await exportAnnualLedger(start, end, allMeetings, allMembers);
      await addLog('EXPORT_LEDGER', `导出台账（${start} 至 ${end}）`);
      // 导出后重置为当年区间（保留默认值体验，便于连续导出）
      setExportRange([dayjs().startOf('year'), dayjs().endOf('year')]);
      message.success('导出成功');
    } catch (err) {
      console.error('导出台账失败:', err);
      message.error('导出失败，请重试');
    }
  };

  const statusColor: Record<AttendanceStatus, string> = {
    attended: 'green',
    leave: 'orange',
    absent: 'red',
  };
  const statusLabel: Record<AttendanceStatus, string> = {
    attended: '出席',
    leave: '请假',
    absent: '缺席',
  };

  const columns = [
    {
      title: '会议名称',
      dataIndex: 'name',
      key: 'name',
      width: 180,
      render: (name: string) => name || '-',
    },
    {
      title: '会议类型',
      dataIndex: 'type',
      key: 'type',
      width: 180,
      render: (types: string[], record: Meeting) => (
        <Space size={2} wrap>
          {types.map((t) => (
            <Tag key={t} color="blue" style={{ marginBottom: 2 }}>
              {t}
            </Tag>
          ))}
          {record.partyGroups && record.partyGroups.length > 0 && types.includes('党小组会') && (
            <Tag color="cyan" style={{ marginBottom: 2 }}>
              {record.partyGroups.join('、')}
            </Tag>
          )}
        </Space>
      ),
    },
    {
      title: '日期',
      dataIndex: 'date',
      key: 'date',
      width: 130,
      sorter: (a: Meeting, b: Meeting) => a.date.localeCompare(b.date),
      render: (date: string) => dayjs(date).format('YYYY年MM月DD日'),
    },
    { title: '时间', dataIndex: 'time', key: 'time', width: 130 },
    { title: '地点', dataIndex: 'location', key: 'location', width: 130 },
    { title: '主持人', dataIndex: 'host', key: 'host', width: 90 },
    {
      title: '议题',
      dataIndex: 'topic',
      key: 'topic',
      width: 200,
      render: (text: string) => (
        <Tooltip title={text} placement="topLeft" overlayStyle={{ maxWidth: 500 }}>
          <span
            style={{
              maxWidth: 200,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              display: 'inline-block',
              cursor: 'pointer',
            }}
          >
            {text}
          </span>
        </Tooltip>
      ),
    },
    {
      title: '出勤',
      key: 'attendance',
      width: 100,
      render: (_: unknown, record: Meeting) => {
        // V3.3：时间线在职口径（按会议日期时点判定在职，离开期间不计入）
        const { shouldAttend, attended } = countActiveAttendance(record, members);
        return <span>{attended}/{shouldAttend}</span>;
      },
    },
    {
      title: '操作',
      key: 'actions',
      width: 200,
      render: (_: unknown, record: Meeting) => (
        <Space>
          <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => handleView(record)}>
            查看
          </Button>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => handleEdit(record)}>
            编辑
          </Button>
          <Popconfirm
            title="确认删除该会议记录？"
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
            placeholder="搜索名称/议题/主持人/地点"
            prefix={<SearchOutlined />}
            style={{ width: 200 }}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            allowClear
          />
          <Select
            mode="multiple"
            placeholder="会议类型"
            style={{ width: 200 }}
            value={filterType}
            onChange={(v) => setFilterType(v)}
            allowClear
            maxTagCount={2}
            options={filterTypeOptions.map((t) => ({ label: t, value: t }))}
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
            新增会议
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

      <MeetingForm
        open={formOpen}
        editingMeeting={editingMeeting}
        onOk={handleFormOk}
        onCancel={() => setFormOpen(false)}
      />

      {/* 详情弹窗 */}
      <Modal
        title="会议详情"
        open={detailOpen}
        onCancel={() => setDetailOpen(false)}
        footer={null}
        width={700}
      >
        {viewingMeeting && (
          <div>
            {viewingMeeting.name && (
              <p>
                <strong>会议名称：</strong>
                {viewingMeeting.name}
              </p>
            )}
            <p>
              <strong>会议类型：</strong>
              {viewingMeeting.type.map((t) => (
                <Tag key={t} color="blue" style={{ marginRight: 4 }}>
                  {t}
                </Tag>
              ))}
            </p>
            {viewingMeeting.partyGroups && viewingMeeting.partyGroups.length > 0 && (
              <p>
                <strong>所属党小组：</strong>
                {viewingMeeting.partyGroups.join('、')}
              </p>
            )}
            <p>
              <strong>会议日期：</strong>
              {dayjs(viewingMeeting.date).format('YYYY年MM月DD日')}
            </p>
            <p>
              <strong>会议时间：</strong>
              {viewingMeeting.time}
            </p>
            <p>
              <strong>会议地点：</strong>
              {viewingMeeting.location}
            </p>
            <p>
              <strong>主持人：</strong>
              {viewingMeeting.host}
            </p>
            {viewingMeeting.recorder && (
              <p>
                <strong>记录人：</strong>
                {viewingMeeting.recorder}
              </p>
            )}
            <p>
              <strong>议题：</strong>
              {viewingMeeting.topic}
            </p>
            <div style={{ marginBottom: 12 }}>
              <strong>参会人员：</strong>
              <div style={{ marginTop: 4 }}>
                {viewingMeeting.participants.map((p: Participant) => (
                  <Tag key={p.memberId} color={statusColor[p.status]} style={{ marginBottom: 4 }}>
                    {p.name} ({p.status === 'attended' && p.isGuest ? '列席' : statusLabel[p.status]})
                    {p.leaveReason ? ` - ${p.leaveReason}` : ''}
                  </Tag>
                ))}
              </div>
            </div>
            {viewingMeeting.resolution && (
              <p>
                <strong>会议决议/结论：</strong>
                {viewingMeeting.resolution}
              </p>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
