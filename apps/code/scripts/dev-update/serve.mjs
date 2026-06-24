#!/usr/bin/env node
// Dependency-free static file server for the auto-update feed. Serves a directory
// (latest-mac.yml + zip + blockmap) over HTTP with Range support, which the macOS
// updater needs. Used by the update E2E and for local manual testing.
//
// Usage: node serve.mjs <dir> [port]
import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const root = process.argv[2];
const port = Number(process.argv[3] ?? 8080);

if (!root) {
  console.error("Usage: serve.mjs <dir> [port]");
  process.exit(1);
}

const CONTENT_TYPES = {
  ".yml": "text/yaml; charset=utf-8",
  ".yaml": "text/yaml; charset=utf-8",
  ".zip": "application/zip",
  ".blockmap": "application/octet-stream",
  ".json": "application/json; charset=utf-8",
};

const server = createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]);
  const safePath = normalize(urlPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(root, safePath);

  let stat;
  try {
    stat = statSync(filePath);
  } catch {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  if (!stat.isFile()) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const type = CONTENT_TYPES[extname(filePath)] ?? "application/octet-stream";
  const range = req.headers.range;

  if (range) {
    const match = /bytes=(\d*)-(\d*)/.exec(range);
    let start = 0;
    let end = stat.size - 1;
    if (match?.[1]) {
      start = Number(match[1]);
      if (match[2]) end = Number(match[2]);
    } else if (match?.[2]) {
      // Suffix range (bytes=-N): the last N bytes of the file.
      start = Math.max(0, stat.size - Number(match[2]));
    }
    res.writeHead(206, {
      "Content-Type": type,
      "Content-Range": `bytes ${start}-${end}/${stat.size}`,
      "Accept-Ranges": "bytes",
      "Content-Length": end - start + 1,
    });
    createReadStream(filePath, { start, end }).pipe(res);
    return;
  }

  res.writeHead(200, {
    "Content-Type": type,
    "Content-Length": stat.size,
    "Accept-Ranges": "bytes",
  });
  createReadStream(filePath).pipe(res);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`update feed: http://127.0.0.1:${port} serving ${root}`);
});
