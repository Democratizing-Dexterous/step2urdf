<!--
  模型结构树组件（虚拟滚动版）
  仿 SolidWorks 特征管理器 FeatureManager
  支持 Compound → Solid → Edge 层级
  双向联动 + 边缘描边高亮
  使用 el-tree-v2 虚拟化，支持万级节点
-->

<template>
  <div class="model-tree">
    <div class="tree-header">
      <span class="tree-title">模型结构</span>
      <span v-if="store.hasModel" class="tree-count">{{ store.treeNodeCount }} 项</span>
    </div>

    <div v-if="!store.hasModel" class="tree-empty">
      <p>暂无模型</p>
      <p class="hint">请上传 STEP 文件</p>
    </div>

    <div v-else class="tree-content" ref="treeContainerRef">
      <el-tree-v2 ref="treeRef" :data="store.treeNodes" :props="treeProps" :height="treeHeight" :item-size="28"
        :indent="24" :default-expanded-keys="store.expandedTreeNodeIds" :highlight-current="true"
        :expand-on-click-node="false" :current-node-key="currentNodeKey" @node-click="handleNodeClick"
        @node-expand="handleNodeExpand" @node-collapse="handleNodeCollapse">
        <template #default="{ data }">
          <div class="tree-node" :class="{
            'is-selected': store.selectedTreeNodeIdSet.has(data.id),
            'is-solid': data.type === 'solid',
            'is-edge': data.type === 'edge',
            'is-compound': data.type === 'compound' || data.type === 'root'
          }" @mouseenter="handleNodeMouseEnter(data)" @mouseleave="handleNodeMouseLeave">
            <span class="node-icon">{{ getNodeIcon(data) }}</span>
            <span class="node-label" :title="data.name">{{ data.name }}</span>
            <span v-if="data.children && data.children.length" class="node-count">
              ({{ data.children.length }})
            </span>
            <!-- Solid 节点显示/隐藏切换 -->
            <span v-if="data.type === 'solid'" class="node-visibility" :class="{ 'is-hidden': !isSolidVisible(data) }"
              @click.stop="handleToggleVisibility(data)" :title="isSolidVisible(data) ? '隐藏' : '显示'">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                <template v-if="isSolidVisible(data)">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </template>
                <template v-else>
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                  <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </template>
              </svg>
            </span>
          </div>
        </template>
      </el-tree-v2>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import type { TreeNode } from '../types'
import { useStepViewerStore } from '../stores/useStepViewerStore'

const store = useStepViewerStore()

// 事件
const emit = defineEmits<{
  (e: 'select', node: TreeNode, multi: boolean): void
  (e: 'solidHover', solidId: string | null): void
  (e: 'toggleSolidVisibility', solidId: string): void
}>()

const treeRef = ref()
const treeContainerRef = ref<HTMLElement>()
/** el-tree-v2 虚拟滚动必须传数字像素高度，通过 ResizeObserver 跟踪容器实际高度 */
const treeHeight = ref(600)
/** 标记选择来源：树点击时为 true，防止 watcher 反向 scrollTo 导致虚拟列表跳位 */
let selectionFromTree = false


const treeProps = {
  children: 'children',
  label: 'name',
  value: 'id'
}

/** 当前高亮的节点 key */
const currentNodeKey = computed(() => {
  return store.selectedTreeNodeIds[0] || ''
})

/**
 * 获取节点图标
 */
function getNodeIcon(data: TreeNode): string {
  switch (data.type) {
    case 'root': return '📦'
    case 'compound': return '📁'
    case 'solid': return '🧊'
    case 'shell': return '🔲'
    case 'edge': return getEdgeTypeIcon(data.name)
    default: return '📄'
  }
}


function getEdgeTypeIcon(name: string): string {
  if (name.includes('线段') || name.includes('直线')) return '➖'
  if (name.includes('圆弧') || name.includes('圆')) return '➰'
  if (name.includes('椰圆') || name.includes('椭圆')) return '⬭️'
  if (name.includes('B样条') || name.includes('B-Spline')) return '〰️'
  if (name.includes('Bezier') || name.includes('贝塞尔')) return '〰️'
  return '—'
}

/**
 * 处理节点点击 — el-tree-v2 签名: (data, node, e)
 */
function handleNodeClick(data: any, _node: any, e: MouseEvent): void {
  const node = data as TreeNode
  const multi = e?.ctrlKey || e?.shiftKey || false
  // 标记本次选择来自树，watcher 中不需要 scrollTo
  selectionFromTree = true
  emit('select', node, multi)
}

/**
 * 处理节点展开/折叠
 */
function handleNodeExpand(data: any): void {
  const node = data as TreeNode
  if (!store.expandedTreeNodeIds.includes(node.id)) {
    store.expandedTreeNodeIds.push(node.id)
  }
}

function handleNodeCollapse(data: any): void {
  const node = data as TreeNode
  const idx = store.expandedTreeNodeIds.indexOf(node.id)
  if (idx >= 0) {
    store.expandedTreeNodeIds.splice(idx, 1)
  }
}

// ========== Hover & Visibility ==========
let hoveredSolidId: string | null = null
let hoverRafId = 0

function handleNodeMouseEnter(data: any): void {
  const node = data as TreeNode
  if (node.type !== 'solid' || node.solidIndex === undefined) {
    // 非 solid 节点，清除 hover
    if (hoveredSolidId !== null) {
      hoveredSolidId = null
      cancelAnimationFrame(hoverRafId)
      emit('solidHover', null)
    }
    return
  }
  const solidId = `solid_${node.solidIndex}`
  if (solidId === hoveredSolidId) return
  hoveredSolidId = solidId
  cancelAnimationFrame(hoverRafId)
  hoverRafId = requestAnimationFrame(() => {
    emit('solidHover', hoveredSolidId)
  })
}

function handleNodeMouseLeave(): void {
  if (hoveredSolidId !== null) {
    hoveredSolidId = null
    cancelAnimationFrame(hoverRafId)
    emit('solidHover', null)
  }
}

function handleToggleVisibility(data: any): void {
  const node = data as TreeNode
  if (node.type !== 'solid' || node.solidIndex === undefined) return
  const solidId = `solid_${node.solidIndex}`
  emit('toggleSolidVisibility', solidId)
}

function isSolidVisible(data: any): boolean {
  const node = data as TreeNode
  if (node.solidIndex === undefined) return true
  return store.isSolidVisible(`solid_${node.solidIndex}`)
}

/**
 * 查找目标节点的所有祖先节点 ID（用于确保展开路径）
 */
function findAncestorIds(targetId: string): string[] {
  const ancestors: string[] = []
  const find = (nodes: TreeNode[], path: string[]): boolean => {
    for (const node of nodes) {
      if (node.id === targetId) {
        ancestors.push(...path)
        return true
      }
      if (node.children) {
        path.push(node.id)
        if (find(node.children, path)) return true
        path.pop()
      }
    }
    return false
  }
  find(store.treeNodes, [])
  return ancestors
}

/**
 * 容器尺寸跟踪（el-tree-v2 需要精确的像素高度）
 */
let resizeObserver: ResizeObserver | null = null

onMounted(() => {
  nextTick(() => {
    if (treeContainerRef.value) {
      treeHeight.value = Math.max(100, treeContainerRef.value.clientHeight)
      resizeObserver = new ResizeObserver(() => {
        if (treeContainerRef.value) {
          treeHeight.value = Math.max(100, treeContainerRef.value.clientHeight)
        }
      })
      resizeObserver.observe(treeContainerRef.value)
    }
  })
})

onUnmounted(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
})

/**
 * 监听 3D 侧选中变化，同步高亮 + 滚动到对应树节点
 *
 * 核心要点：
 * el-tree-v2 内部 watch(defaultExpandedKeys) 没有 { deep: true }，
 * 所以对 expandedTreeNodeIds 做 .push() 不会触发内部 expandedKeySet 更新。
 * 必须通过 setExpandedKeys() 强制同步内部状态，否则 flattenTree 是错的，
 * scrollTo 定位到错误位置导致列表空白。
 */
watch(() => store.selectedTreeNodeIds, async (ids) => {
  if (!ids.length || !treeRef.value) {
    selectionFromTree = false
    return
  }

  // 选择来自树点击，用户已看到该节点，跳过滚动
  if (selectionFromTree) {
    selectionFromTree = false
    return
  }

  // 滚动目标：优先选择叶子级节点（edge），父级 solid 已展开
  // 如果有边级 ID，直接滚动到该节点；否则取 solid 级
  let scrollTarget = ids.find(id => id.includes('_edge_'))
  if (!scrollTarget) {
    scrollTarget = ids.find(id => !id.includes('_edge_'))
    if (!scrollTarget) scrollTarget = ids[0]
  }

  // ★ 确保目标节点的所有祖先都已展开
  const ancestors = findAncestorIds(scrollTarget)
  for (const id of ancestors) {
    if (!store.expandedTreeNodeIds.includes(id)) {
      store.expandedTreeNodeIds.push(id)
    }
  }

  // ★ 强制同步 el-tree-v2 内部展开状态（.push() 不会触发它的 prop watcher）
  treeRef.value.setExpandedKeys([...store.expandedTreeNodeIds])

  // 等 Vue 响应式 + 虚拟列表重算 flattenTree
  await nextTick()
  await nextTick()

  // 滚动到目标节点（scrollToNode 按 key 查 flattenTree 索引，scrollTo 是像素偏移）
  try {
    treeRef.value?.scrollToNode?.(scrollTarget, 'center')
  } catch {
    // 目标节点不在可见列表中，忽略
  }
}, { flush: 'post' })
</script>

<style scoped lang="scss">
.model-tree {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  font-size: 13px;
  user-select: none;
}

.tree-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 12px 8px;
  border-bottom: 1px solid var(--el-border-color-lighter, #e4e7ed);
  font-weight: 600;
  font-size: 14px;
  color: var(--el-text-color-primary, #303133);

  .tree-title {
    flex: 1;
  }

  .tree-count {
    font-size: 12px;
    font-weight: 400;
    color: var(--el-text-color-secondary, #909399);
  }
}

.tree-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 16px;
  color: var(--el-text-color-secondary, #909399);

  p {
    margin: 4px 0;
  }

  .hint {
    font-size: 12px;
    color: var(--el-text-color-placeholder, #c0c4cc);
  }
}

.tree-content {
  flex: 1;
  overflow: hidden;
}

.tree-node {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 12px 2px 6px;
  border-radius: 4px;
  cursor: pointer;
  transition: background-color 0.15s;
  width: 100%;
  min-width: 0;

  &.is-selected {
    background-color: rgba(64, 158, 255, 0.15);
  }

  .node-icon {
    flex-shrink: 0;
    font-size: 14px;
    width: 18px;
    text-align: center;
  }

  .node-label {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
    line-height: 1.6;
  }

  .node-count {
    flex-shrink: 0;
    font-size: 11px;
    color: var(--el-text-color-placeholder, #c0c4cc);
    margin-left: 2px;
  }

  .node-visibility {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    color: #909399;
    opacity: 0.5;
    margin-left: 4px;
    padding: 2px;
    border-radius: 3px;
    transition: opacity 0.15s, color 0.15s, background-color 0.15s;

    &:hover {
      background-color: rgba(64, 158, 255, 0.1);
      color: #409eff;
      opacity: 1;
    }

    &.is-hidden {
      opacity: 0.6;
      color: #c0c4cc;
    }
  }

  &:hover .node-visibility {
    opacity: 1;
  }
}

// 覆盖 el-tree-v2 默认样式
:deep(.el-tree) {
  background: transparent;
  --el-tree-node-hover-bg-color: transparent;
}

:deep(.el-tree-node__content) {
  height: auto !important;
  min-height: 28px;
}

:deep(.el-tree-node__expand-icon) {
  font-size: 14px;
  padding: 3px;
}

:deep(.el-tree-node.is-current > .el-tree-node__content) {
  background-color: transparent;
}
</style>
