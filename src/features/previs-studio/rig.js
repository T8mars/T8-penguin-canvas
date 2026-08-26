const BONE_PREFIX = 'mixamorig'

const bone = (name, label, group) => ({ id: `${BONE_PREFIX}${name}`, label, group })
const fingerBones = (side, sideLabel, finger, fingerLabel) => (
  Array.from({ length: 4 }, (_, index) => bone(`${side}Hand${finger}${index + 1}`, `${sideLabel}${fingerLabel} ${index + 1}`, `${sideLabel}手指`))
)

export const JOINT_DEFINITIONS = [
  bone('Hips', '骨盆', '躯干与头部'),
  bone('Spine', '脊柱 1', '躯干与头部'),
  bone('Spine1', '脊柱 2', '躯干与头部'),
  bone('Spine2', '胸椎', '躯干与头部'),
  bone('Neck', '颈部', '躯干与头部'),
  bone('Head', '头部', '躯干与头部'),
  bone('HeadTop_End', '头顶末端', '躯干与头部'),
  bone('LeftEye', '左眼', '躯干与头部'),
  bone('RightEye', '右眼', '躯干与头部'),

  bone('LeftShoulder', '左锁骨', '左臂'),
  bone('LeftArm', '左上臂', '左臂'),
  bone('LeftForeArm', '左前臂', '左臂'),
  bone('LeftHand', '左手掌', '左臂'),
  bone('RightShoulder', '右锁骨', '右臂'),
  bone('RightArm', '右上臂', '右臂'),
  bone('RightForeArm', '右前臂', '右臂'),
  bone('RightHand', '右手掌', '右臂'),

  bone('LeftUpLeg', '左大腿', '左腿'),
  bone('LeftLeg', '左小腿', '左腿'),
  bone('LeftFoot', '左脚', '左腿'),
  bone('LeftToeBase', '左脚趾', '左腿'),
  bone('LeftToe_End', '左脚趾末端', '左腿'),
  bone('RightUpLeg', '右大腿', '右腿'),
  bone('RightLeg', '右小腿', '右腿'),
  bone('RightFoot', '右脚', '右腿'),
  bone('RightToeBase', '右脚趾', '右腿'),
  bone('RightToe_End', '右脚趾末端', '右腿'),

  ...fingerBones('Left', '左', 'Thumb', '拇指'),
  ...fingerBones('Left', '左', 'Index', '食指'),
  ...fingerBones('Left', '左', 'Middle', '中指'),
  ...fingerBones('Left', '左', 'Ring', '无名指'),
  ...fingerBones('Left', '左', 'Pinky', '小指'),
  ...fingerBones('Right', '右', 'Thumb', '拇指'),
  ...fingerBones('Right', '右', 'Index', '食指'),
  ...fingerBones('Right', '右', 'Middle', '中指'),
  ...fingerBones('Right', '右', 'Ring', '无名指'),
  ...fingerBones('Right', '右', 'Pinky', '小指'),
]

export const JOINT_GROUPS = [...new Set(JOINT_DEFINITIONS.map(joint => joint.group))].map(label => ({
  label,
  joints: JOINT_DEFINITIONS.filter(joint => joint.group === label),
}))

// These clips are embedded in the official Three.js X-Bot GLB. No hand-authored
// Euler poses or skeleton retargeting are involved.
// The squat presets preserve the user's manually authored offsets on top of the
// recorded squat clip so their silhouettes stay identical on every device.
const HALF_SQUAT_JOINTS = {
  mixamorigHips: [0.15999975585937498, 0.5600009765625, 0],
  mixamorigLeftArm: [-0.028795619342473648, 0.0654006934588603, 0.8292728085902578],
  mixamorigLeftForeArm: [-0.23693435795237683, 0.7345475293283817, -0.09104921258987955],
  mixamorigRightArm: [0.5320855359101243, -0.04121568060743169, -1.0485423770422415],
  mixamorigRightForeArm: [-1.571495050705541, -0.7134423981800843, 0.49837097373972183],
  mixamorigLeftUpLeg: [0.06720266777357443, 0.0008666212988651557, 0.021644085969670334],
  mixamorigLeftLeg: [-0.5026470079344459, -0.07883219504212054, 0.19778112801005593],
  mixamorigRightUpLeg: [-0.0762500839830151, 0.0008858648924058381, 0.0046341416750831504],
  mixamorigRightLeg: [-0.06990935634120955, 0.0465205178623685, -0.2503830334239903],
}
// `squat_full` preserves the user's manually posed joint offsets on top of the
// recorded squat clip so the authored silhouette is identical on every device.
const FULL_SQUAT_JOINTS = {
  mixamorigHips: [0.87199951171875, -0.31200000000000017, 0],
  mixamorigSpine: [-1.688000244140625, -0.07200073242187499, 0],
  mixamorigSpine2: [0.7599997558593751, -0.14400000000000002, 0],
  mixamorigHead: [-0.4159998779296875, 0.392000244140625, 0],
  mixamorigLeftShoulder: [0.23199975585937502, 0.41600024414062503, 0],
  mixamorigLeftArm: [0.03746006762600138, 0.17499803108555784, 0.8655944148604124],
  mixamorigLeftForeArm: [-2.717312119823117, 0.5748783282837469, 0.11584572916466457],
  mixamorigRightArm: [0.6065999201968233, 0.6400682490977883, -1.5628702130438688],
  mixamorigRightForeArm: [-1.2702160295096634, -0.5241560950304515, 1.2621633307439222],
  mixamorigLeftUpLeg: [-2.0163467294084305, 1.071266660300493, -0.258056937690117],
  mixamorigLeftLeg: [0.7483905093630452, 0.32854657832623013, 1.126905022770306],
  mixamorigRightUpLeg: [-2.1438662983548937, -1.1045539560490456, 0.062262357881979986],
  mixamorigRightLeg: [0.6397601162120418, -0.22522846126351503, -0.9402899567027515],
}

export const RIG_PRESETS = {
  idle: { clip: 'idle', phase: 0.08, duration: 2.5, loopable: true, label: '自然站立' },
  stand_relaxed: { clip: 'idle', phase: 0.34, label: '放松站姿' },
  idle_shift: { clip: 'idle', phase: 0.58, label: '站立重心变化' },
  walk: { clip: 'walk', phase: 0.24, duration: 0.9666666388511658, loopable: true, label: '行走' },
  walk_contact_a: { clip: 'walk', phase: 0.04, label: '行走接触步 A' },
  walk_pass_a: { clip: 'walk', phase: 0.26, label: '行走跨步 A' },
  walk_contact_b: { clip: 'walk', phase: 0.52, label: '行走接触步 B' },
  walk_pass_b: { clip: 'walk', phase: 0.76, label: '行走跨步 B' },
  run: { clip: 'run', phase: 0.24, duration: 0.699999988079071, loopable: true, label: '奔跑' },
  run_push_a: { clip: 'run', phase: 0.05, label: '跑步蹬地 A' },
  run_air_a: { clip: 'run', phase: 0.26, label: '跑步腾空 A' },
  run_push_b: { clip: 'run', phase: 0.55, label: '跑步蹬地 B' },
  run_air_b: { clip: 'run', phase: 0.78, label: '跑步腾空 B' },
  sad_pose: { clip: 'sad_pose', phase: 1, label: '低头含胸（仅身体）' },
  agree: { clip: 'agree', phase: 0.48, duration: 1.8333333730697632, loopable: true, label: '点头动作（头颈）' },
  nod_down: { clip: 'agree', phase: 0.36, label: '点头低位' },
  nod_up: { clip: 'agree', phase: 0.72, label: '点头回正' },
  headShake: { clip: 'headShake', phase: 0.48, duration: 2.566666603088379, loopable: true, label: '摇头动作（头颈）' },
  shake_left: { clip: 'headShake', phase: 0.26, label: '摇头左侧' },
  shake_right: { clip: 'headShake', phase: 0.74, label: '摇头右侧' },
  crouch: { clip: 'squat', phase: 0.35, label: '半蹲', joints: HALF_SQUAT_JOINTS },
  squat_full: { clip: 'squat', phase: 0.23, label: '全蹲', root: [0, 0.14062522694349022, 0], joints: FULL_SQUAT_JOINTS },
  sit_prepare: { clip: 'sit', phase: 0.2, label: '坐下准备' },
  sit_low: { clip: 'sit', phase: 0.62, label: '半坐' },
  sit: { clip: 'sit', phase: 1, label: '自然坐姿（需配椅子）' },
  wave: { clip: 'wave', phase: 0.48, duration: 1.8333333730697632, loopable: true, label: '招手' },
  tpose: { clip: null, phase: 0, label: 'T 型绑定姿态（官方骨架）' },
}

const LEGACY_PRESET_MAP = {
  crouch_half: 'crouch',
  wave_raise: 'wave', wave_hold: 'wave', thumbs_up: 'idle',
  relax: 'stand_relaxed', sit: 'sit', kneel: 'crouch', stretch: 'idle', lie: 'idle', sneak_pose: 'crouch',
  fight: 'idle', punch: 'run', kick: 'run', pull: 'idle', push: 'idle', crouch: 'crouch',
  sprint: 'run', jump: 'run', jumpAir: 'run', lunge: 'idle', balance: 'idle', landing: 'idle',
  vault: 'run', handstand: 'tpose', onehand: 'tpose', roll: 'idle', crawl: 'idle',
  plank: 'tpose', hang: 'tpose', reach: 'idle', wave: 'wave', custom: 'idle',
}

export function normalizePoseId(pose = 'idle') {
  return RIG_PRESETS[pose] ? pose : (LEGACY_PRESET_MAP[pose] || 'idle')
}

export function presetDefinition(pose = 'idle') {
  return RIG_PRESETS[normalizePoseId(pose)]
}

export function presetPhase(pose = 'idle') {
  return presetDefinition(pose).phase
}

export function poseCanLoop(pose = 'idle') {
  const preset = presetDefinition(pose)
  return Boolean(preset.loopable && preset.duration > 0)
}

export const RIG_PRESET_OPTIONS = Object.entries(RIG_PRESETS).map(([id, preset]) => [id, preset.label])

export const RIG_PRESET_GROUPS = [
  { label: '基础', poses: [['idle', '自然站立'], ['stand_relaxed', '放松站姿'], ['idle_shift', '重心变化'], ['tpose', 'T 型'], ['sad_pose', '低头含胸']] },
  { label: '日常姿势', poses: [['crouch', '半蹲'], ['squat_full', '全蹲'], ['sit_prepare', '坐下准备'], ['sit_low', '半坐'], ['sit', '自然坐姿'], ['wave', '招手循环']] },
  { label: '持续动作', poses: [['walk', '行走循环'], ['run', '奔跑循环'], ['agree', '点头循环'], ['headShake', '摇头循环']] },
  { label: '行走定格', poses: [['walk_contact_a', '接触步 A'], ['walk_pass_a', '跨步 A'], ['walk_contact_b', '接触步 B'], ['walk_pass_b', '跨步 B']] },
  { label: '跑步定格', poses: [['run_push_a', '蹬地 A'], ['run_air_a', '腾空 A'], ['run_push_b', '蹬地 B'], ['run_air_b', '腾空 B']] },
  { label: '头部定格', poses: [['nod_down', '点头低位'], ['nod_up', '点头回正'], ['shake_left', '摇头左侧'], ['shake_right', '摇头右侧']] },
]

const emptyPose = () => Object.fromEntries(JOINT_DEFINITIONS.map(joint => [joint.id, [0, 0, 0]]))

export function cloneJointPose(joints) {
  const result = emptyPose()
  for (const { id } of JOINT_DEFINITIONS) {
    const rotation = joints?.[id]
    if (Array.isArray(rotation) && rotation.length >= 3) result[id] = rotation.slice(0, 3).map(value => Number(value) || 0)
  }
  return result
}

export function poseForObject(object) {
  return {
    root: Array.isArray(object?.rigRoot) ? object.rigRoot.slice(0, 3) : [0, 0, 0],
    joints: cloneJointPose(object?.joints),
  }
}

export function presetJoints(pose = 'idle') {
  return cloneJointPose(presetDefinition(pose).joints)
}

export function presetRoot(pose = 'idle') {
  const root = presetDefinition(pose).root
  return Array.isArray(root) ? root.slice(0, 3).map(value => Number(value) || 0) : [0, 0, 0]
}

export function interpolateJointPose(left, right, amount) {
  const leftPose = cloneJointPose(left)
  const rightPose = cloneJointPose(right)
  return Object.fromEntries(JOINT_DEFINITIONS.map(({ id }) => [
    id,
    leftPose[id].map((value, index) => value + (rightPose[id][index] - value) * amount),
  ]))
}
