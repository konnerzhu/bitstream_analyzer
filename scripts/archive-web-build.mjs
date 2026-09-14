import { mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const artifactsRoot = join(projectRoot, ".artifacts");
const source = join(projectRoot, "dist");
const destination = join(artifactsRoot, "dist");

for (const path of [source, destination]) {
  if (!path.startsWith(`${projectRoot}${sep}`)) throw new Error("Unsafe web build path");
}

await stat(source).catch(() => {
  throw new Error("vinext did not create the expected dist directory");
});
await mkdir(artifactsRoot, { recursive: true });
await rm(destination, { recursive: true, force: true });
await rename(source, destination);

console.log(`Archived web build in ${destination}`);
