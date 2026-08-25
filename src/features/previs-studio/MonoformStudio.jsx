import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Box, BoxSelect, Camera, ChevronDown, CircleDot, Copy, Download,
  FileImage, FileVideo2, Focus, FolderOpen, Grid3X3, Import, Lock, MousePointer2, Move3D, Pause, Play, Plus,
  Github, Heart, Redo2, RotateCw, Save, Settings2, SkipBack, SkipForward, Sparkles,
  ScanLine, Trash2, Undo2, UserRound, Video, ZoomIn,
  Unlock, X,
} from 'lucide-react'
import { MainViewport, CameraPreview } from './Viewport.jsx'
import { JOINT_DEFINITIONS, JOINT_GROUPS, RIG_PRESET_GROUPS, RIG_PRESET_OPTIONS, cloneJointPose, interpolateJointPose, normalizePoseId, poseForObject, presetJoints, presetPhase, presetRoot } from './rig.js'

const FPS = 24
const TOTAL_FRAMES = 120
const CAMERA_ID = '__shot_camera__'
const PROJECT_STORAGE_KEY = 't8-previs-studio-project'
const LEGACY_PROJECT_STORAGE_KEY = 'stageframe-project'
const CUSTOM_POSE_STORAGE_KEY = 'monoform-custom-poses'
const PROJECT_VERSION = 8
const BRAND_MARK_URL = `${import.meta.env.BASE_URL}previs-studio/branding/monoform-mark.png`
export const MONOFORM_SOURCE_URL = 'https://github.com/GuiYi-Xi/monoform-previs-studio'
export const MONOFORM_SOURCE_COMMIT = '77f4bae83eeee550a6f416757231f438155bf674'
const ASPECT_RATIOS = [
  { value: '16:9', labelKey: 'landscape', ratio: 16 / 9 },
  { value: '9:16', labelKey: 'vertical', ratio: 9 / 16 },
  { value: '4:3', labelKey: 'classic', ratio: 4 / 3 },
  { value: '3:2', labelKey: 'photo', ratio: 3 / 2 },
  { value: '1:1', labelKey: 'square', ratio: 1 },
  { value: '1.85:1', labelKey: 'cinema', ratio: 1.85 },
  { value: '2.39:1', labelKey: 'anamorphic', ratio: 2.39 },
]
const aspectValue = value => ASPECT_RATIOS.find(option => option.value === value)?.ratio || 16 / 9
const nextPaint = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))

function exportDimensionsForAspect(aspectRatio) {
  const ratio = aspectValue(aspectRatio)
  const even = value => Math.max(2, Math.round(value / 2) * 2)
  return ratio >= 1
    ? { width: 1280, height: even(1280 / ratio) }
    : { width: even(1280 * ratio), height: 1280 }
}

const initialObjects = [
  {
    id: 'actor-lead', name: '人物 · 主角', type: 'person', bodyType: 'standard', pose: 'walk',
    poseTime: presetPhase('walk'), position: [-1.25, 0, 0.3], rotation: [0, 0.25, 0], scale: [1, 1, 1], color: '#e8e3d8', joints: presetJoints(),
  },
  {
    id: 'block-stage', name: '平台', type: 'box',
    position: [1.4, 0.45, -0.8], rotation: [0, -0.18, 0], scale: [2.8, 0.9, 2.1], color: '#9a968c',
  },
  {
    id: 'block-step', name: '台阶', type: 'box',
    position: [2.9, 0.18, 0.55], rotation: [0, -0.18, 0], scale: [1.7, 0.36, 1.1], color: '#77746d',
  },
]

const initialCamera = {
  position: [7.4, 4.6, 8.2],
  target: [0.2, 1.2, 0],
  focalLength: 42,
  aspectRatio: '16:9',
}

const initialKeyframes = []
const initialCharacterKeyframes = {}

const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
const radToDeg = value => Math.round((value * 180 / Math.PI) * 10) / 10
const degToRad = value => Number(value || 0) * Math.PI / 180
const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
const lerp = (a, b, t) => a + (b - a) * t
const ease = t => t * t * (3 - 2 * t)
const normalizeInterpolation = value => ['smooth', 'linear', 'hold'].includes(value) ? value : 'smooth'
const segmentAmount = (key, amount) => key?.interpolation === 'hold' ? 0 : key?.interpolation === 'linear' ? amount : ease(amount)
const normalizeKeyframes = keys => (keys || []).map(key => ({ ...key, interpolation: normalizeInterpolation(key.interpolation) }))
const POSE_ENGLISH_LABELS = { idle: 'Standing', tpose: 'T-pose', sad_pose: 'Slouched', walk: 'Walk', run: 'Run', agree: 'Nod', headShake: 'Head shake' }
const POSE_GROUP_ENGLISH_LABELS = { '基础': 'Basic', '移动': 'Movement', '表演': 'Performance' }
const JOINT_GROUP_ENGLISH_LABELS = { '躯干与头部': 'Torso and head', '左臂': 'Left arm', '右臂': 'Right arm', '左腿': 'Left leg', '右腿': 'Right leg', '左手指': 'Left fingers', '右手指': 'Right fingers' }
const englishBoneLabel = id => id.replace(/^mixamorig/, '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ')

function normalizePerson(object) {
  if (object?.type !== 'person') return object
  const pose = normalizePoseId(object.pose)
  return {
    ...object,
    pose,
    poseTime: Number.isFinite(object.poseTime) ? object.poseTime : presetPhase(pose),
    rigRoot: [0, 0, 0],
    joints: cloneJointPose(object.joints),
    footLock: Boolean(object.footLock),
  }
}

function readCustomPoses() {
  try {
    const poses = JSON.parse(localStorage.getItem(CUSTOM_POSE_STORAGE_KEY) || '[]')
    if (!Array.isArray(poses)) return []
    return poses.filter(pose => pose?.id && pose?.name).map(pose => ({
      ...pose,
      pose: normalizePoseId(pose.pose),
      poseTime: Number.isFinite(pose.poseTime) ? pose.poseTime : presetPhase(pose.pose),
      rigRoot: Array.isArray(pose.rigRoot) ? pose.rigRoot.slice(0, 3) : presetRoot(),
      joints: cloneJointPose(pose.joints),
    }))
  } catch {
    return []
  }
}

function normalizeObjectTracks(tracks = {}) {
  return Object.fromEntries(Object.entries(tracks).map(([id, keys]) => [id, (keys || []).map(key => {
    const pose = normalizePoseId(key.pose)
    return {
      ...key,
      interpolation: normalizeInterpolation(key.interpolation),
      pose,
      poseTime: Number.isFinite(key.poseTime) ? key.poseTime : presetPhase(pose),
      rigRoot: [0, 0, 0],
      joints: cloneJointPose(key.joints),
    }
  })]))
}

function normalizeProject(data) {
  if (!data || !Array.isArray(data.objects)) return null
  const tracks = data.objectKeyframes || data.characterKeyframes || {}
  return { ...data, objects: data.objects.map(normalizePerson), keyframes: normalizeKeyframes(data.keyframes), objectKeyframes: normalizeObjectTracks(tracks) }
}

function readCachedProject(storageKey = PROJECT_STORAGE_KEY) {
  try {
    const current = localStorage.getItem(storageKey)
    const legacy = current ? null : localStorage.getItem(LEGACY_PROJECT_STORAGE_KEY)
    const serialized = current || legacy
    const data = JSON.parse(serialized || 'null')
    if (!data || !Array.isArray(data.objects)) return null
    if (!current && legacy) localStorage.setItem(storageKey, legacy)
    return normalizeProject(data)
  } catch {
    return null
  }
}

function projectData({ objects, camera, keyframes, objectKeyframes }) {
  return {
    version: PROJECT_VERSION,
    objects,
    camera,
    keyframes,
    objectKeyframes,
  }
}

function cameraAtFrame(keyframes, frame, aspectRatio = '16:9') {
  const sorted = [...keyframes].sort((a, b) => a.frame - b.frame)
  if (!sorted.length) return { ...initialCamera, aspectRatio }
  const exact = sorted.find(key => key.frame === frame)
  if (exact) return { ...exact, aspectRatio }
  if (frame <= sorted[0].frame) return { ...sorted[0], aspectRatio }
  if (frame >= sorted.at(-1).frame) return { ...sorted.at(-1), aspectRatio }
  const rightIndex = sorted.findIndex(key => key.frame >= frame)
  const left = sorted[rightIndex - 1]
  const right = sorted[rightIndex]
  const t = segmentAmount(left, (frame - left.frame) / Math.max(1, right.frame - left.frame))
  return {
    position: left.position.map((value, index) => lerp(value, right.position[index], t)),
    target: left.target.map((value, index) => lerp(value, right.target[index], t)),
    focalLength: lerp(left.focalLength, right.focalLength, t),
    aspectRatio,
  }
}

function objectKeyframeFromObject(object, frame) {
  const rig = poseForObject(object)
  return {
    frame,
    interpolation: 'smooth',
    position: [...object.position],
    rotation: [...object.rotation],
    scale: [...object.scale],
    pose: normalizePoseId(object.pose),
    poseTime: Number.isFinite(object.poseTime) ? object.poseTime : presetPhase(object.pose),
    rigRoot: [...rig.root],
    joints: cloneJointPose(rig.joints),
  }
}

function objectAtFrame(object, keyframes = [], frame) {
  const sorted = [...keyframes].sort((a, b) => a.frame - b.frame)
  if (!sorted.length) return object
  const applyKey = key => ({
    ...object,
    position: [...key.position],
    rotation: [...key.rotation],
    scale: [...key.scale],
    pose: normalizePoseId(key.pose || object.pose),
    poseTime: Number.isFinite(key.poseTime) ? key.poseTime : presetPhase(key.pose || object.pose),
    rigRoot: [...(key.rigRoot || poseForObject({ ...object, pose: key.pose || object.pose }).root)],
    joints: cloneJointPose(key.joints || poseForObject({ ...object, pose: key.pose || object.pose }).joints),
  })
  const exact = sorted.find(key => key.frame === frame)
  if (exact) return applyKey(exact)
  if (frame <= sorted[0].frame) return applyKey(sorted[0])
  if (frame >= sorted.at(-1).frame) return applyKey(sorted.at(-1))
  const rightIndex = sorted.findIndex(key => key.frame >= frame)
  const left = sorted[rightIndex - 1]
  const right = sorted[rightIndex]
  const t = segmentAmount(left, (frame - left.frame) / Math.max(1, right.frame - left.frame))
  const leftRoot = left.rigRoot || poseForObject({ ...object, pose: left.pose || object.pose }).root
  const rightRoot = right.rigRoot || poseForObject({ ...object, pose: right.pose || object.pose }).root
  const leftPoseTime = Number.isFinite(left.poseTime) ? left.poseTime : presetPhase(left.pose || object.pose)
  const rightPoseTime = Number.isFinite(right.poseTime) ? right.poseTime : presetPhase(right.pose || object.pose)
  return {
    ...object,
    position: left.position.map((value, index) => lerp(value, right.position[index], t)),
    rotation: left.rotation.map((value, index) => lerp(value, right.rotation[index], t)),
    scale: left.scale.map((value, index) => lerp(value, right.scale[index], t)),
    pose: normalizePoseId(left.pose || object.pose),
    poseTime: lerp(leftPoseTime, rightPoseTime, t),
    rigRoot: leftRoot.map((value, index) => lerp(value, rightRoot[index], t)),
    joints: interpolateJointPose(
      left.joints || poseForObject({ ...object, pose: left.pose || object.pose }).joints,
      right.joints || poseForObject({ ...object, pose: right.pose || object.pose }).joints,
      t,
    ),
  }
}

function objectsAtFrame(objects, objectKeyframes, frame) {
  return objects.map(object => objectAtFrame(object, objectKeyframes[object.id], frame))
}

function fallbackCharacterKeyframes() {
  return {}
}

function ToolButton({ icon: Icon, active, label, onClick, disabled = false, shortcut }) {
  return (
    <button className={`icon-button ${active ? 'is-active' : ''}`} onClick={onClick} disabled={disabled} title={`${label}${shortcut ? ` (${shortcut})` : ''}`} aria-label={label}>
      <Icon size={15} strokeWidth={1.8} />
    </button>
  )
}

function NumberField({ label, value, onChange, accent, disabled = false }) {
  return (
    <label className="number-field">
      <span style={{ color: accent }}>{label}</span>
      <input type="number" step="0.1" value={Number(value.toFixed?.(2) ?? value)} onChange={event => onChange(Number(event.target.value))} disabled={disabled} />
    </label>
  )
}

function VectorFields({ title, value, onChange, degrees = false, disabled = false }) {
  const display = degrees ? value.map(radToDeg) : value
  const update = (index, next) => {
    const copy = [...display]
    copy[index] = next
    onChange(degrees ? copy.map(degToRad) : copy)
  }
  return (
    <div className="property-group">
      <div className="property-label">{title}</div>
      <div className="vector-row">
        <NumberField label="X" value={display[0]} onChange={value => update(0, value)} accent="#d7675b" disabled={disabled} />
        <NumberField label="Y" value={display[1]} onChange={value => update(1, value)} accent="#76a96c" disabled={disabled} />
        <NumberField label="Z" value={display[2]} onChange={value => update(2, value)} accent="#5d87c7" disabled={disabled} />
      </div>
    </div>
  )
}

function AssetCard({ icon: Icon, title, subtitle, onClick, previewClass = '' }) {
  return (
    <button className="asset-card" onClick={onClick}>
      <span className={`asset-preview ${previewClass}`}><Icon size={28} strokeWidth={1.2} /></span>
      <span className="asset-copy"><strong>{title}</strong><small>{subtitle}</small></span>
      <Plus className="asset-add" size={14} />
    </button>
  )
}

function SceneList({ objects, selectedId, onSelect, onToggleVisible, onToggleLock }) {
  const { t } = useTranslation('nodes')
  return (
    <div className="scene-list">
      <div className={`scene-row ${selectedId === CAMERA_ID ? 'is-selected' : ''}`} onClick={() => onSelect(CAMERA_ID)}>
        <Camera size={14} /><span>{t('previs.studio.mainCamera')}</span><i className="status-dot live" />
      </div>
      {objects.map(object => (
        <div key={object.id} className={`scene-row ${selectedId === object.id ? 'is-selected' : ''}`} onClick={() => onSelect(object.id)}>
          {object.type === 'person' ? <UserRound size={14} /> : object.type === 'model' ? <Sparkles size={14} /> : object.type === 'depthMesh' ? <ScanLine size={14} /> : <Box size={14} />}
          <span>{object.name}</span>
          <button className="scene-row-action" title={object.locked ? t('previs.studio.unlock') : t('previs.studio.lockObject')} onClick={event => { event.stopPropagation(); onToggleLock(object.id) }}>{object.locked ? <Lock size={11} /> : <Unlock size={11} />}</button>
          <button className="scene-row-action visibility-action" title={object.visible === false ? t('previs.studio.showObject') : t('previs.studio.hideObject')} onClick={event => { event.stopPropagation(); onToggleVisible(object.id) }}><i className={`status-dot ${object.visible === false ? '' : 'on'}`} /></button>
        </div>
      ))}
    </div>
  )
}

function LeftSidebar({ objects, selectedId, onSelect, onAddPerson, onAddPrimitive, onImport, onToggleVisible, onToggleLock }) {
  const { t } = useTranslation('nodes')
  const [tab, setTab] = useState('assets')
  const inputRef = useRef(null)
  return (
    <aside className="left-sidebar panel">
      <div className="panel-tabs">
        <button className={tab === 'assets' ? 'is-active' : ''} onClick={() => setTab('assets')}>{t('previs.studio.assets')}</button>
        <button className={tab === 'scene' ? 'is-active' : ''} onClick={() => setTab('scene')}>{t('previs.studio.hierarchy')}</button>
      </div>
      {tab === 'assets' ? (
        <div className="assets-scroll">
          <div className="section-kicker">{t('previs.studio.bodyTypes')}</div>
          {['standard', 'female', 'male', 'tall', 'broad'].map(bodyType => <AssetCard key={bodyType} icon={UserRound} title={t(`previs.studio.bodyCards.${bodyType}.title`)} subtitle={t(`previs.studio.bodyCards.${bodyType}.subtitle`)} onClick={() => onAddPerson(bodyType)} previewClass={`person-preview${bodyType === 'standard' ? '' : ` ${bodyType}`}`} />)}
          <div className="section-kicker section-gap">{t('previs.studio.primitives')}</div>
          <div className="primitive-grid">
            <button onClick={() => onAddPrimitive('box')}><Box size={24} /><span>{t('previs.studio.objectTypes.box')}</span></button>
            <button onClick={() => onAddPrimitive('sphere')}><CircleDot size={24} /><span>{t('previs.studio.objectTypes.sphere')}</span></button>
            <button onClick={() => onAddPrimitive('cylinder')}><CircleDot size={24} /><span>{t('previs.studio.objectTypes.cylinder')}</span></button>
            <button onClick={() => onAddPrimitive('plane')}><Grid3X3 size={24} /><span>{t('previs.studio.objectTypes.plane')}</span></button>
          </div>
          <div className="section-kicker section-gap">{t('previs.studio.blockout')}</div>
          <div className="primitive-grid blockout-grid">
            {['arch', 'stairs', 'door', 'window', 'table', 'chair', 'sofa', 'roof', 'tree', 'vehicle'].map(type => (
              <button key={type} onClick={() => onAddPrimitive(type)}><Box size={20} /><span>{t(`previs.studio.objectTypes.${type}`)}</span></button>
            ))}
          </div>
          <div className="section-kicker section-gap">{t('previs.studio.externalModels')}</div>
          <button className="import-drop" onClick={() => inputRef.current?.click()}>
            <Import size={18} /><strong>{t('previs.studio.importGlb')}</strong><span>{t('previs.studio.importLocalModel')}</span>
          </button>
          <input ref={inputRef} className="visually-hidden" type="file" accept=".glb,.gltf" onChange={onImport} />
        </div>
      ) : (
        <SceneList objects={objects} selectedId={selectedId} onSelect={onSelect} onToggleVisible={onToggleVisible} onToggleLock={onToggleLock} />
      )}
    </aside>
  )
}

function Inspector({ selected, camera, selectedJoint, customPoses, onSelectJoint, onUpdateObject, onUpdateCamera, onDelete, onDuplicate, onFocus, onToggleLock, onSaveCustomPose, onApplyCustomPose, onDeleteCustomPose }) {
  const { t, i18n } = useTranslation('nodes')
  const useEnglishLabels = i18n.resolvedLanguage?.startsWith('en')
  if (!selected) {
    return <aside className="right-sidebar panel empty-inspector"><MousePointer2 size={24} /><span>{t('previs.studio.selectObject')}</span></aside>
  }
  const isCamera = selected.id === CAMERA_ID
  const position = isCamera ? camera.position : selected.position
  const typeLabel = selected.type === 'depthMesh' ? 'DEPTH SPACE' : selected.type?.toUpperCase()
  const rigPose = selected.type === 'person' ? poseForObject(selected) : null
  const jointRotation = rigPose?.joints[selectedJoint] || [0, 0, 0]
  const updateJoint = rotation => onUpdateObject({
    joints: { ...rigPose.joints, [selectedJoint]: rotation },
  })
  const applyPreset = pose => onUpdateObject({
    pose: normalizePoseId(pose),
    poseTime: presetPhase(pose),
    rigRoot: presetRoot(),
    joints: presetJoints(),
  })
  return (
    <aside className="right-sidebar panel">
      <div className="inspector-head">
        <div><small>{isCamera ? 'CAMERA' : typeLabel}</small>{isCamera ? <strong>{t('previs.studio.mainCamera')}</strong> : <input className="inspector-name-input" value={selected.name} onChange={event => onUpdateObject({ name: event.target.value })} aria-label={t('previs.studio.objectName')} />}</div>
        <div className="inspector-head-actions">
          <ToolButton icon={Focus} label={t('previs.studio.focus')} onClick={onFocus} />
          {!isCamera && <ToolButton icon={selected.locked ? Unlock : Lock} label={selected.locked ? t('previs.studio.unlock') : t('previs.studio.lock')} onClick={onToggleLock} />}
          {!isCamera && <ToolButton icon={Copy} label={t('previs.studio.copy')} onClick={onDuplicate} />}
          {!isCamera && <ToolButton icon={Trash2} label={t('previs.studio.delete')} onClick={onDelete} />}
        </div>
      </div>
      <div className="inspector-scroll">
        {!isCamera && selected.locked && <div className="locked-banner"><Lock size={12} /> {t('previs.studio.lockedTransform')}</div>}
        <div className="inspector-section">
          <div className="section-title"><span>{t('previs.studio.transform')}</span><ChevronDown size={14} /></div>
          <VectorFields title={t('previs.studio.position')} value={position} onChange={value => isCamera ? onUpdateCamera({ position: value }) : onUpdateObject({ position: value })} disabled={!isCamera && selected.locked} />
          {!isCamera && <VectorFields title={selected.type === 'person' ? t('previs.studio.personRotation') : t('previs.studio.rotation')} value={selected.rotation} degrees onChange={rotation => onUpdateObject({ rotation })} disabled={selected.locked} />}
          {!isCamera && <VectorFields title={t('previs.studio.scale')} value={selected.scale} onChange={scale => onUpdateObject({ scale })} disabled={selected.locked} />}
          {isCamera && <VectorFields title={t('previs.studio.target')} value={camera.target} onChange={target => onUpdateCamera({ target })} />}
        </div>
        {isCamera ? (
          <div className="inspector-section">
            <div className="section-title"><span>{t('previs.studio.camera')}</span><ChevronDown size={14} /></div>
            <label className="range-field"><span>{t('previs.studio.focalLength')}</span><input type="range" min="18" max="120" value={camera.focalLength} onChange={e => onUpdateCamera({ focalLength: Number(e.target.value) })} /><output>{Math.round(camera.focalLength)} mm</output></label>
            <div className="camera-info"><span>{t('previs.studio.sensor')}</span><strong>{t('previs.studio.fullFrame')}</strong></div>
            <label className="select-field aspect-field"><span>{t('previs.studio.aspectRatio')}</span><select value={camera.aspectRatio || '16:9'} onChange={e => onUpdateCamera({ aspectRatio: e.target.value })}>{ASPECT_RATIOS.map(option => <option key={option.value} value={option.value}>{t(`previs.studio.aspectOptions.${option.labelKey}`)}</option>)}</select></label>
          </div>
        ) : selected.type === 'person' ? (
          <div className="inspector-section">
            <div className="section-title"><span>{t('previs.studio.person')}</span><ChevronDown size={14} /></div>
            <label className="select-field"><span>{t('previs.studio.bodyType')}</span><select value={selected.bodyType} onChange={e => onUpdateObject({ bodyType: e.target.value })}>{['standard', 'female', 'male', 'tall', 'broad'].map(bodyType => <option key={bodyType} value={bodyType}>{t(`previs.studio.bodyOptions.${bodyType}`)}</option>)}</select></label>
            <label className="select-field"><span>{t('previs.studio.posePreset')}</span><select value={normalizePoseId(selected.pose)} onChange={e => applyPreset(e.target.value)}>{RIG_PRESET_OPTIONS.map(([value, label]) => <option key={value} value={value}>{useEnglishLabels ? POSE_ENGLISH_LABELS[value] || value : label}</option>)}</select></label>
            <label className="range-field pose-time-field"><span>{t('previs.studio.posePhase')}</span><input type="range" min="0" max="1" step="0.01" value={Number.isFinite(selected.poseTime) ? selected.poseTime : presetPhase(selected.pose)} onChange={e => onUpdateObject({ poseTime: Number(e.target.value) })} /><output>{Math.round((Number.isFinite(selected.poseTime) ? selected.poseTime : presetPhase(selected.pose)) * 100)}%</output></label>
            <p className="pose-source-note">{t('previs.studio.poseSource')}</p>
            <div className="pose-library">
              <div className="pose-library-head"><span>{t('previs.studio.poseLibrary')}</span><small>{t('previs.studio.presetCount', { count: RIG_PRESET_OPTIONS.length })}</small></div>
              {RIG_PRESET_GROUPS.map(group => (
                <div className="pose-group" key={group.label}>
                  <div className="pose-group-label">{useEnglishLabels ? POSE_GROUP_ENGLISH_LABELS[group.label] || group.label : group.label}</div>
                  <div className="pose-grid">
                    {group.poses.map(([value, label]) => (
                      <button key={value} type="button" data-pose={value} className={selected.pose === value ? 'is-active' : ''} onClick={() => applyPreset(value)} title={`${useEnglishLabels ? POSE_GROUP_ENGLISH_LABELS[group.label] || group.label : group.label} · ${useEnglishLabels ? POSE_ENGLISH_LABELS[value] || value : label}`}>
                        <span className="pose-figure"><i /><i /><i /></span>
                        <strong>{useEnglishLabels ? POSE_ENGLISH_LABELS[value] || value : label}</strong>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="joint-editor">
              <div className="joint-editor-head"><span>{t('previs.studio.fullRig')}</span><small>{t('previs.studio.rotatableBones', { count: JOINT_DEFINITIONS.length })}</small></div>
              <label className="select-field"><span>{t('previs.studio.currentJoint')}</span><select value={selectedJoint} onChange={event => onSelectJoint(event.target.value)}>{JOINT_GROUPS.map(group => <optgroup key={group.label} label={useEnglishLabels ? JOINT_GROUP_ENGLISH_LABELS[group.label] || group.label : group.label}>{group.joints.map(joint => <option key={joint.id} value={joint.id}>{useEnglishLabels ? englishBoneLabel(joint.id) : joint.label}</option>)}</optgroup>)}</select></label>
              <VectorFields title={t('previs.studio.jointRotation')} value={jointRotation} degrees onChange={updateJoint} />
              <button type="button" className="joint-reset-button" onClick={() => updateJoint([0, 0, 0])}>{t('previs.studio.resetJoint')}</button>
              <button type="button" className="joint-reset-button" onClick={() => onUpdateObject({ joints: presetJoints() })}>{t('previs.studio.resetRig')}</button>
              <p className="joint-editor-hint">{t('previs.studio.jointHint')}</p>
              <label className="foot-lock-control">
                <input type="checkbox" checked={Boolean(selected.footLock)} onChange={event => onUpdateObject({ footLock: event.target.checked })} />
                <span><strong>{t('previs.studio.footLock')}</strong><small>{t('previs.studio.footLockHelp')}</small></span>
              </label>
            </div>
            <div className="custom-pose-library">
              <div className="joint-editor-head"><span>{t('previs.studio.customPoses')}</span><small>{t('previs.studio.savedCount', { count: customPoses.length })}</small></div>
              <button type="button" className="save-custom-pose" onClick={() => onSaveCustomPose(selected)}><Save size={12} /> {t('previs.studio.savePose')}</button>
              {customPoses.length ? (
                <div className="custom-pose-list">
                  {customPoses.map(customPose => (
                    <div className="custom-pose-row" key={customPose.id}>
                      <button type="button" onClick={() => onApplyCustomPose(customPose)} title={t('previs.studio.applyPose', { name: customPose.name })}>{customPose.name}</button>
                      <button type="button" className="custom-pose-delete" onClick={() => onDeleteCustomPose(customPose.id)} title={t('previs.studio.deletePose', { name: customPose.name })} aria-label={t('previs.studio.deletePose', { name: customPose.name })}><Trash2 size={11} /></button>
                    </div>
                  ))}
                </div>
              ) : <p className="custom-pose-empty">{t('previs.studio.noCustomPoses')}</p>}
            </div>
            <label className="color-field person-color-field"><span>{t('previs.studio.personColor')}</span><input type="color" value={selected.color || '#e8e3d8'} onChange={e => onUpdateObject({ color: e.target.value })} /><output>{selected.color || '#e8e3d8'}</output></label>
          </div>
        ) : (
          <div className="inspector-section">
            <div className="section-title"><span>{t('previs.studio.appearance')}</span><ChevronDown size={14} /></div>
            <label className="color-field"><span>{t('previs.studio.material')}</span><input type="color" value={selected.color || '#d8d3c8'} onChange={e => onUpdateObject({ color: e.target.value })} /><output>{selected.color || '#d8d3c8'}</output></label>
          </div>
        )}
      </div>
    </aside>
  )
}

function Timeline({ currentFrame, onSeek, playing, onTogglePlay, keyframes, onAddKeyframe, onDeleteKeyframe, objectTrack, onAddObjectKeyframe, onDeleteObjectKeyframe, selectedKeyframe, onSelectKeyframe, onMoveKeyframe, onCopyKeyframe, onPasteKeyframe, onDeleteSelectedKeyframe, onChangeInterpolation, hasClipboard }) {
  const { t } = useTranslation('nodes')
  const [dragging, setDragging] = useState(null)
  const scrub = useCallback((event, rect) => {
    onSeek(Math.round(clamp((event.clientX - rect.left) / rect.width, 0, 1) * TOTAL_FRAMES))
  }, [onSeek])
  const onPointerDown = event => {
    const rect = event.currentTarget.getBoundingClientRect()
    scrub(event, rect)
    const move = moveEvent => scrub(moveEvent, rect)
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const beginKeyDrag = (event, key, kind, trackId) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const rect = event.currentTarget.parentElement.getBoundingClientRect()
    let toFrame = key.frame
    onSeek(key.frame)
    onSelectKeyframe({ kind, frame: key.frame, trackId })
    setDragging({ kind, trackId, fromFrame: key.frame, toFrame })
    const move = moveEvent => {
      toFrame = Math.round(clamp((moveEvent.clientX - rect.left) / rect.width, 0, 1) * TOTAL_FRAMES)
      setDragging({ kind, trackId, fromFrame: key.frame, toFrame })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setDragging(null)
      if (toFrame !== key.frame) onMoveKeyframe({ kind, trackId, fromFrame: key.frame, toFrame })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const renderTrack = (frames, kind, onDelete, trackId = null) => (
    <div className={`track ${kind}-track`} onPointerDown={onPointerDown}>
      <div className="track-fill" style={{ width: `${currentFrame / TOTAL_FRAMES * 100}%` }} />
      {!frames.length && <span className="empty-track-note">{t('previs.studio.timeline.noKeys')}</span>}
      {frames.map(key => {
        const isDragged = dragging?.kind === kind && dragging?.trackId === trackId && dragging?.fromFrame === key.frame
        const displayFrame = isDragged ? dragging.toFrame : key.frame
        const isSelected = selectedKeyframe?.kind === kind && selectedKeyframe?.trackId === trackId && selectedKeyframe?.frame === key.frame
        const interpolation = normalizeInterpolation(key.interpolation)
        return <button key={key.frame} className={`keyframe ${kind} ${key.frame === currentFrame ? 'is-current' : ''} ${isSelected ? 'is-selected' : ''}`} data-interpolation={interpolation} style={{ left: `${displayFrame / TOTAL_FRAMES * 100}%` }} title={t('previs.studio.timeline.keyTitle', { frame: key.frame, interpolation: t(`previs.studio.timeline.${interpolation}`) })} onPointerDown={event => beginKeyDrag(event, key, kind, trackId)} onDoubleClick={event => { event.stopPropagation(); onDelete(key.frame); onSelectKeyframe(null) }} />
      })}
      <div className="playhead" style={{ left: `${currentFrame / TOTAL_FRAMES * 100}%` }}><i /></div>
    </div>
  )
  return (
    <section className="timeline panel">
      <div className="timeline-controls">
        <ToolButton icon={SkipBack} label={t('previs.studio.timeline.start')} onClick={() => onSeek(0)} />
        <button className={`play-button ${playing ? 'is-playing' : ''}`} onClick={onTogglePlay}>{playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}</button>
        <ToolButton icon={SkipForward} label={t('previs.studio.timeline.end')} onClick={() => onSeek(TOTAL_FRAMES)} />
        <div className="time-readout"><strong>{String(currentFrame).padStart(3, '0')}</strong><span>{t('previs.studio.timeline.frames', { count: TOTAL_FRAMES })}</span></div>
        <div className="timeline-key-editor">
          {selectedKeyframe ? (
            <>
              <span>{selectedKeyframe.kind === 'camera' ? t('previs.studio.timeline.cameraKey') : t('previs.studio.timeline.objectKey')} · {selectedKeyframe.frame}</span>
              <select value={selectedKeyframe.interpolation} onChange={event => onChangeInterpolation(event.target.value)} title={t('previs.studio.timeline.interpolation')}>
                <option value="smooth">{t('previs.studio.timeline.smooth')}</option>
                <option value="linear">{t('previs.studio.timeline.linear')}</option>
                <option value="hold">{t('previs.studio.timeline.hold')}</option>
              </select>
              <div><button onClick={onCopyKeyframe} title={t('previs.studio.timeline.copyKey')}><Copy size={12} /></button><button onClick={onPasteKeyframe} disabled={!hasClipboard} title={t('previs.studio.timeline.pasteKey')}><Plus size={12} /></button><button onClick={onDeleteSelectedKeyframe} title={t('previs.studio.timeline.deleteKey')}><Trash2 size={12} /></button></div>
            </>
          ) : <span className="timeline-key-empty">{t('previs.studio.timeline.editHint')}</span>}
        </div>
      </div>
      <div className="timeline-body">
        <div className="ruler timeline-ruler">{[0, 24, 48, 72, 96, 120].map(frame => <span key={frame} style={{ left: `${frame / TOTAL_FRAMES * 100}%` }}>{frame}</span>)}</div>
        <div className="track-label camera-track-label"><Camera size={13} /><span>{t('previs.studio.mainCamera')}</span></div>
        <div className="camera-track-slot">{renderTrack(keyframes, 'camera', onDeleteKeyframe)}</div>
        <button className="keyframe-button camera-keyframe-button" onClick={onAddKeyframe}><Plus size={13} /> {t('previs.studio.timeline.cameraTrack')}</button>
        {objectTrack && (
          <>
            <div className="track-label object-track-label">{objectTrack.type === 'person' ? <UserRound size={13} /> : <Box size={13} />}<span>{objectTrack.name}</span></div>
            <div className="object-track-slot">{renderTrack(objectTrack.keyframes, 'object', onDeleteObjectKeyframe, objectTrack.id)}</div>
            <button className="keyframe-button object-keyframe-button" onClick={onAddObjectKeyframe}><Plus size={13} /> {t('previs.studio.timeline.objectTrack')}</button>
          </>
        )}
      </div>
    </section>
  )
}

function MonoformStudio({
  initialProject = null,
  storageKey = PROJECT_STORAGE_KEY,
  projectTitle = '',
  onProjectChange,
  onImportAsset,
  onRequestRun,
  onClose,
}, ref) {
  const { t } = useTranslation('nodes')
  const startupProject = useMemo(() => normalizeProject(initialProject) || readCachedProject(storageKey), [])
  const [objects, setObjects] = useState(() => startupProject?.objects || initialObjects)
  const [selectedId, setSelectedId] = useState(() => startupProject?.objects?.[0]?.id || 'actor-lead')
  const [selectedJoint, setSelectedJoint] = useState('mixamorigSpine2')
  const [transformMode, setTransformMode] = useState('translate')
  const [camera, setCamera] = useState(() => ({ ...initialCamera, ...(startupProject?.camera || {}) }))
  const [keyframes, setKeyframes] = useState(() => startupProject?.keyframes || initialKeyframes)
  const [characterKeyframes, setCharacterKeyframes] = useState(() => startupProject?.objectKeyframes || startupProject?.characterKeyframes || initialCharacterKeyframes)
  const [objectDrafts, setObjectDrafts] = useState({})
  const [currentFrame, setCurrentFrame] = useState(0)
  const [selectedKeyframe, setSelectedKeyframe] = useState(null)
  const [keyframeClipboard, setKeyframeClipboard] = useState(null)
  const [customPoses, setCustomPoses] = useState(() => readCustomPoses())
  const [playing, setPlaying] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [capturingImage, setCapturingImage] = useState(false)
  const [exportProgress, setExportProgress] = useState(0)
  const [showGrid, setShowGrid] = useState(true)
  const [viewFocusRequest, setViewFocusRequest] = useState(null)
  const [toast, setToast] = useState('')
  const [saveStatus, setSaveStatus] = useState(startupProject ? 'restored' : 'ready')
  const [, setHistoryVersion] = useState(0)
  const loadRef = useRef(null)
  const playStartRef = useRef(null)
  const currentFrameRef = useRef(0)
  const exportCanvasRef = useRef(null)
  const imageCaptureCanvasRef = useRef(null)
  const exportCancellationRef = useRef(0)
  const historyRef = useRef({ past: [], future: [], last: '', timer: null, restoring: false })
  const latestProjectRef = useRef(null)

  const selected = useMemo(() => selectedId === CAMERA_ID ? { id: CAMERA_ID } : objects.find(object => object.id === selectedId), [objects, selectedId])
  const activeObject = useMemo(() => selected?.id && selected.id !== CAMERA_ID ? selected : null, [selected])
  const selectedKeyframeInfo = useMemo(() => {
    if (!selectedKeyframe) return null
    const track = selectedKeyframe.kind === 'camera' ? keyframes : characterKeyframes[selectedKeyframe.trackId]
    const key = track?.find(item => item.frame === selectedKeyframe.frame)
    return key ? { ...selectedKeyframe, interpolation: normalizeInterpolation(key.interpolation) } : null
  }, [characterKeyframes, keyframes, selectedKeyframe])
  const animatedCamera = useMemo(() => keyframes.length ? cameraAtFrame(keyframes, currentFrame, camera.aspectRatio) : camera, [keyframes, currentFrame, camera])
  const isAnimating = playing || exporting
  const hasObjectAnimation = useMemo(() => Object.values(characterKeyframes).some(track => track?.length), [characterKeyframes])
  const animatedObjects = useMemo(() => {
    const framedObjects = hasObjectAnimation ? objectsAtFrame(objects, characterKeyframes, currentFrame) : objects
    return framedObjects.map(object => objectDrafts[object.id] || object)
  }, [hasObjectAnimation, objects, characterKeyframes, currentFrame, objectDrafts])
  const inspectorSelected = useMemo(() => selectedId === CAMERA_ID ? selected : animatedObjects.find(object => object.id === selectedId), [animatedObjects, selected, selectedId])
  const displayCamera = isAnimating ? animatedCamera : camera
  const previewAspect = aspectValue(displayCamera.aspectRatio)
  const previewAspectClass = previewAspect >= 16 / 9 ? 'is-wide' : 'is-tall'
  const exportDimensions = useMemo(() => exportDimensionsForAspect(camera.aspectRatio), [camera.aspectRatio])
  const currentProject = useMemo(() => projectData({
    objects,
    camera,
    keyframes,
    objectKeyframes: characterKeyframes,
  }), [objects, camera, keyframes, characterKeyframes])

  useEffect(() => {
    currentFrameRef.current = currentFrame
  }, [currentFrame])

  useEffect(() => {
    try { localStorage.setItem(CUSTOM_POSE_STORAGE_KEY, JSON.stringify(customPoses)) } catch { /* 姿势库写入失败时不影响工程编辑 */ }
  }, [customPoses])

  useEffect(() => {
    if (selectedKeyframe?.kind === 'object' && selectedKeyframe.trackId !== selectedId) setSelectedKeyframe(null)
  }, [selectedId, selectedKeyframe])

  useEffect(() => {
    latestProjectRef.current = currentProject
    const history = historyRef.current
    if (!history.last) {
      history.last = currentProject
      return
    }
    if (history.restoring) {
      history.restoring = false
      history.last = currentProject
      return
    }
    clearTimeout(history.timer)
    const previous = history.last
    history.timer = setTimeout(() => {
      if (latestProjectRef.current === previous) return
      history.past.push(previous)
      if (history.past.length > 50) history.past.shift()
      history.last = latestProjectRef.current
      history.future = []
      setHistoryVersion(version => version + 1)
    }, 280)
    return () => clearTimeout(history.timer)
  }, [currentProject])

  useEffect(() => {
    setSaveStatus('saving')
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(storageKey, JSON.stringify(currentProject))
        onProjectChange?.(currentProject)
        setSaveStatus('saved')
      } catch {
        setSaveStatus('quota')
      }
    }, 900)
    return () => clearTimeout(timer)
  }, [currentProject, onProjectChange, storageKey])

  const applyProjectSnapshot = useCallback(snapshot => {
    setObjects(snapshot.objects || initialObjects)
    setCamera({ ...initialCamera, ...(snapshot.camera || {}) })
    setKeyframes(normalizeKeyframes(snapshot.keyframes || []))
    setCharacterKeyframes(normalizeObjectTracks(snapshot.objectKeyframes || snapshot.characterKeyframes || {}))
    setObjectDrafts({})
    setSelectedKeyframe(null)
    setPlaying(false)
    setSelectedId(current => current === CAMERA_ID || snapshot.objects?.some(object => object.id === current) ? current : snapshot.objects?.[0]?.id || CAMERA_ID)
  }, [])

  const flushHistory = useCallback(() => {
    const history = historyRef.current
    clearTimeout(history.timer)
    const latest = latestProjectRef.current
    if (history.last && latest && latest !== history.last) {
      history.past.push(history.last)
      if (history.past.length > 50) history.past.shift()
      history.last = latest
      history.future = []
    }
  }, [])

  const undo = useCallback(() => {
    flushHistory()
    const history = historyRef.current
    const previous = history.past.pop()
    if (!previous) return
    history.future.push(history.last)
    history.last = previous
    history.restoring = true
    applyProjectSnapshot(previous)
    setHistoryVersion(version => version + 1)
    setToast(t('previs.studio.messages.undone'))
  }, [applyProjectSnapshot, flushHistory, t])

  const redo = useCallback(() => {
    const history = historyRef.current
    const next = history.future.pop()
    if (!next) return
    history.past.push(history.last)
    history.last = next
    history.restoring = true
    applyProjectSnapshot(next)
    setHistoryVersion(version => version + 1)
    setToast(t('previs.studio.messages.redone'))
  }, [applyProjectSnapshot, t])

  const focusSelected = useCallback(() => {
    if (selectedId === CAMERA_ID) {
      setViewFocusRequest({ position: [...camera.position], height: 0, distance: 4, nonce: Date.now() })
      return
    }
    const object = objects.find(item => item.id === selectedId)
    if (!object) return
    const maxScale = Math.max(...(object.scale || [1, 1, 1]).map(value => Math.abs(value) || 1))
    setViewFocusRequest({
      position: [...object.position],
      height: object.type === 'person' ? 1 : Math.min(maxScale * 0.45, 2),
      distance: clamp(maxScale * 4.5, 2.8, 14),
      nonce: Date.now(),
    })
  }, [camera.position, objects, selectedId])

  const seekToFrame = useCallback(frame => {
    const nextFrame = clamp(Math.round(frame), 0, TOTAL_FRAMES)
    setPlaying(false)
    setObjectDrafts({})
    setCurrentFrame(nextFrame)
    currentFrameRef.current = nextFrame
    if (keyframes.length) setCamera(cameraAtFrame(keyframes, nextFrame, camera.aspectRatio))
  }, [keyframes, camera.aspectRatio])

  const togglePlayback = useCallback(() => {
    setPlaying(wasPlaying => {
      if (wasPlaying) {
        const pausedFrame = currentFrameRef.current
        if (keyframes.length) setCamera(cameraAtFrame(keyframes, pausedFrame, camera.aspectRatio))
      }
      if (!wasPlaying && currentFrameRef.current >= TOTAL_FRAMES) {
        setCurrentFrame(0)
        currentFrameRef.current = 0
        if (keyframes.length) setCamera(cameraAtFrame(keyframes, 0, camera.aspectRatio))
      }
      if (!wasPlaying) setObjectDrafts({})
      return !wasPlaying
    })
  }, [keyframes, camera.aspectRatio])

  useEffect(() => {
    if (!playing) { playStartRef.current = null; return }
    let frameId
    const animate = timestamp => {
      if (playStartRef.current === null) playStartRef.current = timestamp - currentFrame / FPS * 1000
      const frame = Math.floor((timestamp - playStartRef.current) / 1000 * FPS)
      if (frame >= TOTAL_FRAMES) {
        setCurrentFrame(TOTAL_FRAMES)
        currentFrameRef.current = TOTAL_FRAMES
        if (keyframes.length) setCamera(cameraAtFrame(keyframes, TOTAL_FRAMES, camera.aspectRatio))
        setPlaying(false)
        return
      }
      setCurrentFrame(frame)
      currentFrameRef.current = frame
      frameId = requestAnimationFrame(animate)
    }
    frameId = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(frameId)
  }, [playing, keyframes, camera.aspectRatio])

  useEffect(() => {
    const onKeyDown = event => {
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return
      if (event.key.toLowerCase() === 'w') setTransformMode('translate')
      if (event.key.toLowerCase() === 'e') setTransformMode('rotate')
      if (event.key.toLowerCase() === 'r') setTransformMode('scale')
      if (event.key.toLowerCase() === 'f') focusSelected()
      if (event.code === 'Space') { event.preventDefault(); togglePlayback() }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedId !== CAMERA_ID) deleteSelected()
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') { event.preventDefault(); duplicateSelected() }
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'z') { event.preventDefault(); undo() }
      if ((event.ctrlKey || event.metaKey) && (event.key.toLowerCase() === 'y' || (event.shiftKey && event.key.toLowerCase() === 'z'))) { event.preventDefault(); redo() }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectedId, objects, togglePlayback, undo, redo, focusSelected])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(''), 1800)
    return () => clearTimeout(timer)
  }, [toast])

  const addPerson = bodyType => {
    const id = uid()
    const person = { id, name: `人物 · ${objects.filter(item => item.type === 'person').length + 1}`, type: 'person', bodyType, pose: 'idle', poseTime: presetPhase('idle'), joints: presetJoints(), rigRoot: [0, 0, 0], footLock: false, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], color: '#e8e3d8' }
    setObjects(list => [...list, person])
    setSelectedId(id)
  }
  const addPrimitive = type => {
    const id = uid()
    const labels = { box: '方块', sphere: '球体', cylinder: '圆柱', plane: '平面', arch: '拱门', stairs: '楼梯', table: '桌子', chair: '椅子', sofa: '沙发', door: '门', window: '窗', tree: '树木', vehicle: '车辆', roof: '屋顶' }
    const defaultScales = { arch: [1.8, 2.2, 0.45], stairs: [2.2, 1.4, 2.8], door: [1.2, 2.2, 0.25], window: [1.5, 1.3, 0.22], table: [1.7, 1, 1.1], chair: [0.8, 1, 0.8], sofa: [2.2, 1.1, 1], tree: [1.8, 2.6, 1.8], vehicle: [2.8, 1.2, 1.6], roof: [2.8, 1.2, 2.2] }
    const positionY = type === 'plane' ? 0.02 : (type === 'tree' ? 1.3 : 0.5)
    setObjects(list => [...list, { id, name: `${labels[type] || type} · ${list.filter(item => item.type === type).length + 1}`, type, position: [0, positionY, 0], rotation: [0, 0, 0], scale: type === 'plane' ? [2, 1, 2] : (defaultScales[type] || [1, 1, 1]), color: type === 'tree' ? '#9ca68d' : '#c7c2b7' }])
    setSelectedId(id)
  }
  const importModel = async event => {
    const file = event.target.files?.[0]
    if (!file) return
    event.target.value = ''
    try {
      const url = onImportAsset
        ? await onImportAsset(file)
        : await new Promise((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result)
          reader.onerror = () => reject(new Error(t('previs.studio.messages.modelReadFailed')))
          reader.readAsDataURL(file)
        })
      const id = uid()
      setObjects(list => [...list, { id, name: file.name.replace(/\.(glb|gltf)$/i, ''), type: 'model', url, assetName: file.name, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], color: '#ddd8cc' }])
      setSelectedId(id)
      setToast(t('previs.studio.messages.modelAdded'))
    } catch (error) {
      setToast(error?.message || t('previs.studio.messages.modelImportFailed'))
    }
  }
  const updateObjectById = (id, patch) => {
    setObjectDrafts(drafts => {
      const source = drafts[id] || objectAtFrame(objects.find(object => object.id === id), characterKeyframes[id], currentFrame)
      return source ? { ...drafts, [id]: { ...source, ...patch } } : drafts
    })
    setObjects(list => list.map(object => object.id === id ? { ...object, ...patch } : object))
  }
  const updateSelected = patch => updateObjectById(selectedId, patch)
  const saveCustomPose = person => {
    if (!person || person.type !== 'person') return
    const suggestedName = t('previs.studio.messages.defaultPoseName', { index: customPoses.length + 1 })
    const name = window.prompt(t('previs.studio.messages.poseName'), suggestedName)?.trim()
    if (!name) return
    const rig = poseForObject(person)
    setCustomPoses(list => [...list, {
      id: uid(),
      name,
      pose: normalizePoseId(person.pose),
      poseTime: Number.isFinite(person.poseTime) ? person.poseTime : presetPhase(person.pose),
      rigRoot: [...rig.root],
      joints: cloneJointPose(rig.joints),
    }])
    setToast(t('previs.studio.messages.poseSaved', { name }))
  }
  const applyCustomPose = customPose => {
    if (!customPose || !activeObject || activeObject.type !== 'person') return
    updateSelected({
      pose: normalizePoseId(customPose.pose),
      poseTime: Number.isFinite(customPose.poseTime) ? customPose.poseTime : presetPhase(customPose.pose),
      rigRoot: [...(customPose.rigRoot || presetRoot())],
      joints: cloneJointPose(customPose.joints),
    })
    setToast(t('previs.studio.messages.poseApplied', { name: customPose.name }))
  }
  const deleteCustomPose = poseId => {
    const pose = customPoses.find(item => item.id === poseId)
    if (!pose || !window.confirm(t('previs.studio.messages.poseDeleteConfirm', { name: pose.name }))) return
    setCustomPoses(list => list.filter(item => item.id !== poseId))
    setToast(t('previs.studio.messages.poseDeleted', { name: pose.name }))
  }
  const deleteSelected = () => {
    if (selectedId === CAMERA_ID) return
    const source = objects.find(object => object.id === selectedId)
    if (source?.locked) { setToast(t('previs.studio.messages.objectLocked')); return }
    setObjects(list => list.filter(object => object.id !== selectedId))
    setCharacterKeyframes(tracks => {
      const next = { ...tracks }
      delete next[selectedId]
      return next
    })
    setObjectDrafts(drafts => {
      const next = { ...drafts }
      delete next[selectedId]
      return next
    })
    setSelectedId(CAMERA_ID)
  }
  const duplicateSelected = () => {
    const source = objects.find(object => object.id === selectedId)
    if (!source) return
    const id = uid()
    const duplicate = { ...source, id, name: `${source.name} ${t('previs.studio.messages.copySuffix')}`, position: [source.position[0] + 0.6, source.position[1], source.position[2] + 0.6] }
    setObjects(list => [...list, duplicate])
    setCharacterKeyframes(tracks => {
      const sourceTrack = tracks[source.id]
      if (!sourceTrack?.length) return tracks
      return {
        ...tracks,
        [id]: sourceTrack.map(key => ({ ...key, position: [key.position[0] + 0.6, key.position[1], key.position[2] + 0.6] })),
      }
    })
    setSelectedId(id)
  }
  const addKeyframe = () => {
    const existing = keyframes.find(key => key.frame === currentFrame)
    const next = { frame: currentFrame, interpolation: normalizeInterpolation(existing?.interpolation), position: [...camera.position], target: [...camera.target], focalLength: camera.focalLength }
    setKeyframes(list => [...list.filter(key => key.frame !== currentFrame), next].sort((a, b) => a.frame - b.frame))
    setSelectedKeyframe({ kind: 'camera', frame: currentFrame, trackId: null })
    setToast(t('previs.studio.messages.cameraRecorded', { frame: currentFrame }))
  }
  const deleteKeyframe = frame => {
    setKeyframes(list => list.filter(key => key.frame !== frame))
    if (selectedKeyframe?.kind === 'camera' && selectedKeyframe.frame === frame) setSelectedKeyframe(null)
  }
  const addObjectKeyframe = () => {
    if (!activeObject) return
    const source = objectDrafts[activeObject.id] || activeObject
    const existing = characterKeyframes[activeObject.id]?.find(key => key.frame === currentFrame)
    const next = { ...objectKeyframeFromObject(source, currentFrame), interpolation: normalizeInterpolation(existing?.interpolation) }
    setCharacterKeyframes(tracks => ({
      ...tracks,
      [activeObject.id]: [...(tracks[activeObject.id] || []).filter(key => key.frame !== currentFrame), next].sort((a, b) => a.frame - b.frame),
    }))
    setSelectedKeyframe({ kind: 'object', frame: currentFrame, trackId: activeObject.id })
    setObjectDrafts(drafts => {
      const nextDrafts = { ...drafts }
      delete nextDrafts[activeObject.id]
      return nextDrafts
    })
    setToast(t('previs.studio.messages.objectRecorded', { name: activeObject.name, frame: currentFrame }))
  }
  const deleteObjectKeyframe = frame => {
    if (!activeObject) return
    setCharacterKeyframes(tracks => {
      const current = tracks[activeObject.id] || []
      const remaining = current.filter(key => key.frame !== frame)
      if (remaining.length) return { ...tracks, [activeObject.id]: remaining }
      const next = { ...tracks }
      delete next[activeObject.id]
      return next
    })
    if (selectedKeyframe?.kind === 'object' && selectedKeyframe.trackId === activeObject.id && selectedKeyframe.frame === frame) setSelectedKeyframe(null)
  }
  const moveKeyframe = ({ kind, trackId, fromFrame, toFrame }) => {
    const move = list => {
      const source = list.find(key => key.frame === fromFrame)
      if (!source) return list
      return [...list.filter(key => key.frame !== fromFrame && key.frame !== toFrame), { ...source, frame: toFrame }].sort((a, b) => a.frame - b.frame)
    }
    if (kind === 'camera') setKeyframes(move)
    else setCharacterKeyframes(tracks => ({ ...tracks, [trackId]: move(tracks[trackId] || []) }))
    setSelectedKeyframe({ kind, trackId, frame: toFrame })
    seekToFrame(toFrame)
    setToast(t('previs.studio.messages.keyMoved', { frame: toFrame }))
  }
  const changeSelectedInterpolation = interpolation => {
    if (!selectedKeyframeInfo) return
    const update = list => list.map(key => key.frame === selectedKeyframeInfo.frame ? { ...key, interpolation: normalizeInterpolation(interpolation) } : key)
    if (selectedKeyframeInfo.kind === 'camera') setKeyframes(update)
    else setCharacterKeyframes(tracks => ({ ...tracks, [selectedKeyframeInfo.trackId]: update(tracks[selectedKeyframeInfo.trackId] || []) }))
  }
  const copySelectedKeyframe = () => {
    if (!selectedKeyframeInfo) return
    const track = selectedKeyframeInfo.kind === 'camera' ? keyframes : characterKeyframes[selectedKeyframeInfo.trackId]
    const key = track?.find(item => item.frame === selectedKeyframeInfo.frame)
    if (!key) return
    setKeyframeClipboard({ kind: selectedKeyframeInfo.kind, key: JSON.parse(JSON.stringify(key)) })
    setToast(t('previs.studio.messages.keyCopied'))
  }
  const pasteKeyframe = () => {
    if (!keyframeClipboard) return
    const next = { ...JSON.parse(JSON.stringify(keyframeClipboard.key)), frame: currentFrame }
    if (keyframeClipboard.kind === 'camera') {
      setKeyframes(list => [...list.filter(key => key.frame !== currentFrame), next].sort((a, b) => a.frame - b.frame))
      setSelectedKeyframe({ kind: 'camera', frame: currentFrame, trackId: null })
    } else {
      if (!activeObject) { setToast(t('previs.studio.messages.selectPasteObject')); return }
      setCharacterKeyframes(tracks => ({ ...tracks, [activeObject.id]: [...(tracks[activeObject.id] || []).filter(key => key.frame !== currentFrame), next].sort((a, b) => a.frame - b.frame) }))
      setSelectedKeyframe({ kind: 'object', frame: currentFrame, trackId: activeObject.id })
    }
    setToast(t('previs.studio.messages.keyPasted', { frame: currentFrame }))
  }
  const deleteSelectedKeyframe = () => {
    if (!selectedKeyframeInfo) return
    if (selectedKeyframeInfo.kind === 'camera') deleteKeyframe(selectedKeyframeInfo.frame)
    else if (activeObject?.id === selectedKeyframeInfo.trackId) deleteObjectKeyframe(selectedKeyframeInfo.frame)
  }
  const saveProject = ({ download = false } = {}) => {
    const data = projectData({ objects, camera, keyframes, objectKeyframes: characterKeyframes })
    const serialized = JSON.stringify(data)
    let cached = true
    try {
      localStorage.setItem(storageKey, serialized)
      onProjectChange?.(data)
    } catch { cached = false }
    if (download) {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = 'monoform-project.json'
      link.click()
      URL.revokeObjectURL(link.href)
    }
    if (download) setToast(cached ? t('previs.studio.messages.projectJsonExported') : t('previs.studio.messages.projectExportQuota'))
    else setToast(cached ? t('previs.studio.messages.projectSaved') : t('previs.studio.messages.projectSaveQuota'))
  }
  const handleCaptureImage = async ({ download = true } = {}) => {
    if (exporting || capturingImage) return
    const exportToken = ++exportCancellationRef.current
    const assertExportActive = () => {
      if (exportCancellationRef.current === exportToken) return
      const error = new Error(t('previs.stopped'))
      error.code = 'PREVIS_EXPORT_CANCELLED'
      throw error
    }
    setPlaying(false)
    setCapturingImage(true)
    imageCaptureCanvasRef.current = null
    try {
      const { width, height } = exportDimensions
      let canvas = null
      for (let attempt = 0; attempt < 90; attempt += 1) {
        await nextPaint()
        assertExportActive()
        canvas = imageCaptureCanvasRef.current
        if (canvas?.width === width && canvas?.height === height) break
      }
      if (!canvas || canvas.width !== width || canvas.height !== height) throw new Error(t('previs.studio.messages.captureInitFailed'))
      await nextPaint()
      assertExportActive()
      const blob = await new Promise((resolve, reject) => canvas.toBlob(result => result ? resolve(result) : reject(new Error(t('previs.studio.messages.pngFailed'))), 'image/png'))
      assertExportActive()
      if (download) {
        const link = document.createElement('a')
        const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
        link.href = URL.createObjectURL(blob)
        link.download = `monoform-shot-${stamp}-frame-${String(currentFrameRef.current).padStart(3, '0')}.png`
        document.body.appendChild(link)
        link.click()
        link.remove()
        URL.revokeObjectURL(link.href)
      }
      setToast(t('previs.studio.messages.captureDone', { width, height }))
      return { blob, width, height, frame: currentFrameRef.current, fps: FPS, aspectRatio: camera.aspectRatio || '16:9' }
    } catch (error) {
      setToast(error?.message || t('previs.studio.messages.captureFailed'))
      throw error
    } finally {
      setCapturingImage(false)
      imageCaptureCanvasRef.current = null
    }
  }
  const handleExportMp4 = async ({ download = true } = {}) => {
    if (exporting || capturingImage) return
    const exportToken = ++exportCancellationRef.current
    const assertExportActive = () => {
      if (exportCancellationRef.current === exportToken) return
      const error = new Error(t('previs.stopped'))
      error.code = 'PREVIS_EXPORT_CANCELLED'
      throw error
    }
    const originalFrame = currentFrameRef.current
    const originalCamera = keyframes.length ? cameraAtFrame(keyframes, originalFrame, camera.aspectRatio) : camera
    let output

    setPlaying(false)
    setObjectDrafts({})
    setCamera(originalCamera)
    setExporting(true)
    setExportProgress(0)
    exportCanvasRef.current = null

    try {
      if (typeof VideoEncoder === 'undefined') throw new Error(t('previs.studio.messages.videoUnsupported'))
      const {
        BufferTarget, CanvasSource, Mp4OutputFormat, Output,
        QUALITY_HIGH, getFirstEncodableVideoCodec,
      } = await import('mediabunny')
      const { width, height } = exportDimensions
      const codec = await getFirstEncodableVideoCodec(['avc'], { width, height, quality: QUALITY_HIGH })
      if (!codec) throw new Error(t('previs.studio.messages.encoderMissing'))

      let canvas = null
      for (let attempt = 0; attempt < 120; attempt += 1) {
        await nextPaint()
        assertExportActive()
        canvas = exportCanvasRef.current
        if (canvas?.width === width && canvas?.height === height) break
      }
      if (!canvas || canvas.width !== width || canvas.height !== height) throw new Error(t('previs.studio.messages.exportInitFailed'))

      output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() })
      const videoSource = new CanvasSource(canvas, {
        codec,
        quality: QUALITY_HIGH,
        keyFrameInterval: 2,
        latencyMode: 'quality',
      })
      output.addVideoTrack(videoSource, { frameRate: FPS })
      await output.start()

      for (let frame = 0; frame < TOTAL_FRAMES; frame += 1) {
        assertExportActive()
        setCurrentFrame(frame)
        currentFrameRef.current = frame
        await nextPaint()
        await videoSource.add(frame / FPS, 1 / FPS, { keyFrame: frame % (FPS * 2) === 0 })
        setExportProgress(Math.round((frame + 1) / TOTAL_FRAMES * 100))
      }

      assertExportActive()
      await output.finalize()
      assertExportActive()
      const buffer = output.target.buffer
      if (!buffer) throw new Error(t('previs.studio.messages.mp4Failed'))
      const blob = new Blob([buffer], { type: 'video/mp4' })
      if (download) {
        const link = document.createElement('a')
        const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
        link.href = URL.createObjectURL(blob)
        link.download = `monoform-animation-${stamp}.mp4`
        document.body.appendChild(link)
        link.click()
        link.remove()
        URL.revokeObjectURL(link.href)
      }
      setToast(t('previs.studio.messages.mp4Done', { width, height }))
      return { blob, width, height, fps: FPS, frameCount: TOTAL_FRAMES, durationSeconds: TOTAL_FRAMES / FPS, aspectRatio: camera.aspectRatio || '16:9', codec: 'h264', hasAudio: false }
    } catch (error) {
      if (output && output.state !== 'finalized') await output.cancel().catch(() => {})
      setToast(error?.message || t('previs.studio.messages.mp4ExportFailed'))
      throw error
    } finally {
      setCurrentFrame(originalFrame)
      currentFrameRef.current = originalFrame
      setCamera(originalCamera)
      setExporting(false)
      setExportProgress(0)
      exportCanvasRef.current = null
    }
  }
  const loadProject = event => {
    const file = event.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result)
        const loadedObjects = (data.objects || initialObjects).map(normalizePerson)
        const loadedTracks = normalizeObjectTracks(data.objectKeyframes || data.characterKeyframes || {})
        setObjects(loadedObjects)
        setCamera({ ...initialCamera, ...(data.camera || {}) })
        setKeyframes(normalizeKeyframes(data.keyframes || initialKeyframes))
        setCharacterKeyframes(Object.keys(loadedTracks).length ? loadedTracks : fallbackCharacterKeyframes(loadedObjects))
        setObjectDrafts({})
        setSelectedKeyframe(null)
        setCurrentFrame(0)
        currentFrameRef.current = 0
        setPlaying(false)
        setSelectedId(CAMERA_ID)
        setToast(t('previs.studio.messages.projectOpened'))
      } catch { setToast(t('previs.studio.messages.projectOpenFailed')) }
    }
    reader.readAsText(file)
    event.target.value = ''
  }
  const resetProject = () => {
    setObjects(initialObjects)
    setCamera(initialCamera)
    setKeyframes(initialKeyframes)
    setCharacterKeyframes(initialCharacterKeyframes)
    setObjectDrafts({})
    setSelectedKeyframe(null)
    setCurrentFrame(0)
    currentFrameRef.current = 0
    setPlaying(false)
    setSelectedId('actor-lead')
  }

  useImperativeHandle(ref, () => ({
    getProject: () => currentProject,
    exportImage: () => handleCaptureImage({ download: false }),
    exportVideo: () => handleExportMp4({ download: false }),
    cancelExport: () => {
      exportCancellationRef.current += 1
      setPlaying(false)
      setToast(t('previs.stopped'))
    },
    saveProject: () => saveProject(),
  }), [currentProject, handleCaptureImage, handleExportMp4])

  return (
    <main className="app-shell" aria-busy={exporting || capturingImage}>
      <header className="topbar">
        <div className="brand-mark">
          <span className="brand-glyph"><img src={BRAND_MARK_URL} alt="" /></span>
          <div><strong>{t('previs.studio.brand')}</strong><small>{t('previs.studio.replica')}</small></div>
        </div>
        <nav className="top-actions">
          <button onClick={resetProject}><Plus size={14} /> {t('previs.studio.newProject')}</button>
          <button onClick={() => loadRef.current?.click()}><FolderOpen size={14} /> {t('previs.studio.openProject')}</button>
          <button onClick={() => saveProject()}><Save size={14} /> {t('previs.studio.saveProject')}</button>
          <input ref={loadRef} className="visually-hidden" type="file" accept=".json" onChange={loadProject} />
          <span className="top-divider" />
          <ToolButton icon={Undo2} label={t('previs.studio.undo')} shortcut="Ctrl+Z" onClick={undo} disabled={!historyRef.current.past.length} />
          <ToolButton icon={Redo2} label={t('previs.studio.redo')} shortcut="Ctrl+Y" onClick={redo} disabled={!historyRef.current.future.length} />
        </nav>
        <div className="project-title"><i className={`status-dot ${saveStatus === 'saving' ? '' : 'live'}`} /><span>{projectTitle || t('previs.unnamedShot')}</span><small>{t(`previs.studio.status.${saveStatus}`)}</small></div>
          <a className="source-credit" href={MONOFORM_SOURCE_URL} target="_blank" rel="noreferrer" title={t('previs.studio.sourceCommit', { commit: MONOFORM_SOURCE_COMMIT })}>
            <Github size={13} /><span>{t('previs.studio.sourceCredit')}</span><Heart size={12} />
          </a>
        <div className="export-actions">
          <button className="project-export-button" onClick={() => saveProject({ download: true })} disabled={exporting || capturingImage}><Download size={14} /> {t('previs.studio.exportProject')}</button>
          <button className="project-export-button capture-image-button" onClick={() => onRequestRun ? onRequestRun('image') : void handleCaptureImage({ download: true })} disabled={exporting || capturingImage}><FileImage size={14} /> {capturingImage ? t('previs.studio.capturing') : t('previs.studio.capturePng')}</button>
          <button className="export-button" onClick={() => onRequestRun ? onRequestRun('video') : void handleExportMp4({ download: true })} disabled={exporting || capturingImage}><FileVideo2 size={14} /> {exporting ? `${exportProgress}%` : t('previs.studio.exportMp4')}</button>
          {onClose && <button className="project-close-button" onClick={onClose} title={t('previs.studio.close')}><X size={16} /></button>}
        </div>
      </header>

      <div className="workspace">
        <LeftSidebar objects={objects} selectedId={selectedId} onSelect={setSelectedId} onAddPerson={addPerson} onAddPrimitive={addPrimitive} onImport={importModel} onToggleVisible={id => updateObjectById(id, { visible: objects.find(item => item.id === id)?.visible === false })} onToggleLock={id => updateObjectById(id, { locked: !objects.find(item => item.id === id)?.locked })} />
        <section className="viewport-shell">
          <div className="viewport-toolbar floating-panel">
            <ToolButton icon={MousePointer2} label={t('previs.studio.tools.select')} active={!['translate', 'rotate', 'scale'].includes(transformMode)} onClick={() => setTransformMode('select')} shortcut="Q" />
            <span />
            <ToolButton icon={Move3D} label={t('previs.studio.tools.move')} active={transformMode === 'translate'} onClick={() => setTransformMode('translate')} shortcut="W" />
            <ToolButton icon={RotateCw} label={t('previs.studio.tools.rotate')} active={transformMode === 'rotate'} onClick={() => setTransformMode('rotate')} shortcut="E" />
            <ToolButton icon={BoxSelect} label={t('previs.studio.tools.scale')} active={transformMode === 'scale'} onClick={() => setTransformMode('scale')} shortcut="R" />
          </div>
          <div className="viewport-mode-help">
            {transformMode === 'select' && t('previs.studio.tools.selectHelp')}
            {transformMode === 'translate' && t('previs.studio.tools.moveHelp')}
            {transformMode === 'rotate' && t('previs.studio.tools.rotateHelp')}
            {transformMode === 'scale' && t('previs.studio.tools.scaleHelp')}
          </div>
          <div className="viewport-view-options floating-panel">
            <button className={showGrid ? 'is-active' : ''} onClick={() => setShowGrid(value => !value)}><Grid3X3 size={14} /> {t('previs.studio.grid')}</button>
            <button><span className="solid-sphere" /> {t('previs.studio.solid')}</button>
          </div>
          <div className="viewport-label"><strong>{t('previs.studio.perspective')}</strong><span>{t('previs.studio.worldCoordinates')}</span></div>
          <MainViewport objects={animatedObjects} selectedId={selectedId} activeJoint={selectedJoint} onSelect={setSelectedId} onJointSelect={(objectId, jointId) => { setSelectedId(objectId); setSelectedJoint(jointId) }} transformMode={transformMode} onUpdateObject={updateObjectById} cameraData={displayCamera} onUpdateCamera={patch => setCamera(current => ({ ...current, ...patch }))} showGrid={showGrid} focusRequest={viewFocusRequest} />
          <div className="navigation-hint"><span><MousePointer2 size={12} /> {t('previs.studio.leftSelect')}</span><span>{t('previs.studio.middleRotate')}</span><span>{t('previs.studio.wheelZoom')}</span></div>
          <div className="camera-monitor">
            <div className="monitor-head"><div><Video size={13} /><strong>{t('previs.studio.cameraNumber')}</strong><span>SHOT PREVIEW</span></div><button onClick={() => setSelectedId(CAMERA_ID)}><ZoomIn size={13} /></button></div>
            <div className="monitor-frame">
              <div className={`monitor-canvas ${previewAspectClass}`} style={{ '--preview-aspect': previewAspect }}>
                <CameraPreview objects={animatedObjects} cameraData={displayCamera} />
                <span className="safe-frame" />
                <span className="owner-watermark" aria-label={t('previs.studio.brandAria')}><i><img src={BRAND_MARK_URL} alt="" /></i><b>MONOFORM</b></span>
                <span className="monitor-timecode">00:00:{String(Math.floor(currentFrame / FPS)).padStart(2, '0')}:{String(currentFrame % FPS).padStart(2, '0')}</span>
                <span className="monitor-focal">{Math.round(displayCamera.focalLength)} mm · {displayCamera.aspectRatio || '16:9'}</span>
              </div>
            </div>
          </div>
        </section>
        <Inspector selected={inspectorSelected} camera={camera} selectedJoint={selectedJoint} customPoses={customPoses} onSelectJoint={setSelectedJoint} onUpdateObject={updateSelected} onUpdateCamera={patch => setCamera(current => ({ ...current, ...patch }))} onDelete={deleteSelected} onDuplicate={duplicateSelected} onFocus={focusSelected} onToggleLock={() => activeObject && updateSelected({ locked: !activeObject.locked })} onSaveCustomPose={saveCustomPose} onApplyCustomPose={applyCustomPose} onDeleteCustomPose={deleteCustomPose} />
        <Timeline
          currentFrame={currentFrame}
          onSeek={seekToFrame}
          playing={playing}
          onTogglePlay={togglePlayback}
          keyframes={keyframes}
          onAddKeyframe={addKeyframe}
          onDeleteKeyframe={deleteKeyframe}
          objectTrack={activeObject ? { id: activeObject.id, name: activeObject.name, type: activeObject.type, keyframes: characterKeyframes[activeObject.id] || [] } : null}
          onAddObjectKeyframe={addObjectKeyframe}
          onDeleteObjectKeyframe={deleteObjectKeyframe}
          selectedKeyframe={selectedKeyframeInfo}
          onSelectKeyframe={setSelectedKeyframe}
          onMoveKeyframe={moveKeyframe}
          onCopyKeyframe={copySelectedKeyframe}
          onPasteKeyframe={pasteKeyframe}
          onDeleteSelectedKeyframe={deleteSelectedKeyframe}
          onChangeInterpolation={changeSelectedInterpolation}
          hasClipboard={Boolean(keyframeClipboard)}
        />
      </div>
      {capturingImage && (
        <div className="export-render-surface" style={{ width: exportDimensions.width, height: exportDimensions.height }} aria-hidden="true">
          <CameraPreview objects={animatedObjects} cameraData={displayCamera} exportMode onCanvasReady={canvas => { imageCaptureCanvasRef.current = canvas }} />
        </div>
      )}
      {exporting && (
        <>
          <div className="export-render-surface" style={{ width: exportDimensions.width, height: exportDimensions.height }} aria-hidden="true">
            <CameraPreview objects={animatedObjects} cameraData={displayCamera} exportMode onCanvasReady={canvas => { exportCanvasRef.current = canvas }} />
          </div>
          <div className="export-progress-overlay" role="status" aria-live="polite">
            <div className="export-progress-card">
              <FileVideo2 size={20} />
              <div className="export-progress-copy"><strong>{t('previs.studio.encoding')}</strong><span>{t('previs.studio.encodingFrame', { width: exportDimensions.width, height: exportDimensions.height, frame: Math.round(exportProgress / 100 * TOTAL_FRAMES), total: TOTAL_FRAMES })}</span></div>
              <output>{exportProgress}%</output>
              <div className="export-progress-track"><i style={{ width: `${exportProgress}%` }} /></div>
            </div>
          </div>
        </>
      )}
      {toast && <div className="toast"><span />{toast}</div>}
    </main>
  )
}

export default forwardRef(MonoformStudio)
