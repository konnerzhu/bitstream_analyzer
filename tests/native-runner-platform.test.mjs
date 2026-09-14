import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const { executableFor } = require("../desktop/native-runner.cjs");

test("resolves packaged native decoder names for each desktop platform", () => {
  const options = { isPackaged: true, projectRoot: "project", resourcesPath: "resources" };
  assert.equal(executableFor("h264", { ...options, platform: "win32" }), join("resources", "native", "bitscope-h264-inspect.exe"));
  assert.equal(executableFor("av1", { ...options, platform: "win32" }), join("resources", "native", "bitscope-av1-decode.exe"));
  assert.equal(executableFor("h264", { ...options, platform: "darwin" }), join("resources", "native", "bitscope-h264-inspect"));
});
