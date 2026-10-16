import { compileViews } from './compiler.mjs';

export function jingchuanchu() {
  const styles = new Map(),
    dependents = new Map(),
    ownerStyles = new Map();
  const normalize = (file) => file.replaceAll('\\', '/');
  return {
    name: 'jingchuanchu-components',
    enforce: 'pre',
    resolveId(id) {
      if (styles.has(id.split('?')[0])) return id;
    },
    load(id) {
      return styles.get(id.split('?')[0]);
    },
    async transform(code, id) {
      if (!/\.[cm]?ts$/.test(id) || id.includes('/node_modules/')) return;
      const compiled = await compileViews(code, id);
      if (!compiled) return;
      for (const resource of compiled.resources) styles.set(resource.id, resource.css);
      ownerStyles.set(
        id,
        compiled.resources.map((resource) => resource.id + '?inline'),
      );
      for (const owners of dependents.values()) owners.delete(id);
      for (const file of compiled.dependencies) {
        this.addWatchFile(file);
        const key = normalize(file);
        if (!dependents.has(key)) dependents.set(key, new Set());
        dependents.get(key).add(id);
      }
      return { code: compiled.code, map: compiled.map };
    },
    handleHotUpdate(context) {
      const owners = dependents.get(normalize(context.file));
      if (!owners?.size) return;
      for (const id of owners) {
        const module = context.server.moduleGraph.getModuleById(id);
        if (module) context.server.moduleGraph.invalidateModule(module);
        for (const style of ownerStyles.get(id) ?? []) {
          const dependency = context.server.moduleGraph.getModuleById(style);
          if (dependency) context.server.moduleGraph.invalidateModule(dependency);
        }
      }
      // Recreate application-owned resources on reload; no stale component instances survive.
      context.server.ws.send({ type: 'full-reload', path: '*' });
      return [];
    },
  };
}
export default jingchuanchu;
