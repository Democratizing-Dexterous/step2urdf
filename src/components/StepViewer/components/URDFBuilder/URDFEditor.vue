<template>
  <Teleport to="body">
    <div v-show="urdfStore.urdfEditorVisible" ref="editorWrapper" class="urdf-editor-wrapper" :style="wrapperStyle">
      <div ref="dragHandle" class="editor-header" @mousedown="startDrag">
        <span class="editor-title">📝 URDF Editor</span>
        <div class="header-actions">
          <el-button size="small" text @click="handleSave" title="下载 .urdf 文件">💾 保存</el-button>
          <el-button size="small" type="primary" text @click="handleApply">应用</el-button>
          <el-button size="small" text @click="urdfStore.urdfEditorVisible = false">关闭</el-button>
        </div>
      </div>

      <!-- 快捷插入工具栏 -->
      <div class="editor-toolbar">
        <span class="toolbar-label">插入:</span>
        <el-button size="small" text @click="insertText(String(Math.PI))">π</el-button>
        <el-button size="small" text @click="insertText(String(Math.PI / 2))">π/2</el-button>
        <el-button size="small" text @click="insertText(String(Math.PI / 4))">π/4</el-button>
        <el-button size="small" text @click="insertText(String(-Math.PI))">-π</el-button>
        <el-button size="small" text @click="insertText(String(-Math.PI / 2))">-π/2</el-button>
      </div>

      <div class="editor-body">
        <vue-monaco-editor ref="monacoRef" v-model:value="urdfXml" language="xml" theme="vs-dark"
          :options="editorOptions" style="height: 100%" @mount="handleEditorMount" />
      </div>

      <!-- 拖拽调整大小 -->
      <div class="resize-handle" @mousedown.stop="startResize" />
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, onBeforeUnmount, type CSSProperties } from 'vue'
import { VueMonacoEditor } from '@guolao/vue-monaco-editor'
import { ElMessage } from 'element-plus'
import { useURDFStore } from '../../stores/useURDFStore'
import { serializeURDF, deserializeURDF } from '../../core/URDFSerializer'

const urdfStore = useURDFStore()

const urdfXml = ref('')
const monacoRef = ref()
const position = reactive({ x: 100, y: 100 })
const size = reactive({ width: 600, height: 500 })

let editorInstance: any = null

function handleEditorMount(editor: any): void {
  editorInstance = editor
}

const editorOptions = {
  fontSize: 12,
  minimap: { enabled: false },
  wordWrap: 'on' as const,
  scrollBeyondLastLine: false,
  automaticLayout: true,
  tabSize: 2
}

const wrapperStyle = computed<CSSProperties>(() => ({
  left: `${position.x}px`,
  top: `${position.y}px`,
  width: `${size.width}px`,
  height: `${size.height}px`
}))

// 当编辑器打开时，用 store 生成 URDF XML
watch(() => urdfStore.urdfEditorVisible, (visible) => {
  if (visible) {
    urdfXml.value = serializeURDF(urdfStore.robot)
  }
})

/** 在光标位置插入文本 */
function insertText(text: string): void {
  if (!editorInstance) return
  const selection = editorInstance.getSelection()
  if (selection) {
    editorInstance.executeEdits('insert', [{
      range: selection,
      text,
      forceMoveMarkers: true
    }])
  }
  editorInstance.focus()
}

function handleApply(): void {
  try {
    const imported = deserializeURDF(urdfXml.value)
    urdfStore.importRobot(imported)
    ElMessage.success('URDF 已应用')
  } catch (err) {
    ElMessage.error(`解析错误: ${(err as Error).message}`)
  }
}

function handleSave(): void {
  const blob = new Blob([urdfXml.value], { type: 'application/xml' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${urdfStore.robot.name || 'robot'}.urdf`
  a.click()
  URL.revokeObjectURL(url)
  ElMessage.success('URDF 文件已下载')
}

// ==== 拖拽 ====
let isDragging = false
let dragStartX = 0
let dragStartY = 0
let dragStartPosX = 0
let dragStartPosY = 0

function startDrag(e: MouseEvent): void {
  isDragging = true
  dragStartX = e.clientX
  dragStartY = e.clientY
  dragStartPosX = position.x
  dragStartPosY = position.y
  document.addEventListener('mousemove', onDragMove)
  document.addEventListener('mouseup', onDragEnd)
}

function onDragMove(e: MouseEvent): void {
  if (!isDragging) return
  position.x = dragStartPosX + (e.clientX - dragStartX)
  position.y = dragStartPosY + (e.clientY - dragStartY)
}

function onDragEnd(): void {
  isDragging = false
  document.removeEventListener('mousemove', onDragMove)
  document.removeEventListener('mouseup', onDragEnd)
}

// ==== 调整大小 ====
let isResizing = false
let resizeStartX = 0
let resizeStartY = 0
let resizeStartW = 0
let resizeStartH = 0

function startResize(e: MouseEvent): void {
  isResizing = true
  resizeStartX = e.clientX
  resizeStartY = e.clientY
  resizeStartW = size.width
  resizeStartH = size.height
  document.addEventListener('mousemove', onResizeMove)
  document.addEventListener('mouseup', onResizeEnd)
}

function onResizeMove(e: MouseEvent): void {
  if (!isResizing) return
  size.width = Math.max(400, resizeStartW + (e.clientX - resizeStartX))
  size.height = Math.max(300, resizeStartH + (e.clientY - resizeStartY))
}

function onResizeEnd(): void {
  isResizing = false
  document.removeEventListener('mousemove', onResizeMove)
  document.removeEventListener('mouseup', onResizeEnd)
}

onBeforeUnmount(() => {
  document.removeEventListener('mousemove', onDragMove)
  document.removeEventListener('mouseup', onDragEnd)
  document.removeEventListener('mousemove', onResizeMove)
  document.removeEventListener('mouseup', onResizeEnd)
})
</script>

<style lang="scss" scoped>
.urdf-editor-wrapper {
  position: fixed;
  z-index: 2000;
  display: flex;
  flex-direction: column;
  border-radius: 8px;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.3);
  overflow: hidden;
  background: #1e1e1e;
}

.editor-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  background: #333;
  cursor: move;
  user-select: none;
  flex-shrink: 0;
}

.editor-title {
  font-size: 13px;
  color: #e0e0e0;
  font-weight: 600;
}

.header-actions {
  display: flex;
  gap: 4px;
}

.editor-toolbar {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 2px 10px;
  background: #2d2d2d;
  border-top: 1px solid #444;
  flex-shrink: 0;

  .toolbar-label {
    font-size: 11px;
    color: #aaa;
    margin-right: 4px;
  }

  .el-button {
    color: #ccc;
    font-size: 11px;
    padding: 2px 10px;
  }
}

.editor-body {
  flex: 1;
  min-height: 0;
}

.resize-handle {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 16px;
  height: 16px;
  cursor: nwse-resize;

  &::before {
    content: '';
    position: absolute;
    right: 3px;
    bottom: 3px;
    width: 8px;
    height: 8px;
    border-right: 2px solid #666;
    border-bottom: 2px solid #666;
  }
}
</style>
