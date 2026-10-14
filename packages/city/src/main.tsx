import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { connect } from './api.ts';
import { City } from './scene/City.tsx';
import { useCity } from './store.ts';
import { TaskBoard } from './ui/board/Board.tsx';
import { HarvestScreen } from './ui/harvest/HarvestScreen.tsx';
import { AgentPanel, CameraBar, Legend, PlanDrawer, PromptBar, TaskPanel, Ticker, TopBar } from './ui/Overlay.tsx';
// Fonts ship with the app: no third-party requests, and the HUD works offline.
import '@fontsource-variable/fraunces/soft.css';
import '@fontsource-variable/figtree';
import '@fontsource/ibm-plex-mono/400.css';
import './styles.css';

function App() {
  const [planOpen, setPlanOpen] = useState(false);
  const status = useCity((s) => (s.currentRunId ? s.runs[s.currentRunId]?.status : undefined));
  const prevStatus = useRef(status);

  useEffect(() => connect(), []);

  // Pop the plan open the moment the CTO gate is reached.
  useEffect(() => {
    if (status === 'awaiting_approval' && prevStatus.current !== 'awaiting_approval') setPlanOpen(true);
    if (status !== 'awaiting_approval' && prevStatus.current === 'awaiting_approval') setPlanOpen(false);
    prevStatus.current = status;
  }, [status]);

  return (
    <>
      <div className="stage">
        <City />
      </div>
      <TopBar onOpenPlan={() => setPlanOpen(true)} />
      <TaskBoard />
      <AgentPanel />
      <TaskPanel />
      <Ticker />
      <Legend />
      <PromptBar />
      <CameraBar />
      <PlanDrawer open={planOpen} onClose={() => setPlanOpen(false)} />
      <HarvestScreen />
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
