import { createServer } from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = __dirname;
const outputRoot = path.join(root, 'build');
const port = Number(process.env.PORT || 8000);
const host = process.env.HOST || '127.0.0.1';

const mime = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
};

const liveClients = new Set();
const watchedDirs = new Set();
let buildTimer;

function runBuild() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, 'scripts', 'build-content.mjs')], {
      cwd: root,
      stdio: 'inherit',
    });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`build-content exited with code ${code}`));
    });
    child.on('error', reject);
  });
}

function scheduleBuild() {
  clearTimeout(buildTimer);
  buildTimer = setTimeout(async () => {
    try {
      await runBuild();
      sendReload();
    } catch (error) {
      console.error(error.message);
    }
  }, 120);
}

function injectLiveReload(html) {
  const snippet = `<script>\n(() => {\n  const source = new EventSource('/__livereload');\n  source.onmessage = (event) => { if (event.data === 'reload') location.reload(); };\n})();\n</script>`;
  return html.includes('</body>') ? html.replace('</body>', `${snippet}\n</body>`) : `${html}\n${snippet}`;
}

function sendReload() {
  for (const res of liveClients) {
    res.write('data: reload\\n\\n');
  }
}

async function watchTree(dir) {
  if (watchedDirs.has(dir)) return;
  watchedDirs.add(dir);

  try {
    fs.watch(dir, { persistent: true }, async (eventType, fileName) => {
      const changed = String(fileName || '');
      const normalized = changed.replaceAll('\\', '/');

      // Ignore generated output churn to avoid rebuild loops and transient blank pages.
      if (normalized === 'build' || normalized.startsWith('build/')) {
        return;
      }

      if (!normalized) return;

      scheduleBuild();
      await crawlAndWatch(dir);
    });
  } catch {
    return;
  }

  await crawlAndWatch(dir);
}

async function crawlAndWatch(dir) {
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .filter((entry) => !['.git', 'node_modules', 'build'].includes(entry.name))
      .map((entry) => watchTree(path.join(dir, entry.name)))
  );
}

function resolvePath(urlPath) {
  const cleanPath = decodeURIComponent(urlPath.split('?')[0]);
  const candidate = cleanPath === '/' ? '/index.html' : cleanPath;
  const fullPath = path.resolve(outputRoot, `.${candidate}`);
  if (!fullPath.startsWith(outputRoot)) return null;
  return fullPath;
}

const server = createServer(async (req, res) => {
  const requestPath = req.url || '/';

  if (requestPath === '/__livereload') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });
    res.write('retry: 300\\n\\n');
    liveClients.add(res);
    req.on('close', () => liveClients.delete(res));
    return;
  }

  const filePath = resolvePath(requestPath);
  if (!filePath) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  try {
    const stat = await fs.stat(filePath);
    const target = stat.isDirectory() ? path.join(filePath, 'index.html') : filePath;
    const ext = path.extname(target).toLowerCase();
    const contentType = mime[ext] || 'application/octet-stream';
    const content = await fs.readFile(target);

    if (ext === '.html') {
      const html = injectLiveReload(content.toString('utf8'));
      res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
      res.end(html);
      return;
    }

    res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
    res.end(content);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
});

await watchTree(root);
await runBuild();

server.listen(port, host, () => {
  console.log(`Dev server running at http://${host}:${port}`);
});
