/**
 * perf-panel.test.ts
 * 性能面板 UI 单元测试（Node DOM 环境）
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { Window } from 'happy-dom';
import { createPerfPanel, type PerformanceMetrics } from '../packages/app/runtime/perf-panel.js';

describe('createPerfPanel', () => {
  let window: Window;
  let document: any; // happy-dom Document类型与标准略有不同
  let container: HTMLElement;

  beforeEach(() => {
    window = new Window();
    document = window.document;
    document.body.innerHTML = '<div id="container"></div>';
    container = document.getElementById('container') as HTMLElement;

    // 设置全局 document
    (globalThis as any).document = document;
  });

  afterEach(() => {
    window.close();
    delete (globalThis as any).document;
  });

  test('创建面板并挂载到容器', () => {
    const panel = createPerfPanel();
    panel.mount(container);

    const panelElement = container.querySelector('div');
    assert.ok(panelElement, '面板元素应该存在');
    assert.strictEqual(panelElement?.style.position, 'fixed', '面板应该是固定定位');
  });

  test('更新面板内容显示正确的数值', () => {
    const panel = createPerfPanel();
    panel.mount(container);

    const metrics: PerformanceMetrics = {
      fps: 60.0,
      queries: 12,
      collision: 4,
      drawCalls: 38,
      entities: 512,
      memory: { heap: 47500000, external: 0 },
    };

    panel.update(metrics);

    const panelElement = container.querySelector('div');
    const text = panelElement?.textContent || '';

    assert.ok(text.includes('FPS'), '应该显示 FPS 标签');
    assert.ok(text.includes('60.0'), '应该显示 FPS 数值');
    assert.ok(text.includes('Query'), '应该显示 Query 标签');
    assert.ok(text.includes('12'), '应该显示 query 数值');
    assert.ok(text.includes('Coll'), '应该显示 Coll 标签');
    assert.ok(text.includes('4'), '应该显示 collision 数值');
    assert.ok(text.includes('Draw'), '应该显示 Draw 标签');
    assert.ok(text.includes('38'), '应该显示 drawCalls 数值');
    assert.ok(text.includes('Ent'), '应该显示 Ent 标签');
    assert.ok(text.includes('512'), '应该显示 entities 数值');
    assert.ok(text.includes('Heap'), '应该显示 Heap 标签');
    assert.ok(text.includes('MB'), '应该显示内存单位');
  });

  test('默认位置为 top-right', () => {
    const panel = createPerfPanel();
    panel.mount(container);

    const panelElement = container.querySelector('div') as HTMLElement;
    assert.strictEqual(panelElement.style.top, '8px', '应该在顶部');
    assert.strictEqual(panelElement.style.right, '8px', '应该在右侧');
  });

  test('可以指定 top-left 位置', () => {
    const panel = createPerfPanel({ position: 'top-left' });
    panel.mount(container);

    const panelElement = container.querySelector('div') as HTMLElement;
    assert.strictEqual(panelElement.style.top, '8px', '应该在顶部');
    assert.strictEqual(panelElement.style.left, '8px', '应该在左侧');
  });

  test('可以指定 bottom-right 位置', () => {
    const panel = createPerfPanel({ position: 'bottom-right' });
    panel.mount(container);

    const panelElement = container.querySelector('div') as HTMLElement;
    assert.strictEqual(panelElement.style.bottom, '8px', '应该在底部');
    assert.strictEqual(panelElement.style.right, '8px', '应该在右侧');
  });

  test('可以指定 bottom-left 位置', () => {
    const panel = createPerfPanel({ position: 'bottom-left' });
    panel.mount(container);

    const panelElement = container.querySelector('div') as HTMLElement;
    assert.strictEqual(panelElement.style.bottom, '8px', '应该在底部');
    assert.strictEqual(panelElement.style.left, '8px', '应该在左侧');
  });

  test('可以自定义透明度', () => {
    const panel = createPerfPanel({ opacity: 0.5 });
    panel.mount(container);

    const panelElement = container.querySelector('div') as HTMLElement;
    assert.ok(
      panelElement.style.background.includes('0.5'),
      '背景透明度应该是 0.5',
    );
  });

  test('unmount 移除面板元素', () => {
    const panel = createPerfPanel();
    panel.mount(container);

    assert.ok(container.querySelector('div'), '挂载后应该存在元素');

    panel.unmount();

    assert.strictEqual(container.children.length, 0, '卸载后容器应该为空');
  });

  test('重复 mount 不会创建多个面板', () => {
    const panel = createPerfPanel();
    panel.mount(container);
    panel.mount(container);

    assert.strictEqual(container.children.length, 1, '应该只有一个子元素');
  });

  test('Node 环境无 document 时不崩溃', () => {
    delete (globalThis as any).document;

    const panel = createPerfPanel();

    // 应该不抛出错误
    panel.update({
      fps: 60,
      queries: 10,
      collision: 5,
      drawCalls: 20,
      entities: 100,
      memory: { heap: 1000000, external: 0 },
    });
    panel.mount(container); // container 来自 happy-dom，但 panel 创建时 global.document 不存在
    panel.unmount();

    assert.ok(true, '无 document 时应该优雅降级');
  });
});
