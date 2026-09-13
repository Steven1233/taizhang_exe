import { useState, useEffect, useCallback } from 'react';
import { Card, Row, Col, Select, Button, Spin, Tooltip, message, Segmented } from 'antd';
import { DownloadOutlined, QuestionCircleOutlined } from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import { db, normalizeMeetingTypes, normalizeMeetingPartyGroups, normalizeMember } from '../db';
import { addLog } from '../utils/logHelper';
import { exportDashboardReport } from '../utils/exportWord';
import { countActiveAttendance, membersActiveDuring, isActiveAt, countActiveMembersAt } from '../utils/memberStatus';
import { buildMonthStackSeries, buildDimensionAttendanceRates, type AttendanceDimension } from '../utils/chartSeries';
import type { Meeting, Member, TalkRecord } from '../types';
import { MEETING_TYPES, typeMeetingUnits, meetingTotalUnits } from '../types';

/** 年度无数据时的等高占位（V3.5 功能 1：居中灰字 + 图表底色，避免 ECharts 空坐标系） */
function ChartPlaceholder({ text, height }: { text: string; height: number }) {
  return (
    <div
      style={{
        height,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#999',
        fontSize: 14,
        background: '#fafafa',
      }}
    >
      {text}
    </div>
  );
}

export default function Dashboard() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [talks, setTalks] = useState<TalkRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  // V3.5.2：出勤对比维度（默认党小组，切换年份时保持）
  const [dim, setDim] = useState<AttendanceDimension>('partyGroup');

  const loadData = useCallback(async () => {
    setLoading(true);
    const [allMeetings, allMembers, allTalks] = await Promise.all([
      db.meetings.toArray(),
      db.members.toArray(),
      db.talkRecords.toArray(),
    ]);
    setMeetings(allMeetings.map((m) => normalizeMeetingPartyGroups(normalizeMeetingTypes(m))));
    setMembers(allMembers.map(normalizeMember));
    setTalks(allTalks);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const currentYear = new Date().getFullYear();
  const yearSet = new Set<number>();
  for (let i = -5; i <= 4; i++) yearSet.add(currentYear + i);
  for (const dateStr of meetings.map((m) => m.date).concat(talks.map((t) => t.talkDate))) {
    const y = Number(dateStr.substring(0, 4));
    if (Number.isInteger(y) && y >= 1900) yearSet.add(y);
  }
  const yearOptions = Array.from(yearSet)
    .sort((a, b) => a - b)
    .map((y) => ({ label: `${y}年`, value: y }));

  const yearMeetings = meetings.filter((m) => m.date.startsWith(String(year)));

  // V3.5.2：在职党员总数按所选年份时点统计（过去/未来年份=年末，当前年份=截至目前）
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const activeRefDate = year === currentYear ? todayStr : `${year}-12-31`;
  const activeMembersCount = countActiveMembersAt(members, activeRefDate);
  const activeLabel = year === currentYear ? '截至目前' : `${year}年末`;

  // 关键指标（V3.3：会议总数按套会拆开计入 = 各类型计次单位之和）
  const totalMeetings = yearMeetings.reduce((s, m) => s + meetingTotalUnits(m), 0);
  const currentMonth = String(new Date().getMonth() + 1).padStart(2, '0');
  const monthMeetings = yearMeetings
    .filter((m) => m.date.substring(5, 7) === currentMonth)
    .reduce((s, m) => s + meetingTotalUnits(m), 0);

  // 平均出勤率（V3.3：时间线在职口径——按会议日期时点判定在职，离开期间不计入）
  let totalAttendance = 0;
  let totalParticipants = 0;
  yearMeetings.forEach((m) => {
    const { shouldAttend, attended } = countActiveAttendance(m, members);
    totalParticipants += shouldAttend;
    totalAttendance += attended;
  });
  const avgRate = totalParticipants > 0 ? (totalAttendance / totalParticipants) * 100 : 0;

  // 会议类型分布 - 适配多选类型，每种类型独立计数
  // V3.2：党小组会按关联党小组数展开计次（大会嵌套党小组会，有几个党小组参加算几次）
  const typeCount: Record<string, number> = {};
  yearMeetings.forEach((m) => {
    m.type.forEach((t) => {
      typeCount[t] = (typeCount[t] || 0) + typeMeetingUnits(m, t);
    });
  });

  const typePieData = MEETING_TYPES.filter((t) => typeCount[t]).map((t) => ({
    name: t,
    value: typeCount[t],
  }));

  // 月度会议趋势 - 堆叠数据（V3.5 功能 1：提取为纯函数 buildMonthStackSeries，纳入自动化测试）
  const monthStackData = buildMonthStackSeries(meetings, year);

  // 出勤率排行 - 降序排列，并构建详细统计
  // V3.3：时间线在职口径——行范围为"年内任一会议日期时点在职"的人员，每场会议按该场日期单独判定计入
  // V3.4 功能10：排行仅显示当前在职人员（调离/借调/离职者不出现，状态恢复在职后自动重新出现）
  const memberStats = membersActiveDuring(members, yearMeetings)
    .filter((member) => member.status === 'active')
    .map((member) => {
      let total = 0;
      let attended = 0;
      let leave = 0;
      let absent = 0;
      yearMeetings.forEach((m) => {
        if (!isActiveAt(member, m.date)) return; // 离开期间不计入，离开前/回归后照常计入
        const p = m.participants.find((pt) => pt.memberId === member.id);
        if (p) {
          total++;
          if (p.status === 'attended') attended++;
          else if (p.status === 'leave') leave++;
          else absent++;
        }
      });
      return {
        name: member.name,
        total,
        attended,
        leave,
        absent,
        rate: total > 0 ? (attended / total) * 100 : 0,
      };
    })
    .sort((a, b) => b.rate - a.rate);

  // 出勤对比（V3.5.2：三维度统计——党小组/部室/部门支部，纯函数化，口径见 chartSeries.ts）
  const dimRates = buildDimensionAttendanceRates(yearMeetings, members, dim);
  const dimMeta: Record<AttendanceDimension, { label: string; snapLabel: string }> = {
    partyGroup: { label: '党小组', snapLabel: '党小组' },
    title: { label: '部室', snapLabel: '部室' },
    department: { label: '部门/支部', snapLabel: '部门' },
  };

  // 月度谈心谈话趋势（V3.0 新增）
  const yearTalks = talks.filter((t) => t.talkDate.startsWith(String(year)));
  const monthTalkSeries = [
    {
      name: '个别谈话',
      type: 'bar' as const,
      stack: 'total',
      emphasis: { focus: 'series' as const },
      itemStyle: { color: '#1890ff' },
      data: Array.from({ length: 12 }, (_, i) => {
        const key = String(i + 1).padStart(2, '0');
        return yearTalks.filter(
          (t) => t.talkDate.substring(5, 7) === key && t.method === 'individual'
        ).length;
      }),
    },
    {
      name: '集体谈话',
      type: 'bar' as const,
      stack: 'total',
      emphasis: { focus: 'series' as const },
      itemStyle: { color: '#722ed1' },
      data: Array.from({ length: 12 }, (_, i) => {
        const key = String(i + 1).padStart(2, '0');
        return yearTalks.filter(
          (t) => t.talkDate.substring(5, 7) === key && t.method === 'collective'
        ).length;
      }),
    },
    {
      name: '组织约谈',
      type: 'bar' as const,
      stack: 'total',
      emphasis: { focus: 'series' as const },
      itemStyle: { color: '#fa8c16' },
      data: Array.from({ length: 12 }, (_, i) => {
        const key = String(i + 1).padStart(2, '0');
        return yearTalks.filter(
          (t) => t.talkDate.substring(5, 7) === key && t.method === 'organized'
        ).length;
      }),
    },
    {
      name: '合计',
      type: 'line' as const,
      smooth: true,
      itemStyle: { color: '#CC0000' },
      lineStyle: { width: 2, color: '#CC0000' },
      data: Array.from({ length: 12 }, (_, i) => {
        const key = String(i + 1).padStart(2, '0');
        return yearTalks.filter((t) => t.talkDate.substring(5, 7) === key).length;
      }),
    },
  ];
  const totalYearTalks = yearTalks.length;

  // 构建导出所需的统计数据
  const getExportData = () => {
    const stats = {
      totalMeetings,
      avgAttendance: parseFloat(avgRate.toFixed(1)),
      activeMembers: activeMembersCount,
      monthMeetings,
    };
    const typeStats = typePieData.map((d) => ({ name: d.name, value: d.value }));
    const monthStats = Array.from({ length: 12 }, (_, i) => {
      const key = String(i + 1).padStart(2, '0');
      return {
        month: `${i + 1}月`,
        count: yearMeetings
          .filter((m) => m.date.substring(5, 7) === key)
          .reduce((s, m) => s + meetingTotalUnits(m), 0),
      };
    });
    const rankingData = memberStats.map((m) => ({ name: m.name, rate: parseFloat(m.rate.toFixed(1)) }));
    return { stats, typeStats, monthStats, rankingData };
  };

  const handleExportWord = async () => {
    setExporting(true);
    try {
      const { stats, typeStats, monthStats, rankingData } = getExportData();
      await exportDashboardReport(year, stats, typeStats, monthStats, rankingData, meetings, members);
      await addLog('EXPORT_DASHBOARD', `导出${year}年度看板报告`);
      message.success('导出成功');
    } catch (err) {
      console.error('导出看板报告失败:', err);
      message.error('导出失败，请重试');
    } finally {
      setExporting(false);
    }
  };

  const pieOption = {
    tooltip: { trigger: 'item' as const, formatter: '{b}: {c}次 ({d}%)' },
    legend: { orient: 'vertical' as const, right: 10, top: 20 },
    series: [
      {
        name: '会议类型',
        type: 'pie',
        radius: ['40%', '70%'],
        center: ['40%', '50%'],
        data: typePieData,
        label: { show: true, formatter: '{b}\n{d}%' },
        emphasis: {
          itemStyle: { shadowBlur: 10, shadowOffsetX: 0, shadowColor: 'rgba(0,0,0,0.5)' },
        },
      },
    ],
  };

  const barOption = {
    tooltip: { trigger: 'axis' as const, axisPointer: { type: 'shadow' as const } },
    legend: {
      orient: 'horizontal',
      bottom: 0,
      type: 'scroll',
    },
    grid: { left: '3%', right: '4%', bottom: '12%', top: '3%', containLabel: true },
    xAxis: {
      type: 'category' as const,
      data: Array.from({ length: 12 }, (_, i) => `${i + 1}月`),
    },
    yAxis: { type: 'value' as const },
    series: monthStackData,
    animationDuration: 500,
  };

  const rateBarOption = {
    tooltip: {
      trigger: 'axis' as const,
      axisPointer: { type: 'shadow' as const },
      formatter: (params: any) => {
        if (!params || params.length === 0) return '';
        const data = params[0];
        const idx = data.dataIndex;
        const stat = memberStats[idx];
        if (!stat) return '';
        return `
          <strong>${stat.name}</strong><br/>
          出席：${stat.attended}次<br/>
          请假：${stat.leave}次<br/>
          缺勤：${stat.absent}次<br/>
          应参会：${stat.total}次<br/>
          出勤率：${stat.rate.toFixed(1)}%
        `;
      },
    },
    grid: { left: '3%', right: '8%', bottom: '3%', containLabel: true },
    xAxis: {
      type: 'value' as const,
      max: 100,
      axisLabel: { formatter: '{value}%' },
    },
    yAxis: {
      type: 'category' as const,
      data: memberStats.map((m) => m.name),
      inverse: true,
    },
    series: [
      {
        type: 'bar',
        data: memberStats.map((m) => parseFloat(m.rate.toFixed(1))),
        itemStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 1,
            y2: 0,
            colorStops: [
              { offset: 0, color: '#ff4d4f' },
              { offset: 0.5, color: '#faad14' },
              { offset: 1, color: '#52c41a' },
            ],
          },
        },
        label: { show: true, position: 'right', formatter: '{c}%' },
      },
    ],
  };

  const dimOption =
    dimRates.length > 0
      ? {
          tooltip: {
            trigger: 'axis' as const,
            formatter: (params: any) => {
              if (!params || params.length === 0) return '';
              const data = params[0];
              const stat = dimRates[data.dataIndex];
              if (!stat) return '';
              return `
                <strong>${data.name}</strong><br/>
                出席：${stat.attended}人次 / 应到：${stat.total}人次<br/>
                ${dimMeta[dim].label}出勤率：${data.value}%<br/>
                <span style="color:#999;font-size:12px;">注：不含支委会出勤数据；未${dim === 'partyGroup' ? '编组' : dim === 'title' ? '填写部室' : '填写部门'}人员不计入</span>
              `;
            },
          },
          grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
          xAxis: {
            type: 'category' as const,
            data: dimRates.map((d) => d.name),
            axisLabel: { interval: 0, rotate: dimRates.length > 8 ? 30 : 0 },
          },
          yAxis: {
            type: 'value' as const,
            max: 100,
            axisLabel: { formatter: '{value}%' },
          },
          series: [
            {
              type: 'bar',
              data: dimRates.map((d) => parseFloat(d.rate.toFixed(1))),
              itemStyle: { color: '#CC0000' },
              label: { show: true, position: 'top', formatter: '{c}%' },
            },
          ],
        }
      : null;

  // 月度谈心谈话趋势图 option（V3.0 新增）
  const talkTrendOption = {
    tooltip: {
      trigger: 'axis' as const,
      axisPointer: { type: 'shadow' as const },
    },
    legend: {
      orient: 'horizontal',
      bottom: 0,
    },
    grid: { left: '3%', right: '4%', bottom: '12%', top: '8%', containLabel: true },
    xAxis: {
      type: 'category' as const,
      data: Array.from({ length: 12 }, (_, i) => `${i + 1}月`),
    },
    yAxis: { type: 'value' as const, minInterval: 1 },
    series: monthTalkSeries,
    animationDuration: 500,
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 100 }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div>
      <div className="toolbar">
        <div className="toolbar-left">
          <span style={{ fontSize: 16, fontWeight: 500 }}>数据看板</span>
          <Select
            value={year}
            onChange={setYear}
            style={{ width: 100 }}
            options={yearOptions}
          />
        </div>
        <Button
          type="primary"
          icon={<DownloadOutlined />}
          onClick={handleExportWord}
          loading={exporting}
        >
          导出看板报告
        </Button>
      </div>

      {/* 关键指标卡片 */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Card className="stat-card">
            <div className="stat-value">{totalMeetings}</div>
            <div className="stat-label">会议总数（{year}年）</div>
          </Card>
        </Col>
        <Col span={6}>
          <Card className="stat-card">
            <div className="stat-value">{avgRate.toFixed(1)}%</div>
            <div className="stat-label">
              平均出勤率
              <Tooltip
                title={
                  <div>
                    <div>计算方法：</div>
                    <div>平均出勤率 = 全年所有会议的在职出席人次 / 全年所有会议的在职应到人次 × 100%</div>
                    <div style={{ marginTop: 4 }}>· 按会议日期时点判定在职：调离/借调/离职期间不计入，离开前及回归后照常计入</div>
                    <div>· 列席人员计入出席</div>
                    <div>· 临时人员（未录入人员库）不计入</div>
                  </div>
                }
              >
                <QuestionCircleOutlined style={{ marginLeft: 6, color: '#999', cursor: 'help' }} />
              </Tooltip>
            </div>
          </Card>
        </Col>
        <Col span={6}>
          <Card className="stat-card">
            <div className="stat-value">{activeMembersCount}</div>
            <div className="stat-label">
              在职党员总数（{activeLabel}）
              <Tooltip
                title={
                  <div>
                    <div>计算方法：</div>
                    <div>统计参考时点状态为在职的党员人数（{activeLabel}）</div>
                    <div style={{ marginTop: 4 }}>· 过去/未来年份取该年 12 月 31 日时点，当前年份取截至目前</div>
                    <div>· 按状态历史时间线追溯：借调/调离/离职期间不计入，借调回归后恢复计入</div>
                    <div>· 该年份尚未入职（组织关系未转入）的人员不计入</div>
                  </div>
                }
              >
                <QuestionCircleOutlined style={{ marginLeft: 6, color: '#999', cursor: 'help' }} />
              </Tooltip>
            </div>
          </Card>
        </Col>
        <Col span={6}>
          <Card className="stat-card">
            <div className="stat-value">{monthMeetings}</div>
            <div className="stat-label">本月会议数</div>
          </Card>
        </Col>
      </Row>

      {/* 图表 */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={12}>
          <Card title="会议类型分布">
            {typePieData.length > 0 ? (
              <ReactECharts option={pieOption} notMerge style={{ height: 350 }} />
            ) : (
              <ChartPlaceholder text="该年度暂无会议记录" height={350} />
            )}
          </Card>
        </Col>
        <Col span={12}>
          <Card title="月度会议趋势">
            {yearMeetings.length > 0 ? (
              <ReactECharts option={barOption} notMerge style={{ height: 380 }} />
            ) : (
              <ChartPlaceholder text="该年度暂无会议记录" height={380} />
            )}
          </Card>
        </Col>
      </Row>

      {/* 中段：左列出勤率排行；右列部门出勤对比 + 月度谈心谈话趋势（V3.2 布局调整） */}
      <Row gutter={16}>
        <Col span={12}>
          <Card
            title={
              <span>
                党员出勤率排行（降序）
                <Tooltip
                  title={
                    <div>
                      <div>仅显示当前在职人员；调离 / 借调 / 离职者不参与排行，</div>
                      <div>状态恢复在职后自动重新出现。</div>
                    </div>
                  }
                >
                  <QuestionCircleOutlined style={{ marginLeft: 6, color: '#999', cursor: 'help' }} />
                </Tooltip>
              </span>
            }
          >
            {memberStats.length > 0 ? (
              <ReactECharts
                option={rateBarOption}
                notMerge
                style={{ height: Math.max(300, memberStats.length * 30) }}
              />
            ) : (
              <ChartPlaceholder text="该年度暂无出勤记录" height={300} />
            )}
          </Card>
        </Col>
        <Col span={12}>
          <Card
            title={
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span>
                  {dimMeta[dim].label}出勤对比（按会议时点统计）
                  <Tooltip
                    title={
                      <div>
                        <div>计算方式：</div>
                        <div>{dimMeta[dim].label}出勤率 = 该{dimMeta[dim].snapLabel}人员出席人次 / 应到人次 × 100%</div>
                        <div style={{ marginTop: 4 }}>· 按会议时点{dimMeta[dim].snapLabel}统计：每条考勤计入开会当天所属{dimMeta[dim].snapLabel}，人员更换后不改写历史</div>
                        <div>· 旧数据无快照时按当前{dimMeta[dim].snapLabel}统计</div>
                        <div>· 未{dim === 'partyGroup' ? '编组' : '填写' + dimMeta[dim].snapLabel}人员不计入</div>
                        <div style={{ marginTop: 4, color: '#faad14' }}>
                          注意：支委会仅统计有支委职务的人员，不纳入{dimMeta[dim].snapLabel}单独出勤计算。
                        </div>
                      </div>
                    }
                  >
                    <QuestionCircleOutlined style={{ marginLeft: 6, color: '#999', cursor: 'help' }} />
                  </Tooltip>
                </span>
                <Segmented
                  size="small"
                  value={dim}
                  onChange={(v) => setDim(v as AttendanceDimension)}
                  options={[
                    { label: '党小组', value: 'partyGroup' },
                    { label: '部室', value: 'title' },
                    { label: '部门/支部', value: 'department' },
                  ]}
                />
              </span>
            }
          >
            {dimOption ? (
              <ReactECharts option={dimOption} notMerge style={{ height: 350 }} />
            ) : (
              <ChartPlaceholder text="该年度暂无会议记录" height={350} />
            )}
          </Card>
          <Card
            title={`月度谈心谈话趋势（${year}年 · 共${totalYearTalks}次）`}
            style={{ marginTop: 16 }}
          >
            {totalYearTalks > 0 ? (
              <ReactECharts option={talkTrendOption} notMerge style={{ height: 320 }} />
            ) : (
              <ChartPlaceholder text="该年度暂无谈心谈话记录" height={320} />
            )}
          </Card>
        </Col>
      </Row>
    </div>
  );
}

