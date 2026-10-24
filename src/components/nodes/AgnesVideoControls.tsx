import { useTranslation } from 'react-i18next';
import { AGNES_VIDEO } from '../../utils/agnesVideo';

export default function AgnesVideoControls({ mode, migrated, update }: {
  mode: string; migrated: boolean; update: (patch: Record<string, unknown>) => void;
}) {
  const { t } = useTranslation();
  const style = { background: 'var(--t8-bg-panel)', color: 'var(--t8-text-main)', borderColor: 'var(--t8-border)' };
  return <div className="nodrag nowheel min-w-0 rounded border p-2 space-y-2" style={style} data-agnes-video-controls>
    <div className="text-xs font-semibold">{t('nodes:generation.agnes.title')}</div>
    <label className="block text-xs">{t('nodes:generation.agnes.mode')}
      <select value={mode} className="w-full rounded border px-2 py-1" style={style}
        onChange={event => { const value = event.currentTarget.value; update({ mode: value }); }}>
        {AGNES_VIDEO.modes.map(value => <option key={value} value={value}>{t(`nodes:generation.agnes.${value}` as any)}</option>)}
      </select>
    </label>
    <div className="text-[10px] leading-relaxed">{t('nodes:generation.agnes.hint')}</div>
    {migrated && <div role="status" className="text-[10px]">{t('nodes:generation.agnes.migrated')}</div>}
  </div>;
}
