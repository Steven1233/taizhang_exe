import { useMemo, useState } from 'react';
import { Card, Tooltip, Button, Empty } from 'antd';
import { QuestionCircleOutlined } from '@ant-design/icons';
import type { Member } from '../types';
import { buildOrgChart, type OrgMember } from '../utils/orgChart';
import './OrgChart.css';

/**
 * 组织架构模块（V3.5.3：数据看板底部）
 *
 * 四层树：书记 → 副书记 → 支委会 → 党小组（可展开）
 * - 数据随人员管理实时更新（当前时点架构，不随看板年份切换）
 * - 人员范围：在职 + 借调（保留展示并标记）；调离/离职不显示
 * - 统计逻辑在 buildOrgChart 纯函数（orgChart.ts），本组件只负责渲染与展开交互
 */
export default function OrgChart({ members }: { members: Member[] }) {
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const data = useMemo(() => buildOrgChart(members, todayStr), [members, todayStr]);

  // 党小组展开状态（默认全部收起）
  const [openKeys, setOpenKeys] = useState<Set<string>>(new Set());
  const allOpen = data.groups.length > 0 && data.groups.every((g) => openKeys.has(g.name));
  const toggleGroup = (name: string) => {
    setOpenKeys((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };
  const toggleAll = () => {
    setOpenKeys(allOpen ? new Set() : new Set(data.groups.map((g) => g.name)));
  };

  return (
    <Card
      title={
        <span style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 16, fontWeight: 600 }}>组织架构</span>
          <span style={{ fontSize: 12, color: '#8c8c8c', fontWeight: 400 }}>
            共 {data.summary.total} 人 · 在职 {data.summary.active} · 借调 {data.summary.seconded} · 随「人员管理」实时更新
          </span>
          <Tooltip
            title={
              <div>
                <div>口径说明：</div>
                <div>· 人员范围：当前在职 + 借调人员（借调组织关系仍在支部，保留展示并标记）；调离 / 离职不显示</div>
                <div>· 数据来源：人员管理（支委职务 / 党小组 / 组长 / 部室 / 状态），进入看板自动读取最新</div>
                <div>· 党小组人数 = 组内当前在职 + 借调人数</div>
                <div>· 不随看板年份切换，始终展示当前时点架构</div>
              </div>
            }
          >
            <QuestionCircleOutlined style={{ color: '#999', cursor: 'help' }} />
          </Tooltip>
        </span>
      }
      extra={
        data.groups.length > 0 ? (
          <Button size="small" onClick={toggleAll}>
            {allOpen ? '收起全部' : '展开全部'}
          </Button>
        ) : undefined
      }
    >
      {data.empty ? (
        <Empty description="暂无在职党员，请先在人员管理中录入" style={{ padding: '32px 0' }} />
      ) : (
        <>
          <div className="org-tree">
            {/* 第一层：书记（常显，空缺显示灰字） */}
            <div className="org-center">
              {data.secretaries.length > 0 ? (
                data.secretaries.map((s) => <TopNode key={s.id} role="支部书记" name={s.name} />)
              ) : (
                <TopNode role="支部书记" name="" vacant />
              )}
            </div>

            {/* 第二层：副书记（无人时整层隐藏） */}
            {data.deputySecretaries.length > 0 && (
              <>
                <div className="org-drop" />
                <div className="org-center">
                  {data.deputySecretaries.map((d) => (
                    <TopNode key={d.id} role="支部副书记" name={d.name} />
                  ))}
                </div>
              </>
            )}

            {/* 第三层：支委会（按职务定义序，仅显示有人员的职务） */}
            {data.committee.length > 0 && (
              <>
                <div className="org-drop" />
                <ul className="org-fan">
                  {data.committee.map((c) => (
                    <li key={c.role}>
                      <div className="org-node org-com">
                        <div className="org-role">{c.role}</div>
                        {c.members.map((m) => (
                          <div className="org-name" key={m.id}>{m.name}</div>
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}

            {/* 第四层：党小组（可展开；未编组归虚线节点） */}
            {data.groups.length > 0 && (
              <>
                <div className="org-drop" />
                <ul className="org-fan">
                  {data.groups.map((g) => {
                    const open = openKeys.has(g.name);
                    return (
                      <li key={g.name}>
                        <div className={`org-group-card${g.ungrouped ? ' org-ungrouped' : ''}${open ? ' open' : ''}`}>
                          <div className="org-group-head" onClick={() => toggleGroup(g.name)}>
                            <span className="org-group-name">{g.name}</span>
                            <span className="org-count">{g.count}人</span>
                            <span className="org-arrow">▼</span>
                          </div>
                          <div className="org-group-body">
                            {g.leaders.map((m) => (
                              <MemberRow key={m.id} m={m} isLeader />
                            ))}
                            {g.members.map((m) => (
                              <MemberRow key={m.id} m={m} />
                            ))}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </div>

          <div className="org-legend">
            <span className="org-legend-item">
              <span className="org-star">★</span> + <span className="org-tag org-tag-leader">组长</span> 党小组组长（组内置顶）
            </span>
            <span className="org-legend-item">
              <span className="org-tag org-tag-role">支委职务</span> 支委职务标签
            </span>
            <span className="org-legend-item">
              <span className="org-tag org-tag-seconded">借调</span> 借调人员（保留展示）
            </span>
            <span className="org-legend-item">虚线卡片 = 未编入党小组人员</span>
          </div>
        </>
      )}
    </Card>
  );
}

/** 书记 / 副书记节点（vacant = 书记空缺常显灰字） */
function TopNode({ role, name, vacant }: { role: string; name: string; vacant?: boolean }) {
  return (
    <div className={`org-node org-sec${vacant ? ' org-vacant' : ''}`}>
      <div className="org-role">{role}</div>
      <div className="org-name">{vacant ? '空缺' : name}</div>
    </div>
  );
}

/** 组员行：姓名 + 部室；组长 ★ 置顶标记；支委 / 借调标签 */
function MemberRow({ m, isLeader }: { m: OrgMember; isLeader?: boolean }) {
  return (
    <div className="org-member">
      <div className="org-m-top">
        {isLeader && <span className="org-star">★</span>}
        <span className="org-m-name">{m.name}</span>
        {isLeader && <span className="org-tag org-tag-leader">组长</span>}
        {m.committeeRole && <span className="org-tag org-tag-role">{m.committeeRole}</span>}
        {m.isSeconded && <span className="org-tag org-tag-seconded">借调</span>}
      </div>
      <div className="org-m-sub">{m.title || '—'}</div>
    </div>
  );
}
