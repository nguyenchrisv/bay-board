import { readFile, stat } from "node:fs/promises";
import { join, resolve, relative, sep, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PUBLIC_DIR = resolve(join(__dirname, "..", "public"));

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

function getMimeType(filePath) {
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  return MIME_TYPES[ext] || "application/octet-stream";
}

function isSafePath(requestedPath, baseDir) {
  const resolvedBase = resolve(baseDir);
  const resolvedRequested = resolve(requestedPath);
  const relativePath = relative(resolvedBase, resolvedRequested);
  return !relativePath.startsWith("..") && !relativePath.startsWith(sep);
}

export async function serveStatic(req, res, urlPath) {
  let filePath = urlPath;
  if (filePath === "/" || filePath === "") {
    filePath = "/index.html";
  }

  // Remove query string if present
  const queryIndex = filePath.indexOf("?");
  if (queryIndex !== -1) {
    filePath = filePath.slice(0, queryIndex);
  }

  const fullPath = join(PUBLIC_DIR, filePath);

  // Prevent path traversal
  if (!isSafePath(fullPath, PUBLIC_DIR)) {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Bad Request");
    return true;
  }

  try {
    const stats = await stat(fullPath);
    if (!stats.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not Found");
      return true;
    }

    const content = await readFile(fullPath);
    const mimeType = getMimeType(fullPath);
    res.writeHead(200, { "Content-Type": mimeType });
    res.end(content);
    return true;
  } catch (err) {
    if (err.code === "ENOENT") {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not Found");
      return true;
    }
    throw err;
  }
}