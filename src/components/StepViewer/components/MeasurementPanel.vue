<!--
  画线测量面板
  显示测量列表，支持删除单条/清空全部
-->

<template>
  <Teleport to="body">
    <Transition name="measure-panel">
      <div v-show="visible" class="measure-panel" :style="{ left: pos.x + 'px', top: pos.y + 'px' }">
        <!-- 标题栏（可拖拽） -->
        <div class="panel-header" @mousedown="startDrag">
          <span class="panel-title">📏 测量列表</span>
          <span class="panel-count" v-if="store.lineMeasurements.length">
            {{ store.lineMeasurements.length }} 条
          </span>
          <el-button size="small" text @click="$emit('close')">✕</el-button>
        </div>

        <!-- 测量列表 -->
        <div class="panel-body">
          <div v-if="!store.lineMeasurements.length" class="empty-hint">
            <p>暂无测量</p>
            <p class="hint">在画线模式下点击模型表面添加测量线</p>
          </div>

          <div v-else class="measure-list">
            <div v-for="line in store.lineMeasurements" :key="line.id" class="measure-item">
              <div class="item-header">
                <span class="item-distance">{{ formatDistance(line.distance) }}</span>
                <el-button size="small" text type="danger" @click="handleRemove(line.id)" title="删除">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                </el-button>
              </div>
              <div class="item-coords">
                <span class="coord-label">起点</span>
                <span class="coord-value">{{ formatCoord(line.start) }}</span>
              </div>
              <div class="item-coords">
                <span class="coord-label">终点</span>
                <span class="coord-value">{{ formatCoord(line.end) }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- 底部操作栏 -->
        <div class="panel-footer" v-if="store.lineMeasurements.length">
          <el-button size="small" type="danger" plain @click="handleClearAll">
            清空全部
          </el-button>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { reactive } from 'vue'
import * as THREE from 'three'
import { useStepViewerStore } from '../stores/useStepViewerStore'

const store = useStepViewerStore()

defineProps<{
  visible: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'remove', id: string): void
  (e: 'clear-all'): void
}>()

// 面板位置
const pos = reactive({ x: 340, y: 80 })

function formatDistance(mm: number): string {
  if (mm >= 1000) return `${(mm / 1000).toFixed(3)} m`
  if (mm >= 10) return `${mm.toFixed(2)} mm`
  return `${mm.toFixed(3)} mm`
}

function formatCoord(v: THREE.Vector3): string {
  return `(${v.x.toFixed(2)}, ${v.y.toFixed(2)}, ${v.z.toFixed(2)})`
}

function handleRemove(id: string): void {
  emit('remove', id)
}

function handleClearAll(): void {
  emit('clear-all')
}

// ——— 面板拖拽移动 ———
function startDrag(e: MouseEvent): void {
  if ((e.target as HTMLElement).closest('button, .el-button')) return
  e.preventDefault()
  const startX = e.clientX - pos.x
  const startY = e.clientY - pos.y
  const onMove = (ev: MouseEvent) => {
    pos.x = Math.max(0, ev.clientX - startX)
    pos.y = Math.max(0, ev.clientY - startY)
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
</script>

<style scoped lang="scss">
.measure-panel {
  position: fixed;
  display: flex;
  flex-direction: column;
  width: 280px;
  max-height: 60vh;
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
  gap: 6px;
  padding: 8px 12px;
  border-bottom: 1px solid #e4e7ed;
  background: #fafafa;
  flex-shrink: 0;
  cursor: move;
  user-select: none;

  .panel-title {
    flex: 1;
    font-size: 13px;
    font-weight: 600;
    color: #303133;
  }

  .panel-count {
    font-size: 12px;
    color: #909399;
  }
}

.panel-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 8px;
}

.empty-hint {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 24px 12px;
  color: #909399;
  font-size: 13px;

  p {
    margin: 2px 0;
  }

  .hint {
    font-size: 12px;
    color: #c0c4cc;
    text-align: center;
  }
}

.measure-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.measure-item {
  padding: 8px 10px;
  border: 1px solid #ebeef5;
  border-radius: 6px;
  background: #fafafa;
  transition: border-color 0.15s;

  &:hover {
    border-color: #409eff;
  }

  .item-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 4px;
  }

  .item-distance {
    font-size: 14px;
    font-weight: 600;
    color: #409eff;
  }

  .item-coords {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: #606266;
    line-height: 1.6;
  }

  .coord-label {
    flex-shrink: 0;
    color: #909399;
    width: 28px;
  }

  .coord-value {
    font-family: 'Consolas', 'Monaco', monospace;
    font-size: 11px;
  }
}

.panel-footer {
  display: flex;
  justify-content: flex-end;
  padding: 6px 10px;
  border-top: 1px solid #ebeef5;
  flex-shrink: 0;
}

/* 入场/退场过渡 */
.measure-panel-enter-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.measure-panel-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.measure-panel-enter-from {
  opacity: 0;
  transform: translateY(-12px) scale(0.96);
}

.measure-panel-leave-to {
  opacity: 0;
  transform: translateY(-8px) scale(0.98);
}
</style>
