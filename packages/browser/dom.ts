/** Update a HUD/text leaf without replacing its text node when the value is unchanged. */
export function setText(node: Node, value: string): boolean {
  if (node.textContent === value) return false;
  node.textContent = value;
  return true;
}

/** Create once per mounted container. Owns its child rows, retaining nodes by key. */
export function createKeyedList<T, K>(
  container: HTMLElement,
  options: {
    key(item: T): K;
    create(item: T): HTMLElement;
    update(node: HTMLElement, item: T): void;
    equal?: (previous: T, next: T) => boolean;
  },
): { update(items: readonly T[]): void; clear(): void } {
  const rows = new Map<K, { node: HTMLElement; item: T }>();
  return {
    update(items) {
      const current = new Set<K>();
      let cursor: ChildNode | null = container.firstChild;
      for (const item of items) {
        const key = options.key(item);
        current.add(key);
        let row = rows.get(key);
        if (!row) {
          row = { node: options.create(item), item };
          rows.set(key, row);
          options.update(row.node, item);
        } else if (!options.equal || !options.equal(row.item, item)) {
          options.update(row.node, item);
        }
        row.item = item;
        if (row.node !== cursor) container.insertBefore(row.node, cursor);
        cursor = row.node.nextSibling;
      }
      while (cursor) {
        const next = cursor.nextSibling;
        container.removeChild(cursor);
        cursor = next;
      }
      for (const key of rows.keys()) if (!current.has(key)) rows.delete(key);
    },
    clear() {
      container.replaceChildren();
      rows.clear();
    },
  };
}
