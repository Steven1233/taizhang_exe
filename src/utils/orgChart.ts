/**
 * 组织架构数据构建（纯函数）
 * V3.5.3：数据看板「组织架构」模块——
 * 按人员管理现有字段（支委职务/党小组/组长/部室/状态）构建四层树结构，
 * 零新增数据字段；时间线口径与 isActiveAt 同源（statusAt）
 */
import type { Member, MemberStatus } from '../types';
import { COMMITTEE_ROLES, sortPartyGroups } from '../types';
import { statusAt } from './memberStatus';

/** 未编组人员的归集节点名 */
export const ORG_UNGROUPED = '未编组';

/** 架构节点人员（支委 / 组员通用） */
export interface OrgMember {
  id: string;
  name: string;
  title: string;         // 所在部室
  committeeRole: string; // 支委职务（组员标签用）
  isSeconded: boolean;   // 借调标记（保留展示）
}

/** 支委职务节点（按职务定义序，仅含有人员的职务） */
export interface OrgCommitteeRole {
  role: string;
  members: OrgMember[];
}

/** 党小组节点 */
export interface OrgGroup {
  name: string;         // 党小组名（未编组 = ORG_UNGROUPED）
  count: number;        // 人数 = 组长 + 组员（在职 + 借调）
  leaders: OrgMember[]; // 组长（isGroupLeader，置顶展示）
  members: OrgMember[]; // 普通组员
  ungrouped: boolean;   // 未编组节点（虚线样式）
}

/** 组织架构树数据 */
export interface OrgChartData {
  secretaries: OrgMember[];       // 书记（组件层常显，空缺显示灰字）
  deputySecretaries: OrgMember[]; // 副书记（无人时整层隐藏）
  committee: OrgCommitteeRole[];  // 支委会（组织/宣传/青年/纪检/保密/统战/群工，按定义序）
  groups: OrgGroup[];             // 党小组（sortPartyGroups 序，未编组最后）
  summary: { total: number; active: number; seconded: number };
  empty: boolean; // 无任何在职/借调人员
}

/**
 * 构建组织架构数据（V3.5.3）
 *
 * 口径：
 * - 人员范围：参考时点状态为在职或借调（借调组织关系仍在支部，保留并标记）；调离/离职不显示
 * - 状态判定：statusAt 时间线追溯（回溯补录的变更同样正确反映）
 * - 支委层级：committeeRole 匹配，按 COMMITTEE_ROLES 定义序，仅显示有人员的职务，同职务多人全列
 * - 党小组：partyGroup 分组，sortPartyGroups 排序，空值归「未编组」排最后
 * - 组长：isGroupLeader 置顶；人数 = 组内在职 + 借调
 */
export function buildOrgChart(members: Member[], refDate: string): OrgChartData {
  const withStatus = members.map((m) => ({ m, s: statusAt(m, refDate) }));
  const visible = withStatus.filter(({ s }) => s === 'active' || s === 'seconded');
  const toOrgMember = ({ m, s }: { m: Member; s: MemberStatus }): OrgMember => ({
    id: m.id,
    name: m.name,
    title: (m.title || '').trim(),
    committeeRole: (m.committeeRole || '').trim(),
    isSeconded: s === 'seconded',
  });

  const secretaries = visible
    .filter(({ m }) => (m.committeeRole || '').trim() === '支部书记')
    .map(toOrgMember);
  const deputySecretaries = visible
    .filter(({ m }) => (m.committeeRole || '').trim() === '支部副书记')
    .map(toOrgMember);

  const committee: OrgCommitteeRole[] = COMMITTEE_ROLES.filter(
    (role) => role !== '支部书记' && role !== '支部副书记'
  )
    .map((role) => ({
      role,
      members: visible
        .filter(({ m }) => (m.committeeRole || '').trim() === role)
        .map(toOrgMember),
    }))
    .filter((c) => c.members.length > 0);

  // 党小组分组（空值归「未编组」）
  const groupMap = new Map<string, { m: Member; s: MemberStatus; leader: boolean }[]>();
  visible.forEach((v) => {
    const name = (v.m.partyGroup || '').trim() || ORG_UNGROUPED;
    if (!groupMap.has(name)) groupMap.set(name, []);
    groupMap.get(name)!.push({ ...v, leader: !!v.m.isGroupLeader });
  });
  const groupNames = sortPartyGroups(
    Array.from(groupMap.keys()).filter((g) => g !== ORG_UNGROUPED)
  );
  if (groupMap.has(ORG_UNGROUPED)) groupNames.push(ORG_UNGROUPED);

  const groups: OrgGroup[] = groupNames.map((name) => {
    const list = groupMap.get(name)!;
    const leaders: OrgMember[] = [];
    const rest: OrgMember[] = [];
    list.forEach((v) => {
      const om = toOrgMember(v);
      (v.leader ? leaders : rest).push(om);
    });
    return { name, count: list.length, leaders, members: rest, ungrouped: name === ORG_UNGROUPED };
  });

  return {
    secretaries,
    deputySecretaries,
    committee,
    groups,
    summary: {
      total: visible.length,
      active: visible.filter(({ s }) => s === 'active').length,
      seconded: visible.filter(({ s }) => s === 'seconded').length,
    },
    empty: visible.length === 0,
  };
}
