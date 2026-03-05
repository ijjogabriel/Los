/* ===== LOS CAMPEONES GYM — INVENTORY APP ===== */

// ===== STATE =====
let currentRole = 'staff';
let pinBuffer = '';
const PINS = { staff: '1234', admin: '9999' };

let items = [];
let history = [];
let charts = {};

let editingItemId = null;
let qtyItemId = null;
let deleteItemId = null;
let nlPendingResult = null;
let toastTimer = null;

// ===== FIREBASE / CLOUD SYNC =====
let db = null;

function getFirebaseConfig() {
  const raw = localStorage.getItem('lc_firebase_config');
  if (!raw || raw === 'skip') return null;
  try { return JSON.parse(raw); } catch(e) { return null; }
}

function showFirebaseSetup() {
  document.getElementById('firebase-setup-modal').style.display = 'flex';
}

function skipFirebaseSetup() {
  localStorage.setItem('lc_firebase_config', 'skip');
  document.getElementById('firebase-setup-modal').style.display = 'none';
}

function connectFirebase() {
  const raw = document.getElementById('fb-config-input').value.trim();
  const errEl = document.getElementById('fb-setup-error');
  errEl.textContent = '';
  let config;
  try {
    // Accept either bare JS object or JSON
    config = JSON.parse(raw);
  } catch(e) {
    errEl.textContent = 'Invalid JSON — make sure all keys are in "double quotes".';
    return;
  }
  if (!config.projectId || !config.apiKey) {
    errEl.textContent = 'Config looks incomplete. Make sure projectId and apiKey are present.';
    return;
  }
  localStorage.setItem('lc_firebase_config', JSON.stringify(config));
  document.getElementById('firebase-setup-modal').style.display = 'none';
  initFirebase(config);
  showToast('Firebase connected! Data will sync across devices.', 'success');
}

function initFirebase(config) {
  try {
    if (!firebase.apps.length) firebase.initializeApp(config);
    db = firebase.firestore();
    db.enablePersistence({ synchronizeTabs: true }).catch(() => {});
  } catch(e) {
    console.warn('Firebase init error:', e);
    db = null;
  }
}

function setupFirestoreListeners() {
  if (!db) return;

  db.collection('lc_items').onSnapshot(snap => {
    items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    localStorage.setItem('lc_items', JSON.stringify(items));
    // Seed only when Firestore confirmed empty (not from cache)
    if (items.length === 0 && !snap.metadata.fromCache) {
      seedDataIfEmpty();
      return; // seedDataIfEmpty will trigger re-render via Firestore writes
    }
    renderDashboard();
    renderInventory();
    populateHistoryItemFilter();
  }, err => console.warn('Items snapshot error:', err));

  db.collection('lc_history').orderBy('timestamp', 'desc').limit(1000).onSnapshot(snap => {
    history = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    localStorage.setItem('lc_history', JSON.stringify(history));
    renderHistory();
  }, err => console.warn('History snapshot error:', err));
}

// Firestore write helpers (fire-and-forget)
function fWriteItem(item) {
  if (!db) return;
  const { id, ...data } = item;
  db.collection('lc_items').doc(id).set(data).catch(console.error);
}

function fDeleteItem(id) {
  if (!db) return;
  db.collection('lc_items').doc(id).delete().catch(console.error);
}

function fWriteHistory(entry) {
  if (!db) return;
  const { id, ...data } = entry;
  db.collection('lc_history').doc(id).set(data).catch(console.error);
}

// On page load: check config and show setup if needed
(function checkFirebaseOnLoad() {
  const raw = localStorage.getItem('lc_firebase_config');
  if (!raw) {
    showFirebaseSetup();
  } else if (raw !== 'skip') {
    const config = getFirebaseConfig();
    if (config) initFirebase(config);
  }
})();

// ===== LOCAL STORAGE =====
function loadData() {
  try {
    items   = JSON.parse(localStorage.getItem('lc_items')   || '[]');
    history = JSON.parse(localStorage.getItem('lc_history') || '[]');
  } catch (e) {
    items = []; history = [];
  }
}

function saveData() {
  localStorage.setItem('lc_items',   JSON.stringify(items));
  localStorage.setItem('lc_history', JSON.stringify(history));
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// ===== PIN LOGIN =====
function selectRole(role) {
  currentRole = role;
  document.querySelectorAll('.role-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.role === role)
  );
  pinBuffer = '';
  updatePinDots();
  document.getElementById('pin-error').textContent = '';
}

function pinKey(digit) {
  if (pinBuffer.length >= 4) return;
  pinBuffer += digit;
  updatePinDots();
  if (pinBuffer.length === 4) setTimeout(pinSubmit, 100);
}

function pinClear() {
  pinBuffer = pinBuffer.slice(0, -1);
  updatePinDots();
}

function updatePinDots() {
  for (let i = 0; i < 4; i++) {
    document.getElementById('d' + i).classList.toggle('filled', i < pinBuffer.length);
  }
}

function pinSubmit() {
  if (pinBuffer === PINS[currentRole]) {
    document.getElementById('pin-screen').classList.remove('active');
    document.getElementById('app-screen').classList.add('active');
    document.getElementById('role-badge').textContent = currentRole;
    // Admin-only UI
    document.getElementById('admin-only-add').style.display =
      currentRole === 'admin' ? '' : 'none';
    initApp();
  } else {
    document.getElementById('pin-error').textContent = 'Incorrect PIN. Try again.';
    pinBuffer = '';
    updatePinDots();
    const card = document.querySelector('.pin-card');
    card.style.animation = 'shake 0.35s';
    setTimeout(() => { card.style.animation = ''; }, 400);
  }
}

// ===== APP INIT =====
function initApp() {
  checkOffline();
  window.addEventListener('online',  () => document.getElementById('offline-banner').classList.add('hidden'));
  window.addEventListener('offline', () => document.getElementById('offline-banner').classList.remove('hidden'));

  if (db) {
    // Firestore path — listeners drive all rendering
    setupFirestoreListeners();
  } else {
    // Offline / local-only path
    loadData();
    seedDataIfEmpty();
    renderDashboard();
    renderInventory();
    renderHistory();
    populateHistoryItemFilter();
  }
}

function checkOffline() {
  document.getElementById('offline-banner').classList.toggle('hidden', navigator.onLine);
}

function logout() {
  document.getElementById('app-screen').classList.remove('active');
  document.getElementById('pin-screen').classList.add('active');
  pinBuffer = '';
  updatePinDots();
  document.getElementById('pin-error').textContent = '';
  Object.values(charts).forEach(c => c && c.destroy && c.destroy());
  charts = {};
}

// ===== SEED DATA =====
function seedDataIfEmpty() {
  if (items.length > 0) return;
  const seed = [
    // Supplements & Snacks
    { name:'Reign Energy Drink',  category:'supplements', brand:'Reign',              flavor:'Watermelon',       type:'Energy Drink',    quantity:24, unit:'cans',    threshold:6,  cost:1.50,  sell:3.00,  supplier:'Costco',        supplierContact:'', notes:'' },
    { name:'Reign Energy Drink',  category:'supplements', brand:'Reign',              flavor:'Mango',            type:'Energy Drink',    quantity:18, unit:'cans',    threshold:6,  cost:1.50,  sell:3.00,  supplier:'Costco',        supplierContact:'', notes:'' },
    { name:'Reign Energy Drink',  category:'supplements', brand:'Reign',              flavor:'Melon Mania',      type:'Energy Drink',    quantity: 9, unit:'cans',    threshold:6,  cost:1.50,  sell:3.00,  supplier:'Costco',        supplierContact:'', notes:'' },
    { name:'Alani Nu Energy',     category:'supplements', brand:'Alani Nu',           flavor:'Cherry',           type:'Energy Drink',    quantity: 3, unit:'cans',    threshold:6,  cost:1.75,  sell:3.50,  supplier:'GNC Wholesale', supplierContact:'', notes:'' },
    { name:'Alani Nu Energy',     category:'supplements', brand:'Alani Nu',           flavor:'Cosmic Stardust',  type:'Energy Drink',    quantity: 0, unit:'cans',    threshold:6,  cost:1.75,  sell:3.50,  supplier:'GNC Wholesale', supplierContact:'', notes:'' },
    { name:'Alani Nu Energy',     category:'supplements', brand:'Alani Nu',           flavor:'Hawaiian Shaved Ice', type:'Energy Drink', quantity:12, unit:'cans',   threshold:6,  cost:1.75,  sell:3.50,  supplier:'GNC Wholesale', supplierContact:'', notes:'' },
    { name:'Protein Bar',         category:'supplements', brand:'Quest',              flavor:'Chocolate Chip',   type:'Protein Bar',     quantity:12, unit:'bars',    threshold:5,  cost:1.80,  sell:3.50,  supplier:'Amazon',        supplierContact:'', notes:'' },
    { name:'Protein Bar',         category:'supplements', brand:'Quest',              flavor:'Birthday Cake',    type:'Protein Bar',     quantity: 4, unit:'bars',    threshold:5,  cost:1.80,  sell:3.50,  supplier:'Amazon',        supplierContact:'', notes:'' },
    { name:'Pre-Workout',         category:'supplements', brand:'C4',                 flavor:'Fruit Punch',      type:'Pre-Workout',     quantity: 2, unit:'tubs',    threshold:2,  cost:18.00, sell:35.00, supplier:'GNC Wholesale', supplierContact:'', notes:'' },
    { name:'Creatine Monohydrate',category:'supplements', brand:'Optimum Nutrition',  flavor:'Unflavored',       type:'Creatine',        quantity: 8, unit:'tubs',    threshold:2,  cost:15.00, sell:28.00, supplier:'Amazon',        supplierContact:'', notes:'' },
    { name:'Whey Protein',        category:'supplements', brand:'Optimum Nutrition',  flavor:'Chocolate',        type:'Protein Powder',  quantity: 4, unit:'bags',    threshold:2,  cost:28.00, sell:55.00, supplier:'Amazon',        supplierContact:'', notes:'' },
    { name:'Whey Protein',        category:'supplements', brand:'Optimum Nutrition',  flavor:'Vanilla',          type:'Protein Powder',  quantity: 1, unit:'bags',    threshold:2,  cost:28.00, sell:55.00, supplier:'Amazon',        supplierContact:'', notes:'' },
    { name:'Amino Energy',        category:'supplements', brand:'Optimum Nutrition',  flavor:'Watermelon',       type:'Amino Acids',     quantity: 5, unit:'tubs',    threshold:2,  cost:14.00, sell:28.00, supplier:'Amazon',        supplierContact:'', notes:'' },
    // Cleaning Supplies
    { name:'Disinfectant Spray',  category:'cleaning',    brand:'Lysol',              flavor:'',                 type:'Spray',           quantity: 8, unit:'bottles', threshold:3,  cost:4.00,  sell:0,     supplier:'Costco',        supplierContact:'', notes:'' },
    { name:'Paper Towels',        category:'cleaning',    brand:'Bounty',             flavor:'',                 type:'Paper',           quantity: 2, unit:'rolls',   threshold:4,  cost:1.00,  sell:0,     supplier:'Costco',        supplierContact:'', notes:'' },
    { name:'Gym Wipes',           category:'cleaning',    brand:'EZ Wipes',           flavor:'',                 type:'Wipes',           quantity: 5, unit:'packs',   threshold:3,  cost:6.00,  sell:0,     supplier:'Amazon',        supplierContact:'', notes:'' },
    { name:'Hand Sanitizer',      category:'cleaning',    brand:'Purell',             flavor:'',                 type:'Sanitizer',       quantity: 6, unit:'bottles', threshold:3,  cost:3.50,  sell:0,     supplier:'Costco',        supplierContact:'', notes:'' },
    { name:'Trash Bags',          category:'cleaning',    brand:'Glad',               flavor:'',                 type:'Bags',            quantity: 1, unit:'boxes',   threshold:2,  cost:8.00,  sell:0,     supplier:'Costco',        supplierContact:'', notes:'' },
    // Office & Admin
    { name:'Member Forms',        category:'office',      brand:'',                   flavor:'',                 type:'Paper',           quantity:100, unit:'sheets', threshold:20, cost:0.05,  sell:0,     supplier:'Office Depot',  supplierContact:'', notes:'Waiver & intake forms' },
    { name:'Pens',                category:'office',      brand:'BIC',                flavor:'',                 type:'Writing',         quantity:15, unit:'pens',    threshold:5,  cost:0.30,  sell:0,     supplier:'Office Depot',  supplierContact:'', notes:'' },
    { name:'Printer Paper',       category:'office',      brand:'',                   flavor:'',                 type:'Paper',           quantity: 3, unit:'reams',   threshold:2,  cost:5.00,  sell:0,     supplier:'Office Depot',  supplierContact:'', notes:'' },
  ];
  seed.forEach(s => items.push({ ...s, id: genId(), createdAt: new Date().toISOString() }));

  // Seed some history
  const now = Date.now();
  const sampleHistory = [
    { action:'sale',    itemIdx:0,  qty:3,  note:'',            daysAgo:0 },
    { action:'sale',    itemIdx:1,  qty:6,  note:'',            daysAgo:0 },
    { action:'sale',    itemIdx:6,  qty:2,  note:'',            daysAgo:1 },
    { action:'restock', itemIdx:0,  qty:24, note:'Costco run',  daysAgo:2 },
    { action:'sale',    itemIdx:3,  qty:3,  note:'',            daysAgo:2 },
    { action:'sale',    itemIdx:4,  qty:5,  note:'',            daysAgo:3 },
    { action:'damaged', itemIdx:7,  qty:1,  note:'Expired bar', daysAgo:3 },
    { action:'sale',    itemIdx:1,  qty:4,  note:'',            daysAgo:4 },
    { action:'sale',    itemIdx:2,  qty:3,  note:'',            daysAgo:5 },
    { action:'restock', itemIdx:3,  qty:12, note:'',            daysAgo:6 },
    { action:'sale',    itemIdx:5,  qty:1,  note:'',            daysAgo:7 },
  ];
  sampleHistory.forEach(h => {
    const item = items[h.itemIdx];
    history.push({
      id: genId(),
      timestamp: new Date(now - h.daysAgo * 86400000 - Math.random() * 3600000).toISOString(),
      itemId: item.id,
      itemName: item.name + (item.flavor ? ' (' + item.flavor + ')' : ''),
      action: h.action,
      qty: h.qty,
      unit: item.unit,
      note: h.note,
      detail: '',
      role: 'staff',
    });
  });

  saveData();

  // Push seed data to Firestore if connected
  if (db) {
    items.forEach(item => fWriteItem(item));
    history.forEach(entry => fWriteHistory(entry));
  }
}

// ===== ITEM STATUS =====
function getStatus(item) {
  if (item.quantity === 0) return 'out';
  if (item.quantity <= item.threshold) return 'low';
  return 'ok';
}
function statusLabel(s) {
  return { ok: 'In Stock', low: 'Low Stock', out: 'Out of Stock' }[s];
}

// ===== NAVIGATION =====
function showTab(tab) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-tab, .bnav-tab').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === tab)
  );
  document.getElementById('tab-' + tab).classList.add('active');
  if (tab === 'reports') renderReports();
  if (tab === 'history') { populateHistoryItemFilter(); renderHistory(); }
}

// ===== DASHBOARD =====
function renderDashboard() {
  const total = items.length;
  const low   = items.filter(i => getStatus(i) === 'low').length;
  const out   = items.filter(i => getStatus(i) === 'out').length;
  const ok    = items.filter(i => getStatus(i) === 'ok').length;

  document.getElementById('sc-total').textContent = total;
  document.getElementById('sc-low').textContent   = low;
  document.getElementById('sc-out').textContent   = out;
  document.getElementById('sc-ok').textContent    = ok;

  const cats = [
    { key:'supplements', label:'Supplements & Snacks', icon:'💊' },
    { key:'cleaning',    label:'Cleaning Supplies',    icon:'🧹' },
    { key:'office',      label:'Office & Admin',       icon:'📋' },
  ];

  const container = document.getElementById('dashboard-categories');
  container.innerHTML = '';

  cats.forEach(cat => {
    const catItems = items.filter(i => i.category === cat.key);
    if (catItems.length === 0) return;
    const div = document.createElement('div');
    div.className = 'cat-group cat-' + cat.key;
    div.innerHTML = `
      <div class="cat-header">
        <span class="cat-icon">${cat.icon}</span>
        <span class="cat-name">${cat.label}</span>
        <span class="cat-count">${catItems.length} items</span>
      </div>
      <div class="cat-items-grid">
        ${catItems.map(item => itemCardHTML(item)).join('')}
      </div>`;
    container.appendChild(div);
  });
}

// ===== ITEM CARD HTML =====
function itemCardHTML(item) {
  const status = getStatus(item);
  const sc = status === 'ok' ? 'ok' : status === 'low' ? 'warning' : 'danger';
  const isAdmin = currentRole === 'admin';
  const brandFlavor = [item.brand, item.flavor].filter(Boolean).join(' — ');

  return `
    <div class="item-card" id="card-${item.id}">
      <div class="item-status-bar ${sc}"></div>
      ${item.type ? `<span class="item-type">${esc(item.type)}</span>` : ''}
      <div class="item-name">${esc(item.name)}</div>
      ${brandFlavor ? `<div class="item-brand">${esc(brandFlavor)}</div>` : ''}
      <div class="item-qty-row">
        <span class="item-qty ${sc}">${item.quantity}</span>
        <span class="item-unit">${esc(item.unit)}</span>
      </div>
      <div class="item-threshold">Threshold: ${item.threshold}</div>
      <span class="stock-badge ${sc}">${statusLabel(status)}</span>
      <div class="item-card-actions">
        <button class="btn-primary btn-sm" onclick="openQtyModal('${item.id}')">Update Qty</button>
        ${isAdmin ? `<button class="btn-ghost btn-sm" onclick="openItemModal('${item.id}')">Edit</button>` : ''}
        ${isAdmin ? `<button class="btn-ghost btn-sm" onclick="openDeleteModal('${item.id}')" style="color:var(--danger);border-color:var(--danger)">Delete</button>` : ''}
      </div>
    </div>`;
}

// ===== INVENTORY TAB =====
function renderInventory() {
  const search       = document.getElementById('inv-search').value.toLowerCase();
  const catFilter    = document.getElementById('inv-filter-cat').value;
  const brandFilter  = document.getElementById('inv-filter-brand').value;
  const statusFilter = document.getElementById('inv-filter-status').value;
  const sort         = document.getElementById('inv-sort').value;

  // Refresh brand filter options
  const brands = [...new Set(items.map(i => i.brand).filter(Boolean))].sort();
  const brandSel = document.getElementById('inv-filter-brand');
  const curBrand = brandSel.value;
  brandSel.innerHTML = '<option value="">All Brands</option>' +
    brands.map(b => `<option value="${esc(b)}" ${b === curBrand ? 'selected' : ''}>${esc(b)}</option>`).join('');

  let filtered = items.filter(item => {
    if (catFilter    && item.category !== catFilter) return false;
    if (brandFilter  && item.brand    !== brandFilter) return false;
    if (statusFilter && getStatus(item) !== statusFilter) return false;
    if (search) {
      const hay = [item.name, item.brand, item.flavor, item.type, item.notes].join(' ').toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });

  filtered.sort((a, b) => {
    if (sort === 'name')     return a.name.localeCompare(b.name);
    if (sort === 'category') return a.category.localeCompare(b.category);
    if (sort === 'quantity') return a.quantity - b.quantity;
    if (sort === 'status') {
      const o = { out:0, low:1, ok:2 };
      return o[getStatus(a)] - o[getStatus(b)];
    }
    return 0;
  });

  const container = document.getElementById('inventory-list');
  if (filtered.length === 0) {
    container.innerHTML = '<div class="inventory-empty"><span style="font-size:2rem">📦</span><p>No items match your filters</p></div>';
    return;
  }
  container.innerHTML = filtered.map(item => itemCardHTML(item)).join('');
}

// ===== HISTORY TAB =====
function populateHistoryItemFilter() {
  const sel = document.getElementById('hist-item');
  const cur = sel.value;
  const names = [...new Set(items.map(i => i.name))].sort();
  sel.innerHTML = '<option value="">All Items</option>' +
    names.map(n => `<option value="${esc(n)}" ${n === cur ? 'selected' : ''}>${esc(n)}</option>`).join('');
}

function getDateRange(rangeVal, fromId, toId) {
  const now = new Date();
  let from, to = new Date(now);
  to.setHours(23, 59, 59, 999);

  if (rangeVal === 'today') {
    from = new Date(now); from.setHours(0,0,0,0);
  } else if (rangeVal === 'week') {
    from = new Date(now); from.setDate(from.getDate() - 6); from.setHours(0,0,0,0);
  } else if (rangeVal === 'month') {
    from = new Date(now); from.setDate(from.getDate() - 29); from.setHours(0,0,0,0);
  } else if (rangeVal === 'all') {
    from = new Date('2000-01-01');
  } else if (rangeVal === 'custom') {
    const fv = document.getElementById(fromId).value;
    const tv = document.getElementById(toId).value;
    from = fv ? new Date(fv) : new Date('2000-01-01');
    to   = tv ? new Date(tv + 'T23:59:59') : to;
  }
  return { from, to };
}

function renderHistory() {
  const rangeVal     = document.getElementById('hist-range').value;
  const actionFilter = document.getElementById('hist-action').value;
  const itemFilter   = document.getElementById('hist-item').value;

  document.getElementById('hist-custom-range').classList.toggle('hidden', rangeVal !== 'custom');

  const { from, to } = getDateRange(rangeVal, 'hist-from', 'hist-to');

  let filtered = history.filter(h => {
    const d = new Date(h.timestamp);
    if (d < from || d > to) return false;
    if (actionFilter && h.action !== actionFilter) return false;
    if (itemFilter   && !h.itemName.startsWith(itemFilter)) return false;
    return true;
  });

  filtered.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  const container = document.getElementById('history-list');
  if (filtered.length === 0) {
    container.innerHTML = '<div class="history-empty"><span style="font-size:2rem">📋</span><p>No history for this period</p></div>';
    return;
  }

  container.innerHTML = filtered.map(h => {
    const qtyStr =
      h.action === 'sale'    ? `-${h.qty}` :
      h.action === 'restock' ? `+${h.qty}` :
      h.action === 'damaged' ? `-${h.qty}` :
      h.action === 'return'  ? `+${h.qty}` : '';

    return `
      <div class="hist-entry ${h.action}">
        <div class="hist-action-badge ${h.action}">${h.action}</div>
        <div class="hist-main">
          <div class="hist-item-name">${esc(h.itemName)}</div>
          <div class="hist-detail">${qtyStr ? esc(qtyStr) + ' ' + esc(h.unit || '') : ''}${h.detail ? ' — ' + esc(h.detail) : ''}</div>
          ${h.note ? `<div class="hist-note">${esc(h.note)}</div>` : ''}
        </div>
        <div class="hist-time">${fmtDate(new Date(h.timestamp))}<br>
          <span style="font-size:0.7rem;color:var(--text-light)">${esc(h.role || '')}</span>
        </div>
      </div>`;
  }).join('');
}

function fmtDate(d) {
  const diff = Date.now() - d;
  if (diff < 60000)    return 'Just now';
  if (diff < 3600000)  return Math.floor(diff / 60000) + 'm ago';
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
  return d.toLocaleDateString('en-US', { month:'short', day:'numeric' }) +
    ' ' + d.toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit' });
}

function addHistory(item, action, qty, note, detail) {
  const entry = {
    id: genId(),
    timestamp: new Date().toISOString(),
    itemId: item.id,
    itemName: item.name + (item.flavor ? ' (' + item.flavor + ')' : ''),
    action, qty,
    unit: item.unit,
    note: note || '',
    detail: detail || '',
    role: currentRole,
  };
  history.unshift(entry);
  if (history.length > 1000) history = history.slice(0, 1000);
  fWriteHistory(entry);
}

// ===== REPORTS TAB =====
function renderReports() {
  const rangeVal = document.getElementById('rep-range').value;
  document.getElementById('rep-custom-range').classList.toggle('hidden', rangeVal !== 'custom');

  const { from, to } = getDateRange(rangeVal, 'rep-from', 'rep-to');
  const ph = history.filter(h => { const d = new Date(h.timestamp); return d >= from && d <= to; });

  renderSalesTrend(ph, from, to);
  renderTopSellers(ph);
  renderCategoryBreakdown(ph);
  renderMarginsTable();
  renderLowStockReport();
  renderRestockSuggestions();
}

function renderSalesTrend(ph, from, to) {
  const sales = ph.filter(h => h.action === 'sale');
  const days = {};
  const cur = new Date(from);
  while (cur <= to) {
    days[cur.toLocaleDateString('en-US', { month:'short', day:'numeric' })] = 0;
    cur.setDate(cur.getDate() + 1);
  }
  sales.forEach(s => {
    const key = new Date(s.timestamp).toLocaleDateString('en-US', { month:'short', day:'numeric' });
    if (key in days) days[key] += (s.qty || 0);
  });

  const ctx = document.getElementById('chart-sales-trend').getContext('2d');
  if (charts.salesTrend) charts.salesTrend.destroy();
  charts.salesTrend = new Chart(ctx, {
    type: 'line',
    data: {
      labels: Object.keys(days),
      datasets: [{
        label: 'Units Sold',
        data: Object.values(days),
        borderColor: '#e53935',
        backgroundColor: 'rgba(229,57,53,0.08)',
        fill: true,
        tension: 0.35,
        pointRadius: 3,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
    },
  });
}

function renderTopSellers(ph) {
  const sales = ph.filter(h => h.action === 'sale');
  const counts = {};
  sales.forEach(s => { counts[s.itemName] = (counts[s.itemName] || 0) + (s.qty || 0); });
  const sorted = Object.entries(counts).sort((a,b) => b[1]-a[1]).slice(0, 8);

  const canvas = document.getElementById('chart-top-sellers');
  if (charts.topSellers) charts.topSellers.destroy();

  if (sorted.length === 0) {
    canvas.parentElement.innerHTML = '<h3>Top Sellers</h3><div style="text-align:center;padding:2rem;color:var(--text-muted)">No sales data for this period</div>';
    return;
  }

  charts.topSellers = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels: sorted.map(([n]) => n.length > 22 ? n.slice(0,22)+'…' : n),
      datasets: [{ label:'Units Sold', data: sorted.map(([,q]) => q), backgroundColor:'#e53935' }],
    },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { x: { beginAtZero: true, ticks: { precision: 0 } } },
    },
  });
}

function renderCategoryBreakdown(ph) {
  const sales = ph.filter(h => h.action === 'sale');
  const catQty = { supplements:0, cleaning:0, office:0 };
  sales.forEach(s => {
    const item = items.find(i => i.id === s.itemId);
    if (item) catQty[item.category] = (catQty[item.category] || 0) + (s.qty || 0);
  });

  const ctx = document.getElementById('chart-category').getContext('2d');
  if (charts.category) charts.category.destroy();
  charts.category = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Supplements & Snacks','Cleaning Supplies','Office & Admin'],
      datasets: [{
        data: [catQty.supplements, catQty.cleaning, catQty.office],
        backgroundColor: ['#7b1fa2','#0277bd','#2e7d32'],
        borderWidth: 2,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position:'bottom' } },
    },
  });
}

function renderMarginsTable() {
  const priced = items.filter(i => i.cost > 0 && i.sell > 0)
    .map(i => ({ item:i, margin: i.sell - i.cost, pct: ((i.sell - i.cost)/i.sell*100).toFixed(1) }))
    .sort((a,b) => b.pct - a.pct);

  const el = document.getElementById('margins-table');
  if (priced.length === 0) {
    el.innerHTML = '<div style="text-align:center;padding:1rem;color:var(--text-muted)">No pricing data available</div>';
    return;
  }
  el.innerHTML = `
    <div class="margins-table">
      <table>
        <thead><tr><th>Item</th><th>Cost</th><th>Sell</th><th>Margin $</th><th>Margin %</th></tr></thead>
        <tbody>${priced.map(r => `
          <tr>
            <td>${esc(r.item.name)}${r.item.flavor ? ` <span style="color:var(--text-muted);font-size:0.8em">(${esc(r.item.flavor)})</span>` : ''}</td>
            <td>$${r.item.cost.toFixed(2)}</td>
            <td>$${r.item.sell.toFixed(2)}</td>
            <td class="${r.margin > 0 ? 'margin-positive' : 'margin-zero'}">$${r.margin.toFixed(2)}</td>
            <td class="${r.margin > 0 ? 'margin-positive' : 'margin-zero'}">${r.pct}%</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

function renderLowStockReport() {
  const low = items.filter(i => getStatus(i) !== 'ok').sort((a,b) => a.quantity - b.quantity);
  const el = document.getElementById('low-stock-report');
  if (low.length === 0) {
    el.innerHTML = '<div style="text-align:center;padding:1rem;color:var(--success)">✓ All items well stocked</div>';
    return;
  }
  el.innerHTML = low.map(i => {
    const s = getStatus(i);
    return `
      <div class="low-stock-item">
        <div>
          <div style="font-weight:600">${esc(i.name)}${i.flavor ? ` <span style="color:var(--text-muted);font-size:0.8em">(${esc(i.flavor)})</span>` : ''}</div>
          ${i.brand ? `<div style="font-size:0.78rem;color:var(--text-muted)">${esc(i.brand)}</div>` : ''}
        </div>
        <span class="stock-badge ${s === 'out' ? 'danger' : 'warning'}">${i.quantity} ${esc(i.unit)}</span>
      </div>`;
  }).join('');
}

function renderRestockSuggestions() {
  const needs = items.filter(i => getStatus(i) !== 'ok');
  const el = document.getElementById('restock-suggestions');
  if (needs.length === 0) {
    el.innerHTML = '<div style="text-align:center;padding:1rem;color:var(--success)">✓ No restocking needed</div>';
    return;
  }
  el.innerHTML = needs.map(i => {
    const suggest = Math.max(i.threshold * 3, 12) - i.quantity;
    return `
      <div class="restock-item">
        <div>
          <div style="font-weight:600">${esc(i.name)}${i.flavor ? ` <span style="color:var(--text-muted);font-size:0.8em">(${esc(i.flavor)})</span>` : ''}</div>
          ${i.supplier ? `<div style="font-size:0.78rem;color:var(--text-muted)">from ${esc(i.supplier)}</div>` : ''}
        </div>
        <span class="restock-qty">+${suggest} ${esc(i.unit)}</span>
      </div>`;
  }).join('');
}

// ===== ITEM MODAL =====
function openItemModal(itemId) {
  editingItemId = itemId || null;
  document.getElementById('item-form').reset();

  if (itemId) {
    const item = items.find(i => i.id === itemId);
    if (!item) return;
    document.getElementById('modal-title').textContent    = 'Edit Item';
    document.getElementById('modal-save-btn').textContent = 'Save Changes';
    document.getElementById('f-name').value              = item.name;
    document.getElementById('f-category').value          = item.category;
    document.getElementById('f-brand').value             = item.brand || '';
    document.getElementById('f-flavor').value            = item.flavor || '';
    document.getElementById('f-type').value              = item.type || '';
    document.getElementById('f-quantity').value          = item.quantity;
    document.getElementById('f-unit').value              = item.unit;
    document.getElementById('f-threshold').value         = item.threshold;
    document.getElementById('f-cost').value              = item.cost || '';
    document.getElementById('f-sell').value              = item.sell || '';
    document.getElementById('f-supplier').value          = item.supplier || '';
    document.getElementById('f-supplier-contact').value  = item.supplierContact || '';
    document.getElementById('f-notes').value             = item.notes || '';
  } else {
    document.getElementById('modal-title').textContent    = 'Add Item';
    document.getElementById('modal-save-btn').textContent = 'Save Item';
  }

  document.getElementById('item-modal').classList.remove('hidden');
  document.getElementById('f-name').focus();
}

function closeItemModal() {
  document.getElementById('item-modal').classList.add('hidden');
  editingItemId = null;
}

function saveItem(e) {
  e.preventDefault();
  const itemData = {
    name:            document.getElementById('f-name').value.trim(),
    category:        document.getElementById('f-category').value,
    brand:           document.getElementById('f-brand').value.trim(),
    flavor:          document.getElementById('f-flavor').value.trim(),
    type:            document.getElementById('f-type').value.trim(),
    quantity:        parseInt(document.getElementById('f-quantity').value)    || 0,
    unit:            document.getElementById('f-unit').value.trim(),
    threshold:       parseInt(document.getElementById('f-threshold').value)   || 0,
    cost:            parseFloat(document.getElementById('f-cost').value)      || 0,
    sell:            parseFloat(document.getElementById('f-sell').value)      || 0,
    supplier:        document.getElementById('f-supplier').value.trim(),
    supplierContact: document.getElementById('f-supplier-contact').value.trim(),
    notes:           document.getElementById('f-notes').value.trim(),
  };

  if (editingItemId) {
    const idx = items.findIndex(i => i.id === editingItemId);
    items[idx] = { ...items[idx], ...itemData };
    addHistory(items[idx], 'edit', 0, '', 'Item details edited');
    fWriteItem(items[idx]);
    showToast('Item updated', 'success');
  } else {
    const newItem = { ...itemData, id: genId(), createdAt: new Date().toISOString() };
    items.push(newItem);
    addHistory(newItem, 'edit', 0, '', 'New item added');
    fWriteItem(newItem);
    showToast('Item added', 'success');
  }

  saveData();
  closeItemModal();
  renderDashboard();
  renderInventory();
  populateHistoryItemFilter();
}

// Close modal on outside click
function closeModalOutside(e) {
  if (e.target === e.currentTarget) {
    closeItemModal();
    closeQtyModal();
    closeDeleteModal();
  }
}

// ===== QTY MODAL =====
function openQtyModal(itemId) {
  qtyItemId = itemId;
  const item = items.find(i => i.id === itemId);
  if (!item) return;
  document.getElementById('qty-modal-title').textContent = item.name + (item.flavor ? ' — ' + item.flavor : '');
  document.getElementById('qty-action').value = 'sale';
  document.getElementById('qty-amount').value = 1;
  document.getElementById('qty-note').value   = '';
  document.getElementById('qty-modal').classList.remove('hidden');
  document.getElementById('qty-amount').focus();
}

function closeQtyModal() {
  document.getElementById('qty-modal').classList.add('hidden');
  qtyItemId = null;
}

function submitQtyUpdate() {
  const item   = items.find(i => i.id === qtyItemId);
  if (!item) return;
  const action = document.getElementById('qty-action').value;
  const qty    = parseInt(document.getElementById('qty-amount').value) || 0;
  const note   = document.getElementById('qty-note').value.trim();

  if (qty <= 0) { showToast('Enter a quantity greater than 0', 'error'); return; }

  const subtract = ['sale', 'damaged'].includes(action);
  if (subtract && item.quantity < qty) {
    showToast(`Not enough stock! Only ${item.quantity} ${item.unit} available.`, 'error');
    return;
  }

  item.quantity = subtract ? item.quantity - qty : item.quantity + qty;
  addHistory(item, action, qty, note, '');
  fWriteItem(item);
  saveData();
  closeQtyModal();
  renderDashboard();
  renderInventory();

  const status = getStatus(item);
  if (status === 'out')  showToast(`${item.name} is now OUT OF STOCK!`, 'warning');
  else if (status === 'low') showToast(`Updated — ${item.name} is running low`, 'warning');
  else showToast('Quantity updated', 'success');
}

// ===== DELETE MODAL =====
function openDeleteModal(itemId) {
  deleteItemId = itemId;
  const item = items.find(i => i.id === itemId);
  if (!item) return;
  document.getElementById('delete-modal-text').textContent =
    `Are you sure you want to delete "${item.name}${item.flavor ? ' (' + item.flavor + ')' : ''}"? This action cannot be undone.`;
  document.getElementById('delete-modal').classList.remove('hidden');
}

function closeDeleteModal() {
  document.getElementById('delete-modal').classList.add('hidden');
  deleteItemId = null;
}

function confirmDelete() {
  const item = items.find(i => i.id === deleteItemId);
  if (!item) return;
  items = items.filter(i => i.id !== deleteItemId);
  fDeleteItem(deleteItemId);
  saveData();
  closeDeleteModal();
  renderDashboard();
  renderInventory();
  populateHistoryItemFilter();
  showToast('Item deleted', 'success');
}

// ===== TOAST =====
function showToast(msg, type) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = 'toast' + (type ? ' ' + type : '');
  toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add('hidden'), 3200);
}

// ===== NATURAL LANGUAGE INPUT =====
function nlKeydown(e)        { if (e.key === 'Enter') nlSubmit(); }
function nlClarifyKeydown(e) { if (e.key === 'Enter') nlClarifySend(); }

function saveApiKey() {
  const key = document.getElementById('nl-api-key-input').value.trim();
  if (!key) return;
  localStorage.setItem('lc_apikey', key);
  document.getElementById('nl-api-key-prompt').classList.add('hidden');
  showToast('API key saved', 'success');
}

// Local NL parser — no API needed
function parseNLLocal(text) {
  const t = text.toLowerCase();

  let action = null;
  if (/\b(sold|sale|sell|rang up|bought by|purchased by)\b/.test(t))        action = 'sale';
  else if (/\b(restocked|restock|received|got in|added|delivered|stocked)\b/.test(t)) action = 'restock';
  else if (/\b(tossed|expired|damaged|broke|broken|disposed|wasted|trashed|expired|spoiled)\b/.test(t)) action = 'damaged';
  else if (/\b(return|returned|refund|gave back)\b/.test(t))                action = 'return';

  if (!action) return null;

  const qtyMatch = t.match(/\b(\d+)\b/);
  const qty = qtyMatch ? parseInt(qtyMatch[1]) : 1;

  // Score items by keyword overlap
  const words = t.split(/\W+/).filter(w => w.length >= 3);
  let best = null, bestScore = 0;
  items.forEach(item => {
    const hay = [item.name, item.brand, item.flavor, item.type].join(' ').toLowerCase();
    let score = 0;
    words.forEach(w => { if (hay.includes(w)) score++; });
    if (score > bestScore) { bestScore = score; best = item; }
  });

  if (!best || bestScore === 0) return { action, qty, item: null, ambiguous: true };
  return { action, qty, item: best, ambiguous: false };
}

function nlSubmit() {
  const input = document.getElementById('nl-input');
  const text  = input.value.trim();
  if (!text) return;

  const statusEl  = document.getElementById('nl-status');
  const clarifyEl = document.getElementById('nl-clarify');
  clarifyEl.classList.add('hidden');
  statusEl.className = 'nl-status loading';
  statusEl.classList.remove('hidden');
  statusEl.textContent = 'Parsing…';

  setTimeout(() => {
    const result = parseNLLocal(text);
    if (!result) {
      statusEl.className = 'nl-status error';
      statusEl.textContent = 'Could not understand. Try: "sold 3 watermelon Reign" or "restocked 24 mango Alani Nu"';
      return;
    }
    if (!result.item || result.ambiguous) {
      statusEl.classList.add('hidden');
      nlPendingResult = result;
      document.getElementById('nl-clarify-text').textContent =
        `Understood "${result.action}" × ${result.qty} — which item? Type part of the name:`;
      clarifyEl.classList.remove('hidden');
      document.getElementById('nl-clarify-input').value = '';
      document.getElementById('nl-clarify-input').focus();
      return;
    }
    applyNLResult(result, text);
  }, 150);
}

function nlClarifySend() {
  const text = document.getElementById('nl-clarify-input').value.trim();
  if (!text || !nlPendingResult) return;

  const lower   = text.toLowerCase();
  const matched = items.filter(i =>
    [i.name, i.brand, i.flavor, i.type].join(' ').toLowerCase().includes(lower)
  );

  if (matched.length === 0) {
    document.getElementById('nl-clarify-text').textContent = 'No item found. Try a different name:';
    return;
  }

  nlPendingResult.item = matched[0];
  applyNLResult(nlPendingResult, text);
  document.getElementById('nl-clarify').classList.add('hidden');
  nlPendingResult = null;
}

function nlClarifyCancel() {
  document.getElementById('nl-clarify').classList.add('hidden');
  document.getElementById('nl-status').classList.add('hidden');
  nlPendingResult = null;
}

function applyNLResult(result, originalText) {
  const { action, qty, item } = result;
  const subtract = ['sale','damaged'].includes(action);
  const statusEl = document.getElementById('nl-status');

  if (subtract && item.quantity < qty) {
    statusEl.className = 'nl-status error';
    statusEl.classList.remove('hidden');
    statusEl.textContent = `Not enough stock! Only ${item.quantity} ${item.unit} of ${item.name} available.`;
    return;
  }

  item.quantity = subtract ? item.quantity - qty : item.quantity + qty;
  addHistory(item, action, qty, originalText, '');
  fWriteItem(item);
  saveData();
  renderDashboard();
  renderInventory();

  statusEl.className = 'nl-status success';
  statusEl.classList.remove('hidden');
  const label = action === 'sale'    ? 'Sold'      :
                action === 'restock' ? 'Restocked' :
                action === 'damaged' ? 'Removed'   : 'Returned';
  statusEl.textContent =
    `✓ ${label} ${qty} ${item.unit} of ${item.name}${item.flavor ? ' (' + item.flavor + ')' : ''} — now ${item.quantity} remaining.`;

  document.getElementById('nl-input').value = '';

  const s = getStatus(item);
  if (s === 'out')  showToast(`${item.name} is now out of stock!`, 'warning');
  else if (s === 'low') showToast(`${item.name} is running low`, 'warning');
}

// ===== UTILS =====
function esc(str) {
  if (!str && str !== 0) return '';
  return String(str)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

// Inject shake animation keyframes
const shakeStyle = document.createElement('style');
shakeStyle.textContent = `
  @keyframes shake {
    0%,100% { transform:translateX(0); }
    20%     { transform:translateX(-10px); }
    40%     { transform:translateX(10px); }
    60%     { transform:translateX(-6px); }
    80%     { transform:translateX(6px); }
  }
`;
document.head.appendChild(shakeStyle);
