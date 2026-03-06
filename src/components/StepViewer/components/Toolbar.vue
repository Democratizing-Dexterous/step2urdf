<template>
  <div class="step-viewer-toolbar">
    <!-- 左侧：侧栏切换 + 文件上传 -->
    <div class="toolbar-left">
      <div class="toolbar-section">
        <el-tooltip :content="occtReady ? '选择并导入 STEP / STP 模型文件' : '正在加载 OpenCASCADE 引擎...'" placement="bottom">
          <el-button type="primary" :loading="isLoading || !occtReady" :icon="UploadFilled"
            :disabled="isLoading || !occtReady" @click="openUploadDialog">
            {{ isLoading ? '加载中...' : (!occtReady ? '引擎加载中...' : '导入模型') }}
          </el-button>
        </el-tooltip>
        <!-- WASM 加载进度条 -->
        <div v-if="!occtReady" class="wasm-progress">
          <el-progress :percentage="Math.round(occtLoadProgress ?? 0)" :stroke-width="14" :show-text="false" />
          <span class="wasm-progress-text">OpenCASCADE WASM 加载中 ({{ Math.round(occtLoadProgress ?? 0) }}%)</span>
        </div>
        <span v-if="fileName" class="file-name" :title="fileName">{{ fileName }}</span>
      </div>

      <!-- 导入模型文件弹框 -->
      <el-dialog v-model="uploadDialogVisible" width="520px" :close-on-click-modal="false" :append-to-body="true"
        class="step-upload-dialog" align-center title="导入模型文件">

        <div class="upload-dialog-body">
          <!-- el-upload 拖拽区 -->
          <el-upload ref="elUploadRef" class="step-uploader" drag :auto-upload="false" :show-file-list="false"
            :multiple="false" accept=".step,.stp" :on-change="handleElUploadChange">
            <div class="upload-placeholder">
              <div class="uph-icon-wrap">
                <el-icon class="uph-icon">
                  <UploadFilled />
                </el-icon>
              </div>
              <p class="uph-title">将文件拖到此处</p>
              <p class="uph-sub">或 <em class="uph-browse">点击选择本地文件</em></p>
              <div class="uph-tags">
                <el-tag size="small" type="primary" effect="light" round>.STEP</el-tag>
                <el-tag size="small" type="primary" effect="light" round>.STP</el-tag>
                <span class="uph-size-note">最大上传限制300MB</span>
              </div>
            </div>
          </el-upload>

          <!-- 已选文件预览卡片 -->
          <transition name="file-card-slide">
            <div v-if="pendingFile" class="selected-file-card">
              <div class="sfc-icon-block">
                <el-icon class="sfc-doc-icon">
                  <Document />
                </el-icon>
                <span class="sfc-ext">{{ fileExtension }}</span>
              </div>
              <div class="sfc-meta">
                <div class="sfc-name" :title="pendingFile.name">{{ pendingFile.name }}</div>
                <div class="sfc-detail">
                  <span class="sfc-size">{{ formatFileSize(pendingFile.size) }}</span>
                  <el-divider direction="vertical" />
                  <el-icon class="sfc-check">
                    <CircleCheckFilled />
                  </el-icon>
                  <span class="sfc-ready">准备就绪</span>
                </div>
              </div>
              <el-tooltip content="移除文件" placement="top">
                <el-button class="sfc-remove" :icon="Close" circle plain size="small" @click.stop="removePendingFile" />
              </el-tooltip>
            </div>
          </transition>
        </div>

        <template #footer>
          <el-button @click="uploadDialogVisible = false">取消</el-button>
          <el-button type="primary" :icon="UploadFilled" :disabled="!pendingFile" @click="confirmUpload">
            开始导入
          </el-button>
        </template>
      </el-dialog>
    </div>
    <stats />
    <!-- 中间：显示控制 + 测量工具 -->
    <div class="toolbar-center" v-if="hasModel">
      <!-- 显示控制 -->
      <el-tooltip content="坐标轴" placement="bottom">
        <el-button :type="showAxes ? 'primary' : 'default'" @click="$emit('toggleAxes')" text>
          轴
        </el-button>
      </el-tooltip>
      <el-tooltip content="网格" placement="bottom">
        <el-button :type="showGrid ? 'primary' : 'default'" @click="$emit('toggleGrid')" text>
          网格
        </el-button>
      </el-tooltip>
      <!-- 透明度滑块 -->
      <div class="opacity-control">
        <span class="opacity-label">透明度</span>
        <el-slider v-model="localOpacity" :min="0" :max="100" :step="5" :show-tooltip="true"
          :format-tooltip="(val: any) => `${val}%`" @change="handleOpacityInput" style="width: 100px" />
      </div>

      <el-divider direction="vertical" />

      <!-- 画线测量 -->
      <el-tooltip content="画线测量（点击模型/空间画直线，自动计算距离）" placement="bottom">
        <el-button :type="isLineMeasureActive ? 'warning' : 'default'" @click="$emit('toggleLineMeasure')" text>
          画线测量
        </el-button>
      </el-tooltip>

      <el-divider direction="vertical" />

      <!-- 模型结构树面板切换 -->
      <el-tooltip content="打开/关闭模型结构树面板" placement="bottom">
        <el-button :type="isModelTreeOpen ? 'primary' : 'default'" @click="$emit('toggleModelTree')" text>
          模型树
        </el-button>
      </el-tooltip>
    </div>

    <!-- 右侧：清空/重置 + FPS -->
    <div class="toolbar-right" v-if="hasModel">
      <el-tooltip content="取消选择" placement="bottom">
        <el-button @click="$emit('clearSelection')" :disabled="!hasSelection" text>
          取消选择
        </el-button>
      </el-tooltip>
      <el-tooltip content="适应窗口" placement="bottom">
        <el-button :icon="Aim" @click="$emit('fitView')" />
      </el-tooltip>
      <el-tooltip content="重置视图" placement="bottom">
        <el-button :icon="RefreshRight" @click="$emit('resetView')" />
      </el-tooltip>
      <el-divider direction="vertical" />
      <el-tooltip content="性能监控" placement="bottom">
        <el-button :type="showStats ? 'warning' : 'default'" @click="$emit('toggleStats')" :icon="DataLine" text>
          FPS
        </el-button>
      </el-tooltip>

      <el-divider direction="vertical" />

      <!-- GitHub 链接 -->
      <el-tooltip content="GitHub 仓库" placement="bottom">
        <el-button class="github-btn" text @click="openGitHub">
          <svg class="github-icon" viewBox="0 0 1024 1024" width="18" height="18" xmlns="http://www.w3.org/2000/svg">
            <path fill-rule="evenodd" clip-rule="evenodd"
              d="M8 0C3.58 0 0 3.58 0 8C0 11.54 2.29 14.53 5.47 15.59C5.87 15.66 6.02 15.42 6.02 15.21C6.02 15.02 6.01 14.39 6.01 13.72C4 14.09 3.48 13.23 3.32 12.78C3.23 12.55 2.84 11.84 2.5 11.65C2.22 11.5 1.82 11.13 2.49 11.12C3.12 11.11 3.57 11.7 3.72 11.94C4.44 13.15 5.59 12.81 6.05 12.6C6.12 12.08 6.33 11.73 6.56 11.53C4.78 11.33 2.92 10.64 2.92 7.58C2.92 6.71 3.23 5.99 3.74 5.43C3.66 5.23 3.38 4.41 3.82 3.31C3.82 3.31 4.49 3.1 6.02 4.13C6.66 3.95 7.34 3.86 8.02 3.86C8.7 3.86 9.38 3.95 10.02 4.13C11.55 3.09 12.22 3.31 12.22 3.31C12.66 4.41 12.38 5.23 12.3 5.43C12.81 5.99 13.12 6.7 13.12 7.58C13.12 10.65 11.25 11.33 9.47 11.53C9.76 11.78 10.01 12.26 10.01 13.01C10.01 14.08 10 14.94 10 15.21C10 15.42 10.15 15.67 10.55 15.59C13.71 14.53 16 11.53 16 8C16 3.58 12.42 0 8 0Z"
              transform="scale(64)" fill="currentColor" />
          </svg>
        </el-button>
      </el-tooltip>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { ElMessage } from 'element-plus'
import type { UploadFile, UploadInstance } from 'element-plus'
import {
  Upload,
  UploadFilled,
  Aim,
  RefreshRight,
  DataLine,
  Document,
  Close,
  CircleCheckFilled,
  WarningFilled
} from '@element-plus/icons-vue'
// Types removed: GranularityMode, ViewMode no longer needed

const props = defineProps<{
  fileName: string
  isLoading: boolean
  hasModel: boolean
  hasSelection: boolean
  showAxes: boolean
  showGrid: boolean
  showStats: boolean
  /** OpenCASCADE WASM 是否已加载完成 */
  occtReady: boolean
  /** WASM 加载进度 0-100 */
  occtLoadProgress?: number
  /** 画线测量模式是否激活 */
  isLineMeasureActive?: boolean
  /** 模型结构树面板是否打开 */
  isModelTreeOpen?: boolean
  /** 当前透明度（0~100） */
  opacity?: number
}>()

const emit = defineEmits<{
  (e: 'upload', file: File): void
  (e: 'fitView'): void
  (e: 'toggleAxes'): void
  (e: 'toggleGrid'): void
  (e: 'opacityChange', value: number): void
  (e: 'clearSelection'): void
  (e: 'resetView'): void
  (e: 'toggleStats'): void
  (e: 'toggleLineMeasure'): void
  (e: 'toggleModelTree'): void
}>()

const localOpacity = ref(props.opacity ?? 100)

// ── 上传弹框状态 ───────────────────────────────────────────────────────────
const uploadDialogVisible = ref(false)
const pendingFile = ref<File | null>(null)
const elUploadRef = ref<UploadInstance>()

/** 从文件名提取扩展名大写标签 */
const fileExtension = computed(() => {
  if (!pendingFile.value) return ''
  return pendingFile.value.name.toLowerCase().endsWith('.step') ? 'STEP' : 'STP'
})

function isValidStepFile(file: File): boolean {
  const name = file.name.toLowerCase()
  return name.endsWith('.step') || name.endsWith('.stp')
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function openUploadDialog(): void {
  pendingFile.value = null
  uploadDialogVisible.value = true
  // 对话框打开后清空 el-upload 内部文件列表
  setTimeout(() => elUploadRef.value?.clearFiles(), 80)
}

function handleElUploadChange(uploadFile: UploadFile): void {
  const raw = uploadFile.raw
  if (!raw) return
  if (!isValidStepFile(raw)) {
    ElMessage.warning('仅支持 .step / .stp 格式的文件')
    elUploadRef.value?.clearFiles()
    return
  }
  pendingFile.value = raw
}

function removePendingFile(): void {
  pendingFile.value = null
  elUploadRef.value?.clearFiles()
}

function confirmUpload(): void {
  if (!pendingFile.value) return
  emit('upload', pendingFile.value)
  uploadDialogVisible.value = false
  pendingFile.value = null
}

// 同步外部 opacity prop 到本地
watch(() => props.opacity, (val) => {
  if (val !== undefined) localOpacity.value = val
})

function handleOpacityInput(val: number | number[]): void {
  const v = Array.isArray(val) ? val[0] : val
  emit('opacityChange', v)
}

function openGitHub(): void {
  window.open('https://github.com/Democratizing-Dexterous/URDFlyS2U', '_blank', 'noopener,noreferrer')
}


</script>

<style lang="scss" scoped>
.step-viewer-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 12px;
  background: #fff;
  border-bottom: 1px solid #e4e7ed;
  gap: 8px;
  min-height: 42px;

  .toolbar-left,
  .toolbar-center,
  .toolbar-right {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .toolbar-left {
    flex-shrink: 0;
  }

  .toolbar-center {
    flex: 1;
    justify-content: center;
    flex-wrap: wrap;
  }

  .toolbar-right {
    flex-shrink: 0;
  }

  .toolbar-section {
    display: flex;
    align-items: center;
    gap: 4px;

    .file-name {
      margin-left: 6px;
      font-size: 12px;
      color: #606266;
      max-width: 160px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }

  .sidebar-toggle {
    padding: 6px;
  }

  .el-divider--vertical {
    height: 20px;
    margin: 0 4px;
  }

  .opacity-control {
    display: flex;
    align-items: center;
    gap: 6px;

    .opacity-label {
      font-size: 12px;
      color: #606266;
      white-space: nowrap;
    }

    .el-slider {
      --el-slider-height: 4px;
      --el-slider-button-size: 14px;
    }
  }

  .axis-scale-control {
    display: flex;
    align-items: center;
    gap: 6px;

    .axis-scale-label {
      font-size: 12px;
      color: #606266;
      white-space: nowrap;
    }

    .el-slider {
      --el-slider-height: 4px;
      --el-slider-button-size: 14px;
    }
  }
}

.wasm-progress {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: 8px;

  .el-progress {
    width: 100px;
  }

  .wasm-progress-text {
    font-size: 11px;
    color: #909399;
    white-space: nowrap;
  }
}

.github-btn {
  padding: 6px;
  font-size: 0;

  .github-icon {
    color: #606266;
    transition: color 0.2s;
  }

  &:hover .github-icon {
    color: #303133;
  }
}

/* ─── 上传弹框：自有插槽内容样式 ─────────────────────────────────── */


/* dialog body 容器 */
.upload-dialog-body {
  display: flex;
  flex-direction: column;
  gap: 0;
}

/* 上传占位内容（el-upload 默认槽） */
.upload-placeholder {
  padding: 32px 20px 26px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;

  .uph-icon-wrap {
    width: 68px;
    height: 68px;
    border-radius: 50%;
    background: linear-gradient(135deg, #ecf5ff 0%, #e1efff 100%);
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 4px;
    transition: transform 0.25s ease, box-shadow 0.25s ease;

    .uph-icon {
      font-size: 34px;
      color: #409eff;
      transition: color 0.2s;
    }
  }

  .uph-title {
    font-size: 15px;
    font-weight: 600;
    color: #1d2129;
    margin: 0;
  }

  .uph-sub {
    font-size: 13px;
    color: #86909c;
    margin: 0;

    .uph-browse {
      font-style: normal;
      color: #409eff;
      font-weight: 500;
    }
  }

  .uph-tags {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 6px;

    .uph-size-note {
      font-size: 11px;
      color: #c9cdd4;
      margin-left: 2px;
    }
  }
}

/* 已选文件预览卡片 */
.selected-file-card {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
  padding: 12px 16px;
  background: linear-gradient(135deg, #f8fbff 0%, #f0f7ff 100%);
  border: 1px solid #c6e0ff;
  border-radius: 10px;
  box-shadow: 0 2px 8px rgba(64, 158, 255, 0.1);

  .sfc-icon-block {
    position: relative;
    flex-shrink: 0;
    line-height: 1;

    .sfc-doc-icon {
      font-size: 38px;
      color: #409eff;
    }

    .sfc-ext {
      position: absolute;
      bottom: -2px;
      right: -8px;
      font-size: 8px;
      font-weight: 700;
      letter-spacing: 0.3px;
      background: #409eff;
      color: #fff;
      padding: 1px 4px;
      border-radius: 3px;
      line-height: 1.5;
    }
  }

  .sfc-meta {
    flex: 1;
    min-width: 0;

    .sfc-name {
      font-size: 13px;
      font-weight: 500;
      color: #1d2129;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      margin-bottom: 5px;
    }

    .sfc-detail {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 12px;
      color: #86909c;

      .sfc-check {
        color: #67c23a;
        font-size: 13px;
        vertical-align: middle;
      }

      .sfc-ready {
        color: #67c23a;
        font-weight: 500;
      }

      .el-divider--vertical {
        height: 10px;
        margin: 0 2px;
      }
    }
  }

  .sfc-remove {
    flex-shrink: 0;
    border-color: #dcdfe6;
    color: #909399;

    &:hover {
      border-color: #f56c6c;
      color: #f56c6c;
      background: #fef0f0;
    }
  }
}

/* 卡片滑入动画 */
.file-card-slide-enter-active {
  transition: all 0.28s cubic-bezier(0.34, 1.3, 0.64, 1);
}

.file-card-slide-leave-active {
  transition: all 0.18s ease-in;
}

.file-card-slide-enter-from {
  opacity: 0;
  transform: translateY(-8px) scale(0.97);
}

.file-card-slide-leave-to {
  opacity: 0;
  transform: translateY(-4px) scale(0.98);
}



/* ─── el-upload dragger 样式覆盖（:deep 穿透子组件） ───────────── */
:deep(.step-uploader) {
  width: 100%;

  .el-upload {
    width: 100%;
    display: block;
  }

  .el-upload-dragger {
    width: 100%;
    height: auto;
    padding: 0;
    border: 2px dashed #dde3ed;
    border-radius: 12px;
    background: #fafcff;
    transition: border-color 0.2s ease, background 0.2s ease, box-shadow 0.2s ease;

    &:hover {
      border-color: #409eff;
      background: #f5f9ff;
      box-shadow: 0 0 0 3px rgba(64, 158, 255, 0.08);

      .uph-icon-wrap {
        transform: translateY(-3px);
        box-shadow: 0 6px 16px rgba(64, 158, 255, 0.2);
      }
    }

    &.is-dragover {
      border-color: #409eff;
      border-style: solid;
      background: linear-gradient(135deg, #ecf5ff 0%, #f0f8ff 100%);
      box-shadow: 0 0 0 4px rgba(64, 158, 255, 0.12);

      .uph-icon-wrap {
        transform: translateY(-4px) scale(1.05);
        box-shadow: 0 8px 20px rgba(64, 158, 255, 0.25);
      }

      .uph-icon {
        color: #337ecc;
      }
    }
  }
}
</style>

/* ─── 全局覆盖 el-dialog 内部间距（dialog 被 teleport 到 body，需非 scoped） ─── */
<style>
.step-upload-dialog .el-dialog__header {
  padding: 20px 24px 16px;
  border-bottom: 1px solid #f0f2f5;
  margin-right: 0;
}

.step-upload-dialog .el-dialog__headerbtn {
  top: 20px;
  right: 20px;
}

.step-upload-dialog .el-dialog__body {
  padding: 10px;
}


.step-upload-dialog .el-dialog {
  border-radius: 16px;
  overflow: hidden;
}
</style>
