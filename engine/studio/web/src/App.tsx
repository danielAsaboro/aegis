import { useEffect, useState } from 'react';
import { Shell, type TabId } from './components/Shell';
import OverviewPage from './pages/Overview';
import LiveFeedPage from './pages/LiveFeed';
import AgentRunsPage from './pages/AgentRuns';
import StrategiesPage from './pages/Strategies';
import TradesPage from './pages/Trades';
import LogsPage from './pages/Logs';

const ALL_TABS: TabId[] = ['overview', 'live', 'agent', 'strategies', 'trades', 'logs'];

function tabFromHash(): TabId {
  const h = window.location.hash.replace('#', '') as TabId;
  return ALL_TABS.includes(h) ? h : 'overview';
}

export default function App() {
  const [tab, setTab] = useState<TabId>(tabFromHash);

  useEffect(() => {
    const handler = () => setTab(tabFromHash());
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, []);

  function navigate(t: TabId) {
    window.location.hash = t;
    setTab(t);
  }

  return (
    <Shell active={tab} onTabChange={navigate}>
      {tab === 'overview' && <OverviewPage />}
      {tab === 'live' && <LiveFeedPage />}
      {tab === 'agent' && <AgentRunsPage />}
      {tab === 'strategies' && <StrategiesPage />}
      {tab === 'trades' && <TradesPage />}
      {tab === 'logs' && <LogsPage />}
    </Shell>
  );
}
