import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import MainLayout from './layouts/MainLayout';
import ErrorBoundary from './components/ErrorBoundary';
import Dashboard from './pages/Dashboard';
import Members from './pages/Members';
import Meetings from './pages/Meetings';
import Talks from './pages/Talks';
import Logs from './pages/Logs';
import Settings from './pages/Settings';
import { generateAutoBackupPayload } from './utils/backup';
import type { AutoBackupFormat } from './utils/backup';

/** 自动备份数据桥（V3.4 功能 1）：主进程调度器到期时经 executeJavaScript 调用此函数拉取整库备份内容 */
interface AutoBackupBridge {
  __autoBackupBridge?: (format: string) => Promise<{ json: string; excelBase64?: string } | null>;
}

function App() {
  useEffect(() => {
    // 挂载自动备份数据桥（IndexedDB 数据仅渲染进程可读，主进程写文件前经此获取备份内容）
    const w = window as unknown as AutoBackupBridge;
    w.__autoBackupBridge = async (format: string) => {
      const fmt: AutoBackupFormat = format === 'json+excel' ? 'json+excel' : 'json';
      try {
        return await generateAutoBackupPayload(fmt);
      } catch {
        return null;
      }
    };
    return () => {
      delete w.__autoBackupBridge;
    };
  }, []);

  return (
    <Routes>
      <Route element={<MainLayout />}>
        <Route path="/" element={<ErrorBoundary><Dashboard /></ErrorBoundary>} />
        <Route path="/dashboard" element={<ErrorBoundary><Dashboard /></ErrorBoundary>} />
        <Route path="/members" element={<ErrorBoundary><Members /></ErrorBoundary>} />
        <Route path="/meetings" element={<ErrorBoundary><Meetings /></ErrorBoundary>} />
        <Route path="/talks" element={<ErrorBoundary><Talks /></ErrorBoundary>} />
        <Route path="/logs" element={<ErrorBoundary><Logs /></ErrorBoundary>} />
        <Route path="/settings" element={<ErrorBoundary><Settings /></ErrorBoundary>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export default App;
