import { stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startProdServer } from "vinext/server/prod-server";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(projectRoot, ".artifacts", "dist");
const rawPort = process.env.PORT ?? "3000";

if (!/^\d{1,5}$/.test(rawPort)) throw new Error("PORT must be an integer from 1 to 65535");
const port = Number(rawPort);
if (port < 1 || port > 65_535) throw new Error("PORT must be an integer from 1 to 65535");

await stat(resolve(outDir, "server", "index.js")).catch(() => {
  throw new Error("Production build is missing; run `npm run build` first");
});

await startProdServer({ host: "0.0.0.0", port, outDir });
