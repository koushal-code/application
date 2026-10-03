/* ═══════════════════════════════════════════════════
   PALLAVI BOUTIQUES — App Logic  v4
   Data layers (in priority order):
     1. Firebase  — any device, any network (requires config.js setup)
     2. Node server — local network (node server.js)
     3. localStorage — offline fallback (single device)
   ═══════════════════════════════════════════════════ */

/* ── State ── */
let orders = [], workers = [], networkIp = 'localhost';
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

/* ══════════════════════════════════════════════════
   LAYER 1 — FIREBASE (cross-device, any network)
   ══════════════════════════════════════════════════ */
const CFG = (typeof window.PB_CONFIG !== 'undefined') ? window.PB_CONFIG : {};
let fbDb = null;

(function initFirebase() {
  if (!CFG.firebaseConfig) return;
  try {
    const app = firebase.initializeApp(CFG.firebaseConfig);
    fbDb = firebase.database(app);
    console.log('[PB] Firebase connected ✅');
  } catch (e) {
    console.error('[PB] Firebase init failed:', e.message);
  }
})();

const FB_URL = CFG.firebaseDbUrl || (CFG.firebaseConfig?.databaseURL || '');

/* Firebase REST helpers (no SDK needed for basic read/write) */
async function fbFetch(path, method, data) {
  const url = FB_URL.replace(/\/$/, '') + '/pb' + path + '.json';
  const opts = { method: method || 'GET', headers: { 'Content-Type': 'application/json' } };
  if (data !== undefined) opts.body = JSON.stringify(data);
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error('Firebase ' + r.status);
  return await r.json();
}

async function firebaseAPI(method, path, body) {
  /* GET /api/data */
  if (path === '/api/data' && method === 'GET') {
    const snap = await fbFetch('', 'GET');
    const data = snap || { orders: {}, workers: {}, nextId: 1001 };
    return {
      orders:    Object.values(data.orders  || {}),
      workers:   Object.values(data.workers || {}),
      nextId:    data.nextId || 1001,
      networkIp: 'Firebase Cloud'
    };
  }

  /* GET /api/staff */
  if (path === '/api/staff' && method === 'GET') {
    const snap = await fbFetch('/workers', 'GET');
    return Object.values(snap || {});
  }

  /* POST /api/staff */
  if (path === '/api/staff' && method === 'POST') {
    body.id = 'W' + Date.now();
    await fbFetch('/workers/' + body.id, 'PUT', body);
    return body;
  }

  /* DELETE /api/staff/:id */
  if (path.startsWith('/api/staff/') && method === 'DELETE') {
    const id = path.split('/').pop();
    await fbFetch('/workers/' + id, 'DELETE');
    return { ok: true };
  }

  /* GET /api/orders */
  if (path === '/api/orders' && method === 'GET') {
    const snap = await fbFetch('/orders', 'GET');
    return Object.values(snap || {});
  }

  /* POST /api/orders */
  if (path === '/api/orders' && method === 'POST') {
    /* Get and increment nextId atomically */
    let nextId = 1001;
    try { const n = await fbFetch('/nextId', 'GET'); nextId = n || 1001; } catch {}
    body.id = String(nextId);
    body.createdAt = body.updatedAt = new Date().toISOString();
    body.photos = body.photos || [];
    await fbFetch('/orders/' + body.id, 'PUT', body);
    await fbFetch('/nextId', 'PUT', nextId + 1);
    return body;
  }

  /* PUT /api/orders/:id */
  if (path.startsWith('/api/orders/') && method === 'PUT') {
    const id = path.split('/').pop();
    const existing = await fbFetch('/orders/' + id, 'GET');
    const updated = { ...existing, ...body, updatedAt: new Date().toISOString() };
    await fbFetch('/orders/' + id, 'PUT', updated);
    return updated;
  }

  /* DELETE /api/orders/:id */
  if (path.startsWith('/api/orders/') && method === 'DELETE') {
    const id = path.split('/').pop();
    await fbFetch('/orders/' + id, 'DELETE');
    return { ok: true };
  }

  /* GET /api/staff-tasks/:workerId */
  if (path.startsWith('/api/staff-tasks/')) {
    const wid = path.split('/').pop();
    const [wSnap, oSnap] = await Promise.all([fbFetch('/workers/' + wid, 'GET'), fbFetch('/orders', 'GET')]);
    const allOrders = Object.values(oSnap || {});
    return { worker: wSnap, tasks: allOrders.filter(o => o.workerId === wid) };
  }

  /* PUT /api/staff-complete/:orderId */
  if (path.startsWith('/api/staff-complete/') && method === 'PUT') {
    const id = path.split('/').pop();
    const existing = await fbFetch('/orders/' + id, 'GET');
    const updated = { ...existing, status: body.status || 'Completed', updatedAt: new Date().toISOString() };
    if (body.workerNote) updated.workerNote = body.workerNote;
    await fbFetch('/orders/' + id, 'PUT', updated);
    return updated;
  }

  return {};
}

/* ══════════════════════════════════════════════════
   LAYER 2 — NODE SERVER (local network, same WiFi)
   ══════════════════════════════════════════════════ */
const IS_STATIC = window.location.protocol === 'file:' || window.location.hostname.includes('github.io');

async function serverAPI(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(path, opts);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return await r.json();
}

/* ══════════════════════════════════════════════════
   LAYER 3 — LOCALSTORAGE (offline, single device)
   ══════════════════════════════════════════════════ */
function lsGet() {
  try { return JSON.parse(localStorage.getItem('pb_data') || '{"orders":[],"workers":[],"nextId":1001}'); }
  catch { return { orders: [], workers: [], nextId: 1001 }; }
}
function lsSave(d) { localStorage.setItem('pb_data', JSON.stringify(d)); }

function localAPI(method, path, body) {
  const d = lsGet();
  const save = () => lsSave(d);

  if (path === '/api/data') { d.networkIp = 'Local (offline)'; return d; }

  if (path === '/api/staff' && method === 'GET')  return d.workers;
  if (path === '/api/staff' && method === 'POST') { body.id = 'W' + Date.now(); d.workers.push(body); save(); return body; }
  if (path.startsWith('/api/staff/') && method === 'DELETE') {
    d.workers = d.workers.filter(w => w.id !== path.split('/').pop()); save(); return { ok: true };
  }

  if (path === '/api/orders' && method === 'GET')  return d.orders;
  if (path === '/api/orders' && method === 'POST') {
    body.id = String(d.nextId++); body.createdAt = body.updatedAt = new Date().toISOString();
    body.photos = body.photos || []; d.orders.push(body); save(); return body;
  }
  if (path.startsWith('/api/orders/') && method === 'PUT') {
    const i = d.orders.findIndex(o => o.id === path.split('/').pop());
    if (i >= 0) { d.orders[i] = { ...d.orders[i], ...body, updatedAt: new Date().toISOString() }; save(); return d.orders[i]; }
  }
  if (path.startsWith('/api/orders/') && method === 'DELETE') {
    const i = d.orders.findIndex(o => o.id === path.split('/').pop());
    if (i >= 0) { const rm = d.orders.splice(i, 1)[0]; save(); return rm; }
  }
  if (path.startsWith('/api/staff-tasks/')) {
    const id = path.split('/').pop();
    return { worker: d.workers.find(w => w.id === id), tasks: d.orders.filter(o => o.workerId === id) };
  }
  if (path.startsWith('/api/staff-complete/') && method === 'PUT') {
    const i = d.orders.findIndex(o => o.id === path.split('/').pop());
    if (i >= 0) { d.orders[i].status = body.status || 'Completed'; d.orders[i].updatedAt = new Date().toISOString(); if (body.workerNote) d.orders[i].workerNote = body.workerNote; save(); return d.orders[i]; }
  }
  return {};
}

/* ══════════════════════════════════════════════════
   UNIFIED API — tries Firebase → Node → localStorage
   ══════════════════════════════════════════════════ */
function useFirebase() { return !!(FB_URL && FB_URL.includes('firebaseio.com')); }

async function api(method, path, body) {
  /* 1. Firebase — if configured */
  if (useFirebase()) {
    try { return await firebaseAPI(method, path, body); }
    catch (e) { console.warn('[Firebase] error, falling back:', e.message); }
  }

  /* 2. Node server — if not a static file host */
  if (!IS_STATIC) {
    try { return await serverAPI(method, path, body); }
    catch (e) { console.warn('[Server] error, falling back to localStorage:', e.message); }
  }

  /* 3. localStorage — always available */
  return localAPI(method, path, body);
}

async function loadData() {
  try {
    const d = await api('GET', '/api/data');
    orders    = Array.isArray(d.orders)  ? d.orders  : Object.values(d.orders  || {});
    workers   = Array.isArray(d.workers) ? d.workers : Object.values(d.workers || {});
    networkIp = d.networkIp || window.location.hostname;
  } catch (e) { console.error('loadData failed', e); }
}

/* Data source indicator shown in UI */
function dataSourceLabel() {
  if (useFirebase()) return '🌐 Cloud Sync (Firebase)';
  if (!IS_STATIC)   return '🏠 Local Network (Node server)';
  return '💾 Offline (this device only)';
}


/* ══════ HELPERS ══════ */
function toast(msg) {
  const t = $('#toast'); t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove('show'), 3500);
}
function fmtDate(d) { if (!d) return '—'; return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); }
function fmtTime(d) { if (!d) return ''; return new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }); }
function fmtCur(n) { return '₹' + Number(n || 0).toLocaleString('en-IN'); }
function daysTo(d) {
  if (!d) return 999;
  const now = new Date(); now.setHours(0,0,0,0);
  const t = new Date(d); t.setHours(0,0,0,0);
  return Math.ceil((t - now) / 864e5);
}
function badge(status, deadline) {
  const ov = deadline && daysTo(deadline) < 0 && status !== 'Completed' && status !== 'Delivered';
  if (ov) return '<span class="badge b-over">Overdue</span>';
  const m = { 'Pending':'b-pend','In Progress':'b-prog','Ready for Trial':'b-trial','Alterations':'b-alter','Completed':'b-done','Delivered':'b-deliv' };
  return `<span class="badge ${m[status]||'b-pend'}">${status}</span>`;
}
function monthKey(d) {
  if (!d) return 'Unknown';
  return new Date(d).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}

/* ══════ ICONS ══════ */
const IC = {
  eye:    '<svg viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
  edit:   '<svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
  trash:  '<svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>',
  qr:     '<svg viewBox="0 0 24 24"><rect x="2" y="2" width="8" height="8" rx="1"/><rect x="14" y="2" width="8" height="8" rx="1"/><rect x="2" y="14" width="8" height="8" rx="1"/><rect x="14" y="14" width="4" height="4"/><rect x="20" y="14" width="2" height="2"/><rect x="14" y="20" width="2" height="2"/><rect x="20" y="20" width="2" height="2"/></svg>',
  check:  '<svg viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
  clock:  '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
  alert:  '<svg viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  up:     '<svg viewBox="0 0 24 24"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>',
  pkg:    '<svg viewBox="0 0 24 24"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>',
  tool:   '<svg viewBox="0 0 24 24"><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/></svg>',
  camera: '<svg viewBox="0 0 24 24"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>',
  chev:   '<svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>',
  save:   '<svg viewBox="0 0 24 24"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>',
  cash:   '<svg viewBox="0 0 24 24"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M2 10h2M20 10h2M2 14h2M20 14h2"/></svg>',
  wifi:   '<svg viewBox="0 0 24 24"><path d="M5 12.55a11 11 0 0114.08 0M1.42 9a16 16 0 0121.16 0M8.53 16.11a6 6 0 016.95 0M12 20h.01"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
  dl:     '<svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
  truck:  '<svg viewBox="0 0 24 24"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>',
  users:  '<svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>',
};

/* ══════ NAVIGATION ══════ */
function switchView(id) {
  $$('.view').forEach(v => v.classList.remove('active'));
  $$('.nav-item').forEach(l => l.classList.remove('active'));
  $(`#view-${id}`)?.classList.add('active');
  $(`.nav-item[data-view="${id}"]`)?.classList.add('active');
  $('#sidebar').classList.remove('open');
  $('#sidebar-overlay').style.display = 'none';
  if (id === 'dashboard')  renderDashboard();
  if (id === 'orders')     renderOrders();
  if (id === 'new-order')  renderOrderForm();
  if (id === 'workers')    renderWorkers();
  if (id === 'delivery')   renderDelivery();
  if (id === 'records')    renderRecords();
  if (id === 'customers')  renderCustomers();
}

$$('.nav-item').forEach(l => l.addEventListener('click', e => { e.preventDefault(); switchView(l.dataset.view); }));
$('#btn-menu').addEventListener('click', () => { $('#sidebar').classList.add('open'); $('#sidebar-overlay').style.display = 'block'; });
$('#sidebar-overlay').addEventListener('click', () => { $('#sidebar').classList.remove('open'); $('#sidebar-overlay').style.display = 'none'; });

/* ══════ THEME ══════ */
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem('pb-theme', t);
  $('#theme-text').textContent = t === 'dark' ? 'Light Mode' : 'Dark Mode';
  $('#theme-icon').innerHTML = t === 'dark'
    ? '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>'
    : '<path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>';
}
applyTheme(localStorage.getItem('pb-theme') || 'light');
$('#btn-theme').addEventListener('click', () => applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'));

/* ══════ DASHBOARD ══════ */
function renderDashboard() {
  const now = new Date();
  const total    = orders.length;
  const pending  = orders.filter(o => o.status === 'Pending');
  const progress = orders.filter(o => o.status === 'In Progress');
  const done     = orders.filter(o => o.status === 'Completed' || o.status === 'Delivered');
  const overdue  = orders.filter(o => daysTo(o.deadline) < 0 && o.status !== 'Completed' && o.status !== 'Delivered');
  const rev      = orders.reduce((s, o) => s + Number(o.advance || 0), 0);

  const upcoming = orders
    .filter(o => { const d = daysTo(o.deadline); return d >= 0 && d <= 7 && o.status !== 'Completed' && o.status !== 'Delivered'; })
    .sort((a,b) => new Date(a.deadline) - new Date(b.deadline));

  const workerSummary = workers.map(w => {
    const active = orders.filter(o => o.workerId === w.id && o.status !== 'Completed' && o.status !== 'Delivered').length;
    return { ...w, active };
  });

  $('#view-dashboard').innerHTML = `
    <div class="view-head">
      <div>
        <h2>Dashboard</h2>
        <p class="sub">${now.toLocaleDateString('en-IN',{weekday:'long',year:'numeric',month:'long',day:'numeric'})} &nbsp;·&nbsp; ${now.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:true})}</p>
        <p class="sub" style="margin-top:4px;font-size:.78rem">${dataSourceLabel()}</p>
      </div>
    </div>

    <div class="stats">
      <div class="stat s-total" onclick="showDashModal('all')">
        <div class="stat-ic">${IC.pkg}</div>
        <div><div class="stat-n">${total}</div><div class="stat-l">Total Orders</div></div>
      </div>
      <div class="stat s-pend" onclick="showDashModal('pending')">
        <div class="stat-ic">${IC.clock}</div>
        <div><div class="stat-n">${pending.length}</div><div class="stat-l">Pending</div></div>
      </div>
      <div class="stat s-prog" onclick="showDashModal('progress')">
        <div class="stat-ic">${IC.tool}</div>
        <div><div class="stat-n">${progress.length}</div><div class="stat-l">In Progress</div></div>
      </div>
      <div class="stat s-done" onclick="showDashModal('done')">
        <div class="stat-ic">${IC.check}</div>
        <div><div class="stat-n">${done.length}</div><div class="stat-l">Completed</div></div>
      </div>
      <div class="stat s-over" onclick="showDashModal('overdue')">
        <div class="stat-ic">${IC.alert}</div>
        <div><div class="stat-n">${overdue.length}</div><div class="stat-l">Overdue</div></div>
      </div>
      <div class="stat s-rev" onclick="showDashModal('revenue')">
        <div class="stat-ic">${IC.up}</div>
        <div><div class="stat-n">${fmtCur(rev)}</div><div class="stat-l">Advance Collected</div></div>
      </div>
    </div>

    <div class="panels">
      <div class="panel">
        <h3>${IC.clock} Upcoming Deadlines</h3>
        <div class="panel-list">
          ${upcoming.length
            ? upcoming.map(o => `
              <div class="p-item" onclick="showDetail('${o.id}')">
                <div>
                  <div style="font-weight:600;font-size:.95rem">#${o.id} — ${o.customerName}</div>
                  <div style="font-size:.83rem;color:var(--text-muted);margin-top:2px">${o.clothType} · ${daysTo(o.deadline) === 0 ? 'Due Today!' : daysTo(o.deadline) + 'd left'}</div>
                </div>
                ${badge(o.status, o.deadline)}
              </div>`).join('')
            : '<div class="empty" style="padding:28px 0"><p>No upcoming deadlines 🎉</p></div>'}
        </div>
      </div>
      <div class="panel">
        <h3>${IC.users} Worker Availability</h3>
        <div class="panel-list">
          ${workerSummary.length
            ? workerSummary.map(w => `
              <div class="p-item" onclick="switchView('workers')">
                <div>
                  <div style="font-weight:600;font-size:.95rem">${w.name}</div>
                  <div style="font-size:.83rem;color:var(--text-muted);margin-top:2px">${w.specialty || 'General'}</div>
                </div>
                <div style="font-weight:700;font-size:.92rem;color:${w.active > 3 ? 'var(--red)' : 'var(--green)'}">
                  ${w.active} active
                </div>
              </div>`).join('')
            : '<div class="empty" style="padding:28px 0"><p>No workers yet</p></div>'}
        </div>
      </div>
    </div>
  `;
}

window.showDashModal = function(type) {
  let list = [], title = '';
  if (type === 'all')      { list = orders; title = 'All Orders'; }
  if (type === 'pending')  { list = orders.filter(o => o.status === 'Pending'); title = 'Pending Orders'; }
  if (type === 'progress') { list = orders.filter(o => o.status === 'In Progress'); title = 'In Progress'; }
  if (type === 'done')     { list = orders.filter(o => o.status === 'Completed' || o.status === 'Delivered'); title = 'Completed Orders'; }
  if (type === 'overdue')  { list = orders.filter(o => daysTo(o.deadline) < 0 && o.status !== 'Completed' && o.status !== 'Delivered'); title = 'Overdue Orders'; }
  if (type === 'revenue')  {
    const rev  = orders.reduce((s, o) => s + Number(o.advance || 0), 0);
    const bal  = orders.reduce((s, o) => s + (Number(o.total || 0) - Number(o.advance || 0)), 0);
    $('#modal-body').innerHTML = `
      <h3>Revenue Summary</h3>
      <div class="d-grid" style="margin-top:16px">
        <div class="d-item"><label>Advance Collected</label><p style="color:var(--green);font-size:1.4rem;font-family:'Cormorant Garamond',serif">${fmtCur(rev)}</p></div>
        <div class="d-item"><label>Balance Pending</label><p style="color:var(--red);font-size:1.4rem;font-family:'Cormorant Garamond',serif">${fmtCur(bal)}</p></div>
        <div class="d-item d-full"><label>Total Order Value</label><p style="font-size:1.4rem;font-family:'Cormorant Garamond',serif">${fmtCur(rev + bal)}</p></div>
      </div>`;
    openModal(); return;
  }
  list.sort((a,b) => new Date(a.deadline) - new Date(b.deadline));
  $('#modal-body').innerHTML = `
    <h3>${title} <span style="font-family:'Jost';font-size:1rem;font-weight:400;color:var(--text-muted)">(${list.length})</span></h3>
    ${list.length ? `
      <div class="tbl-wrap" style="margin-top:16px">
        <table class="tbl">
          <thead><tr><th>Order</th><th>Customer</th><th>Type</th><th>Status</th><th>Deadline</th></tr></thead>
          <tbody>
            ${list.map(o => `
              <tr onclick="closeModal();showDetail('${o.id}')" style="cursor:pointer">
                <td><strong>#${o.id}</strong></td>
                <td>${o.customerName}</td>
                <td>${o.clothType}</td>
                <td>${badge(o.status, o.deadline)}</td>
                <td>${fmtDate(o.deadline)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>` : '<div class="empty" style="padding:32px 0"><p>No orders in this category</p></div>'}`;
  openModal();
};

/* ══════ ORDERS ══════ */
let orderSearch = '', orderFilter = 'all';

function renderOrders() {
  let list = [...orders];
  if (orderFilter !== 'all') list = list.filter(o => o.status === orderFilter);
  if (orderSearch) {
    const q = orderSearch.toLowerCase();
    list = list.filter(o =>
      o.customerName.toLowerCase().includes(q) || o.id.includes(q) ||
      o.clothType.toLowerCase().includes(q) || (o.worker||'').toLowerCase().includes(q) ||
      (o.customerPhone||'').includes(q));
  }
  list.sort((a,b) => new Date(a.deadline) - new Date(b.deadline));

  const statusOpts = ['all','Pending','In Progress','Ready for Trial','Alterations','Completed','Delivered'];
  $('#view-orders').innerHTML = `
    <div class="view-head">
      <h2>All Orders</h2>
      <div class="view-actions">
        <div class="search-wrap">${IC.search}<input type="text" id="ord-search" placeholder="Search orders..." value="${orderSearch}"></div>
        <select class="filter-sel" id="ord-filter">${statusOpts.map(s => `<option value="${s}" ${s===orderFilter?'selected':''}>${s==='all'?'All Status':s}</option>`).join('')}</select>
        <button class="btn btn-gold btn-sm" onclick="switchView('new-order')">${IC.save} New Order</button>
      </div>
    </div>
    ${list.length
      ? `<div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>Order #</th><th>Customer</th><th>Type</th><th>Worker</th><th>Status</th><th>Advance</th><th>Total</th><th>Deadline</th><th>Actions</th></tr></thead>
          <tbody>${list.map(o => `
            <tr>
              <td><strong>#${o.id}</strong></td>
              <td>${o.customerName}</td><td>${o.clothType}</td>
              <td>${o.worker||'—'}</td><td>${badge(o.status, o.deadline)}</td>
              <td>${fmtCur(o.advance)}</td><td>${fmtCur(o.total)}</td><td>${fmtDate(o.deadline)}</td>
              <td>
                <button class="btn-icon" onclick="showDetail('${o.id}')" title="View">${IC.eye}</button>
                <button class="btn-icon" onclick="editOrder('${o.id}')" title="Edit">${IC.edit}</button>
                <button class="btn-icon danger" onclick="deleteOrder('${o.id}')" title="Delete">${IC.trash}</button>
              </td>
            </tr>`).join('')}</tbody>
        </table></div>`
      : `<div class="empty">${IC.pkg}<p>No orders found. Create your first order!</p></div>`}`;

  const sEl = $('#ord-search');
  if (sEl) { sEl.addEventListener('input', e => { orderSearch = e.target.value; renderOrders(); }); sEl.focus(); sEl.setSelectionRange(sEl.value.length, sEl.value.length); }
  $('#ord-filter')?.addEventListener('change', e => { orderFilter = e.target.value; renderOrders(); });
}

/* ══════ ORDER FORM ══════ */
let editingId = null, formPhotos = [], paymentMethod = 'cash';

function renderOrderForm(orderId) {
  editingId = orderId || null;
  const o = editingId ? orders.find(x => x.id === editingId) : null;
  formPhotos = o ? [...(o.photos || [])] : [];
  paymentMethod = o?.paymentMethod || 'cash';

  const title = o ? `Edit Order #${o.id}` : 'New Order';
  const clothTypes = ['','Blouse','Saree Blouse','Salwar Kameez','Lehenga','Anarkali','Kurti','Gown','Dress','Shirt','Suit (Men)','Pant','Alteration','Other'];
  const statuses = ['Pending','In Progress','Ready for Trial','Alterations','Completed','Delivered'];

  let dd='', mm='', yy='';
  if (o?.deadline) {
    const dt = new Date(o.deadline);
    dd = String(dt.getDate()).padStart(2,'0');
    mm = String(dt.getMonth()+1).padStart(2,'0');
    yy = String(dt.getFullYear());
  } else {
    const def = new Date(); def.setDate(def.getDate() + 14);
    dd = String(def.getDate()).padStart(2,'0');
    mm = String(def.getMonth()+1).padStart(2,'0');
    yy = String(def.getFullYear());
  }

  const workerOpts = workers.map(w => {
    const active = orders.filter(x => x.workerId === w.id && x.status !== 'Completed' && x.status !== 'Delivered').length;
    return `<option value="${w.id}" ${o?.workerId===w.id?'selected':''}>${w.name} — ${w.specialty||'General'} (${active} task${active!==1?'s':''})</option>`;
  }).join('');

  $('#view-new-order').innerHTML = `
    <div class="view-head"><h2>${title}</h2></div>
    <form class="form-wrap" id="order-form">
      <div class="form-grid">
        <div class="fg"><label>Customer Name *</label><input type="text" id="f-name" required value="${o?.customerName||''}" placeholder="Full name"></div>
        <div class="fg"><label>Phone Number *</label><input type="tel" id="f-phone" required value="${o?.customerPhone||''}" placeholder="10-digit mobile"></div>
        <div class="fg"><label>Cloth / Garment Type *</label>
          <select id="f-cloth" required>${clothTypes.map(c => `<option value="${c}" ${o?.clothType===c?'selected':''}>${c||'Select type...'}</option>`).join('')}</select>
        </div>
        <div class="fg"><label>Design / Details</label><textarea id="f-details" rows="3" placeholder="Fabric, embroidery, colour...">${o?.clothDetails||''}</textarea></div>
        <div class="fg"><label>Assigned Worker *</label>
          <select id="f-worker" required><option value="">Select worker...</option>${workerOpts}</select>
        </div>
        <div class="fg"><label>Status</label>
          <select id="f-status">${statuses.map(s => `<option value="${s}" ${o?.status===s?'selected':''}>${s}</option>`).join('')}</select>
        </div>
        <div class="fg"><label>Total Amount (₹) *</label><input type="number" id="f-total" required min="0" value="${o?.total||''}" placeholder="0"></div>
        <div class="fg"><label>Advance Payment (₹) *</label><input type="number" id="f-advance" required min="0" value="${o?.advance||''}" placeholder="0"></div>

        <div class="fg" style="grid-column:1/-1">
          <label>Deadline — DD / MM / YYYY *</label>
          <div class="date-split">
            <input type="text" id="f-dd" maxlength="2" placeholder="DD" value="${dd}" inputmode="numeric">
            <span>/</span>
            <input type="text" id="f-mm" maxlength="2" placeholder="MM" value="${mm}" inputmode="numeric">
            <span>/</span>
            <input type="text" id="f-yy" maxlength="4" placeholder="YYYY" value="${yy}" inputmode="numeric">
          </div>
        </div>

        <div class="fg" style="grid-column:1/-1"><label>Notes</label><textarea id="f-notes" rows="2" placeholder="Any additional notes...">${o?.notes||''}</textarea></div>

        <div class="pay-section">
          <h4>Payment Method</h4>
          <div class="pay-options">
            <div class="pay-opt ${paymentMethod==='cash'?'selected':''}" data-pay="cash">${IC.cash}<br>Cash</div>
            <div class="pay-opt ${paymentMethod==='online'?'selected':''}" data-pay="online">${IC.wifi}<br>Online (QR)</div>
          </div>
          <div class="pay-qr ${paymentMethod==='online'?'show':''}" id="pay-qr-area"></div>
        </div>

        <hr class="form-sep">
        <div class="form-sec">${IC.camera} Material Photos</div>
        <div class="photo-upload" id="photo-upload-area">
          ${IC.camera}
          <p>Click or tap to upload material photos</p>
          <div class="previews" id="photo-previews">${formPhotos.map(p => `<img src="${p}">`).join('')}</div>
          <input type="file" id="photo-input" accept="image/*" multiple hidden>
        </div>

        <hr class="form-sep">
        <div class="form-sec">${IC.tool} Measurements (inches)</div>
        <div class="fg"><label>Chest</label><input type="number" id="f-chest" step="0.5" value="${o?.measurements?.chest||''}" placeholder="—"></div>
        <div class="fg"><label>Waist</label><input type="number" id="f-waist" step="0.5" value="${o?.measurements?.waist||''}" placeholder="—"></div>
        <div class="fg"><label>Hip</label><input type="number" id="f-hip" step="0.5" value="${o?.measurements?.hip||''}" placeholder="—"></div>
        <div class="fg"><label>Shoulder</label><input type="number" id="f-shoulder" step="0.5" value="${o?.measurements?.shoulder||''}" placeholder="—"></div>
        <div class="fg"><label>Sleeve Length</label><input type="number" id="f-sleeve" step="0.5" value="${o?.measurements?.sleeve||''}" placeholder="—"></div>
        <div class="fg"><label>Length</label><input type="number" id="f-length" step="0.5" value="${o?.measurements?.length||''}" placeholder="—"></div>
      </div>
      <div class="form-actions">
        <button type="submit" class="btn btn-gold">${IC.save} Save Order</button>
        <button type="button" class="btn btn-ghost" id="btn-cancel">Cancel</button>
      </div>
    </form>`;

  // Date auto-jump
  ['f-dd','f-mm'].forEach(id => {
    $(`#${id}`)?.addEventListener('input', function() {
      if (this.value.length >= 2) $(id === 'f-dd' ? '#f-mm' : '#f-yy')?.focus();
    });
  });

  // Payment toggle
  $$('.pay-opt').forEach(el => el.addEventListener('click', () => {
    $$('.pay-opt').forEach(x => x.classList.remove('selected'));
    el.classList.add('selected');
    paymentMethod = el.dataset.pay;
    const qrArea = $('#pay-qr-area');
    if (paymentMethod === 'online') { showPayQR(qrArea, $('#f-advance').value || 0); qrArea.classList.add('show'); }
    else qrArea.classList.remove('show');
  }));

  $('#f-advance')?.addEventListener('input', () => {
    if (paymentMethod === 'online') showPayQR($('#pay-qr-area'), $('#f-advance').value || 0);
  });

  $('#photo-upload-area').addEventListener('click', () => $('#photo-input').click());
  $('#photo-input').addEventListener('change', handlePhotoInput);

  $('#order-form').addEventListener('submit', async e => {
    e.preventDefault();
    const ddV = ($('#f-dd').value||'').padStart(2,'0');
    const mmV = ($('#f-mm').value||'').padStart(2,'0');
    const yyV = $('#f-yy').value || '';
    if (!ddV || !mmV || !yyV || yyV.length < 4) { toast('Please enter a valid deadline date (DD / MM / YYYY)'); return; }
    const deadline = `${yyV}-${mmV}-${ddV}`;
    const selectedWorker = workers.find(w => w.id === $('#f-worker').value);
    const data = {
      customerName:  $('#f-name').value.trim(),
      customerPhone: $('#f-phone').value.trim(),
      clothType:     $('#f-cloth').value,
      clothDetails:  $('#f-details').value.trim(),
      workerId:      $('#f-worker').value,
      worker:        selectedWorker ? selectedWorker.name : '',
      status:        $('#f-status').value,
      total:         Number($('#f-total').value),
      advance:       Number($('#f-advance').value),
      deadline, notes: $('#f-notes').value.trim(), paymentMethod, photos: formPhotos,
      measurements: {
        chest: $('#f-chest').value, waist: $('#f-waist').value, hip: $('#f-hip').value,
        shoulder: $('#f-shoulder').value, sleeve: $('#f-sleeve').value, length: $('#f-length').value,
      }
    };
    if (editingId) { await api('PUT', `/api/orders/${editingId}`, data); toast('Order updated!'); }
    else           { await api('POST', '/api/orders', data); toast('New order created!'); }
    await loadData(); switchView('orders');
  });

  $('#btn-cancel').addEventListener('click', () => switchView('orders'));
}

function showPayQR(container, amount) {
  if (!container || typeof qrcode === 'undefined') return;
  const upi = `upi://pay?pa=pallaviboutiques@upi&pn=Pallavi+Boutiques&am=${amount}&cu=INR`;
  const qr = qrcode(0, 'M'); qr.addData(upi); qr.make();
  container.innerHTML = `<p style="font-size:.88rem;color:var(--text-muted);margin-bottom:10px">Scan to pay ${fmtCur(amount)}</p>${qr.createImgTag(5)}<p style="font-size:.75rem;color:var(--text-muted);margin-top:10px">UPI Payment QR</p>`;
}

async function handlePhotoInput(e) {
  const files = e.target.files; if (!files.length) return;
  for (const file of files) {
    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = reader.result;
      if (editingId) {
        try { const res = await api('POST', '/api/upload', { data: base64, orderId: editingId, filename: file.name }); formPhotos.push(res.url || base64); }
        catch { formPhotos.push(base64); }
      } else { formPhotos.push(base64); }
      $('#photo-previews').innerHTML = formPhotos.map(p => `<img src="${p}">`).join('');
    };
    reader.readAsDataURL(file);
  }
}

function editOrder(id) { switchView('new-order'); renderOrderForm(id); }

async function deleteOrder(id) {
  if (!confirm('Delete this order? This cannot be undone.')) return;
  await api('DELETE', `/api/orders/${id}`);
  await loadData(); toast('Order deleted'); renderOrders();
}

/* ══════ ORDER DETAIL MODAL ══════ */
function showDetail(id) {
  const o = orders.find(x => x.id === id); if (!o) return;
  const bal = (o.total || 0) - (o.advance || 0);
  const m = o.measurements || {};
  const photos = o.photos || [];
  $('#modal-body').innerHTML = `
    <h3>Order #${o.id} — ${o.customerName}</h3>
    <div class="d-grid">
      <div class="d-item"><label>Customer</label><p>${o.customerName}</p></div>
      <div class="d-item"><label>Phone</label><p>${o.customerPhone||'—'}</p></div>
      <div class="d-item"><label>Cloth Type</label><p>${o.clothType}</p></div>
      <div class="d-item"><label>Status</label><p>${badge(o.status, o.deadline)}</p></div>
      <div class="d-item"><label>Assigned Worker</label><p>${o.worker||'—'}</p></div>
      <div class="d-item"><label>Deadline</label><p>${fmtDate(o.deadline)}</p></div>
      <div class="d-item"><label>Total</label><p>${fmtCur(o.total)}</p></div>
      <div class="d-item"><label>Advance Paid</label><p>${fmtCur(o.advance)}</p></div>
      <div class="d-item"><label>Balance Due</label><p style="color:${bal>0?'var(--red)':'var(--green)'};font-weight:700">${fmtCur(bal)}</p></div>
      <div class="d-item"><label>Payment</label><p>${o.paymentMethod === 'online' ? 'Online (UPI)' : 'Cash'}</p></div>
      <div class="d-item"><label>Created</label><p>${fmtDate(o.createdAt)} ${fmtTime(o.createdAt)}</p></div>
      <div class="d-item"><label>Updated</label><p>${fmtDate(o.updatedAt)} ${fmtTime(o.updatedAt)}</p></div>
      ${o.clothDetails ? `<hr class="d-sep"><div class="d-item d-full"><label>Design Details</label><p>${o.clothDetails}</p></div>` : ''}
      ${o.notes ? `<div class="d-item d-full"><label>Notes</label><p>${o.notes}</p></div>` : ''}
      ${o.workerNote ? `<div class="d-item d-full"><label>Worker Note</label><p>${o.workerNote}</p></div>` : ''}
      <hr class="d-sep">
      <div class="d-item"><label>Chest</label><p>${m.chest||'—'}"</p></div>
      <div class="d-item"><label>Waist</label><p>${m.waist||'—'}"</p></div>
      <div class="d-item"><label>Hip</label><p>${m.hip||'—'}"</p></div>
      <div class="d-item"><label>Shoulder</label><p>${m.shoulder||'—'}"</p></div>
      <div class="d-item"><label>Sleeve</label><p>${m.sleeve||'—'}"</p></div>
      <div class="d-item"><label>Length</label><p>${m.length||'—'}"</p></div>
      ${photos.length ? `<hr class="d-sep"><div class="d-item d-full"><label>Material Photos</label><div class="photos-row">${photos.map(p => `<img src="${p}" onclick="window.open('${p}','_blank')">`).join('')}</div></div>` : ''}
    </div>
    <div style="margin-top:24px;display:flex;gap:12px;flex-wrap:wrap">
      <button class="btn btn-gold btn-sm" onclick="editOrder('${o.id}');closeModal()">${IC.edit} Edit</button>
      <button class="btn btn-ghost btn-sm" onclick="quickStatus('${o.id}')">Update Status</button>
    </div>`;
  openModal();
}

function quickStatus(id) {
  const o = orders.find(x => x.id === id); if (!o) return;
  const statuses = ['Pending','In Progress','Ready for Trial','Alterations','Completed','Delivered'];
  const next = statuses[(statuses.indexOf(o.status)+1) % statuses.length];
  const choice = prompt(`Current: ${o.status}\nEnter new status:\n${statuses.join(', ')}`, next);
  if (choice && statuses.includes(choice)) {
    api('PUT', `/api/orders/${o.id}`, { status: choice }).then(async () => {
      await loadData(); closeModal(); renderDashboard(); toast(`Order #${o.id} → ${choice}`);
    });
  }
}

function openModal()  { $('#modal-bg').classList.add('open'); }
function closeModal() { $('#modal-bg').classList.remove('open'); }
$('#modal-x').addEventListener('click', closeModal);
$('#modal-bg').addEventListener('click', e => { if (e.target === $('#modal-bg')) closeModal(); });

/* ══════ WORKERS ══════ */
let expandedWorker = null, workerPhotoData = null;

function renderWorkers() {
  $('#view-workers').innerHTML = `
    <div class="view-head"><h2>Workers</h2></div>
    <div class="w-add">
      <div class="photo-pick" id="w-photo-pick" title="Add photo">${IC.camera}</div>
      <input type="file" id="w-photo-input" accept="image/*" hidden>
      <input type="text" id="w-name" placeholder="Worker name">
      <input type="text" id="w-spec" placeholder="Specialty (e.g. Blouse, Saree)">
      <input type="tel" id="w-phone" placeholder="Phone number">
      <button type="button" class="btn btn-gold btn-sm" id="btn-add-w">${IC.save} Add Worker</button>
    </div>
    <div class="w-grid">${workers.map(w => renderWorkerCard(w)).join('')}</div>`;

  workerPhotoData = null;

  $('#w-photo-pick').addEventListener('click', () => $('#w-photo-input').click());
  $('#w-photo-input').addEventListener('change', e => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { workerPhotoData = reader.result; $('#w-photo-pick').innerHTML = `<img src="${workerPhotoData}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`; };
    reader.readAsDataURL(file);
  });

  $('#btn-add-w').addEventListener('click', async e => {
    e.preventDefault();
    const btn = e.currentTarget;
    const name = $('#w-name').value.trim();
    if (!name) { toast('Worker name is required'); return; }
    const origHTML = btn.innerHTML;
    btn.innerHTML = 'Adding...'; btn.disabled = true;
    try {
      await api('POST', '/api/staff', {
        name,
        specialty: $('#w-spec').value.trim() || 'General',
        phone: $('#w-phone').value.trim() || '—',
        photo: workerPhotoData || ''
      });
      await loadData();
      toast(`Worker "${name}" added successfully`);
      renderWorkers();
    } catch (err) {
      toast('Error: ' + err.message);
      btn.innerHTML = origHTML; btn.disabled = false;
    }
  });

  workers.forEach(w => {
    $(`#w-toggle-${w.id}`)?.addEventListener('click', () => {
      expandedWorker = expandedWorker === w.id ? null : w.id;
      const tasksEl = $(`#w-tasks-${w.id}`);
      const btnEl   = $(`#w-toggle-${w.id}`);
      if (expandedWorker === w.id) { tasksEl.classList.add('open'); btnEl.classList.add('open'); }
      else                         { tasksEl.classList.remove('open'); btnEl.classList.remove('open'); }
    });
    $(`#w-qr-${w.id}`)?.addEventListener('click', () => showWorkerQR(w));
    $(`#w-del-${w.id}`)?.addEventListener('click', async () => {
      if (!confirm(`Remove worker "${w.name}"?`)) return;
      await api('DELETE', `/api/staff/${w.id}`);
      await loadData(); toast(`Worker "${w.name}" removed`); renderWorkers();
    });
  });
}

function renderWorkerCard(w) {
  const wOrders = orders.filter(o => o.workerId === w.id);
  const active  = wOrders.filter(o => o.status !== 'Completed' && o.status !== 'Delivered');
  const done    = wOrders.filter(o => o.status === 'Completed' || o.status === 'Delivered');
  const overdue = active.filter(o => daysTo(o.deadline) < 0);
  const isOpen  = expandedWorker === w.id;
  const avatar  = w.photo ? `<img src="${w.photo}" alt="${w.name}">` : w.name.charAt(0).toUpperCase();
  return `
    <div class="w-card">
      <div class="w-head">
        <div class="w-info">
          <div class="w-avatar">${avatar}</div>
          <div class="w-meta"><h4>${w.name}</h4><p>${w.specialty||'General'} · ${w.phone||'—'}</p></div>
        </div>
        <div class="w-acts">
          <button class="btn-icon" id="w-qr-${w.id}" title="Worker QR Code">${IC.qr}</button>
          <button class="btn-icon danger" id="w-del-${w.id}" title="Remove">${IC.trash}</button>
        </div>
      </div>
      <div class="w-stats">
        <div class="w-st"><b>${active.length}</b><span>Active</span></div>
        <div class="w-st"><b style="color:var(--red)">${overdue.length}</b><span>Overdue</span></div>
        <div class="w-st"><b style="color:var(--green)">${done.length}</b><span>Done</span></div>
      </div>
      <button class="w-toggle ${isOpen?'open':''}" id="w-toggle-${w.id}">
        ${IC.chev} ${active.length} assigned task${active.length!==1?'s':''}
      </button>
      <div class="w-tasks ${isOpen?'open':''}" id="w-tasks-${w.id}">
        ${active.length
          ? active.sort((a,b) => new Date(a.deadline) - new Date(b.deadline)).map(o => `
            <div class="w-task" onclick="showDetail('${o.id}')">
              <div class="wt-l">
                <span class="wt-name">#${o.id} — ${o.customerName}</span>
                <span class="wt-sub">${o.clothType}</span>
              </div>
              <div style="text-align:right">
                <div>${badge(o.status, o.deadline)}</div>
                <div class="wt-sub">${fmtDate(o.deadline)}</div>
              </div>
            </div>`).join('')
          : '<div style="padding:16px 22px;color:var(--text-muted);font-size:.88rem">No active tasks</div>'}
      </div>
    </div>`;
}

function showWorkerQR(w) {
  /* Determine the correct base URL based on current data mode */
  let workerUrl = '';
  let modeNote  = '';

  if (useFirebase()) {
    /* Firebase mode: worker can be on ANY device anywhere */
    let base = CFG.publicBaseUrl;
    if (!base) {
      base = window.location.href.split('?')[0].split('#')[0].replace(/index\.html$/, '').replace(/\/$/, '');
    }
    workerUrl = `${base}/worker.html?id=${w.id}`;
    modeNote = `<div style="background:rgba(30,122,69,.08);border:1px solid rgba(30,122,69,.2);border-radius:10px;padding:14px;margin-top:16px;font-size:.85rem;color:var(--green)">
      ✅ <strong>Firebase Cloud Mode</strong> — Data sync works anywhere.<br>
      <span style="font-size:0.75rem;opacity:0.8">(If you send this link to a phone, make sure the link itself is a public internet address like GitHub Pages, not 'localhost' or 'file://')</span>
    </div>`;
  } else if (!IS_STATIC && networkIp && networkIp !== 'localhost' && networkIp !== 'Local (offline)') {
    /* Node server mode: worker must be on the same WiFi */
    const port = window.location.port;
    workerUrl = `http://${networkIp}${port ? ':'+port : ''}/worker.html?id=${w.id}`;
    modeNote = `<div style="background:rgba(176,122,0,.08);border:1px solid rgba(176,122,0,.2);border-radius:10px;padding:14px;margin-top:16px;font-size:.85rem;color:var(--yellow)">
      ⚠️ <strong>Local Network Mode</strong> — Worker's phone must be on the <strong>same WiFi</strong> as this computer. Link will not work on mobile data or different WiFi.<br><br>
      <strong>Want it to work anywhere?</strong> Set up Firebase in <code>public/config.js</code>.
    </div>`;
  } else {
    /* Offline/static mode — QR won't sync across devices */
    workerUrl = `${window.location.origin}/worker.html?id=${w.id}`;
    modeNote = `<div style="background:rgba(184,50,50,.08);border:1px solid rgba(184,50,50,.2);border-radius:10px;padding:14px;margin-top:16px;font-size:.85rem;color:var(--red)">
      ❌ <strong>Offline Mode</strong> — Cross-device sync is not available. Workers on other devices cannot see tasks because data is stored only in this browser.<br><br>
      <strong>To fix:</strong> Set up Firebase in <code>public/config.js</code> for any-device access.
    </div>`;
  }

  let qrHtml = '';
  if (typeof qrcode !== 'undefined') {
    try {
      const qr = qrcode(0, 'M');
      qr.addData(workerUrl);
      qr.make();
      qrHtml = qr.createImgTag(6);
    } catch { qrHtml = '<p style="color:var(--text-muted)">(QR generation failed)</p>'; }
  } else {
    qrHtml = '<p style="color:var(--text-muted)">QR library loading...</p>';
  }

  $('#modal-body').innerHTML = `
    <div class="qr-box">
      <h3>Worker Portal — ${w.name}</h3>
      <p style="margin-bottom:16px">${w.specialty||'General'}</p>
      ${qrHtml}
      <div class="qr-url" style="margin-top:16px">${workerUrl}</div>
      ${modeNote}
      <div style="margin-top:18px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
        <button class="btn btn-gold btn-sm" onclick="navigator.clipboard.writeText('${workerUrl}').then(()=>toast('Link copied!'))">Copy Link</button>
        <button class="btn btn-ghost btn-sm" onclick="window.open('${workerUrl}','_blank')">Open in New Tab</button>
      </div>
    </div>`;
  openModal();
}


/* ══════ DELIVERY ══════ */
function renderDelivery() {
  const ready     = orders.filter(o => o.status === 'Completed');
  const delivered = orders.filter(o => o.status === 'Delivered').sort((a,b) => new Date(b.updatedAt) - new Date(a.updatedAt)).slice(0, 10);

  $('#view-delivery').innerHTML = `
    <div class="view-head">
      <div><h2>Delivery &amp; Collection</h2>
        <p class="sub">${ready.length} item${ready.length!==1?'s':''} ready for pickup</p>
      </div>
    </div>
    ${ready.length
      ? `<div class="del-grid">${ready.map(o => {
          const bal = (o.total||0) - (o.advance||0);
          return `<div class="del-card">
            <h4>#${o.id} — ${o.customerName}</h4>
            <div class="del-sub">${o.clothType} · Worker: ${o.worker||'—'}</div>
            <div class="del-meta">
              <div><div class="dm-label">Total</div><div class="dm-value">${fmtCur(o.total)}</div></div>
              <div><div class="dm-label">Advance Paid</div><div class="dm-value">${fmtCur(o.advance)}</div></div>
              <div><div class="dm-label">Balance Due</div><div class="dm-value" style="color:${bal>0?'var(--red)':'var(--green)'}; font-size:1.05rem">${fmtCur(bal)}</div></div>
              <div><div class="dm-label">Customer Phone</div><div class="dm-value">${o.customerPhone||'—'}</div></div>
            </div>
            <div class="del-actions">
              ${bal > 0 ? `<button class="btn btn-gold btn-sm" onclick="clearPayment('${o.id}',${bal})">Clear ₹${bal.toLocaleString('en-IN')}</button>` : ''}
              <button class="btn btn-success btn-sm" onclick="markDelivered('${o.id}')">Mark Delivered</button>
              <button class="btn btn-ghost btn-sm" onclick="showDetail('${o.id}')">View</button>
            </div>
          </div>`;
        }).join('')}</div>`
      : `<div class="empty">${IC.truck}<p>No items ready for delivery right now</p></div>`}
    ${delivered.length ? `
      <div style="margin-top:40px">
        <h3 style="font-family:'Cormorant Garamond',serif;font-size:1.4rem;font-weight:600;margin-bottom:18px">Recently Delivered</h3>
        <div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>Order</th><th>Customer</th><th>Type</th><th>Total</th><th>Delivered</th></tr></thead>
          <tbody>${delivered.map(o => `
            <tr onclick="showDetail('${o.id}')" style="cursor:pointer">
              <td>#${o.id}</td><td>${o.customerName}</td><td>${o.clothType}</td>
              <td>${fmtCur(o.total)}</td><td>${fmtDate(o.updatedAt)}</td>
            </tr>`).join('')}
          </tbody>
        </table></div>
      </div>` : ''}`;
}

window.clearPayment = async function(id, bal) {
  const amt = prompt(`Balance due: ₹${bal.toLocaleString('en-IN')}\nEnter amount received:`, bal);
  if (amt === null) return;
  const received = Number(amt);
  if (isNaN(received) || received <= 0) { toast('Invalid amount'); return; }
  const o = orders.find(x => x.id === id); if (!o) return;
  await api('PUT', `/api/orders/${id}`, { advance: (Number(o.advance)||0) + received });
  await loadData(); toast(`₹${received.toLocaleString('en-IN')} recorded for Order #${id}`); renderDelivery();
};

window.markDelivered = async function(id) {
  if (!confirm(`Mark Order #${id} as delivered?`)) return;
  await api('PUT', `/api/orders/${id}`, { status: 'Delivered' });
  await loadData(); toast(`Order #${id} marked Delivered`); renderDelivery();
};

/* ══════ RECORDS ══════ */
function renderRecords() {
  const completed = orders.filter(o => o.status === 'Completed' || o.status === 'Delivered');
  const grouped = {};
  completed.forEach(o => {
    const key = monthKey(o.updatedAt || o.createdAt);
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(o);
  });
  const months = Object.keys(grouped).sort((a,b) => {
    return new Date(grouped[b][0].updatedAt||grouped[b][0].createdAt) - new Date(grouped[a][0].updatedAt||grouped[a][0].createdAt);
  });

  $('#view-records').innerHTML = `
    <div class="view-head">
      <div><h2>Monthly Records</h2>
        <p class="sub">${completed.length} completed order${completed.length!==1?'s':''} across ${months.length} month${months.length!==1?'s':''}</p>
      </div>
    </div>
    ${months.length ? months.map(m => {
      const list = grouped[m];
      const totalRev = list.reduce((s,o) => s + Number(o.total||0), 0);
      const totalAdv = list.reduce((s,o) => s + Number(o.advance||0), 0);
      return `<div class="rec-month">
        <div class="rec-head" onclick="toggleRecMonth(this)">
          <div>
            <h3>${m}</h3>
            <div class="rec-count">${list.length} order${list.length!==1?'s':''} · Revenue: ${fmtCur(totalRev)} · Collected: ${fmtCur(totalAdv)}</div>
          </div>
          <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();downloadMonth('${m}')">${IC.dl} Download</button>
        </div>
        <div class="rec-body" id="rec-${m.replace(/\s/g,'-')}">
          <table class="tbl">
            <thead><tr><th>Order</th><th>Customer</th><th>Type</th><th>Worker</th><th>Total</th><th>Advance</th><th>Balance</th><th>Date</th></tr></thead>
            <tbody>${list.map(o => `
              <tr onclick="showDetail('${o.id}')" style="cursor:pointer">
                <td>#${o.id}</td><td>${o.customerName}</td><td>${o.clothType}</td><td>${o.worker||'—'}</td>
                <td>${fmtCur(o.total)}</td><td>${fmtCur(o.advance)}</td>
                <td style="color:${(o.total||0)-(o.advance||0)>0?'var(--red)':'var(--green)'}">${fmtCur((o.total||0)-(o.advance||0))}</td>
                <td>${fmtDate(o.updatedAt||o.createdAt)}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>`;
    }).join('') : '<div class="empty"><p>No completed records yet</p></div>'}`;
}

window.toggleRecMonth = function(el) { el.nextElementSibling.classList.toggle('open'); };

window.downloadMonth = function(monthName) {
  if (typeof XLSX === 'undefined') { toast('Excel library not loaded — check internet'); return; }
  const list = orders.filter(o => (o.status === 'Completed' || o.status === 'Delivered') && monthKey(o.updatedAt||o.createdAt) === monthName);
  const data = list.map(o => ({
    'Order ID': o.id, 'Customer': o.customerName, 'Phone': o.customerPhone,
    'Cloth Type': o.clothType, 'Worker': o.worker||'', 'Status': o.status,
    'Total (₹)': o.total, 'Advance (₹)': o.advance, 'Balance (₹)': (o.total||0)-(o.advance||0),
    'Deadline': o.deadline, 'Completed On': fmtDate(o.updatedAt||o.createdAt), 'Notes': o.notes||''
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), monthName.substring(0,31));
  XLSX.writeFile(wb, `PallaviBoutiques_${monthName.replace(/\s/g,'_')}.xlsx`);
  toast(`Downloaded ${monthName} records`);
};

/* ══════ CUSTOMERS ══════ */
let custSearch = '';

function renderCustomers() {
  const map = {};
  orders.forEach(o => {
    const key = o.customerPhone || o.customerName;
    if (!map[key]) map[key] = { name: o.customerName, phone: o.customerPhone, orders: 0, spent: 0, balance: 0 };
    map[key].orders++;
    map[key].spent   += Number(o.total || 0);
    map[key].balance += (Number(o.total||0) - Number(o.advance||0));
    map[key].name = o.customerName;
  });
  let custs = Object.values(map);
  if (custSearch) {
    const q = custSearch.toLowerCase();
    custs = custs.filter(c => c.name.toLowerCase().includes(q) || (c.phone||'').includes(q));
  }
  custs.sort((a,b) => a.name.localeCompare(b.name));

  $('#view-customers').innerHTML = `
    <div class="view-head">
      <h2>Customers</h2>
      <div class="search-wrap">${IC.search}<input type="text" id="cust-search" placeholder="Search customers..." value="${custSearch}"></div>
    </div>
    ${custs.length
      ? `<div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>Name</th><th>Phone</th><th>Orders</th><th>Total Spent</th><th>Balance Due</th></tr></thead>
          <tbody>${custs.map(c => `
            <tr>
              <td><strong>${c.name}</strong></td>
              <td>${c.phone||'—'}</td>
              <td>${c.orders}</td>
              <td>${fmtCur(c.spent)}</td>
              <td style="color:${c.balance>0?'var(--red)':'var(--green)'};font-weight:600">${fmtCur(c.balance)}</td>
            </tr>`).join('')}
          </tbody>
        </table></div>`
      : `<div class="empty"><p>No customers yet</p></div>`}`;

  const sEl = $('#cust-search');
  if (sEl) {
    sEl.addEventListener('input', e => { custSearch = e.target.value; renderCustomers(); });
    sEl.focus();
    sEl.setSelectionRange(sEl.value.length, sEl.value.length);
  }
}

/* ══════ EXCEL EXPORT / IMPORT ══════ */
$('#btn-export').addEventListener('click', () => {
  if (typeof XLSX === 'undefined') { toast('Excel library not loaded — check internet connection'); return; }
  const ordData = orders.map(o => ({
    'Order ID': o.id, 'Customer': o.customerName, 'Phone': o.customerPhone,
    'Cloth Type': o.clothType, 'Details': o.clothDetails||'', 'Worker': o.worker||'',
    'Status': o.status, 'Total (₹)': o.total, 'Advance (₹)': o.advance,
    'Balance (₹)': (o.total||0)-(o.advance||0), 'Payment': o.paymentMethod||'cash',
    'Deadline': o.deadline, 'Notes': o.notes||'', 'Worker Note': o.workerNote||'',
    'Chest': o.measurements?.chest||'', 'Waist': o.measurements?.waist||'',
    'Hip': o.measurements?.hip||'', 'Shoulder': o.measurements?.shoulder||'',
    'Sleeve': o.measurements?.sleeve||'', 'Length': o.measurements?.length||'',
    'Created': o.createdAt||'', 'Updated': o.updatedAt||''
  }));
  const wrkData = workers.map(w => ({ 'ID': w.id, 'Name': w.name, 'Specialty': w.specialty, 'Phone': w.phone }));
  const wb = XLSX.utils.book_new();
  const ws1 = XLSX.utils.json_to_sheet(ordData);
  ws1['!cols'] = [{wch:10},{wch:18},{wch:14},{wch:14},{wch:24},{wch:12},{wch:14},{wch:10},{wch:10},{wch:10},{wch:8},{wch:12},{wch:20},{wch:20},{wch:7},{wch:7},{wch:7},{wch:9},{wch:7},{wch:7},{wch:20},{wch:20}];
  XLSX.utils.book_append_sheet(wb, ws1, 'Orders');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(wrkData), 'Workers');
  XLSX.writeFile(wb, `PallaviBoutiques_${new Date().toISOString().split('T')[0]}.xlsx`);
  toast('Excel exported successfully!');
});

$('#btn-import').addEventListener('click', () => $('#file-import').click());
$('#file-import').addEventListener('change', async e => {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = async evt => {
    try {
      const wb = XLSX.read(evt.target.result, { type: 'array' });
      if (wb.SheetNames.includes('Orders')) {
        const rows = XLSX.utils.sheet_to_json(wb.Sheets['Orders']);
        for (const r of rows) {
          const data = {
            customerName: r['Customer']||'', customerPhone: String(r['Phone']||''),
            clothType: r['Cloth Type']||'', clothDetails: r['Details']||'',
            worker: r['Worker']||'', status: r['Status']||'Pending',
            total: Number(r['Total (₹)']||0), advance: Number(r['Advance (₹)']||0),
            deadline: r['Deadline']||'', notes: r['Notes']||'',
            paymentMethod: r['Payment']||'cash', photos: [],
            measurements: { chest: String(r['Chest']||''), waist: String(r['Waist']||''), hip: String(r['Hip']||''), shoulder: String(r['Shoulder']||''), sleeve: String(r['Sleeve']||''), length: String(r['Length']||'') }
          };
          const existing = orders.find(o => o.id === String(r['Order ID']));
          if (existing) await api('PUT', `/api/orders/${existing.id}`, data);
          else await api('POST', '/api/orders', data);
        }
      }
      if (wb.SheetNames.includes('Workers')) {
        const rows = XLSX.utils.sheet_to_json(wb.Sheets['Workers']);
        for (const r of rows) {
          if (!workers.find(w => w.name === r['Name']))
            await api('POST', '/api/staff', { name: r['Name']||'', specialty: r['Specialty']||'General', phone: String(r['Phone']||'—') });
        }
      }
      await loadData(); toast(`Imported from "${file.name}"`); switchView('dashboard');
    } catch (err) { toast('Error reading file: ' + err.message); }
  };
  reader.readAsArrayBuffer(file);
  e.target.value = '';
});

/* ══════ SSE (real-time, only when server is running) ══════ */
function connectSSE() {
  if (IS_STATIC) return; // no SSE on static hosting
  try {
    const es = new EventSource('/api/events');
    es.addEventListener('task-completed', async e => {
      const data = JSON.parse(e.data);
      await loadData();
      const ribbon = $('#ribbon');
      $('#ribbon-msg').textContent = data.message;
      ribbon.classList.add('show');
      $('#bell-dot').style.display = 'block';
      setTimeout(() => ribbon.classList.remove('show'), 8000);
      const activeView = document.querySelector('.view.active')?.id?.replace('view-','');
      if (activeView === 'dashboard') renderDashboard();
      if (activeView === 'orders')    renderOrders();
      if (activeView === 'workers')   renderWorkers();
      if (activeView === 'delivery')  renderDelivery();
    });
    es.addEventListener('order-created', async () => { await loadData(); });
    es.addEventListener('order-updated', async () => { await loadData(); });
    es.addEventListener('order-deleted', async () => { await loadData(); });
    es.onerror = () => setTimeout(connectSSE, 5000);
  } catch {}
}

$('#ribbon-close')?.addEventListener('click', () => $('#ribbon').classList.remove('show'));

/* ══════ GLOBAL HANDLERS ══════ */
window.showDetail   = showDetail;
window.editOrder    = editOrder;
window.deleteOrder  = deleteOrder;
window.quickStatus  = quickStatus;
window.closeModal   = closeModal;
window.switchView   = switchView;

/* ══════ INIT ══════ */
(async function init() {
  await loadData();
  renderDashboard();
  connectSSE();
})();
