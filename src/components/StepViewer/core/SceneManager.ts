/**
 * Three.js 场景管理器
 * 管理 3D 场景、相机、灯光、渲染器和交互控制
 *
 * 性能优化：
 * - 支持 WebGPU 渲染器（自动降级到 WebGL）
 * - 按需渲染机制（仅在场景变化时渲染，避免空闲时 GPU 持续占用）
 * - THREE.ViewHelper 替代视角按钮
 */

import * as THREE from 'three'
import { ArcballControls } from 'three/examples/jsm/controls/ArcballControls.js'
import { ViewHelper } from 'three/examples/jsm/helpers/ViewHelper.js'
import type { RenderConfig, ViewPreset, CameraConfig } from '../types'
import {
  createRenderer,
  configureRenderer,
  takeScreenshot,
  type RendererType,
  type UniversalRenderer
} from './RendererFactory'

/**
 * 场景管理器配置
 */
export interface SceneManagerConfig {
  container: HTMLElement
  width?: number
  height?: number
  backgroundColor?: number
  antialias?: boolean
  showAxes?: boolean
  showGrid?: boolean
  /** 是否优先使用 WebGPU（默认 true） */
  preferWebGPU?: boolean
}

/**
 * 场景管理器类
 */
export class SceneManager {
  public scene: THREE.Scene
  public camera: THREE.PerspectiveCamera
  public renderer!: UniversalRenderer
  public controls: ArcballControls & { target: THREE.Vector3 }
  /** ViewHelper 实例（右下角视图方向立方体） */
  public viewHelper: ViewHelper | null = null
  /** 当前渲染器类型 */
  public rendererType: RendererType = 'webgl'

  /** 本帧 Draw Calls（render 后捕获） */
  public frameDrawCalls = 0
  /** 场景总三角形数（模型变化时重新计算） */
  public sceneTriangles = 0
  /** 场景总顶点数（模型变化时重新计算） */
  public sceneVertices = 0

  private container: HTMLElement
  private animationId: number | null = null
  private width: number
  private height: number

  // 场景元素
  private axesHelper: THREE.AxesHelper | null = null
  private gridHelper: THREE.GridHelper | null = null
  private ambientLight: THREE.AmbientLight
  private directionalLight: THREE.DirectionalLight

  // 模型组
  public modelGroup: THREE.Group

  // 渲染回调
  private renderCallbacks: Array<() => void> = []

  // 按需渲染：脏标记机制
  private _needsRender = true
  /** 是否正在进行相机动画 */
  private isAnimating = false
  /** ViewHelper 动画状态跟踪（用于动画结束时恢复 controls） */
  private _viewHelperWasAnimating = false
  /** 时钟（用于 ViewHelper delta time） */
  private clock = new THREE.Clock()
  /** ViewHelper 视口尺寸（像素） */
  private readonly VIEW_HELPER_DIM = 128

  /** 初始化 Promise（用于等待 WebGPU 异步初始化） */
  private initPromise: Promise<void>

  constructor(config: SceneManagerConfig) {
    this.container = config.container
    this.width = config.width || config.container.clientWidth
    this.height = config.height || config.container.clientHeight

    // 创建场景
    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(config.backgroundColor ?? 0xf5f5f5)

    // 创建相机
    this.camera = new THREE.PerspectiveCamera(
      45,
      this.width / this.height,
      0.1,
      10000
    )
    this.camera.position.set(100, 100, 100)

    // 初始化渲染器（异步，WebGPU 需要 async init）
    this.initPromise = this.initRenderer(config)

    // 创建临时 canvas（渲染器创建完成后会替换）
    const tempCanvas = document.createElement('canvas')
    this.container.appendChild(tempCanvas)

    // 创建轨道控制器（先绑定临时 canvas，稍后更新）
    // ArcballControls: 球面旋转、无万向节死锁，支持任意视角翻转
    this.controls = new ArcballControls(this.camera, tempCanvas, null) as ArcballControls & { target: THREE.Vector3 }
    this.controls.enableAnimations = false
    this.controls.setGizmosVisible(false)
    this.controls.minDistance = 1
    this.controls.maxDistance = 5000

    // 监听 change 事件标记需要渲染
    this.controls.addEventListener('change', () => {
      this.markDirty()
    })

    // 创建灯光
    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.6)
    this.scene.add(this.ambientLight)

    this.directionalLight = new THREE.DirectionalLight(0xffffff, 0.8)
    this.directionalLight.position.set(100, 100, 50)
    // this.directionalLight.castShadow = false
    // this.directionalLight.shadow.mapSize.width = 1024
    // this.directionalLight.shadow.mapSize.height = 1024
    this.scene.add(this.directionalLight)

    // 添加补光
    const fillLight = new THREE.DirectionalLight(0xffffff, 0.3)
    fillLight.position.set(-100, -50, -100)
    this.scene.add(fillLight)

    // 创建模型组
    this.modelGroup = new THREE.Group()
    this.scene.add(this.modelGroup)

    // 添加辅助元素
    if (config.showAxes) {
      this.showAxes(true)
    }
    if (config.showGrid) {
      this.showGrid(true)
    }

    // 监听窗口变化
    window.addEventListener('resize', this.handleResize)

    // 开始渲染循环
    this.startRenderLoop()
  }

  /**
   * 异步初始化渲染器（WebGPU 优先，自动降级）
   */
  private async initRenderer(config: SceneManagerConfig): Promise<void> {
    const { renderer, type } = await createRenderer(
      {
        antialias: config.antialias !== false,
        alpha: true,
        preserveDrawingBuffer: true
      },
      config.preferWebGPU !== false
    )

    this.renderer = renderer
    this.rendererType = type

    // 配置渲染器通用属性
    configureRenderer(renderer, type, {
      width: this.width,
      height: this.height,
      shadowMapEnabled: true
    })

    // 替换临时 canvas
    const tempCanvas = this.container.querySelector('canvas')
    if (tempCanvas) {
      this.container.removeChild(tempCanvas)
    }
    this.container.appendChild(renderer.domElement)

    // 重建 ArcballControls 绑定到真正的渲染器 DOM
    this.controls.dispose()
    this.controls = new ArcballControls(this.camera, renderer.domElement, null) as ArcballControls & { target: THREE.Vector3 }
    this.controls.enableAnimations = false
    this.controls.setGizmosVisible(false)
    this.controls.minDistance = 1
    this.controls.maxDistance = 5000

    this.controls.addEventListener('change', () => {
      this.markDirty()
    })

    // 创建 ViewHelper（右下角视图方向立方体）
    this.viewHelper = new ViewHelper(this.camera, renderer.domElement)
    this.viewHelper.center = this.controls.target
    // 添加 XYZ 轴标签提升可读性
    try {
      this.viewHelper.setLabels('X', 'Y', 'Z')
    } catch {
      // 低版本 Three.js 可能不支持 setLabels
    }

    this.markDirty()
  }

  /**
   * 等待渲染器初始化完成
   */
  async waitForReady(): Promise<void> {
    await this.initPromise
  }

  /**
   * 处理窗口大小变化
   */
  private handleResize = () => {
    this.width = this.container.clientWidth
    this.height = this.container.clientHeight

    this.camera.aspect = this.width / this.height
    this.camera.updateProjectionMatrix()

    if (this.renderer) {
      this.renderer.setSize(this.width, this.height)
    }
    this.markDirty()
  }

  /**
   * 标记场景为脏（需要重新渲染）
   * 任何导致视觉变化的操作都应调用此方法
   */
  markDirty(): void {
    this._needsRender = true
  }

  /**
   * 轻量渲染请求（仅标记下一帧需要渲染，不重置阻尼计数器）
   * 适用于 hover 高亮等高频、低影响的视觉变化
   */
  requestRender(): void {
    this._needsRender = true
  }

  /**
   * 计算场景中的几何体统计信息
   */
  private computeSceneStats(): void {
    let totalVertices = 0
    let totalTriangles = 0
    this.modelGroup.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        const geo = obj.geometry as THREE.BufferGeometry
        const posAttr = geo.getAttribute('position')
        if (posAttr) totalVertices += posAttr.count
        const idx = geo.getIndex()
        if (idx) {
          totalTriangles += idx.count / 3
        } else if (posAttr) {
          totalTriangles += posAttr.count / 3
        }
      }
    })
    this.sceneTriangles = Math.round(totalTriangles)
    this.sceneVertices = totalVertices
  }

  /**
   * 开始渲染循环（按需渲染 + 阻尼动画支持）
   */
  private startRenderLoop() {
    const animate = () => {
      this.animationId = requestAnimationFrame(animate)

      const delta = this.clock.getDelta()

      // ViewHelper 动画检查（必须在 controls.update 前检查，决定是否跳过）
      let viewHelperAnimating = false
      if (this.viewHelper) {
        viewHelperAnimating = this.viewHelper.animating
        if (viewHelperAnimating) {
          // ViewHelper 动画期间：直接驱动相机，跳过 controls.update() 避免干扰
          this.viewHelper.update(delta)
          this.markDirty()
        }
        this._viewHelperWasAnimating = viewHelperAnimating
      }

      // 更新控制器（仅在非 ViewHelper 动画期间）
      if (!viewHelperAnimating) {
        this.controls.update()
      }

      // 判断是否需要渲染
      const shouldRender = this._needsRender
        || this.isAnimating
        || viewHelperAnimating

      if (shouldRender && this.renderer && this.width > 0 && this.height > 0) {
        // ★ 确保主渲染使用完整视口（防御 ViewHelper 上一帧未恢复视口的边界情况）
        this.renderer.setViewport(0, 0, this.width, this.height)

        this.renderer.render(this.scene, this.camera)

        // 渲染 ViewHelper（在主渲染之后，ViewHelper.render 内置 viewport 切换和背景透明处理）
        // ★ 关键修复: ViewHelper.render() 内部会调用 renderer.render()，
        //   而 WebGLRenderer.autoClear 默认为 true，会导致 gl.clear() 擦除整个帧缓冲区
        //   （WebGL 的 clear 不受 viewport 限制），从而清掉已渲染的主场景。
        //   解决方案：渲染 ViewHelper 前临时关闭 autoClear，渲染完毕后恢复。
        //   WebGPURenderer 的 render pass 机制不受此影响，但 save/restore 模式对其同样安全。
        if (this.viewHelper) {
          const savedAutoClear = this.renderer.autoClear
          this.renderer.autoClear = false
          try {
            this.viewHelper.render(this.renderer as any)
          } catch {
            // ViewHelper 渲染失败不影响主渲染
          } finally {
            this.renderer.autoClear = savedAutoClear
          }
        }

        // 捕获本帧渲染统计（在 render 之后、下次 auto-reset 之前读取）
        this.frameDrawCalls = this.renderer.info?.render?.calls ?? 0

        // 后置渲染回调（CSS2D 标签、统计更新等需在主渲染之后执行）
        this.renderCallbacks.forEach(callback => callback())

        // 重置脏标记
        this._needsRender = false
      }
    }
    animate()
  }

  /**
   * 添加渲染回调
   */
  addRenderCallback(callback: () => void): void {
    this.renderCallbacks.push(callback)
  }

  /**
   * 移除渲染回调
   */
  removeRenderCallback(callback: () => void): void {
    const index = this.renderCallbacks.indexOf(callback)
    if (index > -1) {
      this.renderCallbacks.splice(index, 1)
    }
  }

  /**
   * 显示/隐藏坐标轴
   */
  showAxes(show: boolean, size: number = 100): void {
    if (show) {
      if (!this.axesHelper) {
        this.axesHelper = new THREE.AxesHelper(size)
        this.scene.add(this.axesHelper)
      }
    } else {
      if (this.axesHelper) {
        this.scene.remove(this.axesHelper)
        this.axesHelper.dispose()
        this.axesHelper = null
      }
    }
    this.markDirty()
  }

  /**
   * 显示/隐藏网格
   */
  showGrid(show: boolean, size: number = 500, divisions: number = 50): void {
    if (show) {
      if (!this.gridHelper) {
        this.gridHelper = new THREE.GridHelper(size, divisions, 0x888888, 0xcccccc)
        this.gridHelper.position.y = -0.01 // 稍微下移避免z-fighting
        this.scene.add(this.gridHelper)
      }
    } else {
      if (this.gridHelper) {
        this.scene.remove(this.gridHelper)
        this.gridHelper.dispose()
        this.gridHelper = null
      }
    }
    this.markDirty()
  }

  /**
   * 添加模型到场景
   */
  addModel(object: THREE.Object3D): void {
    this.modelGroup.add(object)
    this.computeSceneStats()
    this.markDirty()
  }

  /**
   * 移除模型
   */
  removeModel(object: THREE.Object3D): void {
    this.modelGroup.remove(object)
    this.markDirty()
  }

  /**
   * 清空所有模型
   */
  clearModels(): void {
    while (this.modelGroup.children.length > 0) {
      const child = this.modelGroup.children[0]
      this.modelGroup.remove(child)
      this.disposeObject(child)
    }
    this.computeSceneStats()
    this.markDirty()
  }

  /**
   * 递归释放对象资源（包括 Mesh、Line、LineSegments 等）
   */
  private disposeObject(object: THREE.Object3D): void {
    if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
      if (object.geometry) {
        object.geometry.dispose()
      }
      if (object.material) {
        if (Array.isArray(object.material)) {
          object.material.forEach(m => m.dispose())
        } else {
          object.material.dispose()
        }
      }
    }
    object.children.forEach(child => this.disposeObject(child))
  }

  /**
   * 聚焦到模型
   */
  fitToModel(padding: number = 1.5): void {
    const box = new THREE.Box3().setFromObject(this.modelGroup)

    if (box.isEmpty()) {
      return
    }

    const center = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3())
    const maxDim = Math.max(size.x, size.y, size.z)

    // 计算相机距离
    const fov = this.camera.fov * (Math.PI / 180)
    let cameraDistance = maxDim / (2 * Math.tan(fov / 2))
    cameraDistance *= padding

    // 设置相机位置（等轴测视角：标准导轨方向）
    const direction = new THREE.Vector3(1, 1, 1).normalize()
    this.camera.position.copy(center).add(direction.multiplyScalar(cameraDistance))
    // 重置相机上方向，防止 TrackballControls 自由旋转导致载入时画面歪斜
    this.camera.up.set(0, 1, 0)

    // 更新控制器目标
    this.controls.target.copy(center)
    this.controls.update()

    // 更新近远裁剪面
    this.camera.near = cameraDistance / 100
    this.camera.far = cameraDistance * 100
    this.camera.updateProjectionMatrix()

    // 更新灯光位置
    this.directionalLight.position.copy(this.camera.position)

    // 同步 ViewHelper 中心
    if (this.viewHelper) {
      this.viewHelper.center.copy(center)
    }

    this.markDirty()
  }

  /**
   * 处理 ViewHelper 点击事件
   * 仅当鼠标位于右下角 ViewHelper 区域时才处理，避免全局拦截
   */
  handleViewHelperClick(event: PointerEvent | MouseEvent): boolean {
    if (!this.viewHelper || !this.renderer) return false

    // 检查点击是否位于右下角 ViewHelper 区域
    const rect = this.renderer.domElement.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top
    const dim = this.VIEW_HELPER_DIM

    // ViewHelper 渲染在右下角，判断点击是否在该区域内
    if (x < rect.width - dim || y < rect.height - dim) {
      return false
    }

    const hit = this.viewHelper.handleClick(event as PointerEvent)
    if (hit) {
      // 仅提示帧需要渲染，不再操作 controls.enabled
      // OrbitControls 的 pointerup 处理器将正常清理 state=NONE
      this.markDirty()
    }
    return hit
  }

  /**
   * 设置视图预设
   */
  setViewPreset(preset: ViewPreset, animate: boolean = true): void {
    const box = new THREE.Box3().setFromObject(this.modelGroup)
    const center = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3())
    const maxDim = Math.max(size.x, size.y, size.z) * 2

    let position: THREE.Vector3
    let up = new THREE.Vector3(0, 1, 0)

    switch (preset) {
      case 'front':
        position = new THREE.Vector3(0, 0, maxDim)
        break
      case 'back':
        position = new THREE.Vector3(0, 0, -maxDim)
        break
      case 'top':
        position = new THREE.Vector3(0, maxDim, 0)
        up = new THREE.Vector3(0, 0, -1)
        break
      case 'bottom':
        position = new THREE.Vector3(0, -maxDim, 0)
        up = new THREE.Vector3(0, 0, 1)
        break
      case 'left':
        position = new THREE.Vector3(-maxDim, 0, 0)
        break
      case 'right':
        position = new THREE.Vector3(maxDim, 0, 0)
        break
      case 'isometric':
      default:
        position = new THREE.Vector3(maxDim, maxDim * 0.8, maxDim)
        break
    }

    position.add(center)

    if (animate) {
      this.animateCameraTo(position, center, up)
    } else {
      this.camera.position.copy(position)
      this.camera.up.copy(up)
      this.controls.target.copy(center)
      this.controls.update()
    }
  }

  /**
   * 动画移动相机
   */
  private animateCameraTo(
    position: THREE.Vector3,
    target: THREE.Vector3,
    up: THREE.Vector3,
    duration: number = 500
  ): void {
    const startPosition = this.camera.position.clone()
    const startTarget = this.controls.target.clone()
    const startUp = this.camera.up.clone()
    const startTime = Date.now()

    this.isAnimating = true

    const animate = () => {
      const elapsed = Date.now() - startTime
      const t = Math.min(elapsed / duration, 1)
      const easeT = 1 - Math.pow(1 - t, 3) // easeOutCubic

      this.camera.position.lerpVectors(startPosition, position, easeT)
      this.controls.target.lerpVectors(startTarget, target, easeT)
      this.camera.up.lerpVectors(startUp, up, easeT)
      this.controls.update()

      // 同步 ViewHelper 中心
      if (this.viewHelper) {
        this.viewHelper.center.copy(this.controls.target)
      }

      this.markDirty()

      if (t < 1) {
        requestAnimationFrame(animate)
      } else {
        this.isAnimating = false
      }
    }
    animate()
  }

  /**
   * 获取当前相机配置
   */
  getCameraConfig(): CameraConfig {
    return {
      position: this.camera.position.clone(),
      target: this.controls.target.clone(),
      up: this.camera.up.clone(),
      fov: this.camera.fov,
      near: this.camera.near,
      far: this.camera.far
    }
  }

  /**
   * 设置相机配置
   */
  setCameraConfig(config: Partial<CameraConfig>, animate: boolean = false): void {
    if (animate && config.position && config.target) {
      this.animateCameraTo(
        config.position,
        config.target,
        config.up || new THREE.Vector3(0, 1, 0)
      )
    } else {
      if (config.position) this.camera.position.copy(config.position)
      if (config.target) this.controls.target.copy(config.target)
      if (config.up) this.camera.up.copy(config.up)
      if (config.fov) this.camera.fov = config.fov
      if (config.near) this.camera.near = config.near
      if (config.far) this.camera.far = config.far
      this.camera.updateProjectionMatrix()
      this.controls.update()
      this.markDirty()
    }
  }

  /**
   * 设置背景颜色
   */
  setBackgroundColor(color: number): void {
    this.scene.background = new THREE.Color(color)
    this.markDirty()
  }

  /**
   * 截图
   */
  screenshot(): string {
    return takeScreenshot(this.renderer, this.scene, this.camera)
  }

  /**
   * 获取渲染器 DOM 元素
   */
  getDomElement(): HTMLCanvasElement {
    if (!this.renderer) {
      throw new Error('Renderer 尚未初始化，请先调用 await waitForReady()')
    }
    return this.renderer.domElement
  }

  /**
   * 更新尺寸
   */
  updateSize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return

    this.width = width
    this.height = height

    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()

    if (this.renderer) {
      this.renderer.setSize(width, height)
    }
    this.markDirty()
  }

  /**
   * 销毁场景管理器
   */
  dispose(): void {
    // 停止渲染循环
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId)
    }

    // 移除事件监听
    window.removeEventListener('resize', this.handleResize)

    // 清理控制器
    this.controls.dispose()

    // 清理 ViewHelper
    if (this.viewHelper) {
      this.viewHelper.dispose()
      this.viewHelper = null
    }

    // 清理模型
    this.clearModels()

    // 清理辅助元素
    this.showAxes(false)
    this.showGrid(false)

    // 清理渲染器
    if (this.renderer) {
      this.renderer.dispose()
      if (this.renderer.domElement?.parentNode === this.container) {
        this.container.removeChild(this.renderer.domElement)
      }
    }
  }
}

export default SceneManager
