/**
 * 自由画线测量工具
 * 支持在 3D 空间中自由画直线并自动计算距离
 * 支持多条线同时存在，完善的状态管理
 */

import * as THREE from 'three'
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js'
import type { ArcballControls } from 'three/examples/jsm/controls/ArcballControls.js'

/**
 * 单条线测量数据
 */
export interface LineMeasurementData {
  id: string
  start: THREE.Vector3
  end: THREE.Vector3
  distance: number
  label: string
}

/**
 * 内部线测量状态（含 3D 对象引用）
 */
interface LineMeasurementInternal {
  data: LineMeasurementData
  line: THREE.Line
  startMarker: THREE.Mesh
  endMarker: THREE.Mesh
  label: CSS2DObject
}

/**
 * 画线测量工具配置
 */
export interface LineMeasurementToolConfig {
  scene: THREE.Scene
  camera: THREE.Camera
  domElement: HTMLElement
  container: HTMLElement
  controls: ArcballControls
  labelRenderer?: CSS2DRenderer
  /** 请求渲染回调 */
  onRenderRequest?: () => void
  /** 新线完成回调 */
  onLineAdded?: (line: LineMeasurementData) => void
  /** 线被删除回调 */
  onLineRemoved?: (id: string) => void
}

/**
 * 画线测量工具
 */
export class LineMeasurementTool {
  private scene: THREE.Scene
  private camera: THREE.Camera
  private domElement: HTMLElement
  private container: HTMLElement
  private controls: ArcballControls
  private labelRenderer?: CSS2DRenderer
  private raycaster: THREE.Raycaster
  private mouse: THREE.Vector2

  // 回调
  private onRenderRequest?: () => void
  private onLineAdded?: (line: LineMeasurementData) => void
  private onLineRemoved?: (id: string) => void

  // 状态
  private _isActive = false
  private currentStart: THREE.Vector3 | null = null
  private idCounter = 0

  // 3D 对象组
  private measureGroup: THREE.Group
  private completedLines: Map<string, LineMeasurementInternal> = new Map()

  // 预览线（正在画的线）
  private previewLine: THREE.Line | null = null
  private previewLabel: CSS2DObject | null = null
  private previewStartMarker: THREE.Mesh | null = null

  // 样式配置
  private readonly LINE_COLOR = 0x00aaff
  private readonly PREVIEW_COLOR = 0x00aaff
  private readonly MARKER_RADIUS = 0.8
  private readonly MARKER_COLOR = 0x00aaff

  // DOM 事件句柄（绑定解绑用）
  private boundHandleClick: (e: MouseEvent) => void
  private boundHandleMouseMove: (e: MouseEvent) => void
  private boundHandleKeyDown: (e: KeyboardEvent) => void
  private boundHandleContextMenu: (e: MouseEvent) => void

  // 拖拽检测
  private mouseDownPos = { x: 0, y: 0 }
  private isDragging = false
  private readonly DRAG_THRESHOLD = 5
  private boundHandleMouseDown: (e: MouseEvent) => void
  private boundHandleMouseUp: (e: MouseEvent) => void

  // 缓存可见 meshes 用于 raycasting
  private cachedMeshes: THREE.Mesh[] = []
  private cachedRect: DOMRect | null = null

  constructor(config: LineMeasurementToolConfig) {
    this.scene = config.scene
    this.camera = config.camera
    this.domElement = config.domElement
    this.container = config.container
    this.controls = config.controls
    this.labelRenderer = config.labelRenderer
    this.onRenderRequest = config.onRenderRequest
    this.onLineAdded = config.onLineAdded
    this.onLineRemoved = config.onLineRemoved

    this.raycaster = new THREE.Raycaster()
    this.mouse = new THREE.Vector2()

    // 创建测量组
    this.measureGroup = new THREE.Group()
    this.measureGroup.name = 'LineMeasurementGroup'
    this.scene.add(this.measureGroup)

    // 绑定事件句柄
    this.boundHandleClick = this.handleClick.bind(this)
    this.boundHandleMouseMove = this.handleMouseMove.bind(this)
    this.boundHandleKeyDown = this.handleKeyDown.bind(this)
    this.boundHandleContextMenu = this.handleContextMenu.bind(this)
    this.boundHandleMouseDown = this.handleMouseDown.bind(this)
    this.boundHandleMouseUp = this.handleMouseUp.bind(this)
  }

  // ========== 公共 API ==========

  get isActive(): boolean {
    return this._isActive
  }

  /**
   * 激活画线模式
   */
  activate(): void {
    if (this._isActive) return
    this._isActive = true
    this.updateCachedMeshes()
    this.cachedRect = this.domElement.getBoundingClientRect()

    // 绑定事件
    this.domElement.addEventListener('click', this.boundHandleClick)
    this.domElement.addEventListener('mousemove', this.boundHandleMouseMove)
    this.domElement.addEventListener('mousedown', this.boundHandleMouseDown)
    this.domElement.addEventListener('mouseup', this.boundHandleMouseUp)
    this.domElement.addEventListener('contextmenu', this.boundHandleContextMenu)
    window.addEventListener('keydown', this.boundHandleKeyDown)

    // 更改光标
    this.domElement.style.cursor = 'crosshair'
  }

  /**
   * 退出画线模式
   */
  deactivate(): void {
    if (!this._isActive) return
    this._isActive = false

    // 取消当前画线
    this.cancelCurrentLine()

    // 解绑事件
    this.domElement.removeEventListener('click', this.boundHandleClick)
    this.domElement.removeEventListener('mousemove', this.boundHandleMouseMove)
    this.domElement.removeEventListener('mousedown', this.boundHandleMouseDown)
    this.domElement.removeEventListener('mouseup', this.boundHandleMouseUp)
    this.domElement.removeEventListener('contextmenu', this.boundHandleContextMenu)
    window.removeEventListener('keydown', this.boundHandleKeyDown)

    // 恢复光标
    this.domElement.style.cursor = ''
  }

  /**
   * 删除指定线
   */
  removeLine(id: string): void {
    const line = this.completedLines.get(id)
    if (!line) return

    this.measureGroup.remove(line.line)
    this.measureGroup.remove(line.startMarker)
    this.measureGroup.remove(line.endMarker)
    this.measureGroup.remove(line.label)

    // 释放资源
    line.line.geometry.dispose()
      ; (line.line.material as THREE.Material).dispose()
    line.startMarker.geometry.dispose()
      ; (line.startMarker.material as THREE.Material).dispose()
    line.endMarker.geometry.dispose()
      ; (line.endMarker.material as THREE.Material).dispose()

    this.completedLines.delete(id)
    this.onLineRemoved?.(id)
    this.onRenderRequest?.()
  }

  /**
   * 清除所有线
   */
  clearAll(): void {
    const ids = Array.from(this.completedLines.keys())
    ids.forEach(id => {
      const line = this.completedLines.get(id)
      if (line) {
        this.measureGroup.remove(line.line)
        this.measureGroup.remove(line.startMarker)
        this.measureGroup.remove(line.endMarker)
        this.measureGroup.remove(line.label)
        line.line.geometry.dispose()
          ; (line.line.material as THREE.Material).dispose()
        line.startMarker.geometry.dispose()
          ; (line.startMarker.material as THREE.Material).dispose()
        line.endMarker.geometry.dispose()
          ; (line.endMarker.material as THREE.Material).dispose()
      }
    })
    this.completedLines.clear()
    this.cancelCurrentLine()
    this.onRenderRequest?.()
  }

  /**
   * 获取所有线数据
   */
  getLines(): LineMeasurementData[] {
    return Array.from(this.completedLines.values()).map(l => l.data)
  }

  /**
   * 销毁
   */
  dispose(): void {
    this.deactivate()
    this.clearAll()
    this.scene.remove(this.measureGroup)
  }

  // ========== 内部方法 ==========

  /**
   * 更新缓存的可见 meshes
   */
  private updateCachedMeshes(): void {
    const meshes: THREE.Mesh[] = []
    this.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh && obj.visible && obj !== this.previewStartMarker) {
        // 排除测量组内的对象
        let isMeasureObj = false
        let parent = obj.parent
        while (parent) {
          if (parent === this.measureGroup) {
            isMeasureObj = true
            break
          }
          parent = parent.parent
        }
        if (!isMeasureObj) meshes.push(obj)
      }
    })
    this.cachedMeshes = meshes
  }

  /**
   * 获取鼠标射线与场景的交点
   * 优先命中模型表面；如果没有模型命中，投射到参考平面
   */
  private getPoint(event: MouseEvent): THREE.Vector3 | null {
    const rect = this.cachedRect || this.domElement.getBoundingClientRect()
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1

    this.raycaster.setFromCamera(this.mouse, this.camera)

    // 尝试命中模型
    const intersects = this.raycaster.intersectObjects(this.cachedMeshes, false)
    if (intersects.length > 0) {
      return intersects[0].point.clone()
    }

    // 投射到参考平面（过 currentStart 或场景中心，面朝相机）
    const planeCenter = this.currentStart
      ? this.currentStart.clone()
      : new THREE.Vector3(0, 0, 0)
    const cameraDir = new THREE.Vector3()
    this.camera.getWorldDirection(cameraDir)
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
      cameraDir.negate(),
      planeCenter
    )
    const target = new THREE.Vector3()
    const ray = this.raycaster.ray
    const hit = ray.intersectPlane(plane, target)
    return hit ? target : null
  }

  // ========== 事件处理 ==========

  private handleMouseDown(event: MouseEvent): void {
    this.mouseDownPos.x = event.clientX
    this.mouseDownPos.y = event.clientY
    this.isDragging = false
  }

  private handleMouseUp(_event: MouseEvent): void {
    this.isDragging = false
  }

  private handleClick(event: MouseEvent): void {
    // 检查是否是拖动
    const dx = event.clientX - this.mouseDownPos.x
    const dy = event.clientY - this.mouseDownPos.y
    if (Math.sqrt(dx * dx + dy * dy) > this.DRAG_THRESHOLD) return

    const point = this.getPoint(event)
    if (!point) return

    if (!this.currentStart) {
      // 第一次点击：设定起点
      this.currentStart = point
      this.createPreviewStartMarker(point)
    } else {
      // 第二次点击：完成线段
      this.completeLine(point)
    }
  }

  private handleMouseMove(event: MouseEvent): void {
    if (!this.currentStart) return

    // 检测拖拽中（旋转/平移）
    if (event.buttons !== 0) {
      const dx = event.clientX - this.mouseDownPos.x
      const dy = event.clientY - this.mouseDownPos.y
      if (Math.sqrt(dx * dx + dy * dy) > this.DRAG_THRESHOLD) {
        this.isDragging = true
        return
      }
    }

    const point = this.getPoint(event)
    if (!point) return

    this.updatePreviewLine(point)
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.cancelCurrentLine()
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      // 删除最后一条完成的线
      const keys = Array.from(this.completedLines.keys())
      if (keys.length > 0) {
        this.removeLine(keys[keys.length - 1])
      }
    }
  }

  private handleContextMenu(event: MouseEvent): void {
    event.preventDefault()
    // 右键取消当前画线
    this.cancelCurrentLine()
  }

  // ========== 画线逻辑 ==========

  /**
   * 创建起点标记
   */
  private createPreviewStartMarker(point: THREE.Vector3): void {
    const geo = new THREE.SphereGeometry(this.MARKER_RADIUS, 12, 12)
    const mat = new THREE.MeshBasicMaterial({
      color: this.MARKER_COLOR,
      depthTest: false,
      transparent: true,
      opacity: 0.8
    })
    this.previewStartMarker = new THREE.Mesh(geo, mat)
    this.previewStartMarker.position.copy(point)
    this.previewStartMarker.renderOrder = 999
    this.measureGroup.add(this.previewStartMarker)
    this.onRenderRequest?.()
  }

  /**
   * 更新预览线和实时距离标签
   */
  private updatePreviewLine(endPoint: THREE.Vector3): void {
    if (!this.currentStart) return

    // 更新或创建预览线
    if (this.previewLine) {
      const positions = this.previewLine.geometry.getAttribute('position') as THREE.BufferAttribute
      positions.setXYZ(0, this.currentStart.x, this.currentStart.y, this.currentStart.z)
      positions.setXYZ(1, endPoint.x, endPoint.y, endPoint.z)
      positions.needsUpdate = true
      this.previewLine.geometry.computeBoundingSphere()
    } else {
      const geometry = new THREE.BufferGeometry()
      const positions = new Float32Array(6)
      positions[0] = this.currentStart.x
      positions[1] = this.currentStart.y
      positions[2] = this.currentStart.z
      positions[3] = endPoint.x
      positions[4] = endPoint.y
      positions[5] = endPoint.z
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))

      const material = new THREE.LineDashedMaterial({
        color: this.PREVIEW_COLOR,
        dashSize: 6,
        gapSize: 2,
        linewidth: 2,
        depthTest: false,
        transparent: true,
        opacity: 0.7
      })

      this.previewLine = new THREE.Line(geometry, material)
      this.previewLine.computeLineDistances()
      this.previewLine.renderOrder = 999
      this.measureGroup.add(this.previewLine)
    }

    // 计算距离
    const distance = this.currentStart.distanceTo(endPoint)
    const midPoint = this.currentStart.clone().add(endPoint).multiplyScalar(0.5)

    // 更新或创建距离标签
    if (this.previewLabel) {
      this.previewLabel.position.copy(midPoint)
      const div = this.previewLabel.element as HTMLDivElement
      div.textContent = `${distance.toFixed(2)} mm`
    } else {
      const div = document.createElement('div')
      div.textContent = `${distance.toFixed(2)} mm`
      div.style.cssText = `
        background: rgba(0, 170, 255, 0.9);
        color: #fff;
        padding: 3px 8px;
        border-radius: 4px;
        font-size: 12px;
        font-weight: 600;
        white-space: nowrap;
        pointer-events: none;
      `
      this.previewLabel = new CSS2DObject(div)
      this.previewLabel.position.copy(midPoint)
      this.measureGroup.add(this.previewLabel)
    }

    // 需要重新计算虚线距离
    this.previewLine.computeLineDistances()
    this.onRenderRequest?.()
  }

  /**
   * 完成一条线
   */
  private completeLine(endPoint: THREE.Vector3): void {
    if (!this.currentStart) return

    const distance = this.currentStart.distanceTo(endPoint)
    const midPoint = this.currentStart.clone().add(endPoint).multiplyScalar(0.5)

    const id = `line_measure_${++this.idCounter}_${Date.now()}`

    const data: LineMeasurementData = {
      id,
      start: this.currentStart.clone(),
      end: endPoint.clone(),
      distance,
      label: `${distance.toFixed(2)} mm`
    }

    // 创建正式线段
    const lineGeo = new THREE.BufferGeometry().setFromPoints([
      this.currentStart.clone(),
      endPoint.clone()
    ])
    const lineMat = new THREE.LineBasicMaterial({
      color: this.LINE_COLOR,
      linewidth: 2,
      depthTest: false,
      transparent: true,
      opacity: 0.9
    })
    const line = new THREE.Line(lineGeo, lineMat)
    line.renderOrder = 998
    this.measureGroup.add(line)

    // 起点标记
    const startGeo = new THREE.SphereGeometry(this.MARKER_RADIUS, 12, 12)
    const markerMat = new THREE.MeshBasicMaterial({
      color: this.MARKER_COLOR,
      depthTest: false,
      transparent: true,
      opacity: 0.85
    })
    const startMarker = new THREE.Mesh(startGeo, markerMat)
    startMarker.position.copy(this.currentStart)
    startMarker.renderOrder = 999
    this.measureGroup.add(startMarker)

    // 终点标记
    const endGeo = new THREE.SphereGeometry(this.MARKER_RADIUS, 12, 12)
    const endMarkerMat = new THREE.MeshBasicMaterial({
      color: this.MARKER_COLOR,
      depthTest: false,
      transparent: true,
      opacity: 0.85
    })
    const endMarker = new THREE.Mesh(endGeo, endMarkerMat)
    endMarker.position.copy(endPoint)
    endMarker.renderOrder = 999
    this.measureGroup.add(endMarker)

    // 标签
    const div = document.createElement('div')
    div.textContent = data.label
    div.style.cssText = `
      background: rgba(0, 170, 255, 0.95);
      color: #fff;
      padding: 4px 10px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 600;
      white-space: nowrap;
      box-shadow: 0 2px 6px rgba(0,0,0,0.15);
      pointer-events: none;
    `
    const label = new CSS2DObject(div)
    label.position.copy(midPoint)
    this.measureGroup.add(label)

    // 保存
    this.completedLines.set(id, {
      data,
      line,
      startMarker,
      endMarker,
      label
    })

    // 清除预览
    this.cleanupPreview()
    this.currentStart = null

    // 通知
    this.onLineAdded?.(data)
    this.onRenderRequest?.()
  }

  /**
   * 取消当前正在画的线
   */
  private cancelCurrentLine(): void {
    this.cleanupPreview()
    this.currentStart = null
    this.onRenderRequest?.()
  }

  /**
   * 清理预览 3D 对象
   */
  private cleanupPreview(): void {
    if (this.previewLine) {
      this.measureGroup.remove(this.previewLine)
      this.previewLine.geometry.dispose()
        ; (this.previewLine.material as THREE.Material).dispose()
      this.previewLine = null
    }
    if (this.previewLabel) {
      this.measureGroup.remove(this.previewLabel)
      this.previewLabel = null
    }
    if (this.previewStartMarker) {
      this.measureGroup.remove(this.previewStartMarker)
      this.previewStartMarker.geometry.dispose()
        ; (this.previewStartMarker.material as THREE.Material).dispose()
      this.previewStartMarker = null
    }
  }
}

export default LineMeasurementTool
