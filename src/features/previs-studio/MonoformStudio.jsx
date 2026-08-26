import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowDownToLine, Axis3D, Box, BoxSelect, Camera, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, CircleDot, Copy, Download,
  FileImage, FileVideo2, Focus, FolderOpen, Grid3X3, Import, Link2, Lock, MousePointer2, Move3D, Pause, Play, Plus,
  Magnet, Maximize2, Minimize2, Minus, Redo2, RotateCcw, RotateCw, Save, Settings2, SkipBack, SkipForward, SlidersHorizontal, Sparkles, Sun,
  Github, Heart, ScanLine, Trash2, Undo2, Unlink2, UserRound, Video, ZoomIn,
  Unlock, X,
} from 'lucide-react'
import { MainViewport, CameraPreview } from './Viewport.jsx'
import { ShotsPanel } from './ShotsPanel.jsx'
import { JOINT_DEFINITIONS, JOINT_GROUPS, RIG_PRESET_GROUPS, RIG_PRESET_OPTIONS, cloneJointPose, interpolateJointPose, normalizePoseId, poseCanLoop, poseForObject, presetJoints, presetPhase, presetRoot } from './rig.js'

const CAMERA_ID = '__shot_camera__'
const PROJECT_STORAGE_KEY = 't8-previs-studio-project'
const LEGACY_PROJECT_STORAGE_KEY = 'stageframe-project'
const CUSTOM_POSE_STORAGE_KEY = 'monoform-custom-poses'
const PROJECT_VERSION = 16
const DEFAULT_PROJECT_SETTINGS = {
  name: '未命名场景',
  fps: 24,
  durationSeconds: 15,
  loopPlayback: false,
}
const DEFAULT_LIGHTING = {
  ambientIntensity: 1.35,
  keyIntensity: 2.8,
  fillIntensity: 1.1,
  keyAzimuth: 39,
  keyElevation: 51,
  exposure: 0.9,
  ambientColor: '#f7f1e6',
  keyColor: '#fff6e8',
  fillColor: '#a9c2c6',
}
const FPS_OPTIONS = [24, 25, 30]
const FOCAL_LENGTH_PRESETS = [18, 24, 35, 50, 85, 120]
const BRAND_MARK_URL = `${import.meta.env.BASE_URL}previs-studio/branding/monoform-mark.png`
export const MONOFORM_SOURCE_URL = 'https://github.com/GuiYi-Xi/monoform-previs-studio'
export const MONOFORM_SOURCE_COMMIT = 'daa54b2f6e78cc69f07102f7d32f6fabe3ac4a54'
const ASPECT_RATIOS = [
  { value: '16:9', label: '16 : 9 · 横屏视频', ratio: 16 / 9 },
  { value: '9:16', label: '9 : 16 · 竖屏短视频', ratio: 9 / 16 },
  { value: '4:3', label: '4 : 3 · 经典画幅', ratio: 4 / 3 },
  { value: '3:4', label: '3 : 4 · 竖版经典画幅', ratio: 3 / 4 },
  { value: '3:2', label: '3 : 2 · 摄影画幅', ratio: 3 / 2 },
  { value: '1:1', label: '1 : 1 · 方形画幅', ratio: 1 },
  { value: '1.85:1', label: '1.85 : 1 · 影院宽屏', ratio: 1.85 },
  { value: '2.39:1', label: '2.39 : 1 · 电影宽银幕', ratio: 2.39 },
  { value: 'custom', label: '自定义画幅' },
]
const COMMON_ASPECT_RATIOS = ['16:9', '9:16', '4:3', '3:4']
const CUSTOM_ASPECT_PATTERN = /^custom:([0-9]+(?:\.[0-9]+)?):([0-9]+(?:\.[0-9]+)?)$/
const cleanAspectPart = value => String(Math.round(clamp(Number(value) || 1, 0.1, 100) * 100) / 100)
const customAspectParts = value => {
  const match = String(value || '').match(CUSTOM_ASPECT_PATTERN)
  return match ? [Number(match[1]), Number(match[2])] : [16, 9]
}
const customAspectValue = (width, height) => `custom:${cleanAspectPart(width)}:${cleanAspectPart(height)}`
const aspectSelectValue = value => CUSTOM_ASPECT_PATTERN.test(String(value || '')) ? 'custom' : value
const aspectValue = value => {
  const custom = String(value || '').match(CUSTOM_ASPECT_PATTERN)
  if (custom) return Number(custom[1]) / Math.max(0.1, Number(custom[2]))
  return ASPECT_RATIOS.find(option => option.value === value)?.ratio || 16 / 9
}
const aspectLabel = (value, isEnglish = false) => {
  if (aspectSelectValue(value) === 'custom') {
    const [width, height] = customAspectParts(value)
    return `${width} : ${height} · ${isEnglish ? 'Custom' : '自定义'}`
  }
  return value || '16:9'
}
const customAspectFrom = value => {
  if (aspectSelectValue(value) === 'custom') return value
  const parts = String(value || '16:9').split(':').map(Number)
  return customAspectValue(parts[0] || 16, parts[1] || 9)
}
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
    poseTime: presetPhase('walk'), continuousMotion: false, position: [-1.25, 0, 0.3], rotation: [0, 0.25, 0], scale: [1, 1, 1], color: '#e8e3d8', joints: presetJoints(),
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

const DEFAULT_CAMERA_POSITION = [7.4, 4.6, 8.2]
const LEGACY_DEFAULT_CAMERA_TARGET = [0.2, 1.2, 0]
const initialCamera = {
  position: [...DEFAULT_CAMERA_POSITION],
  rotation: cameraRotationToward(DEFAULT_CAMERA_POSITION, LEGACY_DEFAULT_CAMERA_TARGET),
  focalLength: 42,
  aspectRatio: '16:9',
}
const DEFAULT_REFERENCE = {
  image: '',
  name: '',
  opacity: 0.45,
  scale: 1,
  x: 0,
  y: 0,
  visible: true,
  includeInExport: false,
}

const initialKeyframes = []
const initialCharacterKeyframes = {}

const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
const radToDeg = value => Math.round((value * 180 / Math.PI) * 10) / 10
const degToRad = value => Number(value || 0) * Math.PI / 180
const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
const lerp = (a, b, t) => a + (b - a) * t
const lerpAngle = (a, b, t) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t
const ease = t => t * t * (3 - 2 * t)
const normalizeInterpolation = value => ['smooth', 'linear', 'hold'].includes(value) ? value : 'smooth'
const segmentAmount = (key, amount) => key?.interpolation === 'hold' ? 0 : key?.interpolation === 'linear' ? amount : ease(amount)
const POSE_LABELS = Object.fromEntries(RIG_PRESET_OPTIONS)
const poseLabel = pose => POSE_LABELS[normalizePoseId(pose)] || '自定义动作'
const POSE_ENGLISH_LABELS = {
  idle: 'Natural standing', stand_relaxed: 'Relaxed standing', idle_shift: 'Weight shift', walk: 'Walk loop', walk_contact_a: 'Walk contact A', walk_pass_a: 'Walk pass A', walk_contact_b: 'Walk contact B', walk_pass_b: 'Walk pass B',
  run: 'Run loop', run_push_a: 'Run push A', run_air_a: 'Run airborne A', run_push_b: 'Run push B', run_air_b: 'Run airborne B', sad_pose: 'Slouched', agree: 'Nod loop', nod_down: 'Nod down', nod_up: 'Nod upright',
  headShake: 'Head-shake loop', shake_left: 'Head left', shake_right: 'Head right', crouch: 'Half squat', squat_full: 'Full squat', sit_prepare: 'Prepare to sit', sit_low: 'Half seated', sit: 'Natural seated', wave: 'Wave loop', tpose: 'T-pose',
}
const POSE_GROUP_ENGLISH_LABELS = { '基础': 'Basic', '日常姿势': 'Daily poses', '持续动作': 'Continuous motion', '行走定格': 'Walk stills', '跑步定格': 'Run stills', '头部定格': 'Head stills' }
const JOINT_GROUP_ENGLISH_LABELS = { '躯干与头部': 'Torso and head', '左臂': 'Left arm', '右臂': 'Right arm', '左腿': 'Left leg', '右腿': 'Right leg', '左手指': 'Left fingers', '右手指': 'Right fingers' }
const englishBoneLabel = id => id.replace(/^mixamorig/, '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ')
const normalizeFrameNumber = value => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0
}

function uniqueSortedKeyframes(keys) {
  const byFrame = new Map()
  keys.forEach(key => byFrame.set(key.frame, key))
  return [...byFrame.values()].sort((a, b) => a.frame - b.frame)
}

function clampKeyframeFrames(keys, maxFrame) {
  return uniqueSortedKeyframes((Array.isArray(keys) ? keys : []).map(key => ({
    ...key,
    frame: clamp(normalizeFrameNumber(key?.frame), 0, maxFrame),
  })))
}

function keyframeMaxFrame(cameraKeys = [], objectTracks = {}) {
  const cameraFrames = Array.isArray(cameraKeys) ? cameraKeys.map(key => normalizeFrameNumber(key?.frame)) : []
  const objectFrames = Object.values(objectTracks || {})
    .flatMap(track => Array.isArray(track) ? track.map(key => normalizeFrameNumber(key?.frame)) : [])
  return Math.max(0, ...cameraFrames, ...objectFrames)
}

function finiteVector3(value, fallback) {
  return Array.isArray(value) && value.length >= 3
    ? value.slice(0, 3).map((item, index) => Number.isFinite(Number(item)) ? Number(item) : fallback[index])
    : [...fallback]
}

function cameraRotationToward(position, target) {
  const eye = finiteVector3(position, DEFAULT_CAMERA_POSITION)
  const point = finiteVector3(target, LEGACY_DEFAULT_CAMERA_TARGET)
  let dx = point[0] - eye[0]
  let dy = point[1] - eye[1]
  let dz = point[2] - eye[2]
  const length = Math.hypot(dx, dy, dz)
  if (length < 1e-8) return [0, 0, 0]
  dx /= length; dy /= length; dz /= length
  return [Math.asin(Math.min(1, Math.max(-1, dy))), Math.atan2(-dx, -dz), 0]
}

function normalizeCamera(camera = {}) {
  const position = finiteVector3(camera.position, initialCamera.position)
  const rotation = Array.isArray(camera.rotation)
    ? finiteVector3(camera.rotation, initialCamera.rotation)
    : cameraRotationToward(position, camera.target || LEGACY_DEFAULT_CAMERA_TARGET)
  return {
    position,
    rotation,
    focalLength: clamp(Number(camera.focalLength) || initialCamera.focalLength, 18, 120),
    aspectRatio: ASPECT_RATIOS.some(option => option.ratio && option.value === camera.aspectRatio) || CUSTOM_ASPECT_PATTERN.test(String(camera.aspectRatio || ''))
      ? camera.aspectRatio
      : initialCamera.aspectRatio,
  }
}

function normalizeCameraKeyframes(keys = [], fallbackCamera = initialCamera) {
  const source = Array.isArray(keys) ? keys.filter(Boolean) : []
  return uniqueSortedKeyframes(source.map(key => {
    const position = finiteVector3(key.position, fallbackCamera.position)
    return {
      frame: normalizeFrameNumber(key.frame),
      interpolation: normalizeInterpolation(key.interpolation),
      position,
      rotation: Array.isArray(key.rotation)
        ? finiteVector3(key.rotation, fallbackCamera.rotation)
        : cameraRotationToward(position, key.target || LEGACY_DEFAULT_CAMERA_TARGET),
      focalLength: clamp(Number(key.focalLength) || fallbackCamera.focalLength, 18, 120),
    }
  }))
}

function normalizeReference(reference = {}) {
  const image = typeof reference.image === 'string' && /^data:image\/(?:png|jpe?g|webp);base64,/i.test(reference.image)
    ? reference.image
    : ''
  return {
    image,
    name: image ? String(reference.name || '参考图').slice(0, 80) : '',
    opacity: clamp(Number(reference.opacity) || DEFAULT_REFERENCE.opacity, 0.1, 1),
    scale: clamp(Number(reference.scale) || DEFAULT_REFERENCE.scale, 0.25, 2),
    x: clamp(Number(reference.x) || 0, -75, 75),
    y: clamp(Number(reference.y) || 0, -75, 75),
    visible: reference.visible !== false,
    includeInExport: reference.includeInExport === true,
  }
}

function normalizeProjectSettings(settings = {}) {
  const fps = FPS_OPTIONS.includes(Number(settings.fps)) ? Number(settings.fps) : DEFAULT_PROJECT_SETTINGS.fps
  const durationSeconds = clamp(Math.round(Number(settings.durationSeconds) || DEFAULT_PROJECT_SETTINGS.durationSeconds), 1, 60)
  return {
    name: String(settings.name || DEFAULT_PROJECT_SETTINGS.name).trim().slice(0, 40) || DEFAULT_PROJECT_SETTINGS.name,
    fps,
    durationSeconds,
    loopPlayback: Boolean(settings.loopPlayback),
  }
}

function normalizeLighting(lighting = {}) {
  const numeric = (value, fallback, minimum, maximum) => {
    const parsed = Number(value)
    return clamp(Number.isFinite(parsed) ? parsed : fallback, minimum, maximum)
  }
  const color = (value, fallback) => /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value) : fallback
  return {
    ambientIntensity: numeric(lighting.ambientIntensity, DEFAULT_LIGHTING.ambientIntensity, 0, 3),
    keyIntensity: numeric(lighting.keyIntensity, DEFAULT_LIGHTING.keyIntensity, 0, 6),
    fillIntensity: numeric(lighting.fillIntensity, DEFAULT_LIGHTING.fillIntensity, 0, 4),
    keyAzimuth: numeric(lighting.keyAzimuth, DEFAULT_LIGHTING.keyAzimuth, -180, 180),
    keyElevation: numeric(lighting.keyElevation, DEFAULT_LIGHTING.keyElevation, 5, 85),
    exposure: numeric(lighting.exposure, DEFAULT_LIGHTING.exposure, 0.25, 1.75),
    ambientColor: color(lighting.ambientColor, DEFAULT_LIGHTING.ambientColor),
    keyColor: color(lighting.keyColor, DEFAULT_LIGHTING.keyColor),
    fillColor: color(lighting.fillColor, DEFAULT_LIGHTING.fillColor),
  }
}

function timecodeAtFrame(frame, fps) {
  const safeFrame = Math.max(0, Math.round(frame))
  const frames = safeFrame % fps
  const totalSeconds = Math.floor(safeFrame / fps)
  const seconds = totalSeconds % 60
  const minutes = Math.floor(totalSeconds / 60) % 60
  const hours = Math.floor(totalSeconds / 3600)
  return [hours, minutes, seconds, frames].map(value => String(value).padStart(2, '0')).join(':')
}

function normalizePerson(object) {
  if (object?.type !== 'person') return object
  const pose = normalizePoseId(object.pose)
  return {
    ...object,
    pose,
    poseTime: Number.isFinite(object.poseTime) ? object.poseTime : presetPhase(pose),
    rigRoot: Array.isArray(object.rigRoot) ? object.rigRoot.slice(0, 3).map(value => Number(value) || 0) : [0, 0, 0],
    joints: cloneJointPose(object.joints),
    footLock: Boolean(object.footLock),
    continuousMotion: poseCanLoop(pose) && Boolean(object.continuousMotion),
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
      rigRoot: Array.isArray(pose.rigRoot) ? pose.rigRoot.slice(0, 3) : presetRoot(pose.pose),
      joints: cloneJointPose(pose.joints),
    }))
  } catch {
    return []
  }
}

function normalizeObjectTracks(tracks = {}) {
  if (!tracks || typeof tracks !== 'object') return {}
  return Object.fromEntries(Object.entries(tracks).map(([id, keys]) => [id, uniqueSortedKeyframes((Array.isArray(keys) ? keys.filter(Boolean) : []).map(key => {
    const pose = normalizePoseId(key.pose)
    return {
      ...key,
      frame: normalizeFrameNumber(key.frame),
      interpolation: normalizeInterpolation(key.interpolation),
      pose,
      poseTime: Number.isFinite(key.poseTime) ? key.poseTime : presetPhase(pose),
      continuousMotion: poseCanLoop(pose) ? (key.continuousMotion === undefined ? undefined : Boolean(key.continuousMotion)) : false,
      rigRoot: Array.isArray(key.rigRoot) ? key.rigRoot.slice(0, 3).map(value => Number(value) || 0) : [0, 0, 0],
      joints: cloneJointPose(key.joints),
    }
  }))]))
}

const cloneProjectValue = value => JSON.parse(JSON.stringify(value))
const defaultShotName = index => `镜头 ${String(index + 1).padStart(2, '0')}`

function uniqueShotName(shots, preferred) {
  const used = new Set(shots.map(shot => String(shot.name || '').trim().toLocaleLowerCase()))
  const base = String(preferred || '镜头').trim().slice(0, 30) || '镜头'
  if (!used.has(base.toLocaleLowerCase())) return base
  for (let copy = 2; copy <= 99; copy += 1) {
    const suffix = ` ${copy}`
    const candidate = `${base.slice(0, 30 - suffix.length)}${suffix}`
    if (!used.has(candidate.toLocaleLowerCase())) return candidate
  }
  return `${base.slice(0, 23)} ${uid().slice(-6)}`
}

function normalizeShot(shot, index, fallback) {
  const objects = (Array.isArray(shot?.objects) ? shot.objects : fallback.objects).map(normalizePerson)
  const camera = normalizeCamera(shot?.camera || fallback.camera)
  let keyframes = normalizeCameraKeyframes(shot?.keyframes ?? fallback.keyframes ?? [], camera)
  let objectKeyframes = normalizeObjectTracks(shot?.objectKeyframes || shot?.characterKeyframes || fallback.objectKeyframes || {})
  const timing = normalizeProjectSettings({
    fps: shot?.fps ?? shot?.settings?.fps ?? fallback.settings.fps,
    durationSeconds: shot?.durationSeconds ?? shot?.settings?.durationSeconds ?? fallback.settings.durationSeconds,
    loopPlayback: shot?.loopPlayback ?? shot?.settings?.loopPlayback ?? fallback.settings.loopPlayback,
  })
  const maxFrame = keyframeMaxFrame(keyframes, objectKeyframes)
  if (maxFrame > timing.fps * timing.durationSeconds) timing.durationSeconds = clamp(Math.ceil(maxFrame / timing.fps), 1, 60)
  const supportedMaxFrame = timing.fps * timing.durationSeconds
  if (maxFrame > supportedMaxFrame) {
    keyframes = clampKeyframeFrames(keyframes, supportedMaxFrame)
    objectKeyframes = Object.fromEntries(Object.entries(objectKeyframes).map(([id, track]) => [id, clampKeyframeFrames(track, supportedMaxFrame)]))
  }
  return {
    id: String(shot?.id || `shot-${uid()}`),
    name: String(shot?.name || defaultShotName(index)).trim().slice(0, 30) || defaultShotName(index),
    thumbnail: typeof shot?.thumbnail === 'string' && shot.thumbnail.startsWith('data:image/') ? shot.thumbnail : '',
    fps: timing.fps,
    durationSeconds: timing.durationSeconds,
    loopPlayback: timing.loopPlayback,
    objects,
    camera,
    lighting: normalizeLighting(shot?.lighting || fallback.lighting),
    reference: normalizeReference(shot?.reference || fallback.reference),
    keyframes,
    objectKeyframes,
  }
}

function normalizeProjectData(data) {
  if (!data) return null
  const firstShot = Array.isArray(data.shots) ? data.shots[0] : null
  const sourceObjects = Array.isArray(data.objects) ? data.objects : firstShot?.objects
  if (!Array.isArray(sourceObjects)) return null
  const migrateLegacyDefaultDuration = Number(data.version || 0) < PROJECT_VERSION
  const legacySettingsDuration = Number(data.settings?.durationSeconds)
  const settings = normalizeProjectSettings({
    ...data.settings,
    durationSeconds: migrateLegacyDefaultDuration && legacySettingsDuration === 5 ? DEFAULT_PROJECT_SETTINGS.durationSeconds : data.settings?.durationSeconds,
  })
  const fallback = {
    settings,
    objects: sourceObjects,
    camera: data.camera || firstShot?.camera || initialCamera,
    lighting: data.lighting || firstShot?.lighting || DEFAULT_LIGHTING,
    reference: data.reference || firstShot?.reference || DEFAULT_REFERENCE,
    keyframes: data.keyframes || [],
    objectKeyframes: data.objectKeyframes || data.characterKeyframes || {},
  }
  const rawShots = Array.isArray(data.shots) && data.shots.length ? data.shots : [{
    id: 'shot-01',
    name: '镜头 01',
    fps: settings.fps,
    durationSeconds: settings.durationSeconds,
    loopPlayback: settings.loopPlayback,
    objects: fallback.objects,
    camera: fallback.camera,
    lighting: fallback.lighting,
    keyframes: fallback.keyframes,
    objectKeyframes: fallback.objectKeyframes,
  }]
  const shots = rawShots.slice(0, 30).map((shot, index) => {
    const legacyShotDuration = Number(shot?.durationSeconds ?? shot?.settings?.durationSeconds)
    const migratedShot = migrateLegacyDefaultDuration && legacyShotDuration === 5
      ? { ...shot, durationSeconds: DEFAULT_PROJECT_SETTINGS.durationSeconds, settings: { ...shot?.settings, durationSeconds: DEFAULT_PROJECT_SETTINGS.durationSeconds } }
      : shot
    return normalizeShot(migratedShot, index, fallback)
  })
  const activeShotId = shots.some(shot => shot.id === data.activeShotId) ? data.activeShotId : shots[0].id
  const activeShot = shots.find(shot => shot.id === activeShotId) || shots[0]
  return {
    ...data,
    version: PROJECT_VERSION,
    settings: { ...settings, fps: activeShot.fps, durationSeconds: activeShot.durationSeconds, loopPlayback: activeShot.loopPlayback },
    activeShotId,
    shots,
    objects: activeShot.objects,
    camera: activeShot.camera,
    lighting: activeShot.lighting,
    reference: activeShot.reference,
    keyframes: activeShot.keyframes,
    objectKeyframes: activeShot.objectKeyframes,
  }
}

function readCachedProject(storageKey = PROJECT_STORAGE_KEY) {
  try {
    const current = localStorage.getItem(storageKey)
    const legacy = current ? null : localStorage.getItem(LEGACY_PROJECT_STORAGE_KEY)
    const serialized = current || legacy
    const data = JSON.parse(serialized || 'null')
    const normalized = normalizeProjectData(data)
    if (!normalized) return null
    if (!current && legacy) localStorage.setItem(storageKey, JSON.stringify(normalized))
    return normalized
  } catch {
    return null
  }
}

function projectData({ settings, objects, camera, lighting, reference, keyframes, objectKeyframes, shots, activeShotId }) {
  const normalizedSettings = normalizeProjectSettings(settings)
  const sourceShots = shots?.length ? shots : [{ id: 'shot-01', name: '镜头 01' }]
  const resolvedActiveShotId = sourceShots.some(shot => shot.id === activeShotId) ? activeShotId : sourceShots[0].id
  const liveShot = {
    ...(sourceShots.find(shot => shot.id === resolvedActiveShotId) || sourceShots[0]),
    id: resolvedActiveShotId,
    fps: normalizedSettings.fps,
    durationSeconds: normalizedSettings.durationSeconds,
    loopPlayback: normalizedSettings.loopPlayback,
    objects,
    camera,
    lighting: normalizeLighting(lighting),
    reference,
    keyframes,
    objectKeyframes,
  }
  const serializedShots = sourceShots.map(shot => shot.id === resolvedActiveShotId ? liveShot : shot)
  return {
    version: PROJECT_VERSION,
    settings: normalizedSettings,
    activeShotId: resolvedActiveShotId,
    shots: serializedShots,
    objects,
    camera,
    lighting: normalizeLighting(lighting),
    reference,
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
    rotation: left.rotation.map((value, index) => lerpAngle(value, right.rotation[index], t)),
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
    continuousMotion: poseCanLoop(object.pose) && Boolean(object.continuousMotion),
    rigRoot: [...rig.root],
    joints: cloneJointPose(rig.joints),
  }
}

function objectAtFrame(object, keyframes = [], frame, fps = DEFAULT_PROJECT_SETTINGS.fps) {
  if (!object) return object
  const sorted = [...keyframes].sort((a, b) => a.frame - b.frame)
  if (!sorted.length) return object
  const motionEnabled = key => poseCanLoop(key.pose || object.pose) && (key.continuousMotion === undefined ? Boolean(object.continuousMotion) : Boolean(key.continuousMotion))
  const sameState = (leftKey, rightKey) => normalizePoseId(leftKey.pose || object.pose) === normalizePoseId(rightKey.pose || object.pose) && motionEnabled(leftKey) === motionEnabled(rightKey)
  const stateStartFrame = key => {
    let index = sorted.indexOf(key)
    while (index > 0 && sameState(sorted[index - 1], sorted[index])) index -= 1
    return sorted[index]?.frame ?? key.frame
  }
  const applyKey = key => ({
    ...object,
    position: [...key.position],
    rotation: [...key.rotation],
    scale: [...key.scale],
    pose: normalizePoseId(key.pose || object.pose),
    poseTime: Number.isFinite(key.poseTime) ? key.poseTime : presetPhase(key.pose || object.pose),
    continuousMotion: motionEnabled(key),
    motionStartTime: stateStartFrame(key) / fps,
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
  const interpolateState = sameState(left, right)
  return {
    ...object,
    position: left.position.map((value, index) => lerp(value, right.position[index], t)),
    rotation: left.rotation.map((value, index) => lerp(value, right.rotation[index], t)),
    scale: left.scale.map((value, index) => lerp(value, right.scale[index], t)),
    pose: normalizePoseId(left.pose || object.pose),
    poseTime: interpolateState ? lerp(leftPoseTime, rightPoseTime, t) : leftPoseTime,
    continuousMotion: motionEnabled(left),
    motionStartTime: stateStartFrame(left) / fps,
    rigRoot: interpolateState ? leftRoot.map((value, index) => lerp(value, rightRoot[index], t)) : [...leftRoot],
    joints: interpolateState ? interpolateJointPose(
      left.joints || poseForObject({ ...object, pose: left.pose || object.pose }).joints,
      right.joints || poseForObject({ ...object, pose: right.pose || object.pose }).joints,
      t,
    ) : cloneJointPose(left.joints || poseForObject({ ...object, pose: left.pose || object.pose }).joints),
  }
}

function objectsAtFrame(objects, objectKeyframes, frame, fps) {
  return objects.map(object => objectAtFrame(object, objectKeyframes[object.id], frame, fps))
}

function rotateVectorXYZ(vector, rotation = [0, 0, 0]) {
  let [x, y, z] = vector
  const [rx, ry, rz] = rotation
  const cosX = Math.cos(rx); const sinX = Math.sin(rx)
  const cosY = Math.cos(ry); const sinY = Math.sin(ry)
  const cosZ = Math.cos(rz); const sinZ = Math.sin(rz)
  ;[y, z] = [y * cosX - z * sinX, y * sinX + z * cosX]
  ;[x, z] = [x * cosY + z * sinY, -x * sinY + z * cosY]
  ;[x, y] = [x * cosZ - y * sinZ, x * sinZ + y * cosZ]
  return [x, y, z]
}

function visualCenterForObject(object) {
  if (!object) return [0, 0, 0]
  const position = object.position || [0, 0, 0]
  if (object.type !== 'person') return [...position]
  const bodyHeight = { tall: 1.12, broad: 1.04, female: 0.98, male: 1.06 }[object.bodyType] || 1
  const root = object.rigRoot || [0, 0, 0]
  const scale = object.scale || [1, 1, 1]
  const localCenter = [root[0] * scale[0], (root[1] + bodyHeight) * scale[1], root[2] * scale[2]]
  const offset = rotateVectorXYZ(localCenter, object.rotation)
  return position.map((value, index) => value + offset[index])
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

function AxisSlider({ label, title, value, onChange, accent, min, max, step, unit = '', disabled = false, locked = false, onToggleLock }) {
  const { i18n } = useTranslation('nodes')
  const isEnglish = i18n.resolvedLanguage?.startsWith('en')
  const numericValue = Number.isFinite(Number(value)) ? Number(value) : 0
  const safeMin = Math.min(min, Math.floor(numericValue / step) * step)
  const safeMax = Math.max(max, Math.ceil(numericValue / step) * step)
  const digits = step < 0.1 ? 2 : step < 1 ? 1 : 0
  return (
    <div className={`axis-slider ${onToggleLock ? 'has-axis-lock' : ''} ${locked ? 'is-axis-locked' : ''}`} style={{ '--axis-color': accent }}>
      <span>{label}</span>
      <input aria-label={`${title} ${label}`} type="range" min={safeMin} max={safeMax} step={step} value={numericValue} onChange={event => onChange(Number(event.target.value))} disabled={disabled || locked} />
      <output>{numericValue.toFixed(digits)}{unit}</output>
      {onToggleLock && <button type="button" className="axis-lock-button" aria-label={isEnglish ? `${locked ? 'Unlock' : 'Lock'} scale axis ${label}` : `${locked ? '解除' : '锁定'}缩放 ${label} 轴`} aria-pressed={locked} title={isEnglish ? `${locked ? 'Unlock' : 'Lock'} ${label}-axis scale` : `${locked ? '解除' : '锁定'} ${label} 轴缩放`} onClick={onToggleLock}>{locked ? <Lock size={10} /> : <Unlock size={10} />}</button>}
    </div>
  )
}

function VectorFields({ title, value, onChange, degrees = false, kind = 'position', disabled = false, proportionalScale = false, scaleAxisLocks = [false, false, false], onToggleProportionalScale, onToggleScaleAxis }) {
  const { i18n } = useTranslation('nodes')
  const isEnglish = i18n.resolvedLanguage?.startsWith('en')
  const display = degrees ? value.map(radToDeg) : value
  const settings = degrees
    ? { min: -180, max: 180, step: 1, unit: '°' }
    : kind === 'scale'
      ? { min: 0.1, max: 5, step: 0.05, unit: '' }
      : { min: -30, max: 30, step: 0.05, unit: '' }
  const update = (index, next) => {
    if (kind === 'scale' && scaleAxisLocks[index]) return
    const copy = [...display]
    if (kind === 'scale' && proportionalScale) {
      const baseline = Math.max(0.0001, Math.abs(display[index]))
      const ratio = next / baseline
      display.forEach((current, axis) => { copy[axis] = scaleAxisLocks[axis] ? current : Math.max(0.05, current * ratio) })
    } else copy[index] = next
    onChange(degrees ? copy.map(degToRad) : copy)
  }
  return (
    <div className="property-group">
      <div className="property-label-row">
        <div className="property-label">{title}</div>
        {kind === 'scale' && <button type="button" className={`proportional-lock ${proportionalScale ? 'is-active' : ''}`} aria-pressed={proportionalScale} onClick={onToggleProportionalScale} disabled={disabled} title={isEnglish ? 'Dragging any unlocked axis scales the other unlocked axes proportionally' : '开启后拖动任意未锁定轴，其他未锁定轴按原比例同步缩放'}>{proportionalScale ? <Link2 size={11} /> : <Unlink2 size={11} />} {isEnglish ? 'Proportional' : '等比'}</button>}
      </div>
      <div className="axis-sliders">
        <AxisSlider label="X" title={title} value={display[0]} onChange={value => update(0, value)} accent="#d7675b" disabled={disabled} locked={kind === 'scale' && Boolean(scaleAxisLocks[0])} onToggleLock={kind === 'scale' ? () => onToggleScaleAxis?.(0) : null} {...settings} />
        <AxisSlider label="Y" title={title} value={display[1]} onChange={value => update(1, value)} accent="#76a96c" disabled={disabled} locked={kind === 'scale' && Boolean(scaleAxisLocks[1])} onToggleLock={kind === 'scale' ? () => onToggleScaleAxis?.(1) : null} {...settings} />
        <AxisSlider label="Z" title={title} value={display[2]} onChange={value => update(2, value)} accent="#5d87c7" disabled={disabled} locked={kind === 'scale' && Boolean(scaleAxisLocks[2])} onToggleLock={kind === 'scale' ? () => onToggleScaleAxis?.(2) : null} {...settings} />
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

function LeftSidebar({ objects, selectedId, onSelect, onAddPerson, onAddPrimitive, onImport, onToggleVisible, onToggleLock, shots, activeShotId, onSelectShot, onAddShot, onDuplicateShot, onDeleteShot, onRenameShot, onCaptureShot }) {
  const { t } = useTranslation('nodes')
  const [tab, setTab] = useState('assets')
  const inputRef = useRef(null)
  return (
    <aside className="left-sidebar panel">
      <div className="panel-tabs">
        <button className={tab === 'assets' ? 'is-active' : ''} onClick={() => setTab('assets')}>{t('previs.studio.assets')}</button>
        <button className={tab === 'scene' ? 'is-active' : ''} onClick={() => setTab('scene')}>{t('previs.studio.hierarchy')}</button>
        <button className={tab === 'shots' ? 'is-active' : ''} onClick={() => setTab('shots')}>{t('previs.studio.shots.title')}</button>
      </div>
      {tab === 'assets' ? (
        <div className="assets-scroll">
          <div className="section-kicker">{t('previs.studio.bodyTypes')}</div>
          {['standard', 'female', 'male', 'tall', 'broad'].map(bodyType => <AssetCard key={bodyType} icon={UserRound} title={t(`previs.studio.bodyCards.${bodyType}.title`)} subtitle={t(`previs.studio.bodyCards.${bodyType}.subtitle`)} onClick={() => onAddPerson(bodyType)} previewClass={`person-preview${bodyType === 'standard' ? '' : ` ${bodyType}`}`} />)}
          <div className="section-kicker section-gap">{t('previs.studio.primitives')}</div>
          <div className="primitive-grid">
            {['box', 'sphere', 'cylinder', 'plane'].map(type => <button key={type} onClick={() => onAddPrimitive(type)}>{type === 'box' ? <Box size={24} /> : type === 'plane' ? <Grid3X3 size={24} /> : <CircleDot size={24} />}<span>{t(`previs.studio.objectTypes.${type}`)}</span></button>)}
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
      ) : tab === 'scene' ? (
        <SceneList objects={objects} selectedId={selectedId} onSelect={onSelect} onToggleVisible={onToggleVisible} onToggleLock={onToggleLock} />
      ) : <ShotsPanel shots={shots} activeShotId={activeShotId} onSelect={onSelectShot} onAdd={onAddShot} onDuplicate={onDuplicateShot} onDelete={onDeleteShot} onRename={onRenameShot} onCapture={onCaptureShot} />}
    </aside>
  )
}

function Inspector({ selected, camera, selectedJoint, customPoses, onSelectJoint, onUpdateObject, onUpdateCamera, onDelete, onDuplicate, onFocus, onToggleLock, onGround, onResetRotation, onResetScale, onSaveCustomPose, onApplyCustomPose, onDeleteCustomPose }) {
  const { t, i18n } = useTranslation('nodes')
  const isEnglish = i18n.resolvedLanguage?.startsWith('en')
  const ui = (zh, en) => isEnglish ? en : zh
  if (!selected) {
    return <aside className="right-sidebar panel empty-inspector"><MousePointer2 size={24} /><span>{t('previs.studio.selectObject')}</span></aside>
  }
  const isCamera = selected.id === CAMERA_ID
  const position = isCamera ? camera.position : selected.position
  const typeLabel = selected.type === 'depthMesh' ? 'DEPTH SPACE' : selected.type?.toUpperCase()
  const rigPose = selected.type === 'person' ? poseForObject(selected) : null
  const canLoopPose = selected.type === 'person' && poseCanLoop(selected.pose)
  const jointRotation = rigPose?.joints[selectedJoint] || [0, 0, 0]
  const updateJoint = rotation => onUpdateObject({
    joints: { ...rigPose.joints, [selectedJoint]: rotation },
  })
  const applyPreset = pose => onUpdateObject({
    pose: normalizePoseId(pose),
    poseTime: presetPhase(pose),
    continuousMotion: poseCanLoop(pose) ? Boolean(selected.continuousMotion) : false,
    rigRoot: presetRoot(pose),
    joints: presetJoints(pose),
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
          {isCamera
            ? <VectorFields title={ui('摄像机旋转 · X 俯仰 / Y 水平 / Z 翻滚', 'Camera rotation · X pitch / Y yaw / Z roll')} value={camera.rotation} degrees onChange={rotation => onUpdateCamera({ rotation })} />
            : <VectorFields title={selected.type === 'person' ? t('previs.studio.personRotation') : t('previs.studio.rotation')} value={selected.rotation} degrees onChange={rotation => onUpdateObject({ rotation })} disabled={selected.locked} />}
          {!isCamera && <VectorFields
            title={t('previs.studio.scale')}
            kind="scale"
            value={selected.scale}
            proportionalScale={Boolean(selected.proportionalScale)}
            scaleAxisLocks={Array.isArray(selected.scaleAxisLocks) ? selected.scaleAxisLocks : [false, false, false]}
            onToggleProportionalScale={() => onUpdateObject({ proportionalScale: !selected.proportionalScale })}
            onToggleScaleAxis={axis => {
              const locks = Array.isArray(selected.scaleAxisLocks) ? [...selected.scaleAxisLocks] : [false, false, false]
              locks[axis] = !locks[axis]
              onUpdateObject({ scaleAxisLocks: locks })
            }}
            onChange={scale => onUpdateObject({ scale })}
            disabled={selected.locked}
          />}
          {!isCamera && <div className="transform-quick-actions">
            <button type="button" onClick={onGround} disabled={selected.locked} title={ui('按当前外形将物体最低点贴到世界地面', 'Place the object on the world ground using its current bounds')}><ArrowDownToLine size={11} /> {ui('落到地面', 'Ground')}</button>
            <button type="button" onClick={onResetRotation} disabled={selected.locked} title={ui('保持位置和缩放，将整体旋转恢复为零', 'Reset rotation while preserving position and scale')}><RotateCcw size={11} /> {ui('旋转归零', 'Reset rotation')}</button>
            <button type="button" onClick={onResetScale} disabled={selected.locked} title={ui('保持位置和旋转，将缩放恢复为 1', 'Reset scale while preserving position and rotation')}><BoxSelect size={11} /> {ui('缩放归一', 'Reset scale')}</button>
          </div>}
        </div>
        {isCamera ? (
          <div className="inspector-section">
            <div className="section-title"><span>{t('previs.studio.camera')}</span><ChevronDown size={14} /></div>
            <label className="range-field"><span>{t('previs.studio.focalLength')}</span><input type="range" min="18" max="120" value={camera.focalLength} onChange={e => onUpdateCamera({ focalLength: Number(e.target.value) })} /><output>{Math.round(camera.focalLength)} mm</output></label>
            <div className="focal-presets" aria-label={ui('常用焦距', 'Common focal lengths')}>
              {FOCAL_LENGTH_PRESETS.map(value => <button type="button" key={value} className={Math.round(camera.focalLength) === value ? 'is-active' : ''} onClick={() => onUpdateCamera({ focalLength: value })}>{value}</button>)}
            </div>
            <div className="camera-info"><span>{t('previs.studio.sensor')}</span><strong>{t('previs.studio.fullFrame')}</strong></div>
            <label className="select-field aspect-field"><span>{t('previs.studio.aspectRatio')}</span><select value={aspectSelectValue(camera.aspectRatio || '16:9')} onChange={event => onUpdateCamera({ aspectRatio: event.target.value === 'custom' ? customAspectFrom(camera.aspectRatio) : event.target.value })}>{ASPECT_RATIOS.map(option => <option key={option.value} value={option.value}>{isEnglish ? option.value === 'custom' ? 'Custom aspect' : option.value : option.label}</option>)}</select></label>
            {aspectSelectValue(camera.aspectRatio) === 'custom' && (() => {
              const [customWidth, customHeight] = customAspectParts(camera.aspectRatio)
              return <div className="custom-aspect-inputs"><span>{ui('自定义', 'Custom')}</span><input aria-label={ui('自定义画幅宽', 'Custom aspect width')} type="number" min="0.1" max="100" step="0.1" value={customWidth} onChange={event => onUpdateCamera({ aspectRatio: customAspectValue(event.target.value, customHeight) })} /><i>:</i><input aria-label={ui('自定义画幅高', 'Custom aspect height')} type="number" min="0.1" max="100" step="0.1" value={customHeight} onChange={event => onUpdateCamera({ aspectRatio: customAspectValue(customWidth, event.target.value) })} /></div>
            })()}
          </div>
        ) : selected.type === 'person' ? (
          <div className="inspector-section">
            <div className="section-title"><span>{t('previs.studio.person')}</span><ChevronDown size={14} /></div>
            <label className="select-field"><span>{t('previs.studio.bodyType')}</span><select value={selected.bodyType} onChange={e => onUpdateObject({ bodyType: e.target.value })}>{['standard', 'female', 'male', 'tall', 'broad'].map(value => <option value={value} key={value}>{t(`previs.studio.bodyOptions.${value}`)}</option>)}</select></label>
            <label className="select-field"><span>{t('previs.studio.posePreset')}</span><select value={normalizePoseId(selected.pose)} onChange={e => applyPreset(e.target.value)}>{RIG_PRESET_OPTIONS.map(([value, label]) => <option key={value} value={value}>{isEnglish ? POSE_ENGLISH_LABELS[value] || value : label}</option>)}</select></label>
            <label className="range-field pose-time-field"><span>{t('previs.studio.posePhase')}</span><input type="range" min="0" max="1" step="0.01" value={Number.isFinite(selected.poseTime) ? selected.poseTime : presetPhase(selected.pose)} onChange={e => onUpdateObject({ poseTime: Number(e.target.value) })} /><output>{Math.round((Number.isFinite(selected.poseTime) ? selected.poseTime : presetPhase(selected.pose)) * 100)}%</output></label>
            <label className={`motion-loop-control ${canLoopPose ? '' : 'is-disabled'}`}>
              <input type="checkbox" checked={canLoopPose && Boolean(selected.continuousMotion)} disabled={!canLoopPose} onChange={event => onUpdateObject({ continuousMotion: event.target.checked })} />
              <span><strong>{ui('随时间轴循环动作', 'Loop motion with timeline')}</strong><small>{canLoopPose ? ui('播放、拖帧和导出时持续循环', 'Loop during playback, scrubbing, and export') : ui('当前预设是固定姿势，不支持循环', 'The current preset is a static pose')}</small></span>
            </label>
            <p className="pose-source-note">{ui('角色状态关键帧会记录动作、相位、循环开关和完整骨骼，并在对应帧切换。动作来源：Three.js X-Bot 与 CC0 日常动作；当前模型没有面部表情。', 'Character-state keyframes store motion, phase, loop state, and the full rig. Motion comes from Three.js X-Bot and CC0 daily-motion sources; this model has no facial expressions.')}</p>
            <div className="pose-library">
              <div className="pose-library-head"><span>{t('previs.studio.poseLibrary')}</span><small>{RIG_PRESET_OPTIONS.length} PRESETS</small></div>
              {RIG_PRESET_GROUPS.map(group => (
                <div className="pose-group" key={group.label}>
                  <div className="pose-group-label">{isEnglish ? POSE_GROUP_ENGLISH_LABELS[group.label] || group.label : group.label}</div>
                  <div className="pose-grid">
                    {group.poses.map(([value, label]) => (
                      <button key={value} type="button" data-pose={value} className={normalizePoseId(selected.pose) === value ? 'is-active' : ''} onClick={() => applyPreset(value)} title={`${isEnglish ? POSE_GROUP_ENGLISH_LABELS[group.label] || group.label : group.label} · ${isEnglish ? POSE_ENGLISH_LABELS[value] || value : label}`}>
                        <span className="pose-figure"><i /><i /><i /></span>
                        <strong>{isEnglish ? POSE_ENGLISH_LABELS[value] || value : label}</strong>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="joint-editor">
              <div className="joint-editor-head"><span>{t('previs.studio.fullRig')}</span><small>{t('previs.studio.rotatableBones', { count: JOINT_DEFINITIONS.length })}</small></div>
              <label className="select-field"><span>{t('previs.studio.currentJoint')}</span><select value={selectedJoint} onChange={event => onSelectJoint(event.target.value)}>{JOINT_GROUPS.map(group => <optgroup key={group.label} label={isEnglish ? JOINT_GROUP_ENGLISH_LABELS[group.label] || group.label : group.label}>{group.joints.map(joint => <option key={joint.id} value={joint.id}>{isEnglish ? englishBoneLabel(joint.id) : joint.label}</option>)}</optgroup>)}</select></label>
              <VectorFields title={t('previs.studio.jointRotation')} value={jointRotation} degrees onChange={updateJoint} />
              <button type="button" className="joint-reset-button" onClick={() => updateJoint([0, 0, 0])}>{t('previs.studio.resetJoint')}</button>
              <button type="button" className="joint-reset-button" onClick={() => onUpdateObject({ joints: presetJoints(selected.pose) })}>{t('previs.studio.resetRig')}</button>
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

function ProjectSettingsDialog({ settings, maxKeyframeFrame = 0, onApply, onClose }) {
  const { i18n } = useTranslation('nodes')
  const ui = (zh, en) => i18n.resolvedLanguage?.startsWith('en') ? en : zh
  const [draft, setDraft] = useState(settings)
  const totalFrames = Number(draft.fps) * Number(draft.durationSeconds)
  const safeMaxKeyframeFrame = normalizeFrameNumber(maxKeyframeFrame)
  const requiredSeconds = Math.max(1, Math.ceil(safeMaxKeyframeFrame / (Number(draft.fps) || DEFAULT_PROJECT_SETTINGS.fps)))
  const hasDurationConflict = Number.isFinite(totalFrames) && totalFrames < safeMaxKeyframeFrame
  const submit = event => {
    event.preventDefault()
    onApply(normalizeProjectSettings(draft))
  }
  return (
    <div className="settings-overlay" role="presentation" onPointerDown={event => { if (event.target === event.currentTarget) onClose() }}>
      <form className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="project-settings-title" onSubmit={submit}>
        <div className="settings-dialog-head">
          <div><Settings2 size={17} /><span><strong id="project-settings-title">{ui('时间轴设置', 'Timeline settings')}</strong><small>{ui('先确定时长，再制作关键帧', 'Set the duration before authoring keyframes')}</small></span></div>
          <button type="button" onClick={onClose} aria-label={ui('关闭时间轴设置', 'Close timeline settings')}>{ui('关闭', 'Close')}</button>
        </div>
        <div className="settings-fields">
          <label><span>{ui('工程名称', 'Project name')}</span><input autoFocus value={draft.name} maxLength="40" onChange={event => setDraft(current => ({ ...current, name: event.target.value }))} /></label>
          <div className="settings-field-row">
            <label><span>{ui('帧率', 'Frame rate')}</span><select value={draft.fps} onChange={event => setDraft(current => ({ ...current, fps: Number(event.target.value) }))}>{FPS_OPTIONS.map(value => <option value={value} key={value}>{value} FPS</option>)}</select></label>
            <label><span>{ui('时间轴总时长', 'Timeline duration')}</span><div className="duration-input"><input type="number" min="1" max="60" step="1" value={draft.durationSeconds} onChange={event => setDraft(current => ({ ...current, durationSeconds: event.target.value }))} /><i>{ui('秒', 'sec')}</i></div></label>
          </div>
          <div className={`settings-summary ${hasDurationConflict ? 'is-warning' : ''}`}>
            <span>{ui('关键帧条范围', 'Keyframe range')}</span>
            <strong>0–{Number.isFinite(totalFrames) ? totalFrames : 0} {ui('帧', 'frames')}</strong>
            <small>{safeMaxKeyframeFrame ? ui(`最后关键帧：第 ${safeMaxKeyframeFrame} 帧 · 当前帧率最短 ${requiredSeconds} 秒`, `Last keyframe: ${safeMaxKeyframeFrame} · minimum ${requiredSeconds} sec at this frame rate`) : ui(`${draft.fps || 0} FPS · 导出 MP4 将严格使用此时长`, `${draft.fps || 0} FPS · MP4 export uses this exact duration`)}</small>
          </div>
          {hasDurationConflict && <p className="settings-warning">{ui(`当前时长放不下已有关键帧，请至少设置为 ${requiredSeconds} 秒，或先删除/移动末尾关键帧。`, `The current duration would truncate keyframes. Use at least ${requiredSeconds} seconds, or delete/move the last keyframe first.`)}</p>}
          <label className="settings-toggle"><input type="checkbox" checked={Boolean(draft.loopPlayback)} onChange={event => setDraft(current => ({ ...current, loopPlayback: event.target.checked }))} /><span><strong>{ui('循环播放', 'Loop playback')}</strong><small>{ui('到达镜头结尾后自动从第 0 帧继续', 'Continue from frame 0 after reaching the end')}</small></span></label>
        </div>
        <div className="settings-dialog-actions"><button type="button" onClick={onClose}>{ui('取消', 'Cancel')}</button><button type="submit">{ui('应用设置', 'Apply settings')}</button></div>
      </form>
    </div>
  )
}

function ViewportAspectPicker({ value, onChange }) {
  const { i18n } = useTranslation('nodes')
  const ui = (zh, en) => i18n.resolvedLanguage?.startsWith('en') ? en : zh
  const selected = aspectSelectValue(value)
  const [customWidth, customHeight] = customAspectParts(value)
  const choose = next => onChange(next === 'custom' ? customAspectFrom(value) : next)
  return (
    <div className="viewport-aspect-picker floating-panel" aria-label={ui('主视图画面比例', 'Main viewport aspect ratio')}>
      <span className="viewport-aspect-label">{ui('画幅', 'Aspect')}</span>
      {COMMON_ASPECT_RATIOS.map(ratio => (
        <button type="button" key={ratio} className={selected === ratio ? 'is-active' : ''} onClick={() => choose(ratio)}>{ratio}</button>
      ))}
      <button type="button" className={selected === 'custom' ? 'is-active' : ''} onClick={() => choose('custom')}>{ui('自定义', 'Custom')}</button>
      {selected === 'custom' && (
        <span className="viewport-custom-aspect">
          <input aria-label={ui('自定义画幅宽', 'Custom aspect width')} type="number" min="0.1" max="100" step="0.1" value={customWidth} onChange={event => onChange(customAspectValue(event.target.value, customHeight))} />
          <i>:</i>
          <input aria-label={ui('自定义画幅高', 'Custom aspect height')} type="number" min="0.1" max="100" step="0.1" value={customHeight} onChange={event => onChange(customAspectValue(customWidth, event.target.value))} />
        </span>
      )}
    </div>
  )
}

function LightingPanel({ lighting, onChange, onClose }) {
  const { i18n } = useTranslation('nodes')
  const ui = (zh, en) => i18n.resolvedLanguage?.startsWith('en') ? en : zh
  const update = patch => onChange(current => normalizeLighting({ ...current, ...patch }))
  const range = (label, key, minimum, maximum, step, suffix = '') => (
    <label className="lighting-range" key={key}>
      <span>{label}</span>
      <input
        type="range"
        aria-label={label}
        min={minimum}
        max={maximum}
        step={step}
        value={lighting[key]}
        onChange={event => update({ [key]: Number(event.target.value) })}
      />
      <output>{Number(lighting[key]).toFixed(step < 1 ? 2 : 0)}{suffix}</output>
    </label>
  )
  const color = (label, key) => (
    <label className="lighting-color" key={key}>
      <span>{label}</span>
      <input type="color" aria-label={label} value={lighting[key]} onChange={event => update({ [key]: event.target.value })} />
      <output>{lighting[key]}</output>
    </label>
  )
  return (
    <div className="lighting-panel floating-panel" role="dialog" aria-label={ui('场景光照调整', 'Scene lighting controls')}>
      <div className="lighting-panel-head">
        <div><Sun size={14} /><span><strong>{ui('场景光照', 'Scene lighting')}</strong><small>{ui('当前镜头 · 导出同步', 'Current shot · included in export')}</small></span></div>
        <button type="button" onClick={onClose} aria-label={ui('收起光照面板', 'Collapse lighting panel')}><ChevronUp size={13} /></button>
      </div>
      <div className="lighting-panel-body">
        {range(ui('环境亮度', 'Ambient intensity'), 'ambientIntensity', 0, 3, 0.05)}
        {range(ui('主光亮度', 'Key intensity'), 'keyIntensity', 0, 6, 0.05)}
        {range(ui('补光亮度', 'Fill intensity'), 'fillIntensity', 0, 4, 0.05)}
        {range(ui('水平方向', 'Key azimuth'), 'keyAzimuth', -180, 180, 1, '°')}
        {range(ui('主光高度', 'Key elevation'), 'keyElevation', 5, 85, 1, '°')}
        {range(ui('画面曝光', 'Exposure'), 'exposure', 0.25, 1.75, 0.01)}
        <div className="lighting-colors">
          {color(ui('环境色', 'Ambient color'), 'ambientColor')}
          {color(ui('主光色', 'Key color'), 'keyColor')}
          {color(ui('补光色', 'Fill color'), 'fillColor')}
        </div>
      </div>
      <div className="lighting-panel-foot"><button type="button" onClick={() => onChange(cloneProjectValue(DEFAULT_LIGHTING))}>{ui('恢复默认光照', 'Restore default lighting')}</button></div>
    </div>
  )
}

function CameraAnglePanel({ camera, onChange, onClose, onLevel }) {
  const { i18n } = useTranslation('nodes')
  const ui = (zh, en) => i18n.resolvedLanguage?.startsWith('en') ? en : zh
  const rotation = Array.isArray(camera.rotation) ? camera.rotation : [0, 0, 0]
  const updateAxis = (axis, degrees) => {
    const next = [...rotation]
    next[axis] = Number(degrees) * Math.PI / 180
    onChange({ rotation: next })
  }
  const range = (label, axis, minimum, maximum) => {
    const degrees = Math.round((rotation[axis] || 0) * 180 / Math.PI)
    return (
      <label className="camera-angle-range" key={label}>
        <span>{label}</span>
        <input type="range" aria-label={`${ui('摄像机', 'Camera ')}${label}`} min={minimum} max={maximum} step="1" value={degrees} onChange={event => updateAxis(axis, event.target.value)} />
        <output>{degrees}°</output>
      </label>
    )
  }
  return (
    <div className="camera-angle-panel floating-panel" role="dialog" aria-label={ui('摄像机角度调整', 'Camera-angle controls')}>
      <div className="camera-angle-head">
        <div><SlidersHorizontal size={14} /><span><strong>{ui('镜头角度', 'Camera angle')}</strong><small>{ui('参考图地面与水平线校正', 'Match the reference ground and horizon')}</small></span></div>
        <button type="button" onClick={onClose} aria-label={ui('收起镜头角度面板', 'Collapse camera-angle panel')}><ChevronUp size={13} /></button>
      </div>
      <div className="camera-angle-body">
        {range(ui('俯仰', 'Pitch'), 0, -89, 89)}
        {range(ui('水平', 'Yaw'), 1, -180, 180)}
        {range(ui('翻滚', 'Roll'), 2, -45, 45)}
      </div>
      <div className="camera-angle-foot">
        <span>{ui('先用“翻滚”校正倾斜，再用俯仰和水平匹配参考图透视。', 'Correct tilt with Roll, then match the reference perspective with Pitch and Yaw.')}</span>
        <button type="button" onClick={onLevel}>{ui('水平归正', 'Level horizon')}</button>
      </div>
    </div>
  )
}

function Timeline({ currentFrame, fps, totalFrames, onOpenSettings, onSeek, playing, onTogglePlay, keyframes, onAddKeyframe, onDeleteKeyframe, objectTrack, onAddObjectKeyframe, onDeleteObjectKeyframe, selectedKeyframe, onSelectKeyframe, onMoveKeyframe, onCopyKeyframe, onPasteKeyframe, onDeleteSelectedKeyframe, onChangeInterpolation, hasClipboard }) {
  const { t, i18n } = useTranslation('nodes')
  const isEnglish = i18n.resolvedLanguage?.startsWith('en')
  const ui = (zh, en) => isEnglish ? en : zh
  const [dragging, setDragging] = useState(null)
  const rulerFrames = useMemo(() => [...new Set(Array.from({ length: 6 }, (_, index) => Math.round(totalFrames * index / 5)))], [totalFrames])
  const scrub = useCallback((event, rect) => {
    onSeek(Math.round(clamp((event.clientX - rect.left) / rect.width, 0, 1) * totalFrames))
  }, [onSeek, totalFrames])
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
      toFrame = Math.round(clamp((moveEvent.clientX - rect.left) / rect.width, 0, 1) * totalFrames)
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
      <div className="track-fill" style={{ width: `${currentFrame / totalFrames * 100}%` }} />
      {!frames.length && <span className="empty-track-note">{t('previs.studio.timeline.noKeys')}</span>}
      {frames.map(key => {
        const isDragged = dragging?.kind === kind && dragging?.trackId === trackId && dragging?.fromFrame === key.frame
        const displayFrame = isDragged ? dragging.toFrame : key.frame
        const isSelected = selectedKeyframe?.kind === kind && selectedKeyframe?.trackId === trackId && selectedKeyframe?.frame === key.frame
        const stateCopy = kind === 'object' && objectTrack?.type === 'person' ? ` · ${isEnglish ? POSE_ENGLISH_LABELS[normalizePoseId(key.pose)] || normalizePoseId(key.pose) : poseLabel(key.pose)}${key.continuousMotion ? ui('（持续）', ' (continuous)') : ''}` : ''
        const title = `${ui('第', 'Frame')} ${key.frame}${stateCopy} · ${t(`previs.studio.timeline.${normalizeInterpolation(key.interpolation)}`)} · ${ui('拖动可移动', 'drag to move')}`
        return <button key={key.frame} className={`keyframe ${kind} ${key.frame === currentFrame ? 'is-current' : ''} ${isSelected ? 'is-selected' : ''}`} data-interpolation={normalizeInterpolation(key.interpolation)} style={{ left: `${displayFrame / totalFrames * 100}%` }} title={title} aria-label={title} onPointerDown={event => beginKeyDrag(event, key, kind, trackId)} onDoubleClick={event => { event.stopPropagation(); onDelete(key.frame); onSelectKeyframe(null) }} />
      })}
      <div className="playhead" style={{ left: `${currentFrame / totalFrames * 100}%` }}><i /></div>
    </div>
  )
  return (
    <section className="timeline panel">
      <div className="timeline-controls">
        <ToolButton icon={SkipBack} label={t('previs.studio.timeline.start')} onClick={() => onSeek(0)} />
        <button className={`play-button ${playing ? 'is-playing' : ''}`} onClick={onTogglePlay}>{playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}</button>
        <ToolButton icon={SkipForward} label={t('previs.studio.timeline.end')} onClick={() => onSeek(totalFrames)} />
        <div className="time-readout"><strong>{String(currentFrame).padStart(3, '0')}</strong><span>/ {totalFrames} {ui('帧', 'frames')} · {fps} FPS</span></div>
        <div className="timeline-key-editor">
          {selectedKeyframe ? (
            <>
              <span>{selectedKeyframe.kind === 'camera' ? t('previs.studio.timeline.cameraKey') : objectTrack?.type === 'person' ? ui('角色状态', 'Character state') : t('previs.studio.timeline.objectKey')} · {selectedKeyframe.frame} {ui('帧', 'frames')}</span>
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
        <div className="ruler timeline-ruler">{rulerFrames.map(frame => <span key={frame} style={{ left: `${frame / totalFrames * 100}%` }}>{frame}</span>)}</div>
        <button type="button" className="timeline-settings-button" onClick={onOpenSettings} title={ui('设置时间轴时长和帧率', 'Set timeline duration and frame rate')}><Settings2 size={12} /> {ui('时间轴设置', 'Timeline settings')}</button>
        <div className="track-label camera-track-label"><Camera size={13} /><span>{t('previs.studio.mainCamera')}</span></div>
        <div className="camera-track-slot">{renderTrack(keyframes, 'camera', onDeleteKeyframe)}</div>
        <button className="keyframe-button camera-keyframe-button" onClick={onAddKeyframe}><Plus size={13} /> {t('previs.studio.timeline.cameraTrack')}</button>
        {objectTrack && (
          <>
            <div className="track-label object-track-label">{objectTrack.type === 'person' ? <UserRound size={13} /> : <Box size={13} />}<span>{objectTrack.name}</span></div>
            <div className="object-track-slot">{renderTrack(objectTrack.keyframes, 'object', onDeleteObjectKeyframe, objectTrack.id)}</div>
            <button className="keyframe-button object-keyframe-button" onClick={onAddObjectKeyframe}><Plus size={13} /> {objectTrack.type === 'person' ? ui('角色状态关键帧', 'Character-state keyframe') : t('previs.studio.timeline.objectTrack')}</button>
          </>
        )}
      </div>
    </section>
  )
}

function referenceImageFromFile(file, ui = (zh => zh)) {
  return new Promise((resolve, reject) => {
    const imageExtension = /\.(png|jpe?g|webp|bmp|gif)$/i.test(file?.name || '')
    if (!file || (!file.type?.startsWith('image/') && !imageExtension)) { reject(new Error(ui('请选择 PNG、JPG、WEBP、BMP 或 GIF 图片', 'Choose a PNG, JPG, WEBP, BMP, or GIF image'))); return }
    if (file.size > 50 * 1024 * 1024) { reject(new Error(ui('参考图不能超过 50 MB', 'The reference image cannot exceed 50 MB'))); return }
    const reader = new FileReader()
    reader.onerror = () => reject(new Error(ui('图片读取失败', 'Image read failed')))
    reader.onload = () => {
      const image = new Image()
      image.onerror = () => reject(new Error(ui('图片格式无法读取', 'The image format could not be decoded')))
      image.onload = () => {
        const longest = Math.max(image.naturalWidth, image.naturalHeight)
        const ratio = Math.min(1, 1600 / Math.max(1, longest))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio))
        canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio))
        const context = canvas.getContext('2d')
        context.fillStyle = '#e8e6df'
        context.fillRect(0, 0, canvas.width, canvas.height)
        context.drawImage(image, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', 0.84))
      }
      image.src = reader.result
    }
    reader.readAsDataURL(file)
  })
}

function referenceCanvasForExport(reference, width, height, ui = (zh => zh)) {
  return new Promise((resolve, reject) => {
    if (!reference?.image || !reference.includeInExport) return resolve(null)
    const image = new Image()
    image.onerror = () => reject(new Error(ui('参考图无法加入导出画面', 'The reference image could not be added to the export frame')))
    image.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d')
      context.fillStyle = '#9b9c98'
      context.fillRect(0, 0, width, height)
      context.imageSmoothingEnabled = true
      context.imageSmoothingQuality = 'high'
      const drawWidth = width * 0.72 * reference.scale
      const drawHeight = drawWidth * image.naturalHeight / Math.max(1, image.naturalWidth)
      const centerX = width * (0.5 + reference.x / 100)
      const centerY = height * (0.5 + reference.y / 100)
      context.globalAlpha = reference.opacity
      context.drawImage(image, centerX - drawWidth / 2, centerY - drawHeight / 2, drawWidth, drawHeight)
      context.globalAlpha = 1
      resolve(canvas)
    }
    image.src = reference.image
  })
}

function ReferenceOverlay({ reference, onChange, onToast, cameraMode = false, cameraAspect = 16 / 9, children }) {
  const { i18n } = useTranslation('nodes')
  const ui = (zh, en) => i18n.resolvedLanguage?.startsWith('en') ? en : zh
  const dragRef = useRef(null)
  const [editing, setEditing] = useState(false)
  const [expanded, setExpanded] = useState(true)
  const update = patch => onChange(current => normalizeReference({ ...current, ...patch }))
  const upload = async event => {
    const input = event.currentTarget
    const file = input.files?.[0]
    if (!file) return
    try {
      const image = await referenceImageFromFile(file, ui)
      onChange(normalizeReference({ ...DEFAULT_REFERENCE, image, name: file.name }))
      setEditing(false)
      setExpanded(true)
      onToast(ui(`参考图“${file.name}”已加入 · 可切换到“摄像机视角”核对导出构图`, `Reference “${file.name}” added · switch to Camera View to verify the export framing`))
    } catch (error) {
      onToast(error.message || ui('参考图上传失败', 'Reference-image upload failed'))
    } finally {
      input.value = ''
    }
  }
  const beginDrag = event => {
    if (!editing) return
    event.preventDefault()
    event.stopPropagation()
    const bounds = event.currentTarget.parentElement.getBoundingClientRect()
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, x: reference.x, y: reference.y, width: bounds.width, height: bounds.height }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }
  const moveDrag = event => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    update({
      x: drag.x + (event.clientX - drag.startX) / Math.max(1, drag.width) * 100,
      y: drag.y + (event.clientY - drag.startY) / Math.max(1, drag.height) * 100,
    })
  }
  const endDrag = event => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    dragRef.current = null
    event.currentTarget.releasePointerCapture?.(event.pointerId)
  }
  const hasImage = Boolean(reference.image)
  const referenceLayer = hasImage && reference.visible ? (
    <div className={`reference-layer ${editing ? 'is-editing' : ''}`} aria-label={ui(`参考图 ${reference.name}`, `Reference image ${reference.name}`)}>
      <img
        src={reference.image}
        alt={reference.name || ui('动作参考图', 'Motion reference')}
        draggable="false"
        style={{ left: `${50 + reference.x}%`, top: `${50 + reference.y}%`, width: `${72 * reference.scale}%`, opacity: reference.opacity }}
        onPointerDown={beginDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      />
    </div>
  ) : null
  return (
    <>
      <div className={`reference-panel floating-panel ${hasImage ? 'has-image' : ''} ${hasImage && !expanded ? 'is-collapsed' : ''}`}>
        {hasImage && !expanded ? (
          <button type="button" className="reference-expand" title={ui('展开参考图工具', 'Expand reference tools')} aria-label={ui('展开参考图工具', 'Expand reference tools')} onClick={() => setExpanded(true)}><FileImage size={13} /><ChevronDown size={11} /></button>
        ) : (
          <>
            <label className="reference-upload reference-upload-label"><input type="file" accept="image/*,.png,.jpg,.jpeg,.webp,.bmp,.gif" onChange={upload} /><FileImage size={13} /> {hasImage ? ui('更换参考图', 'Replace reference') : ui('上传参考图', 'Upload reference')}</label>
            {hasImage && (
              <>
                <button type="button" className={reference.visible ? 'is-active' : ''} onClick={() => update({ visible: !reference.visible })}>{reference.visible ? ui('隐藏', 'Hide') : ui('显示', 'Show')}</button>
                <button type="button" className={editing ? 'is-active' : ''} onClick={() => { setEditing(value => !value); update({ visible: true }) }}><Move3D size={12} /> {editing ? ui('锁定', 'Lock') : ui('移动图', 'Move')}</button>
                <button type="button" title={ui('移除参考图', 'Remove reference')} aria-label={ui('移除参考图', 'Remove reference')} onClick={() => { onChange(cloneProjectValue(DEFAULT_REFERENCE)); setEditing(false); setExpanded(true) }}><Trash2 size={12} /></button>
                <label><span>{ui('透明', 'Opacity')}</span><input aria-label={ui('参考图透明度', 'Reference opacity')} type="range" min="0.1" max="1" step="0.05" value={reference.opacity} onChange={event => update({ opacity: Number(event.target.value) })} /></label>
                <label><span>{ui('大小', 'Size')}</span><input aria-label={ui('参考图大小', 'Reference size')} type="range" min="0.25" max="2" step="0.05" value={reference.scale} onChange={event => update({ scale: Number(event.target.value) })} /></label>
                <label className="reference-export-toggle"><input aria-label={ui('参考图随 PNG 和 MP4 导出', 'Include reference in PNG and MP4 export')} type="checkbox" checked={reference.includeInExport} onChange={event => update({ includeInExport: event.target.checked })} /><span>{ui('进入导出', 'Export')}</span></label>
                <button type="button" onClick={() => update({ x: 0, y: 0, scale: 1 })}>{ui('居中', 'Center')}</button>
                <button type="button" title={ui('收起参考图工具', 'Collapse reference tools')} aria-label={ui('收起参考图工具', 'Collapse reference tools')} onClick={() => { setExpanded(false); setEditing(false) }}><ChevronUp size={12} /></button>
              </>
            )}
          </>
        )}
      </div>
      {cameraMode ? (
        <div className="camera-edit-frame">
          <div className="camera-edit-stage" style={{ aspectRatio: cameraAspect, '--camera-aspect': cameraAspect }}>
            {referenceLayer}
            {children}
          </div>
        </div>
      ) : <>{referenceLayer}{children}</>}
    </>
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
  const { t, i18n } = useTranslation('nodes')
  const isEnglish = i18n.resolvedLanguage?.startsWith('en')
  const ui = useCallback((zh, en) => isEnglish ? en : zh, [isEnglish])
  const freshInitialObjects = useMemo(() => cloneProjectValue(initialObjects).map(object => {
    if (!isEnglish) return object
    const names = { 'actor-lead': 'Character · Lead', 'block-stage': 'Platform', 'block-step': 'Steps' }
    return { ...object, name: names[object.id] || object.name }
  }), [isEnglish])
  const startupProject = useMemo(() => normalizeProjectData(initialProject) || readCachedProject(storageKey), [])
  const [settings, setSettings] = useState(() => {
    const next = normalizeProjectSettings(startupProject?.settings)
    if (!startupProject && isEnglish && next.name === DEFAULT_PROJECT_SETTINGS.name) next.name = 'Untitled scene'
    return next
  })
  const [shots, setShots] = useState(() => startupProject?.shots || [{
    id: 'shot-01', name: isEnglish ? 'Shot 01' : '镜头 01', thumbnail: '', fps: DEFAULT_PROJECT_SETTINGS.fps, durationSeconds: DEFAULT_PROJECT_SETTINGS.durationSeconds, loopPlayback: false,
    objects: freshInitialObjects, camera: cloneProjectValue(initialCamera), lighting: cloneProjectValue(DEFAULT_LIGHTING), reference: cloneProjectValue(DEFAULT_REFERENCE), keyframes: [], objectKeyframes: {},
  }])
  const [activeShotId, setActiveShotId] = useState(() => startupProject?.activeShotId || 'shot-01')
  const [objects, setObjects] = useState(() => startupProject?.objects || freshInitialObjects)
  const [selectedId, setSelectedId] = useState(() => startupProject?.objects?.[0]?.id || 'actor-lead')
  const [selectedJoint, setSelectedJoint] = useState('mixamorigSpine2')
  const [transformMode, setTransformMode] = useState('translate')
  const [transformSpace, setTransformSpace] = useState('world')
  const [snapEnabled, setSnapEnabled] = useState(true)
  const [groundRequest, setGroundRequest] = useState(null)
  const [camera, setCamera] = useState(() => ({ ...initialCamera, ...(startupProject?.camera || {}) }))
  const [lighting, setLighting] = useState(() => normalizeLighting(startupProject?.lighting))
  const [reference, setReference] = useState(() => normalizeReference(startupProject?.reference))
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
  const [exportReferenceBackground, setExportReferenceBackground] = useState(null)
  const [monitorReferenceBackground, setMonitorReferenceBackground] = useState(null)
  const [exportProgress, setExportProgress] = useState(0)
  const [showGrid, setShowGrid] = useState(true)
  const [cameraView, setCameraView] = useState(false)
  const [lightingPanelOpen, setLightingPanelOpen] = useState(false)
  const [cameraAnglePanelOpen, setCameraAnglePanelOpen] = useState(false)
  const [viewOptionsCollapsed, setViewOptionsCollapsed] = useState(false)
  const [monitorMode, setMonitorMode] = useState('normal')
  const [editorView, setEditorView] = useState({ position: [8.5, 6.4, 9.5], target: [0, 1, 0] })
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [viewFocusRequest, setViewFocusRequest] = useState(null)
  const [toast, setToast] = useState('')
  const [saveStatus, setSaveStatus] = useState(startupProject ? 'restored' : 'ready')
  const [, setHistoryVersion] = useState(0)
  const loadRef = useRef(null)
  const playStartRef = useRef(null)
  const currentFrameRef = useRef(0)
  const exportCanvasRef = useRef(null)
  const imageCaptureCanvasRef = useRef(null)
  const monitorCanvasRef = useRef(null)
  const editorViewRef = useRef(editorView)
  const exportLockRef = useRef(false)
  const exportCancellationRef = useRef(0)
  const historyRef = useRef({ past: [], future: [], last: '', timer: null, restoring: false })
  const latestProjectRef = useRef(null)

  const fps = settings.fps
  const totalFrames = fps * settings.durationSeconds

  const selected = useMemo(() => selectedId === CAMERA_ID ? { id: CAMERA_ID } : objects.find(object => object.id === selectedId), [objects, selectedId])
  const activeObject = useMemo(() => selected?.id && selected.id !== CAMERA_ID ? selected : null, [selected])
  const activeShot = useMemo(() => shots.find(shot => shot.id === activeShotId) || shots[0], [activeShotId, shots])
  const displayedShots = useMemo(() => shots.map(shot => shot.id === activeShotId ? {
    ...shot,
    fps: settings.fps,
    durationSeconds: settings.durationSeconds,
    loopPlayback: settings.loopPlayback,
    objects,
    camera,
    lighting,
    reference,
    keyframes,
    objectKeyframes: characterKeyframes,
  } : shot), [activeShotId, camera, characterKeyframes, keyframes, lighting, objects, reference, settings.durationSeconds, settings.fps, settings.loopPlayback, shots])
  const maxKeyframeFrame = useMemo(() => keyframeMaxFrame(keyframes, characterKeyframes), [characterKeyframes, keyframes])
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
    const framedObjects = hasObjectAnimation ? objectsAtFrame(objects, characterKeyframes, currentFrame, fps) : objects
    return framedObjects.map(object => objectDrafts[object.id] || object)
  }, [hasObjectAnimation, objects, characterKeyframes, currentFrame, fps, objectDrafts])
  const inspectorSelected = useMemo(() => selectedId === CAMERA_ID ? selected : animatedObjects.find(object => object.id === selectedId), [animatedObjects, selected, selectedId])
  const displayCamera = isAnimating ? animatedCamera : camera
  const previewAspect = aspectValue(displayCamera.aspectRatio)
  const previewAspectClass = previewAspect >= 16 / 9 ? 'is-wide' : 'is-tall'
  const exportDimensions = useMemo(() => exportDimensionsForAspect(camera.aspectRatio), [camera.aspectRatio])
  const currentProject = useMemo(() => projectData({
    settings,
    objects,
    camera,
    lighting,
    reference,
    keyframes,
    objectKeyframes: characterKeyframes,
    shots,
    activeShotId,
  }), [settings, objects, camera, lighting, reference, keyframes, characterKeyframes, shots, activeShotId])

  useEffect(() => {
    currentFrameRef.current = currentFrame
  }, [currentFrame])

  useEffect(() => {
    let active = true
    if (!reference.image || !reference.includeInExport) {
      setMonitorReferenceBackground(null)
      return () => { active = false }
    }
    referenceCanvasForExport(reference, exportDimensions.width, exportDimensions.height, ui)
      .then(canvas => { if (active) setMonitorReferenceBackground(canvas) })
      .catch(() => { if (active) setMonitorReferenceBackground(null) })
    return () => { active = false }
  }, [exportDimensions.height, exportDimensions.width, reference, ui])

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
    const normalized = normalizeProjectData(snapshot)
    if (!normalized) return
    setSettings(normalized.settings)
    setShots(normalized.shots)
    setActiveShotId(normalized.activeShotId)
    setObjects(normalized.objects)
    setCamera(normalized.camera)
    setLighting(normalized.lighting)
    setReference(normalized.reference)
    setKeyframes(normalized.keyframes)
    setCharacterKeyframes(normalized.objectKeyframes)
    setObjectDrafts({})
    setSelectedKeyframe(null)
    setPlaying(false)
    setCurrentFrame(frame => {
      const nextFrame = clamp(frame, 0, normalized.settings.fps * normalized.settings.durationSeconds)
      currentFrameRef.current = nextFrame
      return nextFrame
    })
    setSelectedId(current => current === CAMERA_ID || normalized.objects.some(object => object.id === current) ? current : normalized.objects[0]?.id || CAMERA_ID)
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
      setViewFocusRequest({ position: [...displayCamera.position], height: 0, distance: 4, nonce: Date.now() })
      return
    }
    const object = animatedObjects.find(item => item.id === selectedId)
    if (!object) return
    const maxScale = Math.max(...(object.scale || [1, 1, 1]).map(value => Math.abs(value) || 1))
    setViewFocusRequest({
      position: visualCenterForObject(object),
      height: 0,
      distance: clamp(maxScale * 4.5, 2.8, 14),
      nonce: Date.now(),
    })
  }, [animatedObjects, displayCamera.position, selectedId])

  const seekToFrame = useCallback(frame => {
    const nextFrame = clamp(Math.round(frame), 0, totalFrames)
    setPlaying(false)
    setObjectDrafts({})
    setCurrentFrame(nextFrame)
    currentFrameRef.current = nextFrame
    if (keyframes.length) setCamera(cameraAtFrame(keyframes, nextFrame, camera.aspectRatio))
  }, [keyframes, camera.aspectRatio, totalFrames])

  const togglePlayback = useCallback(() => {
    setPlaying(wasPlaying => {
      if (wasPlaying) {
        const pausedFrame = currentFrameRef.current
        if (keyframes.length) setCamera(cameraAtFrame(keyframes, pausedFrame, camera.aspectRatio))
      }
      if (!wasPlaying && currentFrameRef.current >= totalFrames) {
        setCurrentFrame(0)
        currentFrameRef.current = 0
        if (keyframes.length) setCamera(cameraAtFrame(keyframes, 0, camera.aspectRatio))
      }
      if (!wasPlaying) setObjectDrafts({})
      return !wasPlaying
    })
  }, [keyframes, camera.aspectRatio, totalFrames])

  useEffect(() => {
    if (!playing) { playStartRef.current = null; return }
    let frameId
    const animate = timestamp => {
      if (playStartRef.current === null) playStartRef.current = timestamp - currentFrameRef.current / fps * 1000
      let frame = Math.floor((timestamp - playStartRef.current) / 1000 * fps)
      if (frame >= totalFrames) {
        if (settings.loopPlayback) {
          frame %= totalFrames
          playStartRef.current = timestamp - frame / fps * 1000
        } else {
          setCurrentFrame(totalFrames)
          currentFrameRef.current = totalFrames
          if (keyframes.length) setCamera(cameraAtFrame(keyframes, totalFrames, camera.aspectRatio))
          setPlaying(false)
          return
        }
      }
      setCurrentFrame(frame)
      currentFrameRef.current = frame
      frameId = requestAnimationFrame(animate)
    }
    frameId = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(frameId)
  }, [playing, keyframes, camera.aspectRatio, fps, totalFrames, settings.loopPlayback])

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

  const applySettings = nextSettings => {
    const next = normalizeProjectSettings(nextSettings)
    const nextTotalFrames = next.fps * next.durationSeconds
    const lastKeyframeFrame = normalizeFrameNumber(maxKeyframeFrame)
    if (nextTotalFrames < lastKeyframeFrame) {
      const requiredSeconds = Math.max(1, Math.ceil(lastKeyframeFrame / next.fps))
      setToast(ui(`最后关键帧在第 ${lastKeyframeFrame} 帧，时长至少 ${requiredSeconds} 秒`, `The last keyframe is frame ${lastKeyframeFrame}; duration must be at least ${requiredSeconds} seconds`))
      return
    }
    setPlaying(false)
    setSettings(next)
    setShots(list => list.map(shot => shot.id === activeShotId ? { ...shot, fps: next.fps, durationSeconds: next.durationSeconds, loopPlayback: next.loopPlayback } : shot))
    setCurrentFrame(frame => {
      const nextFrame = clamp(frame, 0, nextTotalFrames)
      currentFrameRef.current = nextFrame
      return nextFrame
    })
    setSettingsOpen(false)
    setToast(ui(`时间轴已更新 · ${next.fps} FPS · ${next.durationSeconds} 秒`, `Timeline updated · ${next.fps} FPS · ${next.durationSeconds} sec`))
  }

  const thumbnailFromMonitor = () => {
    const source = monitorCanvasRef.current
    if (!source?.width || !source?.height) return ''
    try {
      const canvas = document.createElement('canvas')
      canvas.width = 240
      canvas.height = 135
      const context = canvas.getContext('2d')
      context.fillStyle = '#11110f'
      context.fillRect(0, 0, canvas.width, canvas.height)
      const scale = Math.min(canvas.width / source.width, canvas.height / source.height)
      const width = source.width * scale
      const height = source.height * scale
      context.drawImage(source, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height)
      return canvas.toDataURL('image/jpeg', 0.74)
    } catch {
      return ''
    }
  }

  const liveShotRecord = (shot, thumbnail = shot?.thumbnail || '') => ({
    ...shot,
    id: shot?.id || activeShotId,
    name: shot?.name || ui('镜头', 'Shot'),
    thumbnail,
    fps: settings.fps,
    durationSeconds: settings.durationSeconds,
    loopPlayback: settings.loopPlayback,
    objects,
    camera,
    lighting,
    reference,
    keyframes,
    objectKeyframes: characterKeyframes,
  })

  const applyShotState = shot => {
    setPlaying(false)
    setObjectDrafts({})
    setSelectedKeyframe(null)
    setKeyframeClipboard(null)
    setSettings(current => ({ ...current, fps: shot.fps, durationSeconds: shot.durationSeconds, loopPlayback: shot.loopPlayback }))
    setObjects(cloneProjectValue(shot.objects))
    setCamera(cloneProjectValue(shot.camera))
    setLighting(normalizeLighting(shot.lighting))
    setReference(normalizeReference(shot.reference))
    setKeyframes(cloneProjectValue(shot.keyframes || []))
    setCharacterKeyframes(cloneProjectValue(shot.objectKeyframes || {}))
    setCurrentFrame(0)
    currentFrameRef.current = 0
    setActiveShotId(shot.id)
    setSelectedId(shot.objects?.[0]?.id || CAMERA_ID)
  }

  const switchShot = shotId => {
    if (shotId === activeShotId) return
    const target = shots.find(shot => shot.id === shotId)
    if (!target) return
    const thumbnail = thumbnailFromMonitor()
    setShots(list => list.map(shot => shot.id === activeShotId ? liveShotRecord(shot, thumbnail || shot.thumbnail) : shot))
    applyShotState(target)
    setToast(ui(`已切换到“${target.name}”`, `Switched to “${target.name}”`))
  }

  const addShot = () => {
    if (shots.length >= 30) { setToast(ui('每个工程最多 30 个镜头', 'Each project supports up to 30 shots')); return }
    const thumbnail = thumbnailFromMonitor()
    const id = `shot-${uid()}`
    const nextShot = {
      id,
      name: uniqueShotName(shots, isEnglish ? `Shot ${String(shots.length + 1).padStart(2, '0')}` : defaultShotName(shots.length)),
      thumbnail,
      fps: settings.fps,
      durationSeconds: settings.durationSeconds,
      loopPlayback: settings.loopPlayback,
      objects: cloneProjectValue(objects),
      camera: cloneProjectValue(camera),
      lighting: cloneProjectValue(lighting),
      reference: cloneProjectValue(DEFAULT_REFERENCE),
      keyframes: [],
      objectKeyframes: {},
    }
    setShots(list => [...list.map(shot => shot.id === activeShotId ? liveShotRecord(shot, thumbnail || shot.thumbnail) : shot), nextShot])
    applyShotState(nextShot)
    setToast(ui(`已新建“${nextShot.name}” · 场景已复制，关键帧和参考图为空`, `Created “${nextShot.name}” · scene copied; keyframes and reference image cleared`))
  }

  const duplicateShot = shotId => {
    if (shots.length >= 30) { setToast(ui('每个工程最多 30 个镜头', 'Each project supports up to 30 shots')); return }
    const thumbnail = thumbnailFromMonitor()
    const storedSource = shots.find(shot => shot.id === shotId)
    if (!storedSource) return
    const source = shotId === activeShotId ? liveShotRecord(storedSource, thumbnail || storedSource.thumbnail) : storedSource
    const duplicate = cloneProjectValue({ ...source, id: `shot-${uid()}`, name: uniqueShotName(shots, `${source.name} ${ui('副本', 'copy')}`) })
    setShots(list => {
      const persisted = list.map(shot => shot.id === activeShotId ? liveShotRecord(shot, thumbnail || shot.thumbnail) : shot)
      const sourceIndex = persisted.findIndex(shot => shot.id === shotId)
      return [...persisted.slice(0, sourceIndex + 1), duplicate, ...persisted.slice(sourceIndex + 1)]
    })
    applyShotState(duplicate)
    setToast(ui(`已复制“${source.name}”`, `Duplicated “${source.name}”`))
  }

  const deleteShot = shotId => {
    if (shots.length <= 1) return
    const sourceIndex = shots.findIndex(shot => shot.id === shotId)
    const source = shots[sourceIndex]
    if (!source || !window.confirm(ui(`删除镜头“${source.name}”？`, `Delete shot “${source.name}”?`))) return
    const thumbnail = thumbnailFromMonitor()
    const persisted = shots.map(shot => shot.id === activeShotId ? liveShotRecord(shot, thumbnail || shot.thumbnail) : shot)
    const remaining = persisted.filter(shot => shot.id !== shotId)
    setShots(remaining)
    if (shotId === activeShotId) applyShotState(remaining[Math.min(sourceIndex, remaining.length - 1)])
    setToast(ui(`已删除“${source.name}”`, `Deleted “${source.name}”`))
  }

  const renameShot = (shotId, name, commit = false) => setShots(list => {
    const index = list.findIndex(shot => shot.id === shotId)
    if (index < 0) return list
    const draft = String(name || '').slice(0, 30)
    const nextName = commit ? (draft.trim() || (isEnglish ? `Shot ${String(index + 1).padStart(2, '0')}` : defaultShotName(index))) : draft
    return list.map(shot => shot.id === shotId ? { ...shot, name: nextName } : shot)
  })

  const captureShotThumbnail = shotId => {
    if (shotId !== activeShotId) { setToast(ui('请先切换到该镜头再更新缩略图', 'Switch to this shot before updating its thumbnail')); return }
    const thumbnail = thumbnailFromMonitor()
    if (!thumbnail) { setToast(ui('摄像机画面尚未准备好，请稍后重试', 'The camera frame is not ready yet; try again shortly')); return }
    setShots(list => list.map(shot => shot.id === shotId ? { ...shot, thumbnail } : shot))
    setToast(ui('镜头缩略图已更新', 'Shot thumbnail updated'))
  }

  const addPerson = bodyType => {
    const id = uid()
    const person = { id, name: `${ui('人物', 'Character')} · ${objects.filter(item => item.type === 'person').length + 1}`, type: 'person', bodyType, pose: 'idle', poseTime: presetPhase('idle'), joints: presetJoints(), rigRoot: [0, 0, 0], footLock: false, continuousMotion: false, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], color: '#e8e3d8' }
    setObjects(list => [...list, person])
    setSelectedId(id)
  }
  const addPrimitive = type => {
    const id = uid()
    const labels = Object.fromEntries(['box', 'sphere', 'cylinder', 'plane', 'arch', 'stairs', 'table', 'chair', 'sofa', 'door', 'window', 'tree', 'vehicle', 'roof'].map(type => [type, t(`previs.studio.objectTypes.${type}`)]))
    const defaultScales = { arch: [1.8, 2.2, 0.45], stairs: [2.2, 1.4, 2.8], door: [1.2, 2.2, 0.25], window: [1.5, 1.3, 0.22], table: [1.7, 1, 1.1], chair: [0.8, 1, 0.8], sofa: [2.2, 1.1, 1], tree: [1.8, 2.6, 1.8], vehicle: [2.8, 1.2, 1.6], roof: [2.8, 1.2, 2.2] }
    const positionY = type === 'plane' ? 0.02 : (type === 'tree' ? 1.3 : 0.5)
    setObjects(list => [...list, { id, name: `${labels[type] || type} · ${list.filter(item => item.type === type).length + 1}`, type, position: [0, positionY, 0], rotation: [0, 0, 0], scale: type === 'plane' ? [2, 1, 2] : (defaultScales[type] || [1, 1, 1]), color: type === 'tree' ? '#9ca68d' : '#c7c2b7' }])
    setSelectedId(id)
  }
  const importModel = async event => {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      const url = onImportAsset ? await onImportAsset(file) : await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result)
        reader.onerror = () => reject(reader.error || new Error('model read failed'))
        reader.readAsDataURL(file)
      })
      const id = uid()
      setObjects(list => [...list, { id, name: file.name.replace(/\.(glb|gltf)$/i, ''), type: 'model', url, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], color: '#ddd8cc' }])
      setSelectedId(id)
      setToast(ui('模型已加入场景', 'Model added to the scene'))
    } catch (error) {
      setToast(error?.message || ui('模型导入失败', 'Model import failed'))
    }
    event.target.value = ''
  }
  const updateObjectById = (id, patch) => {
    setObjectDrafts(drafts => {
      if (!characterKeyframes[id]?.length) {
        if (!(id in drafts)) return drafts
        const next = { ...drafts }
        delete next[id]
        return next
      }
      const source = drafts[id] || objectAtFrame(objects.find(object => object.id === id), characterKeyframes[id], currentFrame, fps)
      return source ? { ...drafts, [id]: { ...source, ...patch } } : drafts
    })
    setObjects(list => list.map(object => object.id === id ? { ...object, ...patch } : object))
  }
  const updateSelected = patch => updateObjectById(selectedId, patch)
  const groundSelected = () => {
    if (!activeObject || activeObject.locked) return
    setGroundRequest({ id: activeObject.id, nonce: Date.now() })
    setToast(ui('已按模型最低点落到地面', 'Object placed on the ground from its lowest point'))
  }
  const resetSelectedRotation = () => {
    if (!activeObject || activeObject.locked) return
    updateSelected({ rotation: [0, 0, 0] })
    setToast(ui('整体旋转已归零', 'Rotation reset'))
  }
  const resetSelectedScale = () => {
    if (!activeObject || activeObject.locked) return
    updateSelected({ scale: [1, 1, 1] })
    setToast(ui('整体缩放已恢复为 1', 'Scale reset to 1'))
  }
  const captureEditorView = useCallback(view => {
    if (view?.position?.length === 3 && view?.rotation?.length === 3 && view?.target?.length === 3) editorViewRef.current = view
  }, [])
  const openCameraView = () => {
    setEditorView(cloneProjectValue(editorViewRef.current))
    setCameraView(true)
  }
  const openEditorView = () => {
    setCameraView(false)
    setCameraAnglePanelOpen(false)
  }
  const levelCameraHorizon = () => {
    setCamera(current => {
      const rotation = Array.isArray(current.rotation) ? [...current.rotation] : [0, 0, 0]
      rotation[2] = 0
      return { ...current, rotation }
    })
    setToast(ui('摄像机翻滚已归零 · 地面水平线已校正', 'Camera roll reset · horizon leveled'))
  }
  const collapseViewOptions = () => {
    setViewOptionsCollapsed(true)
    setLightingPanelOpen(false)
    setCameraAnglePanelOpen(false)
  }
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
      rigRoot: [...(customPose.rigRoot || presetRoot(customPose.pose))],
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
    const next = { frame: currentFrame, interpolation: normalizeInterpolation(existing?.interpolation), position: [...camera.position], rotation: [...camera.rotation], focalLength: camera.focalLength }
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
    setToast(activeObject.type === 'person'
      ? ui(`已记录“${activeObject.name}”第 ${currentFrame} 帧角色状态`, `Recorded character state for “${activeObject.name}” at frame ${currentFrame}`)
      : t('previs.studio.messages.objectRecorded', { name: activeObject.name, frame: currentFrame }))
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
    const data = projectData({ settings, objects, camera, lighting, reference, keyframes, objectKeyframes: characterKeyframes, shots, activeShotId })
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
      const safeName = settings.name.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'monoform-project'
      link.download = `${safeName}.monoform.json`
      link.click()
      URL.revokeObjectURL(link.href)
    }
    if (download) setToast(cached ? t('previs.studio.messages.projectJsonExported') : t('previs.studio.messages.projectExportQuota'))
    else setToast(cached ? t('previs.studio.messages.projectSaved') : t('previs.studio.messages.projectSaveQuota'))
  }
  const handleCaptureImage = async ({ download = true } = {}) => {
    if (exportLockRef.current || exporting || capturingImage) throw new Error(ui('已有导出任务正在进行', 'An export is already running'))
    exportLockRef.current = true
    const exportToken = ++exportCancellationRef.current
    const assertExportActive = () => {
      if (exportCancellationRef.current === exportToken) return
      const error = new Error(t('previs.stopped'))
      error.code = 'PREVIS_EXPORT_CANCELLED'
      throw error
    }
    setPlaying(false)
    imageCaptureCanvasRef.current = null
    try {
      const { width, height } = exportDimensions
      const backgroundCanvas = await referenceCanvasForExport(reference, width, height, ui)
      assertExportActive()
      setExportReferenceBackground(backgroundCanvas)
      setCapturingImage(true)
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
      return { blob, width, height, frame: currentFrameRef.current, fps, aspectRatio: camera.aspectRatio || '16:9' }
    } catch (error) {
      setToast(error?.message || t('previs.studio.messages.captureFailed'))
      throw error
    } finally {
      setCapturingImage(false)
      setExportReferenceBackground(null)
      imageCaptureCanvasRef.current = null
      exportLockRef.current = false
    }
  }
  const handleExportMp4 = async ({ download = true } = {}) => {
    if (exportLockRef.current || exporting || capturingImage) throw new Error(ui('已有导出任务正在进行', 'An export is already running'))
    exportLockRef.current = true
    const exportToken = ++exportCancellationRef.current
    const assertExportActive = () => {
      if (exportCancellationRef.current === exportToken) return
      const error = new Error(t('previs.stopped'))
      error.code = 'PREVIS_EXPORT_CANCELLED'
      throw error
    }
    const nextExportFrameCount = totalFrames
    const originalFrame = currentFrameRef.current
    const originalCamera = keyframes.length ? cameraAtFrame(keyframes, originalFrame, camera.aspectRatio) : camera
    let output

    setPlaying(false)
    setObjectDrafts({})
    setCamera(originalCamera)
    setExportProgress(0)
    exportCanvasRef.current = null

    try {
      if (typeof VideoEncoder === 'undefined') throw new Error(t('previs.studio.messages.videoUnsupported'))
      const {
        BufferTarget, CanvasSource, Mp4OutputFormat, Output,
        QUALITY_HIGH, getFirstEncodableVideoCodec,
      } = await import('mediabunny')
      const { width, height } = exportDimensions
      const backgroundCanvas = await referenceCanvasForExport(reference, width, height, ui)
      assertExportActive()
      setExportReferenceBackground(backgroundCanvas)
      setExporting(true)
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
      output.addVideoTrack(videoSource, { frameRate: fps })
      await output.start()

      for (let sample = 0; sample < nextExportFrameCount; sample += 1) {
        assertExportActive()
        const timelineFrame = Math.min(sample, totalFrames)
        setCurrentFrame(timelineFrame)
        currentFrameRef.current = timelineFrame
        await nextPaint()
        await videoSource.add(sample / fps, 1 / fps, { keyFrame: sample % (fps * 2) === 0 })
        setExportProgress(Math.round((sample + 1) / nextExportFrameCount * 100))
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
        const safeName = settings.name.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'monoform-animation'
        link.download = `${safeName}-${stamp}.mp4`
        document.body.appendChild(link)
        link.click()
        link.remove()
        URL.revokeObjectURL(link.href)
      }
      setToast(t('previs.studio.messages.mp4Done', { width, height, fps }))
      return { blob, width, height, fps, frameCount: nextExportFrameCount, durationSeconds: settings.durationSeconds, aspectRatio: camera.aspectRatio || '16:9', codec: 'h264', hasAudio: false }
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
      setExportReferenceBackground(null)
      exportCanvasRef.current = null
      exportLockRef.current = false
    }
  }
  const loadProject = event => {
    const file = event.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const loaded = normalizeProjectData(JSON.parse(reader.result))
        if (!loaded) throw new Error('invalid project')
        setSettings(loaded.settings)
        setShots(loaded.shots)
        setActiveShotId(loaded.activeShotId)
        setObjects(loaded.objects)
        setCamera(loaded.camera)
        setLighting(loaded.lighting)
        setReference(loaded.reference)
        setKeyframes(loaded.keyframes)
        setCharacterKeyframes(loaded.objectKeyframes)
        setObjectDrafts({})
        setSelectedKeyframe(null)
        setCurrentFrame(0)
        currentFrameRef.current = 0
        setPlaying(false)
        setSettingsOpen(false)
        setSelectedId(CAMERA_ID)
        setToast(ui(`工程已打开 · ${loaded.shots.length} 个镜头`, `Project opened · ${loaded.shots.length} shots`))
      } catch { setToast(t('previs.studio.messages.projectOpenFailed')) }
    }
    reader.readAsText(file)
    event.target.value = ''
  }
  const resetProject = () => {
    const resetObjects = cloneProjectValue(freshInitialObjects)
    const resetCamera = cloneProjectValue(initialCamera)
    setSettings({ ...DEFAULT_PROJECT_SETTINGS, name: ui(DEFAULT_PROJECT_SETTINGS.name, 'Untitled scene') })
    setShots([{ id: 'shot-01', name: ui('镜头 01', 'Shot 01'), thumbnail: '', fps: DEFAULT_PROJECT_SETTINGS.fps, durationSeconds: DEFAULT_PROJECT_SETTINGS.durationSeconds, loopPlayback: DEFAULT_PROJECT_SETTINGS.loopPlayback, objects: resetObjects, camera: resetCamera, lighting: cloneProjectValue(DEFAULT_LIGHTING), reference: cloneProjectValue(DEFAULT_REFERENCE), keyframes: [], objectKeyframes: {} }])
    setActiveShotId('shot-01')
    setObjects(resetObjects)
    setCamera(resetCamera)
    setLighting(cloneProjectValue(DEFAULT_LIGHTING))
    setReference(cloneProjectValue(DEFAULT_REFERENCE))
    setKeyframes(initialKeyframes)
    setCharacterKeyframes(initialCharacterKeyframes)
    setObjectDrafts({})
    setSelectedKeyframe(null)
    setCurrentFrame(0)
    currentFrameRef.current = 0
    setPlaying(false)
    setSettingsOpen(false)
    setSelectedId('actor-lead')
    setToast(ui('已新建空关键帧工程 · 可在时间轴右侧设置时长', 'Created an empty keyframe project · set the duration on the right side of the timeline'))
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
  }), [currentProject, handleCaptureImage, handleExportMp4, t])

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
        <div className="project-title"><i className={`status-dot ${saveStatus === 'saving' ? '' : 'live'}`} /><button type="button" onClick={() => setSettingsOpen(true)} title={ui('打开时间轴设置', 'Open timeline settings')}><span>{projectTitle || settings.name}</span><Settings2 size={12} /></button><small>{activeShot?.name} · {t(`previs.studio.status.${saveStatus}`)}</small></div>
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
        <LeftSidebar objects={objects} selectedId={selectedId} onSelect={setSelectedId} onAddPerson={addPerson} onAddPrimitive={addPrimitive} onImport={importModel} onToggleVisible={id => updateObjectById(id, { visible: objects.find(item => item.id === id)?.visible === false })} onToggleLock={id => updateObjectById(id, { locked: !objects.find(item => item.id === id)?.locked })} shots={displayedShots} activeShotId={activeShotId} onSelectShot={switchShot} onAddShot={addShot} onDuplicateShot={duplicateShot} onDeleteShot={deleteShot} onRenameShot={renameShot} onCaptureShot={captureShotThumbnail} />
        <section className="viewport-shell">
          <div className="viewport-toolbar floating-panel">
            <ToolButton icon={MousePointer2} label={t('previs.studio.tools.select')} active={!['translate', 'rotate', 'scale'].includes(transformMode)} onClick={() => setTransformMode('select')} shortcut="Q" />
            <span />
            <ToolButton icon={Move3D} label={t('previs.studio.tools.move')} active={transformMode === 'translate'} onClick={() => setTransformMode('translate')} shortcut="W" />
            <ToolButton icon={RotateCw} label={t('previs.studio.tools.rotate')} active={transformMode === 'rotate'} onClick={() => setTransformMode('rotate')} shortcut="E" />
            <ToolButton icon={BoxSelect} label={t('previs.studio.tools.scale')} active={transformMode === 'scale'} onClick={() => setTransformMode('scale')} shortcut="R" />
            <span />
            <ToolButton icon={Axis3D} label={transformSpace === 'world' ? ui('世界坐标', 'World space') : ui('局部坐标', 'Local space')} active={transformSpace === 'local'} disabled={transformMode === 'select'} onClick={() => setTransformSpace(space => space === 'world' ? 'local' : 'world')} />
            <ToolButton icon={Magnet} label={snapEnabled ? ui('关闭吸附', 'Disable snapping') : ui('开启吸附', 'Enable snapping')} active={snapEnabled} disabled={transformMode === 'select'} onClick={() => setSnapEnabled(value => !value)} />
          </div>
          <div className="viewport-mode-help">
            {transformMode === 'select' && ui('Q 选择 / 人物摆姿 · 重叠处优先当前对象 · Alt 选择前层', 'Q select / pose character · current object wins overlaps · Alt selects the front layer')}
            {transformMode === 'translate' && ui(`W 整体移动 · ${transformSpace === 'world' ? '世界坐标' : '局部坐标'} · ${snapEnabled ? '0.1 格吸附' : '自由移动'}`, `W move object · ${transformSpace === 'world' ? 'world space' : 'local space'} · ${snapEnabled ? '0.1-unit snap' : 'free move'}`)}
            {transformMode === 'rotate' && ui(`${selectedId === CAMERA_ID ? 'E 摄像机旋转' : 'E 整体旋转'} · ${transformSpace === 'world' ? '世界坐标' : '局部坐标'} · ${snapEnabled ? '5° 吸附' : '自由旋转'}`, `${selectedId === CAMERA_ID ? 'E rotate camera' : 'E rotate object'} · ${transformSpace === 'world' ? 'world space' : 'local space'} · ${snapEnabled ? '5° snap' : 'free rotate'}`)}
            {transformMode === 'scale' && ui(`R 整体缩放 · ${transformSpace === 'world' ? '世界坐标' : '局部坐标'} · ${snapEnabled ? '0.1 吸附' : '自由缩放'}`, `R scale object · ${transformSpace === 'world' ? 'world space' : 'local space'} · ${snapEnabled ? '0.1 snap' : 'free scale'}`)}
          </div>
          <div className={`viewport-view-options floating-panel ${viewOptionsCollapsed ? 'is-collapsed' : ''}`}>
            {viewOptionsCollapsed ? (
              <button className="view-options-expand" onClick={() => setViewOptionsCollapsed(false)} title={ui('展开视角工具', 'Expand view tools')} aria-label={ui('展开视角工具', 'Expand view tools')}><ChevronLeft size={14} /></button>
            ) : (
              <>
                <button className={showGrid ? 'is-active' : ''} onClick={() => setShowGrid(value => !value)}><Grid3X3 size={14} /> {t('previs.studio.grid')}</button>
                <button className={lightingPanelOpen ? 'is-active' : ''} onClick={() => { setLightingPanelOpen(value => !value); setCameraAnglePanelOpen(false) }} title={ui('调整当前镜头的环境光和主光', 'Adjust ambient, key, and fill lighting for the current shot')}><Sun size={14} /> {ui('光照', 'Lighting')}</button>
                <button className={!cameraView ? 'is-active' : ''} onClick={openEditorView} title={ui('使用固定的编辑观察相机自由布置场景', 'Arrange the scene with the free editor camera')}><RotateCw size={14} /> {ui('编辑视角', 'Editor view')}</button>
                <button className={cameraView ? 'is-active' : ''} onClick={openCameraView} title={ui('切换到场景中主摄像机的实际画面', 'View the actual frame from the scene camera')}><Camera size={14} /> {ui('摄像机视角', 'Camera view')}</button>
                {cameraView && <button className={cameraAnglePanelOpen ? 'is-active' : ''} onClick={() => { setCameraAnglePanelOpen(value => !value); setLightingPanelOpen(false) }} title={ui('调整参考图视角中的地面和水平线', 'Match the ground plane and horizon to the reference')}><SlidersHorizontal size={14} /> {ui('镜头角度', 'Camera angle')}</button>}
                <button><span className="solid-sphere" /> {t('previs.studio.solid')}</button>
                <button className="view-options-collapse" onClick={collapseViewOptions} title={ui('收起视角工具', 'Collapse view tools')} aria-label={ui('收起视角工具', 'Collapse view tools')}><ChevronRight size={14} /></button>
              </>
            )}
          </div>
          {lightingPanelOpen && <LightingPanel lighting={lighting} onChange={setLighting} onClose={() => setLightingPanelOpen(false)} />}
          {cameraView && cameraAnglePanelOpen && <CameraAnglePanel camera={camera} onChange={patch => setCamera(current => ({ ...current, ...patch }))} onClose={() => setCameraAnglePanelOpen(false)} onLevel={levelCameraHorizon} />}
          <div className="viewport-label"><strong>{cameraView ? ui('摄像机视角', 'Camera view') : ui('编辑视角', 'Editor view')}</strong><span>{cameraView ? `${aspectLabel(displayCamera.aspectRatio, isEnglish)} · ${ui('正在查看场景中的主摄像机', 'Viewing the scene camera')}` : ui('固定观察相机 · 可查看并调整场景中的主摄像机', 'Free editor camera · inspect and adjust the scene camera')}</span></div>
          <ViewportAspectPicker value={camera.aspectRatio} onChange={aspectRatio => setCamera(current => ({ ...current, aspectRatio }))} />
          <ReferenceOverlay reference={reference} onChange={setReference} onToast={setToast} cameraMode={cameraView} cameraAspect={previewAspect}>
            <div className="viewport-canvas-layer">
              <MainViewport key={cameraView ? 'shot-view' : 'scene-view'} cameraView={cameraView} cameraAspect={previewAspect} editorCameraData={editorView} onEditorCameraChange={captureEditorView} objects={animatedObjects} animationTime={currentFrame / fps} selectedId={selectedId} activeJoint={selectedJoint} onSelect={setSelectedId} onJointSelect={(objectId, jointId) => { setSelectedId(objectId); setSelectedJoint(jointId) }} transformMode={transformMode} transformSpace={transformSpace} snapEnabled={snapEnabled} groundRequest={groundRequest} onUpdateObject={updateObjectById} cameraData={displayCamera} onUpdateCamera={patch => setCamera(current => ({ ...current, ...patch }))} lighting={lighting} showGrid={showGrid} focusRequest={viewFocusRequest} referenceVisible={Boolean(reference.image && reference.visible)} />
            </div>
          </ReferenceOverlay>
          <div className="navigation-hint"><span><MousePointer2 size={12} /> {ui('点击物体选择', 'Click an object to select')}</span>{cameraView ? <><span>{ui('主摄像机画面', 'Scene-camera frame')}</span><span>{ui('网格仅辅助 · 不进入导出', 'Grid is a guide and is not exported')}</span></> : <><span>{ui('空白处左键旋转', 'Left-drag empty space to orbit')}</span><span>{ui('右键平移', 'Right-drag to pan')}</span><span>{ui('滚轮缩放', 'Wheel to zoom')}</span></>}</div>
          <div className={`camera-monitor is-${monitorMode}`}>
            <div className="monitor-head"><div><Video size={13} /><strong>{ui('主摄像机 01', 'Main camera 01')}</strong><span>{monitorMode === 'minimized' ? 'CAMERA' : 'CAMERA VIEW'}</span></div><div className="monitor-head-actions">
              {monitorMode === 'minimized' ? <button title={ui('恢复摄像机窗口', 'Restore camera window')} onClick={() => setMonitorMode('normal')}><Maximize2 size={13} /></button> : <>
                <button title={ui('选择场景中的主摄像机', 'Select the scene camera')} onClick={() => setSelectedId(CAMERA_ID)}><Camera size={12} /></button>
                <button title={ui('最小化摄像机窗口', 'Minimize camera window')} onClick={() => setMonitorMode('minimized')}><Minus size={13} /></button>
                <button title={monitorMode === 'expanded' ? ui('恢复摄像机窗口大小', 'Restore camera-window size') : ui('放大摄像机窗口', 'Expand camera window')} onClick={() => setMonitorMode(mode => mode === 'expanded' ? 'normal' : 'expanded')}>{monitorMode === 'expanded' ? <Minimize2 size={13} /> : <Maximize2 size={13} />}</button>
                <button title={ui('切换到摄像机视角', 'Switch to camera view')} onClick={openCameraView}><ZoomIn size={13} /></button>
              </>}
            </div></div>
            {monitorMode !== 'minimized' && <div className="monitor-frame">
              <div className={`monitor-canvas ${previewAspectClass}`} style={{ '--preview-aspect': previewAspect }}>
                <CameraPreview objects={animatedObjects} animationTime={currentFrame / fps} cameraData={displayCamera} cameraAspect={previewAspect} lighting={lighting} backgroundCanvas={monitorReferenceBackground} onCanvasReady={canvas => { monitorCanvasRef.current = canvas }} />
                <span className="safe-frame" />
                <span className="owner-watermark" aria-label={t('previs.studio.brandAria')}><i><img src={BRAND_MARK_URL} alt="" /></i><b>MONOFORM</b></span>
                <span className="monitor-timecode">{timecodeAtFrame(currentFrame, fps)}</span>
                <span className="monitor-focal">{Math.round(displayCamera.focalLength)} mm · {aspectLabel(displayCamera.aspectRatio, isEnglish)}</span>
              </div>
            </div>}
          </div>
        </section>
        <Inspector selected={inspectorSelected} camera={camera} selectedJoint={selectedJoint} customPoses={customPoses} onSelectJoint={setSelectedJoint} onUpdateObject={updateSelected} onUpdateCamera={patch => setCamera(current => ({ ...current, ...patch }))} onDelete={deleteSelected} onDuplicate={duplicateSelected} onFocus={focusSelected} onToggleLock={() => activeObject && updateSelected({ locked: !activeObject.locked })} onGround={groundSelected} onResetRotation={resetSelectedRotation} onResetScale={resetSelectedScale} onSaveCustomPose={saveCustomPose} onApplyCustomPose={applyCustomPose} onDeleteCustomPose={deleteCustomPose} />
        <Timeline
          currentFrame={currentFrame}
          fps={fps}
          totalFrames={totalFrames}
          onOpenSettings={() => setSettingsOpen(true)}
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
          <CameraPreview objects={animatedObjects} animationTime={currentFrame / fps} cameraData={displayCamera} cameraAspect={exportDimensions.width / exportDimensions.height} lighting={lighting} exportMode backgroundCanvas={exportReferenceBackground} onCanvasReady={canvas => { imageCaptureCanvasRef.current = canvas }} />
        </div>
      )}
      {exporting && (
        <>
          <div className="export-render-surface" style={{ width: exportDimensions.width, height: exportDimensions.height }} aria-hidden="true">
            <CameraPreview objects={animatedObjects} animationTime={currentFrame / fps} cameraData={displayCamera} cameraAspect={exportDimensions.width / exportDimensions.height} lighting={lighting} exportMode backgroundCanvas={exportReferenceBackground} onCanvasReady={canvas => { exportCanvasRef.current = canvas }} />
          </div>
          <div className="export-progress-overlay" role="status" aria-live="polite">
            <div className="export-progress-card">
              <FileVideo2 size={20} />
              <div className="export-progress-copy"><strong>{t('previs.studio.encoding')}</strong><span>{t('previs.studio.encodingFrame', { width: exportDimensions.width, height: exportDimensions.height, fps, frame: Math.round(exportProgress / 100 * totalFrames), total: totalFrames })}</span></div>
              <output>{exportProgress}%</output>
              <div className="export-progress-track"><i style={{ width: `${exportProgress}%` }} /></div>
            </div>
          </div>
        </>
      )}
      {settingsOpen && <ProjectSettingsDialog settings={settings} maxKeyframeFrame={maxKeyframeFrame} onApply={applySettings} onClose={() => setSettingsOpen(false)} />}
      {toast && <div className="toast"><span />{toast}</div>}
    </main>
  )
}

export default forwardRef(MonoformStudio)
