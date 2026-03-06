<template>
  <div class="joint-properties" v-if="joint">
    <!-- 节点路径提示 -->
    <div class="joint-path">
      <span class="path-link">{{ parentLinkName }}</span>
      <el-icon>
        <ArrowRight />
      </el-icon>
      <span class="path-joint">{{ joint.name }}</span>
      <el-icon>
        <ArrowRight />
      </el-icon>
      <span class="path-link">{{ childLinkName }}</span>
    </div>

    <el-collapse v-model="openPanels">
      <!-- 基本信息 -->
      <el-collapse-item name="basic">
        <template #title>
          <span class="section-title">基本信息</span>
        </template>
        <div class="prop-form">
          <div class="prop-row">
            <span class="prop-label">名称</span>
            <el-input v-model="joint.name" size="small" placeholder="joint name" />
          </div>
          <div class="prop-row">
            <span class="prop-label">类型</span>
            <el-select v-model="joint.type" size="small" style="width: 130px" @change="handleTypeChange">
              <el-option label="Revolute（旋转）" value="revolute" />
              <el-option label="Prismatic（移动）" value="prismatic" />
              <el-option label="Fixed（固定）" value="fixed" />
            </el-select>
          </div>
        </div>
      </el-collapse-item>

      <!-- 原点 / 特征拾取 -->
      <el-collapse-item name="origin">
        <template #title>
          <span class="section-title">原点 (Origin)</span>
        </template>
        <div class="prop-form">
          <!-- 特征拾取 -->
          <div class="pick-row">
            <el-button v-if="!urdfStore.edgePickEditJointId" type="warning" plain @click="handleStartEdgePick">
              拾取圆边/直线
            </el-button>
            <template v-else>
              <el-button type="danger" plain @click="handleStopEdgePick">
                ✕ 停止拾取
              </el-button>
              <!-- <el-button v-if="urdfStore.edgePickEditJointId === joint.id" size="small" type="info" plain
                @click="$emit('flipNormal')">
                ↔ 反转 Axis
              </el-button> -->
            </template>
          </div>

          <!-- xyz -->
          <div class="coord-row">
            <span class="coord-label">xyz</span>
            <el-input-number v-model="joint.origin.xyz[0]" size="small" :step="0.001" :precision="4"
              controls-position="right" style="width: 82px" />
            <el-input-number v-model="joint.origin.xyz[1]" size="small" :step="0.001" :precision="4"
              controls-position="right" style="width: 82px" />
            <el-input-number v-model="joint.origin.xyz[2]" size="small" :step="0.001" :precision="4"
              controls-position="right" style="width: 82px" />
          </div>

          <!-- rpy -->
          <div class="coord-row">
            <span class="coord-label">rpy</span>
            <el-input-number v-model="joint.origin.rpy[0]" size="small" :step="0.01" :precision="4"
              controls-position="right" style="width: 82px" />
            <el-input-number v-model="joint.origin.rpy[1]" size="small" :step="0.01" :precision="4"
              controls-position="right" style="width: 82px" />
            <el-input-number v-model="joint.origin.rpy[2]" size="small" :step="0.01" :precision="4"
              controls-position="right" style="width: 82px" />
          </div>
        </div>
      </el-collapse-item>

      <!-- 旋转轴 -->
      <el-collapse-item name="axis">
        <template #title>
          <span class="section-title">旋转轴 (Axis)</span>
        </template>
        <div class="prop-form">
          <div class="coord-row">
            <span class="coord-label">xyz</span>
            <el-input-number v-model="joint.axis[0]" size="small" :step="0.01" :precision="4" :min="-1" :max="1"
              controls-position="right" style="width: 82px" />
            <el-input-number v-model="joint.axis[1]" size="small" :step="0.01" :precision="4" :min="-1" :max="1"
              controls-position="right" style="width: 82px" />
            <el-input-number v-model="joint.axis[2]" size="small" :step="0.01" :precision="4" :min="-1" :max="1"
              controls-position="right" style="width: 82px" />
          </div>
          <el-button size="small" text type="primary" @click="flipAxis" style="margin-top: 4px">
            ↔ 反转轴方向
          </el-button>
        </div>
      </el-collapse-item>

      <!-- 轴偏移（DH 参数校正） -->
      <el-collapse-item name="axisOffset">
        <template #title>
          <span class="section-title">轴偏移 (Axis Offset)</span>
        </template>
        <div class="prop-form">
          <div class="coord-row">
            <span class="coord-label">xyz</span>
            <el-input-number v-model="joint.axisOffset[0]" size="small" :step="0.001" :precision="4"
              controls-position="right" style="width: 82px" />
            <el-input-number v-model="joint.axisOffset[1]" size="small" :step="0.001" :precision="4"
              controls-position="right" style="width: 82px" />
            <el-input-number v-model="joint.axisOffset[2]" size="small" :step="0.001" :precision="4"
              controls-position="right" style="width: 82px" />
          </div>
          <el-button size="small" text type="info" @click="resetAxisOffset" style="margin-top: 4px">
            重置偏移
          </el-button>
        </div>
      </el-collapse-item>

      <!-- 限制（非 fixed） -->
      <el-collapse-item v-if="joint.type !== 'fixed'" name="limits">
        <template #title>
          <span class="section-title">限制 (Limits)</span>
        </template>
        <div class="prop-form">
          <div class="prop-row">
            <span class="prop-label">下限</span>
            <el-input-number v-model="joint.limits.lower" size="small" :step="joint.type === 'prismatic' ? 1 : 0.1"
              :precision="3" controls-position="right" style="width: 120px" />
            <span class="prop-unit">{{ joint.type === 'prismatic' ? 'mm' : 'rad' }}</span>
          </div>
          <div class="prop-row">
            <span class="prop-label">上限</span>
            <el-input-number v-model="joint.limits.upper" size="small" :step="joint.type === 'prismatic' ? 1 : 0.1"
              :precision="3" controls-position="right" style="width: 120px" />
            <span class="prop-unit">{{ joint.type === 'prismatic' ? 'mm' : 'rad' }}</span>
          </div>
          <div class="prop-row">
            <span class="prop-label">力度</span>
            <el-input-number v-model="joint.limits.effort" size="small" :step="1" :precision="1"
              controls-position="right" style="width: 120px" />
            <span class="prop-unit">{{ joint.type === 'prismatic' ? 'N' : 'N·m' }}</span>
          </div>
          <div class="prop-row">
            <span class="prop-label">速度</span>
            <el-input-number v-model="joint.limits.velocity" size="small" :step="joint.type === 'prismatic' ? 1 : 0.1"
              :precision="2" controls-position="right" style="width: 120px" />
            <span class="prop-unit">{{ joint.type === 'prismatic' ? 'mm/s' : 'rad/s' }}</span>
          </div>
        </div>
      </el-collapse-item>
    </el-collapse>
  </div>

  <div v-else class="empty-hint">未选中任何关节</div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { ArrowRight } from '@element-plus/icons-vue'
import { useURDFStore } from '../../stores/useURDFStore'
import type { JointType } from '../../types'

const emit = defineEmits<{
  (e: 'flipNormal'): void
}>()

const urdfStore = useURDFStore()

const openPanels = ref<string[]>(['basic', 'origin', 'axis', 'axisOffset', 'limits'])

const joint = computed(() => {
  if (!urdfStore.selectedJointId) return null
  return urdfStore.jointMap.get(urdfStore.selectedJointId) ?? null
})

const parentLinkName = computed(() =>
  joint.value ? (urdfStore.linkMap.get(joint.value.parentLinkId)?.name ?? joint.value.parentLinkId) : ''
)

const childLinkName = computed(() =>
  joint.value ? (urdfStore.linkMap.get(joint.value.childLinkId)?.name ?? joint.value.childLinkId) : ''
)

function handleTypeChange(type: JointType): void {
  if (!joint.value) return
  // 切换类型时自动重置限制为该类型的合理默认值
  const defaultLimits = type === 'prismatic'
    ? { lower: -100, upper: 100, effort: 100, velocity: 100 }
    : { lower: -3.14159, upper: 3.14159, effort: 10, velocity: 1 }
  urdfStore.updateJoint(joint.value.id, { type, limits: defaultLimits })
}

function handleStartEdgePick(): void {
  if (!joint.value) return
  urdfStore.edgePickEditJointId = joint.value.id
  // StepViewer 监听 edgePickEditJointId 变化并激活边拾取模式
}

function handleStopEdgePick(): void {
  urdfStore.edgePickEditJointId = null
}

function flipAxis(): void {
  if (!joint.value) return
  joint.value.axis = [
    -joint.value.axis[0],
    -joint.value.axis[1],
    -joint.value.axis[2]
  ] as [number, number, number]
}

function resetAxisOffset(): void {
  if (!joint.value) return
  joint.value.axisOffset = [0, 0, 0]
}
</script>

<style lang="scss" scoped>
.joint-properties {
  padding: 4px 0;
}

/* 路径提示 */
.joint-path {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 8px;
  background: #f4f6f9;
  border-radius: 4px;
  margin-bottom: 8px;
  font-size: 11px;
  flex-wrap: wrap;

  .path-link {
    color: #409eff;
    font-weight: 500;
  }

  .path-joint {
    color: #e6a23c;
    font-weight: 500;
  }

  .el-icon {
    color: #c0c4cc;
    font-size: 10px;
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

  .prop-unit {
    font-size: 11px;
    color: #909399;
    flex-shrink: 0;
    min-width: 36px;
  }

  .el-input,
  .el-select {
    flex: 1;
  }
}

.pick-row {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.coord-row {
  display: flex;
  align-items: center;
  gap: 3px;

  .coord-label {
    font-size: 11px;
    color: #909399;
    width: 24px;
    flex-shrink: 0;
  }
}

.offset-hint {
  font-size: 11px;
  color: #909399;
  margin: 0 0 6px;
  line-height: 1.4;
}

.empty-hint {
  font-size: 12px;
  color: #909399;
  padding: 16px 0;
  text-align: center;
}
</style>
