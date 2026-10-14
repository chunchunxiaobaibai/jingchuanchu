import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '@xiaobaibaifqy/jingchuanchu-core';
import { Canvas2D } from '@xiaobaibaifqy/jingchuanchu-renderer-2d';
import { canvas2DModule } from '@xiaobaibaifqy/jingchuanchu-renderer-2d/module';
import { setText, createKeyedList } from '@xiaobaibaifqy/jingchuanchu-browser/dom';

class NodeStub {
  children: NodeStub[] = [];
  parent: NodeStub | undefined;
  value = '';
  writes = 0;
  get textContent() {
    return this.value;
  }
  set textContent(value: string) {
    this.value = value;
    this.writes++;
  }
  get firstChild(): NodeStub | null {
    return this.children[0] ?? null;
  }
  get nextSibling(): NodeStub | null {
    return this.parent?.children[this.parent.children.indexOf(this) + 1] ?? null;
  }
  insertBefore(node: NodeStub, cursor: NodeStub | null) {
    node.parent?.removeChild(node);
    const index = cursor ? this.children.indexOf(cursor) : this.children.length;
    this.children.splice(index, 0, node);
    node.parent = this;
  }
  removeChild(node: NodeStub) {
    this.children.splice(this.children.indexOf(node), 1);
    node.parent = undefined;
  }
  replaceChildren() {
    for (const node of [...this.children]) this.removeChild(node);
  }
}

test('unchanged HUD and list snapshots retain text nodes and keyed rows', () => {
  const hud = new NodeStub();
  setText(hud as unknown as Node, '60s');
  setText(hud as unknown as Node, '60s');
  assert.equal(hud.writes, 1);
  const container = new NodeStub();
  let updates = 0;
  const list = createKeyedList<{ id: string; score: number }, string>(
    container as unknown as HTMLElement,
    {
      key: (item) => item.id,
      create: () => new NodeStub() as unknown as HTMLElement,
      equal: (a, b) => a.score === b.score,
      update(node, item) {
        updates++;
        setText(node, String(item.score));
      },
    },
  );
  list.update([
    { id: 'a', score: 0 },
    { id: 'b', score: 0 },
  ]);
  const [a, b] = container.children;
  list.update([
    { id: 'a', score: 0 },
    { id: 'b', score: 0 },
  ]);
  assert.deepEqual(container.children, [a, b]);
  assert.equal(updates, 2);
  list.update([
    { id: 'b', score: 1 },
    { id: 'a', score: 0 },
  ]);
  assert.deepEqual(container.children, [b, a]);
  assert.equal(updates, 3);
});

test('same-size resize/reinitialization keeps the buffer; render conditions skip clearing', () => {
  const original = globalThis.window;
  globalThis.window = { devicePixelRatio: 1 } as Window & typeof globalThis;
  let width = 960,
    height = 600,
    resets = 0,
    clears = 0;
  const context = {
    setTransform() {},
    fillRect() {
      clears++;
    },
  };
  const canvas = {
    get width() {
      return width;
    },
    set width(value: number) {
      width = value;
      resets++;
    },
    get height() {
      return height;
    },
    set height(value: number) {
      height = value;
      resets++;
    },
    getContext: () => context,
  } as unknown as HTMLCanvasElement;
  const engine = new Engine();
  try {
    const renderer = new Canvas2D(canvas);
    renderer.resize();
    new Canvas2D(canvas);
    assert.equal(resets, 0);
    renderer.resize(480, 300);
    assert.equal(resets, 2);
    engine.install([
      canvas2DModule({ canvas, width: 480, height: 300, shouldRender: () => false }),
    ]);
    engine.start();
    engine.advance(engine.step);
    assert.equal(clears, 0);
  } finally {
    engine.dispose();
    globalThis.window = original;
  }
});
