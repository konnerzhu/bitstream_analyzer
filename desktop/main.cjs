"use strict";

const { app, BrowserWindow, ipcMain, session } = require("electron");
const { join, resolve } = require("node:path");
const { decodeNativeFrame } = require("./native-runner.cjs");

const projectRoot = resolve(__dirname, "..");

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
    return new URL(candidate).origin === expected.origin;
  } catch {
    return false;
  }
}

async function createWindow() {
  const url = developmentUrl();
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

app.enableSandbox();
app.whenReady().then(async () => {
  const allowedOrigin = developmentUrl().origin;
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  ipcMain.handle("bitscope:decode-frame", async (event, request) => {
    if (!event.senderFrame || !sameOrigin(event.senderFrame.url, new URL(allowedOrigin))) throw new Error("Native decode request came from an unexpected origin");
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
