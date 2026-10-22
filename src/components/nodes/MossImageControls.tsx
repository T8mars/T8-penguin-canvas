import { useTranslation } from 'react-i18next';
import { MOSS_IMAGE_CONTRACT } from '../../utils/mossImage';

export default function MossImageControls({ ratio, update }: {
  ratio: string; update: (patch: { aspectRatio: string }) => void;
}) {
  const { t } = useTranslation();
  const style = { background: 'var(--t8-bg-panel)', color: 'var(--t8-text-main)', borderColor: 'var(--t8-border)' };
  return <div className="nodrag nowheel min-w-0 rounded border p-2" style={style} data-moss-image-controls>
    <label className="block text-xs">{t('nodes:generation.aspectRatio')}
      <select className="w-full min-w-0 rounded border px-2 py-1 text-xs outline-none" style={style}
        aria-label={t('nodes:generation.aspectRatio')} value={ratio}
        onChange={(event) => { const value = event.currentTarget.value; update({ aspectRatio: value }); }}>
        {MOSS_IMAGE_CONTRACT.ratios.map((value) => <option key={value} value={value} style={style}>{value}</option>)}
      </select>
    </label>
  </div>;
}
