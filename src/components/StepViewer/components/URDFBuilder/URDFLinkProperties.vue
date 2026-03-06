<template>
  <div class="link-properties" v-if="link">
    <!-- 连杆名称 -->
    <!-- <div class="link-name-row">
      <el-icon class="link-icon">
        <Box />
      </el-icon>
      <el-input v-if="editingName" v-model="nameInput" autofocus @blur="finishRename" @keydown.enter="finishRename"
        @keydown.escape="cancelRename" style="flex: 1" />
      <span v-else class="link-name" @dblclick="startRename">{{ link.name }}</span>
      <el-tag v-if="urdfStore.isBaseLink(link.id)" type="info">root</el-tag>
    </div> -->

    <!-- Base Link 坐标基点（仅 root link 显示）-->
    <div v-if="urdfStore.isBaseLink(link.id)" class="base-origin-section">
      <!-- 标题行：名称 + 状态标签 -->
      <div class="base-origin-header">
        <span class="base-origin-title">🌐 基坐标系原点</span>
        <el-tag :type="urdfStore.baseLinkOrigin ? 'success' : 'warning'" effect="light">
          {{ urdfStore.baseLinkOrigin ? '已设置' : '未设置' }}
        </el-tag>
      </div>

      <!-- 提示：已绑定 Solid 但未设置基点 -->
      <el-alert v-if="link.solidIds.length > 0 && !urdfStore.baseLinkOrigin" title="已绑定 Solid，请设置坐标基点以定义运动树计算起点"
        type="warning" :closable="false" show-icon class="base-origin-alert" />

      <!-- XYZ 可编辑输入 -->
      <div class="origin-rows">
        <div class="origin-row" v-for="(ax, idx) in axisConfig" :key="ax.key">
          <span class="origin-axis-lbl" :style="{ color: ax.color }">{{ ax.key }}</span>
          <el-input-number :model-value="editableOrigin[idx]"
            @update:model-value="(v: number | undefined) => onAxisInput(idx, v ?? 0)" :precision="4" :step="0.001"
            controls-position="right" style="flex: 1; min-width: 0" />
        </div>
      </div>

      <!-- 操作按钮 -->
      <div class="origin-actions">
        <!-- 向上轴选择 -->
        <div class="up-axis-row">
          <span class="up-axis-lbl">向上轴</span>
          <el-radio-group v-model="baseUpAxis">
            <el-radio-button value="Y+">+Y</el-radio-button>
            <el-radio-button value="Z+">+Z</el-radio-button>
            <el-radio-button value="X+">+X</el-radio-button>
            <el-radio-button value="Y-">-Y</el-radio-button>
            <el-radio-button value="Z-">-Z</el-radio-button>
            <el-radio-button value="X-">-X</el-radio-button>
          </el-radio-group>
        </div>
        <!-- 功能按钮行 -->
        <div class="origin-btn-row">
          <el-tooltip content="根据已绑定 Solid 的包围盒底面中心自动计算" placement="top">
            <el-button type="primary" plain :disabled="link.solidIds.length === 0" @click="autoCalcOrigin">
              自动计算
            </el-button>
          </el-tooltip>
          <el-button v-if="urdfStore.baseLinkOrigin" text type="danger" @click="clearBaseOrigin">
            清除
          </el-button>
        </div>
      </div>

      <!-- 基坐标系 RPY 姿态（仅在已设置原点后显示）-->
      <div v-if="urdfStore.baseLinkOrigin" class="orientation-section">
        <div class="orient-header">
          <span class="base-origin-title">基坐标系 RPY（rad）</span>
          <el-button text @click="resetRPY">重置</el-button>
        </div>
        <div class="origin-rows">
          <div class="origin-row" v-for="(ax, idx) in rpyConfig" :key="ax.key">
            <span class="origin-axis-lbl" :style="{ color: ax.color }">{{ ax.key }}</span>
            <el-input-number :model-value="editableRPY[idx]"
              @update:model-value="(v: number | undefined) => onRPYInput(idx, v ?? 0)" :precision="4" :step="0.01"
              controls-position="right" style="flex: 1; min-width: 0" />
          </div>
        </div>
      </div>
    </div>

    <el-collapse v-model="openPanels">
      <!-- 绑定 Solid -->
      <el-collapse-item name="solids">
        <template #title>
          <span class="section-title">绑定 Solids（{{ link.solidIds.length }}）</span>
        </template>
        <div class="prop-form">
          <!-- 已绑定列表 -->
          <div v-for="solidId in link.solidIds" :key="solidId" class="solid-item">
            <el-icon>
              <Files />
            </el-icon>
            <span class="solid-name" :title="getSolidName(solidId)">{{ getSolidName(solidId) }}</span>
            <el-button text type="danger" :icon="Delete" @click="handleUnbind(solidId)" class="unbind-btn" />
          </div>

          <!-- 绑定新 Solid 按钮 -->
          <div class="bind-actions">
            <el-button v-if="!urdfStore.bindingMode.active" type="primary" plain :icon="Paperclip"
              @click="urdfStore.startBindingMode(link.id)">
              绑定 Solid
            </el-button>
            <template v-else-if="urdfStore.bindingMode.targetLinkId === link.id">
              <el-button size="default" type="success" @click="urdfStore.stopBindingMode()"> 完成绑定</el-button>
            </template>
          </div>

          <div v-if="link.solidIds.length === 0" class="empty-hint">尚未绑定任何 Solid</div>
        </div>
      </el-collapse-item>

      <!-- 物理属性（默认收起） -->
      <el-collapse-item name="physics">
        <template #title>
          <span class="section-title">物理属性</span>
        </template>
        <div class="prop-form">
          <template v-if="link.inertial">
            <div class="prop-row">
              <span class="prop-label">质量</span>
              <span class="prop-value">{{ link.inertial.mass.toFixed(4) }} kg</span>
            </div>
            <div class="inertia-grid">
              <span class="inertia-title">惯性张量（kg·m²）</span>
              <div class="inertia-row">
                <span class="inertia-cell">Ixx: {{ link.inertial.inertia[0].toExponential(3) }}</span>
                <span class="inertia-cell">Ixy: {{ link.inertial.inertia[1].toExponential(3) }}</span>
                <span class="inertia-cell">Ixz: {{ link.inertial.inertia[2].toExponential(3) }}</span>
              </div>
              <div class="inertia-row">
                <span class="inertia-cell">Iyy: {{ link.inertial.inertia[3].toExponential(3) }}</span>
                <span class="inertia-cell">Iyz: {{ link.inertial.inertia[4].toExponential(3) }}</span>
                <span class="inertia-cell">Izz: {{ link.inertial.inertia[5].toExponential(3) }}</span>
              </div>
            </div>
          </template>
          <div v-else class="empty-hint">请使用左侧「整机惯量计算」功能统一计算</div>
        </div>
      </el-collapse-item>

    </el-collapse>
  </div>

  <div v-else class="empty-hint">未选中任何连杆</div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Box, Files, Delete, Paperclip } from '@element-plus/icons-vue'
import { useURDFStore } from '../../stores/useURDFStore'
import { useStepViewerStore } from '../../stores/useStepViewerStore'

const urdfStore = useURDFStore()
const stepStore = useStepViewerStore()

const openPanels = ref<string[]>(['solids', 'physics']) // 默认展开的面板

const link = computed(() => {
  if (!urdfStore.selectedLinkId) return null
  return urdfStore.linkMap.get(urdfStore.selectedLinkId) ?? null
})

// ——— 重命名 ———
const editingName = ref(false)
const nameInput = ref('')

function startRename(): void {
  nameInput.value = link.value?.name ?? ''
  editingName.value = true
}

function finishRename(): void {
  if (link.value && nameInput.value.trim()) {
    urdfStore.renameLink(link.value.id, nameInput.value.trim())
  }
  editingName.value = false
}

function cancelRename(): void {
  editingName.value = false
}

// ——— Solid 操作 ———
function handleUnbind(solidId: string): void {
  if (link.value) urdfStore.unbindSolid(link.value.id, solidId)
}

function getSolidName(solidId: string): string {
  return stepStore.solidMap.get(solidId)?.name ?? solidId
}

// ——— Base Origin ———
const axisConfig = [
  { key: 'X', color: '#f56c6c' },
  { key: 'Y', color: '#67c23a' },
  { key: 'Z', color: '#409eff' }
]

/** RPY 输入标签：R=roll绕X, P=pitch绕Y, Y=yaw绕Z */
const rpyConfig = [
  { key: 'R', color: '#f56c6c' },
  { key: 'P', color: '#67c23a' },
  { key: 'Y', color: '#409eff' }
]

/** 底面运动方向（即哪个轴指向上），自动计算时利用这个轴的最小导 OR 最大导作为底面 */
const baseUpAxis = ref<'Y+' | 'Y-' | 'Z+' | 'Z-' | 'X+' | 'X-'>('Y+')

const editableOrigin = ref<[number, number, number]>([0, 0, 0])
const editableRPY = ref<[number, number, number]>([0, 0, 0])

watch(
  () => urdfStore.baseLinkOrigin,
  (v) => { editableOrigin.value = v ? [...v] as [number, number, number] : [0, 0, 0] },
  { immediate: true, deep: true }
)

watch(
  () => urdfStore.baseLinkRPY,
  (v) => { editableRPY.value = v ? [...v] as [number, number, number] : [0, 0, 0] },
  { immediate: true, deep: true }
)

function onAxisInput(idx: number, val: number): void {
  const o: [number, number, number] = [...editableOrigin.value] as [number, number, number]
  o[idx] = val
  editableOrigin.value = o
  urdfStore.baseLinkOrigin = [...o] as [number, number, number]
}

function onRPYInput(idx: number, val: number): void {
  const d: [number, number, number] = [...editableRPY.value] as [number, number, number]
  d[idx] = val
  editableRPY.value = d
  urdfStore.baseLinkRPY = [...d] as [number, number, number]
}

function resetRPY(): void {
  urdfStore.baseLinkRPY = [0, 0, 0]
}

function clearBaseOrigin(): void {
  urdfStore.baseLinkOrigin = null
  urdfStore.baseLinkRPY = null
}

/** 根据已绑定 Solid 的包围盒自动计算底面中心作为基点
 *  底面 = baseUpAxis 方向的最小/最大截面中心 */
function autoCalcOrigin(): void {
  if (!link.value || link.value.solidIds.length === 0) return
  let xMin = Infinity, yMin = Infinity, zMin = Infinity
  let xMax = -Infinity, yMax = -Infinity, zMax = -Infinity
  let found = false
  for (const sid of link.value.solidIds) {
    const pos = stepStore.solidMap.get(sid)?.serializedData?.positions
    if (!pos) continue
    found = true
    for (let i = 0; i < pos.length; i += 3) {
      if (pos[i] < xMin) xMin = pos[i]; if (pos[i] > xMax) xMax = pos[i]
      if (pos[i + 1] < yMin) yMin = pos[i + 1]; if (pos[i + 1] > yMax) yMax = pos[i + 1]
      if (pos[i + 2] < zMin) zMin = pos[i + 2]; if (pos[i + 2] > zMax) zMax = pos[i + 2]
    }
  }
  if (!found) { ElMessage.warning('未找到有效几何数据'); return }
  const round = (v: number) => Math.round(v * 10000) / 10000
  const cx = (xMin + xMax) / 2, cy = (yMin + yMax) / 2, cz = (zMin + zMax) / 2
  let ox: number, oy: number, oz: number
  switch (baseUpAxis.value) {
    case 'Y+': ox = cx; oy = yMin; oz = cz; break
    case 'Y-': ox = cx; oy = yMax; oz = cz; break
    case 'Z+': ox = cx; oy = cy; oz = zMin; break
    case 'Z-': ox = cx; oy = cy; oz = zMax; break
    case 'X+': ox = xMin; oy = cy; oz = cz; break
    case 'X-': ox = xMax; oy = cy; oz = cz; break
    default: ox = cx; oy = yMin; oz = cz; break
  }
  urdfStore.baseLinkOrigin = [round(ox), round(oy), round(oz)]

  // 根据向上轴设置基坐标系 RPY 姿态（ZYX 顺序，与 URDF rpy 约定一致）
  // 数学验证：R = Rz(yaw)·Ry(pitch)·Rx(roll)·[0,0,1]
  // Z+: identity → [0,0,0]  Z-: Ry(π) → [0,π,0]
  // Y+: Rx(-π/2) → [-π/2,0,0]  Y-: Rx(π/2) → [π/2,0,0]
  // X+: Ry(π/2) → [0,π/2,0]   X-: Ry(-π/2) → [0,-π/2,0]
  const rpyMap: Record<string, [number, number, number]> = {
    'Z+': [0, 0, 0],
    'Z-': [0, Math.PI, 0],
    'Y+': [-Math.PI / 2, 0, 0],
    'Y-': [Math.PI / 2, 0, 0],
    'X+': [0, Math.PI / 2, 0],
    'X-': [0, -Math.PI / 2, 0]
  }
  urdfStore.baseLinkRPY = rpyMap[baseUpAxis.value] ?? [0, 0, 0]
  ElMessage.success(`已自动设置基点（${baseUpAxis.value} 底面中心）`)
}

// ——— 惯性计算已移至 ViewControls.vue 整机惯量对话框 ———
</script>

<style lang="scss" scoped>
.link-properties {
  padding: 4px 0;
}

.link-name-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  background: #f4f6f9;
  border-radius: 4px;
  margin-bottom: 8px;

  .link-icon {
    color: #409eff;
    font-size: 14px;
    flex-shrink: 0;
  }

  .link-name {
    font-size: 13px;
    font-weight: 600;
    color: #303133;
    cursor: pointer;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;

    &:hover {
      color: #409eff;
    }
  }
}

/* Collapse */
:deep(.el-collapse) {
  border: none;

  .el-collapse-item__header {
    height: 32px;
    line-height: 32px;
    padding: 0 8px;
    font-size: 12px;
    background: #fafbfc;
    border-bottom: 1px solid #f0f2f5;
  }

  .el-collapse-item__wrap {
    border-bottom: none;
  }

  .el-collapse-item__content {
    padding: 6px 8px 8px;
  }
}

.section-title {
  font-size: 12px;
  font-weight: 600;
  color: #303133;
}

.prop-form {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.prop-row {
  display: flex;
  align-items: center;
  gap: 6px;

  .prop-label {
    font-size: 11px;
    color: #606266;
    width: 36px;
    flex-shrink: 0;
  }

  .prop-value {
    font-size: 12px;
    color: #303133;
    font-family: monospace;
  }

  .prop-unit {
    font-size: 10px;
    color: #909399;
  }
}

.solid-item {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 4px;
  border-radius: 3px;
  background: #f9fafc;
  border: 1px solid #ebeef5;

  .el-icon {
    color: #909399;
    font-size: 12px;
    flex-shrink: 0;
  }

  .solid-name {
    font-size: 11px;
    color: #606266;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
  }

  .unbind-btn {
    padding: 1px !important;
    height: 18px !important;
    width: 18px !important;
    min-height: unset !important;
    flex-shrink: 0;
  }
}

.bind-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.inertia-grid {
  .inertia-title {
    font-size: 10px;
    color: #909399;
    display: block;
    margin-bottom: 4px;
  }

  .inertia-row {
    display: flex;
    gap: 4px;
    margin-bottom: 2px;
    flex-wrap: wrap;
  }

  .inertia-cell {
    font-size: 10px;
    color: #606266;
    font-family: monospace;
    background: #f4f4f5;
    padding: 1px 4px;
    border-radius: 2px;
  }
}

.empty-hint {
  font-size: 11px;
  color: #c0c4cc;
  text-align: center;
  padding: 8px 0;
}

/* Base Origin 区域 */
.base-origin-section {
  margin-bottom: 8px;
  padding: 6px 8px 8px;
  background: linear-gradient(135deg, #f0f9ff 0%, #e8f4fd 100%);
  border: 1px solid #b3d8f5;
  border-radius: 4px;

  .base-origin-alert {
    :deep(.el-alert) {
      padding: 4px 8px;
      font-size: 11px;
    }

    margin-bottom: 6px;
  }
}

.base-origin-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}

.base-origin-title {
  font-size: 11px;
  font-weight: 600;
  color: #1a6fb0;
  flex: 1;
}

.origin-rows {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 6px;
}

.origin-row {
  display: flex;
  align-items: center;
  gap: 5px;
}

.origin-axis-lbl {
  font-size: 11px;
  font-weight: 700;
  font-family: monospace;
  width: 12px;
  flex-shrink: 0;
  text-align: center;
}

.origin-actions {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.up-axis-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.up-axis-lbl {
  font-size: 16px;
  color: #606266;
  flex-shrink: 0;
}

:deep(.up-axis-row .el-radio-button__inner) {
  padding: 2px 6px;
  font-size: 16px;
}

.origin-btn-row {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}

.orientation-section {
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px dashed #b3d8f5;
}

.orient-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}
</style>
