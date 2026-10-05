import { createGreenSample, type GreenTopography } from './greenTopography';

/** Centralized presentation choices. Speeds communicate grade, not ball physics. */
export const FLOW_DISPLAY_LIFT = 0.012;
export const FLOW_FLAT_THRESHOLD = 0.003;
export const FLOW_MAX_DELTA = 0.25; // retain wall time down to 4 fps; bound exceptional stalls
export const FLOW_HISTORY_INTERVAL = 0.28;
export const flowSpeed = (slope: number) => slope <= FLOW_FLAT_THRESHOLD ? 0 : Math.min(3.2, 0.9 + 40 * (slope - FLOW_FLAT_THRESHOLD));

/** Inactive frames clear the clock: pause/hidden/mode-away time is never caught up. */
export function createGreenFlowClock() {
  let last: number | null = null;
  return {
    tick(timestampMs: number, active: boolean) {
      if (!active || !Number.isFinite(timestampMs)) { last = null; return 0; }
      const delta = last === null ? 0 : Math.max(0, Math.min(FLOW_MAX_DELTA, (timestampMs - last) / 1000));
      last = timestampMs;
      return delta;
    },
  };
}

/** Live exact-mesh advection, with upstream origins screened for useful travel.
 * Deterministic origins/phases/respawns; only downhill directions come from geometry.
 * Buffers and scratch samples are reused; no per-particle/frame allocations.
 */
export function createGreenFlow(topography: GreenTopography, budget = 64, initialPhases = true) {
  if (!Number.isInteger(budget) || budget < 1 || budget > 512) throw new Error('Flow budget must be 1–512');
  const { minX, maxX, minY, maxY } = topography.bounds;
  const width = maxX - minX, height = maxY - minY;
  const current = createGreenSample(), next = createGreenSample();
  let movedX = 0, movedY = 0, movedZ = 0, movedDistance = 0;
  const move = (x: number, y: number, dt: number) => {
    const s = topography.sample(x, y, current);
    if (!s) return false;
    const speed = flowSpeed(s.slopeMagnitude);
    if (!speed) return false;
    for (let attempt = 0; attempt < 4; attempt++) {
      const h = dt / (2 ** attempt);
      const mid = topography.sample(x + s.downhillX * speed * h / 2, y + s.downhillY * speed * h / 2, next);
      if (!mid) continue;
      const midSpeed = flowSpeed(mid.slopeMagnitude);
      const nx = x + mid.downhillX * midSpeed * h, ny = y + mid.downhillY * midSpeed * h;
      const candidate = topography.sample(nx, ny, next);
      if (!candidate || candidate.elevation > s.elevation + 1e-8) continue;
      const distance = Math.hypot(nx - x, ny - y);
      if (distance < 1e-10) continue;
      movedX = nx; movedY = ny; movedZ = candidate.elevation; movedDistance = distance;
      return true;
    }
    return false;
  };

  // Reject edge origins that immediately recycle over only a few pixels. Dry runs
  // use the same downhill integrator; they never invent a direction or surface.
  const candidates = Math.min(2048, budget * 4);
  const columns = Math.min(candidates, Math.max(1, Math.round(Math.sqrt(candidates * width / height))));
  const rows = Math.max(1, Math.floor(candidates / columns));
  const bank: number[] = [];
  const minimumTravel = Math.min(2.5, Math.hypot(width, height) * 0.12);
  for (let row = 0; row < rows; row++) for (let col = 0; col < columns; col++) {
    const sx = minX + (col + 0.5) * width / columns, sy = minY + (row + 0.5) * height / rows;
    let x = sx, y = sy, travel = 0, ticks = 0;
    for (; ticks < 120; ticks++) {
      if (!move(x, y, 1 / 30)) break;
      x = movedX; y = movedY; travel += movedDistance;
    }
    if (ticks >= 60 && travel >= minimumTravel) bank.push(sx, sy);
  }
  const bankCount = bank.length / 2, count = Math.min(budget, bankCount);
  const xy = new Float64Array(count * 2), age = new Float64Array(count), stalled = new Float32Array(count);
  const traveled = new Float64Array(count), respawns = new Uint32Array(count);
  const positions = new Float32Array(count * 9), weights = new Float32Array(count * 3);
  const origins = new Uint32Array(count);
  const golden = (i: number) => (i * 0.6180339887498949) % 1;
  const reset = (i: number, first = false) => {
    if (first) origins[i] = Math.floor(i * bankCount / count);
    else { respawns[i]++; origins[i] = (origins[i] + 1 + Math.floor(golden(i + respawns[i]) * Math.max(1, bankCount - 1))) % bankCount; }
    xy[i * 2] = bank[origins[i] * 2]; xy[i * 2 + 1] = bank[origins[i] * 2 + 1];
    age[i] = 0; stalled[i] = 0; traveled[i] = 0;
    const s = topography.sample(xy[i * 2], xy[i * 2 + 1], current)!;
    for (let t = 0; t < 3; t++) {
      const at = i * 9 + t * 3;
      positions[at] = xy[i * 2]; positions[at + 1] = xy[i * 2 + 1]; positions[at + 2] = s.elevation + FLOW_DISPLAY_LIFT;
      weights[i * 3 + t] = 0;
    }
  };
  for (let i = 0; i < count; i++) reset(i, true);
  const updateParticle = (i: number, dt: number) => {
    // Lifetime advances even if a flat face / local sink rejects movement.
    age[i] += dt;
    if (age[i] > 12 + 4 * golden(i + 1) || stalled[i] >= 0.6) { reset(i); return; }
    if (move(xy[i * 2], xy[i * 2 + 1], dt)) {
      xy[i * 2] = movedX; xy[i * 2 + 1] = movedY; traveled[i] += movedDistance; stalled[i] = 0;
      positions[i * 9] = movedX; positions[i * 9 + 1] = movedY; positions[i * 9 + 2] = movedZ + FLOW_DISPLAY_LIFT;
    } else stalled[i] += dt;
    // Fade stalled heads before recycling; flat areas don't accumulate static texture.
    weights[i * 3] = Math.min(1, age[i] / 0.18) * Math.max(0, 1 - stalled[i] / 0.6);
  };
  let elapsed = 0, historyTime = 0;
  const step = (seconds: number, active = true) => {
    if (!active || !Number.isFinite(seconds) || seconds <= 0) return;
    const dt = Math.min(seconds, FLOW_MAX_DELTA), steps = Math.ceil(dt / (1 / 120)), h = dt / steps;
    elapsed += dt;
    for (let j = 0; j < steps; j++) {
      historyTime += h;
      const save = historyTime >= FLOW_HISTORY_INTERVAL;
      if (save) historyTime %= FLOW_HISTORY_INTERVAL;
      for (let i = 0; i < count; i++) {
        if (save) {
          const at = i * 9;
          positions[at + 6] = positions[at + 3]; positions[at + 7] = positions[at + 4]; positions[at + 8] = positions[at + 5];
          positions[at + 3] = positions[at]; positions[at + 4] = positions[at + 1]; positions[at + 5] = positions[at + 2];
          weights[i * 3 + 2] = age[i] > FLOW_HISTORY_INTERVAL * 2 ? weights[i * 3 + 1] * 0.35 : 0;
          weights[i * 3 + 1] = age[i] > FLOW_HISTORY_INTERVAL ? weights[i * 3] * 0.28 : 0;
        }
        updateParticle(i, h);
      }
    }
  };
  // Different initial travel phases avoid a grid texture / synchronized recycling.
  if (initialPhases) for (let i = 0; i < count; i++) {
    const ticks = Math.floor(golden(i + 1) * 180);
    for (let j = 0; j < ticks; j++) updateParticle(i, 1 / 120);
  }
  return { count, positions, weights, xy, traveled, respawns, step, get elapsed() { return elapsed; } };
}
