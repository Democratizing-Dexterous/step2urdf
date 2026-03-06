<!--
  模型结构树浮动面板
  可拖拽移动、关闭
-->

<template>
  <Teleport to="body">
    <Transition name="model-tree-panel">
      <div v-show="visible" class="model-tree-panel-overlay" ref="panelRef"
        :style="{ left: panelPos.x + 'px', top: panelPos.y + 'px', width: panelWidth + 'px' }">
        <!-- 拖拽标题栏 -->
        <div class="panel-header" @mousedown="startDrag">
          <span class="panel-title">模型结构</span>
          <el-button size="small" text @click="$emit('close')">✕</el-button>
        </div>

        <ModelTree @select="handleTreeSelect" @solid-hover="handleSolidHover"
          @toggle-solid-visibility="handleToggleSolidVisibility" />

        <!-- 拖拽调整宽度 -->
        <div class="resize-handle" @mousedown.prevent="startResize" />
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue'
import type { TreeNode } from '../types'
import ModelTree from './ModelTree.vue'

defineProps<{
  visible: boolean
}>()

// 事件
const emit = defineEmits<{
  (e: 'tree-select', node: TreeNode, multi: boolean): void
  (e: 'solid-hover', solidId: string | null): void
  (e: 'toggle-solid-visibility', solidId: string): void
  (e: 'close'): void
}>()

// 面板状态
const panelRef = ref<HTMLElement>()
const panelWidth = ref(300)
const panelPos = reactive({ x: 340, y: 80 })

function handleTreeSelect(node: TreeNode, multi: boolean): void {
  emit('tree-select', node, multi)
}

function handleSolidHover(solidId: string | null): void {
  emit('solid-hover', solidId)
}

function handleToggleSolidVisibility(solidId: string): void {
  emit('toggle-solid-visibility', solidId)
}

// ——— 面板拖拽移动 ———
function startDrag(e: MouseEvent): void {
  if ((e.target as HTMLElement).closest('button, .el-button')) return
  e.preventDefault()
  const startX = e.clientX - panelPos.x
  const startY = e.clientY - panelPos.y
  const onMove = (ev: MouseEvent) => {
    panelPos.x = Math.max(0, ev.clientX - startX)
    panelPos.y = Math.max(0, ev.clientY - startY)
  }
  const onUp = () => {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
    document.body.style.userSelect = ''
  }
  document.body.style.userSelect = 'none'
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}

// ——— 面板宽度拖拽 ———
function startResize(e: MouseEvent): void {
  const startX = e.clientX
  const startWidth = panelWidth.value
  const onMove = (ev: MouseEvent) => {
    panelWidth.value = Math.max(220, Math.min(500, startWidth + ev.clientX - startX))
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
</script>

<style scoped lang="scss">
.model-tree-panel-overlay {
  position: fixed;
  display: flex;
  flex-direction: column;
  height: 70vh;
  max-height: 80vh;
  background: #fff;
  border: 1px solid #e4e7ed;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
  z-index: 1000;
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
  cursor: move;
  user-select: none;

  .panel-title {
    font-size: 13px;
    font-weight: 600;
    color: #303133;
  }
}

.resize-handle {
  position: absolute;
  top: 0;
  right: 0;
  width: 4px;
  height: 100%;
  cursor: col-resize;
  z-index: 10;

  &:hover {
    background: rgba(64, 158, 255, 0.4);
  }
}

/* 入场/退场过渡 */
.model-tree-panel-enter-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.model-tree-panel-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.model-tree-panel-enter-from {
  opacity: 0;
  transform: translateY(-12px) scale(0.96);
}

.model-tree-panel-leave-to {
  opacity: 0;
  transform: translateY(-8px) scale(0.98);
}
</style>
