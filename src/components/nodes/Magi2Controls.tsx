import { MAGI2, type Magi2Settings } from '../../utils/magi2';
import { useTranslation } from 'react-i18next';

const inputClass = 'nodrag nowheel w-full rounded border border-white/10 bg-white/5 px-2 py-1 text-xs outline-none';

export default function Magi2Controls({ data, update }: {
  data: Magi2Settings;
  update: (patch: Magi2Settings) => void;
}) {
  const { t: translate } = useTranslation();
  const labels: Record<string, string> = {
    auto: translate('magi2:auto'),
    text: translate('magi2:text'),
    frame: translate('magi2:frame'),
    reference: translate('magi2:reference'),
  };
  return (
    <div className="space-y-1.5" style={{ color: 'var(--t8-text-main)' }}>
      <label className="block text-[10px]">
        {translate('magi2:mode')}
        <select className={inputClass} value={data.magi2Mode ?? 'auto'} onChange={(event) => {
          const mode = event.currentTarget.value;
          update({ magi2Mode: mode });
        }}>
          {MAGI2.modes.map(mode => <option key={mode} value={mode} className="bg-zinc-900 text-white">{labels[mode]}</option>)}
        </select>
      </label>
      <p className="text-[10px] opacity-70">{translate('magi2:modeHint')}</p>
      <div className="grid grid-cols-2 gap-1.5">
        <label className="nodrag flex items-center gap-1 text-[10px]">
          <input type="checkbox" checked={data.magi2GenerateAudio ?? true} onChange={(event) => {
            const checked = event.currentTarget.checked;
            update({ magi2GenerateAudio: checked });
          }} />
          {translate('magi2:generateAudio')}
        </label>
        <label className="text-[10px]">
          {translate('magi2:seed')}
          <input className={inputClass} type="number" min={-1} max={MAGI2.maxSeed} step={1} value={data.magi2Seed ?? -1} onChange={(event) => {
            const seed = event.currentTarget.value === '' ? -1 : Number(event.currentTarget.value);
            if (Number.isInteger(seed) && seed >= -1 && seed <= MAGI2.maxSeed) update({ magi2Seed: seed });
          }} />
        </label>
      </div>
    </div>
  );
}
