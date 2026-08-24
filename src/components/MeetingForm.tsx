import { Modal, Form, Input, Select, DatePicker, TimePicker, Button, Tag, Space, Table, message, Checkbox, AutoComplete } from 'antd';
import { DeleteOutlined, CopyOutlined, ThunderboltOutlined, SearchOutlined } from '@ant-design/icons';
import { useEffect, useState, useMemo } from 'react';
import dayjs from 'dayjs';
import type { Meeting, Member, Participant, AttendanceStatus } from '../types';
import { MEETING_TYPES, PARTY_GROUPS, PRESET_LOCATIONS, sortPartyGroups } from '../types';
import { db } from '../db';
import { isActiveAt } from '../utils/memberStatus';
import { addLog } from '../utils/logHelper';

const { TextArea } = Input;
const PRESET_LOCATIONS_IMPORT = PRESET_LOCATIONS;

interface MeetingFormProps {
  open: boolean;
  editingMeeting: Meeting | null;
  onOk: (values: MeetingFormValues) => void;
  onCancel: () => void;
}

export interface MeetingFormValues {
  name: string;
  type: string[];
  partyGroups: string[];
  date: dayjs.Dayjs;
  timeRange: [dayjs.Dayjs, dayjs.Dayjs];
  location: string;
  host: string;
  recorder: string;
  topic: string;
  resolution: string;
  participants: Participant[];
}

interface ParsedParticipant {
  name: string;
  status: AttendanceStatus;
  reason?: string;
}

// ==================== 自定义会议类型（localStorage） ====================

function getCustomTypes(): string[] {
  try {
    const stored = localStorage.getItem('custom_meeting_types');
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveCustomType(t: string) {
  const list = getCustomTypes();
  if (!list.includes(t)) {
    list.push(t);
    localStorage.setItem('custom_meeting_types', JSON.stringify(list));
  }
}

function removeCustomType(t: string): string[] {
  const list = getCustomTypes().filter((x) => x !== t);
  localStorage.setItem('custom_meeting_types', JSON.stringify(list));
  return list;
}

// ==================== 地点预设（localStorage） ====================

function getStoredLocations(): string[] {
  try {
    const stored = localStorage.getItem('preset_locations');
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveLocation(loc: string) {
  const list = getStoredLocations();
  if (!list.includes(loc)) {
    list.push(loc);
    localStorage.setItem('preset_locations', JSON.stringify(list));
  }
}

function removeStoredLocation(loc: string): string[] {
  const list = getStoredLocations().filter((x) => x !== loc);
  localStorage.setItem('preset_locations', JSON.stringify(list));
  return list;
}

// ==================== 智能解析（V3.0 增强） ====================

/** 干扰词过滤（非人名词汇） */
const NOISE_WORDS = ['接龙', '收到', '以下', '名单', '签到', '人员', '会议', '参加', '请假', '列席', '参会', '出席', '上午', '下午', '晚上'];

function isLikelyName(s: string): boolean {
  if (!s || s.length > 10 || s.length < 1) return false;
  // 过滤干扰词
  if (NOISE_WORDS.some((w) => s === w || s.includes(w))) return false;
  // 过滤纯数字/符号
  if (/^[\d\s\.\、\,\，\-\(\)（）\[\]【】]+$/.test(s)) return false;
  // 过滤含"会议""时间"等明显非人名词
  if (['会议', '时间', '地点', '通知'].some((w) => s.includes(w))) return false;
  return true;
}

/** 提取姓名列表（容错增强：多种序号/分隔符格式） */
function extractNames(text: string): string[] {
  return text
    // 统一全角括号外的序号格式：1. 1、1) 1） (1) （1）01. 001、
    .replace(/[（(]\s*\d+\s*[）)]/g, ' ')
    .replace(/\d+\s*[）)]/g, ' ')
    .replace(/\d+[\.\、\,\，\s]+/g, ' ')
    // 分隔符统一为空格
    .replace(/[、，,；;\/]/g, ' ')
    .split(/\s+/)
    .map((n) => n.trim())
    .filter((n) => n.length > 0 && isLikelyName(n));
}

/** 段落匹配：参会/参加/出席、请假/缺勤、列席 */
function matchSection(text: string, keywords: string[]): string {
  // 构建正则：标识词后跟冒号（全角/半角），直到下一个段落标识或文本结束
  const allKeywords = ['参会', '参加', '出席', '请假', '缺勤', '列席'];
  const kwPattern = allKeywords.join('|');
  for (const kw of keywords) {
    // 查找 "关键词：" 或 "关键词:" 的位置
    const re = new RegExp(`${kw}\\s*[：:]\\s*([\\s\\S]*?)(?=(?:${kwPattern})\\s*[：:]|$)`, 'g');
    const m = re.exec(text);
    if (m && m[1].trim()) return m[1];
  }
  return '';
}

/** 解析括号内原因：张三（休假）/ 张三(休假) / 张三【休假】 */
function parseNameWithReason(entry: string): { name: string; reason?: string } {
  const m = entry.match(/^(.+?)[（(【\[](.+?)[）)】\]]$/);
  if (m) {
    return { name: m[1].trim(), reason: m[2].trim() };
  }
  return { name: entry.trim() };
}

interface ParseResult {
  attended: ParsedParticipant[];
  leave: ParsedParticipant[];
  observers: ParsedParticipant[];   // 列席人员
  onlyLeave: boolean;               // 是否只填了请假人员
  conflicts: string[];              // 同时出现在出席段和请假段的人员
}

/** 清理条目前缀序号（容错增强：1. 1、1) 1） (1) （1）01. 001、 等） */
function cleanEntryPrefix(entry: string): string {
  return entry
    .trim()
    // 仅清理开头的括号序号，避免误删"张三（3）"式的原因括号
    .replace(/^[（(]\s*\d+\s*[）)]/, '')   // (1) （1）
    .replace(/^\d+\s*[）)]/, '')           // 1) 1）
    .replace(/^\d+[\.\、\,\，\s]+/, '')    // 1. 1、01. 001、 1 (空格)
    .trim();
}

function parseAttendanceText(text: string): ParseResult {
  const attended: ParsedParticipant[] = [];
  const leave: ParsedParticipant[] = [];
  const observers: ParsedParticipant[] = [];

  const attendText = matchSection(text, ['参会', '参加', '出席']);
  const leaveText = matchSection(text, ['请假', '缺勤']);
  const observerText = matchSection(text, ['列席']);

  // 出席人员（兼容"张三（休假）"带括号备注：剥离括号取纯姓名，避免误建临时人员）
  if (attendText) {
    extractNames(attendText).forEach((raw) => {
      const { name } = parseNameWithReason(raw);
      if (name) attended.push({ name, status: 'attended' });
    });
  }

  // 请假人员（含原因；分隔符含空格，序号格式全容错）
  if (leaveText) {
    leaveText.split(/[、，,；;\n\s]+/).forEach((entry) => {
      const cleaned = cleanEntryPrefix(entry);
      if (!cleaned) return;
      const { name, reason } = parseNameWithReason(cleaned);
      if (isLikelyName(name)) {
        leave.push({ name, status: 'leave', reason });
      }
    });
  }

  // 列席人员（分隔与序号容错同请假段）
  if (observerText) {
    observerText.split(/[、，,；;\n\s]+/).forEach((entry) => {
      const cleaned = cleanEntryPrefix(entry);
      if (!cleaned) return;
      const { name } = parseNameWithReason(cleaned);
      if (isLikelyName(name)) {
        observers.push({ name, status: 'attended' });
      }
    });
  }

  // 冲突检测：同一人同时出现在出席段和请假段
  const conflicts = attended
    .filter((a) => leave.some((l) => l.name === a.name))
    .map((a) => a.name);

  return {
    attended,
    leave,
    observers,
    onlyLeave: attended.length === 0 && leave.length > 0,
    conflicts: [...new Set(conflicts)],
  };
}

/** 姓名匹配（增强：精确→包含→去空格） */
function matchMember(members: Member[], name: string): Member | undefined {
  // 1. 精确匹配
  const exact = members.find((m) => m.name === name);
  if (exact) return exact;
  // 2. 包含匹配（唯一命中才生效）
  const includes = members.filter(
    (m) => m.name.includes(name) || name.includes(m.name)
  );
  if (includes.length === 1) return includes[0];
  // 3. 去空格匹配
  const normalized = name.replace(/\s+/g, '');
  const noSpace = members.filter((m) => m.name.replace(/\s+/g, '').includes(normalized) || normalized.includes(m.name.replace(/\s+/g, '')));
  if (noSpace.length === 1) return noSpace[0];
  return undefined;
}

export default function MeetingForm({ open, editingMeeting, onOk, onCancel }: MeetingFormProps) {
  const [form] = Form.useForm();
  const [members, setMembers] = useState<Member[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [attendanceText, setAttendanceText] = useState('');
  const [parsedResult, setParsedResult] = useState<ParseResult | null>(null);
  const [locations, setLocations] = useState<string[]>([]);
  const [customTypes, setCustomTypes] = useState<string[]>([]);
  const [searchText, setSearchText] = useState('');
  const [meetingDate, setMeetingDate] = useState<dayjs.Dayjs | null>(null);
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [selectedPartyGroups, setSelectedPartyGroups] = useState<string[]>([]);

  useEffect(() => {
    db.members.toArray().then(setMembers);
    setLocations([...new Set([...PRESET_LOCATIONS_IMPORT, ...getStoredLocations()])]);
    setCustomTypes(getCustomTypes());
  }, [open]);

  useEffect(() => {
    if (open) {
      if (editingMeeting) {
        form.setFieldsValue({
          name: editingMeeting.name || '',
          timeRange: editingMeeting.time
            ? [
                dayjs(editingMeeting.time.split(' - ')[0], 'HH:mm'),
                dayjs(editingMeeting.time.split(' - ')[1], 'HH:mm'),
              ]
            : undefined,
          date: dayjs(editingMeeting.date),
          location: editingMeeting.location,
          host: editingMeeting.host,
          recorder: editingMeeting.recorder || '',
          topic: editingMeeting.topic,
          resolution: editingMeeting.resolution || '',
        });
        setParticipants(editingMeeting.participants);
        setMeetingDate(dayjs(editingMeeting.date));
        setSelectedTypes(editingMeeting.type);
        setSelectedPartyGroups(editingMeeting.partyGroups || []);
      } else {
        form.resetFields();
        setParticipants([]);
        setAttendanceText('');
        setParsedResult(null);
        setMeetingDate(null);
        setSelectedTypes([]);
        setSelectedPartyGroups([]);
      }
      setSearchText('');
    }
  }, [open, editingMeeting, form]);

  // 所有会议类型（默认+自定义）
  const allTypeOptions = useMemo(
    () => [...MEETING_TYPES, ...customTypes],
    [customTypes]
  );

  // 是否党小组会
  const isPartyGroupMeeting = selectedTypes.includes('党小组会');

  // 党小组选项：人员中出现的党小组 + 预设，按序号排序
  const partyGroupOptions = useMemo(() => {
    const groups = new Set<string>(PARTY_GROUPS);
    members.forEach((m) => {
      if (m.partyGroup && m.partyGroup.trim()) groups.add(m.partyGroup.trim());
    });
    return sortPartyGroups([...groups]);
  }, [members]);

  // 按会议日期时点在职的候选人员
  const candidateMembers = useMemo(() => {
    const dateStr = meetingDate ? meetingDate.format('YYYY-MM-DD') : dayjs().format('YYYY-MM-DD');
    return members.filter((m) => isActiveAt(m, dateStr));
  }, [members, meetingDate]);

  // 搜索过滤的候选列表
  const searchCandidates = useMemo(() => {
    if (!searchText.trim()) return [];
    const kw = searchText.trim().toLowerCase();
    return candidateMembers.filter(
      (m) => m.name.toLowerCase().includes(kw) || (m.title || '').toLowerCase().includes(kw)
    );
  }, [searchText, candidateMembers]);

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      if (selectedTypes.length === 0) {
        message.warning('请选择会议类型');
        return;
      }
      if (isPartyGroupMeeting && selectedPartyGroups.length === 0) {
        message.warning('会议类型包含"党小组会"，请选择所属党小组');
        return;
      }
      if (participants.length === 0) {
        message.warning('请至少选择一名参会人员');
        return;
      }
      // 新输入的地点保存为自定义预设
      persistLocationIfNew(values.location);
      onOk({ ...values, type: selectedTypes, participants, partyGroups: selectedPartyGroups });
      form.resetFields();
      setParticipants([]);
      setAttendanceText('');
      setParsedResult(null);
      setSelectedTypes([]);
      setSelectedPartyGroups([]);
      setMeetingDate(null);
    } catch {
      // validation failed
    }
  };

  const handleReuseLast = async () => {
    const allMeetings = await db.meetings.toArray();
    if (allMeetings.length === 0) {
      message.info('没有可复用的会议记录');
      return;
    }
    allMeetings.sort((a, b) => b.date.localeCompare(a.date));
    const last = allMeetings[0];
    form.setFieldsValue({
      name: last.name || '',
      timeRange: last.time
        ? [dayjs(last.time.split(' - ')[0], 'HH:mm'), dayjs(last.time.split(' - ')[1], 'HH:mm')]
        : undefined,
      location: last.location,
      host: last.host,
      recorder: last.recorder || '',
      topic: last.topic,
      resolution: last.resolution || '',
    });
    setParticipants(last.participants);
    setSelectedTypes(last.type);
    setSelectedPartyGroups(last.partyGroups || []);
    message.success('已复用上一条会议记录，请修改日期后保存');
  };

  // ==================== 参会人员操作 ====================

  const addMember = (member: Member, status: AttendanceStatus = 'attended') => {
    if (participants.find((p) => p.memberId === member.id)) {
      message.info(`${member.name} 已在参会列表中`);
      return;
    }
    setParticipants([
      ...participants,
      { memberId: member.id, name: member.name, status, isTemporary: false },
    ]);
  };

  const addTempPerson = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (participants.find((p) => p.name === trimmed && p.isTemporary)) {
      message.info(`${trimmed} 已在参会列表中`);
      return;
    }
    setParticipants([
      ...participants,
      {
        memberId: `temp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: trimmed,
        status: 'attended',
        isTemporary: true,
      },
    ]);
  };

  const updateStatus = (memberId: string, status: AttendanceStatus) => {
    setParticipants(participants.map((p) => (p.memberId === memberId
      ? {
          ...p,
          status,
          leaveReason: status === 'leave' ? p.leaveReason : undefined,
          // 切换到非出席状态时清除列席标记，避免脏状态
          isGuest: status === 'attended' ? p.isGuest : false,
        }
      : p)));
  };

  /** 切换列席标记（仅出席状态可标记列席） */
  const toggleGuest = (memberId: string, isGuest: boolean) => {
    setParticipants(participants.map((p) => (p.memberId === memberId ? { ...p, isGuest: p.status === 'attended' ? isGuest : false } : p)));
  };

  /** 日期变更：已选人员按新日期时点重算在职状态，非在职者保留但提示核实 */
  const handleDateChange = (d: dayjs.Dayjs | null) => {
    setMeetingDate(d);
    if (d) {
      const dateStr = d.format('YYYY-MM-DD');
      const notActiveNames = participants
        .filter((p) => {
          if (p.isTemporary) return false;
          const m = members.find((mm) => mm.id === p.memberId);
          return m && !isActiveAt(m, dateStr);
        })
        .map((p) => p.name);
      if (notActiveNames.length > 0) {
        message.warning(`按新日期时点，${notActiveNames.join('、')} 已非在职，请核实是否保留`);
      }
    }
  };

  const updateLeaveReason = (memberId: string, reason: string) => {
    setParticipants(participants.map((p) => (p.memberId === memberId ? { ...p, leaveReason: reason } : p)));
  };

  const removeParticipant = (memberId: string) => {
    setParticipants(participants.filter((p) => p.memberId !== memberId));
  };

  const selectAll = () => {
    const newParticipants: Participant[] = [...participants];
    candidateMembers.forEach((m) => {
      if (!newParticipants.find((p) => p.memberId === m.id)) {
        newParticipants.push({ memberId: m.id, name: m.name, status: 'attended', isTemporary: false });
      }
    });
    setParticipants(newParticipants);
  };

  const deselectAll = () => {
    setParticipants([]);
  };

  const selectCommittee = () => {
    const committeeMembers = candidateMembers.filter((m) => m.committeeRole);
    const newParticipants: Participant[] = [...participants];
    committeeMembers.forEach((m) => {
      if (!newParticipants.find((p) => p.memberId === m.id)) {
        newParticipants.push({ memberId: m.id, name: m.name, status: 'attended', isTemporary: false });
      }
    });
    setParticipants(newParticipants);
    message.success(`已选择 ${committeeMembers.length} 名支委委员`);
  };

  const selectPartyGroups = () => {
    if (selectedPartyGroups.length === 0) {
      message.warning('请先选择所属党小组');
      return;
    }
    const groupMembers = candidateMembers.filter(
      (m) => m.partyGroup && selectedPartyGroups.includes(m.partyGroup)
    );
    const newParticipants: Participant[] = [...participants];
    groupMembers.forEach((m) => {
      if (!newParticipants.find((p) => p.memberId === m.id)) {
        newParticipants.push({ memberId: m.id, name: m.name, status: 'attended', isTemporary: false });
      }
    });
    setParticipants(newParticipants);
    message.success(`已选择 ${groupMembers.length} 名党小组人员`);
  };

  // ==================== 智能解析 ====================

  const handleParseAttendance = () => {
    if (!attendanceText.trim()) {
      message.warning('请先粘贴参会接龙信息');
      return;
    }
    const result = parseAttendanceText(attendanceText);
    setParsedResult(result);
    if (result.onlyLeave) {
      message.success(
        `解析完成：仅识别到请假 ${result.leave.length} 人（其余在职人员将默认出席）`
      );
    } else {
      message.success(
        `解析完成：出席 ${result.attended.length} 人，请假 ${result.leave.length} 人，列席 ${result.observers.length} 人`
      );
    }
  };

  const handleConfirmImport = () => {
    if (!parsedResult) return;

    const newParticipants: Participant[] = [...participants];

    const importPerson = (p: ParsedParticipant, isGuest = false) => {
      const existingMember = matchMember(members, p.name);
      if (existingMember) {
        const idx = newParticipants.findIndex((np) => np.memberId === existingMember.id);
        if (idx >= 0) {
          // 冲突时请假优先：覆盖已按出席导入的记录（请假信息更具体；无新原因时保留已有）
          if (p.status === 'leave' && newParticipants[idx].status === 'attended') {
            newParticipants[idx] = {
              ...newParticipants[idx],
              status: 'leave',
              leaveReason: p.reason ?? newParticipants[idx].leaveReason,
              isGuest: false,
            };
          } else if (isGuest) {
            // 出席段+列席段同现：补标记列席
            newParticipants[idx] = { ...newParticipants[idx], isGuest: true };
          }
        } else {
          newParticipants.push({
            memberId: existingMember.id,
            name: existingMember.name,
            status: p.status,
            isTemporary: false,
            leaveReason: p.reason,
            isGuest,
          });
        }
      } else {
        if (!newParticipants.find((np) => np.name === p.name)) {
          const tempId = `temp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          newParticipants.push({
            memberId: tempId,
            name: p.name,
            status: p.status,
            isTemporary: true,
            leaveReason: p.reason,
            isGuest,
          });
        }
      }
    };

    // 处理出席人员
    parsedResult.attended.forEach((p) => importPerson(p));
    // 处理请假人员（后处理：冲突时覆盖出席记录，请假优先）
    parsedResult.leave.forEach((p) => importPerson(p));
    // 处理列席人员（isGuest 标记，与普通出席区分）
    parsedResult.observers.forEach((p) => importPerson(p, true));

    // 仅填请假人员：其余在职人员默认出席
    if (parsedResult.onlyLeave) {
      candidateMembers.forEach((m) => {
        if (!newParticipants.find((p) => p.memberId === m.id)) {
          newParticipants.push({ memberId: m.id, name: m.name, status: 'attended', isTemporary: false });
        }
      });
    }

    setParticipants(newParticipants);
    setParsedResult(null);
    setAttendanceText('');
    message.success('已导入参会人员');
  };

  /** 表单提交时保存新地点为自定义预设（避免输入过程产生中间态） */
  const persistLocationIfNew = (value: string) => {
    if (value && !PRESET_LOCATIONS_IMPORT.includes(value) && !getStoredLocations().includes(value)) {
      saveLocation(value);
      setLocations([...new Set([...PRESET_LOCATIONS_IMPORT, ...getStoredLocations()])]);
    }
  };

  /** 删除自定义地点（带确认；预设地点不可删） */
  const handleRemoveLocation = (loc: string) => {
    Modal.confirm({
      title: '删除自定义地点',
      content: `确认删除自定义地点"${loc}"？预设地点不受影响。`,
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: () => {
        const remaining = removeStoredLocation(loc);
        setLocations([...new Set([...PRESET_LOCATIONS_IMPORT, ...remaining])]);
        if (form.getFieldValue('location') === loc) {
          form.setFieldValue('location', undefined);
        }
        message.success(`已删除自定义地点：${loc}`);
      },
    });
  };

  /** 删除自定义会议类型（带确认；预设类型不可删） */
  const handleRemoveCustomType = (t: string) => {
    Modal.confirm({
      title: '删除自定义会议类型',
      content: `确认删除自定义会议类型"${t}"？已保存会议记录中的该类型不受影响。`,
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        const remaining = removeCustomType(t);
        setCustomTypes(remaining);
        setSelectedTypes(selectedTypes.filter((x) => x !== t));
        await addLog('DELETE_MEETING_TYPE', `删除自定义会议类型：${t}`);
        message.success(`已删除自定义类型：${t}`);
      },
    });
  };

  // 参会人员表格列
  const participantColumns = [
    {
      title: '姓名',
      dataIndex: 'name',
      key: 'name',
      width: 90,
      render: (name: string, record: Participant) => (
        <span>
          {name}
          {record.isTemporary && <Tag color="gold" style={{ marginLeft: 4, fontSize: 11 }}>临时</Tag>}
        </span>
      ),
    },
    {
      title: '部室',
      key: 'title',
      width: 110,
      render: (_: unknown, record: Participant) => {
        const m = members.find((mm) => mm.id === record.memberId);
        return m?.title || '-';
      },
    },
    {
      title: '党小组',
      key: 'partyGroup',
      width: 100,
      render: (_: unknown, record: Participant) => {
        const m = members.find((mm) => mm.id === record.memberId);
        return m?.partyGroup || '-';
      },
    },
    {
      title: '列席',
      dataIndex: 'isGuest',
      key: 'isGuest',
      width: 56,
      render: (v: boolean, record: Participant) => (
        <Checkbox
          checked={!!v}
          disabled={record.status !== 'attended'}
          onChange={(e) => toggleGuest(record.memberId, e.target.checked)}
        />
      ),
    },
    {
      title: '出席情况',
      dataIndex: 'status',
      key: 'status',
      width: 90,
      render: (status: AttendanceStatus, record: Participant) => (
        <Select
          size="small"
          value={status}
          onChange={(v) => updateStatus(record.memberId, v)}
          style={{ width: 76 }}
          options={[
            { label: '出席', value: 'attended' },
            { label: '请假', value: 'leave' },
            { label: '缺席', value: 'absent' },
          ]}
        />
      ),
    },
    {
      title: '请假原因',
      key: 'leaveReason',
      width: 130,
      render: (_: unknown, record: Participant) =>
        record.status === 'leave' ? (
          <Input
            size="small"
            placeholder="请假原因"
            value={record.leaveReason}
            onChange={(e) => updateLeaveReason(record.memberId, e.target.value)}
          />
        ) : (
          <span style={{ color: '#ccc' }}>-</span>
        ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 60,
      render: (_: unknown, record: Participant) => (
        <Button
          type="text"
          size="small"
          danger
          icon={<DeleteOutlined />}
          onClick={() => removeParticipant(record.memberId)}
        />
      ),
    },
  ];

  return (
    <Modal
      title={editingMeeting ? '编辑会议' : '新增会议'}
      open={open}
      onOk={handleOk}
      onCancel={onCancel}
      width={960}
      destroyOnHidden
      forceRender
    >
      <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
        {/* 复用按钮 */}
        {!editingMeeting && (
          <div style={{ marginBottom: 12 }}>
            <Button icon={<CopyOutlined />} onClick={handleReuseLast}>
              复用上一条记录
            </Button>
          </div>
        )}

        <Space style={{ width: '100%' }} size={16} wrap>
          <Form.Item name="name" label="会议名称（非必填）" style={{ minWidth: 300 }}>
            <Input placeholder="如：第三党小组6月《条例》学习会" />
          </Form.Item>
        </Space>
        <Space style={{ width: '100%' }} size={16} wrap>
          <Form.Item
            label="会议类型"
            required
            style={{ minWidth: 300 }}
          >
            <Select
              mode="tags"
              options={allTypeOptions.map((t) => ({ label: t, value: t }))}
              optionRender={(option) => {
                const t = String(option.value);
                return customTypes.includes(t) ? (
                  <span>
                    {t}
                    <DeleteOutlined
                      style={{ marginLeft: 8, color: '#ff4d4f' }}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveCustomType(t);
                      }}
                    />
                  </span>
                ) : (
                  <span>{t}</span>
                );
              }}
              placeholder="请选择（可多选，可输入新类型后回车添加）"
              value={selectedTypes}
              optionFilterProp="value"
              onChange={(vals) => {
                setSelectedTypes(vals);
                // 取消勾选"党小组会"时清空所属党小组（避免残留）
                if (!vals.includes('党小组会')) {
                  setSelectedPartyGroups([]);
                }
                // 输入新值回车时保存为自定义类型并记录日志
                vals.forEach((v: string) => {
                  if (!MEETING_TYPES.includes(v as never) && !getCustomTypes().includes(v)) {
                    saveCustomType(v);
                    setCustomTypes(getCustomTypes());
                    void addLog('ADD_MEETING_TYPE', `添加自定义会议类型：${v}`);
                  }
                });
              }}
            />
          </Form.Item>
          <Form.Item name="date" label="会议日期" rules={[{ required: true, message: '请选择日期' }]}>
            <DatePicker onChange={handleDateChange} />
          </Form.Item>
          <Form.Item name="timeRange" label="会议时间" rules={[{ required: true, message: '请选择时间' }]}>
            <TimePicker.RangePicker format="HH:mm" />
          </Form.Item>
        </Space>

        {/* 党小组会：选择所属党小组（可多选可单选） */}
        {isPartyGroupMeeting && (
          <Form.Item
            label="所属党小组（可多选）"
            required
            extra={'会议类型包含"党小组会"时需选择所属党小组'}
          >
            <Select
              mode="multiple"
              placeholder="请选择所属党小组"
              value={selectedPartyGroups}
              onChange={setSelectedPartyGroups}
              options={partyGroupOptions.map((g) => ({ label: g, value: g }))}
              style={{ maxWidth: 400 }}
            />
          </Form.Item>
        )}

        <Space style={{ width: '100%' }} size={16} wrap>
          <Form.Item name="location" label="会议地点" rules={[{ required: true, message: '请输入地点' }]}>
            <AutoComplete
              placeholder="请选择或输入地点（新地点保存时自动记住）"
              options={locations.map((l) => ({
                value: l,
                label: getStoredLocations().includes(l) ? (
                  <span>
                    {l}
                    <DeleteOutlined
                      style={{ marginLeft: 8, color: '#ff4d4f' }}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveLocation(l);
                      }}
                    />
                  </span>
                ) : (
                  l
                ),
              }))}
              filterOption={(input, option) =>
                (option?.value ?? '').toLowerCase().includes(input.toLowerCase())
              }
              style={{ minWidth: 260 }}
            />
          </Form.Item>
          <Form.Item name="host" label="主持人" rules={[{ required: true, message: '请输入主持人' }]}>
            <Input placeholder="请输入主持人" />
          </Form.Item>
          <Form.Item name="recorder" label="记录人">
            <Input placeholder="请输入记录人" />
          </Form.Item>
        </Space>
        <Form.Item name="topic" label="议题" rules={[{ required: true, message: '请输入议题' }]}>
          <TextArea rows={2} placeholder="请输入会议议题" />
        </Form.Item>

        {/* 参会人员文本识别 */}
        <Form.Item label="参会人员文本识别">
          <TextArea
            rows={4}
            placeholder={`粘贴参会接龙信息，例如：\n参会：1.张三 2.李四 3.王五\n请假：赵六（休假）、钱七（出差）\n列席：孙九\n\n若只填入请假人员，则其余人员默认出席即可，列席人员自行补充`}
            value={attendanceText}
            onChange={(e) => setAttendanceText(e.target.value)}
          />
          <div style={{ marginTop: 8, color: '#999', fontSize: 12, marginBottom: 4 }}>
            智能解析规则：若只填入请假人员，则其余人员默认出席即可，列席人员自行补充
          </div>
          <Button
            type="primary"
            ghost
            icon={<ThunderboltOutlined />}
            onClick={handleParseAttendance}
          >
            智能解析
          </Button>
        </Form.Item>

        {/* 解析结果预览 */}
        {parsedResult && (
          <div
            style={{
              marginBottom: 16,
              padding: 12,
              border: '1px solid #d9d9d9',
              borderRadius: 6,
              background: '#fafafa',
            }}
          >
            <div style={{ marginBottom: 8, fontWeight: 500 }}>解析结果预览：</div>
            {parsedResult.onlyLeave && (
              <div style={{ marginBottom: 8, color: '#1890ff', fontSize: 13 }}>
                未识别到"参会"段：确认导入后，全部在职人员将默认出席
              </div>
            )}
            {parsedResult.conflicts.length > 0 && (
              <div style={{ marginBottom: 8, color: '#fa8c16', fontSize: 13 }}>
                以下人员同时出现在出席与请假段，将按请假处理：{parsedResult.conflicts.join('、')}
              </div>
            )}
            {parsedResult.attended.length > 0 && (
              <div style={{ marginBottom: 4 }}>
                <span style={{ color: '#52c41a' }}>出席（{parsedResult.attended.length}人）：</span>
                {parsedResult.attended.map((p, i) => (
                  <Tag key={i} color="green" style={{ marginBottom: 2 }}>
                    {p.name}
                  </Tag>
                ))}
              </div>
            )}
            {parsedResult.leave.length > 0 && (
              <div style={{ marginBottom: 4 }}>
                <span style={{ color: '#faad14' }}>请假（{parsedResult.leave.length}人）：</span>
                {parsedResult.leave.map((p, i) => (
                  <Tag key={i} color="orange" style={{ marginBottom: 2 }}>
                    {p.name}{p.reason ? `（${p.reason}）` : ''}
                  </Tag>
                ))}
              </div>
            )}
            {parsedResult.observers.length > 0 && (
              <div style={{ marginBottom: 4 }}>
                <span style={{ color: '#fa8c16' }}>列席（{parsedResult.observers.length}人）：</span>
                {parsedResult.observers.map((p, i) => (
                  <Tag key={i} color="gold" style={{ marginBottom: 2 }}>
                    {p.name}
                  </Tag>
                ))}
              </div>
            )}
            {parsedResult.attended.length === 0 && parsedResult.leave.length === 0 && parsedResult.observers.length === 0 && (
              <div style={{ color: '#ff4d4f', marginBottom: 4 }}>未解析到人员，请检查文本格式</div>
            )}
            <Button
              type="primary"
              size="small"
              onClick={handleConfirmImport}
              style={{ marginTop: 8 }}
            >
              确认导入到参会人员
            </Button>
            <Button
              size="small"
              onClick={() => setParsedResult(null)}
              style={{ marginTop: 8, marginLeft: 8 }}
            >
              取消
            </Button>
          </div>
        )}

        {/* 参会人员选择（集成式） */}
        <Form.Item label="参会人员" required>
          {/* 搜索添加区 */}
          <div style={{ marginBottom: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
            <Input
              placeholder="搜索姓名/部室添加人员；输入未匹配姓名后回车添加临时人员"
              prefix={<SearchOutlined />}
              style={{ width: 380 }}
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              onPressEnter={() => {
                const trimmed = searchText.trim();
                if (!trimmed) return;
                const kw = trimmed.toLowerCase();
                const matched = candidateMembers.filter(
                  (m) => m.name.toLowerCase().includes(kw) || (m.title || '').toLowerCase().includes(kw)
                );
                if (matched.length === 1) {
                  // 唯一命中：回车直接添加
                  addMember(matched[0]);
                } else if (matched.length > 1) {
                  // 多人命中：不批量添加，提示点选
                  message.info(`匹配到 ${matched.length} 人，请点击候选名单选择`);
                } else {
                  addTempPerson(trimmed);
                }
                setSearchText('');
              }}
              allowClear
            />
            <span style={{ color: '#999', fontSize: 12 }}>
              已选 {participants.length} 人（出席{participants.filter((p) => p.status === 'attended' && !p.isGuest).length}人，
              列席{participants.filter((p) => p.status === 'attended' && p.isGuest).length}人，
              请假{participants.filter((p) => p.status === 'leave').length}人，
              缺席{participants.filter((p) => p.status === 'absent').length}人，
              临时{participants.filter((p) => p.isTemporary).length}人）
            </span>
          </div>

          {/* 搜索候选列表 */}
          {searchText.trim() && searchCandidates.length > 0 && (
            <div
              style={{
                marginBottom: 8,
                padding: 8,
                border: '1px solid #e8e8e8',
                borderRadius: 6,
                background: '#fafafa',
              }}
            >
              {searchCandidates.map((m) => (
                <Tag
                  key={m.id}
                  style={{ cursor: 'pointer', marginBottom: 4 }}
                  onClick={() => {
                    addMember(m);
                    setSearchText('');
                  }}
                >
                  {m.name}
                  {m.title ? `（${m.title}）` : ''}
                  {m.partyGroup ? ` [${m.partyGroup}]` : ''}
                  {m.committeeRole ? ` [${m.committeeRole}]` : ''}
                </Tag>
              ))}
            </div>
          )}

          {/* 快捷操作 */}
          <div style={{ marginBottom: 8 }}>
            <Button size="small" onClick={selectAll} style={{ marginRight: 8 }}>
              一键全选（在职）
            </Button>
            <Button size="small" onClick={selectCommittee} style={{ marginRight: 8 }}>
              选择支委委员
            </Button>
            {isPartyGroupMeeting && (
              <Button size="small" onClick={selectPartyGroups} style={{ marginRight: 8 }}>
                选择党小组人员
              </Button>
            )}
            <Button size="small" onClick={deselectAll}>
              一键取消
            </Button>
          </div>

          {/* 已选人员表格 */}
          <Table
            size="small"
            columns={participantColumns}
            dataSource={participants}
            rowKey="memberId"
            pagination={false}
            scroll={{ y: 260 }}
          />
        </Form.Item>

        <Form.Item name="resolution" label="会议决议/结论">
          <TextArea rows={3} placeholder="请输入会议决议或结论" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
