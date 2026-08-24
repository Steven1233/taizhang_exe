import { Routes, Route, Navigate } from 'react-router-dom';
import MainLayout from './layouts/MainLayout';
import ErrorBoundary from './components/ErrorBoundary';
import Dashboard from './pages/Dashboard';
import Members from './pages/Members';
import Meetings from './pages/Meetings';
import Talks from './pages/Talks';
import Logs from './pages/Logs';
import Settings from './pages/Settings';

function App() {
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
