import { useCallback, useEffect, useState } from 'react';
import { Spin } from 'antd';
import type { Member } from '../types';
import { db, normalizeMember } from '../db';
import OrgChart from '../components/OrgChart';

/**
 * 组织架构页（V3.5.3：左侧菜单「数据看板」下方独立栏目）
 *
 * - 四层树状图：书记 → 副书记 → 支委会 → 党小组（可展开），随人员管理实时更新
 * - 人员范围：在职 + 借调（保留展示并标记）；调离/离职不显示
 * - 统计逻辑在 buildOrgChart 纯函数（orgChart.ts），本页面只负责数据加载
 */
export default function OrgChartPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    const allMembers = await db.members.toArray();
    setMembers(allMembers.map(normalizeMember));
    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '80px 0' }}>
        <Spin size="large" tip="加载中..." />
      </div>
    );
  }

  return <OrgChart members={members} />;
}
