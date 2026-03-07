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
      seedInventory();
      return; // seedInventory will trigger re-render via Firestore writes
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

  runMigrations();

  if (db) {
    // Firestore path — listeners drive all rendering
    setupFirestoreListeners();
  } else {
    // Offline / local-only path
    loadData();
    seedInventory();
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

// ===== MIGRATIONS =====
function runMigrations() {
  // v1: rename Savage → Thavage in existing saved items
  if (!localStorage.getItem('lcg_migration_v1')) {
    const saved = localStorage.getItem('lc_items');
    if (saved) {
      const fixed = saved.replace(/Savage/g, 'Thavage');
      localStorage.setItem('lc_items', fixed);
    }
    // Fix in Firestore too
    if (db) {
      db.collection('lc_items')
        .where('brand', '==', 'Savage')
        .get()
        .then(snap => {
          snap.forEach(doc => {
            const d = doc.data();
            db.collection('lc_items').doc(doc.id).update({
              brand: 'Thavage',
              name: d.name ? d.name.replace(/Savage/g, 'Thavage') : d.name,
            });
          });
        }).catch(() => {});
    }
    localStorage.setItem('lcg_migration_v1', '1');
  }
}

// ===== SEED DATA =====
function normalizeCat(c) {
  if (!c) return 'supplements';
  const l = c.toLowerCase();
  if (l.includes('clean')) return 'cleaning';
  if (l.includes('office') || l.includes('admin')) return 'office';
  return 'supplements';
}

function seedInventory() {
  // Never re-seed if already seeded on this device
  if (localStorage.getItem('lcg_seeded')) return;

  const ts = Date.now();
  const rawSeed = [
    { "name": "Pandemic Pre-Workout - Blue Raz Lemonade", "brand": "Pandemic", "flavor": "Blue Raz Lemonade", "category": "Supplements & Snacks", "quantity": 24, "unit": "bottle", "lowStockThreshold": 12, "notes": "2 full boxes of 12 - shelf" },
    { "name": "Pandemic Pre-Workout - Dragon Fruit Watermelon", "brand": "Pandemic", "flavor": "Dragon Fruit Watermelon", "category": "Supplements & Snacks", "quantity": 18, "unit": "bottle", "lowStockThreshold": 12, "notes": "1 full box + 6 in open box - shelf" },
    { "name": "KXR Pre-Workout - Blue Shark Gummy", "brand": "KXR", "flavor": "Blue Shark Gummy", "category": "Supplements & Snacks", "quantity": 12, "unit": "bottle", "lowStockThreshold": 6, "notes": "Full box - shelf" },
    { "name": "Christopher's Juicy Pumps", "brand": "Christopher's", "flavor": "Juicy Pumps", "category": "Supplements & Snacks", "quantity": 17, "unit": "bottle", "lowStockThreshold": 6, "notes": "1 unopened box of 12 + 5 in open box - shelf" },
    { "name": "Thavage Pre-Workout - Berry Blast", "brand": "Thavage", "flavor": "Berry Blast", "category": "Supplements & Snacks", "quantity": 12, "unit": "bottle", "lowStockThreshold": 6, "notes": "Full box - shelf" },
    { "name": "Thavage Pre-Workout - Champion Mentality", "brand": "Thavage", "flavor": "Champion Mentality", "category": "Supplements & Snacks", "quantity": 12, "unit": "bottle", "lowStockThreshold": 6, "notes": "Full box - shelf" },
    { "name": "Thavage Pre-Workout - Blue Raspberry", "brand": "Thavage", "flavor": "Blue Raspberry", "category": "Supplements & Snacks", "quantity": 12, "unit": "bottle", "lowStockThreshold": 6, "notes": "Full box - shelf" },
    { "name": "Thavage Pre-Workout - Rocket Pop", "brand": "Thavage", "flavor": "Rocket Pop", "category": "Supplements & Snacks", "quantity": 12, "unit": "bottle", "lowStockThreshold": 6, "notes": "Full box - shelf" },
    { "name": "Thavage Pre-Workout - South Beach Slush", "brand": "Thavage", "flavor": "South Beach Slush", "category": "Supplements & Snacks", "quantity": 24, "unit": "bottle", "lowStockThreshold": 12, "notes": "2 boxes - shelf" },
    { "name": "Thavage Pre-Workout - Strawberry Mango", "brand": "Thavage", "flavor": "Strawberry Mango", "category": "Supplements & Snacks", "quantity": 12, "unit": "bottle", "lowStockThreshold": 6, "notes": "1 box - shelf" },
    { "name": "Ghost Energy - Electric Limeade", "brand": "Ghost", "flavor": "Electric Limeade", "category": "Supplements & Snacks", "quantity": 8, "unit": "can", "lowStockThreshold": 4, "notes": "Shelf" },
    { "name": "Ghost Energy - Sour Pink Lemonade", "brand": "Ghost", "flavor": "Sour Pink Lemonade", "category": "Supplements & Snacks", "quantity": 8, "unit": "can", "lowStockThreshold": 4, "notes": "Shelf" },
    { "name": "Ghost Energy - Cherry Limeade", "brand": "Ghost", "flavor": "Cherry Limeade", "category": "Supplements & Snacks", "quantity": 9, "unit": "can", "lowStockThreshold": 4, "notes": "Shelf" },
    { "name": "Ghost Energy - Grape Freeze", "brand": "Ghost", "flavor": "Grape Freeze", "category": "Supplements & Snacks", "quantity": 12, "unit": "can", "lowStockThreshold": 4, "notes": "Shelf" },
    { "name": "Ghost Energy - Swedish Fish", "brand": "Ghost", "flavor": "Swedish Fish", "category": "Supplements & Snacks", "quantity": 12, "unit": "can", "lowStockThreshold": 4, "notes": "Shelf" },
    { "name": "Ghost Energy - Cran Grape", "brand": "Ghost", "flavor": "Cran Grape", "category": "Supplements & Snacks", "quantity": 8, "unit": "can", "lowStockThreshold": 4, "notes": "Shelf" },
    { "name": "Ghost Energy - Strawberry Mango", "brand": "Ghost", "flavor": "Strawberry Mango", "category": "Supplements & Snacks", "quantity": 12, "unit": "can", "lowStockThreshold": 4, "notes": "Shelf" },
    { "name": "Bum Energy - Dr. Bum", "brand": "Dr. Bum", "flavor": "Dr. Bum", "category": "Supplements & Snacks", "quantity": 12, "unit": "can", "lowStockThreshold": 6, "notes": "Shelf" },
    { "name": "Bum Energy - Cola", "brand": "Dr. Bum", "flavor": "Cola", "category": "Supplements & Snacks", "quantity": 11, "unit": "can", "lowStockThreshold": 6, "notes": "Shelf" },
    { "name": "Bum Energy - Orange Sunrise", "brand": "Dr. Bum", "flavor": "Orange Sunrise", "category": "Supplements & Snacks", "quantity": 10, "unit": "can", "lowStockThreshold": 6, "notes": "Shelf" },
    { "name": "Celsius - Arctic Vibe", "brand": "Celsius", "flavor": "Arctic Vibe", "category": "Supplements & Snacks", "quantity": 6, "unit": "can", "lowStockThreshold": 4, "notes": "Shelf" },
    { "name": "Celsius - Sparkling Mango Lemonade", "brand": "Celsius", "flavor": "Sparkling Mango Lemonade", "category": "Supplements & Snacks", "quantity": 12, "unit": "can", "lowStockThreshold": 6, "notes": "Shelf" },
    { "name": "Celsius - Retro Vibe", "brand": "Celsius", "flavor": "Retro Vibe", "category": "Supplements & Snacks", "quantity": 12, "unit": "can", "lowStockThreshold": 6, "notes": "Shelf" },
    { "name": "Celsius - Sparkling Kiwi Strawberry", "brand": "Celsius", "flavor": "Sparkling Kiwi Strawberry", "category": "Supplements & Snacks", "quantity": 9, "unit": "can", "lowStockThreshold": 4, "notes": "Shelf" },
    { "name": "Celsius - Sparkling Fuji Apple Pear", "brand": "Celsius", "flavor": "Sparkling Fuji Apple Pear", "category": "Supplements & Snacks", "quantity": 12, "unit": "can", "lowStockThreshold": 6, "notes": "Shelf" },
    { "name": "Celsius - Tropical Vibe", "brand": "Celsius", "flavor": "Tropical Vibe", "category": "Supplements & Snacks", "quantity": 9, "unit": "can", "lowStockThreshold": 4, "notes": "Shelf" },
    { "name": "Core Power Protein Shake - 42g", "brand": "Core Power", "flavor": "42g Protein", "category": "Supplements & Snacks", "quantity": 90, "unit": "bottle", "lowStockThreshold": 20, "notes": "9 packs of 10 - shelf" },
    { "name": "LMNT Electrolytes - Orange Salt", "brand": "LMNT", "flavor": "Orange Salt", "category": "Supplements & Snacks", "quantity": 12, "unit": "packet", "lowStockThreshold": 6, "notes": "Shelf" },
    { "name": "LMNT Electrolytes - Lemonade Salt", "brand": "LMNT", "flavor": "Lemonade Salt", "category": "Supplements & Snacks", "quantity": 12, "unit": "packet", "lowStockThreshold": 6, "notes": "Shelf" },
    { "name": "LMNT Electrolytes - Black Cherry Salt", "brand": "LMNT", "flavor": "Black Cherry Salt", "category": "Supplements & Snacks", "quantity": 12, "unit": "packet", "lowStockThreshold": 6, "notes": "Shelf" },
    { "name": "LMNT Electrolytes - Pineapple Salt", "brand": "LMNT", "flavor": "Pineapple Salt", "category": "Supplements & Snacks", "quantity": 12, "unit": "packet", "lowStockThreshold": 6, "notes": "Shelf" },
    { "name": "LMNT Electrolytes - Citrus Salt", "brand": "LMNT", "flavor": "Citrus Salt", "category": "Supplements & Snacks", "quantity": 24, "unit": "packet", "lowStockThreshold": 12, "notes": "2 packs - shelf" },
    { "name": "LMNT Electrolytes - Watermelon Salt", "brand": "LMNT", "flavor": "Watermelon Salt", "category": "Supplements & Snacks", "quantity": 24, "unit": "packet", "lowStockThreshold": 12, "notes": "2 unopened packs - shelf" },
    { "name": "Fairlife Protein Shake - 30g", "brand": "Fairlife", "flavor": "30g Protein", "category": "Supplements & Snacks", "quantity": 30, "unit": "bottle", "lowStockThreshold": 12, "notes": "2 full packs of 12 + ~6 in open pack - shelf" },
    { "name": "RAW Protein Bar - Strawberry Milkshake", "brand": "RAW", "flavor": "Strawberry Milkshake", "category": "Supplements & Snacks", "quantity": 12, "unit": "bar", "lowStockThreshold": 6, "notes": "Shelf" },
    { "name": "RAW Protein Bar - Chocolate Milkshake", "brand": "RAW", "flavor": "Chocolate Milkshake", "category": "Supplements & Snacks", "quantity": 18, "unit": "bar", "lowStockThreshold": 6, "notes": "12 pack + 6 loose - shelf" },
    { "name": "MRE Bar - Cookies and Cream", "brand": "Redcon1", "flavor": "Cookies and Cream", "category": "Supplements & Snacks", "quantity": 36, "unit": "bar", "lowStockThreshold": 12, "notes": "3 packs of 12 - shelf" },
    { "name": "MRE Bar - Milk Chocolate", "brand": "Redcon1", "flavor": "Milk Chocolate", "category": "Supplements & Snacks", "quantity": 36, "unit": "bar", "lowStockThreshold": 12, "notes": "3 packs of 12 - shelf" },
    { "name": "MRE Bar - Salted Caramel", "brand": "Redcon1", "flavor": "Salted Caramel", "category": "Supplements & Snacks", "quantity": 12, "unit": "bar", "lowStockThreshold": 6, "notes": "1 unopened pack - shelf" },
    { "name": "MRE Bar - Strawberry Shortcake", "brand": "Redcon1", "flavor": "Strawberry Shortcake", "category": "Supplements & Snacks", "quantity": 24, "unit": "bar", "lowStockThreshold": 12, "notes": "2 unopened packs - shelf" },
    { "name": "MRE Bar - Vanilla Milkshake", "brand": "Redcon1", "flavor": "Vanilla Milkshake", "category": "Supplements & Snacks", "quantity": 6, "unit": "bar", "lowStockThreshold": 4, "notes": "1 open pack - shelf" },
    { "name": "Lean Body Protein Shake - Chocolate", "brand": "Lean Body", "flavor": "Chocolate", "category": "Supplements & Snacks", "quantity": 36, "unit": "can", "lowStockThreshold": 12, "notes": "3 packs of 12 - shelf" },
    { "name": "Lean Body Protein Shake - Vanilla", "brand": "Lean Body", "flavor": "Vanilla", "category": "Supplements & Snacks", "quantity": 36, "unit": "can", "lowStockThreshold": 12, "notes": "3 packs of 12 - shelf" },
    { "name": "Lean Body Protein Shake - Strawberry", "brand": "Lean Body", "flavor": "Strawberry", "category": "Supplements & Snacks", "quantity": 24, "unit": "can", "lowStockThreshold": 12, "notes": "2 unopened packs - shelf" },
    { "name": "Lean Body Protein Shake - Salted Caramel", "brand": "Lean Body", "flavor": "Salted Caramel", "category": "Supplements & Snacks", "quantity": 12, "unit": "can", "lowStockThreshold": 6, "notes": "1 open + 1 unopened pack - shelf" },
    { "name": "Lean Body Protein Shake - Chocolate Peanut Butter", "brand": "Lean Body", "flavor": "Chocolate Peanut Butter", "category": "Supplements & Snacks", "quantity": 6, "unit": "can", "lowStockThreshold": 4, "notes": "1 open pack - shelf" },
    { "name": "Lean Body Protein Shake - Plant-Based Chocolate", "brand": "Lean Body", "flavor": "Plant-Based Chocolate", "category": "Supplements & Snacks", "quantity": 6, "unit": "can", "lowStockThreshold": 4, "notes": "Half pack - shelf" },
    { "name": "Lean Body Protein Shake - Plant-Based Vanilla Caramel", "brand": "Lean Body", "flavor": "Plant-Based Vanilla Caramel", "category": "Supplements & Snacks", "quantity": 24, "unit": "can", "lowStockThreshold": 12, "notes": "2 full packs of 12 - shelf" },
    { "name": "Monster Energy - Original", "brand": "Monster", "flavor": "Original", "category": "Supplements & Snacks", "quantity": 26, "unit": "can", "lowStockThreshold": 12, "notes": "VERIFY COUNT - 12 loose + 1 pack (count unknown) - shelf" },
    { "name": "Monster Energy - White Ultra", "brand": "Monster", "flavor": "White Ultra", "category": "Supplements & Snacks", "quantity": 29, "unit": "can", "lowStockThreshold": 12, "notes": "VERIFY COUNT - 5 loose + 2 packs (count unknown) - shelf" },
    { "name": "Gatorade Thirst Quencher - Assorted", "brand": "Gatorade", "flavor": "Assorted", "category": "Supplements & Snacks", "quantity": 28, "unit": "bottle", "lowStockThreshold": 12, "notes": "28-pack of 12oz bottles - shelf" },
    { "name": "Vitamin Water - Assorted", "brand": "Vitamin Water", "flavor": "XXX / Power C / Energy", "category": "Supplements & Snacks", "quantity": 20, "unit": "bottle", "lowStockThreshold": 8, "notes": "Shelf" },
    { "name": "LMNT Electrolytes - Black Cherry Salt (Cooler)", "brand": "LMNT", "flavor": "Black Cherry Salt", "category": "Supplements & Snacks", "quantity": 8, "unit": "packet", "lowStockThreshold": 4, "notes": "Cooler" },
    { "name": "LMNT Electrolytes - Lemonade Salt (Cooler)", "brand": "LMNT", "flavor": "Lemonade Salt", "category": "Supplements & Snacks", "quantity": 8, "unit": "packet", "lowStockThreshold": 4, "notes": "Cooler" },
    { "name": "LMNT Electrolytes - Pineapple Salt (Cooler)", "brand": "LMNT", "flavor": "Pineapple Salt", "category": "Supplements & Snacks", "quantity": 8, "unit": "packet", "lowStockThreshold": 4, "notes": "Cooler" },
    { "name": "LMNT Electrolytes - Watermelon Salt (Cooler)", "brand": "LMNT", "flavor": "Watermelon Salt", "category": "Supplements & Snacks", "quantity": 8, "unit": "packet", "lowStockThreshold": 4, "notes": "Cooler" },
    { "name": "LMNT Electrolytes - Grapefruit Salt (Cooler)", "brand": "LMNT", "flavor": "Grapefruit Salt", "category": "Supplements & Snacks", "quantity": 8, "unit": "packet", "lowStockThreshold": 4, "notes": "Cooler" },
    { "name": "LMNT Electrolytes - Citrus Salt (Cooler)", "brand": "LMNT", "flavor": "Citrus Salt", "category": "Supplements & Snacks", "quantity": 8, "unit": "packet", "lowStockThreshold": 4, "notes": "Cooler" },
    { "name": "KXR Pre-Workout - Black Shark Gummy (Cooler)", "brand": "KXR", "flavor": "Black Shark Gummy", "category": "Supplements & Snacks", "quantity": 2, "unit": "bottle", "lowStockThreshold": 4, "notes": "Cooler" },
    { "name": "KXR Pre-Workout - Sour Candy (Cooler)", "brand": "KXR", "flavor": "Sour Candy", "category": "Supplements & Snacks", "quantity": 2, "unit": "bottle", "lowStockThreshold": 4, "notes": "Cooler" },
    { "name": "Evogen Pre-Workout - Sour Blue Gummy (Cooler)", "brand": "Evogen", "flavor": "Sour Blue Gummy", "category": "Supplements & Snacks", "quantity": 7, "unit": "bottle", "lowStockThreshold": 4, "notes": "Cooler" },
    { "name": "Evogen Pre-Workout - Tropical Splash (Cooler)", "brand": "Evogen", "flavor": "Tropical Splash", "category": "Supplements & Snacks", "quantity": 8, "unit": "bottle", "lowStockThreshold": 4, "notes": "Cooler" },
    { "name": "Evogen Pre-Workout - Tangerine Blast (Cooler)", "brand": "Evogen", "flavor": "Tangerine Blast", "category": "Supplements & Snacks", "quantity": 5, "unit": "bottle", "lowStockThreshold": 4, "notes": "Cooler" },
    { "name": "110% Pre-Workout - Lemonade (Cooler)", "brand": "110%", "flavor": "Lemonade", "category": "Supplements & Snacks", "quantity": 5, "unit": "bottle", "lowStockThreshold": 4, "notes": "Cooler" },
    { "name": "110% Pre-Workout - Black Cherry (Cooler)", "brand": "110%", "flavor": "Black Cherry", "category": "Supplements & Snacks", "quantity": 4, "unit": "bottle", "lowStockThreshold": 4, "notes": "Cooler" },
    { "name": "Pandemic Pre-Workout - Dragon Fruit Watermelon (Cooler)", "brand": "Pandemic", "flavor": "Dragon Fruit Watermelon", "category": "Supplements & Snacks", "quantity": 8, "unit": "bottle", "lowStockThreshold": 4, "notes": "Cooler" },
    { "name": "Pandemic Pre-Workout - Blue Raz Lemonade (Cooler)", "brand": "Pandemic", "flavor": "Blue Raz Lemonade", "category": "Supplements & Snacks", "quantity": 8, "unit": "bottle", "lowStockThreshold": 4, "notes": "Cooler" },
    { "name": "Hostility Pre-Workout - Citrus Shock (Cooler)", "brand": "Hostility", "flavor": "Citrus Shock", "category": "Supplements & Snacks", "quantity": 8, "unit": "bottle", "lowStockThreshold": 4, "notes": "Cooler" },
    { "name": "Hostility Pre-Workout - Strawberry Kiwi (Cooler)", "brand": "Hostility", "flavor": "Strawberry Kiwi", "category": "Supplements & Snacks", "quantity": 8, "unit": "bottle", "lowStockThreshold": 4, "notes": "Cooler" },
    { "name": "Charge Pre-Workout - Watermelon Candy (Cooler)", "brand": "Charge", "flavor": "Watermelon Candy", "category": "Supplements & Snacks", "quantity": 8, "unit": "bottle", "lowStockThreshold": 4, "notes": "Cooler" },
    { "name": "C4 Pre-Workout - Blue Raspberry (Cooler)", "brand": "C4", "flavor": "Blue Raspberry", "category": "Supplements & Snacks", "quantity": 8, "unit": "can", "lowStockThreshold": 4, "notes": "Cooler" },
    { "name": "C4 Pre-Workout - Arctic Snow Cone (Cooler)", "brand": "C4", "flavor": "Arctic Snow Cone", "category": "Supplements & Snacks", "quantity": 8, "unit": "can", "lowStockThreshold": 4, "notes": "Cooler" },
    { "name": "C4 Pre-Workout - Watermelon (Cooler)", "brand": "C4", "flavor": "Watermelon", "category": "Supplements & Snacks", "quantity": 8, "unit": "can", "lowStockThreshold": 4, "notes": "Cooler" },
    { "name": "C4 Pre-Workout - Icy Blue Raspberry (Cooler)", "brand": "C4", "flavor": "Icy Blue Raspberry", "category": "Supplements & Snacks", "quantity": 8, "unit": "can", "lowStockThreshold": 4, "notes": "Cooler" },
    { "name": "Thavage Pre-Workout - Berry Blast (Cooler)", "brand": "Thavage", "flavor": "Berry Blast", "category": "Supplements & Snacks", "quantity": 5, "unit": "bottle", "lowStockThreshold": 4, "notes": "Cooler" },
    { "name": "Thavage Pre-Workout - Champion Mentality (Cooler)", "brand": "Thavage", "flavor": "Champion Mentality", "category": "Supplements & Snacks", "quantity": 7, "unit": "bottle", "lowStockThreshold": 4, "notes": "Cooler" },
    { "name": "Thavage Pre-Workout - Dragon Fruit (Cooler)", "brand": "Thavage", "flavor": "Dragon Fruit", "category": "Supplements & Snacks", "quantity": 4, "unit": "bottle", "lowStockThreshold": 4, "notes": "Cooler" },
    { "name": "Thavage Pre-Workout - Sour Raspberry (Cooler)", "brand": "Thavage", "flavor": "Sour Raspberry", "category": "Supplements & Snacks", "quantity": 2, "unit": "bottle", "lowStockThreshold": 4, "notes": "Cooler" },
    { "name": "Thavage Pre-Workout - Rocket Pop (Cooler)", "brand": "Thavage", "flavor": "Rocket Pop", "category": "Supplements & Snacks", "quantity": 8, "unit": "bottle", "lowStockThreshold": 4, "notes": "Cooler" },
    { "name": "Thavage Pre-Workout - Blue Raspberry (Cooler)", "brand": "Thavage", "flavor": "Blue Raspberry", "category": "Supplements & Snacks", "quantity": 8, "unit": "bottle", "lowStockThreshold": 4, "notes": "Cooler" },
    { "name": "Thavage Pre-Workout - Secret Stuff (Cooler)", "brand": "Thavage", "flavor": "Secret Stuff", "category": "Supplements & Snacks", "quantity": 3, "unit": "bottle", "lowStockThreshold": 4, "notes": "Cooler" },
    { "name": "Thavage Pre-Workout - Fruit Punch (Cooler)", "brand": "Thavage", "flavor": "Fruit Punch", "category": "Supplements & Snacks", "quantity": 5, "unit": "bottle", "lowStockThreshold": 4, "notes": "Cooler" },
    { "name": "Christopher's Juicy Pumps - Rainbow Sherbet (Cooler)", "brand": "Christopher's", "flavor": "Rainbow Sherbet", "category": "Supplements & Snacks", "quantity": 5, "unit": "bottle", "lowStockThreshold": 4, "notes": "Cooler" },
    { "name": "Christopher's Juicy Pumps - Juicy Pumps (Cooler)", "brand": "Christopher's", "flavor": "Juicy Pumps", "category": "Supplements & Snacks", "quantity": 2, "unit": "bottle", "lowStockThreshold": 4, "notes": "Cooler" },
    { "name": "Total War Pre-Workout - Tiger's Blood (Cooler)", "brand": "Redcon1", "flavor": "Tiger's Blood", "category": "Supplements & Snacks", "quantity": 9, "unit": "bottle", "lowStockThreshold": 4, "notes": "Cooler" },
    { "name": "Total War Pre-Workout - Strawberry Mango (Cooler)", "brand": "Redcon1", "flavor": "Strawberry Mango", "category": "Supplements & Snacks", "quantity": 8, "unit": "bottle", "lowStockThreshold": 4, "notes": "Cooler" },
    { "name": "Total War Pre-Workout - Grape Freeze (Cooler)", "brand": "Redcon1", "flavor": "Grape Freeze", "category": "Supplements & Snacks", "quantity": 8, "unit": "bottle", "lowStockThreshold": 4, "notes": "Cooler" },
    { "name": "Total War Pre-Workout - Arctic Berry (Cooler)", "brand": "Redcon1", "flavor": "Arctic Berry", "category": "Supplements & Snacks", "quantity": 8, "unit": "bottle", "lowStockThreshold": 4, "notes": "Cooler" },
    { "name": "Total War Pre-Workout - Rainbow Candy (Cooler)", "brand": "Redcon1", "flavor": "Rainbow Candy", "category": "Supplements & Snacks", "quantity": 10, "unit": "bottle", "lowStockThreshold": 4, "notes": "Cooler" },
    { "name": "Total War Pre-Workout - Patriot (Cooler)", "brand": "Redcon1", "flavor": "Patriot", "category": "Supplements & Snacks", "quantity": 7, "unit": "bottle", "lowStockThreshold": 4, "notes": "Cooler" },
    { "name": "Total War Pre-Workout - Baja Bomb (Cooler)", "brand": "Redcon1", "flavor": "Baja Bomb", "category": "Supplements & Snacks", "quantity": 5, "unit": "bottle", "lowStockThreshold": 4, "notes": "Cooler" },
    { "name": "Total War Pre-Workout - Strawberry Kiwi (Cooler)", "brand": "Redcon1", "flavor": "Strawberry Kiwi", "category": "Supplements & Snacks", "quantity": 7, "unit": "bottle", "lowStockThreshold": 4, "notes": "Cooler" },
    { "name": "Total War Pre-Workout - Pink Lemonade (Cooler)", "brand": "Redcon1", "flavor": "Pink Lemonade", "category": "Supplements & Snacks", "quantity": 7, "unit": "bottle", "lowStockThreshold": 4, "notes": "Cooler" },
    { "name": "Total War Pre-Workout - Vice City (Cooler)", "brand": "Redcon1", "flavor": "Vice City", "category": "Supplements & Snacks", "quantity": 3, "unit": "bottle", "lowStockThreshold": 4, "notes": "Cooler" },
    { "name": "Smart Water (Cooler)", "brand": "Smart Water", "flavor": "Still", "category": "Supplements & Snacks", "quantity": 21, "unit": "bottle", "lowStockThreshold": 10, "notes": "Mix of 23oz and 33oz - cooler" },
    { "name": "Ice Mountain Water (Cooler)", "brand": "Ice Mountain", "flavor": "Still", "category": "Supplements & Snacks", "quantity": 18, "unit": "bottle", "lowStockThreshold": 10, "notes": "Cooler" },
    { "name": "Bum Energy - Original (Cooler)", "brand": "Dr. Bum", "flavor": "Original Dr. Bum", "category": "Supplements & Snacks", "quantity": 6, "unit": "can", "lowStockThreshold": 4, "notes": "Cooler" },
    { "name": "Bum Energy - Cherry Frost (Cooler)", "brand": "Dr. Bum", "flavor": "Cherry Frost", "category": "Supplements & Snacks", "quantity": 8, "unit": "can", "lowStockThreshold": 4, "notes": "Cooler" },
    { "name": "Bum Energy - Watermelon (Cooler)", "brand": "Dr. Bum", "flavor": "Watermelon", "category": "Supplements & Snacks", "quantity": 8, "unit": "can", "lowStockThreshold": 4, "notes": "Cooler" },
    { "name": "Bum Energy - Orange Sunrise (Cooler)", "brand": "Dr. Bum", "flavor": "Orange Sunrise", "category": "Supplements & Snacks", "quantity": 8, "unit": "can", "lowStockThreshold": 4, "notes": "Cooler" },
    { "name": "Bum Energy - Iced Tea Lemonade (Cooler)", "brand": "Dr. Bum", "flavor": "Iced Tea Lemonade", "category": "Supplements & Snacks", "quantity": 4, "unit": "can", "lowStockThreshold": 4, "notes": "Cooler" },
    { "name": "Bum Energy - Blueberry Lemonade (Cooler)", "brand": "Dr. Bum", "flavor": "Blueberry Lemonade", "category": "Supplements & Snacks", "quantity": 4, "unit": "can", "lowStockThreshold": 4, "notes": "Cooler" },
    { "name": "Bum Energy - Root Beer (Cooler)", "brand": "Dr. Bum", "flavor": "Root Beer", "category": "Supplements & Snacks", "quantity": 5, "unit": "can", "lowStockThreshold": 4, "notes": "Cooler" },
    { "name": "Bum Energy - Grape (Cooler)", "brand": "Dr. Bum", "flavor": "Grape", "category": "Supplements & Snacks", "quantity": 7, "unit": "can", "lowStockThreshold": 4, "notes": "Cooler" },
    { "name": "Bum Energy - Hard to Kill (Cooler)", "brand": "Dr. Bum", "flavor": "Hard to Kill", "category": "Supplements & Snacks", "quantity": 6, "unit": "can", "lowStockThreshold": 4, "notes": "Cooler" },
    { "name": "Alani Nu - Cherry Twist (Cooler)", "brand": "Alani Nu", "flavor": "Cherry Twist", "category": "Supplements & Snacks", "quantity": 6, "unit": "can", "lowStockThreshold": 4, "notes": "Cooler" },
    { "name": "Alani Nu - Orange Kiss (Cooler)", "brand": "Alani Nu", "flavor": "Orange Kiss", "category": "Supplements & Snacks", "quantity": 1, "unit": "can", "lowStockThreshold": 4, "notes": "Cooler - LOW STOCK" },
    { "name": "Alani Nu - Juicy Peach (Cooler)", "brand": "Alani Nu", "flavor": "Juicy Peach", "category": "Supplements & Snacks", "quantity": 1, "unit": "can", "lowStockThreshold": 4, "notes": "Cooler - LOW STOCK" },
    { "name": "Alani Nu - Strawberry Sunrise (Cooler)", "brand": "Alani Nu", "flavor": "Strawberry Sunrise", "category": "Supplements & Snacks", "quantity": 8, "unit": "can", "lowStockThreshold": 4, "notes": "Cooler" },
    { "name": "Alani Nu - Cotton Candy (Cooler)", "brand": "Alani Nu", "flavor": "Cotton Candy", "category": "Supplements & Snacks", "quantity": 8, "unit": "can", "lowStockThreshold": 4, "notes": "Cooler" },
    { "name": "Alani Nu - Blue Slush (Cooler)", "brand": "Alani Nu", "flavor": "Blue Slush", "category": "Supplements & Snacks", "quantity": 8, "unit": "can", "lowStockThreshold": 4, "notes": "Cooler" },
    { "name": "Alani Nu - Breezeberry (Cooler)", "brand": "Alani Nu", "flavor": "Breezeberry", "category": "Supplements & Snacks", "quantity": 8, "unit": "can", "lowStockThreshold": 4, "notes": "Cooler" },
    { "name": "Alani Nu - Cosmic Stardust (Cooler)", "brand": "Alani Nu", "flavor": "Cosmic Stardust", "category": "Supplements & Snacks", "quantity": 6, "unit": "can", "lowStockThreshold": 4, "notes": "Cooler" },
    { "name": "Alani Nu - Watermelon Wave (Cooler)", "brand": "Alani Nu", "flavor": "Watermelon Wave", "category": "Supplements & Snacks", "quantity": 8, "unit": "can", "lowStockThreshold": 4, "notes": "Cooler" },
    { "name": "Alani Nu - Sherbet Swirl (Cooler)", "brand": "Alani Nu", "flavor": "Sherbet Swirl", "category": "Supplements & Snacks", "quantity": 8, "unit": "can", "lowStockThreshold": 4, "notes": "Cooler" },
    { "name": "Celsius - Arctic Vibe (Cooler)", "brand": "Celsius", "flavor": "Arctic Vibe", "category": "Supplements & Snacks", "quantity": 6, "unit": "can", "lowStockThreshold": 4, "notes": "Cooler" },
    { "name": "Celsius - Play Vibe (Cooler)", "brand": "Celsius", "flavor": "Play Vibe", "category": "Supplements & Snacks", "quantity": 7, "unit": "can", "lowStockThreshold": 4, "notes": "Cooler" },
    { "name": "Celsius - Sports Vibe (Cooler)", "brand": "Celsius", "flavor": "Sports Vibe", "category": "Supplements & Snacks", "quantity": 5, "unit": "can", "lowStockThreshold": 4, "notes": "Cooler" },
    { "name": "Celsius - Green Apple Cherry (Cooler)", "brand": "Celsius", "flavor": "Green Apple Cherry", "category": "Supplements & Snacks", "quantity": 4, "unit": "can", "lowStockThreshold": 4, "notes": "Cooler" },
    { "name": "Celsius - Cosmic Vibe (Cooler)", "brand": "Celsius", "flavor": "Cosmic Vibe", "category": "Supplements & Snacks", "quantity": 6, "unit": "can", "lowStockThreshold": 4, "notes": "Cooler" },
    { "name": "Celsius - Grape Rush (Cooler)", "brand": "Celsius", "flavor": "Grape Rush", "category": "Supplements & Snacks", "quantity": 7, "unit": "can", "lowStockThreshold": 4, "notes": "Cooler" },
    { "name": "Celsius - Tropical Vibe (Cooler)", "brand": "Celsius", "flavor": "Tropical Vibe", "category": "Supplements & Snacks", "quantity": 6, "unit": "can", "lowStockThreshold": 4, "notes": "Cooler" },
    { "name": "Celsius - Watermelon (Cooler)", "brand": "Celsius", "flavor": "Watermelon", "category": "Supplements & Snacks", "quantity": 3, "unit": "can", "lowStockThreshold": 4, "notes": "Cooler - LOW STOCK" },
    { "name": "Celsius - Blue Raz Lemonade (Cooler)", "brand": "Celsius", "flavor": "Blue Raz Lemonade", "category": "Supplements & Snacks", "quantity": 6, "unit": "can", "lowStockThreshold": 4, "notes": "Cooler" },
    { "name": "Celsius - Kiwi Strawberry (Cooler)", "brand": "Celsius", "flavor": "Kiwi Strawberry", "category": "Supplements & Snacks", "quantity": 5, "unit": "can", "lowStockThreshold": 4, "notes": "Cooler" },
    { "name": "Amino Energy - Peach Bellini (Cooler)", "brand": "Optimum Nutrition", "flavor": "Peach Bellini", "category": "Supplements & Snacks", "quantity": 5, "unit": "can", "lowStockThreshold": 4, "notes": "Cooler" },
    { "name": "Amino Energy - Mango Pineapple Lemonade (Cooler)", "brand": "Optimum Nutrition", "flavor": "Mango Pineapple Lemonade", "category": "Supplements & Snacks", "quantity": 3, "unit": "can", "lowStockThreshold": 4, "notes": "Cooler" },
    { "name": "Amino Energy - Blue Raspberry Rush (Cooler)", "brand": "Optimum Nutrition", "flavor": "Blue Raspberry Rush", "category": "Supplements & Snacks", "quantity": 4, "unit": "can", "lowStockThreshold": 4, "notes": "Cooler" },
    { "name": "Amino Energy - Blueberry Lemonade (Cooler)", "brand": "Optimum Nutrition", "flavor": "Blueberry Lemonade", "category": "Supplements & Snacks", "quantity": 6, "unit": "can", "lowStockThreshold": 4, "notes": "Cooler" },
    { "name": "Amino Energy - Cocoa Berry Breeze (Cooler)", "brand": "Optimum Nutrition", "flavor": "Cocoa Berry Breeze", "category": "Supplements & Snacks", "quantity": 5, "unit": "can", "lowStockThreshold": 4, "notes": "Cooler" },
    { "name": "Red Bull - White Peach (Cooler)", "brand": "Red Bull", "flavor": "White Peach", "category": "Supplements & Snacks", "quantity": 6, "unit": "can", "lowStockThreshold": 4, "notes": "Cooler" },
    { "name": "Bloom Energy - Ice Vanilla Berry (Cooler)", "brand": "Bloom", "flavor": "Ice Vanilla Berry", "category": "Supplements & Snacks", "quantity": 7, "unit": "can", "lowStockThreshold": 4, "notes": "Cooler" },
    { "name": "Bloom Pops - Strawberry Watermelon (Cooler)", "brand": "Bloom", "flavor": "Strawberry Watermelon", "category": "Supplements & Snacks", "quantity": 1, "unit": "pack", "lowStockThreshold": 3, "notes": "Cooler - LOW STOCK" },
    { "name": "Bloom Pops - Glacier Crush (Cooler)", "brand": "Bloom", "flavor": "Glacier Crush", "category": "Supplements & Snacks", "quantity": 6, "unit": "pack", "lowStockThreshold": 3, "notes": "Cooler" },
    { "name": "Bloom Pops - Peach Mango (Cooler)", "brand": "Bloom", "flavor": "Peach Mango", "category": "Supplements & Snacks", "quantity": 4, "unit": "pack", "lowStockThreshold": 3, "notes": "Cooler" },
    { "name": "Bloom Pops - Crisp Apple (Cooler)", "brand": "Bloom", "flavor": "Crisp Apple", "category": "Supplements & Snacks", "quantity": 3, "unit": "pack", "lowStockThreshold": 3, "notes": "Cooler" },
    { "name": "Bloom Pops - Strawberry Cream (Cooler)", "brand": "Bloom", "flavor": "Strawberry Cream", "category": "Supplements & Snacks", "quantity": 7, "unit": "pack", "lowStockThreshold": 3, "notes": "Cooler" },
    { "name": "OxyShred Ultra Energy - Peach Candy Rings (Cooler)", "brand": "EHPlabs", "flavor": "Peach Candy Rings", "category": "Supplements & Snacks", "quantity": 6, "unit": "can", "lowStockThreshold": 4, "notes": "Cooler" },
    { "name": "OxyShred Ultra Energy - Bahama Breeze (Cooler)", "brand": "EHPlabs", "flavor": "Bahama Breeze", "category": "Supplements & Snacks", "quantity": 7, "unit": "can", "lowStockThreshold": 4, "notes": "Cooler" },
    { "name": "Body Armor Flash IV - Tropical Punch (Cooler)", "brand": "Body Armor", "flavor": "Tropical Punch", "category": "Supplements & Snacks", "quantity": 3, "unit": "bottle", "lowStockThreshold": 4, "notes": "Cooler - LOW STOCK" },
    { "name": "Body Armor Flash IV - Strawberry Kiwi (Cooler)", "brand": "Body Armor", "flavor": "Strawberry Kiwi", "category": "Supplements & Snacks", "quantity": 5, "unit": "bottle", "lowStockThreshold": 4, "notes": "Cooler" },
    { "name": "3D Energy - Strawberry Lemonade (Cooler)", "brand": "3D Energy", "flavor": "Strawberry Lemonade", "category": "Supplements & Snacks", "quantity": 4, "unit": "can", "lowStockThreshold": 4, "notes": "Cooler" },
    { "name": "3D Energy - Liberty Pop (Cooler)", "brand": "3D Energy", "flavor": "Liberty Pop", "category": "Supplements & Snacks", "quantity": 7, "unit": "can", "lowStockThreshold": 4, "notes": "Cooler" },
    { "name": "3D Energy - Blueberry Mix (Cooler)", "brand": "3D Energy", "flavor": "Blueberry Mix", "category": "Supplements & Snacks", "quantity": 4, "unit": "can", "lowStockThreshold": 4, "notes": "Cooler" },
  ];

  const createdAt = new Date().toISOString();
  items = rawSeed.map((s, i) => ({
    id:              'item_' + ts + '_' + i,
    name:            s.name,
    category:        normalizeCat(s.category),
    brand:           s.brand   || '',
    flavor:          s.flavor  || '',
    type:            s.type    || '',
    quantity:        s.quantity,
    unit:            s.unit,
    threshold:       s.lowStockThreshold,
    cost:            s.cost    || 0,
    sell:            s.sell    || 0,
    supplier:        s.supplier        || '',
    supplierContact: s.supplierContact || '',
    notes:           s.notes   || '',
    createdAt,
  }));

  localStorage.setItem('lcg_seeded', '1');
  saveData();

  if (db) {
    items.forEach(item => fWriteItem(item));
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
      ${item.sell > 0 ? `<span class="price-badge">$${item.sell.toFixed(2)}</span>` : ''}
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
  const el = document.getElementById('margins-table');

  const priced = items
    .filter(i => i.cost > 0 && i.sell > 0)
    .map(i => {
      const margin    = i.sell - i.cost;
      const pct       = (margin / i.sell * 100);
      const estProfit = margin * (i.quantity || 0);
      return { item: i, margin, pct, estProfit };
    })
    .sort((a, b) => b.pct - a.pct);

  const unpriced = items.filter(i => !(i.cost > 0 && i.sell > 0));

  if (priced.length === 0) {
    el.innerHTML = `
      <div style="text-align:center;padding:1rem;color:var(--text-muted)">No pricing data available</div>
      ${unpriced.length > 0 ? `
        <div style="margin-top:1rem">
          <div style="font-weight:600;margin-bottom:0.5rem;color:var(--text-muted)">Unpriced Items (${unpriced.length})</div>
          ${unpriced.map(i => `<div style="padding:0.25rem 0;font-size:0.875rem">${esc(i.name)}${i.flavor ? ` <span style="color:var(--text-muted)">(${esc(i.flavor)})</span>` : ''}</div>`).join('')}
        </div>` : ''}`;
    return;
  }

  // Weighted average margin across priced items
  const totalSellValue = priced.reduce((s, r) => s + r.item.sell * r.item.quantity, 0);
  const totalCostValue = priced.reduce((s, r) => s + r.item.cost * r.item.quantity, 0);
  const weightedAvgPct = totalSellValue > 0
    ? ((totalSellValue - totalCostValue) / totalSellValue * 100).toFixed(1)
    : '0.0';
  const totalEstProfit = priced.reduce((s, r) => s + r.estProfit, 0);

  el.innerHTML = `
    <div class="margins-table">
      <table>
        <thead><tr><th>Item</th><th>Cost</th><th>Sell</th><th>Margin %</th><th>Est. Profit (stock)</th></tr></thead>
        <tbody>
          ${priced.map(r => `
            <tr>
              <td>${esc(r.item.name)}${r.item.flavor ? ` <span style="color:var(--text-muted);font-size:0.8em">(${esc(r.item.flavor)})</span>` : ''}</td>
              <td>$${r.item.cost.toFixed(2)}</td>
              <td>$${r.item.sell.toFixed(2)}</td>
              <td class="${r.margin > 0 ? 'margin-positive' : 'margin-zero'}">${r.pct.toFixed(1)}%</td>
              <td class="${r.estProfit > 0 ? 'margin-positive' : 'margin-zero'}">$${r.estProfit.toFixed(2)}</td>
            </tr>`).join('')}
        </tbody>
        <tfoot>
          <tr style="font-weight:700;border-top:2px solid var(--border)">
            <td colspan="3">Weighted Average</td>
            <td class="margin-positive">${weightedAvgPct}%</td>
            <td class="margin-positive">$${totalEstProfit.toFixed(2)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
    ${unpriced.length > 0 ? `
      <div style="margin-top:1.25rem">
        <div style="font-weight:600;margin-bottom:0.5rem;color:var(--text-muted)">Unpriced Items (${unpriced.length})</div>
        <div style="display:flex;flex-wrap:wrap;gap:0.4rem">
          ${unpriced.map(i => `<span style="background:var(--surface-2);padding:0.2rem 0.5rem;border-radius:4px;font-size:0.8rem">${esc(i.name)}${i.flavor ? ` (${esc(i.flavor)})` : ''}</span>`).join('')}
        </div>
      </div>` : ''}`;
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
  updateModalMargin();
}

function updateModalMargin() {
  const cost = parseFloat(document.getElementById('f-cost').value);
  const sell = parseFloat(document.getElementById('f-sell').value);
  const grp  = document.getElementById('modal-margin-group');
  const disp = document.getElementById('modal-margin-display');
  if (cost > 0 && sell > 0 && sell > cost) {
    const pct = ((sell - cost) / sell * 100).toFixed(1);
    disp.textContent = `${pct}%`;
    disp.style.color = 'var(--success)';
    grp.style.display = '';
  } else if (cost > 0 && sell > 0) {
    const pct = ((sell - cost) / sell * 100).toFixed(1);
    disp.textContent = `${pct}%`;
    disp.style.color = 'var(--danger)';
    grp.style.display = '';
  } else {
    grp.style.display = 'none';
  }
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

  // 1. Action detection
  let action = null;
  if (/\b(sold|sale|sell|rang up|bought by|purchased by)\b/.test(t))               action = 'sale';
  else if (/\b(restocked|restock|received|got in|added|delivered|stocked)\b/.test(t)) action = 'restock';
  else if (/\b(tossed|damaged|broke|broken|disposed|wasted|trashed|spoiled)\b/.test(t)) action = 'damaged';
  else if (/\b(expired)\b/.test(t))                                                 action = 'damaged';
  else if (/\b(return|returned|refund|gave back)\b/.test(t))                        action = 'return';

  if (!action) return null;

  // 2. Quantity
  const qtyMatch = t.match(/\b(\d+)\b/);
  const qty = qtyMatch ? parseInt(qtyMatch[1]) : 1;

  // 3. Build input tokens — strip action words, stop words, and the qty number
  const stopWords = new Set([
    'sold','sale','sell','rang','up','bought','by','purchased',
    'restocked','restock','received','got','in','added','delivered','stocked',
    'tossed','expired','damaged','broke','broken','disposed','wasted','trashed','spoiled',
    'returned','return','refund','gave','back',
    'a','an','the','some','few','couple','of', String(qty),
  ]);
  const inputTokens = t.split(/\W+/).filter(w => w.length >= 2 && !stopWords.has(w));

  if (inputTokens.length === 0) return { action, qty, item: null, ambiguous: true, suggestions: [] };

  // 4. Brand-first priority: detect if any known brand appears in the input
  const brandNames = [...new Set(items.map(i => i.brand).filter(Boolean))];
  let detectedBrand = null;
  for (const brand of brandNames) {
    const brandTokens = brand.toLowerCase().split(/\W+/).filter(w => w.length >= 2);
    if (brandTokens.length > 0 && brandTokens.every(bt => inputTokens.some(it => it.includes(bt) || bt.includes(it)))) {
      detectedBrand = brand;
      break;
    }
  }

  // 5. Token-overlap scorer: (matching tokens) / (total tokens in item fields)
  function scoreItem(item) {
    const itemStr = [item.name, item.brand, item.flavor, item.type].join(' ').toLowerCase();
    const itemTokens = itemStr.split(/\W+/).filter(w => w.length >= 2);
    if (itemTokens.length === 0) return 0;
    const matches = inputTokens.filter(it => itemTokens.some(jt => jt.includes(it) || it.includes(jt))).length;
    return matches / itemTokens.length;
  }

  // 6. Score brand-filtered pool first; fall back to all items if no good match
  let pool = detectedBrand
    ? items.filter(i => i.brand && i.brand.toLowerCase() === detectedBrand.toLowerCase())
    : items;

  let scored = pool.map(item => ({ item, score: scoreItem(item) })).sort((a, b) => b.score - a.score);

  // If brand was detected but no flavor match, widen to full inventory
  if (detectedBrand && (scored.length === 0 || scored[0].score < 0.4)) {
    scored = items.map(item => ({ item, score: scoreItem(item) })).sort((a, b) => b.score - a.score);
  }

  const suggestions = scored.slice(0, 3).filter(s => s.score > 0).map(s => s.item);

  if (!scored[0] || scored[0].score < 0.4) {
    return { action, qty, item: null, ambiguous: true, suggestions };
  }

  return { action, qty, item: scored[0].item, ambiguous: false, suggestions };
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
      const suggestions = result.suggestions || [];
      let clarifyMsg = `Understood "${result.action}" × ${result.qty} — which item? Type part of the name:`;
      if (suggestions.length > 0) {
        const names = suggestions.map(s => [s.name, s.flavor].filter(Boolean).join(' ')).join(', ');
        clarifyMsg = `Item not found — did you mean: ${names}? Or type part of the name:`;
      }
      statusEl.classList.add('hidden');
      nlPendingResult = result;
      document.getElementById('nl-clarify-text').textContent = clarifyMsg;
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
