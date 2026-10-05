import type { Point3 } from "./productionGeometry";

/** Display only. The full downhill simulation, seed bank and source weights
 * remain unchanged. Each retained head keeps its own two history dots. */
export const FLOW_VISIBLE_FRACTION = 0.45;
export const FLOW_HEAD_PIXELS = 5;
export const FLOW_TRAIL_PIXELS = 1.9;
export const FLOW_BACKGROUND_OPACITY = 0.30;
export const FLOW_CORRIDOR_OPACITY = 0.58;
export const FLOW_CORRIDOR_SIGMA_METRES = 2.25;

export function retainFlowHead(index: number): boolean {
  return Math.floor((index + 1) * FLOW_VISIBLE_FRACTION) > Math.floor(index * FLOW_VISIBLE_FRACTION);
}

export function distanceToPuttXY(x: number, y: number, points: readonly Point3[]): number {
  let minimum = Infinity;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const dx = b[0] - a[0], dy = b[1] - a[1], lengthSq = dx * dx + dy * dy;
    const t = lengthSq > 0 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / lengthSq)) : 0;
    minimum = Math.min(minimum, Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy));
  }
  return minimum;
}

export function smoothDisplayFade(distance: number, inner: number, outer: number): number {
  const t = Math.max(0, Math.min(1, (distance - inner) / (outer - inner)));
  return t * t * (3 - 2 * t);
}

/** A broad Gaussian emphasis has no corridor edge. A narrow centreline fade
 * reserves visual space for the actual tracer; it never changes that tracer. */
export function flowCorridorOpacity(distance: number): number {
  const proximity = Math.exp(-0.5 * (distance / FLOW_CORRIDOR_SIGMA_METRES) ** 2);
  const alpha = FLOW_BACKGROUND_OPACITY + (FLOW_CORRIDOR_OPACITY - FLOW_BACKGROUND_OPACITY) * proximity;
  return alpha * smoothDisplayFade(distance, 0.18, 0.45);
}

export function createGreenFlowPresentation(count: number) {
  const displayAlpha = new Float32Array(count * 3);
  const retainedHeads = Array.from({ length: count }, (_, i) => retainFlowHead(i)).filter(Boolean).length;
  const update = (positions: Float32Array, corridor: readonly Point3[] | null,
    // Optional projected glyph protection, applied to alpha only.
    glyphVisibility: (x: number, y: number, z: number) => number = () => 1) => {
    for (let i = 0; i < count; i++) for (let trail = 0; trail < 3; trail++) {
      const at = i * 9 + trail * 3, id = i * 3 + trail;
      if (!retainFlowHead(i)) { displayAlpha[id] = 0; continue; }
      const x = positions[at], y = positions[at + 1], z = positions[at + 2];
      const alpha = corridor ? flowCorridorOpacity(distanceToPuttXY(x, y, corridor)) : FLOW_BACKGROUND_OPACITY;
      displayAlpha[id] = alpha * glyphVisibility(x, y, z);
    }
  };
  return { displayAlpha, retainedHeads, update };
}
