import { useRef, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { saveStartupDiagnostics } from '../utils/startupDiagnostics';

export default function StartupDiagnosticsSettings({ isPixel }: { isPixel: boolean }) {
  const { t } = useTranslation('settings');
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<'saved' | 'canceled' | 'failed' | null>(null);
  const desktop = Boolean(window.t8pc?.startupDiagnostics);
  const save = async () => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setMessage(null);
    try {
      const result = await saveStartupDiagnostics();
      setMessage(result.success ? 'saved' : result.canceled ? 'canceled' : 'failed');
    } catch { setMessage('failed'); }
    finally { inFlight.current = false; setBusy(false); }
  };
  return <section className={`t8-api-settings-section p-3 space-y-2 border ${isPixel ? '' : 'rounded-lg'}`} data-startup-diagnostics-settings>
    <strong className="block text-sm">{t('startupDiagnostics.title')}</strong>
    <p className="text-xs t8-api-settings-hint">{t(desktop ? 'startupDiagnostics.hint' : 'startupDiagnostics.browserHint')}</p>
    <button type="button" disabled={busy} onClick={() => void save()}
      className={`t8-api-settings-secondary-btn flex items-center gap-2 disabled:opacity-50 ${isPixel ? 'px-btn' : 'px-3 py-2 text-xs rounded-md border'}`}>
      {busy ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Download size={14} aria-hidden="true" />}
      {t(busy ? 'startupDiagnostics.saving' : 'startupDiagnostics.save')}
    </button>
    {message && <p className="text-xs t8-api-settings-hint" role={message === 'failed' ? 'alert' : 'status'}>{t(`startupDiagnostics.${message}`)}</p>}
  </section>;
}
