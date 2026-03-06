/**
 * 选择管理器
 * 处理特征选择、hover 高亮和多选功能
 *
 * 性能优化说明:
 * 1. hover 检测使用 RAF 节流，与屏幕刷新率同步
 * 2. hover 高亮使用 emissive 颜色变化而非材质切换
 * 3. 缓存 domRect 避免强制回流
 * 4. 缓存 visibleMeshes 避免重复创建数组
 * 5. 构建特征索引 Map 加速查找
 * 6. 支持 InstancedMesh，通过 instanceId 映射到 SolidObject
 */

import * as THREE from 'three'
import type { ArcballControls } from 'three/examples/jsm/controls/ArcballControls.js'
import type {
  GeometryFeature,
  SolidObject,
  SelectionInfo,
  GranularityMode
} from '../types'

/**
 * RAF 节流函数 - 与屏幕刷新率同步
 */
function rafThrottle<T extends (...args: any[]) => void>(
  fn: T
): T & { cancel: () => void } {
  let rafId: number | null = null
  let lastArgs: Parameters<T> | null = null

  const throttled = function (this: any, ...args: Parameters<T>) {
    lastArgs = args
    if (rafId === null) {
      rafId = requestAnimationFrame(() => {
        rafId = null
        if (lastArgs) {
          fn.apply(this, lastArgs)
          lastArgs = null
        }
      })
    }
  } as T & { cancel: () => void }

  throttled.cancel = () => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
    lastArgs = null
  }

  return throttled
}

/**
 * 选择管理器配置
 */
export interface SelectionManagerConfig {
  camera: THREE.Camera
  scene: THREE.Scene
  domElement: HTMLElement
  /** ArcballControls 引用，用于精确检测拖动/旋转操作 */
  controls?: ArcballControls
  highlightColor?: number
  selectionColor?: number
  /** hover / 选择变化后请求重新渲染 */
  onRenderRequest?: () => void
}

/**
 * 选择事件
 */
export interface SelectionEvent {
  selections: SelectionInfo[]
  added?: SelectionInfo
  removed?: SelectionInfo
  /** 选中的树节点 ID 列表 */
  selectedTreeNodeIds?: string[]
}

/**
 * 选择管理器类
 */
export class SelectionManager {
  private camera: THREE.Camera
  private scene: THREE.Scene
  private domElement: HTMLElement
  private raycaster: THREE.Raycaster
  private mouse: THREE.Vector2

  // 颜色配置
  private highlightColor: number
  private selectionColor: number

  // 选择状态
  private solids: SolidObject[] = []
  private selectedSolids: Set<string> = new Set()
  private selectedFeatures: Map<string, GeometryFeature> = new Map()
  /** 是否启用交互（画线测量模式时禁用） */
  private enabled = true

  /** 选择模式：single = 默认单选，multi = 多选 */
  private selectionMode: 'single' | 'multi' = 'single'

  // 面级高亮覆盖层（overlay mesh 方式，同时支持 Regular Mesh 和 InstancedMesh）
  private faceHighlightOverlays: Map<string, THREE.Mesh> = new Map()
  private faceHighlightMaterial!: THREE.MeshStandardMaterial

  // 边级高亮覆盖层
  private edgeHighlightOverlays: Map<string, THREE.LineSegments> = new Map()
  private edgeHighlightMaterial!: THREE.LineBasicMaterial
  /** hover 时的临时边覆盖层 */
  private hoverEdgeOverlay: THREE.LineSegments | null = null

  // 选择粒度模式
  private granularityMode: GranularityMode = 'solid'
  /** edge 拾取专用 raycaster（线段拾取需要独立 threshold） */
  private edgeRaycaster: THREE.Raycaster

  // Hover 状态（纯 3D 视觉效果，不与树联动）
  private hoveredFeature: GeometryFeature | null = null
  private hoveredMesh: THREE.Mesh | null = null
  private hoveredBrepFaceIndex: number = -1
  private hoveredSolid: SolidObject | null = null
  /** Regular Mesh hover: 保存原始 emissive */
  private originalEmissive: THREE.Color | null = null

  // 高亮材质缓存（用于选中状态 - 仅 Regular Mesh）
  private highlightMaterials: Map<string, THREE.MeshStandardMaterial> = new Map()
  private originalMaterials: Map<string, THREE.Material | THREE.Material[]> = new Map()

  // InstancedMesh 选中状态：保存原始 instanceColor
  private originalInstanceColors: Map<string, THREE.Color> = new Map()
  /** InstancedMesh 实例引用缓存 (uuid → InstancedMesh) */
  private instancedMeshRefs: Map<string, THREE.InstancedMesh> = new Map()

  // 事件回调
  private onSelectCallback?: (event: SelectionEvent) => void
  private onHoverCallback?: (feature: GeometryFeature | null) => void
  private onRenderRequest?: () => void

  // 边缘线高亮颜色
  private static readonly EDGE_DEFAULT_COLOR = 0x333333
  private static readonly EDGE_HOVER_COLOR = 0xffdd00
  private static readonly EDGE_SELECTED_COLOR = 0xff4400
  private static readonly EDGE_DEFAULT_OPACITY = 0.6
  private static readonly EDGE_HIGHLIGHT_OPACITY = 1.0

  // 性能优化相关
  private rafThrottledMouseMove: ((event: MouseEvent) => void) & { cancel: () => void }
  private isDragging = false
  private mouseDownPos = { x: 0, y: 0 }
  private readonly DRAG_THRESHOLD = 5
  private lastHoverX = 0
  private lastHoverY = 0
  private readonly HOVER_PIXEL_THRESHOLD_SQ = 9

  // ArcballControls 拖动检测
  private orbitControls: ArcballControls | null = null
  private isOrbitActive = false

  // 缓存优化
  private cachedRect: DOMRect | null = null
  private cachedMeshes: THREE.Mesh[] = []
  private featureIndexMap: Map<string, Map<number, GeometryFeature>> = new Map()
  /** 边特征索引 Map: solidId → Map<edgeIndex, GeometryFeature> */
  private edgeIndexMap: Map<string, Map<number, GeometryFeature>> = new Map()
  /** 拓扑边线段缓存（用于边粒度模式的 raycaster） */
  private cachedTopologyEdges: THREE.LineSegments[] = []
  /** Regular Mesh → SolidObject */
  private meshToSolid: Map<THREE.Mesh, SolidObject> = new Map()
  /** solidId → SolidObject O(1) 查找 */
  private solidIdMap: Map<string, SolidObject> = new Map()
  /** InstancedMesh UUID → (instanceId → SolidObject) */
  private instancedMeshToSolids: Map<string, Map<number, SolidObject>> = new Map()
  private resizeObserver: ResizeObserver | null = null

  constructor(config: SelectionManagerConfig) {
    this.camera = config.camera
    this.scene = config.scene
    this.domElement = config.domElement
    this.raycaster = new THREE.Raycaster()
    this.mouse = new THREE.Vector2()
    this.onRenderRequest = config.onRenderRequest

    // 优化射线检测参数
    this.raycaster.params.Line = { threshold: 1 }
    this.raycaster.params.Points = { threshold: 1 }
      // BVH firstHitOnly 优化：只返回最近交点
      ; (this.raycaster as any).firstHitOnly = true

    this.highlightColor = config.highlightColor ?? 0x00ff00
    this.selectionColor = config.selectionColor ?? 0xff8800

    // RAF 节流的 hover 检测
    this.rafThrottledMouseMove = rafThrottle(this.performHoverCheck.bind(this))

    // 边拾取专用 raycaster
    this.edgeRaycaster = new THREE.Raycaster()
    this.edgeRaycaster.params.Line = { threshold: 2 }

    // 初始化 domRect 缓存
    this.updateCachedRect()

    // 监听 resize 更新缓存
    this.resizeObserver = new ResizeObserver(() => {
      this.updateCachedRect()
    })
    this.resizeObserver.observe(this.domElement)

    // 面级高亮材质（所有覆盖层共享）
    this.faceHighlightMaterial = new THREE.MeshStandardMaterial({
      color: 0xff8800,
      emissive: 0xff6600,
      emissiveIntensity: 0.3,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.75,
      depthTest: true,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    })

    // 边级高亮材质
    this.edgeHighlightMaterial = new THREE.LineBasicMaterial({
      color: 0xff6600,
      linewidth: 2,
      transparent: false,
      depthTest: true
    })

    // 绑定控制器事件
    this.orbitControls = config.controls ?? null
    if (this.orbitControls) {
      this.orbitControls.addEventListener('start', this.handleOrbitStart)
      this.orbitControls.addEventListener('end', this.handleOrbitEnd)
    }

    // 绑定 DOM 事件
    this.domElement.addEventListener('click', this.handleClick)
    this.domElement.addEventListener('mousemove', this.handleMouseMove)
    this.domElement.addEventListener('mousedown', this.handleMouseDown)
    this.domElement.addEventListener('mouseup', this.handleMouseUp)
    this.domElement.addEventListener('mouseleave', this.handleMouseLeave)
    this.domElement.addEventListener('contextmenu', this.handleContextMenu)
  }

  /**
   * 更新缓存的 domRect（避免频繁调用 getBoundingClientRect 导致强制回流）
   */
  private updateCachedRect(): void {
    this.cachedRect = this.domElement.getBoundingClientRect()
  }

  // ========== 控制器拖动检测 ==========

  private handleOrbitStart = (): void => {
    this.isOrbitActive = true
    if (this.hoveredFeature && !this.selectedFeatures.has(this.hoveredFeature.id)) {
      this.clearHoverHighlight()
    }
  }

  private handleOrbitEnd = (): void => {
    this.isOrbitActive = false
  }

  // ========== Hover 检测（纯 3D 视觉，不与树联动） ==========

  private handleMouseMove = (event: MouseEvent): void => {
    if (!this.enabled) return
    if (this.isOrbitActive) return
    if (this.isDragging) {
      const dx = event.clientX - this.mouseDownPos.x
      const dy = event.clientY - this.mouseDownPos.y
      if (dx * dx + dy * dy > this.DRAG_THRESHOLD * this.DRAG_THRESHOLD) return
    }
    this.rafThrottledMouseMove(event)
  }

  /**
   * 执行 hover 检测（被 RAF 节流调用）
   */
  private performHoverCheck(event: MouseEvent): void {
    if (this.isOrbitActive || this.isDragging) return

    // 像素距离阈值：鼠标移动不足 3px 则跳过
    const hdx = event.clientX - this.lastHoverX
    const hdy = event.clientY - this.lastHoverY
    if (hdx * hdx + hdy * hdy < this.HOVER_PIXEL_THRESHOLD_SQ) return
    this.lastHoverX = event.clientX
    this.lastHoverY = event.clientY

    if (this.granularityMode === 'edge') {
      this.performEdgeHoverCheck(event)
      return
    }

    // 面模式原有逻辑

    const intersects = this.getIntersects(event)

    if (intersects.length === 0) {
      if (this.hoveredFeature) {
        this.clearHoverHighlight()
        this.hoveredFeature = null
        this.hoveredMesh = null
        this.hoveredSolid = null
        this.hoveredBrepFaceIndex = -1
        this.onRenderRequest?.()
      }
      return
    }

    const intersection = intersects[0]
    const mesh = intersection.object as THREE.Mesh

    // BRep 面级缓存
    const currentBrepFaceIndex = this.getBrepFaceIndex(mesh, intersection)
    if (mesh === this.hoveredMesh && currentBrepFaceIndex === this.hoveredBrepFaceIndex) return

    const solid = this.findSolidFromIntersection(intersection)
    if (!solid) {
      if (this.hoveredFeature) {
        this.clearHoverHighlight()
        this.hoveredFeature = null
        this.hoveredMesh = null
        this.hoveredSolid = null
        this.hoveredBrepFaceIndex = -1
        this.onRenderRequest?.()
      }
      return
    }

    // 清除之前的 hover 高亮
    this.clearHoverHighlight()

    const feature = this.findFeatureAtPoint(solid, intersection)

    if (feature && !this.selectedFeatures.has(feature.id)) {
      this.applyHoverHighlight(mesh, solid)
    }

    this.hoveredFeature = feature
    this.hoveredMesh = mesh
    this.hoveredSolid = solid
    this.hoveredBrepFaceIndex = currentBrepFaceIndex
    this.onRenderRequest?.()
  }

  /**
   * 获取交点对应的 BRep 面索引
   */
  private getBrepFaceIndex(mesh: THREE.Mesh, intersection: THREE.Intersection): number {
    const faceIdx = intersection.faceIndex
    if (faceIdx === undefined || faceIdx === null) return -1

    const geometry = mesh.geometry as THREE.BufferGeometry
    const faceIndexAttr = geometry.getAttribute('faceIndex')
    if (!faceIndexAttr) return -1

    const index = geometry.getIndex()
    let vertexIndex: number
    if (index) {
      vertexIndex = index.getX(faceIdx * 3)
    } else {
      vertexIndex = faceIdx * 3
    }
    return Math.floor(faceIndexAttr.getX(vertexIndex))
  }

  /**
   * 应用 hover 高亮
   * Regular Mesh → emissive 颜色变化
   * InstancedMesh → 仅边缘线高亮
   */
  private applyHoverHighlight(mesh: THREE.Mesh, solid: SolidObject): void {
    if (!(mesh instanceof THREE.InstancedMesh)) {
      const material = mesh.material as THREE.MeshStandardMaterial
      if (material && material.emissive) {
        this.originalEmissive = material.emissive.clone()
        material.emissiveIntensity = 0.3
      }
    }
    this.hoverSolidEdgeLines(solid, true)
  }

  /**
   * 清除 hover 高亮
   */
  private clearHoverHighlight(): void {
    if (this.hoveredMesh && this.originalEmissive) {
      const material = this.hoveredMesh.material as THREE.MeshStandardMaterial
      if (material && material.emissive) {
        material.emissive.copy(this.originalEmissive)
        material.emissiveIntensity = 0
      }
      this.originalEmissive = null
    }
    if (this.hoveredSolid) {
      this.hoverSolidEdgeLines(this.hoveredSolid, false)
      // 边模式 hover：恢复拓扑边颜色
      if (this.granularityMode === 'edge' && this.hoveredBrepFaceIndex >= 0) {
        if (this.hoveredFeature && !this.selectedFeatures.has(this.hoveredFeature.id)) {
          this.setTopologyEdgeColor(this.hoveredSolid, this.hoveredBrepFaceIndex, 0x444444)
        }
      }
    }
    // 清除 hover 边覆盖层
    this.removeHoverEdgeOverlay()
  }

  /**
   * 创建 hover 状态的边覆盖层（depthTest:false 使其在模型前方可见）
   */
  private createHoverEdgeOverlay(solid: SolidObject, edgeIndex: number): void {
    this.removeHoverEdgeOverlay()
    if (!solid.topologyEdges) return

    const srcGeo = solid.topologyEdges.geometry
    const edgeIndexAttr = srcGeo.getAttribute('edgeIndex') as THREE.BufferAttribute
    const posAttr = srcGeo.getAttribute('position') as THREE.BufferAttribute
    if (!edgeIndexAttr || !posAttr) return

    const positions: number[] = []
    for (let i = 0; i < edgeIndexAttr.count; i++) {
      if (Math.floor(edgeIndexAttr.getX(i)) === edgeIndex) {
        positions.push(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i))
      }
    }
    if (positions.length === 0) return

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(positions), 3))

    this.hoverEdgeOverlay = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
      color: SelectionManager.EDGE_HOVER_COLOR,
      depthTest: false,
      transparent: true,
      opacity: 1,
    }))
    this.hoverEdgeOverlay.renderOrder = 998
    this.hoverEdgeOverlay.matrixAutoUpdate = false
    this.hoverEdgeOverlay.matrix.copy(solid.topologyEdges.matrixWorld)
    this.scene.add(this.hoverEdgeOverlay)
  }

  /**
   * 移除 hover 边覆盖层
   */
  private removeHoverEdgeOverlay(): void {
    if (this.hoverEdgeOverlay) {
      this.scene.remove(this.hoverEdgeOverlay)
      this.hoverEdgeOverlay.geometry.dispose()
        ; (this.hoverEdgeOverlay.material as THREE.Material).dispose()
      this.hoverEdgeOverlay = null
    }
  }

  /**
   * Hover 边缘线高亮（不覆盖已选中的高亮）
   * ★ 支持合并边缘线（edgeVertexRange）和独立边缘线
   */
  private hoverSolidEdgeLines(solid: SolidObject, hover: boolean): void {
    if (!solid.edgeLines) return
    if (solid.selected) return

    if (solid.edgeVertexRange) {
      // 合并边缘线：通过顶点色控制单个实例的边缘线颜色
      this.setEdgeVertexColors(
        solid.edgeLines,
        solid.edgeVertexRange,
        hover ? SelectionManager.EDGE_HOVER_COLOR : SelectionManager.EDGE_DEFAULT_COLOR
      )
    } else {
      // 独立边缘线：改变材质颜色
      const material = solid.edgeLines.material as THREE.LineBasicMaterial
      if (hover) {
        material.color.setHex(SelectionManager.EDGE_HOVER_COLOR)
        material.opacity = SelectionManager.EDGE_HIGHLIGHT_OPACITY
      } else {
        material.color.setHex(SelectionManager.EDGE_DEFAULT_COLOR)
        material.opacity = SelectionManager.EDGE_DEFAULT_OPACITY
      }
      material.needsUpdate = true
    }
  }

  private handleMouseUp = (): void => {
    this.isDragging = false
  }

  private handleMouseLeave = (): void => {
    this.isDragging = false
    this.rafThrottledMouseMove.cancel()
    if (this.hoveredFeature) {
      this.clearHoverHighlight()
      this.hoveredFeature = null
      this.hoveredMesh = null
      this.hoveredSolid = null
      this.hoveredBrepFaceIndex = -1
      this.onRenderRequest?.()
    }
  }

  // ========== Solid 对象管理 ==========

  /**
   * 设置 Solid 对象列表（支持 Regular Mesh + InstancedMesh）
   */
  setSolids(solids: SolidObject[]): void {
    this.solids = solids

    this.meshToSolid.clear()
    this.solidIdMap.clear()
    this.instancedMeshToSolids.clear()
    this.instancedMeshRefs.clear()

    solids.forEach(solid => {
      this.solidIdMap.set(solid.id, solid)
      if (solid.instanceId !== undefined && solid.mesh instanceof THREE.InstancedMesh) {
        // InstancedMesh
        const uuid = solid.mesh.uuid
        if (!this.instancedMeshToSolids.has(uuid)) {
          this.instancedMeshToSolids.set(uuid, new Map())
        }
        this.instancedMeshToSolids.get(uuid)!.set(solid.instanceId, solid)
        this.instancedMeshRefs.set(uuid, solid.mesh as unknown as THREE.InstancedMesh)
      } else {
        // Regular Mesh
        this.meshToSolid.set(solid.mesh, solid)
      }
    })

    this.updateCachedMeshes()
    this.updateCachedTopologyEdges()
    this.buildFeatureIndexMap()
  }

  /**
   * 更新缓存的拓扑边线段数组
   */
  private updateCachedTopologyEdges(): void {
    const edgeSet = new Set<THREE.LineSegments>()
    this.solids.forEach(s => {
      if (s.visible && s.topologyEdges) edgeSet.add(s.topologyEdges)
    })
    this.cachedTopologyEdges = Array.from(edgeSet)
  }

  /**
   * 更新缓存的可见 meshes 数组（去重，InstancedMesh 只出现一次）
   */
  private updateCachedMeshes(): void {
    const meshSet = new Set<THREE.Mesh>()
    this.solids.forEach(s => {
      if (s.visible) meshSet.add(s.mesh)
    })
    this.cachedMeshes = Array.from(meshSet)
  }

  /**
   * 构建特征索引 Map（用于 O(1) 查找）
   */
  private buildFeatureIndexMap(): void {
    this.featureIndexMap.clear()
    this.edgeIndexMap.clear()
    this.solids.forEach(solid => {
      const featureMap = new Map<number, GeometryFeature>()
      solid.features.forEach(feature => {
        if (feature.faceIndex !== undefined) {
          featureMap.set(feature.faceIndex, feature)
        }
      })
      this.featureIndexMap.set(solid.id, featureMap)

      const edgeMap = new Map<number, GeometryFeature>()
      solid.edgeFeatures.forEach(feature => {
        if (feature.edgeIndex !== undefined) {
          edgeMap.set(feature.edgeIndex, feature)
        }
      })
      this.edgeIndexMap.set(solid.id, edgeMap)
    })
  }

  /**
   * 启用/禁用选择管理器交互（用于画线测量模式）
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    if (!enabled) {
      // 禁用时清除 hover
      this.clearHoverHighlight()
      this.hoveredFeature = null
      this.hoveredMesh = null
      this.hoveredSolid = null
      this.hoveredBrepFaceIndex = -1
    }
  }

  /**
   * 设置选择模式（已废弃，默认多选）
   */
  setSelectionMode(mode: 'single' | 'multi'): void {
    this.selectionMode = String(mode) === 'multi' ? 'multi' : 'single'
  }

  /**
   * 设置选择回调
   */
  onSelect(callback: (event: SelectionEvent) => void): void {
    this.onSelectCallback = callback
  }

  /**
   * 设置 hover 回调（边模式下，鼠标悬停在边上时触发）
   */
  onHover(callback: (feature: GeometryFeature | null) => void): void {
    this.onHoverCallback = callback
  }

  /**
   * 处理点击事件
   */
  private handleClick = (event: MouseEvent): void => {
    if (!this.enabled) return
    // 检查是否是拖动操作（旋转相机等），如果是则不处理选择
    const dx = event.clientX - this.mouseDownPos.x
    const dy = event.clientY - this.mouseDownPos.y
    const distance = Math.sqrt(dx * dx + dy * dy)
    if (distance > this.DRAG_THRESHOLD) {
      return
    }

    if (this.granularityMode === 'edge') {
      this.handleEdgeClick(event)
      return
    }

    // 面模式原有逻辑

    const intersects = this.getIntersects(event)

    if (intersects.length === 0) {
      // 点击空白区域不再自动取消选择
      // 用户只能通过信息面板的"移除"按钮来取消选中
      return
    }

    const intersection = intersects[0]

    // ★ 使用 findSolidFromIntersection 同时支持 Regular Mesh 和 InstancedMesh
    const solid = this.findSolidFromIntersection(intersection)
    if (!solid) return

    // 查找对应的特征
    const feature = this.findFeatureAtPoint(solid, intersection)
    if (!feature) return

    // 处理选择
    this.handleSelection(feature, solid, intersection, event)
  }

  /**
   * 处理鼠标按下事件
   */
  private handleMouseDown = (event: MouseEvent): void => {
    this.mouseDownPos.x = event.clientX
    this.mouseDownPos.y = event.clientY
  }

  /**
   * 处理右键菜单事件
   */
  private handleContextMenu = (event: MouseEvent): void => {
    event.preventDefault()
    // 可以在这里添加右键菜单逻辑
  }

  /**
   * 获取射线交点（使用缓存优化）
   */
  private getIntersects(event: MouseEvent): THREE.Intersection[] {
    // 使用缓存的 rect（避免强制回流）
    const rect = this.cachedRect || this.domElement.getBoundingClientRect()
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1

    this.raycaster.setFromCamera(this.mouse, this.camera)

    // 使用缓存的 meshes 数组（避免每次创建新数组）
    return this.raycaster.intersectObjects(this.cachedMeshes, false)
  }

  /**
   * 从射线交点查找对应的 SolidObject（支持 Regular Mesh + InstancedMesh）
   */
  private findSolidFromIntersection(intersection: THREE.Intersection): SolidObject | null {
    const mesh = intersection.object as THREE.Mesh

    // InstancedMesh 路径
    if (mesh instanceof THREE.InstancedMesh && intersection.instanceId !== undefined) {
      const solidsMap = this.instancedMeshToSolids.get(mesh.uuid)
      return solidsMap?.get(intersection.instanceId) ?? null
    }

    // Regular Mesh 路径
    return this.meshToSolid.get(mesh) ?? null
  }

  /**
   * 查找点击位置对应的特征
   */
  private findFeatureAtPoint(
    solid: SolidObject,
    intersection: THREE.Intersection
  ): GeometryFeature | null {
    const faceIdx = intersection.faceIndex
    if (faceIdx === undefined || faceIdx === null) return null

    const geometry = solid.mesh.geometry as THREE.BufferGeometry
    const faceIndexAttr = geometry.getAttribute('faceIndex')

    if (!faceIndexAttr) {
      // 如果没有 faceIndex 属性，返回整个 solid 作为一个面
      return solid.features[0] || null
    }

    // 获取该三角形所属的 BRep 面索引
    const index = geometry.getIndex()
    let vertexIndex: number
    if (index) {
      vertexIndex = index.getX(faceIdx * 3)
    } else {
      vertexIndex = faceIdx * 3
    }

    const brepFaceIndex = Math.floor(faceIndexAttr.getX(vertexIndex))

    // 使用特征索引 Map 进行 O(1) 查找（替代 O(n) find）
    const featureMap = this.featureIndexMap.get(solid.id)
    if (featureMap) {
      const feature = featureMap.get(brepFaceIndex)
      if (feature) return feature
    }

    // 回退到第一个特征
    return solid.features[0] || null
  }

  /**
   * 处理选择逻辑（统一多选 toggle 模式）
   */
  private handleSelection(
    feature: GeometryFeature,
    solid: SolidObject,
    intersection: THREE.Intersection,
    event: MouseEvent
  ): void {
    const selectionInfo: SelectionInfo = {
      feature,
      solid,
      point: intersection.point.clone(),
      distance: intersection.distance
    }

    // 判断是否多选：多选模式 or Ctrl/Shift 修饰键
    const isMulti = this.selectionMode === 'multi' || event.ctrlKey || event.shiftKey

    if (isMulti) {
      // 多选 toggle 逻辑
      if (this.selectedFeatures.has(feature.id)) {
        // 已选中 → 取消选择
        this.removeSelection(feature)
        if (feature.solidId) {
          const s = this.solidIdMap.get(feature.solidId)
          if (s && !s.selected) this.highlightSolidEdgeLines(s, false)
        }
        this.onSelectCallback?.({
          selections: this.getSelections(),
          removed: selectionInfo,
          selectedTreeNodeIds: this.getSelectedTreeNodeIds()
        })
      } else {
        // 未选中 → 添加到选择
        this.addSelection(feature)
        if (solid) this.highlightSolidEdgeLines(solid, true)
        this.onSelectCallback?.({
          selections: this.getSelections(),
          added: selectionInfo,
          selectedTreeNodeIds: this.getSelectedTreeNodeIds()
        })
      }
    } else {
      // 单选：清空旧选择，选中新特征
      this.clearSelectionInternal()
      this.addSelection(feature)
      if (solid) this.highlightSolidEdgeLines(solid, true)
      this.onSelectCallback?.({
        selections: this.getSelections(),
        added: selectionInfo,
        selectedTreeNodeIds: this.getSelectedTreeNodeIds()
      })
    }
  }

  /**
   * 添加选择
   */
  private addSelection(feature: GeometryFeature): void {
    if (this.selectedFeatures.has(feature.id)) return

    this.selectedFeatures.set(feature.id, feature)
    this.applyHighlight(feature, this.selectionColor)

    // 标记 Solid 为选中
    if (feature.solidId) {
      const solid = this.solidIdMap.get(feature.solidId)
      if (solid) {
        solid.selected = true
        this.selectedSolids.add(solid.id)
      }
    }
  }

  /**
   * 移除选择
   */
  private removeSelection(feature: GeometryFeature): void {
    if (!this.selectedFeatures.has(feature.id)) return

    this.selectedFeatures.delete(feature.id)
    this.removeHighlight(feature)
    // 移除面级高亮
    this.removeFaceHighlight(feature)
    // 移除边级高亮
    this.removeEdgeHighlight(feature)

    // ★ 修复：检查同 Solid 下是否还有其他选中 feature，没有才取消 Solid 标记
    if (feature.solidId) {
      const solid = this.solidIdMap.get(feature.solidId)
      if (solid) {
        const hasOtherSelectedFeature = Array.from(this.selectedFeatures.values())
          .some(f => f.solidId === feature.solidId)
        if (!hasOtherSelectedFeature) {
          solid.selected = false
          this.selectedSolids.delete(solid.id)
        }
      }
    }
  }

  /**
   * 内部清除选择（不触发回调）
   * 用于 selectBySolidId / selectByFaceIndex 等内部先清后选的场景，
   * 避免触发中间空回调导致 store 中间态和不必要的 Vue 响应式更新
   */
  private clearSelectionInternal(): void {
    // ★ 先收集需要恢复的 Regular Mesh（直接保存 mesh + solid 引用，避免后续 O(n) 扫描）
    const meshRestoreMap = new Map<string, { mesh: THREE.Mesh, solid: SolidObject }>()
    this.selectedFeatures.forEach(feature => {
      if (feature.mesh && !(feature.mesh instanceof THREE.InstancedMesh)) {
        const meshKey = feature.mesh.uuid
        if (!meshRestoreMap.has(meshKey)) {
          const solid = feature.solidId ? this.solidIdMap.get(feature.solidId) : undefined
          if (solid) meshRestoreMap.set(meshKey, { mesh: feature.mesh, solid })
        }
      }
    })

    // ★ 快照 selectedSolids，然后再清空（避免先清空后遍历空集合的 bug）
    const previousSolidIds = Array.from(this.selectedSolids)
    this.selectedFeatures.clear()
    this.selectedSolids.clear()

    // 恢复 Regular Mesh 的原始材质（O(1) 查找，不再扫描 this.solids）
    meshRestoreMap.forEach(({ mesh, solid }, meshKey) => {
      const originalMaterial = this.originalMaterials.get(meshKey)
      if (originalMaterial) {
        mesh.material = originalMaterial
        const mat = originalMaterial as THREE.MeshStandardMaterial
        mat.opacity = solid.opacity
        mat.transparent = solid.opacity < 1
        mat.depthWrite = solid.opacity >= 1
        mat.needsUpdate = true
      }
      this.originalMaterials.delete(meshKey)
    })

    // ★ 恢复 InstancedMesh 的原始 instanceColor
    if (this.originalInstanceColors.size > 0) {
      const updatedMeshes = new Set<string>()
      this.originalInstanceColors.forEach((origColor, key) => {
        const sepIdx = key.lastIndexOf(':')
        const meshUuid = key.substring(0, sepIdx)
        const instanceId = parseInt(key.substring(sepIdx + 1))
        const instMesh = this.instancedMeshRefs.get(meshUuid)
        if (instMesh) {
          instMesh.setColorAt(instanceId, origColor)
          updatedMeshes.add(meshUuid)
        }
      })
      updatedMeshes.forEach(uuid => {
        const instMesh = this.instancedMeshRefs.get(uuid)
        if (instMesh?.instanceColor) instMesh.instanceColor.needsUpdate = true
      })
      this.originalInstanceColors.clear()
    }

    // ★ 仅恢复之前选中的 solid 的边缘线（避免遍历全部 solids）
    previousSolidIds.forEach(solidId => {
      const s = this.solidIdMap.get(solidId)
      if (s) {
        s.selected = false
        this.highlightSolidEdgeLines(s, false)
      }
    })

    // 清除所有面级高亮
    this.clearAllFaceHighlights()

    // ★ 仅在有边级高亮时才清除（避免在 solid 模式下遍历全部拓扑边顶点）
    if (this.edgeHighlightOverlays.size > 0) {
      this.clearAllEdgeHighlights()
    }
  }

  /**
   * 清空所有选择（公共方法，触发回调）
   */
  clearSelection(): void {
    this.clearSelectionInternal()

    this.onSelectCallback?.({
      selections: [],
      selectedTreeNodeIds: []
    })
  }

  /**
   * 取消选择指定特征（公共方法）
   * 用于外部（如信息面板）移除特征时同步移除高亮
   * ★ 修复：触发 onSelectCallback 确保树和面板联动更新
   */
  deselectFeature(featureId: string): void {
    const feature = this.selectedFeatures.get(featureId)
    if (feature) {
      this.removeSelection(feature)
      // 恢复边缘线
      if (feature.solidId) {
        const solid = this.solidIdMap.get(feature.solidId)
        // 只有同 Solid 下没有其他选中 feature 时才恢复边缘线
        if (solid && !solid.selected) {
          this.highlightSolidEdgeLines(solid, false)
        }
      }
      // ★ 触发回调确保树/面板联动
      this.onSelectCallback?.({
        selections: this.getSelections(),
        selectedTreeNodeIds: this.getSelectedTreeNodeIds()
      })
    }
  }

  /**
   * 从树节点选中 Solid（树→3D 方向）
   * ★ 使用 clearSelectionInternal 避免中间空回调
   * ★ selectedTreeNodeIds 仅包含 solidId（不含面子节点），
   *   避免 el-tree-v2 scrollTo 跳到未展开的面子节点导致列表消失
   */
  selectBySolidId(solidId: string, multi = false): void {
    const solid = this.solidIdMap.get(solidId)
    if (!solid) return

    if (!multi) {
      this.clearSelectionInternal()
    }

    // 选中该 Solid 的第一个特征（多选模式下支持 toggle）
    const feature = solid.features[0]
    if (feature) {
      if (multi && this.selectedFeatures.has(feature.id)) {
        // 多选 toggle：已选中 → 取消
        this.removeSelection(feature)
        if (!solid.selected) this.highlightSolidEdgeLines(solid, false)
      } else {
        this.addSelection(feature)
        this.highlightSolidEdgeLines(solid, true)
      }
    }

    // ★ 树节点 ID：多选时收集全部，单选时只取 solidId
    const treeIds = multi
      ? this.getSelectedTreeNodeIds()
      : (this.selectedFeatures.size > 0 ? [solidId] : [])
    this.onSelectCallback?.({
      selections: this.getSelections(),
      selectedTreeNodeIds: treeIds
    })
  }

  /**
   * 从模型树 hover Solid → 临时边缘线高亮（不影响选中状态）
   * solidId = null 则清除 hover
   */
  hoverBySolidId(solidId: string | null): void {
    // 清除旧的 hover
    if (this.hoveredSolid && !this.hoveredSolid.selected) {
      this.hoverSolidEdgeLines(this.hoveredSolid, false)
    }
    this.hoveredFeature = null
    this.hoveredMesh = null
    this.hoveredBrepFaceIndex = -1

    if (!solidId) {
      this.hoveredSolid = null
      return
    }

    const solid = this.solidIdMap.get(solidId)
    if (!solid || solid.selected) {
      this.hoveredSolid = null
      return
    }

    this.hoveredSolid = solid
    this.hoverSolidEdgeLines(solid, true)
  }

  /**
   * 从树节点选中 Face（树→3D 方向）
   * ★ 使用面级高亮（仅高亮该面），同时保持实体边缘线高亮
   */
  selectByFaceIndex(solidId: string, faceIndex: number, multi = false): void {
    const solid = this.solidIdMap.get(solidId)
    if (!solid) return

    if (!multi) {
      this.clearSelectionInternal()
    }

    const feature = solid.features.find(f => f.faceIndex === faceIndex)
    if (feature) {
      if (multi && this.selectedFeatures.has(feature.id)) {
        // 多选 toggle：已选中 → 取消选中 + 移除覆盖层
        this.removeSelection(feature)
        if (!solid.selected) this.highlightSolidEdgeLines(solid, false)
      } else {
        // 添加面级高亮覆盖层
        this.selectedFeatures.set(feature.id, feature)
        this.applyFaceHighlight(feature)
        this.highlightSolidEdgeLines(solid, true)
        solid.selected = true
        this.selectedSolids.add(solid.id)
      }
    }

    // ★ 无论是否有 feature，都触发一次回调通知最终状态
    this.onSelectCallback?.({
      selections: this.getSelections(),
      selectedTreeNodeIds: this.getSelectedTreeNodeIds()
    })
  }

  /**
   * 高亮 Solid 的边缘线
   * ★ 支持合并边缘线（edgeVertexRange）和独立边缘线
   */
  private highlightSolidEdgeLines(solid: SolidObject, selected: boolean): void {
    if (!solid.edgeLines) return

    if (solid.edgeVertexRange) {
      // 合并边缘线：通过顶点色控制
      this.setEdgeVertexColors(
        solid.edgeLines,
        solid.edgeVertexRange,
        selected ? SelectionManager.EDGE_SELECTED_COLOR : SelectionManager.EDGE_DEFAULT_COLOR
      )
    } else {
      // 独立边缘线：改变材质颜色
      const material = solid.edgeLines.material as THREE.LineBasicMaterial
      if (selected) {
        material.color.setHex(SelectionManager.EDGE_SELECTED_COLOR)
        material.opacity = SelectionManager.EDGE_HIGHLIGHT_OPACITY
        material.needsUpdate = true
      } else {
        material.color.setHex(SelectionManager.EDGE_DEFAULT_COLOR)
        material.opacity = SelectionManager.EDGE_DEFAULT_OPACITY
        material.needsUpdate = true
      }
    }
  }

  /**
   * 设置合并边缘线中指定范围的顶点颜色
   */
  private setEdgeVertexColors(
    edgeLines: THREE.LineSegments,
    range: [number, number],
    colorHex: number
  ): void {
    const colors = edgeLines.geometry.getAttribute('color') as THREE.BufferAttribute
    if (!colors) return
    const color = new THREE.Color(colorHex)
    const [start, count] = range
    for (let i = start; i < start + count; i++) {
      colors.setXYZ(i, color.r, color.g, color.b)
    }
    colors.needsUpdate = true
  }

  /**
   * 获取当前选中的树节点 ID 列表
   */
  private getSelectedTreeNodeIds(): string[] {
    const ids: string[] = []
    this.selectedFeatures.forEach(feature => {
      if (feature.treeNodeId) ids.push(feature.treeNodeId)
      if (feature.solidId) {
        const solidTreeId = feature.solidId // solid_X 格式
        if (!ids.includes(solidTreeId)) ids.push(solidTreeId)
      }
    })
    return ids
  }

  /**
   * 获取当前选择
   */
  getSelections(): SelectionInfo[] {
    return Array.from(this.selectedFeatures.values()).map(feature => {
      const solid = feature.solidId ? this.solidIdMap.get(feature.solidId) : undefined
      return {
        feature,
        solid,
        point: feature.center?.clone() || new THREE.Vector3(),
        distance: 0
      }
    })
  }

  /**
   * 获取选中的特征列表
   */
  getSelectedFeatures(): GeometryFeature[] {
    return Array.from(this.selectedFeatures.values())
  }

  /**
   * 应用高亮效果（用于选中状态）
   * Regular Mesh  → 材质切换（mesh.uuid 作为 key 保存原始材质）
   * InstancedMesh → instanceColor 切换（uuid:instanceId 作为 key 保存原始颜色）
   */
  private applyHighlight(feature: GeometryFeature, color: number): void {
    const mesh = feature.mesh
    if (!mesh) return

    const solid = feature.solidId ? this.solidIdMap.get(feature.solidId) : undefined

    // ★ InstancedMesh 路径：通过 instanceColor 高亮
    if (mesh instanceof THREE.InstancedMesh && solid?.instanceId !== undefined) {
      const key = `${mesh.uuid}:${solid.instanceId}`
      if (!this.originalInstanceColors.has(key)) {
        const origColor = new THREE.Color()
        mesh.getColorAt(solid.instanceId, origColor)
        this.originalInstanceColors.set(key, origColor.clone())
      }
      mesh.setColorAt(solid.instanceId, new THREE.Color(color))
      mesh.instanceColor!.needsUpdate = true
      return
    }

    // ★ Regular Mesh 路径：材质切换
    const meshKey = mesh.uuid
    if (!this.originalMaterials.has(meshKey)) {
      this.originalMaterials.set(meshKey, mesh.material)
    }

    let highlightMaterial = this.highlightMaterials.get(`${meshKey}_${color}`)
    if (!highlightMaterial) {
      const origMat = this.originalMaterials.get(meshKey) as THREE.MeshStandardMaterial
      highlightMaterial = new THREE.MeshStandardMaterial({
        color: color,
        metalness: origMat?.metalness ?? 0.3,
        roughness: origMat?.roughness ?? 0.6,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: origMat?.opacity ?? 1,
        depthWrite: (origMat?.opacity ?? 1) >= 1,
        emissive: new THREE.Color(color).multiplyScalar(0.2)
      })
      this.highlightMaterials.set(`${meshKey}_${color}`, highlightMaterial)
    }

    mesh.material = highlightMaterial
  }

  /**
   * 移除高亮效果
   * Regular Mesh  → 仅当该 mesh 上不再有其他选中 feature 时才恢复原始材质
   * InstancedMesh → 恢复对应实例的原始 instanceColor
   */
  private removeHighlight(feature: GeometryFeature): void {
    if (!feature.mesh) return

    const solid = feature.solidId ? this.solidIdMap.get(feature.solidId) : undefined

    // ★ InstancedMesh 路径
    if (feature.mesh instanceof THREE.InstancedMesh && solid?.instanceId !== undefined) {
      const key = `${feature.mesh.uuid}:${solid.instanceId}`
      const origColor = this.originalInstanceColors.get(key)
      if (origColor) {
        feature.mesh.setColorAt(solid.instanceId, origColor)
        feature.mesh.instanceColor!.needsUpdate = true
        this.originalInstanceColors.delete(key)
      }
      return
    }

    // ★ Regular Mesh 路径
    const meshKey = feature.mesh.uuid

    let otherFeatureOnSameMesh = false
    this.selectedFeatures.forEach((f) => {
      if (f.id !== feature.id && f.mesh === feature.mesh) {
        otherFeatureOnSameMesh = true
      }
    })

    if (!otherFeatureOnSameMesh) {
      const originalMaterial = this.originalMaterials.get(meshKey)
      if (originalMaterial) {
        feature.mesh.material = originalMaterial
        if (solid) {
          const mat = originalMaterial as THREE.MeshStandardMaterial
          mat.opacity = solid.opacity
          mat.transparent = solid.opacity < 1
          mat.depthWrite = solid.opacity >= 1
          mat.needsUpdate = true
        }
      }
      this.originalMaterials.delete(meshKey)

      // ★ 优化16: 清理该 mesh 对应的所有高亮材质（防止反复选择时只增不减）
      const keysToDelete: string[] = []
      this.highlightMaterials.forEach((mat, key) => {
        if (key.startsWith(`${meshKey}_`)) {
          mat.dispose()
          keysToDelete.push(key)
        }
      })
      keysToDelete.forEach(key => this.highlightMaterials.delete(key))
    }
  }

  // ========== 面级高亮（overlay mesh 覆盖层方式） ==========

  /**
   * 应用面级高亮（创建覆盖层 mesh，同时支持 Regular Mesh 和 InstancedMesh）
   * 从几何体中提取指定 BRep 面的三角形，创建半透明橙色覆盖 mesh
   */
  applyFaceHighlight(feature: GeometryFeature): void {
    if (!feature.mesh || feature.faceIndex === undefined) return
    if (this.faceHighlightOverlays.has(feature.id)) return

    const solid = feature.solidId ? this.solidIdMap.get(feature.solidId) : undefined
    if (!solid) return

    const geometry = solid.mesh.geometry as THREE.BufferGeometry
    const faceIndexAttr = geometry.getAttribute('faceIndex')
    if (!faceIndexAttr) return

    const posAttr = geometry.getAttribute('position')
    const normalAttr = geometry.getAttribute('normal')
    const index = geometry.getIndex()
    const targetFaceIndex = feature.faceIndex

    // 收集该 BRep 面的所有三角形顶点
    const positions: number[] = []
    const normals: number[] = []

    const addVertex = (vertIdx: number) => {
      positions.push(posAttr.getX(vertIdx), posAttr.getY(vertIdx), posAttr.getZ(vertIdx))
      if (normalAttr) {
        normals.push(normalAttr.getX(vertIdx), normalAttr.getY(vertIdx), normalAttr.getZ(vertIdx))
      }
    }

    if (index) {
      for (let i = 0; i < index.count; i += 3) {
        const vi = index.getX(i)
        const brepFace = Math.floor(faceIndexAttr.getX(vi))
        if (brepFace === targetFaceIndex) {
          for (let j = 0; j < 3; j++) {
            addVertex(index.getX(i + j))
          }
        }
      }
    } else {
      for (let i = 0; i < posAttr.count; i += 3) {
        const brepFace = Math.floor(faceIndexAttr.getX(i))
        if (brepFace === targetFaceIndex) {
          for (let j = 0; j < 3; j++) {
            addVertex(i + j)
          }
        }
      }
    }

    if (positions.length === 0) return

    // 创建覆盖层几何体
    const overlayGeo = new THREE.BufferGeometry()
    overlayGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    if (normals.length > 0) {
      overlayGeo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
    }

    const overlayMesh = new THREE.Mesh(overlayGeo, this.faceHighlightMaterial)
    overlayMesh.name = `faceHighlight_${feature.id}`
    overlayMesh.renderOrder = 2

    // InstancedMesh 需要应用实例变换矩阵
    if (solid.mesh instanceof THREE.InstancedMesh && solid.instanceId !== undefined) {
      const matrix = new THREE.Matrix4()
      solid.mesh.getMatrixAt(solid.instanceId, matrix)
      overlayMesh.applyMatrix4(matrix)
    }

    this.scene.add(overlayMesh)
    this.faceHighlightOverlays.set(feature.id, overlayMesh)
  }

  /**
   * 移除面级高亮覆盖层
   */
  removeFaceHighlight(feature: GeometryFeature): void {
    const overlay = this.faceHighlightOverlays.get(feature.id)
    if (overlay) {
      this.scene.remove(overlay)
      overlay.geometry.dispose()
      this.faceHighlightOverlays.delete(feature.id)
    }
  }

  /**
   * 清除所有面级高亮覆盖层
   */
  clearAllFaceHighlights(): void {
    this.faceHighlightOverlays.forEach(overlay => {
      this.scene.remove(overlay)
      overlay.geometry.dispose()
    })
    this.faceHighlightOverlays.clear()
  }

  /**
   * 设置透明度
   */
  setOpacity(solidId: string | null, opacity: number): void {
    const targets = solidId
      ? this.solids.filter(s => s.id === solidId)
      : this.solids

    const isTransparent = opacity < 1

    targets.forEach(solid => {
      solid.opacity = opacity
      const material = solid.mesh.material as THREE.MeshStandardMaterial
      if (material) {
        material.opacity = opacity
        material.transparent = isTransparent
        material.depthWrite = !isTransparent
        material.side = THREE.DoubleSide
        material.needsUpdate = true
      }

      // 更新该 Solid 的高亮材质 + 原始材质透明度（使用 mesh.uuid 作为 key）
      const meshKey = solid.mesh.uuid
      this.highlightMaterials.forEach((mat, key) => {
        if (key.startsWith(`${meshKey}_`)) {
          mat.opacity = opacity
          mat.transparent = isTransparent
          mat.depthWrite = !isTransparent
          mat.side = THREE.DoubleSide
          mat.needsUpdate = true
        }
      })

      // ★ 同步更新 originalMaterials 中缓存的材质透明度（使用 mesh.uuid 作为 key）
      const origMat = this.originalMaterials.get(meshKey) as THREE.MeshStandardMaterial
      if (origMat && origMat !== solid.mesh.material) {
        origMat.opacity = opacity
        origMat.transparent = isTransparent
        origMat.depthWrite = !isTransparent
        origMat.side = THREE.DoubleSide
        origMat.needsUpdate = true
      }
    })
  }

  /**
   * 切换透明度（始终切换所有实体，不受选中状态影响）
   */
  toggleTransparency(solidId?: string): void {
    if (solidId) {
      const solid = this.solidIdMap.get(solidId)
      if (solid) {
        const newOpacity = solid.opacity > 0.5 ? 0.3 : 1
        this.setOpacity(solidId, newOpacity)
      }
    } else {
      // 始终切换所有实体，不受选中状态影响
      const anyOpaque = this.solids.some(s => s.opacity > 0.5)
      const newOpacity = anyOpaque ? 0.3 : 1
      this.setOpacity(null, newOpacity)
    }
  }

  /**
   * 设置全局透明模式（外部驱动，不自行判断方向）
   */
  setTransparent(transparent: boolean): void {
    this.setOpacity(null, transparent ? 0.3 : 1)
  }

  // ========== 边级选择与高亮 ==========

  /**
   * 设置选择粒度模式
   */
  setGranularityMode(mode: GranularityMode): void {
    if (this.granularityMode === mode) return
    this.granularityMode = mode

    // 切换时清除所有高亮和选择
    this.clearSelectionInternal()
    this.clearHoverHighlight()
    this.removeHoverEdgeOverlay()
    this.hoveredFeature = null
    this.hoveredMesh = null
    this.hoveredSolid = null
    this.hoveredBrepFaceIndex = -1

    // 切换拓扑边线段可见性
    this.solids.forEach(s => {
      if (s.topologyEdges) {
        s.topologyEdges.visible = (mode === 'edge')
      }
    })

    // 触发回调通知外部清除选择状态
    this.onSelectCallback?.({
      selections: [],
      selectedTreeNodeIds: []
    })

    this.onRenderRequest?.()
  }

  /**
   * 获取当前粒度模式
   */
  getGranularityMode(): GranularityMode {
    return this.granularityMode
  }

  /**
   * 边模式下的 hover 检测
   */
  private performEdgeHoverCheck(event: MouseEvent): void {
    const edgeHit = this.raycastEdges(event)

    if (!edgeHit) {
      if (this.hoveredFeature) {
        this.clearHoverHighlight()
        this.hoveredFeature = null
        this.hoveredMesh = null
        this.hoveredSolid = null
        this.hoveredBrepFaceIndex = -1
        this.onHoverCallback?.(null)
        this.onRenderRequest?.()
      }
      return
    }

    const { solid, feature, edgeIndex } = edgeHit
    if (feature && feature === this.hoveredFeature) return

    this.clearHoverHighlight()

    if (feature && !this.selectedFeatures.has(feature.id)) {
      // 高亮边缘线（hover 颜色）- 使用拓扑边线段 vertex color + 覆盖层
      this.setTopologyEdgeColor(solid, edgeIndex, SelectionManager.EDGE_HOVER_COLOR)
      this.createHoverEdgeOverlay(solid, edgeIndex)
    }

    this.hoveredFeature = feature
    this.hoveredSolid = solid
    this.hoveredBrepFaceIndex = edgeIndex
    this.onHoverCallback?.(feature)
    this.onRenderRequest?.()
  }

  /**
   * 边模式下的点击处理
   */
  private handleEdgeClick(event: MouseEvent): void {
    const edgeHit = this.raycastEdges(event)

    if (!edgeHit) return

    const { solid, feature } = edgeHit

    if (!feature) return

    const selectionInfo: SelectionInfo = {
      feature,
      solid,
      point: feature.startPoint?.clone() || new THREE.Vector3(),
      distance: 0
    }

    const isMulti = this.selectionMode === 'multi' || event.ctrlKey || event.shiftKey

    if (isMulti) {
      if (this.selectedFeatures.has(feature.id)) {
        this.removeSelection(feature)
        this.removeEdgeHighlight(feature)
        this.onSelectCallback?.({
          selections: this.getSelections(),
          removed: selectionInfo,
          selectedTreeNodeIds: this.getSelectedTreeNodeIds()
        })
      } else {
        this.selectedFeatures.set(feature.id, feature)
        this.applyEdgeHighlight(feature)
        if (feature.solidId) {
          const s = this.solidIdMap.get(feature.solidId)
          if (s) { s.selected = true; this.selectedSolids.add(s.id) }
        }
        this.onSelectCallback?.({
          selections: this.getSelections(),
          added: selectionInfo,
          selectedTreeNodeIds: this.getSelectedTreeNodeIds()
        })
      }
    } else {
      this.clearSelectionInternal()
      this.selectedFeatures.set(feature.id, feature)
      this.applyEdgeHighlight(feature)
      if (feature.solidId) {
        const s = this.solidIdMap.get(feature.solidId)
        if (s) { s.selected = true; this.selectedSolids.add(s.id) }
      }
      this.onSelectCallback?.({
        selections: this.getSelections(),
        added: selectionInfo,
        selectedTreeNodeIds: this.getSelectedTreeNodeIds()
      })
    }
  }

  /**
   * 射线检测拓扑边
   */
  private raycastEdges(event: MouseEvent): {
    solid: SolidObject
    feature: GeometryFeature
    edgeIndex: number
  } | null {
    const rect = this.cachedRect || this.domElement.getBoundingClientRect()
    const mx = ((event.clientX - rect.left) / rect.width) * 2 - 1
    const my = -((event.clientY - rect.top) / rect.height) * 2 + 1

    // 动态阈值：根据相机距离调整
    const camDist = this.camera instanceof THREE.PerspectiveCamera
      ? this.camera.position.length()
      : 100
    this.edgeRaycaster.params.Line!.threshold = Math.max(0.5, Math.min(5, camDist * 0.005))

    this.edgeRaycaster.setFromCamera(new THREE.Vector2(mx, my), this.camera)
    const intersects = this.edgeRaycaster.intersectObjects(this.cachedTopologyEdges, false)

    if (intersects.length === 0) return null

    const hit = intersects[0]
    const lineSegs = hit.object as THREE.LineSegments
    const geo = lineSegs.geometry as THREE.BufferGeometry
    const edgeIndexAttr = geo.getAttribute('edgeIndex')

    if (!edgeIndexAttr || hit.index === undefined) return null

    const edgeIndex = Math.floor(edgeIndexAttr.getX(hit.index))

    // 找到对应的 solid
    for (const solid of this.solids) {
      if (solid.topologyEdges === lineSegs ||
        (solid.topologyEdges && solid.topologyEdges === lineSegs)) {
        // 对于合并的拓扑边（InstancedMesh），需要通过顶点范围确定实例
        if (solid.topologyEdgeVertexRanges) {
          const range = solid.topologyEdgeVertexRanges.get(edgeIndex)
          if (range) {
            const [start, count] = range
            if (hit.index >= start && hit.index < start + count) {
              const edgeMap = this.edgeIndexMap.get(solid.id)
              const feature = edgeMap?.get(edgeIndex)
              if (feature) return { solid, feature, edgeIndex }
            }
          }
          continue
        }

        // Regular Mesh 的拓扑边
        const edgeMap = this.edgeIndexMap.get(solid.id)
        const feature = edgeMap?.get(edgeIndex)
        if (feature) return { solid, feature, edgeIndex }
      }
    }

    return null
  }

  /**
   * 应用边级高亮覆盖层 — 创建独立的高亮 LineSegments 覆盖在选中边上层
   */
  applyEdgeHighlight(feature: GeometryFeature): void {
    if (!feature.solidId || feature.edgeIndex === undefined) return
    if (this.edgeHighlightOverlays.has(feature.id)) return

    const solid = this.solidIdMap.get(feature.solidId)
    if (!solid || !solid.topologyEdges) return

    // 修改 vertex color 标记选中态
    this.setTopologyEdgeColor(solid, feature.edgeIndex, SelectionManager.EDGE_SELECTED_COLOR)

    // 提取该边的顶点创建独立的覆盖几何体
    const srcGeo = solid.topologyEdges.geometry
    const edgeIndexAttr = srcGeo.getAttribute('edgeIndex') as THREE.BufferAttribute
    const posAttr = srcGeo.getAttribute('position') as THREE.BufferAttribute
    if (!edgeIndexAttr || !posAttr) return

    const positions: number[] = []
    for (let i = 0; i < edgeIndexAttr.count; i++) {
      if (Math.floor(edgeIndexAttr.getX(i)) === feature.edgeIndex) {
        positions.push(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i))
      }
    }
    if (positions.length === 0) return

    const overlayGeo = new THREE.BufferGeometry()
    overlayGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(positions), 3))

    const overlay = new THREE.LineSegments(overlayGeo, new THREE.LineBasicMaterial({
      color: SelectionManager.EDGE_SELECTED_COLOR,
      depthTest: false,
      transparent: true,
      opacity: 1,
    }))
    overlay.renderOrder = 999
    // 继承父级变换
    overlay.matrixAutoUpdate = false
    overlay.matrix.copy(solid.topologyEdges.matrixWorld)

    this.scene.add(overlay)
    this.edgeHighlightOverlays.set(feature.id, overlay)
  }

  /**
   * 移除边级高亮覆盖层
   */
  removeEdgeHighlight(feature: GeometryFeature): void {
    if (!feature.solidId || feature.edgeIndex === undefined) return

    const solid = feature.solidId ? this.solidIdMap.get(feature.solidId) : undefined
    if (solid?.topologyEdges) {
      this.setTopologyEdgeColor(solid, feature.edgeIndex, 0x444444)
    }

    const overlay = this.edgeHighlightOverlays.get(feature.id)
    if (overlay) {
      this.scene.remove(overlay)
      overlay.geometry.dispose()
        ; (overlay.material as THREE.Material).dispose()
      this.edgeHighlightOverlays.delete(feature.id)
    }
  }

  /**
   * 清除所有边级高亮
   */
  clearAllEdgeHighlights(): void {
    // 恢复所有拓扑边颜色
    this.solids.forEach(solid => {
      if (solid.topologyEdges) {
        const geo = solid.topologyEdges.geometry
        const colAttr = geo.getAttribute('color') as THREE.BufferAttribute
        if (colAttr) {
          const defaultColor = new THREE.Color(0x444444)
          for (let i = 0; i < colAttr.count; i++) {
            colAttr.setXYZ(i, defaultColor.r, defaultColor.g, defaultColor.b)
          }
          colAttr.needsUpdate = true
        }
      }
    })
    this.edgeHighlightOverlays.forEach(overlay => {
      this.scene.remove(overlay)
      overlay.geometry.dispose()
        ; (overlay.material as THREE.Material).dispose()
    })
    this.edgeHighlightOverlays.clear()
  }

  /**
   * 设置拓扑边颜色（通过 vertex color 或材质）
   */
  private setTopologyEdgeColor(solid: SolidObject, edgeIndex: number, colorHex: number): void {
    if (!solid.topologyEdges) return

    const geo = solid.topologyEdges.geometry
    const edgeIndexAttr = geo.getAttribute('edgeIndex') as THREE.BufferAttribute
    const colAttr = geo.getAttribute('color') as THREE.BufferAttribute

    if (colAttr && edgeIndexAttr) {
      // 有 vertex color（合并的拓扑边线段）
      const color = new THREE.Color(colorHex)
      for (let i = 0; i < edgeIndexAttr.count; i++) {
        if (Math.floor(edgeIndexAttr.getX(i)) === edgeIndex) {
          colAttr.setXYZ(i, color.r, color.g, color.b)
        }
      }
      colAttr.needsUpdate = true
    } else if (edgeIndexAttr) {
      // 无 vertex color 时，添加 color attribute
      const positions = geo.getAttribute('position')
      const colors = new Float32Array(positions.count * 3)
      const defaultColor = new THREE.Color(0x444444)
      const targetColor = new THREE.Color(colorHex)

      for (let i = 0; i < positions.count; i++) {
        const ei = Math.floor(edgeIndexAttr.getX(i))
        const c = (ei === edgeIndex) ? targetColor : defaultColor
        colors[i * 3] = c.r
        colors[i * 3 + 1] = c.g
        colors[i * 3 + 2] = c.b
      }

      geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
      const mat = solid.topologyEdges.material as THREE.LineBasicMaterial
      mat.vertexColors = true
      mat.needsUpdate = true
    }
  }

  /**
   * 从树节点选中 Edge（树→3D 方向）
   */
  selectByEdgeIndex(solidId: string, edgeIndex: number, multi = false): void {
    const solid = this.solidIdMap.get(solidId)
    if (!solid) return

    if (!multi) {
      this.clearSelectionInternal()
    }

    const feature = solid.edgeFeatures.find(f => f.edgeIndex === edgeIndex)
    if (feature) {
      if (multi && this.selectedFeatures.has(feature.id)) {
        this.removeSelection(feature)
        this.removeEdgeHighlight(feature)
      } else {
        this.selectedFeatures.set(feature.id, feature)
        this.applyEdgeHighlight(feature)
        solid.selected = true
        this.selectedSolids.add(solid.id)
      }
    }

    this.onSelectCallback?.({
      selections: this.getSelections(),
      selectedTreeNodeIds: this.getSelectedTreeNodeIds()
    })
  }

  /**
   * 设置可见性
   */
  setVisibility(solidId: string, visible: boolean): void {
    const solid = this.solidIdMap.get(solidId)
    if (solid) {
      solid.visible = visible
      solid.mesh.visible = visible
      // 隐藏/显示 solid 的拓扑边线
      if (solid.topologyEdges) {
        solid.topologyEdges.visible = visible
      }
      // 重新构建射线检测缓存，确保隐藏的 mesh 不会遮挡后方模型
      this.updateCachedMeshes()
      this.updateCachedTopologyEdges()
    }
  }

  /**
   * 更新相机引用
   */
  updateCamera(camera: THREE.Camera): void {
    this.camera = camera
  }

  /**
   * 销毁选择管理器
   */
  dispose(): void {
    // 清理 RAF 节流
    this.rafThrottledMouseMove.cancel()

    // 清理 hover 状态
    this.clearHoverHighlight()
    this.hoveredFeature = null
    this.hoveredMesh = null
    this.hoveredSolid = null

    // 清理控制器事件
    if (this.orbitControls) {
      this.orbitControls.removeEventListener('start', this.handleOrbitStart)
      this.orbitControls.removeEventListener('end', this.handleOrbitEnd)
      this.orbitControls = null
    }

    // 清理 ResizeObserver
    if (this.resizeObserver) {
      this.resizeObserver.disconnect()
      this.resizeObserver = null
    }

    // 移除所有 DOM 事件监听器
    this.domElement.removeEventListener('click', this.handleClick)
    this.domElement.removeEventListener('mousemove', this.handleMouseMove)
    this.domElement.removeEventListener('mousedown', this.handleMouseDown)
    this.domElement.removeEventListener('mouseup', this.handleMouseUp)
    this.domElement.removeEventListener('mouseleave', this.handleMouseLeave)
    this.domElement.removeEventListener('contextmenu', this.handleContextMenu)

    this.highlightMaterials.forEach(mat => mat.dispose())
    this.highlightMaterials.clear()
    this.originalMaterials.clear()
    this.originalInstanceColors.clear()
    this.instancedMeshRefs.clear()
    this.instancedMeshToSolids.clear()
    this.selectedFeatures.clear()
    this.selectedSolids.clear()
    this.clearAllFaceHighlights()
    this.clearAllEdgeHighlights()
    this.removeHoverEdgeOverlay()
    this.faceHighlightMaterial.dispose()
    this.edgeHighlightMaterial.dispose()
    this.featureIndexMap.clear()
    this.edgeIndexMap.clear()
    this.meshToSolid.clear()
    this.solidIdMap.clear()
    this.cachedMeshes = []
    this.cachedTopologyEdges = []
    this.cachedRect = null
  }
}

export default SelectionManager
