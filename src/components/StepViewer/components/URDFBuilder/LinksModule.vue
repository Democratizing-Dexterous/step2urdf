<template>
  <div class="links-module">
    <div class="module-header">
      <span class="module-title">Links</span>
      <el-button size="small" type="primary" text @click="handleAddLink">
        + Add Link
      </el-button>
    </div>

    <div class="link-list">
      <div v-for="link in urdfStore.robot.links" :key="link.id" class="link-item"
        :class="{ active: urdfStore.selectedLinkId === link.id }" @click="handleSelectLink(link.id)"
        @dblclick="startRename(link)" @mouseenter="hoverLinkId = link.id" @mouseleave="hoverLinkId = null">
        <div class="link-main">
          <!-- 编辑模式 -->
          <el-input v-if="editingLinkId === link.id" v-model="editingName" size="small" @blur="finishRename(link)"
            @keydown.enter="finishRename(link)" @keydown.escape="cancelRename" ref="renameInputRef" autofocus
            style="width: 140px" />
          <!-- 显示模式 -->
          <span v-else class="link-name" :title="link.name">
            {{ link.name }}
            <el-tag v-if="urdfStore.isBaseLink(link.id)" size="small" type="info"
              style="margin-left:4px;font-size:10px">root</el-tag>
          </span>

          <span class="link-badge" v-if="link.solidIds.length > 0">
            {{ link.solidIds.length }} solid{{ link.solidIds.length > 1 ? 's' : '' }}
          </span>
        </div>

        <!-- 操作按钮 -->
        <div class="link-actions" v-show="hoverLinkId === link.id || urdfStore.selectedLinkId === link.id">
          <el-tooltip content="绑定 Solid" placement="top">
            <el-button size="small" type="primary" text :icon="Link" @click.stop="handleStartBinding(link.id)" />
          </el-tooltip>
          <el-tooltip content="删除" placement="top">
            <el-button v-if="!urdfStore.isBaseLink(link.id)" size="small" type="danger" text :icon="Delete"
              @click.stop="handleDeleteLink(link.id)" />
          </el-tooltip>
        </div>
      </div>
    </div>

    <!-- 绑定的 Solid 列表 -->
    <div v-if="selectedLink && selectedLink.solidIds.length > 0" class="bound-solids">
      <div class="bound-header">绑定的 Solid：</div>
      <div v-for="solidId in selectedLink.solidIds" :key="solidId" class="bound-item">
        <span class="solid-name">{{ getSolidName(solidId) }}</span>
        <el-button size="small" type="danger" text @click="handleUnbindSolid(selectedLink!.id, solidId)">
          × 解除
        </el-button>
      </div>
    </div>

    <!-- 绑定模式提示 -->
    <div v-if="urdfStore.bindingMode.active" class="binding-hint">
      <el-tag type="warning" size="small">
        🎯 点击 3D 视图中的 Solid 进行绑定
      </el-tag>
      <el-button size="default" type="success" @click="urdfStore.stopBindingMode()"> 完成绑定</el-button>
    </div>

    <div v-if="urdfStore.robot.links.length === 0" class="empty-hint">
      点击 "+ Add Link" 创建连杆
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Delete, Link } from '@element-plus/icons-vue'
import { useURDFStore } from '../../stores/useURDFStore'
import { useStepViewerStore } from '../../stores/useStepViewerStore'

const urdfStore = useURDFStore()
const stepStore = useStepViewerStore()

const hoverLinkId = ref<string | null>(null)
const editingLinkId = ref<string | null>(null)
const editingName = ref('')
const renameInputRef = ref()

const emit = defineEmits<{
  (e: 'selectLink', linkId: string): void
}>()

const selectedLink = computed(() => {
  if (!urdfStore.selectedLinkId) return null
  return urdfStore.linkMap.get(urdfStore.selectedLinkId) || null
})

/** 导航守卫：Solid 绑定进行中时，阻止切换连杆 */
function guardActiveMode(): boolean {
  if (urdfStore.bindingMode.active) {
    ElMessage.warning('请先点击「 完成绑定」按钮，完成当前 Solid 绑定后再操作')
    return true
  }
  return false
}

function handleAddLink(): void {
  if (guardActiveMode()) return
  urdfStore.addLink()
}

function handleSelectLink(linkId: string): void {
  if (guardActiveMode()) return
  urdfStore.selectedLinkId = linkId
  emit('selectLink', linkId)
}

function handleDeleteLink(linkId: string): void {
  if (guardActiveMode()) return
  const link = urdfStore.linkMap.get(linkId)
  if (!link) return

  ElMessageBox.confirm(
    `确定删除连杆 "${link.name}"？关联的关节将被级联删除。`,
    '删除确认',
    { type: 'warning' }
  ).then(() => {
    const result = urdfStore.removeLink(linkId)
    if (!result.ok) {
      ElMessage.warning(result.reason!)
    }
  }).catch(() => { /* cancelled */ })
}

function startRename(link: { id: string; name: string }): void {
  editingLinkId.value = link.id
  editingName.value = link.name
  nextTick(() => {
    const inputEl = renameInputRef.value?.[0]?.$el?.querySelector('input') ||
      renameInputRef.value?.$el?.querySelector('input')
    inputEl?.select()
  })
}

function finishRename(link: { id: string }): void {
  if (editingName.value.trim()) {
    urdfStore.renameLink(link.id, editingName.value.trim())
  }
  editingLinkId.value = null
}

function cancelRename(): void {
  editingLinkId.value = null
}

function handleStartBinding(linkId: string): void {
  // 已在为其他 Link 绑定时阻止；同一 Link 允许重复点击
  if (urdfStore.bindingMode.active && urdfStore.bindingMode.targetLinkId !== linkId) {
    ElMessage.warning('请先点击「 完成绑定」按钮，完成当前 Solid 绑定后再切换')
    return
  }
  urdfStore.startBindingMode(linkId)
}

function handleUnbindSolid(linkId: string, solidId: string): void {
  urdfStore.unbindSolid(linkId, solidId)
}

function getSolidName(solidId: string): string {
  const solid = stepStore.solidMap.get(solidId)
  return solid?.name || solidId
}
</script>

<style lang="scss" scoped>
.links-module {
  .module-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 6px;
  }

  .module-title {
    font-size: 13px;
    font-weight: 600;
    color: #303133;
  }
}

.link-list {
  max-height: 200px;
  overflow-y: auto;
}

.link-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.15s;

  &:hover {
    background: #f5f7fa;
  }

  &.active {
    background: rgba(64, 158, 255, 0.1);
    border-left: 2px solid #409eff;
  }
}

.link-main {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex: 1;
}

.link-name {
  font-size: 12px;
  color: #303133;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.link-badge {
  font-size: 10px;
  color: #909399;
  background: #f0f2f5;
  padding: 0 4px;
  border-radius: 2px;
  flex-shrink: 0;
}

.link-actions {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
}

.bound-solids {
  margin-top: 6px;
  padding: 6px 8px;
  background: #fafafa;
  border-radius: 4px;
}

.bound-header {
  font-size: 11px;
  color: #909399;
  margin-bottom: 4px;
}

.bound-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 2px 0;

  .solid-name {
    font-size: 11px;
    color: #606266;
  }
}

.binding-hint {
  margin-top: 6px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.empty-hint {
  font-size: 11px;
  color: #909399;
  padding: 4px 0;
}
</style>
