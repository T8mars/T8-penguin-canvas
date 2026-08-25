import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { useTranslation } from 'react-i18next';
import App from './App';
import './i18n';
import { installVisibleI18nAudit } from './i18n/visibleAudit';
import { installCanvasPerformanceProbe } from './utils/canvasPerformanceProbe';
import './styles/index.css';

const CollaborationWorkspace = lazy(() => import('./components/CollaborationWorkspace'));

function CollaborationLoading() {
  const { t } = useTranslation('shell');
  return <div className="grid h-screen place-items-center">{t('loading.collaboration')}</div>;
}

const rootView = window.location.pathname.startsWith('/collab')
  ? <Suspense fallback={<CollaborationLoading />}><CollaborationWorkspace /></Suspense>
  : <App />;

const app = import.meta.env.DEV && import.meta.env.VITE_T8_STRICT_MODE !== '1'
  ? rootView
  : (
    <StrictMode>
      {rootView}
    </StrictMode>
  );

createRoot(document.getElementById('root')!).render(app);
installCanvasPerformanceProbe();
installVisibleI18nAudit();
