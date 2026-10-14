import { component } from '@xiaobaibaifqy/jingchuanchu-ecs';
export interface Point {
  x: number;
  y: number;
}
export interface Stroke {
  points: Point[];
  color: string;
  width: number;
}
export const Position2D = component<Point>('Position2D');
export const Shape2D = component<{
  kind: 'circle' | 'rect';
  color: string;
  width: number;
  height: number;
  layer: number;
}>('Shape2D');
