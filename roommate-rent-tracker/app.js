// Roommate Rent & Light Bill Tracker
// Synced with Cloudflare Worker + D1 (shared data for all browsers)

(function () {
  'use strict';

  const STORAGE_KEY = 'roommate_rent_tracker_v5';
  const API_URL = 'https://room-no-12-backend.kalpeshbagul2619.workers.dev/api/state';
  const VERIFY_URL = 'https://room-no-12-backend.kalpeshbagul2619.workers.dev/api/verify';
  const LOGIN_URL = 'https://room-no-12-backend.kalpeshbagul2619.workers.dev/api/login';
  const ROOMMATES_URL = 'https://room-no-12-backend.kalpeshbagul2619.workers.dev/api/roommates';
  const EXPENSES_URL = 'https://room-no-12-backend.kalpeshbagul2619.workers.dev/api/expenses';
  const PAYMENTS_URL = 'https://room-no-12-backend.kalpeshbagul2619.workers.dev/api/payments';
  const CLEANING_URL = 'https://room-no-12-backend.kalpeshbagul2619.workers.dev/api/cleaning';

  const defaultData = {
    flatName: 'ROOM NO 12',
    activeMonth: 'October 2026',
    dueNote: 'Due by 9th of every month',
    upiId: '8459807346@slc',
    adminPhone: '918459807346',
    razorpayKey: '',
    bill: {
      roomRent: 8500,
      buildingMaintenance: 500,
      cleaningMaintenance: 500,
      lightBill: 670,
      lightMeterPrev: 1250,
      lightMeterCurr: 1355,
      lightRatePerUnit: 9.5
    },
    roommates: [
      { id: '1', name: 'Harshal', status: 'pending', paidOn: null, utr: null, method: null, paidAt: null },
      { id: '2', name: 'Kalpesh (You)', status: 'paid', paidOn: '02 Oct', utr: 'Self / Host', method: 'Direct Transfer', paidAt: '02 Oct 2026, 10:00 AM' },
      { id: '3', name: 'Chetan', status: 'pending', paidOn: null, utr: null, method: null, paidAt: null },
      { id: '4', name: 'Chirag', status: 'pending', paidOn: null, utr: null, method: null, paidAt: null },
      { id: '5', name: 'Onkar', status: 'pending', paidOn: null, utr: null, method: null, paidAt: null }
    ],
    history: []
  };

  const AUTH_USERS = [
    { id: 'chirag', display: 'Chirag', pass: 'chirag', roommateId: '4' },
    { id: 'harshal', display: 'Harshal', pass: 'harshal', roommateId: '1' },
    { id: 'chetan', display: 'Chetan', pass: 'chetan', roommateId: '3' },
    { id: 'onkar', display: 'Onkar', pass: 'onkar', roommateId: '5' },
    { id: 'kalpesh', display: 'Kalpesh', pass: 'kalpesh', roommateId: '2', isAdmin: true }
  ];

  let appState = loadState();
  let currentLoggedInUser = null;
  let isAdminAuthenticated = false;
  let adminPinValue = null; // kept in memory only, never stored
  let activePayingRoommate = null;
  let activeReceiptRoommate = null;

  function isMobileDevice() {
    return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (window.innerWidth <= 768 && ('ontouchstart' in window));
  }

  function safeUtf8ToBase64(str) {
    try {
      return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, function (match, p1) {
        return String.fromCharCode(parseInt(p1, 16));
      }));
    } catch (e) {
      return btoa(unescape(encodeURIComponent(str)));
    }
  }

  function safeBase64ToUtf8(str) {
    try {
      return decodeURIComponent(Array.prototype.map.call(atob(str), function (c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
      }).join(''));
    } catch (e) {
      return decodeURIComponent(escape(atob(str)));
    }
  }

  // Shared bill maths (used everywhere)
  function getTotals() {
    const rent = Number(appState.bill.roomRent) || 8500;
    const bldgMaint = Number(appState.bill.buildingMaintenance) || 500;
    const cleanMaint = Number(appState.bill.cleaningMaintenance) || 500;
    const light = Number(appState.bill.lightBill) || 0;
    const total = rent + bldgMaint + cleanMaint + light;
    const count = appState.roommates.length || 5;
    const perHead = Math.round(total / count);
    return { rent, bldgMaint, cleanMaint, light, total, count, perHead };
  }

  document.addEventListener('DOMContentLoaded', () => {
    checkUrlForSharedData();
    initMonthSelector();
    initAuth();
    renderAll();
    setupEventListeners();
    loadRemoteState();
  });

  // ---------- STATE: local cache + Cloudflare server ----------

  function loadState() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY) || localStorage.getItem('roommate_rent_tracker_v4');
      if (stored) {
        const parsed = JSON.parse(stored);
        return {
          ...defaultData,
          ...parsed,
          flatName: (parsed.flatName === 'Flat Bills' || !parsed.flatName) ? 'ROOM NO 12' : parsed.flatName,
          bill: { ...defaultData.bill, ...(parsed.bill || {}) },
          roommates: Array.isArray(parsed.roommates) && parsed.roommates.length > 0 ? parsed.roommates : defaultData.roommates
        };
      }
    } catch (e) {
      console.warn('Failed to parse localStorage state:', e);
    }
    return defaultData;
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));
    } catch (e) {
      console.error('Error saving state to localStorage', e);
    }
    pushRemoteState();
  }

  // Only the admin (who typed the correct PIN) can save to the server
  async function pushRemoteState() {
    if (!isAdminAuthenticated || !adminPinValue) {
      showToast('⚠️ Changes saved locally only. Click Admin Mode and enter PIN to sync to everyone!');
      return;
    }
    const { adminPin, ...dataToSave } = appState; // never upload any PIN
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Pin': adminPinValue },
        body: JSON.stringify(dataToSave)
      });
      if (res.status === 401) showToast('❌ Wrong Admin PIN. Not saved to server.');
      else if (!res.ok) showToast('❌ Server save failed. Try again.');
      else showToast('✅ Saved to Cloudflare D1 for everyone!');
    } catch (e) {
      showToast('⚠️ No internet. Saved on this device only.');
    }
  }

  async function verifyAdminPin(pin) {
    try {
      const res = await fetch(VERIFY_URL, { method: 'POST', headers: { 'X-Admin-Pin': pin } });
      return res.ok;
    } catch (e) {
      return false;
    }
  }

  let isSyncing = false;
  async function loadRemoteState(silent = false) {
    if (isSyncing) return;
    isSyncing = true;
    try {
      const res = await fetch(API_URL + '?t=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) return;
      const remoteData = await res.json();
      if (remoteData && typeof remoteData === 'object' && remoteData.bill) {
        appState = {
          ...defaultData,
          ...remoteData,
          flatName: remoteData.flatName || 'ROOM NO 12',
          bill: { ...defaultData.bill, ...(remoteData.bill || {}) },
          roommates: Array.isArray(remoteData.roommates) && remoteData.roommates.length > 0
            ? remoteData.roommates
            : defaultData.roommates
        };
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(appState)); } catch (e) {}
        renderAll();
      }
    } catch (e) {
      if (!silent) console.warn('Server load failed:', e);
    } finally {
      isSyncing = false;
    }
  }

  // Old WhatsApp share links (#data=...) still work
  function checkUrlForSharedData() {
    try {
      if (window.location.hash && window.location.hash.startsWith('#data=')) {
        const rawB64 = window.location.hash.replace('#data=', '');
        const sharedData = JSON.parse(safeBase64ToUtf8(rawB64));

        if (sharedData && sharedData.bill && Array.isArray(sharedData.roommates)) {
          appState = {
            ...appState,
            ...sharedData,
            bill: { ...defaultData.bill, ...(sharedData.bill || {}) }
          };
          try { localStorage.setItem(STORAGE_KEY, JSON.stringify(appState)); } catch (e) {}

          const banner = document.getElementById('syncBanner');
          const bannerMsg = document.getElementById('syncBannerMsg');
          if (banner && bannerMsg) {
            bannerMsg.textContent = `Latest bills loaded for ${appState.activeMonth}!`;
            banner.classList.remove('hidden');
          }
          history.replaceState(null, document.title, window.location.pathname + window.location.search);
        }
      }
    } catch (err) {
      console.warn('Could not parse shared link data:', err);
    }
  }

  // ---------- AUTH (roommate login) ----------

  function initAuth() {
    try {
      const stored = localStorage.getItem('roommate_logged_in_user');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed && parsed.id) {
          const matched = AUTH_USERS.find(u => u.id.toLowerCase() === parsed.id.toLowerCase()) || {
            id: parsed.id,
            display: parsed.display || parsed.name,
            roommateId: parsed.roommateId || parsed.id,
            isAdmin: !!parsed.isAdmin
          };
          currentLoggedInUser = matched;
          const loginScreen = document.getElementById('loginScreen');
          if (loginScreen) loginScreen.classList.add('hidden');
          updateUserHeaderBadge();
          loadUpiDirectory();
          loadExpenses();
          loadCleaningRoster();
          renderPersonalDashboard();
          return;
        }
      }
    } catch (e) {
      console.warn('Error restoring user session:', e);
    }

    const loginScreen = document.getElementById('loginScreen');
    if (loginScreen) loginScreen.classList.remove('hidden');
    updateUserHeaderBadge();
  }

  async function handleLogin(username, password) {
    const cleanUser = (username || '').trim().toLowerCase();
    const cleanPass = (password || '').trim();

    // 1. Authenticate with Cloudflare Worker Phase 0 endpoint
    try {
      const res = await fetch(LOGIN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: cleanUser, pin: cleanPass })
      });
      if (res.ok) {
        const data = await res.json();
        if (data && data.success && data.user) {
          currentLoggedInUser = {
            id: data.user.id,
            display: data.user.name,
            roommateId: data.user.id,
            isAdmin: !!data.user.isAdmin,
            upiId: data.user.upiId || ''
          };
          if (data.token) localStorage.setItem('roommate_token', data.token);
          localStorage.setItem('roommate_logged_in_user', JSON.stringify(currentLoggedInUser));

          const loginScreen = document.getElementById('loginScreen');
          if (loginScreen) loginScreen.classList.add('hidden');
          const errorMsg = document.getElementById('loginErrorMsg');
          if (errorMsg) errorMsg.classList.add('hidden');

          updateUserHeaderBadge();
          renderAll();
          loadUpiDirectory();
          loadExpenses();
          loadCleaningRoster();
          renderPersonalDashboard();
          showToast(`Welcome back, ${data.user.name}!`);
          return true;
        }
      }
    } catch (err) {
      console.warn('Cloudflare login error, falling back to local list:', err);
    }

    // 2. Offline fallback
    const matched = AUTH_USERS.find(u =>
      (u.id.toLowerCase() === cleanUser || u.display.toLowerCase() === cleanUser) &&
      (u.pass === cleanPass || u.pass.toLowerCase() === cleanPass.toLowerCase())
    );

    if (matched) {
      currentLoggedInUser = matched;
      localStorage.setItem('roommate_logged_in_user', JSON.stringify({
        id: matched.id,
        display: matched.display,
        roommateId: matched.roommateId,
        isAdmin: !!matched.isAdmin
      }));

      const loginScreen = document.getElementById('loginScreen');
      if (loginScreen) loginScreen.classList.add('hidden');
      const errorMsg = document.getElementById('loginErrorMsg');
      if (errorMsg) errorMsg.classList.add('hidden');

      updateUserHeaderBadge();
      renderAll();
      loadUpiDirectory();
      loadExpenses();
      loadCleaningRoster();
      renderPersonalDashboard();
      showToast(`Welcome back, ${matched.display}!`);
      return true;
    } else {
      const errorMsg = document.getElementById('loginErrorMsg');
      if (errorMsg) errorMsg.classList.remove('hidden');
      return false;
    }
  }

  function handleLogout() {
    currentLoggedInUser = null;
    localStorage.removeItem('roommate_logged_in_user');
    localStorage.removeItem('roommate_token');
    isAdminAuthenticated = false;
    adminPinValue = null;

    const loginScreen = document.getElementById('loginScreen');
    if (loginScreen) {
      loginScreen.classList.remove('hidden');
      const passField = document.getElementById('loginPassword');
      if (passField) passField.value = '';
    }

    const adminPanel = document.getElementById('adminPanel');
    if (adminPanel) adminPanel.classList.add('hidden');

    const dashSection = document.getElementById('personalDashboardSection');
    if (dashSection) dashSection.classList.add('hidden');

    updateUserHeaderBadge();
    renderAll();
    showToast('Logged out successfully.');
  }

  function updateUserHeaderBadge() {
    const userBadge = document.getElementById('userBadge');
    const loggedInUserName = document.getElementById('loggedInUserName');
    if (!userBadge || !loggedInUserName) return;

    if (currentLoggedInUser) {
      loggedInUserName.textContent = currentLoggedInUser.display;
      userBadge.classList.remove('hidden');
    } else {
      userBadge.classList.add('hidden');
    }

    if (window.lucide) window.lucide.createIcons();
  }

  window.selectLoginUser = function (name) {
    const userField = document.getElementById('loginUsername');
    const passField = document.getElementById('loginPassword');
    const err = document.getElementById('loginErrorMsg');
    if (err) err.classList.add('hidden');
    if (userField) userField.value = name;
    if (passField) passField.focus();
  };

  // ---------- EXPORT / SHARE ----------

  function exportPayload() {
    return {
      flatName: appState.flatName || 'ROOM NO 12',
      activeMonth: appState.activeMonth,
      dueNote: appState.dueNote,
      upiId: appState.upiId,
      adminPhone: appState.adminPhone,
      razorpayKey: appState.razorpayKey,
      bill: appState.bill,
      roommates: appState.roommates
    };
  }

  function downloadDataJson() {
    try {
      const blob = new Blob([JSON.stringify(exportPayload(), null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'data.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast('Backup data.json downloaded.');
    } catch (err) {
      console.error('Error generating data.json download:', err);
    }
  }

  function getShareableUrl() {
    // The site now loads shared data from the server, so a plain link is enough
    return window.location.origin + window.location.pathname;
  }

  // ---------- MONTH SELECTOR ----------

  function initMonthSelector() {
    const monthSelect = document.getElementById('monthSelect');
    if (!monthSelect) return;

    const months = ['January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'];
    const currYear = new Date().getFullYear();

    const options = [];
    for (let y = currYear; y <= currYear + 1; y++) {
      for (let m = 0; m < 12; m++) options.push(`${months[m]} ${y}`);
    }
    if (appState.activeMonth && !options.includes(appState.activeMonth)) {
      options.unshift(appState.activeMonth);
    }

    monthSelect.innerHTML = options.map(m => {
      const selected = m === appState.activeMonth ? 'selected' : '';
      return `<option value="${escapeHtml(m)}" ${selected} class="bg-slate-800 text-white">${escapeHtml(m)}</option>`;
    }).join('');

    monthSelect.addEventListener('change', (e) => {
      if (!isAdminAuthenticated) {
        showToast('Only admin can change the month.');
        monthSelect.value = appState.activeMonth;
        return;
      }
      appState.activeMonth = e.target.value;
      const adminMonthInput = document.getElementById('inputAdminMonth');
      if (adminMonthInput) adminMonthInput.value = e.target.value;
      saveState();
      renderAll();
    });
  }

  function buildUpiUri(amount, roommateName) {
    const upiId = appState.upiId || '8459807346@slc';
    const note = encodeURIComponent(`${roommateName} ${appState.activeMonth} Rent & Bills`);
    const name = encodeURIComponent(appState.flatName || 'Flat Rent');
    return `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${name}&am=${amount}&tn=${note}&cu=INR`;
  }

  // ---------- RENDER ----------

  function renderAll() {
    const { rent, bldgMaint, cleanMaint, light, total, count, perHead } = getTotals();
    const $ = (id) => document.getElementById(id);
    const inr = (n) => `₹${n.toLocaleString('en-IN')}`;

    $('headerFlatName').textContent = appState.flatName;
    $('headerMonthBadge').textContent = appState.activeMonth;
    $('activeMonthTitle').textContent = appState.activeMonth;
    $('dueDateNotice').textContent = appState.dueNote || 'Due by 5th of every month';
    $('breakdownMonth').textContent = appState.activeMonth;

    $('statRentTotal').textContent = inr(rent);
    $('statMaintenanceTotal').textContent = inr(bldgMaint + cleanMaint);
    $('statMaintenanceSubtext').textContent = `₹${bldgMaint} bldg + ₹${cleanMaint} clean`;
    $('statLightTotal').textContent = inr(light);
    $('statPerPerson').textContent = inr(perHead);
    $('statRoommateCount').textContent = `for ${count} roommates`;

    $('detailRent').textContent = inr(rent);
    $('detailBuildingMaint').textContent = inr(bldgMaint);
    $('detailCleaningMaint').textContent = inr(cleanMaint);
    $('detailLight').textContent = inr(light);
    $('detailGrandTotal').textContent = inr(total);
    $('detailSplitPerHead').textContent = `${inr(perHead)} / person`;

    $('inputRoomRent').value = appState.bill.roomRent;
    $('inputBuildingMaint').value = appState.bill.buildingMaintenance;
    $('inputCleaningMaint').value = appState.bill.cleaningMaintenance;
    $('inputLightBill').value = appState.bill.lightBill;
    $('inputUpiId').value = appState.upiId || '8459807346@slc';
    $('inputAdminPhone').value = appState.adminPhone || '';
    $('inputRazorpayKey').value = appState.razorpayKey || '';

    if ($('inputDueNote')) $('inputDueNote').value = appState.dueNote || 'Due by 5th of every month';
    if ($('inputAdminMonth')) $('inputAdminMonth').value = appState.activeMonth;

    const monthSelect = $('monthSelect');
    if (monthSelect) {
      let exists = false;
      for (let i = 0; i < monthSelect.options.length; i++) {
        if (monthSelect.options[i].value === appState.activeMonth) { exists = true; break; }
      }
      if (!exists && appState.activeMonth) {
        const opt = document.createElement('option');
        opt.value = appState.activeMonth;
        opt.textContent = appState.activeMonth;
        opt.className = 'bg-slate-800 text-white';
        monthSelect.appendChild(opt);
      }
      monthSelect.value = appState.activeMonth;
    }

    if ($('calcPrevUnits') && !$('calcPrevUnits').value) $('calcPrevUnits').value = appState.bill.lightMeterPrev || '';
    if ($('calcCurrUnits') && !$('calcCurrUnits').value) $('calcCurrUnits').value = appState.bill.lightMeterCurr || '';
    if ($('calcRatePerUnit') && !$('calcRatePerUnit').value) $('calcRatePerUnit').value = appState.bill.lightRatePerUnit || 9.5;

    $('adminRoommateCount').textContent = appState.roommates.length;

    renderRoommateCards(perHead);
    renderPersonalDashboard();

    if (window.lucide) window.lucide.createIcons();
  }

  function renderRoommateCards(perHead) {
    const container = document.getElementById('roommateListContainer');
    if (!container) return;

    let paidCount = 0;
    let pendingCount = 0;

    container.innerHTML = appState.roommates.map(r => {
      const isPaid = r.status === 'paid';
      if (isPaid) paidCount++; else pendingCount++;

      const statusBadge = isPaid
        ? `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
             <i data-lucide="check" class="w-3.5 h-3.5"></i> Paid ${r.paidOn ? `(${escapeHtml(r.paidOn)})` : ''}
           </span>`
        : `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-300">
             <i data-lucide="clock" class="w-3.5 h-3.5"></i> Pending
           </span>`;

      const adminActions = isAdminAuthenticated ? `
        <div class="pt-3 mt-3 border-t border-slate-100 flex items-center justify-between text-xs">
          <div class="flex items-center gap-1.5 text-slate-400 font-medium truncate max-w-[200px]">
            <i data-lucide="shield" class="w-3.5 h-3.5 text-emerald-600 shrink-0"></i>
            <span class="truncate">${r.utr ? `Ref: <span class="font-mono text-slate-700">${escapeHtml(r.utr)}</span>` : 'Admin control:'}</span>
          </div>
          <button onclick="window.toggleRoommateStatus('${r.id}')"
                  class="px-2.5 py-1 rounded-lg font-semibold border ${isPaid ? 'border-amber-300 text-amber-700 hover:bg-amber-50' : 'border-emerald-300 text-emerald-700 hover:bg-emerald-50'} transition shrink-0">
            Mark as ${isPaid ? 'Pending' : 'Paid'}
          </button>
        </div>
      ` : '';

      const upiUri = buildUpiUri(perHead, r.name);

      const isCurrentUser = currentLoggedInUser && (
        r.name.toLowerCase().includes(currentLoggedInUser.display.toLowerCase()) ||
        currentLoggedInUser.display.toLowerCase().includes(r.name.toLowerCase())
      );

      return `
        <div class="bg-white border ${isCurrentUser ? 'border-emerald-500 ring-2 ring-emerald-500/30 shadow-md' : (isPaid ? 'border-slate-200' : 'border-amber-200/80 shadow-sm')} rounded-2xl p-5 flex flex-col justify-between transition hover:shadow-md">
          <div class="flex items-start justify-between gap-3">
            <div class="flex items-center gap-3">
              <div class="w-11 h-11 rounded-xl ${isCurrentUser ? 'bg-emerald-600 text-white shadow-emerald-500/30' : (isPaid ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700')} font-bold flex items-center justify-center text-sm shadow-sm">
                ${escapeHtml(r.name.charAt(0).toUpperCase())}
              </div>
              <div>
                <div class="flex items-center gap-1.5 flex-wrap">
                  <h4 class="font-bold text-slate-900 text-base leading-tight">${escapeHtml(r.name)}</h4>
                  ${isCurrentUser ? '<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-100 text-emerald-800 border border-emerald-300">You</span>' : ''}
                </div>
                <div class="mt-1">${statusBadge}</div>
              </div>
            </div>

            <div class="text-right">
              <span class="text-xs text-slate-400 block font-medium">Share</span>
              <span class="text-lg font-black ${isPaid ? 'text-slate-800' : 'text-emerald-600'}">₹${perHead.toLocaleString('en-IN')}</span>
            </div>
          </div>

          <div class="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
            ${isPaid ? `
              <button onclick="window.openReceiptModal('${r.id}')"
                      class="flex-1 py-2.5 px-3 rounded-xl text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-800 flex items-center justify-center gap-1.5 transition border border-slate-200">
                <i data-lucide="receipt" class="w-4 h-4 text-emerald-600"></i>
                <span>View Receipt & Proof</span>
              </button>
            ` : `
              <a href="${upiUri}" onclick="window.handlePaymentRedirectClick(event, '${r.id}')"
                 class="flex-1 py-2.5 px-3 rounded-xl text-xs font-black bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white flex items-center justify-center gap-1.5 transition shadow-md shadow-emerald-600/30">
                <i data-lucide="zap" class="w-4 h-4 text-amber-300"></i>
                <span>Pay ₹${perHead.toLocaleString('en-IN')} (Opens UPI App)</span>
              </a>
            `}
          </div>

          ${adminActions}
        </div>
      `;
    }).join('');

    document.getElementById('badgePaidCount').textContent = `${paidCount} Paid`;
    document.getElementById('badgePendingCount').textContent = `${pendingCount} Pending`;
  }

  // ---------- EVENT LISTENERS ----------

  function setupEventListeners() {
    const adminToggleBtn = document.getElementById('adminToggleBtn');
    const adminPanel = document.getElementById('adminPanel');
    const closeAdminBtn = document.getElementById('closeAdminBtn');

    adminToggleBtn.addEventListener('click', () => {
      if (isAdminAuthenticated) {
        adminPanel.classList.toggle('hidden');
      } else {
        document.getElementById('adminPinModal').classList.remove('hidden');
        document.getElementById('adminPinInput').value = '';
        document.getElementById('adminPinError').classList.add('hidden');
        document.getElementById('adminPinInput').focus();
      }
    });

    closeAdminBtn.addEventListener('click', () => {
      adminPanel.classList.add('hidden');
    });

    // Admin PIN is verified by the Cloudflare Worker (ADMIN_PIN secret)
    const adminPinSubmitBtn = document.getElementById('adminPinSubmitBtn');
    const adminPinInput = document.getElementById('adminPinInput');

    const handlePinVerify = async () => {
      const pin = adminPinInput.value.trim();
      const ok = await verifyAdminPin(pin);
      if (ok) {
        adminPinValue = pin;
        isAdminAuthenticated = true;
        document.getElementById('adminPinModal').classList.add('hidden');
        document.getElementById('adminPanel').classList.remove('hidden');
        document.getElementById('adminToggleText').textContent = 'Admin (Active)';
        adminToggleBtn.classList.remove('bg-slate-100', 'text-slate-700');
        adminToggleBtn.classList.add('bg-emerald-600', 'text-white');
        renderAll();
      } else {
        document.getElementById('adminPinError').classList.remove('hidden');
      }
    };

    adminPinSubmitBtn.addEventListener('click', handlePinVerify);
    adminPinInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') handlePinVerify();
    });

    // Bill form
    document.getElementById('billForm').addEventListener('submit', (e) => {
      e.preventDefault();
      if (!isAdminAuthenticated) {
        showToast('Only admin can save changes.');
        return;
      }
      appState.bill.roomRent = Number(document.getElementById('inputRoomRent').value) || 0;
      appState.bill.buildingMaintenance = Number(document.getElementById('inputBuildingMaint').value) || 0;
      appState.bill.cleaningMaintenance = Number(document.getElementById('inputCleaningMaint').value) || 0;
      appState.bill.lightBill = Number(document.getElementById('inputLightBill').value) || 0;
      appState.upiId = document.getElementById('inputUpiId').value.trim() || '8459807346@slc';
      appState.adminPhone = document.getElementById('inputAdminPhone').value.trim();
      appState.razorpayKey = document.getElementById('inputRazorpayKey').value.trim();

      const newMonth = document.getElementById('inputAdminMonth') ? document.getElementById('inputAdminMonth').value.trim() : '';
      if (newMonth) appState.activeMonth = newMonth;

      const newDue = document.getElementById('inputDueNote') ? document.getElementById('inputDueNote').value.trim() : '';
      if (newDue) appState.dueNote = newDue;

      // Admin PIN is now changed only in Cloudflare (ADMIN_PIN secret)
      const pinBox = document.getElementById('inputAdminPinChange');
      if (pinBox && pinBox.value.trim()) {
        showToast('To change the PIN, edit the ADMIN_PIN secret in Cloudflare.');
        pinBox.value = '';
      }

      saveState();
      renderAll();
    });

    // Light calculator
    const toggleLightCalcBtn = document.getElementById('toggleLightCalcBtn');
    const lightCalcSection = document.getElementById('lightCalcSection');
    toggleLightCalcBtn.addEventListener('click', () => {
      lightCalcSection.classList.toggle('hidden');
    });

    document.getElementById('applyLightCalcBtn').addEventListener('click', () => {
      const prev = Number(document.getElementById('calcPrevUnits').value);
      const curr = Number(document.getElementById('calcCurrUnits').value);
      const rate = Number(document.getElementById('calcRatePerUnit').value);

      if (curr >= prev && rate > 0) {
        const totalUnits = curr - prev;
        const totalCost = Math.round(totalUnits * rate);
        document.getElementById('inputLightBill').value = totalCost;
        appState.bill.lightBill = totalCost;
        appState.bill.lightMeterPrev = prev;
        appState.bill.lightMeterCurr = curr;
        appState.bill.lightRatePerUnit = rate;
        saveState();
        renderAll();
        lightCalcSection.classList.add('hidden');
        showToast(`Calculated: ${totalUnits} units × ₹${rate} = ₹${totalCost}`);
      } else {
        alert('Please enter valid readings (Current units must be greater than previous units).');
      }
    });

    // Share link
    document.getElementById('copyShareLinkBtn').addEventListener('click', () => {
      const shareUrl = getShareableUrl();
      navigator.clipboard.writeText(shareUrl).then(() => {
        showToast('Website link copied! Roommates will see the latest bills.');
      }).catch(() => {
        prompt('Copy this link to share with roommates:', shareUrl);
      });
    });

    // WhatsApp share
    document.getElementById('whatsappShareBtn').addEventListener('click', () => {
      const { rent, bldgMaint, cleanMaint, light, total, count, perHead } = getTotals();
      const shareUrl = getShareableUrl();

      let text = `🏠 *Room Rent & Light Bill Breakdown - ${appState.activeMonth}*\n`;
      text += `━━━━━━━━━━━━━━━━━━━━━\n`;
      text += `💰 *Room Rent:* ₹${rent.toLocaleString('en-IN')}\n`;
      text += `🏢 *Building Maintenance:* ₹${bldgMaint.toLocaleString('en-IN')}\n`;
      text += `🧹 *Room Cleaning:* ₹${cleanMaint.toLocaleString('en-IN')}\n`;
      text += `⚡ *Light Bill:* ₹${light.toLocaleString('en-IN')}\n`;
      text += `💵 *Total Flat Bill:* ₹${total.toLocaleString('en-IN')}\n`;
      text += `👥 *Per Person Share (${count} Roommates):* ₹${perHead.toLocaleString('en-IN')}\n\n`;

      text += `📋 *Roommate Status:*\n`;
      appState.roommates.forEach(r => {
        const icon = r.status === 'paid' ? '✅' : '⏳';
        text += `${icon} ${r.name}: ${r.status === 'paid' ? 'Paid' : `Pending (₹${perHead})`}\n`;
      });

      text += `\n📱 *Pay via UPI ID:* ${appState.upiId || '8459807346@slc'}\n`;
      if (appState.dueNote) text += `⏰ *Notice:* ${appState.dueNote}\n`;
      text += `\n💳 *Pay Directly on Website:* ${shareUrl}`;

      window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`, '_blank');
    });

    // Roommate management
    document.getElementById('manageRoommatesModalBtn').addEventListener('click', () => {
      renderManageRoommatesList();
      document.getElementById('roommatesModal').classList.remove('hidden');
    });

    document.getElementById('addRoommateForm').addEventListener('submit', (e) => {
      e.preventDefault();
      if (!isAdminAuthenticated) {
        showToast('Only admin can add roommates.');
        return;
      }
      const input = document.getElementById('newRoommateName');
      const name = input.value.trim();
      if (name) {
        appState.roommates.push({
          id: Date.now().toString(),
          name: name,
          status: 'pending',
          paidOn: null,
          utr: null,
          method: null,
          paidAt: null
        });
        input.value = '';
        saveState();
        renderManageRoommatesList();
        renderAll();
      }
    });

    document.getElementById('viewHostingGuideBtn').addEventListener('click', () => {
      document.getElementById('hostingGuideModal').classList.remove('hidden');
    });

    // Checkout tabs
    const tabUpiBtn = document.getElementById('tabUpiBtn');
    const tabGatewayBtn = document.getElementById('tabGatewayBtn');
    const tabContentUpi = document.getElementById('tabContentUpi');
    const tabContentGateway = document.getElementById('tabContentGateway');

    tabUpiBtn.addEventListener('click', () => {
      tabUpiBtn.classList.add('text-emerald-700', 'border-b-2', 'border-emerald-600');
      tabUpiBtn.classList.remove('text-slate-500');
      tabGatewayBtn.classList.remove('text-blue-700', 'border-b-2', 'border-blue-600');
      tabGatewayBtn.classList.add('text-slate-500');
      tabContentUpi.classList.remove('hidden');
      tabContentGateway.classList.add('hidden');
    });

    tabGatewayBtn.addEventListener('click', () => {
      tabGatewayBtn.classList.add('text-blue-700', 'border-b-2', 'border-blue-600');
      tabGatewayBtn.classList.remove('text-slate-500');
      tabUpiBtn.classList.remove('text-emerald-700', 'border-b-2', 'border-emerald-600');
      tabUpiBtn.classList.add('text-slate-500');
      tabContentGateway.classList.remove('hidden');
      tabContentUpi.classList.add('hidden');
    });

    document.getElementById('copyUpiIdBtn').addEventListener('click', () => {
      const upiId = appState.upiId || '8459807346@slc';
      navigator.clipboard.writeText(upiId).then(() => {
        showToast('UPI ID copied to clipboard: ' + upiId);
      });
    });

    // UTR confirmation
    document.getElementById('utrConfirmForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const utr = document.getElementById('inputUtrNumber').value.trim();
      if (!utr) return;
      if (activePayingRoommate) {
        completePayment(activePayingRoommate.id, utr, 'UPI Transfer');
      }
    });

    // Razorpay
    document.getElementById('btnLaunchRazorpay').addEventListener('click', () => {
      if (!activePayingRoommate) return;
      const { perHead } = getTotals();
      const razorpayKey = appState.razorpayKey;

      if (!razorpayKey) {
        const confirmTest = confirm(
          'No custom Razorpay Key ID is configured in Admin.\n\nWould you like to simulate a successful payment test on the website right now?'
        );
        if (confirmTest) {
          const testPaymentId = 'pay_sim_' + Math.random().toString(36).substring(2, 10).toUpperCase();
          completePayment(activePayingRoommate.id, testPaymentId, 'Razorpay (Online)');
        }
        return;
      }

      if (typeof Razorpay === 'undefined') {
        alert('Razorpay library could not be loaded. Please ensure you have an active internet connection.');
        return;
      }

      const options = {
        key: razorpayKey,
        amount: perHead * 100,
        currency: 'INR',
        name: appState.flatName,
        description: `${appState.activeMonth} Rent & Electricity Bill`,
        image: 'https://cdn-icons-png.flaticon.com/512/619/619153.png',
        handler: function (response) {
          if (response && response.razorpay_payment_id) {
            completePayment(activePayingRoommate.id, response.razorpay_payment_id, 'Razorpay Online');
          }
        },
        prefill: { name: activePayingRoommate.name },
        theme: { color: '#16a34a' }
      };

      try {
        const rzp = new Razorpay(options);
        rzp.open();
      } catch (err) {
        console.error('Razorpay initialization error:', err);
        alert('Error launching Razorpay: ' + err.message);
      }
    });

    // Send receipt via WhatsApp
    document.getElementById('sendProofWhatsAppBtn').addEventListener('click', () => {
      if (!activeReceiptRoommate) return;
      const { perHead } = getTotals();

      let msg = `🧾 *RENT & BILL PAYMENT RECEIPT*\n`;
      msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
      msg += `👤 *Roommate:* ${activeReceiptRoommate.name}\n`;
      msg += `🏠 *Flat:* ${appState.flatName}\n`;
      msg += `📅 *Billing Month:* ${appState.activeMonth}\n`;
      msg += `💵 *Amount Paid:* ₹${perHead.toLocaleString('en-IN')}\n`;
      msg += `💳 *Method:* ${activeReceiptRoommate.method || 'UPI Transfer'}\n`;
      msg += `🔢 *UTR / Ref No:* ${activeReceiptRoommate.utr || 'Direct'}\n`;
      msg += `⏰ *Timestamp:* ${activeReceiptRoommate.paidAt || 'Today'}\n`;
      msg += `\n✅ *Status:* Paid & Recorded on website!`;

      let targetUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}`;
      if (appState.adminPhone) {
        const cleanPhone = appState.adminPhone.replace(/\D/g, '');
        targetUrl = `https://api.whatsapp.com/send?phone=${cleanPhone}&text=${encodeURIComponent(msg)}`;
      }
      window.open(targetUrl, '_blank');
    });

    // Login form
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
      loginForm.addEventListener('submit', (e) => {
        e.preventDefault();
        handleLogin(
          document.getElementById('loginUsername').value,
          document.getElementById('loginPassword').value
        );
      });
    }

    const toggleLoginPassBtn = document.getElementById('toggleLoginPasswordBtn');
    if (toggleLoginPassBtn) {
      toggleLoginPassBtn.addEventListener('click', () => {
        const pass = document.getElementById('loginPassword');
        if (pass) pass.type = pass.type === 'password' ? 'text' : 'password';
      });
    }

    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', () => {
        if (confirm('Are you sure you want to log out?')) handleLogout();
      });
    }

    const downloadDataJsonBtn = document.getElementById('downloadDataJsonBtn');
    if (downloadDataJsonBtn) {
      downloadDataJsonBtn.addEventListener('click', downloadDataJson);
    }

    // UPI Directory button
    const upiDirBtn = document.getElementById('upiDirectoryBtn');
    if (upiDirBtn) {
      upiDirBtn.addEventListener('click', () => {
        loadUpiDirectory();
        document.getElementById('upiDirectoryModal').classList.remove('hidden');
      });
    }

    // Save my UPI ID button
    const btnSaveMyUpi = document.getElementById('btnSaveMyUpi');
    if (btnSaveMyUpi) {
      btnSaveMyUpi.addEventListener('click', saveMyUpiId);
    }

    // Quick Pay amount change (live QR update)
    const quickPayAmountInput = document.getElementById('quickPayAmount');
    if (quickPayAmountInput) {
      quickPayAmountInput.addEventListener('input', () => {
        updateQuickPayQr();
      });
    }

    // Phase 2: Expenses modal button
    const expBtn = document.getElementById('expensesBtn');
    if (expBtn) {
      expBtn.addEventListener('click', () => {
        loadExpenses();
        document.getElementById('expensesModal').classList.remove('hidden');
      });
    }

    // Phase 2: Filter buttons
    const btnFilterAllExp = document.getElementById('btnFilterAllExp');
    const btnFilterMyExp = document.getElementById('btnFilterMyExp');
    if (btnFilterAllExp && btnFilterMyExp) {
      btnFilterAllExp.addEventListener('click', () => {
        currentExpenseFilter = 'all';
        btnFilterAllExp.className = 'px-3 py-1.5 rounded-lg bg-indigo-600 text-white shadow-sm';
        btnFilterMyExp.className = 'px-3 py-1.5 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200';
        renderExpensesList();
      });
      btnFilterMyExp.addEventListener('click', () => {
        currentExpenseFilter = 'my';
        btnFilterMyExp.className = 'px-3 py-1.5 rounded-lg bg-indigo-600 text-white shadow-sm';
        btnFilterAllExp.className = 'px-3 py-1.5 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200';
        renderExpensesList();
      });
    }

    // Phase 2: Open add expense modal
    const btnOpenAddExpense = document.getElementById('btnOpenAddExpense');
    if (btnOpenAddExpense) {
      btnOpenAddExpense.addEventListener('click', openAddExpenseModal);
    }

    // Phase 2: Select all participants
    const btnSelectAllSplit = document.getElementById('btnSelectAllSplit');
    if (btnSelectAllSplit) {
      btnSelectAllSplit.addEventListener('click', () => {
        document.querySelectorAll('.split-participant-chk').forEach(c => c.checked = true);
        updateSplitPreview();
      });
    }

    // Phase 2: Amount input live preview
    const inputExpAmount = document.getElementById('inputExpAmount');
    if (inputExpAmount) {
      inputExpAmount.addEventListener('input', updateSplitPreview);
    }

    // Phase 2: Add expense form submission
    const addExpenseForm = document.getElementById('addExpenseForm');
    if (addExpenseForm) {
      addExpenseForm.addEventListener('submit', handleAddExpenseSubmit);
    }

    // Phase 2: Pay split confirm form submission
    const paySplitConfirmForm = document.getElementById('paySplitConfirmForm');
    if (paySplitConfirmForm) {
      paySplitConfirmForm.addEventListener('submit', handlePaySplitSubmit);
    }

    // Phase 2: Amount input in pay split modal (live QR update)
    const paySplitCustomAmount = document.getElementById('paySplitCustomAmount');
    if (paySplitCustomAmount) {
      paySplitCustomAmount.addEventListener('input', updatePaySplitQr);
    }

    // Phase 3: Cleaning roster button (open modal)
    const cleaningBtn = document.getElementById('cleaningBtn');
    if (cleaningBtn) {
      cleaningBtn.addEventListener('click', () => {
        loadCleaningRoster();
        document.getElementById('cleaningModal').classList.remove('hidden');
      });
    }

    // Phase 3: Auto-generate Sunday rotation
    const btnGenCleaning = document.getElementById('btnGenerateCleaningRoster');
    if (btnGenCleaning) {
      btnGenCleaning.addEventListener('click', generateCleaningRoster);
    }

    // Phase 3: Duty photo file input
    const inputDutyPhoto = document.getElementById('inputDutyPhoto');
    if (inputDutyPhoto) {
      inputDutyPhoto.addEventListener('change', handleDutyPhotoUpload);
    }

    // Phase 3: Submit duty button
    const btnSubmitDuty = document.getElementById('btnSubmitCleaningDuty');
    if (btnSubmitDuty) {
      btnSubmitDuty.addEventListener('click', submitCleaningDuty);
    }

    // Phase 3: Roommate review buttons
    const btnApproveDuty = document.getElementById('btnApproveDuty');
    if (btnApproveDuty) {
      btnApproveDuty.addEventListener('click', () => reviewDuty('approve'));
    }

    const btnRejectDuty = document.getElementById('btnRejectDuty');
    if (btnRejectDuty) {
      btnRejectDuty.addEventListener('click', () => {
        const note = prompt('Please enter note for redo (e.g. bathroom needs more cleaning):');
        if (note !== null) reviewDuty('redo', note);
      });
    }

    // Phase 3: Swap duty
    const btnOpenSwapDuty = document.getElementById('btnOpenSwapDuty');
    if (btnOpenSwapDuty) {
      btnOpenSwapDuty.addEventListener('click', openSwapDutyModal);
    }

    const btnConfirmSwapDuty = document.getElementById('btnConfirmSwapDuty');
    if (btnConfirmSwapDuty) {
      btnConfirmSwapDuty.addEventListener('click', confirmSwapDuty);
    }

    // Phase 4: Personal Dashboard buttons
    const dashSettleUpBtn = document.getElementById('dashSettleUpBtn');
    if (dashSettleUpBtn) {
      dashSettleUpBtn.addEventListener('click', openSettleUpModal);
    }

    const dashRemindersBtn = document.getElementById('dashRemindersBtn');
    if (dashRemindersBtn) {
      dashRemindersBtn.addEventListener('click', () => openWhatsAppReminderModal('rent'));
    }

    const dashRentActionBtn = document.getElementById('dashRentActionBtn');
    if (dashRentActionBtn) {
      dashRentActionBtn.addEventListener('click', () => {
        if (!currentLoggedInUser) return;
        const myRentRecord = appState.roommates.find(r => 
          r.id === currentLoggedInUser.roommateId || 
          r.name.toLowerCase().includes(currentLoggedInUser.display.toLowerCase())
        );
        if (myRentRecord) {
          if (myRentRecord.status === 'paid') window.openReceiptModal(myRentRecord.id);
          else window.openCheckoutModal(myRentRecord.id);
        } else {
          showToast('Roommate record not found.');
        }
      });
    }

    const dashRentWaBtn = document.getElementById('dashRentWaBtn');
    if (dashRentWaBtn) {
      dashRentWaBtn.addEventListener('click', () => openWhatsAppReminderModal('rent'));
    }

    const dashExpenseActionBtn = document.getElementById('dashExpenseActionBtn');
    if (dashExpenseActionBtn) {
      dashExpenseActionBtn.addEventListener('click', () => {
        loadExpenses();
        document.getElementById('expensesModal').classList.remove('hidden');
      });
    }

    const dashExpenseWaBtn = document.getElementById('dashExpenseWaBtn');
    if (dashExpenseWaBtn) {
      dashExpenseWaBtn.addEventListener('click', () => openWhatsAppReminderModal('expense'));
    }

    const dashCleaningActionBtn = document.getElementById('dashCleaningActionBtn');
    if (dashCleaningActionBtn) {
      dashCleaningActionBtn.addEventListener('click', () => {
        if (!currentLoggedInUser) return;
        const duties = Array.isArray(cleaningDutiesState) ? cleaningDutiesState : [];
        const myDuties = duties.filter(d => d.person_id === currentLoggedInUser.roommateId);
        const activeDuty = myDuties.find(d => ['upcoming', 'in_progress', 'submitted', 'redo'].includes(d.status)) || myDuties[0];
        if (activeDuty) {
          window.openCleaningDutyModal(activeDuty.id);
        } else {
          loadCleaningRoster();
          document.getElementById('cleaningModal').classList.remove('hidden');
        }
      });
    }

    const dashCleaningWaBtn = document.getElementById('dashCleaningWaBtn');
    if (dashCleaningWaBtn) {
      dashCleaningWaBtn.addEventListener('click', () => openWhatsAppReminderModal('cleaning'));
    }

    const btnShareSettleUpWa = document.getElementById('btnShareSettleUpWa');
    if (btnShareSettleUpWa) {
      btnShareSettleUpWa.addEventListener('click', shareSettleUpPlanToWhatsApp);
    }

    // Phase 4: WhatsApp reminder modal listeners
    const waTypeRentBtn = document.getElementById('waTypeRentBtn');
    const waTypeExpenseBtn = document.getElementById('waTypeExpenseBtn');
    const waTypeCleaningBtn = document.getElementById('waTypeCleaningBtn');
    if (waTypeRentBtn && waTypeExpenseBtn && waTypeCleaningBtn) {
      waTypeRentBtn.addEventListener('click', () => selectWhatsAppReminderType('rent'));
      waTypeExpenseBtn.addEventListener('click', () => selectWhatsAppReminderType('expense'));
      waTypeCleaningBtn.addEventListener('click', () => selectWhatsAppReminderType('cleaning'));
    }

    const waRecipientSelect = document.getElementById('waRecipientSelect');
    if (waRecipientSelect) {
      waRecipientSelect.addEventListener('change', updateWhatsAppMessagePreview);
    }

    const btnCopyWaText = document.getElementById('btnCopyWaText');
    if (btnCopyWaText) {
      btnCopyWaText.addEventListener('click', () => {
        const text = document.getElementById('waMessageText').value;
        if (!text) return;
        navigator.clipboard.writeText(text).then(() => {
          showToast('✅ Reminder message copied to clipboard!');
        }).catch(() => {
          prompt('Copy reminder text:', text);
        });
      });
    }

    const btnOpenWhatsApp = document.getElementById('btnOpenWhatsApp');
    if (btnOpenWhatsApp) {
      btnOpenWhatsApp.addEventListener('click', handleSendWhatsAppFromModal);
    }

    // Auto-sync polling every 12 seconds so all devices see live updates
    setInterval(() => {
      loadRemoteState(true);
    }, 12000);

    // Refresh when returning to the tab
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        loadRemoteState(true);
      }
    });

    window.addEventListener('focus', () => {
      loadRemoteState(true);
    });
  }

  // ---------- PAYMENTS ----------

  window.handlePaymentRedirectClick = function (event, id) {
    const roommate = appState.roommates.find(r => r.id === id);
    if (!roommate) return;

    activePayingRoommate = roommate;
    const { perHead } = getTotals();
    const upiUri = buildUpiUri(perHead, roommate.name);

    event.preventDefault();
    setupCheckoutModalUI(roommate, perHead, upiUri);
    document.getElementById('checkoutModal').classList.remove('hidden');

    if (isMobileDevice()) {
      setTimeout(() => { window.location.href = upiUri; }, 150);
    }

    if (window.lucide) window.lucide.createIcons();
  };

  function setupCheckoutModalUI(roommate, perHead, upiUri) {
    const upiId = appState.upiId || '8459807346@slc';

    document.getElementById('checkoutModalName').textContent = `Pay Rent - ${roommate.name}`;
    document.getElementById('checkoutModalAmount').textContent = `₹${perHead.toLocaleString('en-IN')}`;
    document.getElementById('checkoutModalMonth').textContent = appState.activeMonth;
    document.getElementById('checkoutModalUpiId').textContent = upiId;
    document.getElementById('btnLaunchRazorpayText').textContent = `Pay ₹${perHead.toLocaleString('en-IN')} with Razorpay`;
    document.getElementById('inputUtrNumber').value = '';

    const btnDirect = document.getElementById('btnPayDirectAll');
    btnDirect.href = upiUri;
    btnDirect.onclick = function (e) {
      if (!isMobileDevice()) {
        e.preventDefault();
        showToast('UPI app redirect is available on mobile phones. Please scan the QR code above.');
      }
    };

    document.getElementById('btnPayGPay').href = upiUri;
    document.getElementById('btnPayPhonePe').href = upiUri;
    document.getElementById('btnPayPaytm').href = upiUri;

    const qrContainer = document.getElementById('qrcodeContainer');
    if (qrContainer) {
      qrContainer.innerHTML = '';
      if (window.QRCode) {
        new QRCode(qrContainer, {
          text: upiUri,
          width: 170,
          height: 170,
          colorDark: '#0f172a',
          colorLight: '#ffffff',
          correctLevel: QRCode.CorrectLevel.M
        });
      }
    }

    document.getElementById('tabUpiBtn').click();
  }

  function completePayment(roommateId, referenceId, method) {
    const roommate = appState.roommates.find(r => r.id === roommateId);
    if (!roommate) return;

    const now = new Date();
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    roommate.status = 'paid';
    roommate.paidOn = `${now.getDate()} ${months[now.getMonth()]}`;
    roommate.paidAt = `${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()}, ${timeStr}`;
    roommate.utr = referenceId;
    roommate.method = method;

    saveState(); // saved to server only if admin; otherwise this device only
    renderAll();

    if (window.confetti) {
      window.confetti({ particleCount: 80, spread: 60, origin: { y: 0.6 } });
    }

    document.getElementById('checkoutModal').classList.add('hidden');
    window.openReceiptModal(roommate.id);
    showToast(`Payment recorded for ${roommate.name}!`);
  }

  function renderManageRoommatesList() {
    const list = document.getElementById('manageRoommatesList');
    if (!list) return;

    list.innerHTML = appState.roommates.map((r, idx) => `
      <div class="py-2.5 flex items-center justify-between">
        <div class="flex items-center gap-2">
          <span class="w-6 h-6 rounded-full bg-slate-100 text-slate-700 flex items-center justify-center text-xs font-bold">${idx + 1}</span>
          <div>
            <p class="text-sm font-semibold text-slate-800 leading-tight">${escapeHtml(r.name)}</p>
            <p class="text-[11px] text-slate-400">${r.status === 'paid' ? `Paid (${escapeHtml(r.paidOn || 'Yes')})` : 'Pending'}</p>
          </div>
        </div>
        <button onclick="window.removeRoommate('${r.id}')" class="text-xs text-red-500 hover:text-red-700 font-medium px-2 py-1 hover:bg-red-50 rounded-lg">
          Remove
        </button>
      </div>
    `).join('');
  }

  window.toggleRoommateStatus = function (id) {
    if (!isAdminAuthenticated) return;
    const roommate = appState.roommates.find(r => r.id === id);
    if (roommate) {
      if (roommate.status === 'paid') {
        roommate.status = 'pending';
        roommate.paidOn = null;
        roommate.utr = null;
        roommate.method = null;
        roommate.paidAt = null;
      } else {
        const d = new Date();
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        roommate.status = 'paid';
        roommate.paidOn = `${d.getDate()} ${months[d.getMonth()]}`;
        roommate.paidAt = `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
        roommate.utr = 'Admin Verified';
        roommate.method = 'Direct Cash/Transfer';
      }
      saveState();
      renderAll();
    }
  };

  window.removeRoommate = function (id) {
    if (!isAdminAuthenticated) {
      showToast('Only admin can remove roommates.');
      return;
    }
    if (appState.roommates.length <= 1) {
      alert('You need at least 1 roommate.');
      return;
    }
    appState.roommates = appState.roommates.filter(r => r.id !== id);
    saveState();
    renderManageRoommatesList();
    renderAll();
  };

  window.openCheckoutModal = function (id) {
    const roommate = appState.roommates.find(r => r.id === id);
    if (!roommate) return;

    activePayingRoommate = roommate;
    const { perHead } = getTotals();
    const upiUri = buildUpiUri(perHead, roommate.name);
    setupCheckoutModalUI(roommate, perHead, upiUri);
    document.getElementById('checkoutModal').classList.remove('hidden');

    if (window.lucide) window.lucide.createIcons();
  };

  window.openReceiptModal = function (id) {
    const roommate = appState.roommates.find(r => r.id === id);
    if (!roommate) return;

    activeReceiptRoommate = roommate;
    const { rent, bldgMaint, cleanMaint, light, perHead } = getTotals();
    const $ = (i) => document.getElementById(i);
    const inr = (n) => `₹${n.toLocaleString('en-IN')}`;

    const receiptNum = `REC-${appState.activeMonth.replace(/\s+/g, '').substring(0, 5).toUpperCase()}-${roommate.id.slice(-4)}`;

    $('receiptNumber').textContent = receiptNum;
    $('receiptAmount').textContent = inr(perHead);
    $('receiptMonthYear').textContent = appState.activeMonth;
    $('receiptRoommateName').textContent = roommate.name;
    $('receiptFlatName').textContent = appState.flatName;
    $('receiptPaymentMode').textContent = roommate.method || 'Online Transfer';
    $('receiptUtr').textContent = roommate.utr || 'VERIFIED-01';
    $('receiptDateTime').textContent = roommate.paidAt || roommate.paidOn || 'Recently Paid';

    if ($('receiptRentBreakdown')) $('receiptRentBreakdown').textContent = inr(rent);
    if ($('receiptBldgBreakdown')) $('receiptBldgBreakdown').textContent = inr(bldgMaint);
    if ($('receiptCleanBreakdown')) $('receiptCleanBreakdown').textContent = inr(cleanMaint);
    if ($('receiptLightBreakdown')) $('receiptLightBreakdown').textContent = inr(light);

    $('receiptModal').classList.remove('hidden');
    if (window.lucide) window.lucide.createIcons();
  };

  // ---------- HELPERS ----------

  function showToast(msg) {
    const toast = document.createElement('div');
    toast.className = 'fixed bottom-5 right-5 bg-slate-900 text-white px-4 py-2.5 rounded-xl text-xs font-semibold shadow-xl z-50 animate-bounce';
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3500);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>'"]/g, tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag));
  }

  // ---------- PHASE 1: UPI DIRECTORY ----------

  let upiDirectoryRoommates = [];
  let quickPayActiveTarget = null;

  async function loadUpiDirectory() {
    const list = document.getElementById('upiDirectoryList');
    if (!list) return;

    const token = localStorage.getItem('roommate_token');
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    try {
      const res = await fetch(ROOMMATES_URL, { headers });
      if (res.ok) {
        upiDirectoryRoommates = await res.json();
      }
    } catch (e) {
      console.warn('Could not fetch remote UPI directory, using fallback:', e);
    }

    if (!upiDirectoryRoommates || upiDirectoryRoommates.length === 0) {
      upiDirectoryRoommates = appState.roommates.map(r => ({
        id: r.id,
        name: r.name.replace(/\s*\(You\)/i, ''),
        upi_id: r.name.toLowerCase().includes('kalpesh') ? (appState.upiId || '8459807346@slc') : '',
        phone: appState.adminPhone || '918459807346'
      }));
    }

    // Update logged-in user's own UPI card
    if (currentLoggedInUser) {
      const myRecord = upiDirectoryRoommates.find(r =>
        r.id === currentLoggedInUser.roommateId ||
        r.name.toLowerCase() === currentLoggedInUser.display.toLowerCase()
      );
      const myUpiDisplay = document.getElementById('myUpiDisplay');
      const myUpiInput = document.getElementById('myUpiInput');
      if (myRecord && myRecord.upi_id) {
        if (myUpiDisplay) myUpiDisplay.textContent = myRecord.upi_id;
        if (myUpiInput && !myUpiInput.value) myUpiInput.value = myRecord.upi_id;
      } else {
        if (myUpiDisplay) myUpiDisplay.textContent = 'Not set yet';
      }
    }

    // Render list
    list.innerHTML = upiDirectoryRoommates.map(r => {
      const hasUpi = Boolean(r.upi_id && r.upi_id.trim());
      const isMe = currentLoggedInUser && (
        r.id === currentLoggedInUser.roommateId ||
        r.name.toLowerCase() === currentLoggedInUser.display.toLowerCase()
      );

      return `
        <div class="py-3 flex items-center justify-between gap-3">
          <div class="flex items-center gap-2.5">
            <div class="w-9 h-9 rounded-xl ${isMe ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700'} font-bold flex items-center justify-center text-xs shadow-sm">
              ${escapeHtml(r.name.charAt(0).toUpperCase())}
            </div>
            <div>
              <div class="flex items-center gap-1.5">
                <p class="text-sm font-bold text-slate-900 leading-tight">${escapeHtml(r.name)}</p>
                ${isMe ? '<span class="text-[9px] font-extrabold bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded-full border border-blue-200">You</span>' : ''}
              </div>
              <p class="text-xs font-mono text-slate-500 mt-0.5">${hasUpi ? escapeHtml(r.upi_id) : '<span class="text-slate-400 italic">No UPI added</span>'}</p>
            </div>
          </div>

          <div class="flex items-center gap-1.5 shrink-0">
            ${hasUpi ? `
              <button onclick="window.copyUpiString('${escapeHtml(r.upi_id)}')" title="Copy UPI ID"
                      class="p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition border border-slate-200 text-xs">
                <i data-lucide="copy" class="w-3.5 h-3.5"></i>
              </button>
              <button onclick="window.openQuickPayModal('${escapeHtml(r.name)}', '${escapeHtml(r.upi_id)}')"
                      class="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-xs transition shadow-sm flex items-center gap-1">
                <i data-lucide="zap" class="w-3 h-3 text-amber-300"></i>
                <span>Pay</span>
              </button>
            ` : `
              <span class="text-[11px] text-slate-400 font-medium">Pending</span>
            `}
          </div>
        </div>
      `;
    }).join('');

    if (window.lucide) window.lucide.createIcons();
  }

  async function saveMyUpiId() {
    if (!currentLoggedInUser) {
      showToast('Please sign in first.');
      return;
    }

    const input = document.getElementById('myUpiInput');
    const newUpi = (input ? input.value : '').trim();
    if (!newUpi) {
      showToast('Please enter a valid UPI ID (e.g. name@bank)');
      return;
    }

    if (!/^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/.test(newUpi)) {
      showToast('Invalid UPI ID format. Example: yourname@oksbi');
      return;
    }

    const token = localStorage.getItem('roommate_token');
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (adminPinValue) headers['X-Admin-Pin'] = adminPinValue;

    try {
      const res = await fetch(`${ROOMMATES_URL}/${currentLoggedInUser.roommateId}/upi`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ upiId: newUpi })
      });

      if (res.ok) {
        showToast('✅ Your UPI ID was saved successfully!');
        const myUpiDisplay = document.getElementById('myUpiDisplay');
        if (myUpiDisplay) myUpiDisplay.textContent = newUpi;
        loadUpiDirectory();
      } else {
        const err = await res.json();
        showToast(err.error || 'Failed to save UPI ID on server.');
      }
    } catch (e) {
      showToast('No internet. Saved locally.');
      const myUpiDisplay = document.getElementById('myUpiDisplay');
      if (myUpiDisplay) myUpiDisplay.textContent = newUpi;
    }
  }

  window.copyUpiString = function (upiStr) {
    if (!upiStr) return;
    navigator.clipboard.writeText(upiStr).then(() => {
      showToast(`UPI copied: ${upiStr}`);
    }).catch(() => {
      prompt('Copy UPI ID:', upiStr);
    });
  };

  window.openQuickPayModal = function (name, upiId) {
    quickPayActiveTarget = { name, upiId };
    const modal = document.getElementById('upiQuickPayModal');
    if (!modal) return;

    document.getElementById('quickPayTargetName').textContent = `Pay ${name}`;
    document.getElementById('quickPayTargetUpi').textContent = upiId;
    const amtInput = document.getElementById('quickPayAmount');
    if (amtInput && !amtInput.value) amtInput.value = '100';

    updateQuickPayQr();
    modal.classList.remove('hidden');
    if (window.lucide) window.lucide.createIcons();
  };

  function updateQuickPayQr() {
    if (!quickPayActiveTarget) return;
    const amtInput = document.getElementById('quickPayAmount');
    const amt = amtInput && Number(amtInput.value) > 0 ? Number(amtInput.value) : 100;
    const upiUri = `upi://pay?pa=${encodeURIComponent(quickPayActiveTarget.upiId)}&pn=${encodeURIComponent(quickPayActiveTarget.name)}&am=${amt}&cu=INR&tn=${encodeURIComponent('Room 12 Payment')}`;

    const mobileLink = document.getElementById('quickPayMobileLink');
    if (mobileLink) mobileLink.href = upiUri;

    const qrContainer = document.getElementById('quickPayQrContainer');
    if (qrContainer) {
      qrContainer.innerHTML = '';
      if (window.QRCode) {
        new QRCode(qrContainer, {
          text: upiUri,
          width: 140,
          height: 140,
          colorDark: '#0f172a',
          colorLight: '#ffffff',
          correctLevel: QRCode.CorrectLevel.M
        });
      }
    }
  }

  // ---------- PHASE 2: SHARED PURCHASES & SPLITS ----------

  let currentExpenseFilter = 'all';
  let expensesState = { expenses: [], splits: [], payments: [] };
  let activePaySplitContext = null;

  async function loadExpenses() {
    const list = document.getElementById('expensesList');
    if (!list) return;

    const token = localStorage.getItem('roommate_token');
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    try {
      const res = await fetch(EXPENSES_URL, { headers });
      if (res.ok) {
        expensesState = await res.json();
      }
    } catch (e) {
      console.warn('Error fetching expenses:', e);
    }

    calculateAndRenderBalances();
    renderPendingConfirmations();
    renderExpensesList();
    renderPersonalDashboard();
  }

  function calculateAndRenderBalances() {
    if (!currentLoggedInUser) return;
    const myId = currentLoggedInUser.roommateId;

    let myReceivablePaise = 0; // People owe me
    let myPayablePaise = 0;    // I owe buyers

    const expenses = expensesState.expenses || [];
    const splits = expensesState.splits || [];
    const payments = expensesState.payments || [];

    // Helper: sum confirmed payments for a given split
    function getConfirmedPaid(expenseId, fromId, toId) {
      return payments
        .filter(p => p.expense_id === expenseId && p.from_id === fromId && p.to_id === toId && p.status === 'confirmed')
        .reduce((sum, p) => sum + p.amount_paise, 0);
    }

    expenses.forEach(exp => {
      const expSplits = splits.filter(s => s.expense_id === exp.id);
      const buyerId = exp.paid_by;

      expSplits.forEach(sp => {
        if (sp.person_id === buyerId) return; // Buyer doesn't owe themselves
        const confirmedPaid = getConfirmedPaid(exp.id, sp.person_id, buyerId);
        const remaining = Math.max(0, sp.share_paise - confirmedPaid);

        if (buyerId === myId) {
          myReceivablePaise += remaining;
        } else if (sp.person_id === myId) {
          myPayablePaise += remaining;
        }
      });
    });

    const recEl = document.getElementById('myReceivableBalance');
    const payEl = document.getElementById('myPayableBalance');
    if (recEl) recEl.textContent = `₹${(myReceivablePaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
    if (payEl) payEl.textContent = `₹${(myPayablePaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
  }

  function renderPendingConfirmations() {
    const sec = document.getElementById('pendingConfirmationSection');
    const list = document.getElementById('pendingConfirmationsList');
    if (!sec || !list || !currentLoggedInUser) return;

    const myId = currentLoggedInUser.roommateId;
    const pendingToMe = (expensesState.payments || []).filter(p => p.to_id === myId && p.status === 'pending');

    if (pendingToMe.length === 0) {
      sec.classList.add('hidden');
      return;
    }

    sec.classList.remove('hidden');
    list.innerHTML = pendingToMe.map(p => `
      <div class="py-2 px-3 bg-white border border-amber-300 rounded-lg flex items-center justify-between text-xs gap-2">
        <div>
          <span class="font-bold text-slate-800">${escapeHtml(p.from_name)}</span> paid you
          <span class="font-black text-emerald-700">₹${(p.amount_paise / 100).toFixed(0)}</span>
          ${p.utr ? `<span class="block text-[10px] font-mono text-slate-500">Ref: ${escapeHtml(p.utr)}</span>` : ''}
        </div>
        <div class="flex gap-1.5 shrink-0">
          <button onclick="window.confirmSplitPayment(${p.id}, 'confirm')"
                  class="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-xs shadow-sm">
            Confirm
          </button>
          <button onclick="window.confirmSplitPayment(${p.id}, 'reject')"
                  class="px-2.5 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-300 font-bold rounded-lg text-xs">
            Reject
          </button>
        </div>
      </div>
    `).join('');
  }

  function renderExpensesList() {
    const container = document.getElementById('expensesList');
    if (!container) return;

    const myId = currentLoggedInUser ? currentLoggedInUser.roommateId : null;
    let expenses = expensesState.expenses || [];
    const splits = expensesState.splits || [];
    const payments = expensesState.payments || [];

    if (currentExpenseFilter === 'my' && myId) {
      expenses = expenses.filter(e => {
        const hasMySplit = splits.some(s => s.expense_id === e.id && s.person_id === myId);
        return e.paid_by === myId || hasMySplit;
      });
    }

    if (expenses.length === 0) {
      container.innerHTML = `
        <div class="p-8 text-center bg-slate-50 border border-slate-200 rounded-xl space-y-2">
          <i data-lucide="shopping-bag" class="w-8 h-8 text-slate-300 mx-auto"></i>
          <p class="text-sm font-semibold text-slate-600">No shared purchases recorded yet</p>
          <p class="text-xs text-slate-400">Click "Add Purchase" above to record groceries, supplies or WiFi!</p>
        </div>
      `;
      if (window.lucide) window.lucide.createIcons();
      return;
    }

    container.innerHTML = expenses.map(exp => {
      const expSplits = splits.filter(s => s.expense_id === exp.id);
      const isBuyer = myId && exp.paid_by === myId;
      const isAdmin = currentLoggedInUser && currentLoggedInUser.isAdmin;

      const splitItemsHtml = expSplits.map(sp => {
        const isSelf = myId && sp.person_id === myId;
        const isBuyerSplit = sp.person_id === exp.paid_by;

        const confirmedPaid = payments
          .filter(p => p.expense_id === exp.id && p.from_id === sp.person_id && p.to_id === exp.paid_by && p.status === 'confirmed')
          .reduce((sum, p) => sum + p.amount_paise, 0);

        const hasPendingPayment = payments.some(
          p => p.expense_id === exp.id && p.from_id === sp.person_id && p.to_id === exp.paid_by && p.status === 'pending'
        );

        const remainingPaise = Math.max(0, sp.share_paise - confirmedPaid);
        const isFullyPaid = isBuyerSplit || remainingPaise === 0;

        let statusBadge = '';
        if (isBuyerSplit) {
          statusBadge = '<span class="text-[10px] text-emerald-700 font-bold bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">Buyer</span>';
        } else if (isFullyPaid) {
          statusBadge = '<span class="text-[10px] text-emerald-700 font-bold bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">Settled</span>';
        } else if (hasPendingPayment) {
          statusBadge = '<span class="text-[10px] text-amber-700 font-bold bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200 animate-pulse">Awaiting Approval</span>';
        } else if (confirmedPaid > 0) {
          statusBadge = `<span class="text-[10px] text-amber-700 font-bold bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">Partially Paid (₹${(remainingPaise / 100).toFixed(0)} left)</span>`;
        } else {
          statusBadge = '<span class="text-[10px] text-rose-700 font-bold bg-rose-50 px-2 py-0.5 rounded-full border border-rose-200">Unpaid</span>';
        }

        const payBtn = (!isFullyPaid && isSelf && !isBuyer) ? `
          <button onclick="window.openPaySplitModal(${exp.id}, '${sp.person_id}', '${exp.paid_by}')"
                  class="px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-xs transition shadow-sm flex items-center gap-1 shrink-0">
            <i data-lucide="zap" class="w-3 h-3 text-amber-300"></i>
            <span>Pay ₹${(remainingPaise / 100).toFixed(0)}</span>
          </button>
        ` : '';

        return `
          <div class="py-1.5 flex items-center justify-between text-xs gap-2">
            <div class="flex items-center gap-1.5">
              <span class="font-medium text-slate-800">${escapeHtml(sp.person_name)}</span>
              ${isSelf ? '<span class="text-[9px] font-extrabold bg-blue-100 text-blue-800 px-1 py-0.2 rounded">You</span>' : ''}
              <span class="text-slate-400 font-mono">₹${(sp.share_paise / 100).toFixed(0)}</span>
            </div>
            <div class="flex items-center gap-2">
              ${statusBadge}
              ${payBtn}
            </div>
          </div>
        `;
      }).join('');

      return `
        <div class="p-4 bg-white border border-slate-200 rounded-2xl shadow-sm hover:shadow-md transition space-y-3">
          <div class="flex items-start justify-between gap-3">
            <div>
              <div class="flex items-center gap-2 flex-wrap">
                <h5 class="font-bold text-slate-900 text-base leading-tight">${escapeHtml(exp.title)}</h5>
                <span class="text-[11px] font-mono text-slate-400">${escapeHtml(exp.expense_date)}</span>
              </div>
              <p class="text-xs text-slate-500 mt-0.5">
                Paid by <span class="font-bold text-slate-700">${escapeHtml(exp.payer_name)}</span>
                ${exp.note ? ` &bull; <span class="italic text-slate-400">${escapeHtml(exp.note)}</span>` : ''}
              </p>
            </div>
            <div class="text-right shrink-0">
              <span class="text-xs text-slate-400 block font-medium">Total</span>
              <span class="text-lg font-black text-slate-900">₹${(exp.amount_paise / 100).toLocaleString('en-IN')}</span>
            </div>
          </div>

          <div class="pt-2 border-t border-slate-100 divide-y divide-slate-50">
            ${splitItemsHtml}
          </div>

          ${(isBuyer || isAdmin) ? `
            <div class="pt-2 border-t border-slate-100 flex justify-end">
              <button onclick="window.deleteExpense(${exp.id})"
                      class="text-[11px] text-rose-500 hover:text-rose-700 font-semibold flex items-center gap-1 hover:bg-rose-50 px-2 py-1 rounded-lg transition">
                <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                <span>Delete Purchase</span>
              </button>
            </div>
          ` : ''}
        </div>
      `;
    }).join('');

    if (window.lucide) window.lucide.createIcons();
  }

  function openAddExpenseModal() {
    const modal = document.getElementById('addExpenseModal');
    if (!modal) return;

    // Reset fields
    document.getElementById('inputExpTitle').value = '';
    document.getElementById('inputExpAmount').value = '';
    document.getElementById('inputExpNote').value = '';
    document.getElementById('inputExpDate').value = new Date().toISOString().split('T')[0];

    // Populate Paid By dropdown
    const selectPaidBy = document.getElementById('selectExpPaidBy');
    if (selectPaidBy) {
      selectPaidBy.innerHTML = appState.roommates.map(r => `
        <option value="${r.id}" ${currentLoggedInUser && currentLoggedInUser.roommateId === r.id ? 'selected' : ''}>
          ${escapeHtml(r.name.replace(/\s*\(You\)/i, ''))}
        </option>
      `).join('');
    }

    // Populate Split With checkboxes (all checked by default)
    const partCont = document.getElementById('splitParticipantsContainer');
    if (partCont) {
      partCont.innerHTML = appState.roommates.map(r => `
        <label class="flex items-center gap-2 p-1.5 hover:bg-white rounded-lg cursor-pointer">
          <input type="checkbox" value="${r.id}" checked class="split-participant-chk rounded text-indigo-600 focus:ring-indigo-500 w-4 h-4">
          <span class="font-medium text-slate-800">${escapeHtml(r.name.replace(/\s*\(You\)/i, ''))}</span>
        </label>
      `).join('');

      partCont.querySelectorAll('.split-participant-chk').forEach(c => {
        c.addEventListener('change', updateSplitPreview);
      });
    }

    updateSplitPreview();
    modal.classList.remove('hidden');
  }

  function updateSplitPreview() {
    const amt = Number(document.getElementById('inputExpAmount').value) || 0;
    const chks = document.querySelectorAll('.split-participant-chk:checked');
    const preview = document.getElementById('splitCalcPreview');
    if (!preview) return;

    if (amt > 0 && chks.length > 0) {
      const perHead = Math.floor(amt / chks.length);
      preview.textContent = `₹${amt} split equally among ${chks.length} roommates = ~₹${perHead} each.`;
    } else {
      preview.textContent = 'Enter amount and select roommates to preview split.';
    }
  }

  async function handleAddExpenseSubmit(e) {
    e.preventDefault();
    const title = document.getElementById('inputExpTitle').value.trim();
    const amount = Number(document.getElementById('inputExpAmount').value);
    const paidBy = document.getElementById('selectExpPaidBy').value;
    const expenseDate = document.getElementById('inputExpDate').value;
    const note = document.getElementById('inputExpNote').value.trim();

    const chks = Array.from(document.querySelectorAll('.split-participant-chk:checked'));
    const splitWith = chks.map(c => c.value);

    if (!title || !amount || amount <= 0 || splitWith.length === 0) {
      showToast('Please fill all required fields and select at least one roommate.');
      return;
    }

    const token = localStorage.getItem('roommate_token');
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    try {
      const res = await fetch(EXPENSES_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          title,
          amountPaise: Math.round(amount * 100),
          paidBy,
          expenseDate,
          splitWith,
          note
        })
      });

      if (res.ok) {
        showToast('✅ Purchase added and split equally!');
        document.getElementById('addExpenseModal').classList.add('hidden');
        loadExpenses();
      } else {
        const err = await res.json();
        showToast(err.error || 'Failed to save purchase.');
      }
    } catch (e) {
      showToast('Offline error saving purchase.');
    }
  }

  window.deleteExpense = async function (id) {
    if (!confirm('Are you sure you want to remove this purchase?')) return;
    const token = localStorage.getItem('roommate_token');
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    try {
      const res = await fetch(`${EXPENSES_URL}/${id}`, { method: 'DELETE', headers });
      if (res.ok) {
        showToast('Purchase removed.');
        loadExpenses();
      } else {
        const err = await res.json();
        showToast(err.error || 'Failed to delete.');
      }
    } catch (e) {
      showToast('Network error.');
    }
  };

  window.openPaySplitModal = function (expenseId, splitPersonId, buyerId) {
    const exp = (expensesState.expenses || []).find(e => e.id === expenseId);
    const split = (expensesState.splits || []).find(s => s.expense_id === expenseId && s.person_id === splitPersonId);
    const buyer = (upiDirectoryRoommates || []).find(r => r.id === buyerId) || { name: exp ? exp.payer_name : 'Roommate', upi_id: '' };

    if (!exp || !split) return;

    const confirmedPaid = (expensesState.payments || [])
      .filter(p => p.expense_id === expenseId && p.from_id === splitPersonId && p.to_id === buyerId && p.status === 'confirmed')
      .reduce((sum, p) => sum + p.amount_paise, 0);

    const remainingPaise = Math.max(0, split.share_paise - confirmedPaid);
    const remainingRupees = Math.round(remainingPaise / 100);

    activePaySplitContext = {
      expenseId,
      splitPersonId,
      buyerId,
      buyerName: buyer.name,
      buyerUpi: buyer.upi_id || '8459807346@slc',
      remainingPaise
    };

    document.getElementById('paySplitTitle').textContent = `Pay for: ${exp.title}`;
    document.getElementById('paySplitRecipient').textContent = `${buyer.name} (${activePaySplitContext.buyerUpi})`;
    document.getElementById('paySplitTotalShare').textContent = `₹${(split.share_paise / 100).toFixed(0)}`;
    document.getElementById('paySplitAlreadyPaid').textContent = `₹${(confirmedPaid / 100).toFixed(0)}`;
    document.getElementById('paySplitRemaining').textContent = `₹${remainingRupees}`;
    document.getElementById('paySplitCustomAmount').value = remainingRupees;
    document.getElementById('paySplitUtrInput').value = '';

    updatePaySplitQr();
    document.getElementById('paySplitModal').classList.remove('hidden');
    if (window.lucide) window.lucide.createIcons();
  };

  function updatePaySplitQr() {
    if (!activePaySplitContext) return;
    const amtInput = document.getElementById('paySplitCustomAmount');
    const amt = amtInput && Number(amtInput.value) > 0 ? Number(amtInput.value) : Math.round(activePaySplitContext.remainingPaise / 100);

    const upiUri = `upi://pay?pa=${encodeURIComponent(activePaySplitContext.buyerUpi)}&pn=${encodeURIComponent(activePaySplitContext.buyerName)}&am=${amt}&cu=INR&tn=${encodeURIComponent('Room 12 Split')}`;

    const link = document.getElementById('paySplitMobileUri');
    if (link) link.href = upiUri;

    const qrContainer = document.getElementById('paySplitQrContainer');
    if (qrContainer) {
      qrContainer.innerHTML = '';
      if (window.QRCode) {
        new QRCode(qrContainer, {
          text: upiUri,
          width: 130,
          height: 130,
          colorDark: '#0f172a',
          colorLight: '#ffffff',
          correctLevel: QRCode.CorrectLevel.M
        });
      }
    }
  }

  async function handlePaySplitSubmit(e) {
    e.preventDefault();
    if (!activePaySplitContext) return;

    const amt = Number(document.getElementById('paySplitCustomAmount').value);
    const utr = document.getElementById('paySplitUtrInput').value.trim();

    if (!amt || amt <= 0) {
      showToast('Please enter a valid amount.');
      return;
    }

    const token = localStorage.getItem('roommate_token');
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    try {
      const res = await fetch(PAYMENTS_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          expenseId: activePaySplitContext.expenseId,
          fromId: activePaySplitContext.splitPersonId,
          toId: activePaySplitContext.buyerId,
          amountPaise: Math.round(amt * 100),
          utr
        })
      });

      if (res.ok) {
        showToast('✅ Payment recorded! Awaiting buyer confirmation.');
        document.getElementById('paySplitModal').classList.add('hidden');
        loadExpenses();
      } else {
        const err = await res.json();
        showToast(err.error || 'Failed to record payment.');
      }
    } catch (e) {
      showToast('Network error recording payment.');
    }
  }

  window.confirmSplitPayment = async function (paymentId, action) {
    const token = localStorage.getItem('roommate_token');
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    try {
      const res = await fetch(`${PAYMENTS_URL}/${paymentId}/confirm`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ action })
      });

      if (res.ok) {
        showToast(action === 'confirm' ? '✅ Payment confirmed!' : 'Payment rejected.');
        loadExpenses();
      } else {
        const err = await res.json();
        showToast(err.error || 'Action failed.');
      }
    } catch (e) {
      showToast('Network error.');
    }
  };

  // ---------- PHASE 3: SUNDAY CLEANING ROSTER ----------

  let cleaningDutiesState = [];
  let activeDutyContext = null;

  async function loadCleaningRoster() {
    const list = document.getElementById('cleaningDutiesList');
    if (!list) return;

    const token = localStorage.getItem('roommate_token');
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    try {
      const res = await fetch(CLEANING_URL, { headers });
      if (res.ok) {
        cleaningDutiesState = await res.json();
      }
    } catch (e) {
      console.warn('Error fetching cleaning roster:', e);
    }

    renderCleaningDutiesList();
    renderPersonalDashboard();
  }

  function renderCleaningDutiesList() {
    const list = document.getElementById('cleaningDutiesList');
    if (!list) return;

    if (!cleaningDutiesState || cleaningDutiesState.length === 0) {
      list.innerHTML = `
        <div class="p-8 text-center bg-teal-50/50 border border-teal-200 rounded-xl space-y-2">
          <i data-lucide="calendar" class="w-8 h-8 text-teal-400 mx-auto"></i>
          <p class="text-sm font-bold text-teal-900">No Cleaning Rotation Generated Yet</p>
          <p class="text-xs text-slate-500">Click the "Auto-Rotate Sundays" button above to automatically assign Sundays among the 5 roommates!</p>
        </div>
      `;
      if (window.lucide) window.lucide.createIcons();
      return;
    }

    const myId = currentLoggedInUser ? currentLoggedInUser.roommateId : null;

    list.innerHTML = cleaningDutiesState.map(d => {
      const isMine = myId && d.person_id === myId;
      const doneCount = (d.checks || []).filter(c => c.done === 1).length;
      const photoCount = (d.photos || []).length;

      let badgeClass = 'bg-slate-100 text-slate-700';
      let badgeLabel = 'Upcoming';

      if (d.status === 'in_progress') {
        badgeClass = 'bg-blue-100 text-blue-800';
        badgeLabel = `In Progress (${doneCount}/7)`;
      } else if (d.status === 'submitted') {
        badgeClass = 'bg-amber-100 text-amber-800 border border-amber-300 animate-pulse';
        badgeLabel = 'Awaiting Approval';
      } else if (d.status === 'approved') {
        badgeClass = 'bg-emerald-100 text-emerald-800 border border-emerald-300';
        badgeLabel = 'Approved';
      } else if (d.status === 'redo') {
        badgeClass = 'bg-rose-100 text-rose-800 border border-rose-300';
        badgeLabel = 'Redo Requested';
      } else if (d.status === 'missed') {
        badgeClass = 'bg-red-100 text-red-800';
        badgeLabel = 'Missed';
      }

      // Format date
      const dateParts = d.duty_date.split('-');
      const dObj = new Date(Date.UTC(dateParts[0], Number(dateParts[1]) - 1, dateParts[2]));
      const dateStr = dObj.toLocaleDateString('en-IN', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });

      return `
        <div onclick="window.openCleaningDutyModal(${d.id})"
             class="p-3.5 bg-white border ${isMine ? 'border-teal-500 ring-2 ring-teal-500/20 shadow-sm' : 'border-slate-200'} rounded-xl hover:shadow-md transition cursor-pointer flex items-center justify-between gap-3">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl ${isMine ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-700'} font-bold flex flex-col items-center justify-center text-xs shadow-sm">
              <span class="text-[9px] uppercase tracking-wider">${dObj.toLocaleDateString('en-IN', { timeZone: 'UTC', month: 'short' })}</span>
              <span class="text-sm font-black leading-none">${dateParts[2]}</span>
            </div>
            <div>
              <div class="flex items-center gap-1.5 flex-wrap">
                <span class="font-bold text-slate-900 text-sm">${escapeHtml(d.assignee_name)}</span>
                ${isMine ? '<span class="text-[9px] font-extrabold bg-teal-100 text-teal-800 px-1.5 py-0.2 rounded-full border border-teal-200">Your Duty</span>' : ''}
              </div>
              <p class="text-xs text-slate-500">${dateStr} &bull; ${doneCount}/7 tasks done ${photoCount > 0 ? `&bull; 📷 ${photoCount} photo` : ''}</p>
            </div>
          </div>

          <div class="flex items-center gap-2 shrink-0">
            <span class="text-xs font-bold px-2.5 py-1 rounded-full ${badgeClass}">
              ${badgeLabel}
            </span>
            <i data-lucide="chevron-right" class="w-4 h-4 text-slate-400"></i>
          </div>
        </div>
      `;
    }).join('');

    if (window.lucide) window.lucide.createIcons();
  }

  window.openCleaningDutyModal = function (dutyId) {
    const duty = cleaningDutiesState.find(d => d.id === dutyId);
    if (!duty) return;

    activeDutyContext = duty;
    const modal = document.getElementById('cleaningDutyModal');
    if (!modal) return;

    const myId = currentLoggedInUser ? currentLoggedInUser.roommateId : null;
    const isAssignee = myId && duty.person_id === myId;
    const isOtherRoommate = myId && duty.person_id !== myId;
    const isApproved = duty.status === 'approved';

    // Header info
    const dateParts = duty.duty_date.split('-');
    const dObj = new Date(Date.UTC(dateParts[0], Number(dateParts[1]) - 1, dateParts[2]));
    document.getElementById('dutyDateHeader').textContent = dObj.toLocaleDateString('en-IN', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    document.getElementById('dutyAssigneeName').textContent = duty.assignee_name;

    // Status badge
    const badgeEl = document.getElementById('dutyStatusBadge');
    badgeEl.textContent = duty.status.replace('_', ' ').toUpperCase();
    badgeEl.className = `text-xs font-bold px-2.5 py-1 rounded-full ${
      duty.status === 'approved' ? 'bg-emerald-100 text-emerald-800' :
      duty.status === 'submitted' ? 'bg-amber-100 text-amber-800 animate-pulse' :
      duty.status === 'redo' ? 'bg-rose-100 text-rose-800' :
      duty.status === 'missed' ? 'bg-red-100 text-red-800' :
      'bg-slate-100 text-slate-700'
    }`;

    // Reviewer note alert
    const noteBox = document.getElementById('dutyReviewerNoteBox');
    const noteText = document.getElementById('dutyReviewerNoteText');
    if (duty.status === 'redo' && duty.reviewer_note) {
      noteText.textContent = duty.reviewer_note;
      noteBox.classList.remove('hidden');
    } else {
      noteBox.classList.add('hidden');
    }

    // Checklist items
    const checks = duty.checks || [];
    const doneCount = checks.filter(c => c.done === 1).length;
    document.getElementById('dutyChecklistCounter').textContent = `${doneCount} / ${checks.length}`;

    const chkCont = document.getElementById('dutyChecklistContainer');
    chkCont.innerHTML = checks.map(c => {
      const isDone = c.done === 1;
      const canToggle = isAssignee && !isApproved;

      return `
        <label class="flex items-center gap-2.5 p-1.5 rounded-lg hover:bg-white transition ${canToggle ? 'cursor-pointer' : 'cursor-default'}">
          <input type="checkbox" ${isDone ? 'checked' : ''} ${canToggle ? '' : 'disabled'}
                 onchange="window.toggleDutyCheck(${duty.id}, ${c.id}, this.checked)"
                 class="w-4 h-4 rounded text-teal-600 focus:ring-teal-500">
          <span class="text-xs ${isDone ? 'line-through text-slate-400' : 'text-slate-800 font-medium'}">${escapeHtml(c.item)}</span>
        </label>
      `;
    }).join('');

    // Photo thumbnails
    const photoCont = document.getElementById('dutyPhotosContainer');
    const photos = duty.photos || [];
    if (photos.length === 0) {
      photoCont.innerHTML = '<span class="text-xs text-slate-400 italic py-1">No proof photo uploaded yet</span>';
    } else {
      photoCont.innerHTML = photos.map(p => `
        <div class="relative w-20 h-20 rounded-xl overflow-hidden border border-slate-200 shrink-0 shadow-sm group">
          <img src="${p.photo_data}" alt="Proof" class="w-full h-full object-cover">
          <span class="absolute bottom-0 inset-x-0 bg-black/60 text-[9px] text-white text-center py-0.5 font-medium">Uploaded</span>
        </div>
      `).join('');
    }

    // Photo upload section visibility
    const uploadSec = document.getElementById('dutyUploadSection');
    if (uploadSec) {
      if (isAssignee && !isApproved) {
        uploadSec.classList.remove('hidden');
      } else {
        uploadSec.classList.add('hidden');
      }
    }

    // Submit button visibility
    const submitBtn = document.getElementById('btnSubmitCleaningDuty');
    if (submitBtn) {
      if (isAssignee && !isApproved && duty.status !== 'submitted') {
        submitBtn.classList.remove('hidden');
      } else {
        submitBtn.classList.add('hidden');
      }
    }

    // Review section visibility (for any other roommate when submitted)
    const reviewSec = document.getElementById('dutyReviewActionSection');
    if (reviewSec) {
      if (duty.status === 'submitted' && (isOtherRoommate || (currentLoggedInUser && currentLoggedInUser.isAdmin))) {
        reviewSec.classList.remove('hidden');
      } else {
        reviewSec.classList.add('hidden');
      }
    }

    modal.classList.remove('hidden');
    if (window.lucide) window.lucide.createIcons();
  };

  window.toggleDutyCheck = async function (dutyId, checkId, done) {
    const token = localStorage.getItem('roommate_token');
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    try {
      const res = await fetch(`${CLEANING_URL}/${dutyId}/check`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ checkId, done })
      });
      if (res.ok) {
        // Update local state
        const duty = cleaningDutiesState.find(d => d.id === dutyId);
        if (duty) {
          const item = (duty.checks || []).find(c => c.id === checkId);
          if (item) item.done = done ? 1 : 0;
          if (duty.status === 'upcoming') duty.status = 'in_progress';
          openCleaningDutyModal(dutyId);
          renderCleaningDutiesList();
        }
      }
    } catch (e) {
      console.warn('Error updating check:', e);
    }
  };

  function compressImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const maxDim = 1024;
          let w = img.width;
          let h = img.height;

          if (w > maxDim || h > maxDim) {
            if (w > h) {
              h = Math.round((h * maxDim) / w);
              w = maxDim;
            } else {
              w = Math.round((w * maxDim) / h);
              h = maxDim;
            }
          }

          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
          resolve(dataUrl);
        };
        img.onerror = reject;
        img.src = ev.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function handleDutyPhotoUpload(e) {
    if (!activeDutyContext) return;
    const file = e.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      showToast('Please select a valid image file.');
      return;
    }

    showToast('Compressing photo...');

    try {
      const compressedData = await compressImage(file);
      const token = localStorage.getItem('roommate_token');
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`${CLEANING_URL}/${activeDutyContext.id}/photo`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ photoData: compressedData })
      });

      if (res.ok) {
        showToast('📷 Clean room photo uploaded successfully!');
        await loadCleaningRoster();
        openCleaningDutyModal(activeDutyContext.id);
      } else {
        const err = await res.json();
        showToast(err.error || 'Failed to upload photo.');
      }
    } catch (err) {
      showToast('Error compressing or uploading image.');
    }
  }

  async function submitCleaningDuty() {
    if (!activeDutyContext) return;
    const checks = activeDutyContext.checks || [];
    const doneCount = checks.filter(c => c.done === 1).length;
    const photos = activeDutyContext.photos || [];

    if (doneCount < checks.length) {
      showToast('⚠️ Please complete and check all 7 cleaning items before submitting.');
      return;
    }

    if (photos.length === 0) {
      showToast('⚠️ Please upload at least one clean room photo before submitting.');
      return;
    }

    const token = localStorage.getItem('roommate_token');
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    try {
      const res = await fetch(`${CLEANING_URL}/${activeDutyContext.id}/submit`, {
        method: 'POST',
        headers
      });

      if (res.ok) {
        showToast('✅ Cleaning duty submitted for roommate approval!');
        document.getElementById('cleaningDutyModal').classList.add('hidden');
        await loadCleaningRoster();
      } else {
        const err = await res.json();
        showToast(err.error || 'Submission failed.');
      }
    } catch (e) {
      showToast('Network error.');
    }
  }

  async function reviewDuty(action, note = '') {
    if (!activeDutyContext) return;
    const token = localStorage.getItem('roommate_token');
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    try {
      const res = await fetch(`${CLEANING_URL}/${activeDutyContext.id}/review`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ action, note })
      });

      if (res.ok) {
        showToast(action === 'approve' ? '🎉 Clean room approved!' : 'Redo requested with note.');
        document.getElementById('cleaningDutyModal').classList.add('hidden');
        await loadCleaningRoster();
      } else {
        const err = await res.json();
        showToast(err.error || 'Action failed.');
      }
    } catch (e) {
      showToast('Network error.');
    }
  }

  async function generateCleaningRoster() {
    if (!confirm('Generate Sunday cleaning rotation for this month?')) return;
    const token = localStorage.getItem('roommate_token');
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const now = new Date();
    try {
      const res = await fetch(`${CLEANING_URL}/generate`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ year: now.getFullYear(), month: now.getMonth() + 1 })
      });

      if (res.ok) {
        const data = await res.json();
        showToast(`✅ ${data.message || 'Roster generated!'}`);
        await loadCleaningRoster();
      } else {
        const err = await res.json();
        showToast(err.error || 'Failed to generate roster.');
      }
    } catch (e) {
      showToast('Network error.');
    }
  }

  function openSwapDutyModal() {
    if (!activeDutyContext) return;
    const select = document.getElementById('selectSwapTargetPerson');
    if (!select) return;

    select.innerHTML = appState.roommates
      .filter(r => r.id !== activeDutyContext.person_id)
      .map(r => `
        <option value="${r.id}">${escapeHtml(r.name.replace(/\s*\(You\)/i, ''))}</option>
      `).join('');

    document.getElementById('swapCleaningModal').classList.remove('hidden');
  }

  async function confirmSwapDuty() {
    if (!activeDutyContext) return;
    const targetPersonId = document.getElementById('selectSwapTargetPerson').value;
    if (!targetPersonId) return;

    const token = localStorage.getItem('roommate_token');
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    try {
      const res = await fetch(`${CLEANING_URL}/${activeDutyContext.id}/swap`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ targetPersonId })
      });

      if (res.ok) {
        showToast('✅ Cleaning duty turn swapped successfully!');
        document.getElementById('swapCleaningModal').classList.add('hidden');
        document.getElementById('cleaningDutyModal').classList.add('hidden');
        await loadCleaningRoster();
      } else {
        const err = await res.json();
        showToast(err.error || 'Swap failed.');
      }
    } catch (e) {
      showToast('Network error.');
    }
  }

  // ==========================================
  // ---------- PHASE 4: PERSONAL DASHBOARD, SETTLE UP & REMINDERS ----------
  // ==========================================

  let activeWaReminderType = 'rent';

  function renderPersonalDashboard() {
    const dashSection = document.getElementById('personalDashboardSection');
    if (!dashSection) return;

    if (!currentLoggedInUser) {
      dashSection.classList.add('hidden');
      return;
    }

    dashSection.classList.remove('hidden');

    // 1. Header greeting
    const greeting = document.getElementById('dashGreeting');
    if (greeting) greeting.textContent = `👋 Welcome back, ${currentLoggedInUser.display}!`;

    const sub = document.getElementById('dashSubheading');
    if (sub) sub.textContent = `Live summary for Room 12 • ${appState.activeMonth || 'October 2026'}`;

    // 2. Card 1: Room Rent & Bills
    const myRentRecord = appState.roommates.find(r => 
      r.id === currentLoggedInUser.roommateId || 
      r.name.toLowerCase().includes(currentLoggedInUser.display.toLowerCase())
    );
    const { perHead } = getTotals();
    const dashRentAmount = document.getElementById('dashRentAmount');
    if (dashRentAmount) dashRentAmount.textContent = `₹${perHead.toLocaleString('en-IN')}`;

    const dashRentDueNote = document.getElementById('dashRentDueNote');
    if (dashRentDueNote) dashRentDueNote.textContent = appState.dueNote || 'Due by 5th of every month';

    const dashRentBadge = document.getElementById('dashRentBadge');
    const dashRentActionText = document.getElementById('dashRentActionText');
    const isRentPaid = myRentRecord && myRentRecord.status === 'paid';

    if (dashRentBadge) {
      if (isRentPaid) {
        dashRentBadge.className = 'text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200';
        dashRentBadge.textContent = 'Paid ✅';
      } else {
        dashRentBadge.className = 'text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200';
        dashRentBadge.textContent = 'Pending ⏳';
      }
    }
    if (dashRentActionText) {
      dashRentActionText.textContent = isRentPaid ? 'View Receipt' : 'Pay Rent';
    }

    // 3. Card 2: Shared Expenses
    const expenses = expensesState.expenses || [];
    const splits = expensesState.splits || [];
    const payments = expensesState.payments || [];

    let myReceivablePaise = 0;
    let myPayablePaise = 0;
    const pendingConfirmsToMe = [];

    function getConfirmedPaid(expId, fromId, toId) {
      return payments
        .filter(p => p.expense_id === expId && p.from_id === fromId && p.to_id === toId && p.status === 'confirmed')
        .reduce((sum, p) => sum + p.amount_paise, 0);
    }

    expenses.forEach(exp => {
      const expSplits = splits.filter(s => s.expense_id === exp.id);
      const buyerId = exp.paid_by;

      if (buyerId === currentLoggedInUser.roommateId) {
        expSplits.forEach(sp => {
          if (sp.person_id === buyerId) return;
          const confirmed = getConfirmedPaid(exp.id, sp.person_id, buyerId);
          const rem = Math.max(0, sp.share_paise - confirmed);
          if (rem > 0) myReceivablePaise += rem;
        });
      } else {
        const mySp = expSplits.find(s => s.person_id === currentLoggedInUser.roommateId);
        if (mySp) {
          const confirmed = getConfirmedPaid(exp.id, currentLoggedInUser.roommateId, buyerId);
          const rem = Math.max(0, mySp.share_paise - confirmed);
          if (rem > 0) myPayablePaise += rem;
        }
      }
    });

    payments.forEach(p => {
      if (p.to_id === currentLoggedInUser.roommateId && p.status === 'pending') {
        pendingConfirmsToMe.push(p);
      }
    });

    const netPaise = myReceivablePaise - myPayablePaise;
    const netRupees = Math.round(netPaise / 100);
    const dashExpenseNet = document.getElementById('dashExpenseNet');
    const dashExpenseBadge = document.getElementById('dashExpenseBadge');
    const dashExpenseDetail = document.getElementById('dashExpenseDetail');

    if (dashExpenseNet && dashExpenseBadge && dashExpenseDetail) {
      if (netRupees > 0) {
        dashExpenseBadge.className = 'text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200';
        dashExpenseBadge.textContent = `+₹${netRupees} Receivable`;
        dashExpenseNet.className = 'text-2xl font-black text-emerald-700';
        dashExpenseNet.textContent = `+₹${netRupees.toLocaleString('en-IN')}`;
        dashExpenseDetail.textContent = `Roommates owe you ₹${Math.round(myReceivablePaise / 100).toLocaleString('en-IN')}`;
      } else if (netRupees < 0) {
        dashExpenseBadge.className = 'text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200';
        dashExpenseBadge.textContent = `-₹${Math.abs(netRupees)} Payable`;
        dashExpenseNet.className = 'text-2xl font-black text-rose-700';
        dashExpenseNet.textContent = `-₹${Math.abs(netRupees).toLocaleString('en-IN')}`;
        dashExpenseDetail.textContent = `You owe buyers ₹${Math.round(myPayablePaise / 100).toLocaleString('en-IN')}`;
      } else {
        dashExpenseBadge.className = 'text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200';
        dashExpenseBadge.textContent = 'All Settled ✅';
        dashExpenseNet.className = 'text-2xl font-black text-slate-900';
        dashExpenseNet.textContent = '₹0';
        dashExpenseDetail.textContent = 'No pending debts';
      }
    }

    // 4. Card 3: Sunday Cleaning
    const duties = Array.isArray(cleaningDutiesState) ? cleaningDutiesState : [];
    const myDuties = duties.filter(d => d.person_id === currentLoggedInUser.roommateId);
    const activeDuty = myDuties.find(d => ['upcoming', 'in_progress', 'submitted', 'redo'].includes(d.status)) || myDuties[0];

    const dashCleaningBadge = document.getElementById('dashCleaningBadge');
    const dashCleaningDate = document.getElementById('dashCleaningDate');
    const dashCleaningProgress = document.getElementById('dashCleaningProgress');
    const dashCleaningRatio = document.getElementById('dashCleaningRatio');

    if (activeDuty) {
      const dObj = new Date(activeDuty.duty_date + 'T00:00:00Z');
      const dateFormatted = dObj.toLocaleDateString('en-IN', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });
      if (dashCleaningDate) dashCleaningDate.textContent = `${dateFormatted} (Sun)`;

      const checks = activeDuty.checks || [];
      const totalChecks = checks.length || 7;
      const doneChecks = checks.filter(c => c.done).length;
      const pct = Math.round((doneChecks / totalChecks) * 100);

      if (dashCleaningProgress) dashCleaningProgress.style.width = `${pct}%`;
      if (dashCleaningRatio) dashCleaningRatio.textContent = `${doneChecks}/${totalChecks}`;

      if (dashCleaningBadge) {
        const badgeClasses = {
          upcoming: 'bg-slate-100 text-slate-700 border-slate-300',
          in_progress: 'bg-amber-100 text-amber-800 border-amber-300',
          submitted: 'bg-purple-100 text-purple-800 border-purple-300',
          approved: 'bg-emerald-100 text-emerald-800 border-emerald-300',
          redo: 'bg-rose-100 text-rose-800 border-rose-300',
          missed: 'bg-red-100 text-red-800 border-red-300'
        };
        dashCleaningBadge.className = `text-[11px] font-bold px-2.5 py-0.5 rounded-full border ${badgeClasses[activeDuty.status] || 'bg-slate-100 text-slate-700'}`;
        dashCleaningBadge.textContent = activeDuty.status.toUpperCase();
      }
    } else {
      if (dashCleaningDate) dashCleaningDate.textContent = 'Not assigned yet';
      if (dashCleaningProgress) dashCleaningProgress.style.width = '0%';
      if (dashCleaningRatio) dashCleaningRatio.textContent = '0/7';
      if (dashCleaningBadge) {
        dashCleaningBadge.className = 'text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200';
        dashCleaningBadge.textContent = 'Upcoming';
      }
    }

    // 5. Action Alert Banner
    const actionBanner = document.getElementById('dashActionBanner');
    if (actionBanner) {
      if (pendingConfirmsToMe.length > 0) {
        actionBanner.className = 'p-4 rounded-2xl border border-amber-300 bg-amber-50 text-amber-900 transition-all animate-fade-in shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3';
        actionBanner.innerHTML = `
          <div class="flex items-center gap-3">
            <div class="w-9 h-9 rounded-xl bg-amber-200 text-amber-800 flex items-center justify-center font-bold shrink-0">
              <i data-lucide="bell" class="w-5 h-5 text-amber-700"></i>
            </div>
            <div>
              <p class="text-xs font-bold">Payment Confirmation Needed</p>
              <p class="text-[11px] text-amber-800">You have ${pendingConfirmsToMe.length} payment(s) sent to you waiting for your confirmation.</p>
            </div>
          </div>
          <button onclick="loadExpenses(); document.getElementById('expensesModal').classList.remove('hidden');"
                  class="px-3.5 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold transition shadow-sm self-start sm:self-auto">
            Review & Confirm
          </button>
        `;
        actionBanner.classList.remove('hidden');
      } else if (activeDuty && activeDuty.status === 'in_progress') {
        actionBanner.className = 'p-4 rounded-2xl border border-teal-300 bg-teal-50 text-teal-900 transition-all animate-fade-in shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3';
        actionBanner.innerHTML = `
          <div class="flex items-center gap-3">
            <div class="w-9 h-9 rounded-xl bg-teal-200 text-teal-800 flex items-center justify-center font-bold shrink-0">
              <i data-lucide="sparkles" class="w-5 h-5 text-teal-700"></i>
            </div>
            <div>
              <p class="text-xs font-bold">Cleaning In Progress</p>
              <p class="text-[11px] text-teal-800">Complete all 7 checklist tasks and upload a clean-room photo to finish.</p>
            </div>
          </div>
          <button onclick="window.openCleaningDutyModal(${activeDuty.id})"
                  class="px-3.5 py-1.5 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-xs font-bold transition shadow-sm self-start sm:self-auto">
            Open Checklist
          </button>
        `;
        actionBanner.classList.remove('hidden');
      } else if (!isRentPaid) {
        actionBanner.className = 'p-4 rounded-2xl border border-slate-200 bg-white text-slate-800 transition-all animate-fade-in shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3';
        actionBanner.innerHTML = `
          <div class="flex items-center gap-3">
            <div class="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center font-bold shrink-0">
              <i data-lucide="info" class="w-5 h-5 text-emerald-600"></i>
            </div>
            <div>
              <p class="text-xs font-bold">Monthly Rent Share Pending</p>
              <p class="text-[11px] text-slate-500">Your share of ₹${perHead.toLocaleString('en-IN')} for ${appState.activeMonth} is pending.</p>
            </div>
          </div>
          <button onclick="window.openCheckoutModal('${myRentRecord ? myRentRecord.id : '1'}')"
                  class="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition shadow-sm self-start sm:self-auto">
            Pay Rent Now
          </button>
        `;
        actionBanner.classList.remove('hidden');
      } else {
        actionBanner.classList.add('hidden');
      }
    }

    if (window.lucide) window.lucide.createIcons();
  }

  // ---------- SMART SETTLE UP ALGORITHM ----------

  function calculateSettleUpSuggestions() {
    const expenses = expensesState.expenses || [];
    const splits = expensesState.splits || [];
    const payments = expensesState.payments || [];

    const netPaise = {};
    appState.roommates.forEach(r => { netPaise[r.id] = 0; });

    // 1. Sum expenses paid by each buyer
    expenses.forEach(exp => {
      const payerId = exp.paid_by;
      if (netPaise[payerId] !== undefined) {
        netPaise[payerId] += exp.amount_paise;
      }
    });

    // 2. Subtract each roommate's allocated split share
    splits.forEach(sp => {
      if (netPaise[sp.person_id] !== undefined) {
        netPaise[sp.person_id] -= sp.share_paise;
      }
    });

    // 3. Adjust confirmed partial and full payments
    payments.forEach(p => {
      if (p.status === 'confirmed') {
        if (netPaise[p.from_id] !== undefined) netPaise[p.from_id] += p.amount_paise;
        if (netPaise[p.to_id] !== undefined) netPaise[p.to_id] -= p.amount_paise;
      }
    });

    // Debtors owe money (net < -50), Creditors get money back (net > 50)
    const debtors = [];
    const creditors = [];

    appState.roommates.forEach(r => {
      const net = netPaise[r.id] || 0;
      const cleanName = r.name.replace(/\s*\(You\)/i, '');
      const dirEntry = roommatesDirectory.find(d => d.id === r.id);
      const upi = dirEntry?.upiId || (r.id === '2' ? '8459807346@slc' : '');
      const phone = dirEntry?.phone || '918459807346';

      if (net < -50) {
        debtors.push({ id: r.id, name: cleanName, net: -net, upi, phone });
      } else if (net > 50) {
        creditors.push({ id: r.id, name: cleanName, net: net, upi, phone });
      }
    });

    debtors.sort((a, b) => b.net - a.net);
    creditors.sort((a, b) => b.net - a.net);

    const suggestions = [];
    let dIdx = 0;
    let cIdx = 0;

    while (dIdx < debtors.length && cIdx < creditors.length) {
      const debtor = debtors[dIdx];
      const creditor = creditors[cIdx];
      const settleAmount = Math.min(debtor.net, creditor.net);

      suggestions.push({
        fromId: debtor.id,
        fromName: debtor.name,
        fromPhone: debtor.phone,
        toId: creditor.id,
        toName: creditor.name,
        toUpi: creditor.upi,
        toPhone: creditor.phone,
        amountPaise: settleAmount,
        amountRupees: Math.round(settleAmount / 100)
      });

      debtor.net -= settleAmount;
      creditor.net -= settleAmount;

      if (debtor.net <= 50) dIdx++;
      if (creditor.net <= 50) cIdx++;
    }

    return suggestions;
  }

  function openSettleUpModal() {
    const modal = document.getElementById('settleUpModal');
    const list = document.getElementById('settleUpList');
    if (!modal || !list) return;

    const suggestions = calculateSettleUpSuggestions();

    if (suggestions.length === 0) {
      list.innerHTML = `
        <div class="p-6 text-center space-y-2 bg-emerald-50/60 rounded-2xl border border-emerald-200">
          <div class="w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto text-xl">
            🎉
          </div>
          <h4 class="font-bold text-slate-800 text-sm">All Settled Up!</h4>
          <p class="text-xs text-slate-500">Every roommate is completely even. There are no pending shared debts.</p>
        </div>
      `;
    } else {
      list.innerHTML = suggestions.map((s, idx) => `
        <div class="p-3.5 bg-slate-50 border border-slate-200 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:border-slate-300 transition">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-amber-100 text-amber-800 font-black text-xs flex items-center justify-center shrink-0 shadow-sm">
              ₹${s.amountRupees}
            </div>
            <div>
              <div class="text-xs font-bold text-slate-900">
                <span class="text-rose-600 font-extrabold">${escapeHtml(s.fromName)}</span> pays <span class="text-emerald-700 font-extrabold">${escapeHtml(s.toName)}</span>
              </div>
              <div class="text-[11px] text-slate-500 font-mono mt-0.5">
                ${s.toUpi ? 'UPI: ' + escapeHtml(s.toUpi) : 'UPI ID on file'}
              </div>
            </div>
          </div>
          <div class="flex items-center gap-2 self-end sm:self-auto">
            ${s.toUpi ? `
              <button onclick="window.openQuickPayForRoommate('${s.toId}', '${escapeHtml(s.toName)}', '${escapeHtml(s.toUpi)}', ${s.amountRupees}, 'Room 12 Settle Up')"
                      class="px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold transition flex items-center gap-1 shadow-sm">
                <i data-lucide="send" class="w-3 h-3"></i>
                <span>Pay UPI</span>
              </button>
            ` : ''}
            <button onclick="window.sendSettleReminderWa('${s.fromId}', '${escapeHtml(s.fromName)}', '${escapeHtml(s.toName)}', ${s.amountRupees})"
                    class="px-2.5 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-lg text-xs font-bold transition flex items-center gap-1">
              <i data-lucide="message-circle" class="w-3 h-3"></i>
              <span>Remind</span>
            </button>
          </div>
        </div>
      `).join('');
    }

    modal.classList.remove('hidden');
    if (window.lucide) window.lucide.createIcons();
  }

  window.openQuickPayForRoommate = function (toId, toName, toUpi, amountRupees, note) {
    if (!toUpi) {
      showToast(`${toName} does not have a UPI ID saved.`);
      return;
    }
    document.getElementById('settleUpModal')?.classList.add('hidden');
    window.openQuickPayModal(toName, toUpi);
    const amtInput = document.getElementById('quickPayAmount');
    if (amtInput) {
      amtInput.value = amountRupees;
      updateQuickPayQr();
    }
  };

  window.sendSettleReminderWa = function (fromId, fromName, toName, amountRupees) {
    const text = `💸 *ROOM NO 12 - Expense Settlement Reminder*\nHey ${fromName}! A quick reminder that your pending balance to settle with ${toName} is *₹${amountRupees.toLocaleString('en-IN')}*.\n\nPlease pay via UPI or check the portal:\nhttps://kalpesh55567.github.io/Room-Rent-/roommate-rent-tracker/`;
    
    const dirEntry = roommatesDirectory.find(d => d.id === fromId);
    let phone = dirEntry?.phone || '';
    if (phone && phone.length === 10) phone = '91' + phone;

    const waUrl = phone
      ? `https://wa.me/${phone}?text=${encodeURIComponent(text)}`
      : `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`;

    window.open(waUrl, '_blank');
  };

  function shareSettleUpPlanToWhatsApp() {
    const suggestions = calculateSettleUpSuggestions();
    let text = `📊 *ROOM NO 12 - Smart Settle Up Plan*\n`;
    text += `━━━━━━━━━━━━━━━━━━━━━\n`;
    if (suggestions.length === 0) {
      text += `🎉 All shared expenses are currently settled! Everyone is even.\n`;
    } else {
      text += `Minimal payments to square away all shared debts:\n\n`;
      suggestions.forEach((s, idx) => {
        text += `${idx + 1}. *${s.fromName}* pays *₹${s.amountRupees.toLocaleString('en-IN')}* to *${s.toName}*`;
        if (s.toUpi) text += ` (UPI: ${s.toUpi})`;
        text += `\n`;
      });
      text += `\n✨ After these transfers, everyone is 100% settled!\n`;
    }
    text += `\n🔗 View details: https://kalpesh55567.github.io/Room-Rent-/roommate-rent-tracker/`;

    const waUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`;
    window.open(waUrl, '_blank');
  }

  // ---------- WHATSAPP REMINDER BUILDER ----------

  function openWhatsAppReminderModal(type = 'rent', targetRoommateId = null) {
    activeWaReminderType = type;
    const modal = document.getElementById('whatsappReminderModal');
    if (!modal) return;

    const sel = document.getElementById('waRecipientSelect');
    if (sel) {
      sel.innerHTML = `
        <option value="group">👥 Room No 12 WhatsApp Group</option>
        ${appState.roommates.map(r => `
          <option value="${r.id}">${escapeHtml(r.name.replace(/\s*\(You\)/i, ''))}</option>
        `).join('')}
      `;
      if (targetRoommateId) sel.value = targetRoommateId;
    }

    selectWhatsAppReminderType(type);
    modal.classList.remove('hidden');
    if (window.lucide) window.lucide.createIcons();
  }

  function selectWhatsAppReminderType(type) {
    activeWaReminderType = type;
    const rentBtn = document.getElementById('waTypeRentBtn');
    const expBtn = document.getElementById('waTypeExpenseBtn');
    const cleanBtn = document.getElementById('waTypeCleaningBtn');

    [rentBtn, expBtn, cleanBtn].forEach(b => {
      if (!b) return;
      b.className = 'wa-type-btn py-1.5 px-2 rounded-lg text-xs font-bold border border-slate-200 text-slate-600 text-center transition';
    });

    if (type === 'rent' && rentBtn) {
      rentBtn.className = 'wa-type-btn py-1.5 px-2 rounded-lg text-xs font-bold border border-emerald-500 bg-emerald-50 text-emerald-800 text-center transition';
    } else if (type === 'expense' && expBtn) {
      expBtn.className = 'wa-type-btn py-1.5 px-2 rounded-lg text-xs font-bold border border-indigo-500 bg-indigo-50 text-indigo-800 text-center transition';
    } else if (type === 'cleaning' && cleanBtn) {
      cleanBtn.className = 'wa-type-btn py-1.5 px-2 rounded-lg text-xs font-bold border border-teal-500 bg-teal-50 text-teal-800 text-center transition';
    }

    updateWhatsAppMessagePreview();
  }

  function updateWhatsAppMessagePreview() {
    const sel = document.getElementById('waRecipientSelect');
    const targetId = sel ? sel.value : 'group';
    const previewBox = document.getElementById('waMessageText');
    if (!previewBox) return;

    const { perHead } = getTotals();
    const portalUrl = 'https://kalpesh55567.github.io/Room-Rent-/roommate-rent-tracker/';
    let msg = '';

    if (activeWaReminderType === 'rent') {
      if (targetId === 'group') {
        msg = `🏠 *ROOM NO 12 - Rent & Bills (${appState.activeMonth})*\n` +
              `Due by: ${appState.dueNote || '5th of this month'}\n` +
              `━━━━━━━━━━━━━━━━━━━━━\n` +
              `💰 Per Person Share: *₹${perHead.toLocaleString('en-IN')}*\n\n` +
              `📋 *Status:*\n` +
              appState.roommates.map(r => {
                const icon = r.status === 'paid' ? '✅ Paid' : '⏳ Pending';
                return `• ${r.name.replace(/\s*\(You\)/i, '')}: ${icon}`;
              }).join('\n') +
              `\n\nUPI: ${appState.upiId || '8459807346@slc'}\n` +
              `Portal: ${portalUrl}`;
      } else {
        const r = appState.roommates.find(x => x.id === targetId);
        const name = r ? r.name.replace(/\s*\(You\)/i, '') : 'Roommate';
        const isPaid = r && r.status === 'paid';
        msg = `🏠 *ROOM NO 12 - Rent Reminder*\n` +
              `Hey ${name}!\n` +
              `Your rent & light bill share for *${appState.activeMonth}* is *₹${perHead.toLocaleString('en-IN')}*.\n` +
              `Status: ${isPaid ? '✅ Paid' : '⏳ Pending'}\n` +
              `Due: ${appState.dueNote || 'Due by 5th of this month'}\n\n` +
              `UPI ID: ${appState.upiId || '8459807346@slc'}\n` +
              `Pay here: ${portalUrl}`;
      }
    } else if (activeWaReminderType === 'expense') {
      const suggestions = calculateSettleUpSuggestions();
      if (targetId === 'group') {
        msg = `💸 *ROOM NO 12 - Shared Expenses Summary*\n` +
              `━━━━━━━━━━━━━━━━━━━━━\n`;
        if (suggestions.length === 0) {
          msg += `All shared expenses are settled! 🎉\n`;
        } else {
          msg += `Pending settlements:\n` +
            suggestions.map((s, i) => `${i + 1}. *${s.fromName}* owes *₹${s.amountRupees}* to *${s.toName}*`).join('\n') +
            `\n\n`;
        }
        msg += `Portal: ${portalUrl}`;
      } else {
        const r = appState.roommates.find(x => x.id === targetId);
        const name = r ? r.name.replace(/\s*\(You\)/i, '') : 'Roommate';
        const userDebts = suggestions.filter(s => s.fromId === targetId);
        if (userDebts.length > 0) {
          msg = `💸 *ROOM NO 12 - Expense Reminder*\n` +
                `Hey ${name}!\n` +
                `Quick reminder regarding pending shared expense splits:\n` +
                userDebts.map(d => `• ₹${d.amountRupees} to ${d.toName} (UPI: ${d.toUpi || 'on file'})`).join('\n') +
                `\n\nPlease settle up when you get a chance:\n${portalUrl}`;
        } else {
          msg = `💸 *ROOM NO 12 - Shared Expenses*\n` +
                `Hey ${name}! You are currently all settled up on shared expenses. 🎉\n` +
                `Check portal: ${portalUrl}`;
        }
      }
    } else if (activeWaReminderType === 'cleaning') {
      const duties = Array.isArray(cleaningDutiesState) ? cleaningDutiesState : [];
      if (targetId === 'group') {
        msg = `🧹 *ROOM NO 12 - Sunday Cleaning Roster*\n` +
              `━━━━━━━━━━━━━━━━━━━━━\n` +
              (duties.length > 0
                ? duties.map(d => `• ${d.duty_date}: *${d.assignee_name}* (${d.status.toUpperCase()})`).join('\n')
                : `Roster will be generated soon.\n`) +
              `\nPortal: ${portalUrl}`;
      } else {
        const r = appState.roommates.find(x => x.id === targetId);
        const name = r ? r.name.replace(/\s*\(You\)/i, '') : 'Roommate';
        const duty = duties.find(d => d.person_id === targetId && ['upcoming', 'in_progress', 'submitted', 'redo'].includes(d.status)) || duties.find(d => d.person_id === targetId);
        const dateStr = duty ? duty.duty_date : 'this Sunday';
        msg = `🧹 *ROOM NO 12 - Sunday Cleaning Reminder*\n` +
              `Hey ${name}!\n` +
              `Friendly reminder that *${dateStr}* is your turn for Sunday flat cleaning.\n\n` +
              `Please complete the 7-point checklist and upload the clean room photo:\n` +
              `${portalUrl}`;
      }
    }

    previewBox.value = msg;
  }

  function handleSendWhatsAppFromModal() {
    const sel = document.getElementById('waRecipientSelect');
    const targetId = sel ? sel.value : 'group';
    const text = document.getElementById('waMessageText').value;
    if (!text) return;

    let phone = '';
    if (targetId !== 'group') {
      const dir = roommatesDirectory.find(d => d.id === targetId);
      if (dir && dir.phone) phone = dir.phone;
    }

    if (phone && phone.length === 10) phone = '91' + phone;

    const waUrl = phone
      ? `https://wa.me/${phone}?text=${encodeURIComponent(text)}`
      : `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`;

    window.open(waUrl, '_blank');
  }

})();
