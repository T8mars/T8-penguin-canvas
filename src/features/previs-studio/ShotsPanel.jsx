import { Camera, Copy, FileImage, Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export function ShotsPanel({ shots, activeShotId, onSelect, onAdd, onDuplicate, onDelete, onRename, onCapture }) {
  const { t } = useTranslation('nodes')
  return (
    <div className="shots-panel">
      <div className="shots-panel-head">
        <div><strong>{t('previs.studio.shots.title')}</strong><small>{shots.length} {shots.length === 1 ? 'SHOT' : 'SHOTS'}</small></div>
        <button type="button" onClick={onAdd} disabled={shots.length >= 30}><Plus size={13} /> {t('previs.studio.shots.add')}</button>
      </div>
      <div className="shots-list">
        {shots.map((shot, index) => {
          const active = shot.id === activeShotId
          return (
            <article className={`shot-card ${active ? 'is-active' : ''}`} key={shot.id}>
              <button type="button" className="shot-card-select" onClick={() => onSelect(shot.id)} aria-label={t('previs.studio.shots.switchTo', { name: shot.name })}>
                <span className="shot-thumbnail">
                  {shot.thumbnail ? <img src={shot.thumbnail} alt={t('previs.studio.shots.thumbnailAlt', { name: shot.name })} /> : <span><Camera size={18} /><i>{t('previs.studio.shots.waiting')}</i></span>}
                  <b>{String(index + 1).padStart(2, '0')}</b>
                  {active && <em>ACTIVE</em>}
                </span>
              </button>
              <div className="shot-card-copy">
                <input
                  value={shot.name}
                  maxLength="30"
                  onChange={event => onRename(shot.id, event.target.value)}
                  onBlur={event => onRename(shot.id, event.target.value, true)}
                  onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }}
                  aria-label={t('previs.studio.shots.nameAria', { index: index + 1 })}
                />
                <span>{t('previs.studio.shots.meta', { seconds: shot.durationSeconds, fps: shot.fps, count: (shot.keyframes?.length || 0) + Object.values(shot.objectKeyframes || {}).reduce((sum, track) => sum + (track?.length || 0), 0) })}</span>
              </div>
              <div className="shot-card-actions">
                <button type="button" title={t('previs.studio.shots.capture')} aria-label={t('previs.studio.shots.capture')} onClick={() => onCapture(shot.id)} disabled={!active}><FileImage size={12} /></button>
                <button type="button" title={t('previs.studio.shots.duplicate')} aria-label={t('previs.studio.shots.duplicateNamed', { name: shot.name })} onClick={() => onDuplicate(shot.id)} disabled={shots.length >= 30}><Copy size={12} /></button>
                <button type="button" title={t('previs.studio.shots.delete')} aria-label={t('previs.studio.shots.deleteNamed', { name: shot.name })} onClick={() => onDelete(shot.id)} disabled={shots.length === 1}><Trash2 size={12} /></button>
              </div>
            </article>
          )
        })}
      </div>
      <p className="shots-panel-note">{t('previs.studio.shots.note')}</p>
    </div>
  )
}
