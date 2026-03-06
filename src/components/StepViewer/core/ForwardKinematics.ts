/**
 * 正向运动学 (Forward Kinematics) 引擎
 * 从 URDF Joint 数据构建运动学树，计算每个 Link 的世界变换矩阵
 */

import * as THREE from 'three'
import type { URDFRobot, URDFJoint, URDFLink, SolidObject } from '../types'

export class ForwardKinematics {
  private robot: URDFRobot | null = null

  /** 缓存：linkId → world Matrix4 */
  private linkTransforms = new Map<string, THREE.Matrix4>()

  /** 静息变换：linkId → value=0 时的世界矩阵（用于 delta 计算） */
  private restTransforms = new Map<string, THREE.Matrix4>()

  /** 运动学树：parentLinkId → {joint, childLinkId}[] */
  private kinematicTree = new Map<string, { joint: URDFJoint; childLinkId: string }[]>()

  /** 根 Link ID 列表 */
  private rootLinkIds: string[] = []

  /**
   * 设置机器人模型并构建运动学树
   */
  setRobot(robot: URDFRobot): void {
    this.robot = robot
    this.buildTree()
  }

  /**
   * 构建运动学树结构
   */
  private buildTree(): void {
    if (!this.robot) return
    this.kinematicTree.clear()

    const childIds = new Set<string>()

    for (const joint of this.robot.joints) {
      const children = this.kinematicTree.get(joint.parentLinkId) || []
      children.push({ joint, childLinkId: joint.childLinkId })
      this.kinematicTree.set(joint.parentLinkId, children)
      childIds.add(joint.childLinkId)
    }

    this.rootLinkIds = this.robot.links
      .filter(l => !childIds.has(l.id))
      .map(l => l.id)

    // 构建静息变换（所有 joint value=0，无运动分量）
    this.restTransforms.clear()
    const identity = new THREE.Matrix4()
    for (const rootId of this.rootLinkIds) {
      this.computeRestRecursive(rootId, identity)
    }
  }

  /**
   * 递归计算静息变换（仅 origin 平移/旋转，不含 joint motion）
   */
  private computeRestRecursive(linkId: string, parentWorld: THREE.Matrix4): void {
    this.restTransforms.set(linkId, parentWorld.clone())
    const children = this.kinematicTree.get(linkId)
    if (!children) return
    for (const { joint, childLinkId } of children) {
      const restLocal = this.computeJointRestMatrix(joint)
      const childRest = new THREE.Matrix4().multiplyMatrices(parentWorld, restLocal)
      this.computeRestRecursive(childLinkId, childRest)
    }
  }

  /**
   * 计算 Joint 静息矩阵 = T(origin.xyz + axisOffset) × R(origin.rpy)，不含运动分量
   */
  private computeJointRestMatrix(joint: URDFJoint): THREE.Matrix4 {
    const offset = joint.axisOffset || [0, 0, 0]
    const translation = new THREE.Matrix4().makeTranslation(
      joint.origin.xyz[0] + offset[0],
      joint.origin.xyz[1] + offset[1],
      joint.origin.xyz[2] + offset[2]
    )
    const [roll, pitch, yaw] = joint.origin.rpy
    const euler = new THREE.Euler(roll, pitch, yaw, 'ZYX')
    const rotation = new THREE.Matrix4().makeRotationFromEuler(euler)
    return new THREE.Matrix4().multiplyMatrices(translation, rotation)
  }

  /**
   * 计算正向运动学
   * @returns linkId → 世界变换矩阵 Map
   */
  compute(): Map<string, THREE.Matrix4> {
    this.linkTransforms.clear()
    if (!this.robot) return this.linkTransforms

    // 从每个根节点开始递归计算
    const identity = new THREE.Matrix4()
    for (const rootId of this.rootLinkIds) {
      this.computeRecursive(rootId, identity)
    }

    return this.linkTransforms
  }

  /**
   * 递归计算子树变换
   */
  private computeRecursive(linkId: string, parentWorldMatrix: THREE.Matrix4): void {
    this.linkTransforms.set(linkId, parentWorldMatrix.clone())

    const children = this.kinematicTree.get(linkId)
    if (!children) return

    for (const { joint, childLinkId } of children) {
      // Joint 局部变换 = origin 平移旋转 × joint 运动变换
      const jointLocalMatrix = this.computeJointMatrix(joint)
      const childWorldMatrix = new THREE.Matrix4().multiplyMatrices(parentWorldMatrix, jointLocalMatrix)
      this.computeRecursive(childLinkId, childWorldMatrix)
    }
  }

  /**
   * 计算单个 Joint 的局部变换矩阵
   * = T(origin.xyz + axisOffset) × R(origin.rpy) × R(axis, value) 或 T(axis, value)
   */
  private computeJointMatrix(joint: URDFJoint): THREE.Matrix4 {
    const matrix = new THREE.Matrix4()

    // 1. Origin 平移（包含 axisOffset）
    const offset = joint.axisOffset || [0, 0, 0]
    const translation = new THREE.Matrix4().makeTranslation(
      joint.origin.xyz[0] + offset[0],
      joint.origin.xyz[1] + offset[1],
      joint.origin.xyz[2] + offset[2]
    )

    // 2. Origin 旋转 (RPY → ZYX intrinsic = extrinsic XYZ, URDF 标准)
    const [roll, pitch, yaw] = joint.origin.rpy
    const euler = new THREE.Euler(roll, pitch, yaw, 'ZYX')
    const rotation = new THREE.Matrix4().makeRotationFromEuler(euler)

    // 3. Joint 运动变换
    const jointMotion = new THREE.Matrix4()
    const axis = new THREE.Vector3(...joint.axis).normalize()

    switch (joint.type) {
      case 'revolute':
        jointMotion.makeRotationAxis(axis, joint.currentValue)
        break
      case 'prismatic':
        jointMotion.makeTranslation(
          axis.x * joint.currentValue,
          axis.y * joint.currentValue,
          axis.z * joint.currentValue
        )
        break
      case 'fixed':
        // 恒等变换
        break
    }

    // 组合: parent × T(xyz) × R(rpy) × motion
    matrix.multiplyMatrices(translation, rotation)
    matrix.multiply(jointMotion)

    return matrix
  }

  /**
   * 将 FK 结果应用到 3D 场景中的 Mesh
   *
   * STEP 模型的几何体已在世界坐标系中（mesh 初始为 identity），
   * 因此需要计算 delta = currentWorld × restWorld⁻¹ 来保持 value=0 时几何体不移动，
   * 仅在 joint 运动时产生正确的相对变换。
   */
  applyToScene(
    linkTransforms: Map<string, THREE.Matrix4>,
    links: URDFLink[],
    solidMap: Map<string, SolidObject>
  ): void {
    for (const link of links) {
      const worldMatrix = linkTransforms.get(link.id)
      if (!worldMatrix) continue

      // delta = current × rest⁻¹
      const restMatrix = this.restTransforms.get(link.id)
      let applyMatrix: THREE.Matrix4
      if (restMatrix) {
        const restInverse = restMatrix.clone().invert()
        applyMatrix = new THREE.Matrix4().multiplyMatrices(worldMatrix, restInverse)
      } else {
        applyMatrix = worldMatrix
      }

      for (const solidId of link.solidIds) {
        const solid = solidMap.get(solidId)
        if (!solid?.mesh) continue

        // InstancedMesh 的情况需要特殊处理
        if (solid.instanceId !== undefined) {
          const instancedMesh = solid.mesh as unknown as THREE.InstancedMesh
          instancedMesh.setMatrixAt(solid.instanceId, applyMatrix)
          instancedMesh.instanceMatrix.needsUpdate = true
        } else {
          solid.mesh.matrixAutoUpdate = false
          solid.mesh.matrix.copy(applyMatrix)
          solid.mesh.matrixWorldNeedsUpdate = true
        }
      }
    }
  }

  /**
   * 重置所有 Mesh 变换为恒等矩阵
   */
  resetScene(links: URDFLink[], solidMap: Map<string, SolidObject>): void {
    const identity = new THREE.Matrix4()
    for (const link of links) {
      for (const solidId of link.solidIds) {
        const solid = solidMap.get(solidId)
        if (!solid?.mesh) continue

        if (solid.instanceId !== undefined) {
          const instancedMesh = solid.mesh as unknown as THREE.InstancedMesh
          instancedMesh.setMatrixAt(solid.instanceId, identity)
          instancedMesh.instanceMatrix.needsUpdate = true
        } else {
          solid.mesh.matrixAutoUpdate = true
          solid.mesh.matrix.identity()
          solid.mesh.matrixWorldNeedsUpdate = true
        }
      }
    }
  }

  /**
   * 获取某个 Link 的静息世界矩阵（value=0 时的 FK 结果）
   * 导出 STL 时用于将世界坐标转换到 Link 局部空间
   */
  getLinkRestTransform(linkId: string): THREE.Matrix4 | null {
    return this.restTransforms.get(linkId)?.clone() ?? null
  }

  /**
   * 获取某个 Joint 的世界变换（用于坐标系可视化）
   */
  getJointWorldMatrix(jointId: string): THREE.Matrix4 | null {
    if (!this.robot) return null
    const joint = this.robot.joints.find(j => j.id === jointId)
    if (!joint) return null

    // Joint 的世界矩阵 = parent link 的世界矩阵 × joint local matrix
    const parentWorldMatrix = this.linkTransforms.get(joint.parentLinkId) || new THREE.Matrix4()
    const jointLocal = this.computeJointMatrix(joint)
    return new THREE.Matrix4().multiplyMatrices(parentWorldMatrix, jointLocal)
  }

  dispose(): void {
    this.linkTransforms.clear()
    this.restTransforms.clear()
    this.kinematicTree.clear()
    this.robot = null
  }
}
