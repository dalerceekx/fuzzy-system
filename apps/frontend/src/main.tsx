import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import './app/styles/index.css';

async function bootstrap(): Promise<void> {
  // `import.meta.env.DEV` is replaced with `false` in production builds, so
  // the in-browser mock backend is never part of a production bundle.
  if (import.meta.env.DEV && import.meta.env.VITE_ENABLE_MOCK === 'true') {
    const { installMockBackend } = await import('./mocks/browser');
    installMockBackend();
  }

  const container = document.getElementById('root');
  if (!container) throw new Error('#root topilmadi');
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void bootstrap();
