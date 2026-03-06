/**
 * STEP Viewer 状态管理
 */

import { defineStore } from 'pinia'
import { ref, computed, markRaw } from 'vue'
import type {
  SolidObject,
  GeometryFeature,
  SelectionInfo,
  UploadProgress,
  TreeNode,
} from '../types'
import type { LineMeasurementData } from '../core/LineMeasurementTool'

export const useStepViewerStore = defineStore('stepViewer', () => {
  // ============ 状态 ============

  // 上传状态
  const uploadProgress = ref<UploadProgress>({
    status: 'idle',
    progress: 0,
    message: ''
  })

  // 模型数据
  const solids = ref<SolidObject[]>([])
  const currentFileName = ref<string>('')

  // 结构树状态
  const treeNodes = ref<TreeNode[]>([])
  const selectedTreeNodeIds = ref<string[]>([])
  const expandedTreeNodeIds = ref<string[]>([])
  const treeNodeCount = ref(0)

  // 侧栏状态
  const sidePanelVisible = ref(true)
  const sidePanelWidth = ref(280)

  // 选择状态
  const selectedFeatures = ref<GeometryFeature[]>([])

  // 画线测量状态
  const lineMeasurements = ref<LineMeasurementData[]>([])
  const isLineMeasureActive = ref(false)

  // 显示设置
  const showAxes = ref(false)
  const showGrid = ref(true)
  const globalOpacity = ref(0.3)
  const isTransparent = ref(false)

  // Solid 显隐状态: solidId -> visible
  const solidVisibilityMap = ref(new Map<string, boolean>())

  // ============ 计算属性 ============

  // 是否已加载模型
  const hasModel = computed(() => solids.value.length > 0)

  // 是否正在加载
  const isLoading = computed(() =>
    uploadProgress.value.status === 'uploading' ||
    uploadProgress.value.status === 'parsing'
  )

  // 选中的第一个特征
  const firstSelectedFeature = computed(() => selectedFeatures.value[0] || null)

  // 选中的第二个特征
  const secondSelectedFeature = computed(() => selectedFeatures.value[1] || null)

  // 是否可以测量（选中两个特征）
  const canMeasure = computed(() => selectedFeatures.value.length === 2)

  // 所有特征的类型统计
  const featureStats = computed(() => {
    const stats: Record<string, number> = {}
    solids.value.forEach(solid => {
      solid.features.forEach(feature => {
        const type = feature.type
        stats[type] = (stats[type] || 0) + 1
      })
    })
    return stats
  })

  /** 扁平化树节点（用于快速查找） */
  const flatTreeNodes = computed(() => {
    const result: TreeNode[] = []
    const walk = (nodes: TreeNode[]) => {
      for (const node of nodes) {
        result.push(node)
        if (node.children) walk(node.children)
      }
    }
    walk(treeNodes.value)
    return result
  })

  /** 选中节点 ID 的 Set（O(1) 查找） */
  const selectedTreeNodeIdSet = computed(() => new Set(selectedTreeNodeIds.value))

  /** Solid ID → SolidObject 映射（O(1) 查找，修复数组索引查找错位问题） */
  const solidMap = computed(() => {
    const map = new Map<string, SolidObject>()
    solids.value.forEach(s => map.set(s.id, s))
    return map
  })

  /** 选中的 Solid 名称列表 */
  const selectedSolidNames = computed(() => {
    return selectedTreeNodeIds.value
      .map(id => flatTreeNodes.value.find(n => n.id === id))
      .filter(Boolean)
      .map(n => n!.name)
  })

  // ============ 动作 ============

  /**
   * 更新上传进度
   */
  function updateUploadProgress(progress: Partial<UploadProgress>): void {
    uploadProgress.value = { ...uploadProgress.value, ...progress }
  }

  /**
   * 设置模型数据
   * ★ 将大对象 (mesh, serializedData 等) 标记为非响应式，避免 Vue Proxy 包裹导致的性能开销
   */
  function setSolids(newSolids: SolidObject[]): void {
    for (const solid of newSolids) {
      if (solid.mesh) markRaw(solid.mesh)
      if (solid.serializedData) markRaw(solid.serializedData as any)
      if (solid.edgeLines) markRaw(solid.edgeLines)
      if (solid.topologyEdges) markRaw(solid.topologyEdges)
    }
    solids.value = newSolids
  }

  /**
   * 设置结构树节点
   */
  function setTreeNodes(nodes: TreeNode[]): void {
    treeNodes.value = nodes
    // 默认只展开根层和 Compound 层
    const idsToExpand: string[] = []
    let count = 0
    const walk = (ns: TreeNode[]) => {
      for (const n of ns) {
        count++
        if (n.type === 'root' || n.type === 'compound') {
          idsToExpand.push(n.id)
        }
        if (n.children) walk(n.children)
      }
    }
    walk(nodes)
    expandedTreeNodeIds.value = idsToExpand
    treeNodeCount.value = count
  }

  /**
   * 选中树节点（来自树的交互）
   */
  function selectTreeNode(nodeId: string, multi = false): void {
    if (multi) {
      const idx = selectedTreeNodeIds.value.indexOf(nodeId)
      if (idx >= 0) {
        selectedTreeNodeIds.value.splice(idx, 1)
      } else {
        selectedTreeNodeIds.value.push(nodeId)
      }
    } else {
      selectedTreeNodeIds.value = [nodeId]
    }
  }

  /**
   * 从 3D 选中同步到树（3D→树方向）
   */
  function syncTreeFromSelection(treeNodeIds: string[]): void {
    selectedTreeNodeIds.value = [...treeNodeIds]
  }

  /**
   * 清空树选择
   */
  function clearTreeSelection(): void {
    selectedTreeNodeIds.value = []
  }

  /**
   * 设置当前文件名
   */
  function setFileName(name: string): void {
    currentFileName.value = name
  }

  /**
   * 清空模型
   */
  function clearModel(): void {
    solids.value = []
    currentFileName.value = ''
    selectedFeatures.value = []
    lineMeasurements.value = []
    isLineMeasureActive.value = false
    isTransparent.value = false
    treeNodes.value = []
    selectedTreeNodeIds.value = []
    expandedTreeNodeIds.value = []
    solidVisibilityMap.value = new Map()
    uploadProgress.value = {
      status: 'idle',
      progress: 0,
      message: ''
    }
  }

  /**
   * 设置选中的特征
   */
  function setSelectedFeatures(features: GeometryFeature[]): void {
    selectedFeatures.value = features
  }

  /**
   * 清空选择
   */
  function clearSelection(): void {
    selectedFeatures.value = []
    selectedTreeNodeIds.value = []
  }

  // ========== 画线测量 ==========

  function addLineMeasurement(line: LineMeasurementData): void {
    lineMeasurements.value.push(line)
  }

  function removeLineMeasurement(id: string): void {
    const idx = lineMeasurements.value.findIndex(l => l.id === id)
    if (idx > -1) lineMeasurements.value.splice(idx, 1)
  }

  function clearLineMeasurements(): void {
    lineMeasurements.value = []
  }

  function setLineMeasureActive(active: boolean): void {
    isLineMeasureActive.value = active
  }


  /**
   * 切换 Solid 显隐状态
   */
  function toggleSolidVisibility(solidId: string): void {
    const current = solidVisibilityMap.value.get(solidId) ?? true
    solidVisibilityMap.value.set(solidId, !current)
    // 触发响应式更新
    solidVisibilityMap.value = new Map(solidVisibilityMap.value)
  }

  /**
   * 获取 Solid 是否可见
   */
  function isSolidVisible(solidId: string): boolean {
    return solidVisibilityMap.value.get(solidId) ?? true
  }

  /**
   * 切换侧栏可见性
   */
  function toggleSidePanel(): void {
    sidePanelVisible.value = !sidePanelVisible.value
  }

  /**
   * 设置侧栏宽度
   */
  function setSidePanelWidth(width: number): void {
    sidePanelWidth.value = Math.max(120, Math.min(500, width))
  }

  /**
   * 设置显示设置
   */
  function setShowAxes(show: boolean): void {
    showAxes.value = show
  }

  function setShowGrid(show: boolean): void {
    showGrid.value = show
  }

  /**
   * 设置全局透明度
   */
  function setGlobalOpacity(opacity: number): void {
    globalOpacity.value = opacity
  }

  /**
   * 设置透明模式
   */
  function setTransparent(value: boolean): void {
    isTransparent.value = value
  }

  return {
    // 状态
    uploadProgress,
    solids,
    currentFileName,
    treeNodes,
    selectedTreeNodeIds,
    expandedTreeNodeIds,
    sidePanelVisible,
    sidePanelWidth,
    selectedFeatures,
    lineMeasurements,
    isLineMeasureActive,
    showAxes,
    showGrid,
    globalOpacity,
    isTransparent,
    solidVisibilityMap,

    // 计算属性
    hasModel,
    isLoading,
    firstSelectedFeature,
    secondSelectedFeature,
    canMeasure,
    featureStats,
    flatTreeNodes,
    selectedTreeNodeIdSet,
    selectedSolidNames,
    solidMap,
    treeNodeCount,

    // 动作
    updateUploadProgress,
    setSolids,
    setFileName,
    setTreeNodes,
    selectTreeNode,
    syncTreeFromSelection,
    clearTreeSelection,
    clearModel,
    setSelectedFeatures,
    clearSelection,
    addLineMeasurement,
    removeLineMeasurement,
    clearLineMeasurements,
    setLineMeasureActive,
    toggleSolidVisibility,
    isSolidVisible,
    toggleSidePanel,
    setSidePanelWidth,
    setShowAxes,
    setShowGrid,
    setGlobalOpacity,
    setTransparent,
  }
})
