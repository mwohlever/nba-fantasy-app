/** Read-only, hash-checked storage boundary for trusted local research packages. */
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import type { SourceRef } from "./package";

export async function readPreserved(source: SourceRef): Promise<Uint8Array> {
  // Local research bytes are deliberately absent from production file traces.
  const root = process.cwd();
  const filename = path.resolve(/*turbopackIgnore: true*/ root, source.localPath);
  if (!filename.startsWith(`${root}${path.sep}`)) throw new Error("Invalid preserved path");
  const bytes = await readFile(/*turbopackIgnore: true*/ filename);
  if (createHash("sha256").update(bytes).digest("hex") !== source.sha256) throw new Error(`Preserved source changed: ${source.identifier}`);
  return new Uint8Array(bytes);
}
