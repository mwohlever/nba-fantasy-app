/** Read-only local delivery adapter for legacy research and validated course-only preparation. */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { normalizePackage, validateDescriptor, type PackageDescriptor } from "./package";
import { readPreserved } from "./local";
import { validatePreparedCourse } from "../preparation/prepareCourse.server";

export const PREPARED_DIRECTORY = "tmp/shotcast-ingestion/packages";

/** Spatial preparation projected from preserved research, without player material. */
export type PreparedCourseDescriptor = Pick<PackageDescriptor,
  "packageId" | "event" | "engine" | "configuration" | "assets" | "courseAssets" | "holes"
>;

export async function readPreparedCourseDescriptor(id: string): Promise<PreparedCourseDescriptor> {
  if (!/^pga-[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid prepared package ID");
  const value: unknown = JSON.parse(await readFile(/*turbopackIgnore: true*/ path.join(process.cwd(), PREPARED_DIRECTORY, id, "descriptor.json"), "utf8"));
  if (value && typeof value === "object" && "schemaVersion" in value && value.schemaVersion === 2) {
    validatePreparedCourse(value);
    if (value.packageId !== id) throw new Error("Prepared package ID mismatch");
    const { packageId, event, engine, configuration, assets, courseAssets, holes } = value;
    return { packageId, event, engine, configuration, assets, courseAssets, holes };
  }
  const { packageId, event, engine, configuration, assets, courseAssets, holes } = await readPreparedDescriptor(id);
  return { packageId, event, engine, configuration, assets, courseAssets, holes };
}

export async function readPreparedDescriptor(id: string): Promise<PackageDescriptor> {
  if (!/^pga-[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid prepared package ID");
  const descriptor: unknown = JSON.parse(await readFile(/*turbopackIgnore: true*/ path.join(process.cwd(), PREPARED_DIRECTORY, id, "descriptor.json"), "utf8"));
  validateDescriptor(descriptor);
  if (descriptor.packageId !== id) throw new Error("Prepared package ID mismatch");
  return descriptor;
}

/** Research/test reader only. Runtime course preparation never reads native.bin. */
export async function loadPreparedPackage(id: string) {
  const descriptor = await readPreparedDescriptor(id);
  const course = descriptor.assets.find(asset => asset.id === descriptor.courseAssets.data)!;
  const [native, courseData] = await Promise.all([
    readPreserved(descriptor.shotSource.source), readPreserved(course), readPreserved(descriptor.configuration.source),
  ]);
  return normalizePackage(descriptor, JSON.parse(new TextDecoder().decode(native)), JSON.parse(new TextDecoder().decode(courseData)));
}
