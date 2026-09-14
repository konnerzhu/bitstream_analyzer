"use strict";

const { app, BrowserWindow, ipcMain, net, protocol, session } = require("electron");
const { access } = require("node:fs/promises");
const { join, resolve, sep } = require("node:path");
const { pathToFileURL } = require("node:url");
const { decodeNativeFrame } = require("./native-runner.cjs");

const projectRoot = resolve(__dirname, "..");
const packagedUrl = new URL("bitscope://app/");

protocol.registerSchemesAsPrivileged([{
  scheme: "bitscope",
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    corsEnabled: false,
  },
}]);

function developmentUrl() {
  const value = process.env.BITSCOPE_DEV_SERVER_URL || "http://localhost:3000/";
  const url = new URL(value);
  if (url.protocol !== "http:" || (url.hostname !== "localhost" && url.hostname !== "127.0.0.1")) {
    throw new Error("The desktop development URL must use a loopback HTTP origin");
  }
  return url;
}

function sameOrigin(candidate, expected) {
  try {
    const value = new URL(candidate);
    return value.protocol === expected.protocol && value.host === expected.host;
  } catch {
    return false;
  }
}

async function createWindow() {
  const url = app.isPackaged ? packagedUrl : developmentUrl();
  const window = new BrowserWindow({
    width: 1500,
    height: 980,
    minWidth: 1080,
    minHeight: 700,
    show: false,
    backgroundColor: "#f5f2e9",
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, candidate) => {
    if (!sameOrigin(candidate, url)) event.preventDefault();
  });
  window.once("ready-to-show", () => window.show());
  await window.loadURL(url.href);
}

async function registerPackagedRenderer() {
  const rendererRoot = join(app.getAppPath(), "renderer");
  await protocol.handle("bitscope", async request => {
    const requestUrl = new URL(request.url);
    if (requestUrl.hostname !== "app") return new Response("Not found", { status: 404 });
    let pathname;
    try {
      pathname = decodeURIComponent(requestUrl.pathname);
    } catch {
      return new Response("Bad request", { status: 400 });
    }
    const candidate = resolve(rendererRoot, `.${pathname === "/" ? "/index.html" : pathname}`);
    if (candidate !== rendererRoot && !candidate.startsWith(`${rendererRoot}${sep}`)) {
      return new Response("Forbidden", { status: 403 });
    }
    try {
      await access(candidate);
    } catch {
      return new Response("Not found", { status: 404 });
    }
    return net.fetch(pathToFileURL(candidate).href);
  });
}

app.enableSandbox();
app.whenReady().then(async () => {
  if (app.isPackaged) await registerPackagedRenderer();
  const allowedUrl = app.isPackaged ? packagedUrl : developmentUrl();
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  ipcMain.handle("bitscope:decode-frame", async (event, request) => {
    if (!event.senderFrame || !sameOrigin(event.senderFrame.url, allowedUrl)) throw new Error("Native decode request came from an unexpected origin");
    return decodeNativeFrame(request, {
      isPackaged: app.isPackaged,
      projectRoot,
      resourcesPath: process.resourcesPath,
    });
  });
  await createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
}).catch(error => {
  console.error(error instanceof Error ? error.message : error);
  app.exit(1);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
