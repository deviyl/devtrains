const WORKER_URL = "https://devtrains.deviyl.workers.dev";
const CYCLE_DAYS = 9;
const PAYMENT_ITEM_ID = 366;
const PAYMENT_QTY = 5;
const REFRESH_COOLDOWN_MS = 60 * 1000;

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
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    render(data);
  } catch (err) {
    els.trainsList.innerHTML = `<p class="empty-note">Couldn't reach the archive — try refreshing.</p>`;
    els.paymentsList.innerHTML = "";
    console.error(err);
  }
}

async function onRefreshClick() {
  setRefreshing(true);
  try {
    const res = await fetch(`${WORKER_URL}/api/refresh`, { method: "POST" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    render(data);

    if (data.refreshed === false && data.reason === "cooldown") {
      startCooldown(data.nextRefreshAt);
      els.refreshStatus.textContent = "Pulled from cache — refresh cools down once a minute.";
    } else if (data.refreshed) {
      const addedNote = data.changed ? "New entries found." : "No new entries.";
      els.refreshStatus.textContent = `Refreshed just now. ${addedNote}`;
      startCooldown(Date.now() + REFRESH_COOLDOWN_MS);
    }
  } catch (err) {
    els.refreshStatus.textContent = "Refresh failed — try again shortly.";
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
      return;
    }
    const secLeft = Math.ceil(msLeft / 1000);
    els.refreshBtn.textContent = `Refresh (${secLeft}s)`;
    if (secLeft <= 0) els.refreshBtn.textContent = "Refresh";
  };

  cooldownTimer = setInterval(tick, 1000);
  tick();

  // restore label once cooldown clears
  setTimeout(() => {
    els.refreshBtn.textContent = "Refresh";
  }, Math.max(0, nextRefreshAt - Date.now()) + 100);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function render(data) {
  const trains = (data.logs?.trains || []).slice().sort((a, b) => b.timestamp - a.timestamp);
  const payments = (data.logs?.payments || []).slice().sort((a, b) => b.timestamp - a.timestamp);

  renderStandings(trains, payments);
  renderTrainsList(trains);
  renderPaymentsList(payments);

  if (data.lastRefresh) {
    els.refreshStatus.textContent = `Last refreshed ${relativeTime(data.lastRefresh)}.`;
  }
}

function renderStandings(trains, payments) {
  const trainingDays = uniqueUtcDates(trains.map((e) => e.timestamp));
  const daysTrained = trainingDays.length;

  const cyclesEarned = Math.floor(daysTrained / CYCLE_DAYS);
  const progressInCycle = daysTrained % CYCLE_DAYS;

  const item366Qty = payments
    .flatMap((e) => e.data?.items || [])
    .filter((i) => i.id === PAYMENT_ITEM_ID)
    .reduce((sum, i) => sum + (i.qty || 0), 0);
  const cyclesPaid = Math.floor(item366Qty / PAYMENT_QTY);

  const owed = Math.max(0, cyclesEarned - cyclesPaid);

  els.heroProgress.textContent = `${progressInCycle} / ${CYCLE_DAYS}`;
  els.heroDots.innerHTML = "";
  for (let i = 0; i < CYCLE_DAYS; i++) {
    const dot = document.createElement("span");
    if (i < progressInCycle) dot.classList.add("filled");
    els.heroDots.appendChild(dot);
  }

  els.statTotalTrains.textContent = trains.length;
  els.statDaysTrained.textContent = daysTrained;
  els.statCyclesEarned.textContent = cyclesEarned;
  els.statCyclesPaid.textContent = cyclesPaid;
  els.statOwed.textContent =
    owed > 0 ? `${owed} × ${PAYMENT_QTY} (item #${PAYMENT_ITEM_ID})` : "Nothing due";
}

function renderTrainsList(trains) {
  els.trainsCountNote.textContent = trains.length ? `${trains.length} logged` : "";

  if (!trains.length) {
    els.trainsList.innerHTML = `<p class="empty-note">No trains archived yet — hit refresh.</p>`;
    return;
  }

  const byDay = groupByUtcDate(trains.map((e) => e.timestamp));
  const rows = Object.entries(byDay)
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .slice(0, 21)
    .map(
      ([date, count]) => `
      <div class="entry-row">
        <span class="entry-date">${date}</span>
        <span class="entry-fill"></span>
        <span class="entry-detail">${count} receive${count === 1 ? "" : "s"}</span>
      </div>`
    )
    .join("");

  els.trainsList.innerHTML = rows;
}

function renderPaymentsList(payments) {
  els.paymentsCountNote.textContent = payments.length ? `${payments.length} logged` : "";

  if (!payments.length) {
    els.paymentsList.innerHTML = `<p class="empty-note">No payments sent yet.</p>`;
    return;
  }

  const rows = payments
    .map((e) => {
      const date = utcDateString(e.timestamp);
      const items = (e.data?.items || [])
        .map((i) => `qty ${i.qty} · item #${i.id}`)
        .join(", ");
      const isPaymentItem = (e.data?.items || []).some((i) => i.id === PAYMENT_ITEM_ID);
      return `
      <div class="entry-row">
        <span class="entry-date">${date}</span>
        <span class="entry-fill"></span>
        <span class="entry-detail${isPaymentItem ? " is-paid" : ""}">${items}</span>
      </div>`;
    })
    .join("");

  els.paymentsList.innerHTML = rows;
}

// ---------------------------------------------------------------------------
// Small date helpers
// ---------------------------------------------------------------------------

function utcDateString(unixSeconds) {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

function uniqueUtcDates(timestamps) {
  return [...new Set(timestamps.map(utcDateString))];
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
