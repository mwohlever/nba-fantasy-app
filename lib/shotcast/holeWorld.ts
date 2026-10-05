import { groundNativePoint, surfaceHeight, type CourseOffset, type Point3, type TerrainPrimitive } from "./productionGeometry";
import type { StaticPlayerHole } from "./shotcast3dView";

export type HoleWorld = {
  tee: Point3;
  pin: Point3;
  nativePin: Point3;
  shots: readonly { strokeNumber: number; from: Point3; endpoint: Point3; nativeFrom: Point3; nativeEndpoint: Point3 }[];
  greenBounds: { min: Point3; max: Point3 } | null;
};

/** Also freeze geometry after the JSON handoff; Three owns copies of these points. */
export function freezeHoleWorld<T extends HoleWorld>(world: T): T {
  for (const shot of world.shots) {
    for (const point of [shot.from, shot.endpoint, shot.nativeFrom, shot.nativeEndpoint]) Object.freeze(point);
    Object.freeze(shot);
  }
  for (const point of [world.tee, world.pin, world.nativePin]) Object.freeze(point);
  Object.freeze(world.shots);
  if (world.greenBounds) {
    Object.freeze(world.greenBounds.min); Object.freeze(world.greenBounds.max); Object.freeze(world.greenBounds);
  }
  return Object.freeze(world);
}

/** Complete current-player geometry. No camera, selection, image or viewport inputs. */
export function buildHoleWorld(replay: StaticPlayerHole, offset: CourseOffset, terrain: TerrainPrimitive[], green: TerrainPrimitive[]): HoleWorld | null {
  const ground = (point: StaticPlayerHole["pin"]) => {
    const result = groundNativePoint(point, offset, terrain, green);
    return result ? Object.freeze(result) : null;
  };
  const shots: HoleWorld["shots"][number][] = [];
  // The provider identifies strokes by strokeNumber, not transport array order.
  for (const shot of [...replay.shots].sort((a, b) => a.strokeNumber - b.strokeNumber)) {
    const from = ground(shot.from), endpoint = ground(shot.to);
    if (!from || !endpoint) return null;
    shots.push(Object.freeze({ strokeNumber: shot.strokeNumber, from, endpoint,
      nativeFrom: Object.freeze([shot.from.tourcastX, shot.from.tourcastY, shot.from.tourcastZ] as Point3),
      nativeEndpoint: Object.freeze([shot.to.tourcastX, shot.to.tourcastY, shot.to.tourcastZ] as Point3) }));
  }
  const tee = shots.find(shot => shot.strokeNumber === 1)?.from;
  const pin = ground(replay.pin);
  if (!tee || !pin) return null;
  let greenBounds: HoleWorld["greenBounds"] = null;
  // A true green camera requires an authored surface containing the current cup.
  if (surfaceHeight(green, pin[0], pin[1]) !== null) {
    const min: [number, number, number] = [Infinity, Infinity, Infinity], max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (const primitive of green) for (let i = 0; i < primitive.positions.length; i += 3) {
      for (let axis = 0; axis < 3; axis++) {
        min[axis] = Math.min(min[axis], primitive.positions[i + axis]);
        max[axis] = Math.max(max[axis], primitive.positions[i + axis]);
      }
    }
    greenBounds = Object.freeze({ min: Object.freeze(min), max: Object.freeze(max) });
  }
  const nativePin = Object.freeze([replay.pin.tourcastX, replay.pin.tourcastY, replay.pin.tourcastZ] as Point3);
  return freezeHoleWorld({ tee, pin, nativePin, shots, greenBounds });
}
