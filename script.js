const WORKER_URL = "https://devtrains.deviyl.workers.dev".replace(/\/+$/, "");

const CYCLE_DAYS = 9;
const PAYMENT_ITEM_ID = 366;
const PAYMENT_QTY = 5;
const REFRESH_COOLDOWN_MS = 60 * 1000;

const ITEM_NAMES = {
  366: "edvd",
};

const els = {
  heroProgress: document.getElementById("hero-progress"),
  heroDots: document.getElementById("hero-dots"),
  statTotalTrains: document.getElementById("stat-total-trains"),
  statDaysTrained: document.getElementById("stat-days-trained"),
  statCyclesEarned: document.getElementById("stat-cycles-earned"),
  statCyclesPaid: document.getElementById("stat-cycles-paid"),
  statOwed: document.getElementById("stat-owed"),
  trainsList: document.getElementById("trains-list"),
  trainsCountNote: document.getElementById("trains-count-note"),
  paymentsList: document.getElementById("payments-list"),
  paymentsCountNote: document.getElementById("payments-count-note"),
  refreshBtn: document.getElementById("refresh-btn"),
  refreshStatus: document.getElementById("refresh-status"),
};

let cooldownTimer = null;

init();

async function init() {
  els.refreshBtn.addEventListener("click", onRefreshClick);
  await loadData();
}

async function loadData() {
  try {
    const res = await fetch(`${WORKER_URL}/api/data`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    render(data);
  } catch (err) {
    els.trainsList.innerHTML = `<p class="empty-note">Couldn't load anything — try hitting refresh.</p>`;
    els.paymentsList.innerHTML = "";
    console.error(err);
  }
}

async function onRefreshClick() {
  setRefreshing(true);
  try {
    const res = await fetch(`${WORKER_URL}/api/refresh`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    render(data);

    if (data.refreshed === false && data.reason === "cooldown") {
      startCooldown(data.nextRefreshAt);
      els.refreshStatus.textContent = "Already refreshed this minute — showing what's cached.";
    } else if (data.refreshed) {
      const addedNote = data.changed ? "Found some new ones." : "Nothing new.";
      els.refreshStatus.textContent = `Refreshed. ${addedNote}`;
      startCooldown(Date.now() + REFRESH_COOLDOWN_MS);
    }
  } catch (err) {
    els.refreshStatus.textContent = `Refresh failed — ${err.message}`;
    console.error(err);
    setRefreshing(false);
  }
}

function setRefreshing(isRefreshing) {
  els.refreshBtn.disabled = isRefreshing;
  if (isRefreshing) els.refreshStatus.textContent = "Refreshing…";
}

function startCooldown(nextRefreshAt) {
  clearInterval(cooldownTimer);
  els.refreshBtn.disabled = true;

  const tick = () => {
    const msLeft = nextRefreshAt - Date.now();
    if (msLeft <= 0) {
      clearInterval(cooldownTimer);
      els.refreshBtn.disabled = false;
      els.refreshBtn.textContent = "Refresh";
      return;
    }
    const secLeft = Math.ceil(msLeft / 1000);
    els.refreshBtn.textContent = `Refresh (${secLeft}s)`;
  };

  cooldownTimer = setInterval(tick, 1000);
  tick();
}

function render(data) {
  const trains = data.logs?.trains || [];
  const payments = (data.logs?.payments || []).slice().sort((a, b) => b.timestamp - a.timestamp);

  const ledger = buildLedger(trains, payments);

  renderStandings(ledger);
  renderTrainsList(ledger);
  renderPaymentsList(ledger, payments);

  if (data.lastRefresh) {
    els.refreshStatus.textContent = `Last refreshed ${relativeTime(data.lastRefresh)}.`;
  }
}

function buildLedger(trains, payments) {
  const dayGroups = Object.entries(groupByUtcDate(trains.map((e) => e.timestamp)))
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  const daysTrained = dayGroups.length;
  const cyclesEarned = Math.floor(daysTrained / CYCLE_DAYS);
  const progressInCycle = daysTrained % CYCLE_DAYS;

  const cycles = [];
  for (let i = 0; i < cyclesEarned; i++) {
    cycles.push(dayGroups.slice(i * CYCLE_DAYS, (i + 1) * CYCLE_DAYS));
  }
  const unsettledDays = dayGroups.slice(cyclesEarned * CYCLE_DAYS);

  const item366Payments = payments
    .map((p) => ({
      entry: p,
      qty: (p.data?.items || [])
        .filter((i) => i.id === PAYMENT_ITEM_ID)
        .reduce((sum, i) => sum + (i.qty || 0), 0),
    }))
    .filter((p) => p.qty > 0)
    .sort((a, b) => a.entry.timestamp - b.entry.timestamp);

  const settledCyclesByPaymentId = new Map();
  let cycleIndex = 0;
  let carry = 0;

  for (const pmt of item366Payments) {
    let available = pmt.qty + carry;
    carry = 0;
    while (available >= PAYMENT_QTY && cycleIndex < cyclesEarned) {
      if (!settledCyclesByPaymentId.has(pmt.entry.id)) {
        settledCyclesByPaymentId.set(pmt.entry.id, []);
      }
      settledCyclesByPaymentId.get(pmt.entry.id).push(cycleIndex);
      cycleIndex++;
      available -= PAYMENT_QTY;
    }
    carry = available;
  }

  const settledCycleIndices = new Set(
    [...settledCyclesByPaymentId.values()].flat()
  );
  const cyclesPaid = settledCycleIndices.size;

  const unpaidDayGroups = [
    ...cycles.filter((_, idx) => !settledCycleIndices.has(idx)).flat(),
    ...unsettledDays,
  ];

  return {
    dayGroups,
    daysTrained,
    cyclesEarned,
    progressInCycle,
    cycles,
    cyclesPaid,
    unpaidDayGroups,
    settledCyclesByPaymentId,
  };
}

function renderStandings(ledger) {
  const owed = Math.max(0, ledger.cyclesEarned - ledger.cyclesPaid);

  els.heroProgress.textContent = `${ledger.progressInCycle} / ${CYCLE_DAYS}`;
  els.heroDots.innerHTML = "";
  for (let i = 0; i < CYCLE_DAYS; i++) {
    const dot = document.createElement("span");
    if (i < ledger.progressInCycle) dot.classList.add("filled");
    els.heroDots.appendChild(dot);
  }

  els.statTotalTrains.textContent = ledger.dayGroups.reduce((sum, d) => sum + d.count, 0);
  els.statDaysTrained.textContent = ledger.daysTrained;
  els.statCyclesEarned.textContent = ledger.cyclesEarned;
  els.statCyclesPaid.textContent = ledger.cyclesPaid;
  els.statOwed.textContent = owed > 0 ? `${owed * PAYMENT_QTY}x xanax` : "nothing yet";
}

function renderTrainsList(ledger) {
  const days = ledger.unpaidDayGroups.slice().sort((a, b) => (a.date < b.date ? 1 : -1));

  els.trainsCountNote.textContent = days.length ? `${days.length} unpaid days` : "";

  if (!days.length) {
    els.trainsList.innerHTML = `<p class="empty-note">Nothing owed right now — hit refresh to check for new ones.</p>`;
    return;
  }

  els.trainsList.innerHTML = days.map((d) => dayRow(d.date, d.count)).join("");
}

function renderPaymentsList(ledger, payments) {
  els.paymentsCountNote.textContent = payments.length ? `${payments.length} logged` : "";

  if (!payments.length) {
    els.paymentsList.innerHTML = `<p class="empty-note">Nothing sent yet.</p>`;
    return;
  }

  els.paymentsList.innerHTML = payments.map((e) => paymentRow(e, ledger)).join("");
}

function dayRow(date, count) {
  return `
    <div class="entry-row">
      <span class="entry-date">${date}</span>
      <span class="entry-sep">·</span>
      <span class="entry-detail">${count} train${count === 1 ? "" : "s"}</span>
    </div>`;
}

function paymentRow(entry, ledger) {
  const date = utcDateString(entry.timestamp);
  const items = (entry.data?.items || []).map((i) => describeItem(i)).join(", ");
  const isPaymentItem = (entry.data?.items || []).some((i) => i.id === PAYMENT_ITEM_ID);
  const detailClass = isPaymentItem ? " is-paid" : "";

  const cycleIndices = ledger.settledCyclesByPaymentId.get(entry.id);

  if (!cycleIndices || !cycleIndices.length) {
    return `
      <div class="entry-row">
        <span class="entry-date">${date}</span>
        <span class="entry-sep">·</span>
        <span class="entry-detail${detailClass}">${items}</span>
      </div>`;
  }

  const coveredDays = cycleIndices
    .flatMap((idx) => ledger.cycles[idx])
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  const subrows = coveredDays
    .map((d) => `
      <div class="entry-subrow">
        <span class="entry-date">${d.date}</span>
        <span class="entry-sep">·</span>
        <span class="entry-detail">${d.count} train${d.count === 1 ? "" : "s"}</span>
      </div>`)
    .join("");

  return `
    <details class="entry-row entry-row--expandable">
      <summary>
        <span class="entry-date">${date}</span>
        <span class="entry-sep">·</span>
        <span class="entry-detail${detailClass}">${items}</span>
      </summary>
      <div class="entry-subrows">${subrows}</div>
    </details>`;
}

function describeItem(item) {
  const name = ITEM_NAMES[item.id] || `item #${item.id}`;
  return `${item.qty}x ${name}`;
}

function utcDateString(unixSeconds) {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

function groupByUtcDate(timestamps) {
  const out = {};
  for (const ts of timestamps) {
    const d = utcDateString(ts);
    out[d] = (out[d] || 0) + 1;
  }
  return out;
}

function relativeTime(msTimestamp) {
  const diffSec = Math.round((Date.now() - msTimestamp) / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay}d ago`;
}
