/**
 * 调试用性能面板 UI。
 * 可悬浮在页面任一角落，以等宽字体实时显示关键性能指标。
 */

import type { PerformanceMetrics } from './performance-monitor.js';

export type { PerformanceMetrics };

export interface PerfPanelOptions {
  /** 面板位置，默认 'top-right' */
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  /** 透明度（0–1），默认 0.85 */
  opacity?: number;
}

export interface PerfPanel {
  /** 更新面板内容 */
  update(metrics: PerformanceMetrics): void;
  /** 挂载到指定容器 */
  mount(container: HTMLElement): void;
  /** 从 DOM 卸载 */
  unmount(): void;
}

/**
 * 创建性能面板。
 * 面板采用深色背景、绿色 monospace 文字，显示：
 * FPS、Query、Coll、Draw、Ent、Heap。
 */
export function createPerfPanel(options: PerfPanelOptions = {}): PerfPanel {
  const { position = 'top-right', opacity = 0.85 } = options;

  // 防护：Node 环境无 DOM
  if (typeof document === 'undefined') {
    return {
      update() {},
      mount() {},
      unmount() {},
    };
  }

  const panel = document.createElement('div');
  panel.style.cssText = `
    position: fixed;
    padding: 8px 12px;
    background: rgba(0, 0, 0, ${opacity});
    color: #00ff00;
    font-family: 'Courier New', Courier, monospace;
    font-size: 12px;
    line-height: 1.4;
    white-space: pre;
    pointer-events: none;
    user-select: none;
    z-index: 999999;
  `;

  // 设置位置
  const [vertical, horizontal] = position.split('-');
  if (vertical === 'top') panel.style.top = '8px';
  else panel.style.bottom = '8px';
  if (horizontal === 'left') panel.style.left = '8px';
  else panel.style.right = '8px';

  const lines = {
    fps: document.createElement('div'),
    queries: document.createElement('div'),
    collision: document.createElement('div'),
    drawCalls: document.createElement('div'),
    entities: document.createElement('div'),
    heap: document.createElement('div'),
  };

  panel.append(
    lines.fps,
    lines.queries,
    lines.collision,
    lines.drawCalls,
    lines.entities,
    lines.heap,
  );

  let mounted = false;

  return {
    update(metrics: PerformanceMetrics): void {
      lines.fps.textContent = `FPS   ${metrics.fps.toFixed(1).padStart(6)}`;
      lines.queries.textContent = `Query ${String(metrics.queries).padStart(6)}`;
      lines.collision.textContent = `Coll  ${String(metrics.collision).padStart(6)}`;
      lines.drawCalls.textContent = `Draw  ${String(metrics.drawCalls).padStart(6)}`;
      lines.entities.textContent = `Ent   ${String(metrics.entities).padStart(6)}`;

      const heapMB = (metrics.memory.heap / (1024 * 1024)).toFixed(1);
      lines.heap.textContent = `Heap ${heapMB.padStart(6)}MB`;
    },

    mount(container: HTMLElement): void {
      if (mounted) return;
      container.appendChild(panel);
      mounted = true;
    },

    unmount(): void {
      if (!mounted) return;
      panel.remove();
      mounted = false;
    },
  };
}
