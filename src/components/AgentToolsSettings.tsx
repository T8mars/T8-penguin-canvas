import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FolderOpen, Loader2, RefreshCw } from 'lucide-react';

export default function AgentToolsSettings({ isPixel }: { isPixel: boolean }) {
  const { t } = useTranslation('settings');
  const bridge = window.t8pc?.agentTools;
  const inFlight = useRef(false);
  const sequence = useRef(0);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<T8AgentToolsStatus | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const perform = async (repair: boolean) => {
    if (!bridge || inFlight.current) return;
    const request = ++sequence.current;
    inFlight.current = true; setBusy(true); setMessage(null);
    try {
      const result = await (repair ? bridge.repair() : bridge.status());
      if (sequence.current !== request) return;
      if (result.success && result.data) {
        setStatus(result.data);
        if (repair) setMessage(result.data.changed ? 'saved' : 'unchanged');
      } else {
        setStatus(null);
        setMessage(result.code === 'AGENT_TOOLS_SOURCE_MISMATCH' ? 'sourceMismatch'
          : result.code === 'AGENT_TOOLS_TARGET_UNMANAGED' ? 'unmanaged' : 'failed');
      }
    } catch { if (sequence.current === request) { setStatus(null); setMessage('failed'); } }
    finally {
      if (sequence.current === request) { inFlight.current = false; setBusy(false); }
    }
  };
  useEffect(() => {
    void perform(false);
    return () => { sequence.current++; inFlight.current = false; };
  }, [bridge]);
  const open = async () => {
    if (busy || status?.state !== 'current') return;
    const request = sequence.current;
    try {
      const result = await window.t8pc?.openPath(status.cliRoot);
      if (sequence.current === request && !result?.success) setMessage('openFailed');
    } catch { if (sequence.current === request) setMessage('openFailed'); }
  };
  const button = `t8-api-settings-secondary-btn flex items-center gap-2 disabled:opacity-50 ${isPixel ? 'px-btn' : 'px-3 py-2 text-xs rounded-md border'}`;
  return <section className={`t8-api-settings-section p-3 space-y-2 border ${isPixel ? '' : 'rounded-lg'}`} data-agent-tools-settings>
    <strong className="block text-sm">{t('agentTools.title')}</strong>
    <p className="text-xs t8-api-settings-hint">{t(bridge ? 'agentTools.hint' : 'agentTools.desktopOnly')}</p>
    {bridge && <>
      {status && <p className="text-xs t8-api-settings-hint" role="status">{t(`agentTools.${status.state}`)}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={button} disabled={busy || status?.state === 'unmanaged' || message === 'sourceMismatch'} onClick={() => void perform(true)}>
          {busy ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <RefreshCw size={14} aria-hidden="true" />}
          {t(busy ? 'agentTools.busy' : 'agentTools.repair')}
        </button>
        <button type="button" className={button} disabled={busy} onClick={() => void perform(false)}>{t('agentTools.refresh')}</button>
        {status?.state === 'current' && <button type="button" className={button} disabled={busy} onClick={() => void open()}><FolderOpen size={14} aria-hidden="true" />{t('agentTools.open')}</button>}
      </div>
      {status && <div className="text-xs space-y-1 t8-api-settings-hint">
        <p>{t('agentTools.version', { cli: status.cliVersion, skill: status.skillVersion })}</p>
        {status.state === 'current' && <p>{t('agentTools.cliRoot')}：<code className="block break-all select-text">{status.cliRoot}</code></p>}
      </div>}
    </>}
    {message && <p className="text-xs t8-api-settings-hint" role={['saved', 'unchanged'].includes(message) ? 'status' : 'alert'}>{t(`agentTools.${message}`)}</p>}
  </section>;
}
