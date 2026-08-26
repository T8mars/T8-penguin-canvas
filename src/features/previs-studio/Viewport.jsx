import { Component, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { ContactShadows, Grid, OrbitControls, TransformControls, useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { poseForObject, presetDefinition } from './rig.js'

const CAMERA_ID = '__shot_camera__'
const BUILT_IN_MODEL_URL = `${import.meta.env.BASE_URL}previs-studio/models/xbot-animated.glb`
const whiteMaterial = { roughness: 0.78, metalness: 0.02 }

function JointSegment({ rotation = [0, 0, 0], length, startRadius, endRadius, jointRadius, color, selected, jointId, onSelectJoint, children }) {
  const markerColor = selected ? '#d6a84f' : color
  const limbProfile = useMemo(() => {
    const widest = Math.max(startRadius, endRadius)
    return [
      new THREE.Vector2(0, -length),
      new THREE.Vector2(endRadius * 0.82, -length),
      new THREE.Vector2(endRadius, -length * 0.94),
      new THREE.Vector2(endRadius * 1.08, -length * 0.78),
      new THREE.Vector2(widest * 1.08, -length * 0.5),
      new THREE.Vector2(startRadius * 1.07, -length * 0.2),
      new THREE.Vector2(startRadius * 0.9, -length * 0.035),
      new THREE.Vector2(0, 0),
    ]
  }, [endRadius, length, startRadius])
  return (
    <group rotation={rotation}>
      <mesh castShadow>
        <latheGeometry args={[limbProfile, 24]} />
        <meshStandardMaterial color={color} {...whiteMaterial} />
      </mesh>
      <mesh
        castShadow
        scale={selected ? 1.08 : 0.48}
        onPointerDown={jointId && onSelectJoint ? event => {
          event.stopPropagation()
          onSelectJoint(jointId)
        } : undefined}
      >
        <sphereGeometry args={[jointRadius, 18, 12]} />
        <meshStandardMaterial color={markerColor} {...whiteMaterial} />
      </mesh>
      {jointId && onSelectJoint && (
        <mesh onPointerDown={event => { event.stopPropagation(); onSelectJoint(jointId) }}>
          <sphereGeometry args={[jointRadius * 1.3, 10, 8]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      )}
      <group position={[0, -length, 0]}>{children}</group>
    </group>
  )
}
function AnatomicalTorso({ proportions, color, selected, onSelectJoint }) {
  const torsoProfile = useMemo(() => {
    const chest = proportions.chest
    const waist = proportions.waist
    return [
      new THREE.Vector2(0, 0.05),
      new THREE.Vector2(0.245 * waist, 0.05),
      new THREE.Vector2(0.275 * waist, 0.16),
      new THREE.Vector2(0.255 * waist, 0.29),
      new THREE.Vector2(0.31 * chest, 0.4),
      new THREE.Vector2(0.405 * chest, 0.53),
      new THREE.Vector2(0.43 * chest, 0.62),
      new THREE.Vector2(0.37 * chest, 0.7),
      new THREE.Vector2(0.205 * chest, 0.75),
      new THREE.Vector2(0, 0.75),
    ]
  }, [proportions.chest, proportions.waist])
  return (
    <mesh
      castShadow
      receiveShadow
      scale={[1, proportions.height, 0.64]}
      onPointerDown={event => { event.stopPropagation(); onSelectJoint?.('spine') }}
    >
      <latheGeometry args={[torsoProfile, 32]} />
      <meshStandardMaterial color={color} {...whiteMaterial} />
    </mesh>
  )
}

function RiggedArm({ side, shoulder, elbow, wrist, lengths, radii, color, selectedJoint, onSelectJoint }) {
  const direction = side === 'left' ? -1 : 1
  const shoulderId = `${side}Shoulder`
  const elbowId = `${side}Elbow`
  const wristId = `${side}Wrist`
  return (
    <group position={[direction * lengths.shoulderX, lengths.shoulderY, 0]}>
      <mesh castShadow scale={[radii.upper * 1.32, radii.upper * 1.12, radii.upper * 1.18]} onPointerDown={event => { event.stopPropagation(); onSelectJoint?.(shoulderId) }}>
        <sphereGeometry args={[1, 18, 12]} />
        <meshStandardMaterial color={selectedJoint === shoulderId ? '#d6a84f' : color} {...whiteMaterial} />
      </mesh>
      <JointSegment rotation={shoulder} length={lengths.upperArm} startRadius={radii.upper} endRadius={radii.elbow} jointRadius={radii.upper * 0.72} color={color} selected={selectedJoint === shoulderId} jointId={shoulderId} onSelectJoint={onSelectJoint}>
        <JointSegment rotation={elbow} length={lengths.lowerArm} startRadius={radii.forearm} endRadius={radii.wrist} jointRadius={radii.elbow * 0.9} color={color} selected={selectedJoint === elbowId} jointId={elbowId} onSelectJoint={onSelectJoint}>
          <group rotation={wrist}>
            <mesh
              castShadow
              position={[0, -lengths.hand * 0.46, lengths.hand * 0.04]}
              scale={[radii.handWidth, lengths.hand * 0.5, radii.handDepth]}
              onPointerDown={event => {
                event.stopPropagation()
                onSelectJoint?.(wristId)
              }}
            >
              <sphereGeometry args={[1, 18, 12]} />
              <meshStandardMaterial color={color} {...whiteMaterial} />
            </mesh>
            <mesh castShadow scale={selectedJoint === wristId ? 1.08 : 1} onPointerDown={event => { event.stopPropagation(); onSelectJoint?.(wristId) }}><sphereGeometry args={[radii.wrist * 0.9, 14, 10]} /><meshStandardMaterial color={selectedJoint === wristId ? '#d6a84f' : color} {...whiteMaterial} /></mesh>
            <mesh castShadow position={[direction * radii.handWidth * 0.78, -lengths.hand * 0.27, radii.handDepth * 0.55]} rotation={[0.15, 0, direction * -0.42]} scale={[radii.handWidth * 0.28, lengths.hand * 0.26, radii.handDepth * 0.38]}>
              <sphereGeometry args={[1, 12, 8]} />
              <meshStandardMaterial color={color} {...whiteMaterial} />
            </mesh>
          </group>
        </JointSegment>
      </JointSegment>
    </group>
  )
}

function RiggedLeg({ side, hip, knee, ankle, lengths, radii, color, selectedJoint, onSelectJoint }) {
  const direction = side === 'left' ? -1 : 1
  const hipId = `${side}Hip`
  const kneeId = `${side}Knee`
  const ankleId = `${side}Ankle`
  return (
    <group position={[direction * lengths.hipX, 0, 0]}>
      <JointSegment rotation={hip} length={lengths.upperLeg} startRadius={radii.thigh} endRadius={radii.knee} jointRadius={radii.thigh * 0.7} color={color} selected={selectedJoint === hipId} jointId={hipId} onSelectJoint={onSelectJoint}>
        <JointSegment rotation={knee} length={lengths.lowerLeg} startRadius={radii.calf} endRadius={radii.ankle} jointRadius={radii.knee * 0.92} color={color} selected={selectedJoint === kneeId} jointId={kneeId} onSelectJoint={onSelectJoint}>
          <group rotation={ankle}>
            <mesh castShadow position={[0, -radii.ankle * 0.32, lengths.foot * 0.42]} rotation={[Math.PI / 2, 0, 0]} scale={[1, 1, 0.82]} onPointerDown={event => { event.stopPropagation(); onSelectJoint?.(ankleId) }}>
              <capsuleGeometry args={[radii.footWidth, Math.max(0.04, lengths.foot - radii.footWidth * 2), 6, 16]} />
              <meshStandardMaterial color={color} {...whiteMaterial} />
            </mesh>
            <mesh castShadow scale={selectedJoint === ankleId ? 1.08 : 1} onPointerDown={event => { event.stopPropagation(); onSelectJoint?.(ankleId) }}><sphereGeometry args={[radii.ankle * 0.94, 14, 10]} /><meshStandardMaterial color={selectedJoint === ankleId ? '#d6a84f' : color} {...whiteMaterial} /></mesh>
          </group>
        </JointSegment>
      </JointSegment>
    </group>
  )
}

function PersonModel({ bodyType = 'standard', pose = 'idle', rigRoot, joints, color = '#e8e3d8', selected = false, selectedJoint, onSelectJoint }) {
  const proportions = {
    standard: { height: 1, shoulder: 1, chest: 1, waist: 1, hip: 1, limb: 1, head: 1 },
    tall: { height: 1.14, shoulder: 0.92, chest: 0.92, waist: 0.9, hip: 0.94, limb: 0.94, head: 0.94 },
    broad: { height: 1.03, shoulder: 1.28, chest: 1.22, waist: 1.12, hip: 1.08, limb: 1.16, head: 1.04 },
    female: { height: 0.98, shoulder: 0.9, chest: 0.98, waist: 0.84, hip: 1.16, limb: 0.9, head: 0.98 },
    male: { height: 1.06, shoulder: 1.16, chest: 1.14, waist: 1.02, hip: 1, limb: 1.08, head: 1 },
  }[bodyType] || { height: 1, shoulder: 1, chest: 1, waist: 1, hip: 1, limb: 1, head: 1 }
  const rig = poseForObject({ pose, rigRoot, joints })
  const joint = name => rig.joints[name]
  const bodyColor = color
  const lengths = {
    pelvisY: 1.07 * proportions.height,
    shoulderX: 0.41 * proportions.shoulder,
    shoulderY: 0.61 * proportions.height,
    hipX: 0.17 * proportions.hip,
    upperArm: 0.39 * proportions.height,
    lowerArm: 0.35 * proportions.height,
    hand: 0.18 * proportions.height,
    upperLeg: 0.55 * proportions.height,
    lowerLeg: 0.52 * proportions.height,
    foot: 0.27 * proportions.height,
  }
  const armRadii = {
    upper: 0.118 * proportions.limb, elbow: 0.082 * proportions.limb,
    forearm: 0.096 * proportions.limb, wrist: 0.064 * proportions.limb,
    handWidth: 0.096 * proportions.limb, handDepth: 0.05 * proportions.limb,
  }
  const legRadii = {
    thigh: 0.172 * proportions.limb, knee: 0.112 * proportions.limb,
    calf: 0.135 * proportions.limb, ankle: 0.076 * proportions.limb,
    footWidth: 0.1 * proportions.limb,
  }
  return (
    <group position={[rig.root[0], lengths.pelvisY + rig.root[1], rig.root[2]]} rotation={joint('pelvis')}>
      <mesh castShadow position={[0, 0.015, -0.01]} scale={[0.31 * proportions.hip, 0.19 * proportions.height, 0.23]} onPointerDown={event => { event.stopPropagation(); onSelectJoint?.('pelvis') }}>
        <sphereGeometry args={[1, 24, 16]} />
        <meshStandardMaterial color={bodyColor} {...whiteMaterial} />
      </mesh>
      <mesh castShadow position={[-0.155 * proportions.hip, -0.035, -0.015]} scale={[0.19 * proportions.hip, 0.19 * proportions.height, 0.22]} onPointerDown={event => { event.stopPropagation(); onSelectJoint?.('pelvis') }}>
        <sphereGeometry args={[1, 20, 14]} />
        <meshStandardMaterial color={bodyColor} {...whiteMaterial} />
      </mesh>
      <mesh castShadow position={[0.155 * proportions.hip, -0.035, -0.015]} scale={[0.19 * proportions.hip, 0.19 * proportions.height, 0.22]} onPointerDown={event => { event.stopPropagation(); onSelectJoint?.('pelvis') }}>
        <sphereGeometry args={[1, 20, 14]} />
        <meshStandardMaterial color={bodyColor} {...whiteMaterial} />
      </mesh>
      <mesh castShadow scale={selected && selectedJoint === 'pelvis' ? 1.12 : 1} onPointerDown={event => { event.stopPropagation(); onSelectJoint?.('pelvis') }}><sphereGeometry args={[0.07, 14, 10]} /><meshStandardMaterial color={selected && selectedJoint === 'pelvis' ? '#d6a84f' : bodyColor} {...whiteMaterial} /></mesh>
      <group rotation={joint('spine')}>
        <AnatomicalTorso proportions={proportions} color={bodyColor} selected={selected && selectedJoint === 'spine'} onSelectJoint={onSelectJoint} />
        <mesh castShadow position={[0, lengths.shoulderY - 0.015, 0]} scale={[lengths.shoulderX + 0.105, 0.115 * proportions.height, 0.22]} onPointerDown={event => { event.stopPropagation(); onSelectJoint?.('spine') }}>
          <sphereGeometry args={[1, 24, 14]} />
          <meshStandardMaterial color={bodyColor} {...whiteMaterial} />
        </mesh>
        {selected && selectedJoint === 'spine' && <mesh position={[0, 0.3 * proportions.height, -0.215]}><sphereGeometry args={[0.065, 14, 10]} /><meshStandardMaterial color="#d6a84f" {...whiteMaterial} /></mesh>}
        <group position={[0, 0.79 * proportions.height, 0]} rotation={joint('neck')}>
          <mesh castShadow position={[0, 0.055, 0]} scale={[0.09, 0.14, 0.085]} onPointerDown={event => { event.stopPropagation(); onSelectJoint?.('neck') }}><cylinderGeometry args={[1, 0.88, 1, 18]} /><meshStandardMaterial color={selected && selectedJoint === 'neck' ? '#d6a84f' : bodyColor} {...whiteMaterial} /></mesh>
          <group position={[0, 0.275 * proportions.head, 0]} onPointerDown={event => { event.stopPropagation(); onSelectJoint?.('neck') }}>
            <mesh castShadow position={[0, 0.045, 0]} scale={[0.18 * proportions.head, 0.235 * proportions.head, 0.175 * proportions.head]}>
              <sphereGeometry args={[1, 28, 20]} />
              <meshStandardMaterial color={bodyColor} {...whiteMaterial} />
            </mesh>
            <mesh castShadow position={[0, -0.095 * proportions.head, -0.012]} scale={[0.145 * proportions.head, 0.14 * proportions.head, 0.145 * proportions.head]}>
              <sphereGeometry args={[1, 24, 16]} />
              <meshStandardMaterial color={bodyColor} {...whiteMaterial} />
            </mesh>
            <mesh castShadow position={[0, -0.005 * proportions.head, 0.17 * proportions.head]} scale={[0.045 * proportions.head, 0.065 * proportions.head, 0.07 * proportions.head]}>
              <sphereGeometry args={[1, 16, 10]} />
              <meshStandardMaterial color={bodyColor} {...whiteMaterial} />
            </mesh>
            <mesh castShadow position={[-0.175 * proportions.head, 0, 0]} scale={[0.028, 0.065, 0.035]}><sphereGeometry args={[1, 12, 8]} /><meshStandardMaterial color={bodyColor} {...whiteMaterial} /></mesh>
            <mesh castShadow position={[0.175 * proportions.head, 0, 0]} scale={[0.028, 0.065, 0.035]}><sphereGeometry args={[1, 12, 8]} /><meshStandardMaterial color={bodyColor} {...whiteMaterial} /></mesh>
          </group>
        </group>
        <RiggedArm side="left" shoulder={joint('leftShoulder')} elbow={joint('leftElbow')} wrist={joint('leftWrist')} lengths={lengths} radii={armRadii} color={bodyColor} selectedJoint={selected ? selectedJoint : null} onSelectJoint={onSelectJoint} />
        <RiggedArm side="right" shoulder={joint('rightShoulder')} elbow={joint('rightElbow')} wrist={joint('rightWrist')} lengths={lengths} radii={armRadii} color={bodyColor} selectedJoint={selected ? selectedJoint : null} onSelectJoint={onSelectJoint} />
      </group>
      <RiggedLeg side="left" hip={joint('leftHip')} knee={joint('leftKnee')} ankle={joint('leftAnkle')} lengths={lengths} radii={legRadii} color={bodyColor} selectedJoint={selected ? selectedJoint : null} onSelectJoint={onSelectJoint} />
      <RiggedLeg side="right" hip={joint('rightHip')} knee={joint('rightKnee')} ankle={joint('rightAnkle')} lengths={lengths} radii={legRadii} color={bodyColor} selectedJoint={selected ? selectedJoint : null} onSelectJoint={onSelectJoint} />
    </group>
  )
}

const MIXAMO_BODY_SCALES = {
  standard: [1, 1, 1],
  tall: [0.95, 1.12, 0.95],
  broad: [1.14, 1.04, 1.1],
  female: [0.94, 0.98, 0.94],
  male: [1.08, 1.06, 1.08],
}

function dominantBoneNameFromHit(event) {
  const mesh = event.object
  const face = event.face
  const skinIndex = mesh?.geometry?.attributes?.skinIndex
  const skinWeight = mesh?.geometry?.attributes?.skinWeight
  const skeleton = mesh?.skeleton
  if (!mesh?.isSkinnedMesh || !face || !skinIndex || !skinWeight || !skeleton) return null

  const scores = new Map()
  for (const vertex of [face.a, face.b, face.c]) {
    for (let channel = 0; channel < 4; channel += 1) {
      const index = skinIndex.getComponent(vertex, channel)
      const weight = skinWeight.getComponent(vertex, channel)
      if (weight > 0) scores.set(index, (scores.get(index) || 0) + weight)
    }
  }
  let bestIndex = -1
  let bestScore = -1
  for (const [index, score] of scores) {
    if (score > bestScore) {
      bestIndex = index
      bestScore = score
    }
  }
  return skeleton.bones[bestIndex]?.name || null
}

const IK_CHAINS = {
  mixamorigLeftHand: ['mixamorigLeftForeArm', 'mixamorigLeftArm'],
  mixamorigRightHand: ['mixamorigRightForeArm', 'mixamorigRightArm'],
  mixamorigLeftFoot: ['mixamorigLeftLeg', 'mixamorigLeftUpLeg'],
  mixamorigRightFoot: ['mixamorigRightLeg', 'mixamorigRightUpLeg'],
}

function ikEffectorForJoint(jointId = '') {
  if (jointId.startsWith('mixamorigLeftHand')) return 'mixamorigLeftHand'
  if (jointId.startsWith('mixamorigRightHand')) return 'mixamorigRightHand'
  if (jointId.startsWith('mixamorigLeftFoot') || jointId.startsWith('mixamorigLeftToe')) return 'mixamorigLeftFoot'
  if (jointId.startsWith('mixamorigRightFoot') || jointId.startsWith('mixamorigRightToe')) return 'mixamorigRightFoot'
  return null
}

function MixamoJointMarker({ bone, jointId, selected, modelRoot, onSelectJoint, onBeginDrag, onDrag, onEndDrag }) {
  const markerRef = useRef(null)
  const worldPosition = useMemo(() => new THREE.Vector3(), [])
  const isFineBone = /Hand|Eye|End/.test(jointId)
  useFrame(() => {
    if (!bone || !markerRef.current || !modelRoot.current) return
    bone.getWorldPosition(worldPosition)
    modelRoot.current.worldToLocal(worldPosition)
    markerRef.current.position.copy(worldPosition)
  })
  return (
    <mesh
      ref={markerRef}
      scale={selected ? 1.25 : 0.72}
      onPointerDown={event => {
        if (onBeginDrag?.(event, jointId)) return
        event.stopPropagation()
        onSelectJoint?.(jointId)
      }}
      onPointerMove={onDrag}
      onPointerUp={onEndDrag}
      onPointerCancel={onEndDrag}
      renderOrder={8}
    >
      <sphereGeometry args={[isFineBone ? 0.012 : 0.022, 12, 8]} />
      <meshBasicMaterial color={selected ? '#ffd469' : '#bf9948'} transparent opacity={selected ? 0.98 : 0.28} depthTest={false} />
    </mesh>
  )
}

function MixamoIKHandle({ bone, jointId, selected, modelRoot, onBeginDrag, onDrag, onEndDrag }) {
  const markerRef = useRef(null)
  const worldPosition = useMemo(() => new THREE.Vector3(), [])
  useFrame(() => {
    if (!bone || !markerRef.current || !modelRoot.current) return
    bone.getWorldPosition(worldPosition)
    modelRoot.current.worldToLocal(worldPosition)
    markerRef.current.position.copy(worldPosition)
  })
  return (
    <group
      ref={markerRef}
      onPointerDown={event => onBeginDrag?.(event, jointId)}
      onPointerMove={onDrag}
      onPointerUp={onEndDrag}
      onPointerCancel={onEndDrag}
    >
      <mesh
        scale={selected ? 1.18 : 1}
        renderOrder={10}
      >
        <octahedronGeometry args={[0.055, 0]} />
        <meshBasicMaterial color={selected ? '#8ee6d0' : '#55bca9'} transparent opacity={0.96} depthTest={false} />
      </mesh>
      <mesh renderOrder={9}>
        <sphereGeometry args={[0.09, 12, 8]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  )
}

function MixamoPersonModel({ bodyType = 'standard', pose = 'idle', poseTime, continuousMotion = false, animationTime = 0, rigRoot, joints, footLock = false, color = '#e8e3d8', selected = false, selectedJoint, onSelectJoint, onRotateJoint, onRotateJoints, showBoneGizmo = false, onSurfacePointerDown, onSurfacePointerMove, onSurfacePointerUp }) {
  const gltf = useGLTF(BUILT_IN_MODEL_URL)
  const orbitControls = useThree(state => state.controls)
  const camera = useThree(state => state.camera)
  const viewportSize = useThree(state => state.size)
  const modelRoot = useRef(null)
  const rig = poseForObject({ pose, rigRoot, joints })
  const sampledRotations = useRef(new WeakMap())
  const boneDrag = useRef(null)
  const { scene, bones, bindTransforms, materials, mixer, clips } = useMemo(() => {
    const cloned = skeletonClone(gltf.scene)
    const nextBones = {}
    const nextBindTransforms = new WeakMap()
    const nextMaterials = []

    cloned.traverse(child => {
      if (child.isBone) {
        nextBones[child.name] = child
        nextBindTransforms.set(child, {
          position: child.position.clone(),
          quaternion: child.quaternion.clone(),
          scale: child.scale.clone(),
        })
      }
      if (child.isMesh) {
        child.castShadow = true
        child.receiveShadow = true
        child.frustumCulled = false
        const material = new THREE.MeshStandardMaterial({ color, roughness: 0.78, metalness: 0.02 })
        child.material = material
        nextMaterials.push(material)
      }
    })

    return {
      scene: cloned,
      bones: nextBones,
      bindTransforms: nextBindTransforms,
      materials: nextMaterials,
      mixer: new THREE.AnimationMixer(cloned),
      clips: Object.fromEntries(gltf.animations.map(clip => [clip.name, clip])),
    }
  }, [gltf])

  useLayoutEffect(() => {
    mixer.stopAllAction()
    for (const bone of Object.values(bones)) {
      const bind = bindTransforms.get(bone)
      if (!bind) continue
      bone.position.copy(bind.position)
      bone.quaternion.copy(bind.quaternion)
      bone.scale.copy(bind.scale)
    }
    scene.updateMatrixWorld(true)

    const preset = presetDefinition(pose)
    const clip = preset.clip ? clips[preset.clip] : null
    if (clip) {
      const action = mixer.clipAction(clip)
      action.reset().setLoop(THREE.LoopOnce, 0)
      action.clampWhenFinished = true
      action.play()
      const basePhase = THREE.MathUtils.clamp(Number.isFinite(poseTime) ? poseTime : preset.phase, 0, 1)
      const phase = continuousMotion && preset.loopable && preset.duration > 0
        ? ((basePhase + animationTime / preset.duration) % 1 + 1) % 1
        : basePhase
      mixer.setTime(clip.duration * phase)
    }

    const nextSampled = new WeakMap()
    const deltaEuler = new THREE.Euler()
    const deltaQuaternion = new THREE.Quaternion()
    for (const [jointId, bone] of Object.entries(bones)) {
      nextSampled.set(bone, bone.quaternion.clone())
      const rotation = rig.joints[jointId]
      if (!rotation) continue
      deltaEuler.set(rotation[0] || 0, rotation[1] || 0, rotation[2] || 0, 'XYZ')
      deltaQuaternion.setFromEuler(deltaEuler)
      bone.quaternion.multiply(deltaQuaternion).normalize()
    }
    sampledRotations.current = nextSampled
    scene.updateMatrixWorld(true)
  }, [animationTime, bindTransforms, bones, clips, continuousMotion, mixer, pose, poseTime, rig.joints, scene])

  useLayoutEffect(() => {
    const bodyColor = new THREE.Color(color)
    const selectionGlow = new THREE.Color('#4b3511')
    for (const material of materials) {
      material.color.copy(bodyColor)
      material.emissive.copy(selectionGlow)
      material.emissiveIntensity = selected ? 0.16 : 0
      material.needsUpdate = true
    }
  }, [color, materials, selected])

  useEffect(() => () => {
    mixer.stopAllAction()
    mixer.uncacheRoot(scene)
    materials.forEach(material => material.dispose())
  }, [materials, mixer, scene])

  const beginIKDrag = useCallback((event, jointId) => {
    const effectorId = ikEffectorForJoint(jointId)
    const chainIds = IK_CHAINS[effectorId]
    const effector = bones[effectorId]
    if (!selected || !showBoneGizmo || !onRotateJoints || !effector || !chainIds?.every(id => bones[id])) return false
    event.stopPropagation()
    event.nativeEvent?.stopImmediatePropagation?.()
    event.target?.setPointerCapture?.(event.pointerId)
    onSelectJoint?.(effectorId)
    scene.updateMatrixWorld(true)
    const startTarget = effector.getWorldPosition(new THREE.Vector3())
    const distance = Math.max(0.5, camera.position.distanceTo(startTarget))
    const fov = THREE.MathUtils.degToRad(camera.fov || 42)
    const worldPerPixel = 2 * Math.tan(fov / 2) * distance / Math.max(1, viewportSize.height)
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize()
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1).normalize()
    boneDrag.current = {
      kind: 'ik',
      pointerId: event.pointerId,
      jointId: effectorId,
      chainIds,
      startX: event.clientX,
      startY: event.clientY,
      startTarget,
      worldPerPixel,
      right,
      up,
      lockHeight: footLock && effectorId.includes('Foot'),
      startQuaternions: Object.fromEntries(chainIds.map(id => [id, bones[id].quaternion.clone()])),
    }
    if (orbitControls) orbitControls.enabled = false
    document.body.style.cursor = 'grabbing'
    return true
  }, [bones, camera, footLock, onRotateJoints, onSelectJoint, orbitControls, scene, selected, showBoneGizmo, viewportSize.height])

  const beginBoneDrag = useCallback((event, jointId) => {
    if (ikEffectorForJoint(jointId) && beginIKDrag(event, jointId)) return true
    if (!selected || !showBoneGizmo || !onRotateJoint || !bones[jointId]) return false
    event.stopPropagation()
    event.nativeEvent?.stopImmediatePropagation?.()
    event.target?.setPointerCapture?.(event.pointerId)
    onSelectJoint?.(jointId)
    const startRotation = rig.joints[jointId] || [0, 0, 0]
    boneDrag.current = {
      kind: 'joint', pointerId: event.pointerId,
      jointId,
      startX: event.clientX,
      startY: event.clientY,
      startRotation: [...startRotation],
      nextRotation: [...startRotation],
    }
    if (orbitControls) orbitControls.enabled = false
    document.body.style.cursor = 'grabbing'
    return true
  }, [beginIKDrag, bones, onRotateJoint, onSelectJoint, orbitControls, rig.joints, selected, showBoneGizmo])

  const dragBone = useCallback(event => {
    const drag = boneDrag.current
    if (!drag || event.pointerId !== drag.pointerId) return
    event.stopPropagation()
    if (drag.kind === 'ik') {
      for (const jointId of drag.chainIds) bones[jointId].quaternion.copy(drag.startQuaternions[jointId])
      scene.updateMatrixWorld(true)
      const dx = event.clientX - drag.startX
      const dy = event.clientY - drag.startY
      const target = drag.startTarget.clone()
        .addScaledVector(drag.right, dx * drag.worldPerPixel)
        .addScaledVector(drag.up, -dy * drag.worldPerPixel)
      if (drag.lockHeight) target.y = drag.startTarget.y

      const effector = bones[drag.jointId]
      const jointPosition = new THREE.Vector3()
      const endPosition = new THREE.Vector3()
      const currentDirection = new THREE.Vector3()
      const targetDirection = new THREE.Vector3()
      const parentWorld = new THREE.Quaternion()
      const worldDelta = new THREE.Quaternion()
      const localDelta = new THREE.Quaternion()
      for (let iteration = 0; iteration < 10; iteration += 1) {
        for (const jointId of drag.chainIds) {
          const joint = bones[jointId]
          joint.getWorldPosition(jointPosition)
          effector.getWorldPosition(endPosition)
          currentDirection.copy(endPosition).sub(jointPosition)
          targetDirection.copy(target).sub(jointPosition)
          if (currentDirection.lengthSq() < 1e-8 || targetDirection.lengthSq() < 1e-8) continue
          currentDirection.normalize()
          targetDirection.normalize()
          worldDelta.setFromUnitVectors(currentDirection, targetDirection)
          joint.parent.getWorldQuaternion(parentWorld)
          localDelta.copy(parentWorld).invert().multiply(worldDelta).multiply(parentWorld)
          joint.quaternion.premultiply(localDelta).normalize()
          scene.updateMatrixWorld(true)
        }
        effector.getWorldPosition(endPosition)
        if (endPosition.distanceToSquared(target) < 0.000025) break
      }
      return
    }
    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    const twist = Boolean(event.shiftKey || event.nativeEvent?.shiftKey)
    const nextRotation = twist
      ? [drag.startRotation[0], drag.startRotation[1], drag.startRotation[2] + dx * 0.012]
      : [drag.startRotation[0] - dy * 0.012, drag.startRotation[1] + dx * 0.012, drag.startRotation[2]]
    const bone = bones[drag.jointId]
    const sampled = sampledRotations.current.get(bone)
    if (!bone || !sampled) return
    const delta = new THREE.Quaternion().setFromEuler(new THREE.Euler(...nextRotation, 'XYZ'))
    bone.quaternion.copy(sampled).multiply(delta).normalize()
    scene.updateMatrixWorld(true)
    drag.nextRotation = nextRotation
  }, [bones, scene])

  const endBoneDrag = useCallback(event => {
    const drag = boneDrag.current
    if (!drag || event.pointerId !== drag.pointerId) return
    event.stopPropagation()
    event.target?.releasePointerCapture?.(event.pointerId)
    boneDrag.current = null
    if (orbitControls) orbitControls.enabled = true
    document.body.style.cursor = ''
    if (drag.kind === 'ik') {
      const rotations = {}
      const inverseSampled = new THREE.Quaternion()
      const delta = new THREE.Quaternion()
      const euler = new THREE.Euler()
      for (const jointId of drag.chainIds) {
        const bone = bones[jointId]
        const sampled = sampledRotations.current.get(bone)
        if (!sampled) continue
        inverseSampled.copy(sampled).invert()
        delta.copy(inverseSampled).multiply(bone.quaternion).normalize()
        euler.setFromQuaternion(delta, 'XYZ')
        rotations[jointId] = [euler.x, euler.y, euler.z]
      }
      onRotateJoints?.(rotations)
    } else {
      onRotateJoint?.(drag.jointId, drag.nextRotation)
    }
  }, [bones, onRotateJoint, onRotateJoints, orbitControls])

  const beginBoneDragFromSurface = useCallback(event => {
    if (!selected || !showBoneGizmo) return
    const jointId = dominantBoneNameFromHit(event)
    if (jointId) beginBoneDrag(event, jointId)
  }, [beginBoneDrag, selected, showBoneGizmo])

  const handleSurfacePointerDown = useCallback(event => {
    if (showBoneGizmo) beginBoneDragFromSurface(event)
    else onSurfacePointerDown?.(event)
  }, [beginBoneDragFromSurface, onSurfacePointerDown, showBoneGizmo])
  const handleSurfacePointerMove = useCallback(event => {
    if (showBoneGizmo) dragBone(event)
    else onSurfacePointerMove?.(event)
  }, [dragBone, onSurfacePointerMove, showBoneGizmo])
  const handleSurfacePointerUp = useCallback(event => {
    if (showBoneGizmo) endBoneDrag(event)
    else onSurfacePointerUp?.(event)
  }, [endBoneDrag, onSurfacePointerUp, showBoneGizmo])

  useEffect(() => () => {
    if (boneDrag.current) {
      document.body.style.cursor = ''
      if (orbitControls) orbitControls.enabled = true
    }
  }, [orbitControls])

  const scale = MIXAMO_BODY_SCALES[bodyType] || MIXAMO_BODY_SCALES.standard
  return (
    <group position={rig.root}>
      <group ref={modelRoot} scale={scale}>
        <primitive
          object={scene}
          onPointerDown={handleSurfacePointerDown}
          onPointerMove={handleSurfacePointerMove}
          onPointerUp={handleSurfacePointerUp}
          onPointerCancel={handleSurfacePointerUp}
        />
        {selected && showBoneGizmo && Object.entries(bones).map(([jointId, bone]) => (
          <MixamoJointMarker
            key={jointId}
            bone={bone}
            jointId={jointId}
            selected={selectedJoint === jointId}
            modelRoot={modelRoot}
            onSelectJoint={onSelectJoint}
            onBeginDrag={beginBoneDrag}
            onDrag={dragBone}
            onEndDrag={endBoneDrag}
          />
        ))}
        {selected && showBoneGizmo && Object.keys(IK_CHAINS).map(jointId => (
          <MixamoIKHandle
            key={`ik-${jointId}`}
            bone={bones[jointId]}
            jointId={jointId}
            selected={selectedJoint === jointId}
            modelRoot={modelRoot}
            onBeginDrag={beginIKDrag}
            onDrag={dragBone}
            onEndDrag={endBoneDrag}
          />
        ))}
      </group>
    </group>
  )
}

class ModelErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { failed: false }
  }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

function StudioPerson(props) {
  const fallback = <mesh position={[0, 0.9, 0]} castShadow><capsuleGeometry args={[0.28, 1.25, 8, 18]} /><meshStandardMaterial color={props.color || '#e8e3d8'} {...whiteMaterial} /></mesh>
  return (
    <ModelErrorBoundary fallback={fallback}>
      <Suspense fallback={fallback}>
        <MixamoPersonModel {...props} />
      </Suspense>
    </ModelErrorBoundary>
  )
}

function ImportedModel({ url, selected }) {
  const gltf = useGLTF(url)
  const scene = useMemo(() => skeletonClone(gltf.scene), [gltf.scene])
  useLayoutEffect(() => {
    scene.traverse(child => {
      if (child.isMesh) {
        child.castShadow = true
        child.receiveShadow = true
        if (selected && child.material) {
          child.material = child.material.clone()
          child.material.emissive = new THREE.Color('#312813')
          child.material.emissiveIntensity = 0.22
        }
      }
    })
  }, [scene, selected])
  return <primitive object={scene} />
}

function ArchPrimitive({ color }) {
  const shape = useMemo(() => {
    const outer = new THREE.Shape()
    outer.moveTo(-0.5, -0.5)
    outer.lineTo(0.5, -0.5)
    outer.lineTo(0.5, 0.5)
    outer.lineTo(-0.5, 0.5)
    outer.closePath()
    const opening = new THREE.Path()
    opening.moveTo(-0.29, -0.5)
    opening.lineTo(-0.29, -0.08)
    opening.absarc(0, -0.08, 0.29, Math.PI, 0, true)
    opening.lineTo(0.29, -0.5)
    opening.closePath()
    outer.holes.push(opening)
    return outer
  }, [])
  const settings = useMemo(() => ({ depth: 0.36, bevelEnabled: true, bevelSize: 0.018, bevelThickness: 0.018, bevelSegments: 2, curveSegments: 28 }), [])
  return (
    <mesh position={[0, 0, -0.18]} castShadow receiveShadow>
      <extrudeGeometry args={[shape, settings]} />
      <meshStandardMaterial color={color} {...whiteMaterial} />
    </mesh>
  )
}

function RoofPrimitive({ color }) {
  const shape = useMemo(() => {
    const triangle = new THREE.Shape()
    triangle.moveTo(-0.5, -0.5)
    triangle.lineTo(0.5, -0.5)
    triangle.lineTo(0, 0.5)
    triangle.closePath()
    return triangle
  }, [])
  const settings = useMemo(() => ({ depth: 1, bevelEnabled: false }), [])
  return <mesh position={[0, 0, -0.5]} castShadow receiveShadow><extrudeGeometry args={[shape, settings]} /><meshStandardMaterial color={color} {...whiteMaterial} /></mesh>
}

function SimplePart({ shape = 'box', color }) {
  if (shape === 'sphere') return <mesh castShadow receiveShadow><sphereGeometry args={[0.5, 20, 14]} /><meshStandardMaterial color={color} {...whiteMaterial} /></mesh>
  if (shape === 'cylinder') return <mesh castShadow receiveShadow><cylinderGeometry args={[0.5, 0.5, 1, 20]} /><meshStandardMaterial color={color} {...whiteMaterial} /></mesh>
  if (shape === 'arch') return <ArchPrimitive color={color} />
  return <mesh castShadow receiveShadow><boxGeometry args={[1, 1, 1]} /><meshStandardMaterial color={color} {...whiteMaterial} /></mesh>
}

function AssemblyModel({ parts = [], color }) {
  return (
    <group>
      {parts.map((part, index) => (
        <group
          key={index}
          position={part.position || [0, 0, 0]}
          rotation={(part.rotationDegrees || [0, 0, 0]).map(value => THREE.MathUtils.degToRad(value))}
          scale={part.scale || [1, 1, 1]}
        >
          <SimplePart shape={part.shape} color={color} />
        </group>
      ))}
    </group>
  )
}

function StairsModel({ color }) {
  const steps = 7
  return <group>{Array.from({ length: steps }, (_, index) => {
    const height = (index + 1) / steps
    return <group key={index} position={[0, -0.5 + height / 2, -0.5 + (index + 0.5) / steps]} scale={[1, height, 1 / steps]}><SimplePart color={color} /></group>
  })}</group>
}

function TableModel({ color }) {
  return <group><group position={[0, 0.34, 0]} scale={[1, 0.14, 0.82]}><SimplePart color={color} /></group>{[-0.41, 0.41].flatMap(x => [-0.31, 0.31].map(z => <group key={`${x}-${z}`} position={[x, -0.08, z]} scale={[0.1, 0.72, 0.1]}><SimplePart color={color} /></group>))}</group>
}

function ChairModel({ color }) {
  return <group><group position={[0, 0.02, 0]} scale={[0.82, 0.13, 0.78]}><SimplePart color={color} /></group><group position={[0, 0.3, 0.34]} scale={[0.82, 0.58, 0.12]}><SimplePart color={color} /></group>{[-0.32, 0.32].flatMap(x => [-0.29, 0.29].map(z => <group key={`${x}-${z}`} position={[x, -0.27, z]} scale={[0.09, 0.48, 0.09]}><SimplePart color={color} /></group>))}</group>
}

function SofaModel({ color }) {
  return <group><group position={[0, -0.17, 0]} scale={[1, 0.42, 0.82]}><SimplePart color={color} /></group><group position={[0, 0.22, 0.32]} rotation={[-0.12, 0, 0]} scale={[1, 0.62, 0.18]}><SimplePart color={color} /></group><group position={[-0.45, 0.08, 0]} scale={[0.12, 0.38, 0.82]}><SimplePart color={color} /></group><group position={[0.45, 0.08, 0]} scale={[0.12, 0.38, 0.82]}><SimplePart color={color} /></group></group>
}

function DoorModel({ color }) {
  return <group><group position={[-0.46, 0, 0]} scale={[0.09, 1, 0.16]}><SimplePart color={color} /></group><group position={[0.46, 0, 0]} scale={[0.09, 1, 0.16]}><SimplePart color={color} /></group><group position={[0, 0.46, 0]} scale={[0.92, 0.09, 0.16]}><SimplePart color={color} /></group><group position={[0, -0.02, 0]} scale={[0.78, 0.86, 0.07]}><SimplePart color={color} /></group><group position={[0.27, -0.02, -0.07]} scale={[0.045, 0.045, 0.045]}><SimplePart shape="sphere" color="#625c50" /></group></group>
}

function WindowModel({ color }) {
  return <group><group position={[-0.46, 0, 0]} scale={[0.08, 1, 0.14]}><SimplePart color={color} /></group><group position={[0.46, 0, 0]} scale={[0.08, 1, 0.14]}><SimplePart color={color} /></group><group position={[0, 0.46, 0]} scale={[1, 0.08, 0.14]}><SimplePart color={color} /></group><group position={[0, -0.46, 0]} scale={[1, 0.08, 0.14]}><SimplePart color={color} /></group><group scale={[0.06, 0.86, 0.08]}><SimplePart color={color} /></group><group scale={[0.86, 0.06, 0.08]}><SimplePart color={color} /></group></group>
}

function TreeModel({ color }) {
  return <group><group position={[0, -0.23, 0]} scale={[0.2, 0.55, 0.2]}><SimplePart shape="cylinder" color="#766b57" /></group><group position={[0, 0.2, 0]} scale={[0.78, 0.65, 0.78]}><SimplePart shape="sphere" color={color} /></group><group position={[-0.25, 0.04, 0.08]} scale={[0.48, 0.45, 0.48]}><SimplePart shape="sphere" color={color} /></group><group position={[0.25, 0.03, -0.08]} scale={[0.48, 0.43, 0.48]}><SimplePart shape="sphere" color={color} /></group></group>
}

function VehicleModel({ color }) {
  return <group><group position={[0, -0.08, 0]} scale={[1, 0.42, 0.78]}><SimplePart color={color} /></group><group position={[0.08, 0.22, -0.03]} scale={[0.52, 0.34, 0.66]}><SimplePart color={color} /></group>{[-0.34, 0.34].flatMap(x => [-0.32, 0.32].map(z => <group key={`${x}-${z}`} position={[x, -0.34, z]} rotation={[0, 0, Math.PI / 2]} scale={[0.22, 0.13, 0.22]}><SimplePart shape="cylinder" color="#343432" /></group>))}</group>
}

function PrimitiveModel({ type, color, selected, parts = [] }) {
  const materialColor = selected ? '#f3dba5' : color
  if (type === 'sphere') return <SimplePart shape="sphere" color={materialColor} />
  if (type === 'cylinder') return <SimplePart shape="cylinder" color={materialColor} />
  if (type === 'plane') return <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow><planeGeometry args={[1, 1]} /><meshStandardMaterial color={materialColor} roughness={0.9} side={THREE.DoubleSide} /></mesh>
  if (type === 'arch') return <ArchPrimitive color={materialColor} />
  if (type === 'stairs') return <StairsModel color={materialColor} />
  if (type === 'table') return <TableModel color={materialColor} />
  if (type === 'chair') return <ChairModel color={materialColor} />
  if (type === 'sofa') return <SofaModel color={materialColor} />
  if (type === 'door') return <DoorModel color={materialColor} />
  if (type === 'window') return <WindowModel color={materialColor} />
  if (type === 'tree') return <TreeModel color={materialColor} />
  if (type === 'vehicle') return <VehicleModel color={materialColor} />
  if (type === 'roof') return <RoofPrimitive color={materialColor} />
  if (type === 'assembly' && parts.length) return <AssemblyModel parts={parts} color={materialColor} />
  return <SimplePart color={materialColor} />
}

function smoothDepthValues(values, width, height, passes) {
  let current = values
  for (let pass = 0; pass < passes; pass += 1) {
    const next = new Float32Array(current.length)
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let sum = 0
        let count = 0
        for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
          for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
            const sampleX = x + offsetX
            const sampleY = y + offsetY
            if (sampleX >= 0 && sampleX < width && sampleY >= 0 && sampleY < height) {
              sum += current[sampleY * width + sampleX]
              count += 1
            }
          }
        }
        next[y * width + x] = sum / count
      }
    }
    current = next
  }
  return current
}

function DepthMeshModel({ url, settings = {}, color, selected }) {
  const [geometry, setGeometry] = useState(null)
  const invert = settings.invert ?? false
  const near = Math.max(0.05, Number(settings.near ?? 0.8))
  const far = Math.max(near + 0.1, Number(settings.far ?? 6))
  const fov = THREE.MathUtils.clamp(Number(settings.fov ?? 60), 20, 120)
  const density = THREE.MathUtils.clamp(Math.round(Number(settings.density ?? 64)), 16, 128)
  const smoothing = THREE.MathUtils.clamp(Math.round(Number(settings.smoothing ?? 1)), 0, 4)

  useEffect(() => {
    let cancelled = false
    const image = new Image()
    image.onload = () => {
      const imageAspect = image.width / Math.max(1, image.height)
      const columns = imageAspect >= 1 ? density : Math.max(16, Math.round(density * imageAspect))
      const rows = imageAspect >= 1 ? Math.max(16, Math.round(density / imageAspect)) : density
      const canvas = document.createElement('canvas')
      canvas.width = columns
      canvas.height = rows
      const context = canvas.getContext('2d', { willReadFrequently: true })
      context.drawImage(image, 0, 0, columns, rows)
      const pixels = context.getImageData(0, 0, columns, rows).data
      let depthValues = new Float32Array(columns * rows)
      for (let index = 0; index < depthValues.length; index += 1) {
        const pixel = index * 4
        depthValues[index] = (pixels[pixel] * 0.2126 + pixels[pixel + 1] * 0.7152 + pixels[pixel + 2] * 0.0722) / 255
      }
      depthValues = smoothDepthValues(depthValues, columns, rows, smoothing)

      const positions = new Float32Array(columns * rows * 3)
      const fieldOfView = THREE.MathUtils.degToRad(fov)
      for (let y = 0; y < rows; y += 1) {
        for (let x = 0; x < columns; x += 1) {
          const index = y * columns + x
          const normalizedDepth = invert ? 1 - depthValues[index] : depthValues[index]
          const distance = near + normalizedDepth * (far - near)
          const halfHeight = Math.tan(fieldOfView / 2) * distance
          const halfWidth = halfHeight * imageAspect
          positions[index * 3] = (x / Math.max(1, columns - 1) * 2 - 1) * halfWidth
          positions[index * 3 + 1] = (1 - y / Math.max(1, rows - 1) * 2) * halfHeight
          positions[index * 3 + 2] = -(distance - near)
        }
      }

      const indices = []
      for (let y = 0; y < rows - 1; y += 1) {
        for (let x = 0; x < columns - 1; x += 1) {
          const topLeft = y * columns + x
          const topRight = topLeft + 1
          const bottomLeft = topLeft + columns
          const bottomRight = bottomLeft + 1
          indices.push(topLeft, bottomLeft, topRight, topRight, bottomLeft, bottomRight)
        }
      }

      const nextGeometry = new THREE.BufferGeometry()
      nextGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
      nextGeometry.setIndex(indices)
      nextGeometry.computeVertexNormals()
      nextGeometry.computeBoundingBox()
      nextGeometry.computeBoundingSphere()
      if (!cancelled) setGeometry(nextGeometry)
      else nextGeometry.dispose()
    }
    image.src = url
    return () => { cancelled = true }
  }, [url, invert, near, far, fov, density, smoothing])

  useEffect(() => () => geometry?.dispose(), [geometry])

  if (!geometry) return <mesh><planeGeometry args={[2.5, 1.4, 10, 6]} /><meshStandardMaterial color="#7f7b72" wireframe /></mesh>
  return (
    <mesh geometry={geometry} castShadow receiveShadow={false}>
      <meshStandardMaterial color={selected ? '#f3dba5' : color || '#c9c4b8'} roughness={0.86} metalness={0.01} side={THREE.DoubleSide} />
    </mesh>
  )
}

function sceneObjectIdFromIntersection(intersection) {
  let object = intersection?.object
  while (object && !object.userData?.sceneObjectId) object = object.parent
  return object?.userData?.sceneObjectId || null
}

function shouldKeepCurrentSelection(event, selectedId, selected, transformMode) {
  if (selected || !selectedId) return false
  if (transformMode !== 'select') return true
  if (event.altKey || event.nativeEvent?.altKey) return false
  return event.intersections?.some(intersection => sceneObjectIdFromIntersection(intersection) === selectedId)
}

function SceneObject({ data, selected, selectedId, activeJoint, transformMode, transformSpace = 'world', snapEnabled = true, groundRequest, onSelect, onUpdate, onJointSelect, animationTime = 0, preview = false }) {
  const groupRef = useRef(null)
  const objectRotateDrag = useRef(null)
  const scaleTransformStart = useRef(null)
  const appliedGroundRequest = useRef(null)
  const orbitControls = useThree(state => state.controls)
  const scaleAxisLocks = Array.isArray(data.scaleAxisLocks) ? data.scaleAxisLocks : [false, false, false]
  const stateAnimationTime = Math.max(0, animationTime - (Number.isFinite(data.motionStartTime) ? data.motionStartTime : 0))
  useEffect(() => {
    if (!groundRequest || groundRequest.id !== data.id || !groupRef.current || data.locked || preview) return
    const requestKey = `${groundRequest.id}:${groundRequest.nonce}`
    if (appliedGroundRequest.current === requestKey) return
    const object = groupRef.current
    object.updateWorldMatrix(true, true)
    const bounds = new THREE.Box3().setFromObject(object)
    if (!Number.isFinite(bounds.min.y)) return
    appliedGroundRequest.current = requestKey
    object.position.y -= bounds.min.y
    onUpdate(data.id, { position: object.position.toArray() })
  }, [data.id, data.locked, groundRequest?.id, groundRequest?.nonce, onUpdate, preview])
  const syncTransform = useCallback(() => {
    const object = groupRef.current
    if (!object) return
    let nextScale = object.scale.toArray()
    if (transformMode === 'scale' && scaleTransformStart.current) {
      const baseline = scaleTransformStart.current
      const locks = Array.isArray(data.scaleAxisLocks) ? data.scaleAxisLocks : [false, false, false]
      if (data.proportionalScale) {
        const changedAxis = nextScale
          .map((value, axis) => ({ axis, change: locks[axis] ? -1 : Math.abs(value / Math.max(0.0001, baseline[axis]) - 1) }))
          .sort((left, right) => right.change - left.change)[0]
        const factor = changedAxis?.change > 0.00001 ? nextScale[changedAxis.axis] / Math.max(0.0001, baseline[changedAxis.axis]) : 1
        nextScale = baseline.map((value, axis) => locks[axis] ? value : Math.max(0.05, value * factor))
      } else nextScale = nextScale.map((value, axis) => locks[axis] ? baseline[axis] : Math.max(0.05, value))
      object.scale.fromArray(nextScale)
    }
    onUpdate(data.id, {
      position: object.position.toArray(),
      rotation: [object.rotation.x, object.rotation.y, object.rotation.z],
      scale: nextScale,
    })
  }, [data.id, data.proportionalScale, data.scaleAxisLocks, onUpdate, transformMode])
  const beginObjectInteraction = useCallback(event => {
    if (shouldKeepCurrentSelection(event, selectedId, selected, transformMode)) return
    event.stopPropagation()
    onSelect(data.id)
    if (data.locked) return
    if (!selected || transformMode !== 'rotate' || !groupRef.current) return
    event.nativeEvent?.stopImmediatePropagation?.()
    event.target?.setPointerCapture?.(event.pointerId)
    objectRotateDrag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      rotation: [groupRef.current.rotation.x, groupRef.current.rotation.y, groupRef.current.rotation.z],
    }
    if (orbitControls) orbitControls.enabled = false
    document.body.style.cursor = 'grabbing'
  }, [data.id, data.locked, onSelect, orbitControls, selected, selectedId, transformMode])
  const rotateObjectFromSurface = useCallback(event => {
    const drag = objectRotateDrag.current
    const object = groupRef.current
    if (!drag || !object || event.pointerId !== drag.pointerId) return
    event.stopPropagation()
    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    const roll = Boolean(event.shiftKey || event.nativeEvent?.shiftKey)
    object.rotation.set(
      roll ? drag.rotation[0] : drag.rotation[0] + dy * 0.01,
      roll ? drag.rotation[1] : drag.rotation[1] + dx * 0.01,
      roll ? drag.rotation[2] + dx * 0.01 : drag.rotation[2],
    )
  }, [])
  const endObjectInteraction = useCallback(event => {
    const drag = objectRotateDrag.current
    if (!drag || event.pointerId !== drag.pointerId) return
    event.stopPropagation()
    event.target?.releasePointerCapture?.(event.pointerId)
    objectRotateDrag.current = null
    if (orbitControls) orbitControls.enabled = true
    document.body.style.cursor = ''
    syncTransform()
  }, [orbitControls, syncTransform])
  useEffect(() => () => {
    if (objectRotateDrag.current) {
      document.body.style.cursor = ''
      if (orbitControls) orbitControls.enabled = true
    }
  }, [orbitControls])
  const content = (
    <group
      ref={groupRef}
      position={data.position}
      rotation={data.rotation}
      scale={data.scale}
      visible={data.visible !== false}
      userData={{ sceneObjectId: data.id }}
      onPointerDown={preview ? undefined : beginObjectInteraction}
      onPointerMove={preview ? undefined : rotateObjectFromSurface}
      onPointerUp={preview ? undefined : endObjectInteraction}
      onPointerCancel={preview ? undefined : endObjectInteraction}
    >
      {data.type === 'person' ? (
        <StudioPerson
          bodyType={data.bodyType}
          pose={data.pose}
          poseTime={data.poseTime}
          continuousMotion={data.continuousMotion}
          animationTime={stateAnimationTime}
          rigRoot={data.rigRoot}
          joints={data.joints}
          footLock={data.footLock}
          color={data.color}
          selected={selected}
          selectedJoint={activeJoint}
          showBoneGizmo={!preview && transformMode === 'select'}
          onSelectJoint={jointId => onJointSelect?.(data.id, jointId)}
          onRotateJoint={(jointId, rotation) => onUpdate(data.id, {
            joints: { ...(data.joints || {}), [jointId]: rotation },
          })}
          onRotateJoints={rotations => onUpdate(data.id, {
            joints: { ...(data.joints || {}), ...rotations },
          })}
          onSurfacePointerDown={beginObjectInteraction}
          onSurfacePointerMove={rotateObjectFromSurface}
          onSurfacePointerUp={endObjectInteraction}
        />
      ) : data.type === 'depthMesh' && data.depthMapUrl ? (
        <DepthMeshModel url={data.depthMapUrl} settings={data.depthSettings} color={data.color} selected={selected} />
      ) : data.type === 'model' && data.url ? (
        <Suspense fallback={<mesh position={[0, 0.5, 0]}><boxGeometry /><meshStandardMaterial color="#7f7b72" wireframe /></mesh>}><ImportedModel url={data.url} selected={selected} /></Suspense>
      ) : (
        <PrimitiveModel type={data.type} color={data.color || '#c7c2b7'} selected={selected} parts={data.parts} />
      )}
    </group>
  )

  return (
    <>
      {content}
      {selected && !data.locked && !preview && transformMode !== 'select' && (
        <TransformControls
          object={groupRef}
          mode={transformMode}
          space={transformSpace}
          size={0.8}
          showX={transformMode !== 'scale' || !scaleAxisLocks[0]}
          showY={transformMode !== 'scale' || !scaleAxisLocks[1]}
          showZ={transformMode !== 'scale' || !scaleAxisLocks[2]}
          translationSnap={snapEnabled ? 0.1 : null}
          rotationSnap={snapEnabled ? Math.PI / 36 : null}
          scaleSnap={snapEnabled ? 0.1 : null}
          onMouseDown={() => { if (transformMode === 'scale' && groupRef.current) scaleTransformStart.current = groupRef.current.scale.toArray() }}
          onObjectChange={syncTransform}
          onMouseUp={() => { syncTransform(); scaleTransformStart.current = null }}
        />
      )}
    </>
  )
}

function CameraModel({ data, selected, selectedId, transformMode, transformSpace = 'world', snapEnabled = true, onSelect, onUpdate }) {
  const groupRef = useRef(null)
  const syncTransform = useCallback(() => {
    if (!groupRef.current) return
    onUpdate({
      position: groupRef.current.position.toArray(),
      rotation: [groupRef.current.rotation.x, groupRef.current.rotation.y, groupRef.current.rotation.z],
    })
  }, [onUpdate])
  useLayoutEffect(() => {
    if (!groupRef.current) return
    groupRef.current.position.fromArray(data.position)
    groupRef.current.rotation.set(...data.rotation, 'XYZ')
  }, [data.position, data.rotation])
  const selectCamera = event => {
    if (shouldKeepCurrentSelection(event, selectedId, selected, transformMode)) return
    event.stopPropagation()
    onSelect(CAMERA_ID)
  }
  const rig = (
    <group ref={groupRef} position={data.position} rotation={data.rotation} userData={{ sceneObjectId: CAMERA_ID }} onPointerDown={selectCamera}>
      <mesh castShadow>
        <boxGeometry args={[0.52, 0.34, 0.42]} />
        <meshStandardMaterial color={selected ? '#eabf62' : '#3d3c38'} roughness={0.48} metalness={0.35} />
      </mesh>
      <mesh position={[0, 0, -0.34]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.18, 0.23, 0.32, 20]} />
        <meshStandardMaterial color="#232322" roughness={0.4} metalness={0.5} />
      </mesh>
      <mesh position={[0, 0, -0.82]} rotation={[Math.PI / 2, 0, Math.PI / 4]} raycast={() => null}>
        <coneGeometry args={[0.36, 0.9, 4, 1, true]} />
        <meshBasicMaterial color={selected ? '#eabf62' : '#8e8a80'} wireframe transparent opacity={selected ? 0.72 : 0.28} depthWrite={false} />
      </mesh>
      <mesh position={[-0.18, 0.28, 0]}>
        <cylinderGeometry args={[0.13, 0.13, 0.12, 20]} />
        <meshStandardMaterial color="#33322f" />
      </mesh>
      <mesh position={[0.18, 0.28, 0]}>
        <cylinderGeometry args={[0.13, 0.13, 0.12, 20]} />
        <meshStandardMaterial color="#33322f" />
      </mesh>
      <mesh position={[0, -0.42, 0.15]}>
        <boxGeometry args={[0.07, 0.58, 0.07]} />
        <meshStandardMaterial color="#4b4944" />
      </mesh>
    </group>
  )
  return (
    <>
      {rig}
      {selected && ['translate', 'rotate'].includes(transformMode) && (
        <TransformControls
          object={groupRef}
          mode={transformMode}
          space={transformSpace}
          size={0.8}
          translationSnap={snapEnabled ? 0.1 : null}
          rotationSnap={snapEnabled ? Math.PI / 36 : null}
          onObjectChange={syncTransform}
          onMouseUp={syncTransform}
        />
      )}
    </>
  )
}

const DEFAULT_STUDIO_LIGHTING = {
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

function StudioLights({ lighting = DEFAULT_STUDIO_LIGHTING }) {
  const azimuth = THREE.MathUtils.degToRad(lighting.keyAzimuth ?? DEFAULT_STUDIO_LIGHTING.keyAzimuth)
  const elevation = THREE.MathUtils.degToRad(lighting.keyElevation ?? DEFAULT_STUDIO_LIGHTING.keyElevation)
  const horizontal = Math.cos(elevation) * 10
  const height = Math.sin(elevation) * 10
  const keyPosition = [Math.sin(azimuth) * horizontal, height, Math.cos(azimuth) * horizontal]
  const fillPosition = [-keyPosition[0] * 0.85, Math.max(2.5, height * 0.42), -keyPosition[2] * 0.85]
  return (
    <>
      <hemisphereLight intensity={lighting.ambientIntensity ?? DEFAULT_STUDIO_LIGHTING.ambientIntensity} color={lighting.ambientColor || DEFAULT_STUDIO_LIGHTING.ambientColor} groundColor="#343536" />
      <directionalLight castShadow position={keyPosition} intensity={lighting.keyIntensity ?? DEFAULT_STUDIO_LIGHTING.keyIntensity} color={lighting.keyColor || DEFAULT_STUDIO_LIGHTING.keyColor} shadow-mapSize={[2048, 2048]} shadow-camera-left={-10} shadow-camera-right={10} shadow-camera-top={10} shadow-camera-bottom={-10} />
      <directionalLight position={fillPosition} intensity={lighting.fillIntensity ?? DEFAULT_STUDIO_LIGHTING.fillIntensity} color={lighting.fillColor || DEFAULT_STUDIO_LIGHTING.fillColor} />
    </>
  )
}

function RendererExposure({ value = DEFAULT_STUDIO_LIGHTING.exposure }) {
  const { gl } = useThree()
  useEffect(() => {
    gl.toneMappingExposure = value
  }, [gl, value])
  return null
}

function Ground({ showGrid = true, showSurface = true }) {
  return (
    <>
      {showSurface && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.025, 0]} receiveShadow>
          <planeGeometry args={[60, 60]} />
          <meshStandardMaterial color="#4b4b48" roughness={0.96} />
        </mesh>
      )}
      {showGrid && <Grid position={[0, 0.002, 0]} args={[30, 30]} cellSize={0.5} cellThickness={0.5} cellColor="#777771" sectionSize={5} sectionThickness={0.8} sectionColor="#9b8c68" fadeDistance={24} fadeStrength={1} infiniteGrid />}
    </>
  )
}

function ViewFocusController({ request }) {
  const { camera, controls } = useThree()
  useEffect(() => {
    if (!request || !controls) return
    const target = new THREE.Vector3(...request.position)
    target.y += request.height || 0
    const direction = camera.position.clone().sub(controls.target).normalize()
    if (!Number.isFinite(direction.x) || direction.lengthSq() < 0.001) direction.set(1, 0.65, 1).normalize()
    controls.target.copy(target)
    camera.position.copy(target).addScaledVector(direction, request.distance || 5)
    controls.update()
  }, [camera, controls, request])
  return null
}

function EditorCameraReporter({ enabled, onChange }) {
  const { camera, controls } = useThree()
  useEffect(() => {
    if (!enabled || !controls || !onChange) return undefined
    let frame = 0
    const report = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => onChange({
        position: camera.position.toArray(),
        rotation: [camera.rotation.x, camera.rotation.y, camera.rotation.z],
        target: controls.target.toArray(),
      }))
    }
    controls.addEventListener('change', report)
    report()
    return () => {
      cancelAnimationFrame(frame)
      controls.removeEventListener('change', report)
    }
  }, [camera, controls, enabled, onChange])
  return null
}

function EditorScene({ objects, selectedId, activeJoint, onSelect, onJointSelect, transformMode, transformSpace, snapEnabled, groundRequest, onUpdateObject, cameraData, cameraAspect, onUpdateCamera, editorCameraData, onEditorCameraChange, lighting, showGrid, focusRequest, referenceVisible = false, cameraView = false, animationTime = 0 }) {
  return (
    <>
      {!referenceVisible && <color attach="background" args={['#555653']} />}
      <fog attach="fog" args={['#555653', 18, 42]} />
      <RendererExposure value={lighting?.exposure} />
      <StudioLights lighting={lighting} />
      <Ground showGrid={showGrid} showSurface={!referenceVisible} />
      {objects.map(object => <SceneObject key={object.id} data={object} selected={selectedId === object.id} selectedId={selectedId} activeJoint={activeJoint} transformMode={transformMode} transformSpace={transformSpace} snapEnabled={snapEnabled} groundRequest={groundRequest} onSelect={onSelect} onJointSelect={onJointSelect} onUpdate={onUpdateObject} animationTime={animationTime} />)}
      {!cameraView && <CameraModel data={cameraData} selected={selectedId === CAMERA_ID} selectedId={selectedId} transformMode={transformMode} transformSpace={transformSpace} snapEnabled={snapEnabled} onSelect={onSelect} onUpdate={onUpdateCamera} />}
      <ContactShadows position={[0, 0.01, 0]} opacity={0.42} scale={18} blur={2.4} far={9} />
      {cameraView ? <PreviewCameraController cameraData={cameraData} cameraAspect={cameraAspect} /> : <OrbitControls makeDefault target={editorCameraData?.target || [0, 1, 0]} minDistance={2} maxDistance={35} maxPolarAngle={Math.PI * 0.49} />}
      <EditorCameraReporter enabled={!cameraView} onChange={onEditorCameraChange} />
      {!cameraView && <ViewFocusController request={focusRequest} />}
    </>
  )
}

function PreviewCameraController({ cameraData, cameraAspect }) {
  const { camera, size } = useThree()
  useFrame(() => {
    camera.position.fromArray(cameraData.position)
    camera.rotation.set(...cameraData.rotation, 'XYZ')
    const fov = THREE.MathUtils.radToDeg(2 * Math.atan(24 / (2 * cameraData.focalLength)))
    const nextAspect = Number.isFinite(cameraAspect) && cameraAspect > 0 ? cameraAspect : size.width / Math.max(1, size.height)
    if (Math.abs(camera.fov - fov) > 0.01 || Math.abs(camera.aspect - nextAspect) > 0.0001) {
      camera.fov = fov
      camera.aspect = nextAspect
      camera.updateProjectionMatrix()
    }
  })
  return null
}

function CanvasBackground({ canvas }) {
  const texture = useMemo(() => {
    if (!canvas) return null
    const next = new THREE.CanvasTexture(canvas)
    next.colorSpace = THREE.SRGBColorSpace
    next.needsUpdate = true
    return next
  }, [canvas])
  useEffect(() => () => texture?.dispose(), [texture])
  return texture ? <primitive attach="background" object={texture} /> : <color attach="background" args={['#9b9c98']} />
}

function PreviewScene({ objects, cameraData, cameraAspect, lighting, backgroundCanvas = null, animationTime = 0 }) {
  return (
    <>
      <CanvasBackground canvas={backgroundCanvas} />
      <fog attach="fog" args={['#9b9c98', 18, 38]} />
      <RendererExposure value={lighting?.exposure} />
      <StudioLights lighting={lighting} />
      <Ground showGrid={false} showSurface={!backgroundCanvas} />
      {objects.map(object => <SceneObject key={object.id} data={object} animationTime={animationTime} preview />)}
      <ContactShadows position={[0, 0.01, 0]} opacity={0.35} scale={18} blur={2.2} far={9} />
      <PreviewCameraController cameraData={cameraData} cameraAspect={cameraAspect} />
    </>
  )
}

export function MainViewport(props) {
  const editorCamera = props.editorCameraData || {}
  const cameraSettings = props.cameraView
    ? { position: props.cameraData.position, rotation: props.cameraData.rotation, fov: 42, near: 0.05, far: 200 }
    : {
        position: editorCamera.position || [8.5, 6.4, 9.5],
        ...(editorCamera.rotation ? { rotation: editorCamera.rotation } : {}),
        fov: 42,
        near: 0.05,
        far: 200,
      }
  return (
    <Canvas shadows="basic" dpr={[1, 1.75]} camera={cameraSettings} onPointerMissed={() => props.onSelect(null)} gl={{ alpha: true, antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 0.88 }}>
      <EditorScene {...props} />
    </Canvas>
  )
}

export function CameraPreview({ objects, cameraData, cameraAspect, lighting, backgroundCanvas = null, animationTime = 0, onCanvasReady, exportMode = false }) {
  return (
    <Canvas
      shadows="basic"
      dpr={exportMode ? 1 : [1, 1.5]}
      camera={{ position: cameraData.position, fov: 40, aspect: cameraAspect, near: 0.05, far: 200 }}
      gl={{ antialias: true, preserveDrawingBuffer: exportMode || Boolean(onCanvasReady), toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 0.9 }}
      onCreated={({ gl }) => onCanvasReady?.(gl.domElement)}
    >
      <PreviewScene objects={objects} cameraData={cameraData} cameraAspect={cameraAspect} lighting={lighting} backgroundCanvas={backgroundCanvas} animationTime={animationTime} />
    </Canvas>
  )
}
