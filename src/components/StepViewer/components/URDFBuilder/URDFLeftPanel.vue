<template>
  <div class="urdf-left-panel" :style="{ width: panelWidth + 'px' }">
    <!-- 标题栏 -->
    <div class="panel-header">
      <span class="panel-title">
        <el-icon>
          <Cpu />
        </el-icon>
        Robot Structure
      </span>
      <div class="panel-header-actions">
        <el-button size="small" :icon="Plus" @click="handleAddRootLink">Add Link</el-button>
      </div>
    </div>

    <!-- 树形内容区 -->
    <div class="panel-content">
      <el-tree ref="treeRef" :data="urdfStore.treeData" node-key="id" :default-expand-all="true" highlight-current
        :expand-on-click-node="false" empty-text="暂无结构，点击 Add Link 创建根连杆" @node-click="handleNodeClick">
        <template #default="{ data }">
          <div class="tree-node-row" :class="[data.nodeType, { 'is-base': data.isBase }]">
            <!-- 节点图标 -->
            <el-icon class="node-icon">
              <Box v-if="data.nodeType === 'link'" />
              <Share v-else />
            </el-icon>

            <!-- 节点名称（Link / Joint 支持内联重命名） -->
            <el-input v-if="editingId === data.id" v-model="editingName" size="small" @blur="finishRename(data)"
              @keydown.enter.stop="finishRename(data)" @keydown.escape.stop="cancelRename" @click.stop autofocus
              class="rename-input" />
            <span v-else class="node-label" :title="data.label">{{ data.label }}</span>

            <!-- 徽标 -->
            <el-tag v-if="data.isBase" size="small" type="info" class="node-badge">root</el-tag>
            <el-tag v-else-if="data.nodeType === 'joint'" size="small" :type="getJointTagType(data.jointType)"
              class="node-badge">{{ data.jointType }}</el-tag>
            <span v-if="data.nodeType === 'link' && data.solidCount > 0" class="solid-count">{{ data.solidCount
            }}s</span>

            <!-- 弹性空白 -->
            <span class="node-spacer" />

            <!-- 操作按钮（始终显示，末尾对齐） -->
            <template v-if="data.nodeType === 'link'">
              <el-tooltip content="添加子 Link" placement="top" :show-after="600">
                <el-button class="node-btn" size="small" text :icon="Plus" @click.stop="handleAddChildLink(data)" />
              </el-tooltip>
              <el-tooltip content="绑定 Solid" placement="top" :show-after="600">
                <el-button class="node-btn" size="small" text :icon="Paperclip" @click.stop="handleBindSolid(data)" />
              </el-tooltip>
              <el-tooltip content="重命名" placement="top" :show-after="600">
                <el-button class="node-btn" size="small" text :icon="Edit" @click.stop="startRename(data)" />
              </el-tooltip>
              <el-tooltip v-if="!data.isBase" content="删除连杆" placement="top" :show-after="600">
                <el-button class="node-btn node-btn--danger" size="small" text :icon="Delete"
                  @click.stop="handleDeleteLink(data)" />
              </el-tooltip>
            </template>
            <template v-else>
              <el-tooltip content="重命名" placement="top" :show-after="600">
                <el-button class="node-btn" size="small" text :icon="Edit" @click.stop="startRename(data)" />
              </el-tooltip>
              <el-tooltip content="删除关节" placement="top" :show-after="600">
                <el-button class="node-btn node-btn--danger" size="small" text :icon="Delete"
                  @click.stop="handleDeleteJoint(data)" />
              </el-tooltip>
            </template>
          </div>
        </template>
      </el-tree>
    </div>

    <!-- 控件区（30%） -->
    <div class="controls-section">
      <ViewControls />
    </div>

    <!-- 底部操作 -->
    <div class="panel-footer">
      <el-button type="success" :icon="Download" @click="$emit('exportUrdf')">
        导出 URDF
      </el-button>
      <el-button type="primary" :icon="Share" @click="goToURDFCC">
        URDF Studio 预览
      </el-button>
    </div>

    <!-- 拖拽调整宽度 -->
    <div class="resize-handle" @mousedown.prevent="startResize" />
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Edit, Delete, Download, Box, Share, Paperclip, Cpu } from '@element-plus/icons-vue'
import { useURDFStore } from '../../stores/useURDFStore'
import type { URDFTreeNode } from '../../stores/useURDFStore'
import type { JointType } from '../../types'
import ViewControls from './ViewControls.vue'

defineEmits<{
  (e: 'exportUrdf'): void
}>()

const urdfStore = useURDFStore()
const treeRef = ref<any>()
const panelWidth = ref(330)

// ——— 内联重命名状态 ———
const editingId = ref<string | null>(null)
const editingName = ref('')

// ——— 导航守卫：Solid 绑定 / 关节轴线拾取进行中时，阻止切换 ———
function guardActiveMode(): boolean {
  if (urdfStore.bindingMode.active) {
    ElMessage.warning('请先点击「 完成绑定」按钮，完成当前 Solid 绑定后再操作')
    return true
  }
  if (urdfStore.edgePickEditJointId) {
    ElMessage.warning('请先点击「✕ 停止拾取」结束关节轴线拾取后再操作')
    return true
  }
  return false
}

// ——— 树节点点击 ———
function handleNodeClick(data: URDFTreeNode): void {
  if (editingId.value) return
  // 绑定 / 拾取进行中：允许点击当前目标节点（静默），禁止切换到其他节点
  if (urdfStore.bindingMode.active) {
    if (data.id !== urdfStore.bindingMode.targetLinkId) {
      ElMessage.warning('请先点击「 完成绑定」按钮，完成当前 Solid 绑定后再切换')
    }
    return
  }
  if (urdfStore.edgePickEditJointId) {
    if (data.id !== urdfStore.edgePickEditJointId) {
      ElMessage.warning('请先点击「✕ 停止拾取」结束关节轴线拾取后再切换')
    }
    return
  }
  if (data.nodeType === 'link') {
    urdfStore.selectedLinkId = data.id
    urdfStore.selectedJointId = null
  } else {
    urdfStore.selectedJointId = data.id
    urdfStore.selectedLinkId = null
  }
}

// ——— 新建根连杆 ———
function handleAddRootLink(): void {
  if (guardActiveMode()) return
  const link = urdfStore.addLink()
  urdfStore.selectedLinkId = link.id
  urdfStore.selectedJointId = null
  nextTick(() => treeRef.value?.setCurrentKey(link.id))
}

// ——— 添加子连杆（自动创建默认 fixed Joint） ———
function handleAddChildLink(data: URDFTreeNode): void {
  if (guardActiveMode()) return
  // base_link 已绑定 Solid 但未设置坐标基点时，须先设置原点
  if (data.isBase && data.solidCount > 0 && !urdfStore.baseLinkOrigin) {
    ElMessage.warning('请先为 base_link 设置坐标基点（右侧面板 → 自动计算 或 3D 拾取）')
    return
  }
  const childLink = urdfStore.addLink()
  const result = urdfStore.addJoint({
    type: 'revolute',
    parentLinkId: data.id,
    childLinkId: childLink.id,
    origin: { xyz: [0, 0, 0], rpy: [0, 0, 0] },
    axis: [0, 0, 1]
  })
  if (!result.ok) {
    urdfStore.removeLink(childLink.id)
    ElMessage.warning(result.reason)
    return
  }
  // 选中新关节，右侧面板可立即编辑类型/参数
  urdfStore.selectedJointId = result.joint.id
  urdfStore.selectedLinkId = null
  nextTick(() => treeRef.value?.setCurrentKey(result.joint.id))
}

// ——— 绑定 Solid ———
function handleBindSolid(data: URDFTreeNode): void {
  // 已在为其他 Link 绑定时阻止；同一 Link 重复点击允许
  if (urdfStore.bindingMode.active && urdfStore.bindingMode.targetLinkId !== data.id) {
    ElMessage.warning('请先点击「 完成绑定」按钮，完成当前 Solid 绑定后再切换')
    return
  }
  if (urdfStore.edgePickEditJointId) {
    ElMessage.warning('请先点击「✕ 停止拾取」结束关节轴线拾取后再操作')
    return
  }
  urdfStore.selectedLinkId = data.id
  urdfStore.selectedJointId = null
  nextTick(() => treeRef.value?.setCurrentKey(data.id))
  urdfStore.startBindingMode(data.id)
}

// ——— 内联重命名 ———
function startRename(data: URDFTreeNode): void {
  editingId.value = data.id
  editingName.value = data.label
}

function finishRename(data: URDFTreeNode): void {
  const name = editingName.value.trim()
  if (name) {
    if (data.nodeType === 'link') {
      urdfStore.renameLink(data.id, name)
    } else {
      urdfStore.renameJoint(data.id, name)
    }
  }
  editingId.value = null
}

function cancelRename(): void {
  editingId.value = null
}

// ——— 删除连杆 ———
function handleDeleteLink(data: URDFTreeNode): void {
  if (guardActiveMode()) return
  ElMessageBox.confirm(
    `确定删除连杆 "${data.label}"？关联的关节将被级联删除。`,
    '删除确认',
    { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
  ).then(() => {
    const result = urdfStore.removeLink(data.id)
    if (!result.ok) {
      ElMessage.warning(result.reason!)
    } else {
      nextTick(() => treeRef.value?.setCurrentKey(''))
    }
  }).catch(() => {/* cancelled */ })
}

// ——— 删除关节 ———
function handleDeleteJoint(data: URDFTreeNode): void {
  if (guardActiveMode()) return
  urdfStore.removeJoint(data.id)
  nextTick(() => treeRef.value?.setCurrentKey(''))
}

// ——— Joint 徽标颜色 ———
function getJointTagType(type?: JointType): 'primary' | 'success' | 'info' | 'warning' | 'danger' {
  const map: Record<string, 'primary' | 'success' | 'info' | 'warning' | 'danger'> = {
    revolute: 'primary', prismatic: 'success', fixed: 'info'
  }
  return map[type ?? ''] ?? 'info'
}

// ——— 面板宽度拖拽 ———
function startResize(e: MouseEvent): void {
  const startX = e.clientX
  const startWidth = panelWidth.value
  const onMove = (ev: MouseEvent) => {
    panelWidth.value = Math.max(200, Math.min(500, startWidth + ev.clientX - startX))
  }
  const onUp = () => {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}

// ——— 暴露给父组件（3D→UI 双向同步） ———
function setCurrentNodeById(id: string): void {
  treeRef.value?.setCurrentKey(id)
}
function goToURDFCC(): void {
  const url = `https://urdf.d-robotics.cc/`
  window.open(url, '_blank')
}
defineExpose({ setCurrentNodeById })
</script>

<style lang="scss" scoped>
.urdf-left-panel {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 200px;
  max-width: 500px;
  background: #fff;
  border-right: 1px solid #e4e7ed;
  z-index: 10;
  overflow: hidden;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid #e4e7ed;
  background: #fafafa;
  flex-shrink: 0;

  .panel-title {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 13px;
    font-weight: 600;
    color: #303133;
  }

  .panel-header-actions {
    display: flex;
    align-items: center;
    gap: 4px;
  }
}

.panel-content {
  flex: 7;
  overflow-y: auto;
  padding: 6px 0;
  min-height: 0;

  &::-webkit-scrollbar {
    width: 4px;
  }

  &::-webkit-scrollbar-thumb {
    background: #dcdfe6;
    border-radius: 2px;
  }

  :deep(.el-tree) {
    font-size: 12px;
    --el-tree-node-hover-bg-color: #f0f5ff;
  }

  :deep(.el-tree-node__content) {
    height: auto;
    min-height: 28px;
    padding-right: 4px;
  }
}

.controls-section {
  flex: 3;
  min-height: 0;
  overflow-y: auto;
  border-top: 1px solid #e4e7ed;
  padding: 4px 0;

  &::-webkit-scrollbar {
    width: 4px;
  }

  &::-webkit-scrollbar-thumb {
    background: #dcdfe6;
    border-radius: 2px;
  }
}

/* ——— 树节点行 ——— */
.tree-node-row {
  display: flex;
  align-items: center;
  width: 100%;
  gap: 3px;
  padding: 1px 0;
  min-width: 0;

  &.link .node-icon {
    color: #409eff;
  }

  &.joint .node-icon {
    color: #e6a23c;
  }

  &.is-base .node-icon {
    color: #67c23a;
  }
}

.node-icon {
  font-size: 13px;
  flex-shrink: 0;
}

.node-label {
  font-size: 12px;
  color: #303133;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.rename-input {
  width: 100px;
  flex-shrink: 0;
}

.node-badge {
  flex-shrink: 0;
  font-size: 10px;
  padding: 0 4px;
  height: 16px;
  line-height: 16px;
}

.solid-count {
  flex-shrink: 0;
  font-size: 10px;
  color: #909399;
  background: #f0f2f5;
  padding: 0 4px;
  border-radius: 3px;
}

.node-spacer {
  flex: 1;
}

/* ——— 操作按钮 ——— */
.node-btn {
  flex-shrink: 0;
  padding: 1px !important;
  height: 20px !important;
  width: 20px !important;
  min-height: unset !important;

  :deep(.el-icon) {
    font-size: 11px;
  }

  &:hover {
    background: #e6f0ff !important;
    color: #409eff !important;
  }
}

.node-btn--danger:hover {
  background: #fef0f0 !important;
  color: #f56c6c !important;
}

/* ——— 底部 ——— */
.panel-footer {
  display: flex;
  gap: 6px;
  padding: 8px 12px;
  border-top: 1px solid #e4e7ed;
  background: #fafafa;
  flex-shrink: 0;

  .el-button {
    flex: 1;
  }
}

/* ——— 宽度拖拽 ——— */
.resize-handle {
  position: absolute;
  top: 0;
  right: -3px;
  bottom: 0;
  width: 6px;
  cursor: col-resize;
  z-index: 20;

  &:hover {
    background: rgba(64, 158, 255, 0.3);
  }
}
</style>
