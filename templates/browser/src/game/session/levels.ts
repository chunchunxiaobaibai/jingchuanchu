const definitions = [
  {
    id: 'meadow',
    title: '林间初光',
    description: '沿着林间小径，寻找散落的微光。',
    durationSeconds: 30,
    targetCount: 8,
  },
  {
    id: 'river',
    title: '溪畔微风',
    description: '循着溪水，收集更多闪亮的光点。',
    durationSeconds: 40,
    targetCount: 12,
  },
  {
    id: 'night',
    title: '星夜小径',
    description: '在静谧星夜中，完成更长的收集之旅。',
    durationSeconds: 50,
    targetCount: 16,
  },
] as const;
export const levels = Object.freeze(definitions.map((level) => Object.freeze(level)));
export type LevelDefinition = (typeof levels)[number];
export type LevelId = LevelDefinition['id'];
export function findLevel(id: unknown): LevelDefinition | null {
  return typeof id === 'string' ? (levels.find((level) => level.id === id) ?? null) : null;
}
