import { useTranslation } from 'react-i18next';
import { SD25_FLASH } from '../../utils/seedance25Flash';
export default function Seedance25ReferenceControls({data,update}: {data: any; update: (patch: any) => void}) {
  const {t} = useTranslation();
  return <label className="nodrag nowheel block text-xs" style={{color:'var(--t8-text-main)'}}>
    {t('h3Turbo:referenceTask')}
    <select aria-label={t('h3Turbo:referenceTask')} value={data.seedance25ReferenceTaskType || 'auto'} onChange={e=>update({seedance25ReferenceTaskType:e.target.value})} className="block w-full rounded border px-2 py-1" style={{background:'var(--t8-bg-panel)',borderColor:'var(--t8-border)'}}>
      {SD25_FLASH.contract.taskTypes.map((type: string)=><option key={type} value={type}>{t(`h3Turbo:task_${type}`)}</option>)}
    </select>
    <span>{t('h3Turbo:referenceTaskHint')}</span>
  </label>;
}
