/**
 * URDF 导出 Web Worker
 * 在 Worker 线程中生成 STL 并打包 ZIP，避免阻塞主线程
 */

import * as Comlink from 'comlink'
import JSZip from 'jszip'
import type { SerializedSolidData } from '../types'

/**
 * 从三角化数据生成 binary STL
 * @param restInverseElements 4x4 列主序逆矩阵（将顶点从世界坐标变换到 Link 局部坐标）
 * @param unitScale 单位缩放（如 0.001 = mm → m）
 */
function generateBinarySTL(
  solidDataList: SerializedSolidData[],
  restInverseElements?: ArrayLike<number>,
  unitScale: number = 1
): ArrayBuffer {
  let totalTriangles = 0
  for (const sd of solidDataList) totalTriangles += sd.indices.length / 3

  const bufferSize = 80 + 4 + totalTriangles * 50
  const buffer = new ArrayBuffer(bufferSize)
  const view = new DataView(buffer)
  let offset = 80

  view.setUint32(offset, totalTriangles, true)
  offset += 4

  const hasTransform = !!restInverseElements
  const me = restInverseElements ?? new Float64Array(16)
  const sc = unitScale

  for (const sd of solidDataList) {
    const pos = sd.positions, idx = sd.indices
    for (let t = 0, n = idx.length / 3; t < n; t++) {
      const i0 = idx[t * 3], i1 = idx[t * 3 + 1], i2 = idx[t * 3 + 2]

      let p0x = pos[i0 * 3], p0y = pos[i0 * 3 + 1], p0z = pos[i0 * 3 + 2]
      let p1x = pos[i1 * 3], p1y = pos[i1 * 3 + 1], p1z = pos[i1 * 3 + 2]
      let p2x = pos[i2 * 3], p2y = pos[i2 * 3 + 1], p2z = pos[i2 * 3 + 2]

      if (hasTransform) {
        const _p0x = me[0] * p0x + me[4] * p0y + me[8] * p0z + me[12]
        const _p0y = me[1] * p0x + me[5] * p0y + me[9] * p0z + me[13]
        const _p0z = me[2] * p0x + me[6] * p0y + me[10] * p0z + me[14]
        p0x = _p0x; p0y = _p0y; p0z = _p0z

        const _p1x = me[0] * p1x + me[4] * p1y + me[8] * p1z + me[12]
        const _p1y = me[1] * p1x + me[5] * p1y + me[9] * p1z + me[13]
        const _p1z = me[2] * p1x + me[6] * p1y + me[10] * p1z + me[14]
        p1x = _p1x; p1y = _p1y; p1z = _p1z

        const _p2x = me[0] * p2x + me[4] * p2y + me[8] * p2z + me[12]
        const _p2y = me[1] * p2x + me[5] * p2y + me[9] * p2z + me[13]
        const _p2z = me[2] * p2x + me[6] * p2y + me[10] * p2z + me[14]
        p2x = _p2x; p2y = _p2y; p2z = _p2z
      }

      // 面法线
      const ax = p1x - p0x, ay = p1y - p0y, az = p1z - p0z
      const bx = p2x - p0x, by = p2y - p0y, bz = p2z - p0z
      let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1
      nx /= len; ny /= len; nz /= len

      view.setFloat32(offset, nx, true); offset += 4
      view.setFloat32(offset, ny, true); offset += 4
      view.setFloat32(offset, nz, true); offset += 4

      view.setFloat32(offset, p0x * sc, true); offset += 4
      view.setFloat32(offset, p0y * sc, true); offset += 4
      view.setFloat32(offset, p0z * sc, true); offset += 4
      view.setFloat32(offset, p1x * sc, true); offset += 4
      view.setFloat32(offset, p1y * sc, true); offset += 4
      view.setFloat32(offset, p1z * sc, true); offset += 4
      view.setFloat32(offset, p2x * sc, true); offset += 4
      view.setFloat32(offset, p2y * sc, true); offset += 4
      view.setFloat32(offset, p2z * sc, true); offset += 4

      view.setUint16(offset, 0, true); offset += 2
    }
  }

  return buffer
}

const workerApi = {
  /**
   * 导出 URDF ZIP 包
   * @param urdfXml URDF XML 字符串
   * @param linkSolidMap linkName → solid 数据列表
   * @param linkRestInverseMap linkName → 4x4 列主序逆矩阵 elements
   * @param unitScale 单位缩放（mm → m 为 0.001）
   * @param onProgress 进度回调
   */
  async exportURDF(
    urdfXml: string,
    linkSolidMap: Record<string, SerializedSolidData[]>,
    linkRestInverseMap: Record<string, number[]>,
    unitScale: number,
    onProgress?: (stage: string, percent: number) => void
  ): Promise<ArrayBuffer> {
    const zip = new JSZip()

    zip.file('robot.urdf', urdfXml)

    const linkNames = Object.keys(linkSolidMap)
    const total = linkNames.length

    for (let i = 0; i < total; i++) {
      const linkName = linkNames[i]
      const solidDataList = linkSolidMap[linkName]

      if (solidDataList.length === 0) continue

      onProgress?.(`正在生成 ${linkName}.stl...`, Math.round(((i + 1) / total) * 80))

      const restInverse = linkRestInverseMap[linkName]
      const stlBuffer = generateBinarySTL(solidDataList, restInverse, unitScale)
      zip.file(`meshes/${linkName}.stl`, stlBuffer)
    }

    onProgress?.('正在打包 ZIP...', 90)

    const zipBuffer = await zip.generateAsync({
      type: 'arraybuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 }
    })

    onProgress?.('导出完成', 100)
    return zipBuffer
  }
}

export type ExportWorkerApi = typeof workerApi

Comlink.expose(workerApi)
