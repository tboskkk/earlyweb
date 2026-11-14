import { type Dirent, promises as fs } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { appCsp, type Manifest, parseManifest } from '@earlyweb/protocol';

/** `appOrigin` is the origin the shell loads apps from (e.g. `http://127.0.0.1:5174`);
 * each app's CSP names its own folder under it. */
export type AppServerOptions = { root: string; shellOrigin: string; appOrigin: string };

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.wasm': 'application/wasm',
  '.mp3': 'audio/mpeg',
};

const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function isInside(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel !== '' && !rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel);
}

async function readManifest(file: string): Promise<Manifest | null> {
  try {
    return parseManifest(JSON.parse(await fs.readFile(file, 'utf8')));
  } catch {
    return null;
  }
}

async function listApps(root: string) {
  const apps: { manifest: Manifest; baseUrl: string }[] = [];
  let ids: Dirent[] = [];
  try {
    ids = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return apps;
  }
  for (const id of ids) {
    if (!id.isDirectory() || !SEGMENT.test(id.name)) continue;
    let versions: Dirent[] = [];
    try {
      versions = await fs.readdir(path.join(root, id.name), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ver of versions) {
      if (!ver.isDirectory() || !SEGMENT.test(ver.name)) continue;
      const manifest = await readManifest(path.join(root, id.name, ver.name, 'earlyweb.json'));
      if (manifest && manifest.id === id.name && manifest.version === ver.name) {
        apps.push({ manifest, baseUrl: `/${id.name}/${ver.name}/` });
      }
    }
  }
  return apps;
}

export function createAppServer(opts: AppServerOptions): http.Server {
  const root = path.resolve(opts.root);
  const appOrigin = opts.appOrigin.replace(/\/+$/, '');

  async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('x-content-type-options', 'nosniff');
    const send = (status: number, body = '', type = 'text/plain; charset=utf-8') => {
      res.statusCode = status;
      res.setHeader('content-type', type);
      res.end(body);
    };

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('allow', 'GET, HEAD');
      return send(405, 'method not allowed');
    }
    const head = req.method === 'HEAD';

    const rawPath = (req.url ?? '/').split(/[?#]/)[0] ?? '/';
    if (rawPath === '/index.json') {
      const body = JSON.stringify({ apps: await listApps(root) });
      res.statusCode = 200;
      res.setHeader('content-type', TYPES['.json'] as string);
      res.setHeader('content-length', Buffer.byteLength(body));
      return void res.end(head ? undefined : body);
    }

    let decoded: string;
    try {
      decoded = decodeURIComponent(rawPath);
    } catch {
      return send(400, 'bad request');
    }
    if (decoded.includes('\0') || decoded.includes('\\') || !decoded.startsWith('/')) {
      return send(404, 'not found');
    }
    const segments = decoded.slice(1).split('/');
    if (segments.length < 3 || segments.some((s) => s === '' || s === '.' || s === '..')) {
      return send(404, 'not found');
    }
    const [id, version] = segments as [string, string, ...string[]];
    if (!SEGMENT.test(id) || !SEGMENT.test(version)) return send(404, 'not found');

    const target = path.resolve(root, ...segments);
    if (!isInside(root, target)) return send(404, 'not found');

    let real: string;
    try {
      const [realRoot, realTarget] = await Promise.all([fs.realpath(root), fs.realpath(target)]);
      if (!isInside(realRoot, realTarget)) return send(404, 'not found');
      real = realTarget;
      if (!(await fs.stat(real)).isFile()) return send(404, 'not found');
    } catch {
      return send(404, 'not found');
    }

    const ext = path.extname(target).toLowerCase();
    const manifest = await readManifest(path.join(root, id, version, 'earlyweb.json'));
    if (!manifest) return send(404, 'not found');
    res.setHeader(
      'content-security-policy',
      appCsp(manifest, opts.shellOrigin, `${appOrigin}/${id}/${version}/`),
    );
    let data: Buffer;
    try {
      data = await fs.readFile(real);
    } catch {
      return send(404, 'not found');
    }
    res.statusCode = 200;
    res.setHeader('content-type', TYPES[ext] ?? 'application/octet-stream');
    res.setHeader('content-length', data.length);
    res.end(head ? undefined : data);
  }

  return http.createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end('internal error');
      } else res.destroy();
    });
  });
}
