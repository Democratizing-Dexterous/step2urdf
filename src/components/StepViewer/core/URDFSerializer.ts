/**
 * URDF XML 序列化与反序列化
 */

import type { URDFRobot, URDFLink, URDFJoint, URDFOrigin, JointLimits, JointType, InertialParams } from '../types'
import * as THREE from 'three'

/** 序列化选项 */
export interface SerializeOptions {
  /**
   * linkId → Link 静息世界矩阵的逆（将世界坐标转到 Link 局部坐标）
   * 提供时，惯性质心 COM 等世界坐标数据会被变换到 Link 局部空间
   */
  linkRestInverses?: Map<string, THREE.Matrix4>
  /**
   * 单位缩放系数，应用于所有线性尺寸（mm → m 时为 0.001）
   * 仅影响平移量，不影响角度/方向向量
   */
  unitScale?: number
  /**
   * 如果用户设置了 baseLinkOrientation，则将 base_link 坐标系奠 (T × R) 矩阵的逆
   * 用于变换 base_link 直接子关节的 origin，使其表达在 URDF 基坐标系下
   */
  basePoseInverse?: THREE.Matrix4
  /** base_link 对应的 linkId，配合 basePoseInverse 使用 */
  baseLinkId?: string
}

/**
 * 将 URDFRobot 序列化为标准 URDF XML 字符串
 */
export function serializeURDF(robot: URDFRobot, options?: SerializeOptions): string {
  const lines: string[] = []
  const s = options?.unitScale ?? 1
  lines.push('<?xml version="1.0" encoding="UTF-8"?>')
  lines.push(`<robot name="${escapeXml(robot.name)}">`)

  for (const link of robot.links) {
    const restInverse = options?.linkRestInverses?.get(link.id)
    lines.push(serializeLink(link, s, restInverse))
  }

  for (const joint of robot.joints) {
    lines.push(serializeJoint(joint, robot, s, options))
  }

  lines.push('</robot>')
  return lines.join('\n')
}

function serializeLink(link: URDFLink, unitScale: number, restInverse?: THREE.Matrix4): string {
  const lines: string[] = []
  const s = unitScale
  lines.push(`  <link name="${escapeXml(link.name)}">`)

  if (link.inertial) {
    // 如果提供了 restInverse，将质心从世界坐标变换到 Link 局部坐标
    let comLocal = link.inertial.com
    if (restInverse) {
      const me = restInverse.elements
      const [cx, cy, cz] = comLocal
      comLocal = [
        me[0] * cx + me[4] * cy + me[8] * cz + me[12],
        me[1] * cx + me[5] * cy + me[9] * cz + me[13],
        me[2] * cx + me[6] * cy + me[10] * cz + me[14]
      ]
    }
    // 应用单位缩放（mm → m）
    const comScaled: [number, number, number] = [comLocal[0] * s, comLocal[1] * s, comLocal[2] * s]

    // 惯性张量：原始值在 STEP 世界坐标轴下（由 InertiaWorker 计算），URDF 要求在 link-local 轴下。
    // 若 restInverse 包含旋转（link frame ≠ world frame），必须执行轴旋转变换：
    //   I_local = R_wl · I_world · R_wl^T
    // 其中 R_wl 为 restInverse 的旋转部分（将世界向量映射到 link-local 向量）。
    // 仅平移（无旋转）时 R_wl = I，变换是恒等的，可统一调用。
    let inertiaLocal = link.inertial.inertia as [number, number, number, number, number, number]
    if (restInverse) {
      inertiaLocal = rotateInertiaTensor(inertiaLocal, restInverse)
    }

    const [ixx, ixy, ixz, iyy, iyz, izz] = inertiaLocal
    lines.push('    <inertial>')
    lines.push(`      <mass value="${fmtNum(link.inertial.mass)}"/>`)
    lines.push(`      <origin xyz="${fmtVec3(comScaled)}" rpy="0 0 0"/>`)
    // inertia 已转换到 link-local 轴、SI 单位 kg·m²，直接写入
    lines.push(`      <inertia ixx="${fmtNum(ixx)}" ixy="${fmtNum(ixy)}" ixz="${fmtNum(ixz)}" iyy="${fmtNum(iyy)}" iyz="${fmtNum(iyz)}" izz="${fmtNum(izz)}"/>`)
    lines.push('    </inertial>')
  }

  // Visual — 引用 STL 网格
  if (link.solidIds.length > 0) {
    lines.push('    <visual>')
    lines.push('      <origin xyz="0 0 0" rpy="0 0 0"/>')
    lines.push('      <geometry>')
    lines.push(`        <mesh filename="meshes/${escapeXml(link.name)}.stl"/>`)
    lines.push('      </geometry>')
    lines.push('    </visual>')

    lines.push('    <collision>')
    lines.push('      <origin xyz="0 0 0" rpy="0 0 0"/>')
    lines.push('      <geometry>')
    lines.push(`        <mesh filename="meshes/${escapeXml(link.name)}.stl"/>`)
    lines.push('      </geometry>')
    lines.push('    </collision>')
  }

  lines.push('  </link>')
  return lines.join('\n')
}

function serializeJoint(joint: URDFJoint, robot: URDFRobot, unitScale: number, options?: SerializeOptions): string {
  const lines: string[] = []
  const s = unitScale
  const parentLink = robot.links.find(l => l.id === joint.parentLinkId)
  const childLink = robot.links.find(l => l.id === joint.childLinkId)
  const parentName = parentLink?.name || joint.parentLinkId
  const childName = childLink?.name || joint.childLinkId

  // 是否是 base_link 直接子关节：需要将 origin 从 STEP 世界坐标变换到 URDF 基坐标系
  const isBaseChild = !!options?.basePoseInverse && !!options?.baseLinkId
    && joint.parentLinkId === options.baseLinkId

  let xyzFinal = joint.origin.xyz as [number, number, number]
  let rpyFinal = joint.origin.rpy as [number, number, number]

  // 合并 axisOffset 到 origin.xyz
  const axOff = joint.axisOffset || [0, 0, 0]
  xyzFinal = [
    xyzFinal[0] + axOff[0],
    xyzFinal[1] + axOff[1],
    xyzFinal[2] + axOff[2]
  ]

  if (isBaseChild) {
    const bpi = options!.basePoseInverse!
    const me = bpi.elements
    const [ox, oy, oz] = xyzFinal
    // 变换平移分量： bpi 全变换（平移 + 旋转）
    xyzFinal = [
      me[0] * ox + me[4] * oy + me[8] * oz + me[12],
      me[1] * ox + me[5] * oy + me[9] * oz + me[13],
      me[2] * ox + me[6] * oy + me[10] * oz + me[14]
    ]
    // 变换旋转分量： R_bpi × R(joint.rpy) → 提取新 RPY
    const rJoint = new THREE.Matrix4().makeRotationFromEuler(
      new THREE.Euler(joint.origin.rpy[0], joint.origin.rpy[1], joint.origin.rpy[2], 'ZYX')
    )
    const rBpi = new THREE.Matrix4().extractRotation(bpi)
    const rCombined = new THREE.Matrix4().multiplyMatrices(rBpi, rJoint)
    rpyFinal = matrixToRPY(rCombined)
  }

  // origin xyz 需要缩放，rpy 不变（弧度）
  const xyzScaled: [number, number, number] = [
    xyzFinal[0] * s,
    xyzFinal[1] * s,
    xyzFinal[2] * s
  ]

  lines.push(`  <joint name="${escapeXml(joint.name)}" type="${joint.type}">`)
  lines.push(`    <parent link="${escapeXml(parentName)}"/>`)
  lines.push(`    <child link="${escapeXml(childName)}"/>`)
  lines.push(`    <origin xyz="${fmtVec3(xyzScaled)}" rpy="${fmtVec3(rpyFinal)}"/>`)
  lines.push(`    <axis xyz="${fmtVec3(joint.axis)}"/>`)

  if (joint.type !== 'fixed') {
    // prismatic 关节的 limits 是线性尺寸，需要缩放；revolute/continuous 是弧度，不缩放
    const isPrismatic = joint.type === 'prismatic'
    const limitScale = isPrismatic ? s : 1
    const velScale = isPrismatic ? s : 1 // prismatic: m/s，revolute: rad/s
    lines.push(`    <limit lower="${fmtNum(joint.limits.lower * limitScale)}" upper="${fmtNum(joint.limits.upper * limitScale)}" effort="${fmtNum(joint.limits.effort)}" velocity="${fmtNum(joint.limits.velocity * velScale)}"/>`)
  }

  lines.push('  </joint>')
  return lines.join('\n')
}

/**
 * 解析 URDF XML 字符串为 URDFRobot
 */
export function deserializeURDF(xml: string): URDFRobot {
  const parser = new DOMParser()
  const doc = parser.parseFromString(xml, 'application/xml')
  const errorNode = doc.querySelector('parsererror')
  if (errorNode) {
    throw new Error('URDF XML 解析失败: ' + errorNode.textContent)
  }

  const robotEl = doc.querySelector('robot')
  if (!robotEl) {
    throw new Error('URDF XML 中未找到 <robot> 元素')
  }

  const robotName = robotEl.getAttribute('name') || 'robot'
  const links: URDFLink[] = []
  const joints: URDFJoint[] = []

  // 解析 Links
  const linkEls = robotEl.querySelectorAll(':scope > link')
  linkEls.forEach((el, idx) => {
    const name = el.getAttribute('name') || `Link_${idx + 1}`
    const link: URDFLink = {
      id: `link_${idx + 1}`,
      name,
      solidIds: [],
      inertial: null,
    }

    const inertialEl = el.querySelector('inertial')
    if (inertialEl) {
      link.inertial = parseInertial(inertialEl)
    }

    links.push(link)
  })

  // 构建 name → link id 映射
  const nameToId = new Map<string, string>()
  links.forEach(l => nameToId.set(l.name, l.id))

  // 解析 Joints
  const jointEls = robotEl.querySelectorAll(':scope > joint')
  jointEls.forEach((el, idx) => {
    const name = el.getAttribute('name') || `Joint_${idx + 1}`
    const type = (el.getAttribute('type') || 'fixed') as JointType
    const parentEl = el.querySelector('parent')
    const childEl = el.querySelector('child')
    const parentName = parentEl?.getAttribute('link') || ''
    const childName = childEl?.getAttribute('link') || ''

    const originEl = el.querySelector('origin')
    const origin = parseOrigin(originEl)

    const axisEl = el.querySelector('axis')
    const axis = parseVec3(axisEl?.getAttribute('xyz') || '0 0 1') as [number, number, number]

    const limitEl = el.querySelector('limit')
    const limits = parseLimits(limitEl)

    joints.push({
      id: `joint_${idx + 1}`,
      name,
      type,
      parentLinkId: nameToId.get(parentName) || parentName,
      childLinkId: nameToId.get(childName) || childName,
      origin,
      axis,
      limits,
      currentValue: 0,
      axisOffset: [0, 0, 0] as [number, number, number]
    })
  })

  return { name: robotName, links, joints }
}

// ============ 辅助函数 ============

function parseInertial(el: Element): InertialParams {
  const massEl = el.querySelector('mass')
  const mass = parseFloat(massEl?.getAttribute('value') || '0')

  const originEl = el.querySelector('origin')
  const com = parseVec3(originEl?.getAttribute('xyz') || '0 0 0') as [number, number, number]

  const inertiaEl = el.querySelector('inertia')
  const ixx = parseFloat(inertiaEl?.getAttribute('ixx') || '0')
  const ixy = parseFloat(inertiaEl?.getAttribute('ixy') || '0')
  const ixz = parseFloat(inertiaEl?.getAttribute('ixz') || '0')
  const iyy = parseFloat(inertiaEl?.getAttribute('iyy') || '0')
  const iyz = parseFloat(inertiaEl?.getAttribute('iyz') || '0')
  const izz = parseFloat(inertiaEl?.getAttribute('izz') || '0')

  return { mass, com, inertia: [ixx, ixy, ixz, iyy, iyz, izz] }
}

function parseOrigin(el: Element | null): URDFOrigin {
  if (!el) return { xyz: [0, 0, 0], rpy: [0, 0, 0] }
  return {
    xyz: parseVec3(el.getAttribute('xyz') || '0 0 0') as [number, number, number],
    rpy: parseVec3(el.getAttribute('rpy') || '0 0 0') as [number, number, number]
  }
}

function parseLimits(el: Element | null): JointLimits {
  if (!el) return { lower: -3.14159, upper: 3.14159, effort: 100, velocity: 1 }
  return {
    lower: parseFloat(el.getAttribute('lower') || '-3.14159'),
    upper: parseFloat(el.getAttribute('upper') || '3.14159'),
    effort: parseFloat(el.getAttribute('effort') || '100'),
    velocity: parseFloat(el.getAttribute('velocity') || '1')
  }
}

function parseVec3(str: string): [number, number, number] {
  const parts = str.trim().split(/\s+/).map(Number)
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0]
}

function fmtNum(n: number): string {
  return Number.isFinite(n) ? parseFloat(n.toFixed(8)).toString() : '0'
}

/**
 * 将惯性张量从世界坐标轴旋转到连杆局部坐标轴
 *
 * URDF 规范要求 <inertia> 值表达在与 link frame 对齐的轴下（当 <origin rpy="0 0 0"> 时）。
 * InertiaWorker 输出的张量是在 STEP 世界坐标轴下，须通过 I_local = R · I · Rᵀ 旋转。
 *
 * @param inertia  [ixx, ixy, ixz, iyy, iyz, izz]（世界坐标轴，kg·m²）
 * @param m        restInverse —— 含旋转部分 R（将世界向量映射到 link-local 向量）
 * @returns        [ixx, ixy, ixz, iyy, iyz, izz]（link-local 坐标轴，kg·m²）
 */
function rotateInertiaTensor(
  inertia: readonly [number, number, number, number, number, number],
  m: THREE.Matrix4
): [number, number, number, number, number, number] {
  // Three.js Matrix4 按列存储：elements[col*4 + row]
  // R[row][col] = e[col*4 + row]
  const e = m.elements
  const Rx = [e[0], e[4], e[8]]   // row 0 of rotation
  const Ry = [e[1], e[5], e[9]]   // row 1
  const Rz = [e[2], e[6], e[10]]  // row 2

  const [Ixx, Ixy, Ixz, Iyy, Iyz, Izz] = inertia

  // 对称惯性矩阵 M：M[i][j] = r_i^T · I · r_j，其中 r_i 为 R 的第 i 行向量
  // I_local[i][j] = (R·I·Rᵀ)[i][j] = r_i · (I · r_j)
  const dot = (r: number[], c: number[]) =>
    r[0] * (c[0] * Ixx + c[1] * Ixy + c[2] * Ixz) +
    r[1] * (c[0] * Ixy + c[1] * Iyy + c[2] * Iyz) +
    r[2] * (c[0] * Ixz + c[1] * Iyz + c[2] * Izz)

  return [
    dot(Rx, Rx),  // ixx_local
    dot(Rx, Ry),  // ixy_local
    dot(Rx, Rz),  // ixz_local
    dot(Ry, Ry),  // iyy_local
    dot(Ry, Rz),  // iyz_local
    dot(Rz, Rz),  // izz_local
  ]
}

function fmtVec3(v: [number, number, number] | number[]): string {
  return `${fmtNum(v[0])} ${fmtNum(v[1])} ${fmtNum(v[2])}`
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * 从旋转矩阵提取 ZYX intrinsic RPY（即 Three.js 'ZYX' Euler）
 */
function matrixToRPY(m: THREE.Matrix4): [number, number, number] {
  const euler = new THREE.Euler().setFromRotationMatrix(m, 'ZYX')
  return [euler.x, euler.y, euler.z]
}
