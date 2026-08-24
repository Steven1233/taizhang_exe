import { useState, useEffect } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Layout, Menu, Button, notification } from 'antd';
import {
  DashboardOutlined,
  TeamOutlined,
  CalendarOutlined,
  FileTextOutlined,
  SettingOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  MessageOutlined,
} from '@ant-design/icons';
import { autoSyncManager } from '../utils/autoSync';
import type { AutoSyncReport } from '../utils/autoSync';
import { addLog } from '../utils/logHelper';

const { Header, Sider, Content } = Layout;

const menuItems = [
  { key: '/dashboard', icon: <DashboardOutlined />, label: '数据看板' },
  { key: '/members', icon: <TeamOutlined />, label: '人员管理' },
  { key: '/meetings', icon: <CalendarOutlined />, label: '会议管理' },
  { key: '/talks', icon: <MessageOutlined />, label: '谈心谈话' },
  { key: '/logs', icon: <FileTextOutlined />, label: '操作日志' },
  { key: '/settings', icon: <SettingOutlined />, label: '数据管理' },
];

export default function MainLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  // 应用启动时启动定时自动融合调度器（依据数据管理页保存的配置）
  useEffect(() => {
    const handleReport = async (report: AutoSyncReport) => {
      if (!report.folderOk || report.filesFound === 0) return;
      const okCount = report.reports.filter((r) => r.ok).length;
      const failCount = report.reports.length - okCount;
      const totalAddMeetings = report.reports.reduce((sum, r) => sum + (r.result?.addMeetings || 0), 0);
      const totalAddMembers = report.reports.reduce((sum, r) => sum + (r.result?.addMembers || 0), 0);
      const totalAddTalks = report.reports.reduce((sum, r) => sum + (r.result?.addTalks || 0), 0);
      notification.open({
        message: failCount === 0 ? '自动融合完成' : '自动融合完成（部分失败）',
        description: `已处理 ${okCount} 个备份文件：新增会议 ${totalAddMeetings} 条、人员 ${totalAddMembers} 人、谈话 ${totalAddTalks} 条${failCount > 0 ? `；${failCount} 个文件处理失败` : ''}`,
        placement: 'bottomRight',
        duration: 8,
      });
      await addLog(
        'AUTO_MERGE_DATA',
        `自动融合：处理${okCount}个文件${failCount > 0 ? `，失败${failCount}个` : ''}，新增会议${totalAddMeetings}条、人员${totalAddMembers}人、谈话${totalAddTalks}条`,
      );
    };
    autoSyncManager.start(handleReport);
    return () => autoSyncManager.stop();
  }, []);

  const selectedKey = '/' + (location.pathname.split('/')[1] || 'dashboard');

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        trigger={null}
        collapsible
        collapsed={collapsed}
        theme="dark"
        width={200}
        style={{
          overflow: 'auto',
          height: '100vh',
          position: 'fixed',
          left: 0,
          top: 0,
          bottom: 0,
          zIndex: 10,
        }}
      >
        <div className="logo-container">
          <span className={`logo-text ${collapsed ? 'collapsed' : ''}`}>
            {collapsed ? '党建' : '党建工作台账'}
          </span>
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selectedKey]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
        />
      </Sider>
      <Layout style={{ marginLeft: collapsed ? 80 : 200, transition: 'all 0.2s' }}>
        <Header
          style={{
            padding: '0 24px',
            background: '#fff',
            display: 'flex',
            alignItems: 'center',
            borderBottom: '1px solid #f0f0f0',
            position: 'sticky',
            top: 0,
            zIndex: 9,
          }}
        >
          <Button
            type="text"
            icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={() => setCollapsed(!collapsed)}
            style={{ fontSize: 16, width: 40, height: 40 }}
          />
          <span style={{ marginLeft: 12, fontSize: 16, fontWeight: 500 }}>
            党建工作台账应用
          </span>
        </Header>
        <Content style={{ padding: 24, minHeight: 280 }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}