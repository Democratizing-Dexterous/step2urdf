<template>
  <div class="urdf-right-panel">

    <!-- ===== 上部：上下文属性面板（Link / Joint） ===== -->
    <div class="panel-section expanded">
      <div class="section-header">
        <span class="section-title">{{ contextTitle }}</span>
      </div>
      <div class="section-body">
        <URDFJointProperties v-if="urdfStore.selectedJointId" @flip-normal="$emit('flipNormal')" />
        <URDFLinkProperties v-else-if="urdfStore.selectedLinkId" />
        <div v-else class="empty-hint context-empty">
          <el-icon style="font-size: 24px; color: #dcdfe6">
            <Connection />
          </el-icon>
          <p>点击左侧树节点</p>
          <p>查看或编辑属性</p>
        </div>
      </div>
    </div>

    <!-- 分隔线 -->
    <div class="section-divider" />

    <!-- ===== 下部：关节控制打开按钮 ===== -->
    <div class="fk-launch-bar">
      <el-button type="primary" plain @click="$emit('toggleFKPanel')">
        关节控制面板
      </el-button>
      <span v-if="urdfStore.activeJoints.length" class="fk-count">{{ urdfStore.activeJoints.length }} 个可控关节</span>
    </div>

  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Connection } from '@element-plus/icons-vue'
import { useURDFStore } from '../../stores/useURDFStore'
import URDFJointProperties from './URDFJointProperties.vue'
import URDFLinkProperties from './URDFLinkProperties.vue'

const emit = defineEmits<{
  (e: 'flipNormal'): void
  (e: 'toggleFKPanel'): void
}>()

const urdfStore = useURDFStore()

const contextTitle = computed(() => {
  if (urdfStore.selectedJointId) {
    const j = urdfStore.jointMap.get(urdfStore.selectedJointId)
    return `${j?.name ?? 'Joint 属性'}`
  }
  if (urdfStore.selectedLinkId) {
    const l = urdfStore.linkMap.get(urdfStore.selectedLinkId)
    return `${l?.name ?? 'Link 属性'}`
  }
  return '属性面板'
})
</script>

<style lang="scss" scoped>
.urdf-right-panel {
  width: 300px;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #fff;
  border-left: 1px solid #e4e7ed;
  overflow: hidden;
  flex-shrink: 0;
}

/* ——— 面板区域 ——— */
.panel-section {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 36px;

  &.expanded {
    flex: 1;
  }
}

.section-divider {
  flex-shrink: 0;
  height: 1px;
  background: #e4e7ed;
}

/* ——— 区域标题 ——— */
.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 10px;
  height: 36px;
  background: #fafafa;
  border-bottom: 1px solid #f0f2f5;
  user-select: none;
  flex-shrink: 0;

  .section-title {
    font-size: 16px;
    font-weight: 600;
    color: #303133;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
  }
}

/* ——— 区域内容 ——— */
.section-body {
  flex: 1;
  overflow-y: auto;
  padding: 8px;

  &::-webkit-scrollbar {
    width: 4px;
  }

  &::-webkit-scrollbar-thumb {
    background: #dcdfe6;
    border-radius: 2px;
  }
}

.empty-hint {
  font-size: 12px;
  color: #909399;
  text-align: center;
  padding: 12px 0;
}

.context-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 24px 0;

  p {
    margin: 0;
    font-size: 12px;
    color: #c0c4cc;
  }
}

.fk-launch-bar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  background: #fafafa;
  border-top: 1px solid #f0f2f5;

  .fk-count {
    font-size: 11px;
    color: #909399;
  }
}
</style>
