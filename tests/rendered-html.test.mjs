import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the multi-codec analyzer", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /BitScope/);
  assert.match(html, /AVC · HEVC · VVC · AV1/);
  assert.match(html, /H\.264 · H\.265 · H\.266 · AV1/);
  assert.match(html, /本地解析 · 文件不会上传/);
  assert.match(html, /多编码码流分析器/);
});

test("declares each supported elementary-stream format", async () => {
  const [analyzer, codecs] = await Promise.all([
    readFile(new URL("../app/Analyzer.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/codecs.ts", import.meta.url), "utf8"),
  ]);

  for (const codec of ["h264", "h265", "h266", "av1"]) {
    assert.match(codecs, new RegExp(`\\"${codec}\\"`));
  }
  for (const extension of [".h264", ".h265", ".h266", ".obu", ".ivf"]) {
    assert.match(codecs, new RegExp(extension.replace(".", "\\.")));
  }
  assert.match(analyzer, /analyzeBitstream\(bytes, file\.name\)/);
  assert.match(analyzer, /analysis\.blockSize/);
  assert.match(analyzer, /analyzeH264Subblocks/);
  assert.match(analyzer, /parsedMacroblock\.partitions/);
  assert.match(analyzer, /unitColor\(unit\.type, analysis\.codecKind\)/);
});
