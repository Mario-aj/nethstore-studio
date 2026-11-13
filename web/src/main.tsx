import '@fontsource/work-sans/latin-300.css';
import '@fontsource/work-sans/latin-300-italic.css';
import '@fontsource/work-sans/latin-400.css';
import '@fontsource/work-sans/latin-500.css';
import './shared/styles/tokens.css';
import './shared/styles/base.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { UpdatePrompt } from './app/UpdatePrompt';

async function start() {
  if (import.meta.env.MODE === 'mock') {
    const { startMockWorker } = await import('./mocks/browser');
    await startMockWorker();
  }
  const root = document.getElementById('root');
  if (!root) throw new Error('#root not found');
  createRoot(root).render(
    <StrictMode>
      <App>{import.meta.env.PROD ? <UpdatePrompt /> : null}</App>
    </StrictMode>,
  );
}

void start();
