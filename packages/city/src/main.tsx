import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { connect } from './api.ts';
import { City } from './scene/City.tsx';
import { useCity } from './store.ts';
import { AgentPanel, Legend, PlanDrawer, PromptBar, TaskBoard, Ticker, TopBar } from './ui/Overlay.tsx';
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
      <Ticker />
      <Legend />
      <PromptBar />
      <PlanDrawer open={planOpen} onClose={() => setPlanOpen(false)} />
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
