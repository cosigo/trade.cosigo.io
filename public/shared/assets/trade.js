document.addEventListener('DOMContentLoaded', () => {
  const els = {
    status: document.getElementById('swapStatus'),
    connectBtn: document.getElementById('connectBtn'),
    quoteBtn: document.getElementById('quoteBtn'),
    swapBtn: document.getElementById('swapBtn'),
    buyCigoBtn: document.getElementById('buyCigoBtn'),
    addCigoTopBtn: document.getElementById('addCigoTopBtn'),

    walletAddress: document.getElementById('walletAddress'),
    walletBNB: document.getElementById('walletBNB'),
    walletCIGO: document.getElementById('walletCIGO'),
    walletUSDT: document.getElementById('walletUSDT'),

    fromToken: document.getElementById('fromToken'),
    toToken: document.getElementById('toToken'),
    amountIn: document.getElementById('amountIn'),
    quoteStatusField: document.getElementById('quoteStatusField'),

    requestPanel: document.getElementById('requestPanel'),
    requestEmpty: document.getElementById('requestEmpty'),
    requestBody: document.getElementById('requestBody'),
    requestId: document.getElementById('requestId'),
    requestRoute: document.getElementById('requestRoute'),
    requestInput: document.getElementById('requestInput'),
    requestOutput: document.getElementById('requestOutput'),
    requestValue: document.getElementById('requestValue'),
    requestStatus: document.getElementById('requestStatus'),
    copyRequestBtn: document.getElementById('copyRequestBtn'),
    clearRequestBtn: document.getElementById('clearRequestBtn'),
    submitRequestBtn: document.getElementById('submitRequestBtn'),
    refreshRequestBtn: document.getElementById('refreshRequestBtn'),

    settlementBox: document.getElementById('settlementBox'),
    settlementTitle: document.getElementById('settlementTitle'),
    settlementCopy: document.getElementById('settlementCopy'),
    settlementList: document.getElementById('settlementList'),
    settlementNote: document.getElementById('settlementNote'),

    pricingPolicyNote: document.getElementById('pricingPolicyNote'),
    walletLimitNote: document.getElementById('walletLimitNote'),

    copyCigoContractTopBtn: document.getElementById('copyCigoContractTopBtn'),
    cigoContractTop: document.getElementById('cigoContractTop'),

    copyButtons: document.querySelectorAll('[data-copy]')
  };

  const CONFIG = {
    API_BASE: '/api',
    STORAGE_KEY_CURRENT_REQUEST: 'trade.cosigo.currentRequest',
    BSC_CHAIN_ID: '0x38',
    REQUEST_REFRESH_MS: 15000,
    COPY_RESET_MS: 1400,
    CONNECT_BTN_DEFAULT: '3) Connect wallet',
    CONNECT_BTN_READY: '3) Wallet ready',
    CONNECT_BTN_WRONG_NETWORK: '3) Wrong network',
    MARKET_ROUTE_ENABLED: false
  };

  const ADDRESSES = {
    CIGO: '0x3a38e963f524E0dDFB75dFa1752b4Cd1364F5560',
    USDT: '0x55d398326f99059fF775485246999027B3197955'
  };

  const REQUEST_STATUS_TEXT = {
    draft: 'Not yet submitted',
    submitted: 'Pending review',
    reviewed: 'Action required',
    completed: 'Completed'
  };

  const REQUEST_STATUS_CLASS = {
    draft: 'request-status-draft',
    submitted: 'request-status-submitted',
    reviewed: 'request-status-reviewed',
    completed: 'request-status-completed'
  };

  const state = {
    currentRequest: null,
    connectedAddress: null,
    walletSessionStarted: false,
    walletLimit: {
      usdtDailyWalletCap: 0,
      usedLast24h: 0,
      remaining24h: 0
    },
    balances: {
      BNB: 0,
      CIGO: 0,
      USDT: 0
    },
    pricing: {
      ozUsdReference: 100,
      cigoUsdReference: 0.01,
      cigoInboundHaircutRate: 0.10,
      cigoOutboundPremiumRate: 0.05,
      cigoSellBasis: 0.009,
      cigoBuyBasis: 0.0105,
      cosigoUsdBasis: 100 / 31103.4768,
      usdtUsdBasis: 1,
      digitalExitFeeRate: 0.015,
      physicalRedemptionFeeRate: 0.25,
      version: 1,
      updatedAt: null
    },
    requestAutoRefreshTimer: null
  };

  function setAppStatus(message) {
    if (els.status) els.status.textContent = message;
  }

  function setQuoteStatus(message) {
    if (els.quoteStatusField) els.quoteStatusField.value = message;
  }

  function numberOr(value, fallback) {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatAssetAmount(value, asset) {
    const num = Number(value);
    if (!Number.isFinite(num)) return String(value ?? '');

    let maxDigits = 6;
    if (asset === 'COSIGO') maxDigits = 0;
    if (asset === 'CIGO') maxDigits = 1;
    if (asset === 'USDT') maxDigits = 2;
    if (asset === 'BNB') maxDigits = 4;

    return num.toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: maxDigits
    });
  }

  function formatUsdAmount(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return '$0.00';

    return `$${num.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })}`;
  }

  function formatPercent(value) {
    const num = Number(value) * 100;
    if (!Number.isFinite(num)) return '0%';

    return `${num.toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2
    })}%`;
  }

  function getRequestStatusText(status) {
    return REQUEST_STATUS_TEXT[status] || status || '-';
  }

  function applyRequestStatusStyle(status) {
    if (!els.requestStatus) return;

    els.requestStatus.className = '';
    if (!status) return;

    els.requestStatus.classList.add('request-status-pill');

    const cls = REQUEST_STATUS_CLASS[status];
    if (cls) {
      els.requestStatus.classList.add(cls);
    }
  }

  async function copyText(value) {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return true;
    }

    const ta = document.createElement('textarea');
    ta.value = value;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    ta.style.pointerEvents = 'none';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();

    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }

    document.body.removeChild(ta);
    return ok;
  }

  function bindCopyButton(button, getValue, idleText = 'copy', successText = 'copied') {
    if (!button) return;

    button.addEventListener('click', async () => {
      const value = getValue();
      if (!value) return;

      const ok = await copyText(value);
      button.textContent = ok ? successText : 'copy failed';

      setTimeout(() => {
        button.textContent = idleText;
      }, CONFIG.COPY_RESET_MS);
    });
  }

  function updateRouteGuidance() {
    if (els.buyCigoBtn) els.buyCigoBtn.textContent = 'buy CIGO';
    if (els.quoteBtn) els.quoteBtn.textContent = '4) Get quote';
    if (els.swapBtn) els.swapBtn.textContent = '5) Request swap';
  }

  function updateWalletSummary(address, bnb, cigo, usdt) {
    state.connectedAddress = address;
    state.balances = {
      BNB: numberOr(bnb, 0),
      CIGO: numberOr(cigo, 0),
      USDT: numberOr(usdt, 0)
    };

    if (els.walletAddress) {
      els.walletAddress.textContent = `${address.slice(0, 6)}...${address.slice(-4)}`;
    }
    if (els.walletBNB) {
      els.walletBNB.textContent = state.balances.BNB.toFixed(4);
    }
    if (els.walletCIGO) {
      els.walletCIGO.textContent = state.balances.CIGO.toFixed(2);
    }
    if (els.walletUSDT) {
      els.walletUSDT.textContent = state.balances.USDT.toFixed(2);
    }
  }

  function clearWalletSummary() {
    state.connectedAddress = null;
    state.balances = {
      BNB: 0,
      CIGO: 0,
      USDT: 0
    };
    state.walletLimit = {
      usdtDailyWalletCap: 0,
      usedLast24h: 0,
      remaining24h: 0
    };

    if (els.walletAddress) els.walletAddress.textContent = 'Not connected';
    if (els.walletBNB) els.walletBNB.textContent = '0.0000';
    if (els.walletCIGO) els.walletCIGO.textContent = '0.00';
    if (els.walletUSDT) els.walletUSDT.textContent = '0.00';
    if (els.connectBtn) els.connectBtn.textContent = CONFIG.CONNECT_BTN_DEFAULT;

    updateWalletLimitNote();
  }

  function updateWalletLimitNote() {
    if (!els.walletLimitNote) return;

    if (!state.connectedAddress) {
      els.walletLimitNote.textContent = '24-hour USDT wallet cap will appear after wallet connection.';
      return;
    }

    if (!state.walletLimit.usdtDailyWalletCap) {
      els.walletLimitNote.textContent = 'No 24-hour USDT wallet cap is currently set.';
      return;
    }

    els.walletLimitNote.innerHTML =
      `<strong>24-hour USDT wallet cap:</strong> ` +
      `${formatAssetAmount(state.walletLimit.usedLast24h, 'USDT')} used / ` +
      `${formatAssetAmount(state.walletLimit.usdtDailyWalletCap, 'USDT')} total · ` +
      `<strong>${formatAssetAmount(state.walletLimit.remaining24h, 'USDT')} remaining</strong>`;
  }

  async function loadWalletLimitState(wallet) {
    if (!wallet) {
      state.walletLimit = {
        usdtDailyWalletCap: 0,
        usedLast24h: 0,
        remaining24h: 0
      };
      updateWalletLimitNote();
      return;
    }

    try {
      const data = await apiJson(`${CONFIG.API_BASE}/limits/wallet/${encodeURIComponent(wallet)}`);
      state.walletLimit = {
        usdtDailyWalletCap: numberOr(data.usdtDailyWalletCap, 0),
        usedLast24h: numberOr(data.usedLast24h, 0),
        remaining24h: numberOr(data.remaining24h, 0)
      };
    } catch (err) {
      console.error('Failed to load wallet limits', err);
      state.walletLimit = {
        usdtDailyWalletCap: 0,
        usedLast24h: 0,
        remaining24h: 0
      };
    }

    updateWalletLimitNote();
  }

  async function assertUsdtWalletCap(fromAsset, amount) {
    if (String(fromAsset).toUpperCase() !== 'USDT') return;
    if (!state.connectedAddress) return;

    await loadWalletLimitState(state.connectedAddress);

    if (
      state.walletLimit.usdtDailyWalletCap > 0 &&
      Number(amount) > state.walletLimit.remaining24h + 1e-9
    ) {
      throw new Error(
        `24-hour USDT cap exceeded. Remaining allowance: ${formatAssetAmount(state.walletLimit.remaining24h, 'USDT')} USDT.`
      );
    }
  }

  async function ensureBSC() {
    const { ethereum } = window;
    if (!ethereum) throw new Error('MetaMask not found');

    const chainId = await ethereum.request({ method: 'eth_chainId' });
    if (chainId === CONFIG.BSC_CHAIN_ID) return;

    try {
      await ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: CONFIG.BSC_CHAIN_ID }]
      });
    } catch (err) {
      alert('Switch to BNB Chain manually');
      throw err;
    }
  }

  async function isBSC() {
    if (!window.ethereum) return false;
    const chainId = await window.ethereum.request({ method: 'eth_chainId' });
    return chainId === CONFIG.BSC_CHAIN_ID;
  }

  function fromBaseUnitHexToNumber(hexValue, decimals = 18, fractionDigits = 6) {
    try {
      const raw = BigInt(hexValue || '0x0');
      const base = 10n ** BigInt(decimals);
      const whole = raw / base;
      const fraction = raw % base;

      let fractionText = fraction.toString().padStart(decimals, '0');
      fractionText = fractionText.slice(0, fractionDigits).replace(/0+$/, '');

      return Number(fractionText ? `${whole}.${fractionText}` : whole.toString());
    } catch {
      return 0;
    }
  }

  async function getBNBBalance(address) {
    const hex = await window.ethereum.request({
      method: 'eth_getBalance',
      params: [address, 'latest']
    });

    return fromBaseUnitHexToNumber(hex, 18, 6);
  }

  async function getTokenBalance(address, tokenAddress) {
    const data = '0x70a08231' + address.toLowerCase().replace(/^0x/, '').padStart(64, '0');

    const hex = await window.ethereum.request({
      method: 'eth_call',
      params: [{ to: tokenAddress, data }, 'latest']
    });

    return fromBaseUnitHexToNumber(hex, 18, 6);
  }

  async function getCigoBalance(address) {
    return getTokenBalance(address, ADDRESSES.CIGO);
  }

  async function getUsdtBalance(address) {
    return getTokenBalance(address, ADDRESSES.USDT);
  }

  async function addCigoToMetaMask() {
    if (!window.ethereum) {
      setAppStatus('MetaMask not found');
      return;
    }

    try {
      const wasAdded = await window.ethereum.request({
        method: 'wallet_watchAsset',
        params: {
          type: 'ERC20',
          options: {
            address: ADDRESSES.CIGO,
            symbol: 'CIGO',
            decimals: 18,
            image: 'https://trade.cosigo.io/shared/assets/icons/cigo_256.png'
          }
        }
      });

      setAppStatus(wasAdded ? 'CIGO added to MetaMask.' : 'CIGO was not added.');
    } catch (err) {
      console.error(err);
      setAppStatus(`Could not add CIGO: ${err.message || err}`);
    }
  }

  function getSelectedRoute() {
    const from = els.fromToken?.value || '';
    const to = els.toToken?.value || '';
    const amount = Number(els.amountIn?.value || '');

    return {
      from,
      to,
      amount,
      isValidAmount: Number.isFinite(amount) && amount > 0
    };
  }

  function updatePricingPolicyNote() {
    if (!els.pricingPolicyNote) return;

    const pricing = state.pricing;
    const updatedText = pricing.updatedAt
      ? `Pricing version ${pricing.version} · updated ${pricing.updatedAt}`
      : `Pricing version ${pricing.version}`;

    els.pricingPolicyNote.innerHTML =
      `<strong>Current pricing policy:</strong><br>` +
      `Reference ounce basis: <strong>${formatUsdAmount(pricing.ozUsdReference)}</strong> per troy ounce.<br>` +
      `COSIGO digital exit fee: <strong>${formatPercent(pricing.digitalExitFeeRate)}</strong>.<br>` +
      `COSIGO physical silver redemption fee: <strong>${formatPercent(pricing.physicalRedemptionFeeRate)}</strong>.<br>` +
      `CIGO sell basis discount: <strong>${formatPercent(pricing.cigoInboundHaircutRate)}</strong>.<br>` +
      `CIGO buy basis premium: <strong>${formatPercent(pricing.cigoOutboundPremiumRate)}</strong>.<br>` +
      `<span style="color:#9cabbd;">${updatedText}</span><br>` +
      `<a href="https://redeem.cosigo.io/" target="_blank" rel="noopener">open physical redemption page</a>`;
  }

  async function loadPricingState() {
    try {
      const data = await apiJson(`${CONFIG.API_BASE}/settings/public`);
      const settings = data.settings || {};
      const pricing = state.pricing;

      pricing.ozUsdReference = numberOr(settings.ozUsdReference, pricing.ozUsdReference);
      pricing.cigoUsdReference = numberOr(settings.cigoUsdReference, pricing.cigoUsdReference);
      pricing.cigoInboundHaircutRate = numberOr(settings.cigoInboundHaircutRate, pricing.cigoInboundHaircutRate);
      pricing.cigoOutboundPremiumRate = numberOr(settings.cigoOutboundPremiumRate, pricing.cigoOutboundPremiumRate);
      pricing.cigoSellBasis = numberOr(settings.cigoSellBasis, pricing.cigoSellBasis);
      pricing.cigoBuyBasis = numberOr(settings.cigoBuyBasis, pricing.cigoBuyBasis);
      pricing.cosigoUsdBasis = numberOr(settings.cosigoUsdBasis, pricing.cosigoUsdBasis);
      pricing.usdtUsdBasis = numberOr(settings.usdtUsdBasis, pricing.usdtUsdBasis);
      pricing.digitalExitFeeRate = numberOr(settings.digitalExitFeeRate, pricing.digitalExitFeeRate);
      pricing.physicalRedemptionFeeRate = numberOr(settings.physicalRedemptionFeeRate, pricing.physicalRedemptionFeeRate);
      pricing.version = numberOr(settings.version, pricing.version);
      pricing.updatedAt = settings.updatedAt || null;
    } catch (err) {
      console.error('Failed to load pricing settings', err);
    }

    updatePricingPolicyNote();
  }

  function getRouteFeePolicy(from, to) {
    const pricing = state.pricing;

    if (from === 'USDT' && to === 'COSIGO') {
      return { feeRate: 0, policyLabel: 'usdt to cosigo' };
    }
    if (from === 'COSIGO' && to === 'USDT') {
      return { feeRate: pricing.digitalExitFeeRate, policyLabel: 'cosigo to usdt' };
    }
    if (from === 'USDT' && to === 'CIGO') {
      return { feeRate: 0, policyLabel: 'usdt to cigo' };
    }
    if (from === 'CIGO' && to === 'USDT') {
      return { feeRate: 0, policyLabel: 'cigo to usdt' };
    }
    if (from === 'CIGO' && to === 'COSIGO') {
      return { feeRate: 0, policyLabel: 'cigo to cosigo' };
    }
    if (from === 'COSIGO' && to === 'CIGO') {
      return { feeRate: pricing.digitalExitFeeRate, policyLabel: 'cosigo to cigo' };
    }

    return { feeRate: 0, policyLabel: 'inactive' };
  }

  function getQuoteAdjustmentText(manualQuote) {
    if (!manualQuote) return '';

    const pricing = state.pricing;

    if (manualQuote.policyLabel === 'usdt to cosigo') {
      return 'COSIGO reference basis applied';
    }
    if (manualQuote.policyLabel === 'cosigo to usdt') {
      return `COSIGO exit fee applied (${formatPercent(pricing.digitalExitFeeRate)})`;
    }
    if (manualQuote.policyLabel === 'usdt to cigo') {
      return `CIGO buy basis premium applied (${formatPercent(pricing.cigoOutboundPremiumRate)})`;
    }
    if (manualQuote.policyLabel === 'cigo to usdt' || manualQuote.policyLabel === 'cigo to cosigo') {
      return `CIGO sell basis discount applied (${formatPercent(pricing.cigoInboundHaircutRate)})`;
    }
    if (manualQuote.policyLabel === 'cosigo to cigo') {
      return 'COSIGO exit fee and CIGO buy basis premium applied';
    }

    return `fee ${formatPercent(manualQuote.feeRate)}`;
  }

  function getManualQuote(from, to, amount) {
    if (!Number.isFinite(amount) || amount <= 0) return null;

    const pricing = state.pricing;
    const policy = getRouteFeePolicy(from, to);

    let grossUsdValue = 0;
    let feeUsdValue = 0;
    let netUsdValue = 0;
    let output = 0;

    if (from === 'USDT' && to === 'COSIGO') {
      grossUsdValue = amount;
      netUsdValue = grossUsdValue;
      output = netUsdValue / pricing.cosigoUsdBasis;
    } else if (from === 'COSIGO' && to === 'USDT') {
      grossUsdValue = amount * pricing.cosigoUsdBasis;
      feeUsdValue = grossUsdValue * pricing.digitalExitFeeRate;
      netUsdValue = grossUsdValue - feeUsdValue;
      output = netUsdValue;
    } else if (from === 'USDT' && to === 'CIGO') {
      grossUsdValue = amount;
      netUsdValue = grossUsdValue;
      output = netUsdValue / pricing.cigoBuyBasis;
    } else if (from === 'CIGO' && to === 'USDT') {
      grossUsdValue = amount * pricing.cigoSellBasis;
      netUsdValue = grossUsdValue;
      output = netUsdValue;
    } else if (from === 'CIGO' && to === 'COSIGO') {
      grossUsdValue = amount * pricing.cigoSellBasis;
      netUsdValue = grossUsdValue;
      output = netUsdValue / pricing.cosigoUsdBasis;
    } else if (from === 'COSIGO' && to === 'CIGO') {
      grossUsdValue = amount * pricing.cosigoUsdBasis;
      feeUsdValue = grossUsdValue * pricing.digitalExitFeeRate;
      netUsdValue = grossUsdValue - feeUsdValue;
      output = netUsdValue / pricing.cigoBuyBasis;
    } else {
      return null;
    }

    return {
      grossUsdValue,
      feeUsdValue,
      netUsdValue,
      output,
      feeRate: policy.feeRate,
      policyLabel: policy.policyLabel
    };
  }

  async function apiJson(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || `Request failed (${response.status})`);
    }

    return data;
  }

  function setSettlementState({ title, copy, steps = [], note = '', tone = '' }) {
    if (!els.settlementBox) return;

    els.settlementBox.hidden = false;
    els.settlementBox.className = 'settlement-box';

    if (tone) {
      els.settlementBox.classList.add(tone);
    }

    if (els.settlementTitle) {
      els.settlementTitle.textContent = title || 'Next step';
    }

    if (els.settlementCopy) {
      els.settlementCopy.innerHTML = copy || '';
    }

    if (els.settlementList) {
      if (steps.length) {
        els.settlementList.hidden = false;
        els.settlementList.innerHTML = steps.map((step) => `<li>${escapeHtml(step)}</li>`).join('');
      } else {
        els.settlementList.hidden = true;
        els.settlementList.innerHTML = '';
      }
    }

    if (els.settlementNote) {
      if (note) {
        els.settlementNote.hidden = false;
        els.settlementNote.innerHTML = note;
      } else {
        els.settlementNote.hidden = true;
        els.settlementNote.innerHTML = '';
      }
    }
  }

  function renderSettlementBox(request) {
    if (!els.settlementBox) return;

    if (!request || (!request.id && !request.isLocalDraft && !request.localDraftId)) {
      els.settlementBox.hidden = true;
      if (els.settlementList) {
        els.settlementList.hidden = true;
        els.settlementList.innerHTML = '';
      }
      if (els.settlementNote) {
        els.settlementNote.hidden = true;
        els.settlementNote.innerHTML = '';
      }
      return;
    }

    const fromAsset = request.fromAsset || request.from || '-';
    const toAsset = request.toAsset || request.to || '-';
    const inputAmount = request.inputAmount || '-';
    const outputAmount = request.outputAmount || '-';
    const routeText = `${formatAssetAmount(inputAmount, fromAsset)} ${fromAsset} → ${formatAssetAmount(outputAmount, toAsset)} ${toAsset}`;
    const statusText = request.status || 'draft';

    if (statusText === 'draft') {
      setSettlementState({
        title: 'Ready to send',
        copy: `Your request has been created on this device only. Review <strong>${escapeHtml(routeText)}</strong>, then click <strong>Send request</strong> when you are ready.`,
        steps: [
          'Confirm the route and amount.',
          'Click Send request.',
          'Return later to refresh status if needed.'
        ],
        note: '<strong>Not yet submitted:</strong> this request is still local and has not entered the review queue.'
      });
      return;
    }

    if (statusText === 'submitted') {
      setSettlementState({
        title: 'Waiting for review',
        copy: `Your request for <strong>${escapeHtml(routeText)}</strong> has been sent and is now pending review.`,
        steps: [
          'No payment action is required yet.',
          'Status refreshes automatically while this page is open. You can also use Refresh status.',
          'Wait until the status changes to Action required.'
        ],
        note: '<strong>Pending review:</strong> settlement instructions will appear here after approval.',
        tone: 'settlement-pending'
      });
      return;
    }

    if (statusText === 'reviewed') {
      const settlement = request.settlement || null;

      if (!settlement || !settlement.address) {
        setSettlementState({
          title: 'Action required',
          copy: `Your request for <strong>${escapeHtml(routeText)}</strong> has been reviewed, but the settlement details are not attached yet.`,
          steps: [
            'Do not send funds yet.',
            'Refresh status again shortly.',
            'Only proceed once the destination wallet and amount appear here.'
          ],
          note: `<strong>Important:</strong> this request is reviewed, but no settlement destination is available yet for reference <strong>${escapeHtml(request.id || request.localDraftId || '-')}</strong>.`,
          tone: 'settlement-action'
        });
        return;
      }

      const settlementAsset = settlement.asset || fromAsset;
      const settlementAmount = settlement.amount || inputAmount;
      const settlementNetwork = settlement.network || 'BNB Smart Chain';
      const settlementAddress = settlement.address || '';
      const settlementNote = settlement.note || '';

      setSettlementState({
        title: 'Action required',
        copy: `Send <strong>${formatAssetAmount(settlementAmount, settlementAsset)} ${escapeHtml(settlementAsset)}</strong> on <strong>${escapeHtml(settlementNetwork)}</strong> to the approved settlement address below.`,
        steps: [
          'Verify the wallet address carefully before sending.',
          `Send the exact approved amount of ${settlementAsset}.`,
          'Keep the transaction hash or payment proof.',
          'Refresh status after sending so you can track completion.'
        ],
        note:
          `<strong>Settlement address:</strong><br><code>${escapeHtml(settlementAddress)}</code>` +
          (settlementNote ? `<br><br><strong>Note:</strong> ${escapeHtml(settlementNote)}` : '') +
          `<br><br><strong>Reference:</strong> ${escapeHtml(request.id || request.localDraftId || '-')}`,
        tone: 'settlement-action'
      });
      return;
    }

    if (statusText === 'completed') {
      setSettlementState({
        title: 'Request completed',
        copy: `The request for <strong>${escapeHtml(routeText)}</strong> has been marked complete.`,
        steps: [
          'Review your wallet balances.',
          'Keep the request reference for your records.',
          'Create a new request if you want to start another conversion.'
        ],
        note: '<strong>Completed:</strong> the managed workflow for this request has been finished.',
        tone: 'settlement-complete'
      });
      return;
    }

    setSettlementState({
      title: 'Request status',
      copy: `Current status: <strong>${escapeHtml(statusText)}</strong>.`,
      note: 'Refresh status to check for updates.'
    });
  }

  function renderRequest(request) {
    if (!request || (!request.id && !request.isLocalDraft && !request.localDraftId)) {
      state.currentRequest = null;

      if (els.requestEmpty) els.requestEmpty.hidden = false;
      if (els.requestBody) els.requestBody.hidden = true;
      if (els.requestId) els.requestId.textContent = '-';
      if (els.requestRoute) els.requestRoute.textContent = '-';
      if (els.requestInput) els.requestInput.textContent = '-';
      if (els.requestOutput) els.requestOutput.textContent = '-';
      if (els.requestValue) els.requestValue.textContent = '-';
      if (els.requestStatus) els.requestStatus.textContent = getRequestStatusText('draft');

      applyRequestStatusStyle('');
      renderSettlementBox(null);

      if (els.requestPanel) els.requestPanel.hidden = true;
      return;
    }

    state.currentRequest = request;

    const fromAsset = request.fromAsset || request.from || '-';
    const toAsset = request.toAsset || request.to || '-';
    const inputAmount = request.inputAmount || '-';
    const outputAmount = request.outputAmount || '-';
    const basisValue = request.basisValue ?? request.valueUsd ?? 0;
    const statusText = request.status || 'draft';
    const displayId = request.id || request.localDraftId || '-';

    if (els.requestEmpty) els.requestEmpty.hidden = true;
    if (els.requestBody) els.requestBody.hidden = false;
    if (els.requestId) els.requestId.textContent = displayId;
    if (els.requestRoute) els.requestRoute.textContent = `${fromAsset} → ${toAsset}`;
    if (els.requestInput) els.requestInput.textContent = `${formatAssetAmount(inputAmount, fromAsset)} ${fromAsset}`;
    if (els.requestOutput) els.requestOutput.textContent = `${formatAssetAmount(outputAmount, toAsset)} ${toAsset}`;
    if (els.requestValue) els.requestValue.textContent = formatUsdAmount(basisValue);
    if (els.requestStatus) els.requestStatus.textContent = getRequestStatusText(statusText);

    applyRequestStatusStyle(statusText);
    renderSettlementBox(request);

    if (els.requestPanel) els.requestPanel.hidden = false;
  }

  function isServerTrackedOpenRequest(request) {
    return !!request?.id && (request.status === 'submitted' || request.status === 'reviewed');
  }

  async function autoRefreshCurrentRequest() {
    if (!isServerTrackedOpenRequest(state.currentRequest)) return;

    try {
      await refreshCurrentRequestFromServer();
    } catch (err) {
      console.warn('Auto refresh failed', err);
    }
  }

  function stopRequestAutoRefresh() {
    if (state.requestAutoRefreshTimer) {
      clearInterval(state.requestAutoRefreshTimer);
      state.requestAutoRefreshTimer = null;
    }
  }

  function startRequestAutoRefresh() {
    stopRequestAutoRefresh();

    if (!isServerTrackedOpenRequest(state.currentRequest)) return;

    state.requestAutoRefreshTimer = setInterval(() => {
      autoRefreshCurrentRequest();
    }, CONFIG.REQUEST_REFRESH_MS);
  }

  function syncRequestButtons() {
    const hasRequest = !!state.currentRequest;
    const canSend = hasRequest && state.currentRequest.status === 'draft';
    const canRefresh = hasRequest && !!state.currentRequest.id;
    const canCopy = hasRequest;
    const canClear = hasRequest;

    if (els.copyRequestBtn) {
      els.copyRequestBtn.hidden = !canCopy;
      els.copyRequestBtn.disabled = !canCopy;
    }
    if (els.clearRequestBtn) {
      els.clearRequestBtn.hidden = !canClear;
      els.clearRequestBtn.disabled = !canClear;
    }
    if (els.submitRequestBtn) {
      els.submitRequestBtn.hidden = !canSend;
      els.submitRequestBtn.disabled = !canSend;
    }
    if (els.refreshRequestBtn) {
      els.refreshRequestBtn.hidden = !canRefresh;
      els.refreshRequestBtn.disabled = !canRefresh;
    }
  }

  function saveRequest(request) {
    state.currentRequest = request || null;

    if (state.currentRequest?.isLocalDraft) {
      localStorage.setItem(CONFIG.STORAGE_KEY_CURRENT_REQUEST, JSON.stringify(state.currentRequest));
    } else if (state.currentRequest?.id) {
      localStorage.setItem(CONFIG.STORAGE_KEY_CURRENT_REQUEST, JSON.stringify({ id: state.currentRequest.id }));
    } else {
      localStorage.removeItem(CONFIG.STORAGE_KEY_CURRENT_REQUEST);
    }

    renderRequest(state.currentRequest);
    syncRequestButtons();
    startRequestAutoRefresh();
  }

  function clearRequest() {
    saveRequest(null);
  }

  function revealRequestPanel() {
    if (!els.requestPanel) return;

    els.requestPanel.hidden = false;
    els.requestPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });

    setTimeout(() => {
      if (els.submitRequestBtn && !els.submitRequestBtn.hidden && !els.submitRequestBtn.disabled) {
        els.submitRequestBtn.focus();
      }
    }, 250);
  }

  function createLocalDraftRequest({
    wallet,
    fromAsset,
    toAsset,
    inputAmount,
    outputAmount,
    basisValue,
    feeAmount,
    feeRate,
    pricingPolicy
  }) {
    const draft = {
      isLocalDraft: true,
      localDraftId: `draft_${Date.now().toString(36)}`,
      createdAt: new Date().toISOString(),
      wallet,
      fromAsset,
      toAsset,
      route: `${fromAsset} → ${toAsset}`,
      inputAmount,
      outputAmount,
      basisValue,
      feeAmount,
      feeRate,
      pricingPolicy,
      status: 'draft'
    };

    saveRequest(draft);
    return draft;
  }

  async function submitCurrentRequest() {
    if (!state.currentRequest) return null;

    if (state.currentRequest.isLocalDraft) {
      const createData = await apiJson(`${CONFIG.API_BASE}/requests/create`, {
        method: 'POST',
        body: JSON.stringify({
          wallet: state.currentRequest.wallet,
          fromAsset: state.currentRequest.fromAsset,
          toAsset: state.currentRequest.toAsset,
          inputAmount: String(state.currentRequest.inputAmount)
        })
      });

      const createdRequest = createData.request;
      const submittedData = await apiJson(
        `${CONFIG.API_BASE}/requests/${encodeURIComponent(createdRequest.id)}/status`,
        {
          method: 'POST',
          body: JSON.stringify({ status: 'submitted' })
        }
      );

      saveRequest(submittedData.request);
      return submittedData.request;
    }

    if (!state.currentRequest.id) return null;

    const data = await apiJson(
      `${CONFIG.API_BASE}/requests/${encodeURIComponent(state.currentRequest.id)}/status`,
      {
        method: 'POST',
        body: JSON.stringify({ status: 'submitted' })
      }
    );

    saveRequest(data.request);
    return data.request;
  }

  async function refreshCurrentRequestFromServer() {
    if (!state.currentRequest?.id) return null;

    const data = await apiJson(
      `${CONFIG.API_BASE}/requests/${encodeURIComponent(state.currentRequest.id)}`
    );

    saveRequest(data.request);
    return data.request;
  }

  async function loadSavedRequest() {
    try {
      const raw = localStorage.getItem(CONFIG.STORAGE_KEY_CURRENT_REQUEST);

      if (!raw) {
        saveRequest(null);
        return;
      }

      const saved = JSON.parse(raw);

      if (saved?.isLocalDraft) {
        saveRequest(saved);
        return;
      }

      if (!saved?.id) {
        saveRequest(null);
        return;
      }

      const data = await apiJson(`${CONFIG.API_BASE}/requests/${encodeURIComponent(saved.id)}`);
      saveRequest(data.request);
    } catch (err) {
      console.warn('Could not reload saved request', err);
      saveRequest(null);
    }
  }

  async function refreshWalletState(address) {
    const onBSC = await isBSC();

    if (!onBSC) {
      clearWalletSummary();
      updateRouteGuidance();
      setAppStatus('Wrong network. Switch to BNB Chain.');

      if (els.connectBtn) {
        els.connectBtn.textContent = CONFIG.CONNECT_BTN_WRONG_NETWORK;
      }
      return;
    }

    const bnb = await getBNBBalance(address);
    const cigo = await getCigoBalance(address);
    const usdt = await getUsdtBalance(address);

    updateRouteGuidance();
    updateWalletSummary(address, bnb, cigo, usdt);

    if (els.connectBtn) {
      els.connectBtn.textContent = CONFIG.CONNECT_BTN_READY;
    }

    setAppStatus(
      `Connected: ${address.slice(0, 6)}...${address.slice(-4)} | BNB: ${bnb.toFixed(4)} | CIGO: ${cigo.toFixed(2)} | USDT: ${usdt.toFixed(2)}`
    );
    setQuoteStatus('Ready for quote');
    await loadWalletLimitState(address);
  }

  if (els.refreshRequestBtn) {
    els.refreshRequestBtn.addEventListener('click', async () => {
      try {
        const request = await refreshCurrentRequestFromServer();
        setQuoteStatus(request ? `Request refreshed: ${request.id} (${request.status})` : 'No server-backed request to refresh.');
      } catch (err) {
        console.error(err);
        setQuoteStatus(`Refresh failed: ${err.message || err}`);
      }
    });
  }

  if (CONFIG.MARKET_ROUTE_ENABLED && els.buyCigoBtn) {
    els.buyCigoBtn.addEventListener('click', (e) => {
      e.preventDefault();
      window.open(
        'https://pancakeswap.finance/swap?chain=bsc&outputCurrency=0x3a38e963f524E0dDFB75dFa1752b4Cd1364F5560',
        '_blank'
      );
    });
  }

  if (els.connectBtn) {
    els.connectBtn.addEventListener('click', async () => {
      if (!window.ethereum) {
        alert('MetaMask not found');
        return;
      }

      try {
        state.walletSessionStarted = true;
        const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
        await ensureBSC();
        await refreshWalletState(accounts[0]);
      } catch (err) {
        state.walletSessionStarted = false;
        clearWalletSummary();
        updateRouteGuidance();
        console.error(err);
        setAppStatus(`Connection failed: ${err.message || err}`);
      }
    });
  }

  if (window.ethereum) {
    window.ethereum.on('accountsChanged', async (accounts) => {
      try {
        if (!state.walletSessionStarted) {
          clearWalletSummary();
          updateRouteGuidance();
          setAppStatus('Click Connect wallet to begin.');
          return;
        }

        if (!accounts || !accounts.length) {
          state.walletSessionStarted = false;
          clearWalletSummary();
          updateRouteGuidance();
          setAppStatus('Wallet disconnected');
          return;
        }

        await refreshWalletState(accounts[0]);
      } catch (err) {
        console.error(err);
        setAppStatus(`Wallet update failed: ${err.message || err}`);
      }
    });

    window.ethereum.on('chainChanged', async () => {
      try {
        if (!state.walletSessionStarted) {
          clearWalletSummary();
          updateRouteGuidance();
          setAppStatus('Click Connect wallet to begin.');
          return;
        }

        const accounts = await window.ethereum.request({ method: 'eth_accounts' });
        if (!accounts || !accounts.length) {
          state.walletSessionStarted = false;
          clearWalletSummary();
          updateRouteGuidance();
          setAppStatus('Wallet disconnected');
          return;
        }

        await ensureBSC();
        await refreshWalletState(accounts[0]);
      } catch (err) {
        console.error(err);
        setAppStatus(`Chain update failed: ${err.message || err}`);
      }
    });
  }

  if (els.addCigoTopBtn) {
    els.addCigoTopBtn.addEventListener('click', async () => {
      await addCigoToMetaMask();
    });
  }

  bindCopyButton(
    els.copyCigoContractTopBtn,
    () => els.cigoContractTop?.textContent?.trim() || '',
    'copy contract',
    'copied'
  );

  els.copyButtons.forEach((button) => {
    const idleText = button.textContent.trim() || 'copy';
    bindCopyButton(button, () => button.dataset.copy || '', idleText, 'copied');
  });

  if (els.quoteBtn) {
    els.quoteBtn.addEventListener('click', () => {
      const { from, to, amount, isValidAmount } = getSelectedRoute();

      if (!from || !to) {
        setQuoteStatus('Select both a from asset and a to asset.');
        return;
      }
      if (!isValidAmount) {
        setQuoteStatus('Enter a valid amount greater than zero.');
        return;
      }
      if (from === to) {
        setQuoteStatus('Choose two different assets.');
        return;
      }

      const manualQuote = getManualQuote(from, to, amount);
      if (!manualQuote) {
        setQuoteStatus('This route is not active in the current shell.');
        return;
      }

      const adjustmentText = getQuoteAdjustmentText(manualQuote);
      setQuoteStatus(
        `Quote (${manualQuote.policyLabel}): ${formatAssetAmount(amount, from)} ${from} ≈ ${formatAssetAmount(manualQuote.output, to)} ${to} | ${adjustmentText} | net value ≈ ${formatUsdAmount(manualQuote.netUsdValue)}`
      );
    });
  }

  if (els.swapBtn) {
    els.swapBtn.addEventListener('click', async () => {
      const { from, to, amount, isValidAmount } = getSelectedRoute();

      if (!from || !to) {
        setQuoteStatus('Select both a from asset and a to asset.');
        return;
      }
      if (!isValidAmount) {
        setQuoteStatus('Enter a valid amount greater than zero.');
        return;
      }
      if (from === to) {
        setQuoteStatus('Choose two different assets.');
        return;
      }
      if (!state.connectedAddress) {
        setQuoteStatus('Connect wallet first.');
        return;
      }

      const manualQuote = getManualQuote(from, to, amount);
      if (!manualQuote) {
        setQuoteStatus('This route is not active in the current shell.');
        return;
      }

      try {
        await assertUsdtWalletCap(from, amount);

        const request = createLocalDraftRequest({
          wallet: state.connectedAddress,
          fromAsset: from,
          toAsset: to,
          inputAmount: String(amount),
          outputAmount: String(manualQuote.output),
          basisValue: String(manualQuote.netUsdValue),
          feeAmount: String(manualQuote.feeUsdValue),
          feeRate: manualQuote.feeRate,
          pricingPolicy: manualQuote.policyLabel
        });

        revealRequestPanel();

        const prefix =
          (from === 'CIGO' && to === 'COSIGO') || (from === 'COSIGO' && to === 'CIGO')
            ? 'Direct internal conversion request created'
            : 'Internal conversion request created';

        setQuoteStatus(
          `${prefix}: ${request.id || request.localDraftId} | ${formatAssetAmount(amount, from)} ${from} ≈ ${formatAssetAmount(manualQuote.output, to)} ${to}`
        );
      } catch (err) {
        console.error(err);
        setQuoteStatus(`Conversion request failed: ${err.message || err}`);
      }
    });
  }

  if (els.submitRequestBtn) {
    els.submitRequestBtn.addEventListener('click', async () => {
      try {
        const request = await submitCurrentRequest();
        if (request) {
          setQuoteStatus(`Request submitted: ${request.id}`);
        }
      } catch (err) {
        console.error(err);
        setQuoteStatus(`Submit failed: ${err.message || err}`);
      }
    });
  }

  if (els.copyRequestBtn) {
    els.copyRequestBtn.addEventListener('click', async () => {
      if (!state.currentRequest) {
        setQuoteStatus('No conversion request to copy.');
        return;
      }

      const text = JSON.stringify(state.currentRequest, null, 2);
      const ok = await copyText(text);
      setQuoteStatus(ok ? 'Conversion request copied.' : 'Failed to copy conversion request.');
    });
  }

  if (els.clearRequestBtn) {
    els.clearRequestBtn.addEventListener('click', () => {
      clearRequest();
      setQuoteStatus('Conversion request cleared.');
    });
  }

  window.addEventListener('focus', () => {
    autoRefreshCurrentRequest().catch(console.error);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      autoRefreshCurrentRequest().catch(console.error);
    }
  });

  if (els.requestPanel) els.requestPanel.hidden = true;
  clearWalletSummary();
  updateRouteGuidance();
  syncRequestButtons();
  setAppStatus('Click Connect wallet to begin.');
  updateWalletLimitNote();

  loadPricingState();
  loadSavedRequest();
});