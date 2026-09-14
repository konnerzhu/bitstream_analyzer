import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const desktopArtifacts = join(projectRoot, ".artifacts", "desktop");
const stagingRoot = join(desktopArtifacts, "app");
if (!stagingRoot.startsWith(`${projectRoot}${sep}`)) throw new Error("Unsafe desktop staging path");

const rootPackage = JSON.parse(await readFile(join(projectRoot, "package.json"), "utf8"));
await rm(stagingRoot, { recursive: true, force: true });
await mkdir(stagingRoot, { recursive: true });

for (const file of ["main.cjs", "native-runner.cjs", "preload.cjs"]) {
  await cp(join(projectRoot, "desktop", file), join(stagingRoot, file));
}
await cp(join(desktopArtifacts, "renderer"), join(stagingRoot, "renderer"), { recursive: true });
await writeFile(join(stagingRoot, "package.json"), `${JSON.stringify({
  name: "bitscope-desktop",
  version: rootPackage.version,
  description: rootPackage.description,
  author: rootPackage.author,
  private: true,
  main: "main.cjs",
}, null, 2)}\n`, { flag: "wx" });

console.log(`Staged dependency-free desktop runtime in ${stagingRoot}`);
