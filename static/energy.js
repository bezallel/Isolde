// energy.js (updated) ----------------------------------------------------

let dataGlobal = [];
let simMode = false;
let chart;
let batteryCap = 5; // max battery kWh

/* ------------------ Helpers: show/hide station list (defensive) ------------------ */
function hideStationList() {
  const el = document.querySelector('.station-list-card');
  if (!el) return;
  el.classList.add('hidden');
  el.style.display = 'none';
  el.style.height = '0px';
  el.style.padding = '0';
  el.style.margin = '0';
  el.style.overflow = 'hidden';
  el.setAttribute('aria-hidden', 'true');
}

function showStationList() {
  const el = document.querySelector('.station-list-card');
  if (!el) return;
  el.classList.remove('hidden');
  el.style.display = '';
  el.style.height = '';
  el.style.padding = '';
  el.style.margin = '';
  el.style.overflow = '';
  el.removeAttribute('aria-hidden');
}

// -------------------------
// FETCH ENERGY DATA
// -------------------------
async function fetchData() {
  const response = await fetch('/data');
  dataGlobal = await response.json();
  updatePrevPeak(dataGlobal);
  initChart(dataGlobal);
}

/* Compute and display previous peak usage */
function updatePrevPeak(data) {
  const peak = Math.max(...data.map(d => d.load_kW));
  document.getElementById('prevPeak').innerText = `${peak.toFixed(2)} kW`;
}

// -------------------------
// ENERGY CHART
// -------------------------
function initChart(data) {
  const ctx = document.getElementById('energyChart').getContext('2d');
  chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        { label: 'Original Load', data: [], borderColor: 'blue', fill: false },
        { label: 'Flexible Load', data: [], borderColor: 'orange', fill: false },
        { label: 'Served Load', data: [], borderColor: 'green', fill: false },
        { label: 'Battery SoC', data: [], borderColor: '#ffd600', fill: true, backgroundColor: 'rgba(255,214,0,0.2)', hidden: false },
        { label: 'Battery Supply', data: [], borderColor: '#ff8c00', borderDash: [5,5], fill: false, hidden: true }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 0 },
      scales: {
        y: { beginAtZero: true, ticks: { font: { size: 9 } } },
        x: { ticks: { font: { size: 9 } } }
      },
      plugins: {
        legend: { position: 'top', labels: { font: { size: 10 } } },
        tooltip: {
          enabled: true, mode: 'nearest', intersect: false,
          backgroundColor: 'rgba(0,0,0,0.85)', titleColor: '#fff', bodyColor: '#f0f0f0',
          titleFont: { size: 10 }, bodyFont: { size: 10 }
        }
      },
      hover: { mode: 'nearest', intersect: false }
    }
  });

  // ensure the station list is hidden at chart init (defensive)
  hideStationList();

  animateChart(data);
}

// -------------------------
// ANIMATE ENERGY CHART (VERY SLOW DISCHARGE WITH TOGGLE)
// -------------------------
function animateChart(data) {
  let i = 0;
  let batterySOC = 0;
  let chartSOC = 0;
  const batteryMax = batteryCap;
  const timestep_hours = 1.0;

  window.latestBatterySupply = 0;
  window.latestBatterySOC = batterySOC;

  chart.data.datasets[3].hidden = false;
  chart.data.datasets[4].hidden = true;

  const interval = setInterval(() => {
    if (i >= data.length) return clearInterval(interval);
    const point = data[i];

    chart.data.labels.push(point.Datetime);
    chart.data.datasets[0].data.push(point.load_kW || point.yhat || 0);
    chart.data.datasets[1].data.push(point.shifted_load_kW || point.trend || 0);
    chart.data.datasets[2].data.push(point.yhat || point.trend || point.load_kW || 0);

    if (!simMode) {
      // Normal Grid / Charging
      batterySOC = Math.min(batteryMax, batterySOC + 0.02);
      const smoothing = 0.1;
      chartSOC += (batterySOC - chartSOC) * smoothing;

      chart.data.datasets[2].data.push(point.served_kW || 0);
      chart.data.datasets[3].data.push(chartSOC);
      chart.data.datasets[4].data.push(0);
      chart.data.datasets[4].hidden = true;
      window.latestBatterySupply = 0;
    } else {
      // Island Mode / Discharging
      const demand_kWh = (Number(point.served_kW) || 0) * timestep_hours;
      const depletion_kWh = Math.min(batterySOC, demand_kWh * 0.05);
      batterySOC = Math.max(0, batterySOC - depletion_kWh);

      const batterySupply_kW = depletion_kWh / Math.max(timestep_hours, 1e-9);

      chart.data.datasets[3].data.push(batterySOC);
      chart.data.datasets[4].data.push(batterySupply_kW);
      chart.data.datasets[4].hidden = false;
      chart.data.datasets[2].data.push(0);

      window.latestBatterySupply = batterySupply_kW;
    }

    window.latestBatterySOC = batterySOC;
    document.getElementById('batterySOC').innerText = `${batterySOC.toFixed(3)} kWh`;
    updateBatteryVisual(batterySOC);

    const currentPeak = Math.max(...chart.data.datasets[0].data);
    document.getElementById('prevPeak').innerText = `${currentPeak.toFixed(2)} kW`;

    updateStationDistribution(window.latestBatterySupply, window.latestBatterySOC);

    chart.update();
    i++;
  }, 300);
}


// -------------------------
// SIMULATE ISLAND MODE
// -------------------------
document.getElementById('simulateBtn').addEventListener('click', async () => {
  const btn = document.getElementById('simulateBtn');
  const batteryInfoEl = document.querySelector('.battery-info');

  // make sure stationCard reference exists
  const stationCard = document.querySelector('.station-list-card');

  if (!simMode) {
    // Enter Island Mode
    simMode = true;
    document.body.classList.add('island');
    document.getElementById('mode').innerText = 'Island Mode';
    document.getElementById('mode').className = 'island';
    btn.innerText = 'End Outage';

    batteryInfoEl.style.transition = 'opacity 1s ease';
    batteryInfoEl.style.opacity = 0;

    setTimeout(() => {
      batteryInfoEl.innerHTML = `<span id="batteryPercent">${window.latestBatterySOC ? (window.latestBatterySOC / batteryCap * 100).toFixed(0) : 0}%</span> — depletion level`;
      batteryInfoEl.style.opacity = 1;
    }, 300);

    showStationList();

    const stormStart = '02:00';
    const stormEnd = '08:00';
    const response = await fetch(`/simulate?stormStart=${stormStart}&stormEnd=${stormEnd}&batteryCap=${batteryCap}&criticalLoad=40`);
    const simData = await response.json();

    chart.data.labels = [];
    chart.data.datasets.forEach(ds => ds.data = []);
    chart.update();

    updatePrevPeak(simData);

    let oldMsg = document.getElementById('simMessage');
    if (oldMsg) oldMsg.remove();
    let msg = document.createElement('div');
    msg.id = 'simMessage';
    msg.innerText = 'Island mode engaged! Battery now powers the critical load…';
    msg.style.color = 'white';
    msg.style.textAlign = 'center';
    msg.style.marginBottom = '0.5rem';
    document.querySelector('.chart-card').prepend(msg);

    animateChart(simData);
  } else {
    // Exit Island Mode
    simMode = false;
    document.body.classList.remove('island');
    document.getElementById('mode').innerText = 'Normal Grid';
    document.getElementById('mode').className = 'normal';
    btn.innerText = 'Trigger Outage';

    setTimeout(() => {
      hideStationList();
    }, 400); // smaller delay is fine

    chart.data.datasets.forEach(ds => ds.data = []);
    chart.data.labels = [];
    chart.update();

    batteryInfoEl.innerHTML = `<span id="batteryPercent">0%</span> — live charge status`;

    const oldMsg = document.getElementById('simMessage');
    if (oldMsg) oldMsg.remove();
  }
});

// -------------------------
// BATTERY VISUALIZATION (with tooltips)
// -------------------------
function ensureBatteryTooltips() {
  if (!document.getElementById('batteryTooltip')) {
    const chargeTip = document.createElement('div');
    chargeTip.id = 'batteryTooltip';
    chargeTip.className = 'battery-tooltip';
    chargeTip.innerHTML = '↑ Energy is being stored in the battery during off-peak hours for later use.';
    document.querySelector('.battery-visual-card').appendChild(chargeTip);
  }
  if (!document.getElementById('batteryDischargeTooltip')) {
    const dischargeTip = document.createElement('div');
    dischargeTip.id = 'batteryDischargeTooltip';
    dischargeTip.className = 'battery-tooltip discharge';
    dischargeTip.innerHTML = '↓ Stored energy is being distributed to stations to power buildings during the outage.';
    document.querySelector('.battery-visual-card').appendChild(dischargeTip);
  }
}
ensureBatteryTooltips();

/* ------------------------- BATTERY VISUAL UPDATE ------------------------- */
function updateBatteryVisual(batterySOC) {
  const percent = (batterySOC / batteryCap) * 100;
  const batteryLevelEl = document.getElementById('batteryLevel');
  const batteryPercentEl = document.getElementById('batteryPercent');
  const batteryInfoEl = document.querySelector('.battery-info');
  const chargeTooltip = document.getElementById('batteryTooltip');
  const dischargeTooltip = document.getElementById('batteryDischargeTooltip');

  batteryLevelEl.style.height = `${percent}%`;
  batteryPercentEl.innerText = `${percent.toFixed(0)}%`;

  if (simMode) {
    batteryInfoEl.innerHTML = `<span id="batteryPercent">${percent.toFixed(0)}%</span> — depletion level`;
    chargeTooltip.classList.remove('visible');
    dischargeTooltip.classList.add('visible');
  } else {
    dischargeTooltip.classList.remove('visible');

    if (percent >= 100) {
      batteryInfoEl.innerHTML = `<span id="batteryPercent">${percent.toFixed(0)}%</span> — fully charged`;
      chargeTooltip.classList.remove('visible');
    } else if (percent > 0) {
      batteryInfoEl.innerHTML = `<span id="batteryPercent">${percent.toFixed(0)}%</span> — power storing`;
      chargeTooltip.classList.add('visible');
    } else {
      batteryInfoEl.innerHTML = `<span id="batteryPercent">${percent.toFixed(0)}%</span> — live charge status`;
      chargeTooltip.classList.remove('visible');
    }
  }
}


// -------------------------
// STATION LIST
// -------------------------
let stations = [];
let displayedStations = [];

async function loadStations() {
  try {
    const response = await fetch('/stations');
    stations = await response.json();

    displayedStations = stations.slice(0, 8).map((s, idx) => ({
      idx,
      name: (s['station name'] || s['station_name'] || `Station ${idx+1}`).toLowerCase(),
      allocated_kW: 0,
      _el: null, _amtEl: null, _fillEl: null, _pctEl: null
    }));

    renderStationList();
    // ensure hidden after stations render
    hideStationList();
  } catch (err) {
    console.error('Failed to load stations:', err);
  }
}

function renderStationList() {
  const ul = document.getElementById('stationDistribution');
  ul.innerHTML = '';
  for (const st of displayedStations) {
    const li = document.createElement('li');
    li.className = 'station-item';
    li.id = `station-${st.idx}`;

    const meta = document.createElement('div');
    meta.className = 'station-meta';
    const name = document.createElement('div');
    name.className = 'station-name';
    name.innerText = st.name;
    meta.appendChild(name);

    const progressWrap = document.createElement('div');
    progressWrap.className = 'progress-wrap';
    const progressBar = document.createElement('div');
    progressBar.className = 'progress-bar';
    const fill = document.createElement('div');
    fill.className = 'progress-fill';
    progressBar.appendChild(fill);
    const pct = document.createElement('div');
    pct.className = 'station-percent';
    pct.innerText = '0%';
    progressWrap.appendChild(progressBar);
    progressWrap.appendChild(pct);

    li.appendChild(meta);
    li.appendChild(progressWrap);
    ul.appendChild(li);

    st._el = li; st._fillEl = fill; st._pctEl = pct; st._amtEl = name;
  }
}

function updateStationDistribution(totalSupply, currentSOC) {
  if (!displayedStations || displayedStations.length === 0) return;

  if (!simMode || totalSupply <= 0) {
    displayedStations.forEach(st => {
      st.allocated_kW *= 0.6;
      refreshStationElement(st, totalSupply);
    });
    return;
  }

  const n = displayedStations.length;
  const baseShare = totalSupply / n;
  displayedStations.forEach((st, idx) => {
    const target = baseShare * (1 + 0.1 * (n - 1 - idx) / (n - 1 || 1));
    st.allocated_kW = st.allocated_kW * 0.45 + target * 0.55;
    refreshStationElement(st, totalSupply);
  });
}

function refreshStationElement(st, totalSupply) {
  const allocated = st.allocated_kW || 0;
  const pct = totalSupply > 0 ? Math.min(100, (allocated / totalSupply) * 100) : 0;
  if (st._fillEl) st._fillEl.style.width = `${pct}%`;
  if (st._pctEl) st._pctEl.innerText = `${pct.toFixed(0)}%`;
  if (allocated > 0.05) st._el.classList.add('supplying');
  else st._el.classList.remove('supplying');
}

/* ------------------------- INITIALIZE ------------------------- */
document.addEventListener('DOMContentLoaded', () => {
  // Start fetching data & stations after DOM ready
  fetchData();
  loadStations();
});





// const legendTooltip = document.getElementById('legendTooltip');
// document.querySelectorAll('#chartLegend .legend-item').forEach(item => {
//   item.addEventListener('mouseenter', e => {
//     const desc = e.currentTarget.dataset.desc;
//     legendTooltip.innerText = desc;
//     const rect = e.currentTarget.getBoundingClientRect();
//     legendTooltip.style.top = rect.bottom + 6 + 'px';
//     legendTooltip.style.left = rect.left + 'px';
//     legendTooltip.style.opacity = 1;
//     legendTooltip.style.transform = 'translateY(0)';
//   });
//   item.addEventListener('mouseleave', () => {
//     legendTooltip.style.opacity = 0;
//     legendTooltip.style.transform = 'translateY(-4px)';
//   });
// });



const legendExplanation = document.getElementById('legendExplanation');
const legendItems = document.querySelectorAll('#chartLegend .legend-item');

legendItems.forEach(item => {
  item.addEventListener('mouseenter', () => {
    legendExplanation.innerText = item.dataset.desc;
    legendExplanation.classList.remove('initial'); // remove initial glow
    legendExplanation.style.color = '#00c8ff';     // hover color
  });
  item.addEventListener('mouseleave', () => {
    legendExplanation.innerText = 'Hover a legend to see what it means…';
    legendExplanation.classList.add('initial');   // restore initial glow
  });
});


// Optional: integrate with chart animation to show the active dataset dynamically
function updateLegendExplanation() {
  const datasets = chart.data.datasets;
  let activeDesc = '';
  datasets.forEach((ds, idx) => {
    const lastVal = ds.data[ds.data.length - 1] || 0;
    if (lastVal > 0 && ds.label) {
      activeDesc = document.querySelector(`#chartLegend .legend-item[data-dataset="${idx}"]`).dataset.desc;
    }
  });
  legendExplanation.innerText = activeDesc || 'Hover a legend to see what it means…';
}

