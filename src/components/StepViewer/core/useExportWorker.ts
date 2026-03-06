/**
 * 导出 Worker 单例封装
 * 懒加载 ExportWorker 实例，提供导出 URDF ZIP 接口
 */

import * as Comlink from 'comlink'
import type { ExportWorkerApi } from './ExportWorker'
import type { SerializedSolidData } from '../types'

let worker: Worker | null = null
let workerProxy: Comlink.Remote<ExportWorkerApi> | null = null

function getProxy(): Comlink.Remote<ExportWorkerApi> {
    if (!workerProxy) {
        worker = new Worker(
            new URL('./ExportWorker.ts', import.meta.url),
            { type: 'module' }
        )
        workerProxy = Comlink.wrap<ExportWorkerApi>(worker)
    }
    return workerProxy
}

/**
 * 在 Worker 中生成 URDF ZIP 包（STL 生成 + ZIP 打包均在 Worker 线程）
 */
export async function exportURDFInWorker(
    urdfXml: string,
    linkSolidMap: Record<string, SerializedSolidData[]>,
    linkRestInverseMap: Record<string, number[]>,
    unitScale: number,
    onProgress?: (stage: string, percent: number) => void
): Promise<ArrayBuffer> {
    const proxy = getProxy()
    return proxy.exportURDF(
        urdfXml,
        linkSolidMap,
        linkRestInverseMap,
        unitScale,
        onProgress ? Comlink.proxy(onProgress) : undefined
    )
}

export function disposeExportWorker(): void {
    workerProxy?.[Comlink.releaseProxy]()
    worker?.terminate()
    worker = null
    workerProxy = null
}
