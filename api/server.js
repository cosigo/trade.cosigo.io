const http = require('http');
const path = require('path');
const fs = require('fs/promises');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3012);
const DATA_DIR = process.env.TRADE_REQUESTS_DIR || '/srv/data/trade-requests';
const ADMIN_KEY = process.env.TRADE_ADMIN_KEY || '';

const INDEX_FILE = path.join(DATA_DIR, 'index.json');

const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const TROY_OUNCE_MG = 31103.4768;

const DEFAULT_SETTINGS = {
  ozUsdReference: 100,
  digitalExitFeeRate: 0.015,
  physicalRedemptionFeeRate: 0.25,
  version: 1,
  updatedAt: null
};

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

function cleanOptionalString(value, maxLen = 500) {
  const out = String(value ?? '').trim();
  return out.slice(0, maxLen);
}

function cleanSettlementPayload(body, record) {
  const settlementAsset = cleanString(
    body.settlementAsset ?? record.fromAsset,
    'settlementAsset'
  ).toUpperCase();

  if (!VALID_ASSETS.has(settlementAsset)) {
    throw new Error('Invalid settlementAsset');
  }

  if (settlementAsset !== record.fromAsset) {
    throw new Error(`settlementAsset must match request fromAsset (${record.fromAsset})`);
  }

  const settlementAmount = cleanPositiveAmount(
    body.settlementAmount ?? record.inputAmount,
    'settlementAmount'
  );

  const settlementNetwork = cleanString(
    body.settlementNetwork ?? 'BNB Smart Chain',
    'settlementNetwork'
  );

  const settlementAddress = cleanString(body.settlementAddress, 'settlementAddress');
  if (!isEthAddress(settlementAddress)) {
    throw new Error('settlementAddress must be a full 0x address');
  }

  const settlementNote = cleanOptionalString(body.settlementNote, 500);
  const settlementWindow = cleanOptionalString(body.settlementWindow, 200);

  return {
    asset: settlementAsset,
    amount: settlementAmount,
    network: settlementNetwork,
    address: settlementAddress,
    note: settlementNote,
    window: settlementWindow,
    assignedAt: nowIso(),
    assignedBy: 'admin',
  };
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

  await ensureSettingsFile();
}

async function loadIndex() {
  try {
    const raw = await fs.readFile(INDEX_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function ensureSettingsFile() {
  try {
    await fs.access(SETTINGS_FILE);
  } catch {
    const initial = {
      ...DEFAULT_SETTINGS,
      updatedAt: nowIso(),
    };
    await writeJsonAtomic(SETTINGS_FILE, initial);
  }
}

async function loadSettings() {
  try {
    const raw = await fs.readFile(SETTINGS_FILE, 'utf8');
    const parsed = JSON.parse(raw);

    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
    };
  } catch {
    return {
      ...DEFAULT_SETTINGS,
      updatedAt: nowIso(),
    };
  }
}

function getCosigoUsdBasis(ozUsdReference) {
  return Number(ozUsdReference) / TROY_OUNCE_MG;
}

function getUsdBasis(asset, settings) {
  if (asset === 'USDT') return 1;
  if (asset === 'CIGO') return 0.01;
  if (asset === 'COSIGO') return getCosigoUsdBasis(settings.ozUsdReference);
  return null;
}

function getPricingPolicy(fromAsset, toAsset, settings) {
  if (toAsset === 'COSIGO' && fromAsset !== 'COSIGO') {
    return { feeRate: 0, policy: 'onboarding' };
  }

  if (fromAsset === 'COSIGO' && toAsset !== 'COSIGO') {
    return { feeRate: Number(settings.digitalExitFeeRate || 0), policy: 'digital_exit' };
  }

  return { feeRate: 0, policy: 'internal' };
}

function formatAmount(value, digits = 18) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new Error('Invalid numeric value');
  }

  return num.toFixed(digits).replace(/\.?0+$/, '');
}

function quoteRoute(fromAsset, toAsset, inputAmount, settings) {
  const inputNum = Number(inputAmount);
  if (!Number.isFinite(inputNum) || inputNum <= 0) {
    throw new Error('inputAmount must be greater than zero');
  }

  const fromUsd = getUsdBasis(fromAsset, settings);
  const toUsd = getUsdBasis(toAsset, settings);

  if (!fromUsd || !toUsd) {
    throw new Error('Unable to quote this route');
  }

  const pricing = getPricingPolicy(fromAsset, toAsset, settings);
  const grossUsdValue = inputNum * fromUsd;
  const feeUsdValue = grossUsdValue * pricing.feeRate;
  const netUsdValue = grossUsdValue - feeUsdValue;
  const outputAmount = netUsdValue / toUsd;

  return {
    pricingPolicy: pricing.policy,
    feeRate: pricing.feeRate,
    grossUsdValue,
    feeUsdValue,
    netUsdValue,
    outputAmount: formatAmount(outputAmount),
    feeAmount: formatAmount(feeUsdValue),
    basisSnapshot: {
      ozUsdReference: Number(settings.ozUsdReference),
      cosigoUsdBasis: getCosigoUsdBasis(settings.ozUsdReference),
      cigoUsdBasis: 0.01,
      usdtUsdBasis: 1,
      digitalExitFeeRate: Number(settings.digitalExitFeeRate || 0),
      physicalRedemptionFeeRate: Number(settings.physicalRedemptionFeeRate || 0),
      version: Number(settings.version || 1),
      updatedAt: settings.updatedAt || nowIso(),
    }
  };
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

      const settings = await loadSettings();
      const serverQuote = quoteRoute(fromAsset, toAsset, inputAmount, settings);

      const outputAmount = serverQuote.outputAmount;
      const feeAmount = serverQuote.feeAmount;
      const feeRate = serverQuote.feeRate;
      const basisValue = serverQuote.netUsdValue;

      const basis = {
        CIGO_USD_BASIS: serverQuote.basisSnapshot.cigoUsdBasis,
        COSIGO_USD_BASIS: serverQuote.basisSnapshot.cosigoUsdBasis,
        USDT_USD_BASIS: serverQuote.basisSnapshot.usdtUsdBasis,
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
        pricingPolicy: serverQuote.pricingPolicy,
        basisSnapshot: serverQuote.basisSnapshot,
        status: 'draft',
        settlement: null,
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

      if (nextStatus === 'reviewed') {
        record.settlement = cleanSettlementPayload(body, record);
      }

      record.status = nextStatus;
      record.updatedAt = nowIso();

      if (nextStatus === 'completed' && record.settlement) {
        record.settlement.completedAt = record.updatedAt;
        record.settlement.completedNote = cleanOptionalString(body.completedNote, 500);
      }

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
