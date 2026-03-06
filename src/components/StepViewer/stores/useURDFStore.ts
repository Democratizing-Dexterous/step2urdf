/**
 * URDF 构建视图状态管理
 */

import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import * as THREE from 'three'
import type {
  URDFRobot,
  URDFLink,
  URDFJoint,
  JointType,
  URDFOrigin,
  JointLimits,
  InertialParams,
  BindingModeState,
  JointWizardStep
} from '../types'

/** base_link 固定 ID */
const BASE_LINK_ID = 'link_base'

let _nextLinkId = 1
let _nextJointId = 1

/** el-tree 节点类型 */
export interface URDFTreeNode {
  id: string
  label: string
  nodeType: 'link' | 'joint'
  jointType?: JointType
  solidCount: number
  isBase: boolean
  children: URDFTreeNode[]
}

export const useURDFStore = defineStore('urdf', () => {
  // ============ 机器人模型 ============
  const robot = ref<URDFRobot>({
    name: 'robot',
    links: [
      { id: BASE_LINK_ID, name: 'base_link', solidIds: [], inertial: null }
    ],
    joints: []
  })

  /** 导出中 loading */
  const exporting = ref(false)
  const exportProgress = ref('')

  // ============ UI 状态 ============
  const selectedLinkId = ref<string | null>(null)
  const selectedJointId = ref<string | null>(null)

  /** Solid 绑定模式 */
  const bindingMode = ref<BindingModeState>({ active: false, targetLinkId: null })

  /** 关节创建向导状态 */
  const jointWizardVisible = ref(false)
  const jointWizardStep = ref<JointWizardStep>('select-links')

  /** 正在重新拾取边的已有 Joint ID（编辑模式边拾取） */
  const edgePickEditJointId = ref<string | null>(null)

  /** 显示控制 */
  const showFrames = ref(true)
  const urdfEditorVisible = ref(false)

  /** FK 计算后各 Link 的世界变换矩阵（由 StepViewer 写入） */
  const linkWorldTransforms = ref(new Map<string, THREE.Matrix4>())

  /** 坐标轴可视化缩放比（相对于自动计算的基准轴长） */
  const axisHelperScale = ref<number>(1.0)

  /** Base Link 原点拾取交互模式 */
  const basePickMode = ref(false)
  /** Base Link 在世界坐标系中的可视化原点（定义运动树计算起点，null = 未初始化） */
  const baseLinkOrigin = ref<[number, number, number] | null>(null)
  /** Base Link 坐标系姿态 RPY（弧度）：[roll, pitch, yaw]，与 URDF <origin rpy> 约定一致
   *  null 表示默认（[0,0,0] = 与世界坐标系同向） */
  const baseLinkRPY = ref<[number, number, number] | null>(null)

  // ============ 计算属性 ============

  /** Link ID → URDFLink */
  const linkMap = computed(() => {
    const map = new Map<string, URDFLink>()
    robot.value.links.forEach(l => map.set(l.id, l))
    return map
  })

  /** Joint ID → URDFJoint */
  const jointMap = computed(() => {
    const map = new Map<string, URDFJoint>()
    robot.value.joints.forEach(j => map.set(j.id, j))
    return map
  })

  /** Link name → URDFLink */
  const linkByName = computed(() => {
    const map = new Map<string, URDFLink>()
    robot.value.links.forEach(l => map.set(l.name, l))
    return map
  })

  /** 每个 Link 作为 child 出现的 Joint（用于构建运动学树） */
  const childJointMap = computed(() => {
    const map = new Map<string, URDFJoint>()
    robot.value.joints.forEach(j => map.set(j.childLinkId, j))
    return map
  })

  /** 每个 Link 作为 parent 出现的 Joint 列表 */
  const parentJointMap = computed(() => {
    const map = new Map<string, URDFJoint[]>()
    robot.value.joints.forEach(j => {
      const list = map.get(j.parentLinkId) || []
      list.push(j)
      map.set(j.parentLinkId, list)
    })
    return map
  })

  /** 根 Link（没有作为 child 出现在任何 Joint 中的 Link） */
  const rootLinks = computed(() => {
    const childIds = new Set(robot.value.joints.map(j => j.childLinkId))
    return robot.value.links.filter(l => !childIds.has(l.id))
  })

  /** 叶节点 Link（没有作为 parent 出现在任何 Joint 中的 Link） */
  const leafLinks = computed(() => {
    const parentIds = new Set(robot.value.joints.map(j => j.parentLinkId))
    return robot.value.links.filter(l => !parentIds.has(l.id))
  })

  // ============ el-tree 拓扑树数据 ============

  function buildLinkNode(linkId: string): URDFTreeNode {
    const link = linkMap.value.get(linkId)
    const childJoints = parentJointMap.value.get(linkId) || []
    return {
      id: linkId,
      label: link?.name ?? linkId,
      nodeType: 'link',
      solidCount: link?.solidIds.length ?? 0,
      isBase: isBaseLink(linkId),
      jointType: undefined,
      children: childJoints.map(j => ({
        id: j.id,
        label: j.name,
        nodeType: 'joint' as const,
        jointType: j.type,
        solidCount: 0,
        isBase: false,
        children: linkMap.value.has(j.childLinkId) ? [buildLinkNode(j.childLinkId)] : []
      }))
    }
  }

  /** el-tree 格式的拓扑树，供 URDFLeftPanel 直接消费 */
  const treeData = computed<URDFTreeNode[]>(() => rootLinks.value.map(l => buildLinkNode(l.id)))

  /** 可用的非 fixed 关节列表（用于滑块面板） */
  const activeJoints = computed(() => {
    return robot.value.joints.filter(j => j.type !== 'fixed')
  })

  /** 已绑定的 Solid ID 集合 */
  const boundSolidIds = computed(() => {
    const ids = new Set<string>()
    robot.value.links.forEach(l => l.solidIds.forEach(id => ids.add(id)))
    return ids
  })

  // ============ Link CRUD ============

  function isBaseLink(linkId: string): boolean {
    return linkId === BASE_LINK_ID
  }

  function addLink(name?: string): URDFLink {
    const id = `link_${_nextLinkId++}`
    const link: URDFLink = {
      id,
      name: name || `Link_${_nextLinkId - 1}`,
      solidIds: [],
      inertial: null,
    }
    robot.value.links.push(link)
    selectedLinkId.value = id
    return link
  }

  function removeLink(linkId: string): { ok: boolean; reason?: string } {
    if (isBaseLink(linkId)) {
      return { ok: false, reason: 'base_link 不能被删除' }
    }
    // 级联删除关联的 Joint（parentLinkId 或 childLinkId 匹配）
    robot.value.joints = robot.value.joints.filter(
      j => j.parentLinkId !== linkId && j.childLinkId !== linkId
    )
    robot.value.links = robot.value.links.filter(l => l.id !== linkId)
    if (selectedLinkId.value === linkId) {
      selectedLinkId.value = null
    }
    return { ok: true }
  }

  function renameLink(linkId: string, newName: string): void {
    const link = linkMap.value.get(linkId)
    if (link) {
      link.name = newName
    }
  }

  function renameJoint(jointId: string, newName: string): void {
    const joint = jointMap.value.get(jointId)
    if (joint) {
      joint.name = newName
    }
  }

  function bindSolid(linkId: string, solidId: string): void {
    const link = linkMap.value.get(linkId)
    if (link && !link.solidIds.includes(solidId)) {
      link.solidIds.push(solidId)
    }
  }

  function unbindSolid(linkId: string, solidId: string): void {
    const link = linkMap.value.get(linkId)
    if (link) {
      link.solidIds = link.solidIds.filter(id => id !== solidId)
    }
  }

  // ============ Joint CRUD ============

  /**
   * 校验 Joint 创建参数。返回 null 表示合法；否则返回错误消息。
   */
  function validateJoint(parentLinkId: string, childLinkId: string, excludeJointId?: string): string | null {
    // 1. 禁止自连接
    if (parentLinkId === childLinkId) {
      return '父子连杆不能相同'
    }
    // 2. base_link 不能作为 child
    if (childLinkId === BASE_LINK_ID) {
      return 'base_link 不能作为 Child（它是根连杆）'
    }
    // 3. 单一父级约束 — child 只能被一个 Joint 拥有
    const existing = robot.value.joints.find(
      j => j.childLinkId === childLinkId && j.id !== excludeJointId
    )
    if (existing) {
      return `该连杆已作为 "${existing.name}" 的 Child，禁止构成运动学闭环`
    }
    return null
  }

  function addJoint(config: {
    name?: string
    type: JointType
    parentLinkId: string
    childLinkId: string
    origin: URDFOrigin
    axis: [number, number, number]
    axisOffset?: [number, number, number]
    limits?: JointLimits
  }): { ok: true; joint: URDFJoint } | { ok: false; reason: string } {
    const err = validateJoint(config.parentLinkId, config.childLinkId)
    if (err) return { ok: false, reason: err }

    const id = `joint_${_nextJointId++}`
    const joint: URDFJoint = {
      id,
      name: config.name || `Joint_${_nextJointId - 1}`,
      type: config.type,
      parentLinkId: config.parentLinkId,
      childLinkId: config.childLinkId,
      origin: config.origin,
      axis: config.axis,
      axisOffset: config.axisOffset || [0, 0, 0],
      limits: config.limits || (
        config.type === 'prismatic'
          ? { lower: -100, upper: 100, effort: 100, velocity: 100 }
          : { lower: -3.14159, upper: 3.14159, effort: 10, velocity: 1 }
      ),
      currentValue: 0
    }
    robot.value.joints.push(joint)
    selectedJointId.value = id
    return { ok: true, joint }
  }

  function removeJoint(jointId: string): void {
    robot.value.joints = robot.value.joints.filter(j => j.id !== jointId)
    if (selectedJointId.value === jointId) {
      selectedJointId.value = null
    }
  }

  function updateJoint(jointId: string, updates: Partial<Omit<URDFJoint, 'id'>>): void {
    const joint = jointMap.value.get(jointId)
    if (joint) {
      Object.assign(joint, updates)
    }
  }

  function setJointValue(jointId: string, value: number): void {
    const joint = jointMap.value.get(jointId)
    if (joint) {
      joint.currentValue = Math.max(joint.limits.lower, Math.min(joint.limits.upper, value))
    }
  }

  function resetJoints(): void {
    robot.value.joints.forEach(j => { j.currentValue = 0 })
  }

  function randomizeJoints(): void {
    robot.value.joints.forEach(j => {
      if (j.type !== 'fixed') {
        j.currentValue = j.limits.lower + Math.random() * (j.limits.upper - j.limits.lower)
      }
    })
  }

  // ============ 惯性参数更新 ============

  function setLinkInertial(linkId: string, inertial: InertialParams): void {
    const link = linkMap.value.get(linkId)
    if (link) {
      link.inertial = inertial
    }
  }

  // ============ 绑定模式管理 ============

  function startBindingMode(linkId: string): void {
    bindingMode.value = { active: true, targetLinkId: linkId }
  }

  function stopBindingMode(): void {
    bindingMode.value = { active: false, targetLinkId: null }
  }

  // ============ 从 URDF 导入 ============

  function importRobot(imported: URDFRobot): void {
    // 确保有 base_link
    if (!imported.links.some(l => l.name === 'base_link')) {
      imported.links.unshift({
        id: BASE_LINK_ID,
        name: 'base_link',
        solidIds: [],
        inertial: null,
      })
    }
    robot.value = imported
    selectedLinkId.value = null
    selectedJointId.value = null
    baseLinkOrigin.value = null
    basePickMode.value = false
    // 重设 ID 计数器
    _nextLinkId = imported.links.length + 1
    _nextJointId = imported.joints.length + 1
  }

  // ============ 树合法性校验 ============

  /**
   * 检查孤岛 Link（除 base_link/root 外，未被任何 Joint 引用为 child 的 Link）
   * 返回孤立 Link 名称列表
   */
  function findOrphanLinks(): string[] {
    const childIds = new Set(robot.value.joints.map(j => j.childLinkId))
    return robot.value.links
      .filter(l => !isBaseLink(l.id) && !childIds.has(l.id))
      .map(l => l.name)
  }

  // ============ 重置 ============

  function clearAll(): void {
    robot.value = {
      name: 'robot',
      links: [
        { id: BASE_LINK_ID, name: 'base_link', solidIds: [], inertial: null }
      ],
      joints: []
    }
    selectedLinkId.value = null
    selectedJointId.value = null
    bindingMode.value = { active: false, targetLinkId: null }
    jointWizardVisible.value = false
    jointWizardStep.value = 'select-links'
    edgePickEditJointId.value = null
    baseLinkOrigin.value = null
    baseLinkRPY.value = null
    basePickMode.value = false
    showFrames.value = true
    axisHelperScale.value = 1.0
    linkWorldTransforms.value = new Map()
    exporting.value = false
    exportProgress.value = ''
    _nextLinkId = 1
    _nextJointId = 1
  }

  return {
    // 常量
    BASE_LINK_ID,

    // 状态
    robot,
    selectedLinkId,
    selectedJointId,
    bindingMode,
    jointWizardVisible,
    jointWizardStep,
    edgePickEditJointId,
    showFrames,
    urdfEditorVisible,
    exporting,
    exportProgress,
    linkWorldTransforms,
    axisHelperScale,
    basePickMode,
    baseLinkOrigin,
    baseLinkRPY,

    // 计算属性
    linkMap,
    jointMap,
    linkByName,
    childJointMap,
    parentJointMap,
    rootLinks,
    leafLinks,
    activeJoints,
    boundSolidIds,
    treeData,

    // Link CRUD
    isBaseLink,
    addLink,
    removeLink,
    renameLink,
    renameJoint,
    bindSolid,
    unbindSolid,

    // Joint CRUD
    validateJoint,
    addJoint,
    removeJoint,
    updateJoint,
    setJointValue,
    resetJoints,
    randomizeJoints,

    // 惯性
    setLinkInertial,

    // 绑定模式
    startBindingMode,
    stopBindingMode,

    // 校验
    findOrphanLinks,

    // 导入/重置
    importRobot,
    clearAll
  }
})
