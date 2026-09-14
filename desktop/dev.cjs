"use strict";

const { spawn } = require("node:child_process");
const electron = require("electron");

const url = "http://localhost:3000/";
let server = null;

async function isReachable() {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForServer() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await isReachable()) return;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error("Timed out waiting for the BitScope development server");
}

function stopServer() {
  if (server && server.exitCode === null) server.kill("SIGTERM");
}

async function main() {
  if (!(await isReachable())) {
    server = spawn(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "dev"], {
      cwd: process.cwd(),
      stdio: "inherit",
      shell: false,
    });
  }
  await waitForServer();
  const desktop = spawn(electron, ["."], {
    cwd: process.cwd(),
    stdio: "inherit",
    shell: false,
    env: { ...process.env, BITSCOPE_DEV_SERVER_URL: url },
  });
  desktop.once("exit", code => {
    stopServer();
    process.exitCode = code ?? 1;
  });
}

process.once("SIGINT", () => { stopServer(); process.exit(130); });
process.once("SIGTERM", () => { stopServer(); process.exit(143); });
main().catch(error => {
  stopServer();
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
