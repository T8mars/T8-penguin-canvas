import { useTranslation } from 'react-i18next';
import { TOPAZ_VIDEO_CONTRACT } from '../../providers/models';

export default function TopazVideoControls({ quality, videoUrl, update }: {
  quality: string; videoUrl: string; update: (patch: Record<string, unknown>) => void;
}) {
  const { t } = useTranslation();
  return <div className="nodrag nowheel space-y-2">
    <label className="block text-[10px] text-[var(--t8-text-muted)]">
      {t('nodes:generation.topaz.restorationModel')}
      <select value={quality} onChange={(event) => update({ topazQuality: event.currentTarget.value })}
        className="t8-select mt-1 w-full min-w-0 px-2 py-1 text-xs">
        {TOPAZ_VIDEO_CONTRACT.qualities.map((value) => <option key={value} value={value}>{value}</option>)}
      </select>
    </label>
    <label className="block text-[10px] text-[var(--t8-text-muted)]">
      {t('nodes:generation.topaz.videoUrl')}
      <input value={videoUrl} onChange={(event) => update({ topazVideoUrl: event.currentTarget.value })}
        placeholder={t('nodes:generation.topaz.urlPlaceholder')}
        className="t8-input mt-1 w-full min-w-0 px-2 py-1 text-xs" />
    </label>
  </div>;
}
