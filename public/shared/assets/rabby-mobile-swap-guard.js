(function () {
  "use strict";

  const TARGETS = [
    "#cleanStatus",
    "#quoteStatusField",
    "#liquidityStatus",
    "#walletBalanceMount"
  ];

  function compact(text) {
    const raw = String(text || "");

    return raw
      .replace(/0x[a-fA-F0-9]{64}/g, function (tx) {
        return tx.slice(0, 10) + "…" + tx.slice(-8);
      })
      .replace(/0x[a-fA-F0-9]{40}/g, function (addr) {
        return addr.slice(0, 8) + "…" + addr.slice(-6);
      })
      .replace(/\s+/g, " ")
      .trim();
  }

  function guard(el) {
    if (!el || el.dataset.rabbyGuardBusy === "1") return;

    const raw = el.textContent || "";
    if (!raw) return;

    const shortText = compact(raw);

    el.dataset.rabbyGuardBusy = "1";
    el.dataset.fullStatus = raw;
    el.setAttribute("title", raw);
    el.style.overflowWrap = "anywhere";
    el.style.wordBreak = "break-word";
    el.style.maxWidth = "100%";

    if (shortText !== raw) {
      el.textContent = shortText + "  Tap for full details.";
    }

    el.dataset.rabbyGuardBusy = "0";
  }

  function scan() {
    TARGETS.forEach(function (sel) {
      document.querySelectorAll(sel).forEach(guard);
    });
  }

  document.addEventListener("click", function (ev) {
    const el = ev.target.closest(TARGETS.join(","));
    if (!el || !el.dataset.fullStatus) return;

    if (el.dataset.expandedStatus === "1") {
      el.dataset.expandedStatus = "0";
      el.textContent = compact(el.dataset.fullStatus) + "  Tap for full details.";
    } else {
      el.dataset.expandedStatus = "1";
      el.textContent = el.dataset.fullStatus;
    }
  });

  const obs = new MutationObserver(scan);

  function start() {
    scan();
    obs.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
