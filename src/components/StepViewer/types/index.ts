/**
 * STEP Viewer 类型定义
 * 适配 opencascade.js XDE 解析引擎
 */

import type { Mesh, Object3D, Vector3, BufferGeometry, LineSegments } from 'three'

// ============ 文件相关 ============

/** 文件校验结果 */
export interface FileValidationResult {
  valid: boolean
  error?: string
  file?: File
}

/** 上传状态 */
export type UploadStatus = 'idle' | 'uploading' | 'parsing' | 'success' | 'error'

/** 上传进度信息 */
export interface UploadProgress {
  status: UploadStatus
  progress: number
  message: string
}

// ============ 结构树相关 ============

/** 结构树节点类型 */
export type TreeNodeType = 'root' | 'compound' | 'solid' | 'shell' | 'edge'

/** 选择粒度模式 */
export type GranularityMode = 'solid' | 'edge'

/** 结构树节点 */
export interface TreeNode {
  id: string
  name: string
  type: TreeNodeType
  children?: TreeNode[]
  /** 对应 SolidObject 的索引（solid 类型节点） */
  solidIndex?: number
  /** 对应 face 的索引（face 类型节点） */
  faceIndex?: number
  /** 对应 edge 的索引（edge 类型节点） */
  edgeIndex?: number
  /** 颜色 [R, G, B]，0-1 范围 */
  color?: number[]
  /** 是否可见 */
  visible?: boolean
}

// ============ 几何特征相关 ============

/** 几何特征类型 */
export enum FeatureType {
  UNKNOWN = 'unknown',
  FACE = 'face',
  EDGE = 'edge',
  VERTEX = 'vertex',
  CIRCLE = 'circle',
  ARC = 'arc',
  LINE = 'line',
  CYLINDER = 'cylinder',
  PLANE = 'plane',
  SPHERE = 'sphere',
  CONE = 'cone',
  TORUS = 'torus'
}

/** 几何特征信息 */
export interface GeometryFeature {
  id: string
  type: FeatureType
  mesh: Mesh
  faceIndex?: number
  edgeIndex?: number
  solidId?: string
  /** 结构树节点 ID */
  treeNodeId?: string
  // 几何属性
  center?: Vector3
  normal?: Vector3
  radius?: number
  startAngle?: number
  endAngle?: number
  axis?: Vector3
  height?: number
  // 圆锥属性
  semiAngle?: number
  // 圆环属性
  majorRadius?: number
  minorRadius?: number
  // 边特有属性
  length?: number
  startPoint?: Vector3
  endPoint?: Vector3
  edgeCurveType?: string
  // 原始数据
  originalColor?: number
  userData?: Record<string, unknown>
}

/** Solid 对象 */
export interface SolidObject {
  id: string
  name: string
  mesh: Mesh
  /** 边缘线 LineSegments（视觉用，EdgesGeometry 生成） */
  edgeLines?: LineSegments
  /** 拓扑边线段（可拾取，OCCT Edge 数据生成） */
  topologyEdges?: LineSegments
  /** 拓扑边特征列表 */
  edgeFeatures: GeometryFeature[]
  /** 结构树节点 ID */
  treeNodeId?: string
  boundingBox?: {
    min: Vector3
    max: Vector3
    center: Vector3
  }
  /** InstancedMesh 中的实例索引（仅 InstancedMesh 合并的 Solid 有值） */
  instanceId?: number
  /** 在合并边缘线几何体中的顶点范围 [startVertex, vertexCount]（仅 InstancedMesh） */
  edgeVertexRange?: [number, number]
  /** 在合并拓扑边线段中每条边的顶点范围 Map<edgeIndex, [startVertex, vertexCount]>（仅 InstancedMesh） */
  topologyEdgeVertexRanges?: Map<number, [number, number]>
  features: GeometryFeature[]
  visible: boolean
  opacity: number
  selected: boolean
  /** 原始颜色 */
  color?: number
  /** 原始序列化数据（URDF 导出用） */
  serializedData?: SerializedSolidData
}

// ============ 选择相关 ============

/** 选中项信息 */
export interface SelectionInfo {
  feature: GeometryFeature
  solid?: SolidObject
  point: Vector3
  distance: number
}



// ============ 视图控制相关 ============

/** 视图预设 */
export enum ViewPreset {
  FRONT = 'front',
  BACK = 'back',
  TOP = 'top',
  BOTTOM = 'bottom',
  LEFT = 'left',
  RIGHT = 'right',
  ISOMETRIC = 'isometric'
}

/** 相机配置 */
export interface CameraConfig {
  position: Vector3
  target: Vector3
  up: Vector3
  fov: number
  near: number
  far: number
}

/** 渲染配置 */
export interface RenderConfig {
  antialias: boolean
  backgroundColor: number
  ambientLightIntensity: number
  directionalLightIntensity: number
  enableShadows: boolean
}

// ============ Face 几何数据（Worker 输出） ============

/** 面分组信息（面在索引缓冲中的范围） */
export interface FaceGroupInfo {
  /** 在索引数组中的起始位置 */
  start: number
  /** 索引数量 */
  count: number
  /** 面索引 */
  faceIndex: number
}

/** 面的精确几何数据（由 BRepAdaptor_Surface 提取） */
export interface FaceGeometryData {
  type: string  // FeatureType string
  center?: number[]  // [x, y, z]
  normal?: number[]  // [x, y, z]
  radius?: number
  axis?: number[]  // [x, y, z]
  height?: number
  semiAngle?: number
  majorRadius?: number
  minorRadius?: number
  uBounds?: number[]  // [uMin, uMax]
  vBounds?: number[]  // [vMin, vMax]
  startAngle?: number
  endAngle?: number
}

/** 边分组信息（边的折线顶点在合并数组中的范围） */
export interface EdgeGroupInfo {
  /** 边索引 */
  edgeIndex: number
  /** 在 edgePolylines 数组中的起始位置（以 float 为单位，每 3 个 float 一个点） */
  polylineStart: number
  /** 折线点数量 */
  polylineCount: number
  /** 相邻面索引列表 */
  adjacentFaceIndices: number[]
}

/** 边的精确几何数据（由 BRepAdaptor_Curve 提取） */
export interface EdgeGeometryData {
  /** 曲线类型: line / circle / ellipse / bspline / bezier / other */
  curveType: string
  /** 边长度 */
  length: number
  /** 起始点 [x, y, z] */
  startPoint: number[]
  /** 终止点 [x, y, z] */
  endPoint: number[]
  /** 圆弧/圆的半径 */
  radius?: number
  /** 圆弧/圆的圆心 [x, y, z] */
  center?: number[]
  /** 圆弧/圆的轴向 [x, y, z] */
  axis?: number[]
  /** 起始参数角度 */
  startAngle?: number
  /** 终止参数角度 */
  endAngle?: number
}

// ============ Worker 序列化数据 ============

/** Worker 序列化的 Solid 数据（纯数据，不含 Three.js 对象） */
export interface SerializedSolidData {
  name: string
  color?: number[]  // [R, G, B] 0-1 范围
  positions: Float32Array
  normals: Float32Array
  indices: Uint32Array
  /** 面分组信息 */
  faceGroups: FaceGroupInfo[]
  /** 各面的精确几何数据 */
  faceGeometries: FaceGeometryData[]
  /** 边分组信息 */
  edgeGroups: EdgeGroupInfo[]
  /** 各边的精确几何数据 */
  edgeGeometries: EdgeGeometryData[]
  /** 所有边的折线坐标合并数组 [x0,y0,z0, x1,y1,z1, ...] */
  edgePolylines: Float32Array
}

/** Worker 序列化的结构树 */
export interface SerializedTreeNode {
  id: string
  name: string
  type: TreeNodeType
  children?: SerializedTreeNode[]
  solidIndex?: number
  faceIndex?: number
  edgeIndex?: number
  color?: number[]
}

/** Worker 请求消息 */
export type WorkerRequest =
  | { type: 'init' }
  | { type: 'parse'; fileBuffer: ArrayBuffer }

/** Worker 响应消息 */
export type WorkerResponse =
  | { type: 'ready' }
  | { type: 'progress'; stage: string; percent: number }
  | { type: 'result'; solids: SerializedSolidData[]; tree: SerializedTreeNode; success: boolean }
  | { type: 'error'; message: string }

// ============ 事件相关 ============

/** 查看器事件类型 */
export type ViewerEventType =
  | 'load'
  | 'loadProgress'
  | 'loadError'
  | 'select'
  | 'deselect'
  | 'hover'
  | 'measure'
  | 'viewChange'

/** 查看器事件处理器 */
export interface ViewerEventHandlers {
  onLoad?: () => void
  onLoadProgress?: (progress: UploadProgress) => void
  onLoadError?: (error: Error) => void
  onSelect?: (selections: SelectionInfo[]) => void
  onDeselect?: () => void
  onHover?: (feature?: GeometryFeature) => void
  onViewChange?: (camera: CameraConfig) => void
}

// ============ 组件 Props ============

/** StepViewer 组件 Props */
export interface StepViewerProps {
  width?: number | string
  height?: number | string
  backgroundColor?: number
  showAxes?: boolean
  showGrid?: boolean
  renderConfig?: Partial<RenderConfig>
}

/** 工具栏配置 */
export interface ToolbarConfig {
  showUpload: boolean
  showViewControls: boolean
  showTransparency: boolean
  showMeasurement: boolean
  showReset: boolean
}

// ============ URDF 构建相关 ============



/** 关节类型 */
export type JointType = 'revolute' | 'prismatic' | 'fixed'

/** 惯性参数 */
export interface InertialParams {
  mass: number
  /** 质心 [x, y, z]（米） */
  com: [number, number, number]
  /** 惯性张量 [ixx, ixy, ixz, iyy, iyz, izz] */
  inertia: [number, number, number, number, number, number]
}

/** URDF 原点 */
export interface URDFOrigin {
  xyz: [number, number, number]
  rpy: [number, number, number]
}

/** URDF Link */
export interface URDFLink {
  id: string
  name: string
  /** 绑定的 Solid ID 列表 */
  solidIds: string[]
  /** 惯性参数（Worker 计算后填充） */
  inertial: InertialParams | null
}

/** URDF Joint 限位 */
export interface JointLimits {
  lower: number
  upper: number
  effort: number
  velocity: number
}

/** URDF Joint */
export interface URDFJoint {
  id: string
  name: string
  type: JointType
  parentLinkId: string
  childLinkId: string
  origin: URDFOrigin
  axis: [number, number, number]
  /** 轴偏移：在 origin.xyz 基础上的额外平移（用于调整轴线交汇点） */
  axisOffset: [number, number, number]
  limits: JointLimits
  /** 当前关节值（用于 FK 驱动） */
  currentValue: number
}

/** URDF 机器人模型 */
export interface URDFRobot {
  name: string
  links: URDFLink[]
  joints: URDFJoint[]
}

/** Joint 创建向导步骤 */
export type JointWizardStep = 'select-links' | 'pick-edge' | 'adjust-origin' | 'set-type'

/** Solid 绑定模式状态 */
export interface BindingModeState {
  active: boolean
  targetLinkId: string | null
}

/** 惯性计算 Worker 请求 */
export interface InertiaWorkerRequest {
  type: 'compute'
  linkId: string
  solidDataList: SerializedSolidData[]
  density: number
}

/** 惯性计算 Worker 响应 */
export interface InertiaWorkerResponse {
  type: 'result'
  linkId: string
  inertial: InertialParams
}

// ============ 关节智能吸附相关 ============

/** 吸附数据（主线程捕获的几何特征） */
export interface SnapData {
  position: [number, number, number]
  normal: [number, number, number]
  featureType: 'circle' | 'arc' | 'line'
}

/** 运动学 Worker 输入 */
export interface KinematicsInput {
  /** 父级世界矩阵 4x4 列主序 */
  parentWorldMatrix: Float32Array
  /** 吸附点世界坐标 */
  snapPosition: Float32Array
  /** 吸附法线/轴线方向 */
  snapNormal: Float32Array
}

/** 运动学 Worker 输出 */
export interface KinematicsResult {
  xyz: [number, number, number]
  rpy: [number, number, number]
}
