/**
 * 运行时性能采集系统。
 * 通过无显著开销的计数，捕获帧级别的关键性能指标。
 */

export interface PerformanceMetrics {
  /** 帧率（每秒帧数） */
  fps: number;
  /** 本帧 ECS query 调用数 */
  queries: number;
  /** 碰撞检测对数 */
  collision: number;
  /** Canvas drawImage 调用数 */
  drawCalls: number;
  /** 活跃实体数 */
  entities: number;
  /** 内存使用（单位字节） */
  memory: {
    heap: number;
    external: number;
  };
}

/**
 * 性能采集器。
 * 在渲染循环中使用：
 *   - World.query() 后调用 recordQuery()
 *   - Canvas.drawImage() 后调用 recordDrawCall()
 *   - detectCollisions() 后调用 recordCollisionPair(对数)
 *   - 引擎 advance 后调用 finishFrame()
 */
export class PerformanceMonitor {
  private queryCount = 0;
  private collisionCount = 0;
  private drawCallCount = 0;
  private frameCount = 0;
  private lastFpsTime = 0;
  private currentFps = 0;
  private entityCount = 0;

  constructor() {
    this.lastFpsTime = performance.now();
  }

  /**
   * 记录一次 query 调用。
   */
  recordQuery(): void {
    this.queryCount++;
  }

  /**
   * 记录碰撞对。
   * @param count 碰撞对数（通常为 1）
   */
  recordCollisionPair(count: number = 1): void {
    this.collisionCount += count;
  }

  /**
   * 记录一次 drawImage 调用。
   */
  recordDrawCall(): void {
    this.drawCallCount++;
  }

  /**
   * 设置活跃实体数。
   */
  setEntityCount(count: number): void {
    this.entityCount = count;
  }

  /**
   * 帧末尾调用，计算 FPS 并返回当前帧的指标。
   */
  finishFrame(): PerformanceMetrics {
    const now = performance.now();
    const elapsed = now - this.lastFpsTime;
    this.frameCount++;

    // 每秒刷新一次 FPS 计数
    if (elapsed >= 1000) {
      this.currentFps = Math.round((this.frameCount * 1000) / elapsed);
      this.frameCount = 0;
      this.lastFpsTime = now;
    }

    const memory = this.captureMemory();

    const metrics: PerformanceMetrics = {
      fps: this.currentFps,
      queries: this.queryCount,
      collision: this.collisionCount,
      drawCalls: this.drawCallCount,
      entities: this.entityCount,
      memory,
    };

    // 重置本帧计数
    this.queryCount = 0;
    this.collisionCount = 0;
    this.drawCallCount = 0;

    return metrics;
  }

  /**
   * 重置所有计数和状态。
   */
  reset(): void {
    this.queryCount = 0;
    this.collisionCount = 0;
    this.drawCallCount = 0;
    this.frameCount = 0;
    this.currentFps = 0;
    this.entityCount = 0;
    this.lastFpsTime = performance.now();
  }

  /**
   * 采集内存使用情况。
   * 仅在 performance.memory 可用时生效（V8 环境）。
   */
  private captureMemory(): { heap: number; external: number } {
    const perfMemory = (performance as any).memory;
    if (perfMemory) {
      return {
        heap: perfMemory.usedJSHeapSize || 0,
        external: perfMemory.externalMemoryUsage || 0,
      };
    }
    return { heap: 0, external: 0 };
  }
}
