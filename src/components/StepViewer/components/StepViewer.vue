<template>
  <div class="step-viewer" ref="viewerRef">

    <!-- 工具栏 -->
    <Toolbar :file-name="store.currentFileName" :is-loading="store.isLoading" :has-model="store.hasModel"
      :has-selection="hasAnySelection" :show-axes="store.showAxes" :show-grid="store.showGrid" :show-stats="showStats"
      :occt-ready="occtReady" :occt-load-progress="occtLoadProgress" :is-line-measure-active="store.isLineMeasureActive"
      :opacity="opacityPercent" :is-model-tree-open="modelTreeVisible" @upload="handleFileUpload"
      @fit-view="handleFitView" @toggle-axes="handleToggleAxes" @toggle-grid="handleToggleGrid"
      @opacity-change="handleOpacityChange" @clear-selection="handleClearSelection" @reset-view="handleResetView"
      @toggle-stats="handleToggleStats" @toggle-line-measure="handleToggleLineMeasure"
      @toggle-model-tree="modelTreeVisible = !modelTreeVisible" />

    <!-- 主内容区域 -->
    <div class="viewer-content">
      <!-- 左侧 URDF 结构树（固定面板） -->
      <URDFLeftPanel v-if="store.hasModel" ref="urdfLeftPanelRef" @export-urdf="handleExportURDF" />

      <!-- 模型结构树（浮动面板） -->
      <SidePanel :visible="modelTreeVisible" @tree-select="handleTreeSelect" @solid-hover="handleSolidHover"
        @toggle-solid-visibility="handleToggleSolidVisibility" @close="modelTreeVisible = false" />

      <!-- 测量面板（浮动面板） -->
      <MeasurementPanel :visible="measurePanelVisible" @remove="handleRemoveMeasurement"
        @clear-all="handleClearMeasurements" @close="measurePanelVisible = false" />

      <!-- 3D 画布 -->
      <div class="canvas-container" ref="canvasContainerRef">
        <!-- 性能监控面板 -->
        <StatsPanel :visible="showStats" :triangles="modelTriangles" :vertices="modelVertices"
          :draw-calls="frameDrawCalls" ref="statsPanelRef" />

        <!-- 加载进度动画 -->
        <LoadingOverlay :visible="store.isLoading" :progress="store.uploadProgress.progress"
          :message="store.uploadProgress.message" :status="store.uploadProgress.status"
          :file-name="store.currentFileName" />

        <!-- 绑定模式提示 -->
        <div class="binding-overlay" v-if="urdfStore.bindingMode.active">
          <el-tag type="warning" effect="dark">
            点击 3D 场景中的 Solid 绑定到 Link
            <el-button size="small" text style="color: #fff" @click="urdfStore.stopBindingMode()">完成</el-button>
          </el-tag>
        </div>

        <!-- 导出进度提示 -->
        <div class="binding-overlay" v-if="urdfStore.exporting">
          <el-tag type="info" effect="dark">
            {{ urdfStore.exportProgress || '正在导出...' }}
          </el-tag>
        </div>


      </div>

      <!-- 右侧属性面板 -->
      <URDFRightPanel v-if="store.hasModel" @flip-normal="urdfScene.flipNormal"
        @toggle-f-k-panel="handleToggleFKPanel" />

    </div>

    <!-- 浮动关节控制面板 -->
    <FloatingJointControl :visible="fkPanelVisible" @close="fkPanelVisible = false" />

    <!-- Joint 创建向导 -->
    <JointWizard ref="jointWizardRef" @created="urdfScene.handleJointCreated"
      @start-edge-pick="urdfScene.startEdgePickMode" @stop-edge-pick="urdfScene.stopEdgePickMode"
      @flip-normal="urdfScene.flipNormal" />



    <!-- 状态栏 -->
    <div class="status-bar">
      <template v-if="store.hasModel">
        <span class="status-item">实体: <b>{{ store.solids.length }}</b></span>
        <span class="status-sep">|</span>
        <span class="status-item">URDF: <b>{{ urdfStore.robot.name }}</b></span>
        <span class="status-sep">|</span>
        <span class="status-item">Links: <b>{{ urdfStore.robot.links.length }}</b></span>
        <span class="status-sep">|</span>
        <span class="status-item">Joints: <b>{{ urdfStore.robot.joints.length }}</b></span>
        <template v-if="store.selectedSolidNames.length">
          <span class="status-sep">|</span>
          <span class="status-item status-selected">{{ store.selectedSolidNames.join(', ') }}</span>
        </template>
      </template>
      <span v-else class="status-item">{{ occtReady ? '就绪 — 支持 .step / .stp 文件' : '正在加载 OpenCASCADE...' }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'
import * as THREE from 'three'
import { ElMessage } from 'element-plus'
import Toolbar from './Toolbar.vue'
import SidePanel from './SidePanel.vue'
import MeasurementPanel from './MeasurementPanel.vue'
import StatsPanel from './StatsPanel.vue'
import LoadingOverlay from './LoadingOverlay.vue'
import URDFLeftPanel from './URDFBuilder/URDFLeftPanel.vue'
import URDFRightPanel from './URDFBuilder/URDFRightPanel.vue'
import FloatingJointControl from './URDFBuilder/FloatingJointControl.vue'
import JointWizard from './URDFBuilder/JointWizard.vue'
import { useStepViewerStore } from '../stores/useStepViewerStore'
import { useURDFStore } from '../stores/useURDFStore'
import {
  StepLoader,
  SceneManager,
  SelectionManager,
  preloadOcct,
  isOcctLoaded
} from '../core'
import { LineMeasurementTool } from '../core/LineMeasurementTool'
import { disposeKinematicsWorker } from '../core/useKinematicsWorker'
import { useURDFScene } from './composables/useURDFScene'
import type { GeometryFeature, TreeNode } from '../types'
import { FeatureType, ViewPreset } from '../types'

// Props
const props = withDefaults(defineProps<{
  width?: string | number
  height?: string | number
  backgroundColor?: number
  showStatsPanel?: boolean
}>(), {
  width: '100%',
  height: '100%',
  backgroundColor: 0xf5f5f5,
  showStatsPanel: false
})

// Store
const store = useStepViewerStore()
const urdfStore = useURDFStore()

// Refs
const viewerRef = ref<HTMLElement>()
const canvasContainerRef = ref<HTMLElement>()
const statsPanelRef = ref<InstanceType<typeof StatsPanel>>()

// 性能面板状态
const showStats = ref(props.showStatsPanel)

// 性能统计数据
const modelTriangles = ref(0)
const modelVertices = ref(0)
const frameDrawCalls = ref(0)

// OCCT 加载状态
const occtReady = ref(isOcctLoaded())
/** 模拟 WASM 加载进度 0–100 */
const occtLoadProgress = ref(isOcctLoaded() ? 100 : 0)

// 浮动关节控制面板
const fkPanelVisible = ref(false)
function handleToggleFKPanel(): void {
  fkPanelVisible.value = !fkPanelVisible.value
}

// 模型结构树面板可见性
const modelTreeVisible = ref(false)
// 测量面板可见性
const measurePanelVisible = ref(false)

// 广告模态框状态
const noModelAdVisible = ref(true)
const exportCompleteAdVisible = ref(false)


// 核心模块实例
let stepLoader: StepLoader | null = null
let sceneManager: SceneManager | null = null
let selectionManager: SelectionManager | null = null
let lineMeasurementTool: LineMeasurementTool | null = null

// URDF 场景 composable
const urdfScene = useURDFScene({
  getSceneManager: () => sceneManager,
  getSelectionManager: () => selectionManager,
})

const jointWizardRef = ref<InstanceType<typeof JointWizard>>()
const urdfLeftPanelRef = ref<{ setCurrentNodeById: (id: string) => void } | null>(null)
/** 防止 watcher 触发 3D highlight 时反向触发 onSelect 联动，导致循环选中 */
let isHighlightingFromWatcher = false

/** 是否有任何选中（3D 特征 / URDF 树选中 Link 或 Joint） */
const hasAnySelection = computed(() =>
  store.selectedFeatures.length > 0
  || !!urdfStore.selectedLinkId
  || !!urdfStore.selectedJointId
)

/**
 * 统一计算当前应高亮的 Solid ID 列表
 * 响应：bindingMode / selectedLinkId / selectedJointId / link.solidIds 变化
 */
const effectiveHighlightSolidIds = computed<string[]>(() => {
  // 绑定模式：高亮目标 Link 的所有 Solid
  if (urdfStore.bindingMode.active && urdfStore.bindingMode.targetLinkId) {
    const link = urdfStore.linkMap.get(urdfStore.bindingMode.targetLinkId)
    return link?.solidIds.slice() ?? []
  }
  // 选中 Link：高亮该 Link 绑定的所有 Solid
  if (urdfStore.selectedLinkId) {
    const link = urdfStore.linkMap.get(urdfStore.selectedLinkId)
    return link?.solidIds.slice() ?? []
  }
  // 选中 Joint：高亮 parent + child Link 的所有 Solid
  if (urdfStore.selectedJointId) {
    const joint = urdfStore.jointMap.get(urdfStore.selectedJointId)
    if (joint) {
      const parentLink = urdfStore.linkMap.get(joint.parentLinkId)
      const childLink = urdfStore.linkMap.get(joint.childLinkId)
      return [
        ...(parentLink?.solidIds ?? []),
        ...(childLink?.solidIds ?? [])
      ]
    }
  }
  return []
})

// 计算属性

const opacityPercent = computed(() => {
  return Math.round(store.globalOpacity * 100)
})

// ========== 生命周期 ==========

onMounted(async () => {
  await nextTick()

  // 预加载 OpenCASCADE WASM（带模拟进度）
  let progressTimer: ReturnType<typeof setInterval> | null = null
  if (!occtReady.value) {
    occtLoadProgress.value = 5
    progressTimer = setInterval(() => {
      if (occtLoadProgress.value < 90) {
        occtLoadProgress.value += Math.random() * 8 + 2
        if (occtLoadProgress.value > 90) occtLoadProgress.value = 90
      }
    }, 600)
  }
  preloadOcct()
    .then(() => {
      if (progressTimer) clearInterval(progressTimer)
      occtLoadProgress.value = 100
      occtReady.value = true
      console.log('OpenCASCADE WASM 预加载完成')
    })
    .catch(err => {
      if (progressTimer) clearInterval(progressTimer)
      occtLoadProgress.value = 0
      console.error('OpenCASCADE 预加载失败:', err)
    })

  await initViewer()

  // 键盘快捷键：x/y/z 切换六轴视图，f 归位
  window.addEventListener('keydown', handleViewShortcut)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleViewShortcut)
  disposeViewer()
})

// ========== 初始化 ==========

async function initViewer(): Promise<void> {
  if (!canvasContainerRef.value) return

  stepLoader = new StepLoader()

  sceneManager = new SceneManager({
    container: canvasContainerRef.value,
    backgroundColor: props.backgroundColor,
    showAxes: store.showAxes,
    showGrid: store.showGrid
  })

  await sceneManager.waitForReady()

  selectionManager = new SelectionManager({
    camera: sceneManager.camera,
    scene: sceneManager.scene,
    domElement: sceneManager.getDomElement(),
    controls: sceneManager.controls,
    onRenderRequest: () => sceneManager?.requestRender()
  })

  // 选择回调 → 更新 store、辅助线、树同步
  selectionManager.onSelect((event) => {
    // 由 watcher 程序化触发的选择（高亮回放），直接跳过，绝不触发任何业务逻辑
    if (isHighlightingFromWatcher) return

    const features = event.selections.map(s => s.feature)

    // URDF 绑定模式：拦截选择，直接绑定 Solid
    if (urdfStore.bindingMode.active && features.length > 0) {
      urdfScene.handleBindingClick(features[0])
      return
    }

    // URDF 边拾取模式：拦截选择，传给 JointWizard 或已有 Joint
    if (urdfScene.isEdgePickMode() && features.length > 0) {
      const f = features[0]
      const isAccepted = f.edgeCurveType === 'circle' || f.edgeCurveType === 'arc'
        || f.edgeCurveType === 'line' || f.type === FeatureType.CYLINDER

      if (!isAccepted) {
        if (f.edgeCurveType === 'bspline' || f.edgeCurveType === 'bezier') {
          ElMessage.warning('不支持 B 样条/贝塞尔曲线，请选择圆弧边或直线')
        } else {
          ElMessage.warning('请选择圆弧边或直线作为旋转轴参考')
        }
        return
      }

      // 编辑模式：更新已有 Joint 的 origin/axis
      if (urdfStore.edgePickEditJointId) {
        urdfScene.applyPickedEdgeToExistingJoint(urdfStore.edgePickEditJointId, f)
      } else {
        // 创建模式：传给 JointWizard
        jointWizardRef.value?.applyPickedEdge(f)
      }
      return
    }

    // URDF Base Pick 模式：拾取 Solid 面设置 Base Origin
    if (urdfStore.basePickMode && features.length > 0) {
      const f = features[0]
      let px = 0, py = 0, pz = 0
      if (f.center) {
        px = f.center.x; py = f.center.y; pz = f.center.z
      } else if (f.solidId) {
        const solid = store.solidMap.get(f.solidId)
        const pos = solid?.serializedData?.positions
        if (pos && pos.length >= 3) {
          let sx = 0, sy = 0, sz = 0, n = 0
          for (let i = 0; i < pos.length; i += 3) { sx += pos[i]; sy += pos[i + 1]; sz += pos[i + 2]; n++ }
          if (n > 0) { px = sx / n; py = sy / n; pz = sz / n }
        }
      }
      const round = (v: number) => Math.round(v * 10000) / 10000
      urdfStore.baseLinkOrigin = [round(px), round(py), round(pz)]
      urdfStore.basePickMode = false
      urdfScene.updateFKAndFrames()
      ElMessage.success('Base Origin 已设置')
      return
    }

    store.setSelectedFeatures(features)

    // 3D 点击 Solid → 反向联动左侧树选中对应 Link
    // isHighlightingFromWatcher 为 true 或绑定模式激活时不进行反向联动（避免切换右侧面板）
    if (!isHighlightingFromWatcher
      && !urdfStore.bindingMode.active
      && features.length > 0 && features[0].solidId) {
      const solidId = features[0].solidId
      const ownerLink = urdfStore.robot.links.find(l => l.solidIds.includes(solidId))
      if (ownerLink) {
        urdfStore.selectedLinkId = ownerLink.id
        urdfStore.selectedJointId = null
        nextTick(() => urdfLeftPanelRef.value?.setCurrentNodeById(ownerLink.id))
      }
    }

    // 同步树节点选中
    if (event.selectedTreeNodeIds) {
      // 自动展开被选中边节点的父级 solid 节点
      for (const id of event.selectedTreeNodeIds) {
        const edgeMatch = id.match(/^(solid_\d+)_edge_\d+$/)
        if (edgeMatch) {
          const parentSolidId = edgeMatch[1]
          if (!store.expandedTreeNodeIds.includes(parentSolidId)) {
            store.expandedTreeNodeIds.push(parentSolidId)
          }
        }
      }
      store.syncTreeFromSelection(event.selectedTreeNodeIds)
    }

    urdfScene.updateFKAndFrames() // refresh after tree sync
    sceneManager?.markDirty()
  })

  // Hover 回调 → 驱动 Snap Gizmo 可视化
  selectionManager.onHover((feature) => {
    urdfScene.handleHoverSnap(feature)
  })

  // 渲染回调
  sceneManager.addRenderCallback(() => {
    if (sceneManager) {
      frameDrawCalls.value = sceneManager.frameDrawCalls
    }
  })

  // ViewHelper 点击处理（使用 pointerup 而非 click，与 ViewHelper API 一致）
  const domElement = sceneManager.getDomElement()
  domElement.addEventListener('pointerup', handleViewHelperClick)

  // 初始化画线测量工具
  lineMeasurementTool = new LineMeasurementTool({
    scene: sceneManager.scene,
    camera: sceneManager.camera,
    domElement: sceneManager.getDomElement(),
    container: canvasContainerRef.value,
    controls: sceneManager.controls,
    onRenderRequest: () => sceneManager?.requestRender(),
    onLineAdded: (line) => {
      store.addLineMeasurement(line)
      sceneManager?.markDirty()
    },
    onLineRemoved: (id) => {
      store.removeLineMeasurement(id)
      sceneManager?.markDirty()
    }
  })

  // 尺寸监听
  const resizeObserver = new ResizeObserver(() => {
    if (canvasContainerRef.value && sceneManager) {
      const { clientWidth, clientHeight } = canvasContainerRef.value
      sceneManager.updateSize(clientWidth, clientHeight)
    }
  })
  resizeObserver.observe(canvasContainerRef.value)
}

// ========== 键盘视角快捷键 ==========
// x → X+ 右视图  X(Shift+x) → X- 左视图
// y → Y+ 顶视图  Y(Shift+y) → Y- 底视图
// z → Z+ 前视图  Z(Shift+z) → Z- 后视图
// f → 等轴测归位
function handleViewShortcut(e: KeyboardEvent): void {
  // 正在输入文字时不触发
  const tag = (e.target as HTMLElement)?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA') return
  if (!sceneManager) return

  switch (e.key) {
    case 'x': sceneManager.setViewPreset(ViewPreset.RIGHT); break  // +X 轴视图（右面）
    case 'X': sceneManager.setViewPreset(ViewPreset.LEFT); break  // -X 轴视图（左面）
    case 'y': sceneManager.setViewPreset(ViewPreset.TOP); break  // +Y 轴视图（顶面）
    case 'Y': sceneManager.setViewPreset(ViewPreset.BOTTOM); break  // -Y 轴视图（底面）
    case 'z': sceneManager.setViewPreset(ViewPreset.FRONT); break  // +Z 轴视图（前面）
    case 'Z': sceneManager.setViewPreset(ViewPreset.BACK); break  // -Z 轴视图（后面）
    case 'f': sceneManager.setViewPreset(ViewPreset.ISOMETRIC); break // 等轴测归位
    default: return
  }
}

function disposeViewer(): void {
  // 离开画线模式
  if (lineMeasurementTool) {
    lineMeasurementTool.dispose()
    lineMeasurementTool = null
  }

  // 移除 ViewHelper 事件
  if (sceneManager) {
    const domElement = sceneManager.getDomElement()
    domElement.removeEventListener('pointerup', handleViewHelperClick)
  }

  // 清理 URDF 模块
  urdfScene.disposeModules()
  disposeKinematicsWorker()

  selectionManager?.dispose()
  sceneManager?.dispose()

  stepLoader = null
  sceneManager = null
  selectionManager = null
}

// ========== ViewHelper ==========

function handleViewHelperClick(event: PointerEvent): void {
  if (sceneManager?.handleViewHelperClick(event)) {
    // ViewHelper 吃掉了事件，不要传给 SelectionManager
    event.stopPropagation()
  }
}

// ========== 文件上传 ==========

async function handleFileUpload(file: File): Promise<void> {
  if (!stepLoader) return

  // ★ 确保 OCCT 已加载
  if (!occtReady.value) {
    ElMessage.warning('OpenCASCADE 引擎正在加载，请稍候...')
    return
  }

  const validation = stepLoader.validateFile(file)
  if (!validation.valid) {
    ElMessage.error(validation.error || '文件校验失败')
    return
  }

  try {
    handleClearAll()
    store.setFileName(file.name)

    store.updateUploadProgress({
      status: 'parsing',
      progress: 5,
      message: '准备加载...'
    })

    const { solids, group, treeNodes } = await stepLoader.loadFile(file, (progress) => {
      if (progress.status === 'success') {
        store.updateUploadProgress({
          status: 'parsing',
          progress: 90,
          message: '正在渲染模型...'
        })
      } else {
        store.updateUploadProgress(progress)
      }
    })

    // 添加到场景
    if (sceneManager) {
      sceneManager.addModel(group)
      sceneManager.fitToModel()
    }

    // 更新 store
    store.setSolids(solids)
    store.setTreeNodes(treeNodes)

    // 设置选择管理器
    if (selectionManager) {
      selectionManager.setSolids(solids)
      // 应用 store 中已配置的初始透明度（默认 0.3）
      selectionManager.setOpacity(null, store.globalOpacity)
      store.setTransparent(store.globalOpacity < 1)
    }

    // 更新统计
    modelTriangles.value = sceneManager?.sceneTriangles ?? 0
    modelVertices.value = sceneManager?.sceneVertices ?? 0

    await nextTick()

    // ★ 确保模型可见：布局变化后强制重新适配 + 延迟再次渲染
    if (sceneManager && canvasContainerRef.value) {
      const { clientWidth, clientHeight } = canvasContainerRef.value
      if (clientWidth > 0 && clientHeight > 0) {
        sceneManager.updateSize(clientWidth, clientHeight)
      }
      sceneManager.fitToModel()
    }

    store.updateUploadProgress({
      status: 'success',
      progress: 100,
      message: '加载完成'
    })

    // ★ 导入完成后自动初始化 URDF 模块
    initURDFModules()

    ElMessage.success('模型加载成功')
  } catch (error) {
    console.error('加载失败:', error)
    store.updateUploadProgress({
      status: 'error',
      progress: 0,
      message: error instanceof Error ? error.message : '加载失败'
    })
    ElMessage.error(error instanceof Error ? error.message : '模型加载失败')
  }
}

// ========== 树选择（双向同步） ==========

/**
 * 从模型树选择节点 → 3D 高亮
 * ★ 使用 ID 查找而非数组索引，避免 InstancedMesh 分组后顺序改变导致的错位
 */
function handleTreeSelect(node: TreeNode, multi: boolean): void {
  if (!selectionManager) return

  if (node.type === 'solid' && node.solidIndex !== undefined) {
    const solidId = `solid_${node.solidIndex}`
    const solid = store.solidMap.get(solidId)
    if (solid) {
      selectionManager.selectBySolidId(solid.id, multi)
    }
  } else if (node.type === 'edge' && node.solidIndex !== undefined && node.edgeIndex !== undefined) {
    const solidId = `solid_${node.solidIndex}`
    const solid = store.solidMap.get(solidId)
    if (solid) {
      selectionManager.selectByEdgeIndex(solid.id, node.edgeIndex, multi)
    }
  }

  sceneManager?.markDirty()
}

// ========== 工具栏事件 ==========

function handleFitView(): void {
  sceneManager?.fitToModel()
}

function handleToggleAxes(): void {
  const newValue = !store.showAxes
  store.setShowAxes(newValue)
  sceneManager?.showAxes(newValue)
}

function handleToggleGrid(): void {
  const newValue = !store.showGrid
  store.setShowGrid(newValue)
  sceneManager?.showGrid(newValue)
}

function handleOpacityChange(percent: number): void {
  const opacity = percent / 100
  store.setGlobalOpacity(opacity)
  store.setTransparent(opacity < 1)
  selectionManager?.setOpacity(null, opacity)
  sceneManager?.markDirty()
}

function handleToggleStats(): void {
  showStats.value = !showStats.value
}

function handleClearSelection(): void {
  // 绑定模式 / 边拾取模式下禁止清除选择（保护当前工作现场）
  if (urdfStore.bindingMode.active) {
    ElMessage.warning('请先点击「 完成绑定」按钮，完成当前 Solid 绑定后再操作')
    return
  }
  if (urdfStore.edgePickEditJointId) {
    ElMessage.warning('请先点击「✕ 停止拾取」结束关节轴线拾取后再操作')
    return
  }
  selectionManager?.clearSelection()
  store.clearSelection()
  // 同步清除树选中状态
  urdfStore.selectedLinkId = null
  urdfStore.selectedJointId = null
  nextTick(() => urdfLeftPanelRef.value?.setCurrentNodeById(''))
}

function handleResetView(): void {
  sceneManager?.fitToModel()
}

// ========== 画线测量 ==========

function handleToggleLineMeasure(): void {
  if (!lineMeasurementTool) return
  const active = !store.isLineMeasureActive
  store.setLineMeasureActive(active)
  if (active) {
    lineMeasurementTool.activate()
    measurePanelVisible.value = true
    // 画线模式下禁用选择管理器
    selectionManager?.setEnabled(false)
  } else {
    lineMeasurementTool.deactivate()
    measurePanelVisible.value = false
    selectionManager?.setEnabled(true)
  }
  sceneManager?.markDirty()
}

function handleRemoveMeasurement(id: string): void {
  lineMeasurementTool?.removeLine(id)
  sceneManager?.markDirty()
}

function handleClearMeasurements(): void {
  lineMeasurementTool?.clearAll()
  store.clearLineMeasurements()
  sceneManager?.markDirty()
}

function handleClearAll(): void {
  handleClearSelection()
  // 清理画线测量
  if (lineMeasurementTool) {
    lineMeasurementTool.clearAll()
  }
  store.clearLineMeasurements()
  if (store.isLineMeasureActive) {
    store.setLineMeasureActive(false)
    lineMeasurementTool?.deactivate()
    selectionManager?.setEnabled(true)
  }

  // 清理 URDF 状态（修复重载模型 bug）
  urdfStore.clearAll()
  urdfScene.disposeModules()

  sceneManager?.clearModels()
  store.clearModel()
  modelTriangles.value = 0
  modelVertices.value = 0
  frameDrawCalls.value = 0
}

function initURDFModules(): void {
  urdfScene.initModules()
}

// ========== URDF 导出 ==========

async function handleExportURDF(): Promise<void> {
  await urdfScene.handleExportURDF(exportCompleteAdVisible)
}

// ========== Watchers ==========

// 深度监听关节所有属性变化（currentValue、origin、axis、limits 等），实时更新 FK
watch(
  () => urdfStore.robot.joints,
  () => {
    urdfScene.updateFKAndFrames()
  },
  { deep: true }
)

// 监听显示坐标系切换
watch(() => urdfStore.showFrames, (val) => {
  urdfScene.setFrameVisible(val)
  sceneManager?.markDirty()
})

// 监听 link 结构变化（link 增删可能影响 FK 树）
watch(
  () => urdfStore.robot.links.length,
  () => {
    urdfScene.updateFKAndFrames()
  }
)

// 监听 edgePickEditJointId：由右侧属性面板写入，驱动 StepViewer 进入/退出边拾取模式
watch(
  () => urdfStore.edgePickEditJointId,
  (id, oldId) => {
    if (id && !urdfScene.isEdgePickMode()) {
      urdfScene.startEdgePickMode()
    } else if (!id && urdfScene.isEdgePickMode()) {
      urdfScene.stopEdgePickMode()
    }
  }
)

// 监听坐标轴缩放比变化 → 重建所有 frame 可视化
watch(
  () => urdfStore.axisHelperScale,
  (scale) => {
    urdfScene.setAxisLength(scale)
  }
)

// 监听 Base Origin 变化 → 刷新 Base Frame 可视化
watch(
  () => urdfStore.baseLinkOrigin,
  () => {
    urdfScene.updateFKAndFrames()
  },
  { deep: true }
)

// 监听 Base Orientation 变化 → 刷新 Base Frame 朝向
watch(
  () => urdfStore.baseLinkRPY,
  () => {
    urdfScene.updateFKAndFrames()
  },
  { deep: true }
)

// ★ 统一监听高亮 Solid 列表变化
// 响应：bindingMode 开关、selectedLinkId/selectedJointId 切换、link.solidIds 增删
// 替代原来的两个独立 watcher，同时修复 unbind 后高亮残留和取消选择按钮置灰的问题
watch(
  effectiveHighlightSolidIds,
  (solidIds) => {
    if (!selectionManager) return
    isHighlightingFromWatcher = true
    try {
      selectionManager.clearSelection()
      solidIds.forEach(sid => selectionManager!.selectBySolidId(sid, true))
    } finally {
      isHighlightingFromWatcher = false
    }
    // ★ 同步 store.selectedFeatures，确保 Toolbar 的「取消选择」按钮状态正确
    store.setSelectedFeatures(selectionManager.getSelectedFeatures())
    sceneManager?.markDirty()
  }
)

// ========== Solid Hover / Visibility ==========

/** 模型树 hover solid → 3D 临时高亮 */
function handleSolidHover(solidId: string | null): void {
  selectionManager?.hoverBySolidId(solidId)
  sceneManager?.markDirty()
}

/** 模型树切换 solid 显示/隐藏 */
function handleToggleSolidVisibility(solidId: string): void {
  store.toggleSolidVisibility(solidId)
  const visible = store.isSolidVisible(solidId)
  // 通过 SelectionManager 统一处理可见性，同时更新射线检测缓存
  selectionManager?.setVisibility(solidId, visible)
  sceneManager?.markDirty()
}

// 监听 solidVisibilityMap 变化，同步 3D 场景（处理 clearModel 等批量重置场景）
watch(
  () => store.solidVisibilityMap.size,
  () => {
    for (const solid of store.solids) {
      const visible = store.isSolidVisible(solid.id)
      if (solid.mesh) {
        solid.mesh.visible = visible
      }
    }
    sceneManager?.markDirty()
  }
)

// 暴露方法给父组件
defineExpose({
  fitView: handleFitView,
  clearSelection: handleClearSelection,
  loadFile: handleFileUpload
})
</script>

<style lang="scss" scoped>
.step-viewer {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  background: #fff;
  overflow: hidden;
}

.viewer-content {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.canvas-container {
  flex: 1;
  position: relative;
  overflow: hidden;
  background: #f5f5f5;

  :deep(canvas) {
    display: block;
  }
}

.empty-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: rgba(245, 245, 245, 0.95);
  z-index: 10;
}

.binding-overlay {
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 20;
}

.empty-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.empty-text {
  color: #909399;
  font-size: 14px;
  margin: 0;
}

.status-bar {
  display: flex;
  align-items: center;
  padding: 3px 12px;
  font-size: 12px;
  color: #606266;
  background: #f5f5f5;
  border-top: 1px solid #e4e7ed;
  white-space: nowrap;
  overflow: hidden;
  gap: 0;

  .status-item {
    flex-shrink: 0;

    b {
      font-weight: 600;
      color: #303133;
    }
  }

  .status-sep {
    margin: 0 6px;
    color: #c0c4cc;
    flex-shrink: 0;
  }

  .status-selected {
    color: #409eff;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }
}
</style>
