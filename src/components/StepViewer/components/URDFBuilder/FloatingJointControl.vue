<!--
  浮动关节控制面板
  参考 URDFEditor.vue 的拖拽实现
  支持拖拽移动
-->

<template>
  <Teleport to="body">
    <Transition name="fk-panel">
      <div v-show="visible" class="fk-floating-panel" :style="panelStyle" @mousedown.stop>
        <!-- 标题栏（可拖拽） -->
        <div class="fk-title-bar" @mousedown="startDrag">
          <span class="fk-title">🎛️ 关节控制</span>
          <div class="fk-title-actions">
            <el-button size="small" text @click.stop="urdfStore.resetJoints()">归零</el-button>
            <el-button size="small" text @click.stop="urdfStore.randomizeJoints()">随机</el-button>
            <el-button size="small" text circle @click="$emit('close')">✕</el-button>
          </div>
        </div>

        <!-- 关节滑块列表 -->
        <div class="fk-body">
          <div v-if="urdfStore.activeJoints.length > 0" class="slider-list">
            <JointSlider v-for="joint in urdfStore.activeJoints" :key="joint.id" :joint="joint" />
          </div>
          <div v-else class="empty-hint">暂无可控关节</div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useURDFStore } from '../../stores/useURDFStore'
import JointSlider from './JointSlider.vue'

defineProps<{
  visible: boolean
}>()

defineEmits<{
  (e: 'close'): void
}>()

const urdfStore = useURDFStore()

// 面板位置（居中偏右）
const posX = ref(Math.max(40, Math.min(window.innerWidth - 360, window.innerWidth * 0.6)))
const posY = ref(Math.max(40, window.innerHeight - 460))

const panelStyle = computed(() => ({
  left: `${posX.value}px`,
  top: `${posY.value}px`,
}))

function startDrag(e: MouseEvent): void {
  e.preventDefault()
  const startX = e.clientX
  const startY = e.clientY
  const startPosX = posX.value
  const startPosY = posY.value

  const onMouseMove = (moveEvent: MouseEvent) => {
    posX.value = Math.max(0, Math.min(window.innerWidth - 100, startPosX + moveEvent.clientX - startX))
    posY.value = Math.max(0, Math.min(window.innerHeight - 50, startPosY + moveEvent.clientY - startY))
  }

  const onMouseUp = () => {
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', onMouseUp)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }

  document.body.style.cursor = 'move'
  document.body.style.userSelect = 'none'
  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp)
}
</script>

<style lang="scss" scoped>
.fk-floating-panel {
  position: fixed;
  z-index: 2000;
  width: 320px;
  max-height: 420px;
  display: flex;
  flex-direction: column;
  background: #fff;
  border: 1px solid #dcdfe6;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  overflow: hidden;
}

.fk-title-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  background: #f5f7fa;
  border-bottom: 1px solid #e4e7ed;
  cursor: move;
  user-select: none;
  flex-shrink: 0;
}

.fk-title {
  font-size: 12px;
  font-weight: 600;
  color: #303133;
}

.fk-title-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}

.fk-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 8px;
  display: flex;
  align-items: center;
  justify-content: center;

  &::-webkit-scrollbar {
    width: 4px;
  }

  &::-webkit-scrollbar-thumb {
    background: #dcdfe6;
    border-radius: 2px;
  }
}

.slider-list {
  display: flex;
  flex-direction: column;
  width: 100%;
}

.empty-hint {
  font-size: 12px;
  color: #909399;
  text-align: center;
  padding: 12px 0;
}

.fk-panel-enter-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.fk-panel-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.fk-panel-enter-from {
  opacity: 0;
  transform: translateY(12px) scale(0.96);
}

.fk-panel-leave-to {
  opacity: 0;
  transform: translateY(8px) scale(0.98);
}
</style>
