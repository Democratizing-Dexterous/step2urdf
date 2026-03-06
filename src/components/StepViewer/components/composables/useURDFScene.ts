/**
 * URDF 场景操作 Composable
 * 管理 ForwardKinematics / FrameVisualizer / JointSnapVisualizer 生命周期
 * 以及绑定、边拾取、导出等 URDF 相关操作
 */

import * as THREE from 'three'
import { ElMessage } from 'element-plus'
import { FrameVisualizer } from '../../core/FrameVisualizer'
import { ForwardKinematics } from '../../core/ForwardKinematics'
import { JointSnapVisualizer } from '../../core/JointSnapVisualizer'
import { computeRelativeTransform } from '../../core/useKinematicsWorker'
import { exportURDFInWorker, disposeExportWorker } from '../../core/useExportWorker'
import { serializeURDF } from '../../core/URDFSerializer'
import { useStepViewerStore } from '../../stores/useStepViewerStore'
import { useURDFStore } from '../../stores/useURDFStore'
import type { SceneManager, SelectionManager } from '../../core'
import type { GeometryFeature, SnapData } from '../../types'

interface UseURDFSceneDeps {
  getSceneManager: () => SceneManager | null
  getSelectionManager: () => SelectionManager | null
}

export function useURDFScene(deps: UseURDFSceneDeps) {
  const store = useStepViewerStore()
  const urdfStore = useURDFStore()

  let frameVisualizer: FrameVisualizer | null = null
  let forwardKinematics: ForwardKinematics | null = null
  let snapVisualizer: JointSnapVisualizer | null = null
  let baseAxisLength = 0.05
  let edgePickMode = false
  let currentSnapData: SnapData | null = null

  function getFK(): ForwardKinematics | null { return forwardKinematics }
  function isEdgePickMode(): boolean { return edgePickMode }
  function getSnapData(): SnapData | null { return currentSnapData }
  function getBaseAxisLength(): number { return baseAxisLength }

  // ========== 生命周期 ==========

  function initModules(): void {
    const sm = deps.getSceneManager()
    if (!sm) return

    const box = new THREE.Box3().setFromObject(sm.modelGroup)
    const size = box.getSize(new THREE.Vector3())
    const maxDim = Math.max(size.x, size.y, size.z)
    baseAxisLength = maxDim > 0 ? maxDim * 0.05 : 0.05
    const axisLength = baseAxisLength * urdfStore.axisHelperScale

    frameVisualizer?.dispose()
    frameVisualizer = new FrameVisualizer({ scene: sm.scene, axisLength })

    if (!forwardKinematics) {
      forwardKinematics = new ForwardKinematics()
    }

    snapVisualizer?.dispose()
    snapVisualizer = new JointSnapVisualizer({ scene: sm.scene, axisLength })

    forwardKinematics.setRobot(urdfStore.robot)
    frameVisualizer.setVisible(urdfStore.showFrames)
    updateFKAndFrames()
  }

  function updateFKAndFrames(): void {
    const sm = deps.getSceneManager()
    if (!forwardKinematics || !sm) return

    forwardKinematics.setRobot(urdfStore.robot)
    const transforms = forwardKinematics.compute()

    urdfStore.linkWorldTransforms = transforms
    forwardKinematics.applyToScene(transforms, urdfStore.robot.links, store.solidMap)

    if (frameVisualizer && urdfStore.showFrames) {
      frameVisualizer.showAllFrames(urdfStore.robot.joints)
      for (const joint of urdfStore.robot.joints) {
        const wm = forwardKinematics.getJointWorldMatrix(joint.id)
        if (wm) frameVisualizer.updateFrameTransform(joint.id, wm)
      }
      frameVisualizer.showBaseFrame(urdfStore.baseLinkOrigin, urdfStore.baseLinkRPY ?? undefined)
    }

    sm.markDirty()
  }

  function disposeModules(): void {
    frameVisualizer?.dispose()
    frameVisualizer = null
    snapVisualizer?.dispose()
    snapVisualizer = null
    forwardKinematics = null
    currentSnapData = null
    edgePickMode = false
    disposeExportWorker()
  }

  // ========== Frame Visualizer 控制 ==========

  function setFrameVisible(visible: boolean): void {
    frameVisualizer?.setVisible(visible)
  }

  function setAxisLength(scale: number): void {
    if (frameVisualizer) {
      frameVisualizer.setAxisLength(baseAxisLength * scale)
      updateFKAndFrames()
    }
  }

  // ========== Snap Visualizer ==========

  /** 处理 hover 事件的 snap 更新（从 initViewer 的 hover 回调调用） */
  function handleHoverSnap(feature: GeometryFeature | null): void {
    const sm = deps.getSceneManager()
    if (!edgePickMode || !snapVisualizer) {
      snapVisualizer?.hide()
      currentSnapData = null
      return
    }

    if (!feature) {
      snapVisualizer.hide()
      currentSnapData = null
      sm?.markDirty()
      return
    }

    if (feature.edgeCurveType === 'circle' || feature.edgeCurveType === 'arc') {
      if (feature.center && (feature.axis || feature.normal)) {
        const pos = feature.center
        const norm = (feature.axis || feature.normal)!
        snapVisualizer.updateSnap(pos, norm)
        currentSnapData = {
          position: [pos.x, pos.y, pos.z],
          normal: [norm.x, norm.y, norm.z],
          featureType: feature.edgeCurveType as 'circle' | 'arc'
        }
        sm?.markDirty()
      }
    } else if (feature.edgeCurveType === 'line') {
      if (feature.startPoint && feature.endPoint) {
        const pos = feature.startPoint
        const dir = feature.endPoint.clone().sub(feature.startPoint).normalize()
        snapVisualizer.updateSnap(pos, dir)
        currentSnapData = {
          position: [pos.x, pos.y, pos.z],
          normal: [dir.x, dir.y, dir.z],
          featureType: 'line'
        }
        sm?.markDirty()
      }
    } else {
      snapVisualizer.hide()
      currentSnapData = null
    }
  }

  function flipNormal(): void {
    if (!snapVisualizer?.isVisible()) return
    snapVisualizer.flipNormal()
    if (currentSnapData) {
      const n = snapVisualizer.getCurrentNormal()
      currentSnapData.normal = [n.x, n.y, n.z]
    }
    deps.getSceneManager()?.markDirty()
  }

  // ========== 绑定模式 ==========

  function handleBindingClick(feature: GeometryFeature): void {
    if (!urdfStore.bindingMode.active || !urdfStore.bindingMode.targetLinkId) return
    if (!feature.solidId) return

    if (urdfStore.boundSolidIds.has(feature.solidId)) {
      ElMessage.warning('该 Solid 已被其他 Link 绑定')
      return
    }

    urdfStore.bindSolid(urdfStore.bindingMode.targetLinkId, feature.solidId)
  }

  // ========== 边拾取模式 ==========

  function startEdgePickMode(): void {
    edgePickMode = true
    deps.getSelectionManager()?.setGranularityMode('edge')
  }

  function stopEdgePickMode(): void {
    edgePickMode = false
    urdfStore.edgePickEditJointId = null
    snapVisualizer?.hide()
    currentSnapData = null
    deps.getSelectionManager()?.setGranularityMode('solid')
    deps.getSceneManager()?.markDirty()
  }

  async function applyPickedEdgeToExistingJoint(jointId: string, feature: GeometryFeature): Promise<void> {
    const joint = urdfStore.jointMap.get(jointId)
    if (!joint) return

    let snapPos: [number, number, number]
    let snapNorm: [number, number, number]

    if (feature.edgeCurveType === 'line') {
      if (!feature.startPoint || !feature.endPoint) return
      const dir = feature.endPoint.clone().sub(feature.startPoint).normalize()
      snapPos = [feature.startPoint.x, feature.startPoint.y, feature.startPoint.z]
      snapNorm = [dir.x, dir.y, dir.z]
    } else {
      if (!feature.center || (!feature.axis && !feature.normal)) return
      const norm = (feature.axis || feature.normal)!
      snapPos = [feature.center.x, feature.center.y, feature.center.z]
      snapNorm = [norm.x, norm.y, norm.z]
    }

    const parentWorld = urdfStore.linkWorldTransforms.get(joint.parentLinkId)
    const parentElements = parentWorld ? parentWorld.elements : new THREE.Matrix4().elements

    const result = await computeRelativeTransform(parentElements, snapPos, snapNorm)

    joint.origin.xyz = result.xyz
    joint.origin.rpy = result.rpy
    joint.axis = [0, 0, 1]

    ElMessage.success('已更新关节参数')
  }

  function handleJointCreated(_jointId: string): void {
    urdfStore.showFrames = true
    snapVisualizer?.hide()
    currentSnapData = null
    updateFKAndFrames()
  }

  // ========== URDF 导出 ==========

  async function handleExportURDF(exportCompleteAdVisible: { value: boolean }): Promise<void> {

    const orphans = urdfStore.findOrphanLinks()
    if (orphans.length > 0) {
      ElMessage.warning(`以下 Link 未被任何 Joint 连接: ${orphans.join(', ')}`)
    }

    urdfStore.exporting = true
    urdfStore.exportProgress = '正在生成 URDF...'

    const savedValues = urdfStore.robot.joints.map(j => j.currentValue)
    urdfStore.robot.joints.forEach(j => { j.currentValue = 0 })

    try {
      const fk = forwardKinematics ?? new ForwardKinematics()
      fk.setRobot(urdfStore.robot)

      const linkRestInverses = new Map<string, THREE.Matrix4>()
      for (const link of urdfStore.robot.links) {
        const rest = fk.getLinkRestTransform(link.id)
        if (rest) linkRestInverses.set(link.id, rest.clone().invert())
      }

      let basePoseInverseForExport: THREE.Matrix4 | undefined
      const bOrigin = urdfStore.baseLinkOrigin
      const bRPY = urdfStore.baseLinkRPY
      if (bOrigin || bRPY) {
        const o = bOrigin ?? [0, 0, 0]
        const r = bRPY ?? [0, 0, 0]
        const T = new THREE.Matrix4().makeTranslation(o[0], o[1], o[2])
        const R = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(r[0], r[1], r[2], 'ZYX'))
        const basePoseMatrix = new THREE.Matrix4().multiplyMatrices(T, R)
        basePoseInverseForExport = basePoseMatrix.clone().invert()
        linkRestInverses.set(urdfStore.BASE_LINK_ID, basePoseInverseForExport)
      }

      const urdfXml = serializeURDF(urdfStore.robot, {
        linkRestInverses,
        unitScale: 0.001,
        basePoseInverse: basePoseInverseForExport,
        baseLinkId: urdfStore.BASE_LINK_ID
      })

      const linkSolidMap: Record<string, import('../../types').SerializedSolidData[]> = {}
      const linkRestInverseMap: Record<string, number[]> = {}

      for (const link of urdfStore.robot.links) {
        if (link.solidIds.length === 0) continue
        const solidDataList: import('../../types').SerializedSolidData[] = []
        for (const solidId of link.solidIds) {
          const solid = store.solidMap.get(solidId)
          if (solid?.serializedData) solidDataList.push(solid.serializedData)
        }
        if (solidDataList.length > 0) {
          linkSolidMap[link.name] = solidDataList
          const inv = linkRestInverses.get(link.id)
          if (inv) linkRestInverseMap[link.name] = Array.from(inv.elements)
        }
      }

      const zipBuffer = await exportURDFInWorker(
        urdfXml,
        linkSolidMap,
        linkRestInverseMap,
        0.001,
        (stage, _percent) => { urdfStore.exportProgress = stage }
      )

      const blob = new Blob([zipBuffer], { type: 'application/zip' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${urdfStore.robot.name}.zip`
      a.click()
      URL.revokeObjectURL(url)

      ElMessage.success('URDF 导出成功')
      exportCompleteAdVisible.value = true
    } catch (err) {
      ElMessage.error(`导出失败: ${(err as Error).message}`)
    } finally {
      urdfStore.robot.joints.forEach((j, i) => { j.currentValue = savedValues[i] })
      updateFKAndFrames()
      urdfStore.exporting = false
      urdfStore.exportProgress = ''
    }
  }

  return {
    // 生命周期
    initModules,
    updateFKAndFrames,
    disposeModules,
    // 访问器
    getFK,
    isEdgePickMode,
    getSnapData,
    getBaseAxisLength,
    // Frame 控制
    setFrameVisible,
    setAxisLength,
    // Snap / Hover
    handleHoverSnap,
    flipNormal,
    // 绑定 & 边拾取
    handleBindingClick,
    startEdgePickMode,
    stopEdgePickMode,
    applyPickedEdgeToExistingJoint,
    handleJointCreated,
    // 导出
    handleExportURDF,
  }
}
