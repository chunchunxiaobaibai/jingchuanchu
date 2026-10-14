import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

const root = resolve('.');
function run(command: string, args: string[], directory: string): void {
  const result = spawnSync(command, args, {
    cwd: directory,
    encoding: 'utf8',
    shell: process.platform === 'win32' && command === 'npm.cmd',
  });
  if (result.status !== 0)
    throw result.error ?? new Error(`${command} failed:\n${result.stdout}\n${result.stderr}`);
}
for (const selection of [
  ['ecs', 'core'],
  ['ecs', 'core', 'browser', 'input', 'renderer-2d', 'assets'],
]) {
  const directory = await mkdtemp(join(tmpdir(), 'xiaobaibaifqy-jingchuanchu-consumer-'));
  try {
    const dependencies: Record<string, string> = {};
    for (const name of selection) {
      const manifest = JSON.parse(
        await readFile(resolve('packages', name, 'package.json'), 'utf8'),
      ) as { version: string };
      dependencies[`@xiaobaibaifqy/jingchuanchu-${name}`] =
        `file:${resolve('dist/packages', `xiaobaibaifqy-jingchuanchu-${name}-${manifest.version}.tgz`)}`;
    }
    await writeFile(
      join(directory, 'package.json'),
      JSON.stringify({ private: true, type: 'module', dependencies }),
    );
    run(
      process.platform === 'win32' ? 'npm.cmd' : 'npm',
      ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund'],
      directory,
    );
    const source = `import { Engine } from '@xiaobaibaifqy/jingchuanchu-core';
import { component } from '@xiaobaibaifqy/jingchuanchu-ecs';
import { SceneManager } from '@xiaobaibaifqy/jingchuanchu-core/scenes';
const Position = component<{ x: number }>('Position');
const engine = new Engine();
const entity = engine.world.create();
engine.world.set(entity, Position, { x: 1 });
engine.addSystem({ id: 'move', update({ world }) { world.require(entity, Position).x++; } });
engine.start(); engine.advance(engine.step);
if (engine.world.require(entity, Position).x !== 2) throw new Error('Packaged ECS failed');
engine.dispose();
const sceneEngine = new Engine({diagnostics:false}); const scenes = new SceneManager(sceneEngine);
await scenes.switchTo({id:'consumer',setup(context){context.create();context.addSystem({id:'scene-system',update(){}});}});
if(sceneEngine.world.size!==1)throw new Error('Scene consumer failed');
sceneEngine.dispose();
${
  selection.length > 2
    ? `import { browserModule } from '@xiaobaibaifqy/jingchuanchu-browser';
import { canvas2DModule } from '@xiaobaibaifqy/jingchuanchu-renderer-2d/module';
import { keyboardModule } from '@xiaobaibaifqy/jingchuanchu-input/module';
import { assetModule } from '@xiaobaibaifqy/jingchuanchu-assets/module';
if (![browserModule, canvas2DModule, keyboardModule, assetModule].every(value => typeof value === 'function')) throw new Error('Missing public module');
import { Transform2D, Sprite2D, Animation2D, Camera2D, animationModule } from '@xiaobaibaifqy/jingchuanchu-renderer-2d/features';
import { Collider2D, detectCollisions } from '@xiaobaibaifqy/jingchuanchu-renderer-2d/collision';
import { AssetCache } from '@xiaobaibaifqy/jingchuanchu-assets';
const featureEngine = new Engine({tickRate:2}); const sprite=featureEngine.world.create();
featureEngine.world.set(sprite,Transform2D,{x:0,y:0});
featureEngine.world.set(sprite,Sprite2D,{image:{} as CanvasImageSource,width:16,height:16});
featureEngine.world.set(sprite,Animation2D,{fps:2,frames:[{x:0,y:0,width:16,height:16},{x:16,y:0,width:16,height:16}]});
featureEngine.world.set(sprite,Collider2D,{kind:'circle',radius:8});
featureEngine.install([animationModule()]);featureEngine.start();featureEngine.advance(.5);
if(featureEngine.world.require(sprite,Sprite2D).frame?.x!==16)throw new Error('Packaged animation failed');
if(detectCollisions(featureEngine.world).length!==0)throw new Error('Packaged collision failed');
if(new Camera2D(10,0,2).screenToWorld({x:20,y:0}).x!==20)throw new Error('Packaged camera failed');
const assets=new AssetCache(async(url:string)=>url);const lease=assets.retain('sprite');await lease.promise;assets.clear();if(assets.getStatus('sprite')!=='ready')throw new Error('Packaged retain failed');lease.release();assets.dispose();featureEngine.dispose();`
    : ''
}
`;
    await writeFile(join(directory, 'consumer.ts'), source);
    await writeFile(
      join(directory, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          target: 'ES2022',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          strict: true,
          lib: selection.length === 2 ? ['ES2022'] : ['ES2022', 'DOM'],
          types: [],
          outDir: 'compiled',
        },
        include: ['consumer.ts'],
      }),
    );
    run(
      process.execPath,
      [resolve(root, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.json'],
      directory,
    );
    run(process.execPath, ['compiled/consumer.js'], directory);
    const lock = JSON.parse(await readFile(join(directory, 'package-lock.json'), 'utf8')) as {
      packages: Record<string, unknown>;
    };
    for (const forbidden of [
      'ws',
      'zod',
      '@xiaobaibaifqy/jingchuanchu-net',
      '@xiaobaibaifqy/jingchuanchu-net-server',
    ])
      assert.equal(
        `node_modules/${forbidden}` in lock.packages,
        false,
        `Unselected dependency installed: ${forbidden}`,
      );
    console.log(`Isolated package consumer passed: ${selection.join(', ')}`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
