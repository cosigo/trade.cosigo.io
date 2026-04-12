const http = require('http');
const path = require('path');
const fs = require('fs/promises');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3012);
const DATA_DIR = process.env.TRADE_REQUESTS_DIR || '/srv/data/trade-requests';
const ADMIN_KEY = process.env.TRADE_ADMIN_KEY || '';

const INDEX_FILE = path.join(DATA_DIR, 'index.json');

const VALID_ASSETS = new Set(['BNB', 'CIGO', 'USDT', 'COSIGO']);

const INTERNAL_ROUTES = new Set([
  'CIGO:USDT',
  'USDT:CIGO',
  'USDT:COSIGO',
  'COSIGO:USDT',
  'CIGO:COSIGO',
  'COSIGO:CIGO',
]);

const STATUS_FLOW = {
  draft: ['submitted'],
  submitted: ['reviewed'],
  reviewed: ['completed'],
  completed: [],
};

function nowIso() {
  return new Date().toISOString();
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}

function sendError(res, statusCode, message) {
  sendJson(res, statusCode, { ok: false, error: message });
}

function makeRequestId() {
  return `req_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
}

function isEthAddress(value) {
  return typeof value === 'string' && /^0x[a-fA-F0-9]{40}$/.test(value.trim());
}

function cleanString(value, fieldName) {
  const out = String(value ?? '').trim();
  if (!out) throw new Error(`${fieldName} is required`);
  return out;
}

function cleanPositiveAmount(value, fieldName) {
  const out = String(value ?? '').trim();
  if (!/^\d+(\.\d+)?$/.test(out)) {
    throw new Error(`${fieldName} must be a positive numeric string`);
  }
  if (Number(out) <= 0) {
    throw new Error(`${fieldName} must be greater than zero`);
  }
  return out;
}

function cleanNonNegativeAmount(value, fieldName) {
  const out = String(value ?? '').trim();
  if (!/^\d+(\.\d+)?$/.test(out)) {
    throw new Error(`${fieldName} must be a numeric string`);
  }
  if (Number(out) < 0) {
    throw new Error(`${fieldName} must not be negative`);
  }
  return out;
}

function cleanNumber(value, fieldName, min = 0) {
  const out = Number(value);
  if (!Number.isFinite(out)) {
    throw new Error(`${fieldName} must be numeric`);
  }
  if (out < min) {
    throw new Error(`${fieldName} must be >= ${min}`);
  }
  return out;
}

function getRouteType(fromAsset, toAsset) {
  if (fromAsset === 'BNB' || toAsset === 'BNB') return 'external_market';
  if (INTERNAL_ROUTES.has(`${fromAsset}:${toAsset}`)) return 'internal';
  return 'unsupported';
}

function isAdmin(req) {
  return Boolean(ADMIN_KEY) && req.headers['x-trade-admin-key'] === ADMIN_KEY;
}

async function writeJsonAtomic(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(data, null, 2), 'utf8');
  await fs.rename(tempPath, filePath);
}

async function ensureDataLayout() {
  await fs.mkdir(path.join(DATA_DIR, 'history'), { recursive: true });

  try {
    await fs.access(INDEX_FILE);
  } catch {
    await writeJsonAtomic(INDEX_FILE, {});
  }
}

async function loadIndex() {
  try {
    const raw = await fs.readFile(INDEX_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function getRequestPath(record) {
  const d = new Date(record.createdAt);
  const yyyy = String(d.getUTCFullYear());
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return path.join(DATA_DIR, 'history', yyyy, mm, `${record.id}.json`);
}

async function writeRequest(record) {
  const index = await loadIndex();
  const filePath = getRequestPath(record);

  await writeJsonAtomic(filePath, record);

  index[record.id] = path.relative(DATA_DIR, filePath);
  await writeJsonAtomic(INDEX_FILE, index);

  return filePath;
}

async function readRequest(id) {
  const index = await loadIndex();
  const relativePath = index[id];
  if (!relativePath) return null;

  const fullPath = path.join(DATA_DIR, relativePath);
  const raw = await fs.readFile(fullPath, 'utf8');
  return JSON.parse(raw);
}

async function listRequests({ status = '', limit = 100 } = {}) {
  const index = await loadIndex();
  const ids = Object.keys(index);
  const items = [];

  for (const id of ids) {
    try {
      const record = await readRequest(id);
      if (!record) continue;
      if (status && record.status !== status) continue;
      items.push(record);
    } catch (err) {
      console.error(`Failed reading request ${id}`, err);
    }
  }

  items.sort((a, b) => {
    const aa = new Date(a.updatedAt || a.createdAt || 0).getTime();
    const bb = new Date(b.updatedAt || b.createdAt || 0).getTime();
    return bb - aa;
  });

  return items.slice(0, limit);
}

async function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';

    req.on('data', (chunk) => {
      raw += chunk;

      if (raw.length > 1024 * 1024) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });

    req.on('end', () => {
      if (!raw.trim()) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });

    req.on('error', reject);
  });
}

function buildHistoryEntry({ action, by, fromStatus = null, toStatus = null, note = '' }) {
  return {
    at: nowIso(),
    action,
    by,
    fromStatus,
    toStatus,
    note: String(note || ''),
  };
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    const pathname = url.pathname;

    if (req.method === 'GET' && pathname === '/api/health') {
      sendJson(res, 200, { ok: true, service: 'trade-request-api' });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/requests/create') {
      const body = await parseJsonBody(req);

      const wallet = cleanString(body.wallet, 'wallet');
      if (!isEthAddress(wallet)) {
        throw new Error('wallet must be a full 0x address');
      }

      const fromAsset = cleanString(body.fromAsset, 'fromAsset').toUpperCase();
      const toAsset = cleanString(body.toAsset, 'toAsset').toUpperCase();

      if (!VALID_ASSETS.has(fromAsset) || !VALID_ASSETS.has(toAsset)) {
        throw new Error('Invalid asset symbol');
      }

      if (fromAsset === toAsset) {
        throw new Error('fromAsset and toAsset must be different');
      }

      const routeType = getRouteType(fromAsset, toAsset);
      if (routeType === 'unsupported') {
        throw new Error('Unsupported route');
      }

      if (routeType === 'external_market') {
        throw new Error('BNB routes are external-market-only and not server-settled here');
      }

      const inputAmount = cleanPositiveAmount(body.inputAmount, 'inputAmount');
      const outputAmount = cleanPositiveAmount(body.outputAmount, 'outputAmount');
      const feeAmount = cleanNonNegativeAmount(body.feeAmount ?? '0', 'feeAmount');
      const feeRate = cleanNumber(body.feeRate ?? 0, 'feeRate', 0);
      const basisValue = cleanNumber(body.basisValue ?? 0, 'basisValue', 0);

      const basis = {
        CIGO_USD_BASIS: cleanNumber(body.basis?.CIGO_USD_BASIS, 'basis.CIGO_USD_BASIS', 0),
        COSIGO_USD_BASIS: cleanNumber(body.basis?.COSIGO_USD_BASIS, 'basis.COSIGO_USD_BASIS', 0),
        USDT_USD_BASIS: cleanNumber(body.basis?.USDT_USD_BASIS, 'basis.USDT_USD_BASIS', 0),
      };

      const createdAt = nowIso();

      const record = {
        id: makeRequestId(),
        createdAt,
        updatedAt: createdAt,
        source: 'trade.cosigo.io',
        wallet,
        fromAsset,
        toAsset,
        route: `${fromAsset} → ${toAsset}`,
        routeType,
        inputAmount,
        outputAmount,
        basisValue,
        basis,
        feeRate,
        feeAmount,
        status: 'draft',
        history: [
          buildHistoryEntry({
            action: 'created',
            by: wallet,
            fromStatus: null,
            toStatus: 'draft',
            note: 'Initial request created',
          }),
        ],
      };

      await writeRequest(record);

      sendJson(res, 201, { ok: true, request: record });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/requests') {
      if (!isAdmin(req)) {
        sendError(res, 403, 'Admin key required');
        return;
      }

      const status = String(url.searchParams.get('status') || '').trim().toLowerCase();
      const limitRaw = Number(url.searchParams.get('limit') || 100);
      const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 500) : 100;

      const requests = await listRequests({ status, limit });
      sendJson(res, 200, { ok: true, requests });
      return;
    }

    const requestMatch = pathname.match(/^\/api\/requests\/([A-Za-z0-9_-]+)$/);
    if (req.method === 'GET' && requestMatch) {
      const id = requestMatch[1];
      const record = await readRequest(id);

      if (!record) {
        sendError(res, 404, 'Request not found');
        return;
      }

      sendJson(res, 200, { ok: true, request: record });
      return;
    }

    const statusMatch = pathname.match(/^\/api\/requests\/([A-Za-z0-9_-]+)\/status$/);
    if (req.method === 'POST' && statusMatch) {
      const id = statusMatch[1];
      const body = await parseJsonBody(req);

      const record = await readRequest(id);
      if (!record) {
        sendError(res, 404, 'Request not found');
        return;
      }

      const previousStatus = record.status;
      const nextStatus = cleanString(body.status, 'status').toLowerCase();
      const allowedNext = STATUS_FLOW[previousStatus] || [];

      if (previousStatus === nextStatus) {
        sendJson(res, 200, { ok: true, request: record });
        return;
      }

      if (!allowedNext.includes(nextStatus)) {
        sendError(res, 400, `Invalid transition: ${previousStatus} -> ${nextStatus}`);
        return;
      }

      const adminRequired = nextStatus !== 'submitted';
      if (adminRequired && !isAdmin(req)) {
        sendError(res, 403, 'Admin key required for this status transition');
        return;
      }

      record.status = nextStatus;
      record.updatedAt = nowIso();

      if (nextStatus === 'submitted' && !record.submittedAt) {
        record.submittedAt = record.updatedAt;
      }

      if (nextStatus === 'reviewed' && !record.reviewedAt) {
        record.reviewedAt = record.updatedAt;
      }

      if (nextStatus === 'completed' && !record.completedAt) {
        record.completedAt = record.updatedAt;
      }

      record.history = Array.isArray(record.history) ? record.history : [];
      record.history.push(
        buildHistoryEntry({
          action: 'status_changed',
          by: adminRequired ? 'admin' : record.wallet,
          fromStatus: previousStatus,
          toStatus: nextStatus,
          note: String(body.note || ''),
        })
      );

      await writeRequest(record);

      sendJson(res, 200, { ok: true, request: record });
      return;
    }

    sendError(res, 404, 'Not found');
  } catch (err) {
    console.error(err);
    sendError(res, 400, err.message || 'Request failed');
  }
});

ensureDataLayout()
  .then(() => {
    server.listen(PORT, '127.0.0.1', () => {
      console.log(`trade-request-api listening on 127.0.0.1:${PORT}`);
      console.log(`data dir: ${DATA_DIR}`);
    });
  })
  .catch((err) => {
    console.error('Failed to start trade-request-api', err);
    process.exit(1);
  });
  