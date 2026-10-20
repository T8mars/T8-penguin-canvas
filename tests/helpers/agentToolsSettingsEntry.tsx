import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import AgentToolsSettings from '../../src/components/AgentToolsSettings';
import { agentToolsZh } from '../../src/i18n/agentToolsCatalog';

const i18n = createInstance();
void i18n.init({ lng: 'zh-CN', resources: { 'zh-CN': { settings: { agentTools: agentToolsZh } } }, interpolation: { escapeValue: false } }).then(() => {
  createRoot(document.getElementById('root')!).render(<StrictMode><I18nextProvider i18n={i18n}><AgentToolsSettings isPixel={false} /></I18nextProvider></StrictMode>);
});
