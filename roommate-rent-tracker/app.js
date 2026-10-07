// Roommate Rent & Light Bill Tracker
// Client-side Application Logic with In-Website Payment & Receipts

(function () {
  'use strict';

  // Incremented storage key to cleanly load user's new rates & 5 roommates
  const STORAGE_KEY = 'roommate_rent_tracker_v5';
  const DEFAULT_PIN = '8459';

  // Exact data configured: Rent 8500, Bldg Maint 500, Room Cleaning 500, Light bill dynamic input
  const defaultData = {
    flatName: 'ROOM NO 12',
    activeMonth: 'October 2026',
    dueNote: 'Due by 5th of every month',
    upiId: '8459807346@slc',
    adminPhone: '918459807346',
    razorpayKey: '', // Optional: user can enter their free Razorpay Key in Admin
    adminPin: DEFAULT_PIN,
    bill: {
      roomRent: 8500,
      buildingMaintenance: 500,
      cleaningMaintenance: 500,
      lightBill: 1000, // Dynamic light bill entered by user each month
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

  // Authorized Roommate Accounts
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
  let activePayingRoommate = null;
  let activeReceiptRoommate = null;

  // Detect mobile device reliably
  function isMobileDevice() {
    return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (window.innerWidth <= 768 && ('ontouchstart' in window));
  }

  // Safe Unicode Base64 encoding/decoding (prevents crash on emojis or Indian regional characters)
  function safeUtf8ToBase64(str) {
    try {
      return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, function (match, p1) {
        return String.fromCharCode(parseInt(p1, 16));
      }));
    } catch (e) {
      console.warn('Base64 encoding fallback:', e);
      return btoa(unescape(encodeURIComponent(str)));
    }
  }

  function safeBase64ToUtf8(str) {
    try {
      return decodeURIComponent(Array.prototype.map.call(atob(str), function (c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
      }).join(''));
    } catch (e) {
      console.warn('Base64 decoding fallback:', e);
      return decodeURIComponent(escape(atob(str)));
    }
  }

  // Initialize DOM on Load
  document.addEventListener('DOMContentLoaded', () => {
    checkUrlForSharedData();
    initMonthSelector();
    initAuth();
    renderAll();
    setupEventListeners();
    loadDataJson();
  });

  // Load state from URL hash or LocalStorage
  function loadState() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY) || localStorage.getItem('roommate_rent_tracker_v4');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.adminPin === '1234' || !parsed.adminPin) {
          parsed.adminPin = DEFAULT_PIN;
        }
        if (parsed.flatName === 'Flat Bills' || !parsed.flatName) {
          parsed.flatName = 'ROOM NO 12';
        }
        return {
          ...defaultData,
          ...parsed,
          flatName: (parsed.flatName === 'Flat Bills' || !parsed.flatName) ? 'ROOM NO 12' : parsed.flatName,
          adminPin: parsed.adminPin === '1234' ? DEFAULT_PIN : (parsed.adminPin || DEFAULT_PIN),
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
  }

  // URL Hash state loader (Allows roommates to get latest data from WhatsApp link)
  function checkUrlForSharedData() {
    try {
      if (window.location.hash && window.location.hash.startsWith('#data=')) {
        const rawB64 = window.location.hash.replace('#data=', '');
        const jsonStr = safeBase64ToUtf8(rawB64);
        const sharedData = JSON.parse(jsonStr);

        if (sharedData && sharedData.bill && Array.isArray(sharedData.roommates)) {
          // Merge while keeping admin PIN local if exists
          appState = {
            ...appState,
            ...sharedData,
            bill: { ...defaultData.bill, ...(sharedData.bill || {}) },
            adminPin: appState.adminPin || DEFAULT_PIN
          };
          saveState();

          const banner = document.getElementById('syncBanner');
          const bannerMsg = document.getElementById('syncBannerMsg');
          if (banner && bannerMsg) {
            bannerMsg.textContent = `Latest bills loaded for ${appState.activeMonth}!`;
            banner.classList.remove('hidden');
          }
          // Clear hash cleanly from URL without page reload
          history.replaceState(null, document.title, window.location.pathname + window.location.search);
        }
      }
    } catch (err) {
      console.warn('Could not parse shared link data:', err);
    }
  }

  // Authentication & Session Management
  function initAuth() {
    try {
      const stored = localStorage.getItem('roommate_logged_in_user');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed && parsed.id) {
          const matched = AUTH_USERS.find(u => u.id.toLowerCase() === parsed.id.toLowerCase());
          if (matched) {
            currentLoggedInUser = matched;
            const loginScreen = document.getElementById('loginScreen');
            if (loginScreen) loginScreen.classList.add('hidden');
            updateUserHeaderBadge();
            return;
          }
        }
      }
    } catch (e) {
      console.warn('Error restoring user session:', e);
    }

    // Default: Show login screen if not authenticated
    const loginScreen = document.getElementById('loginScreen');
    if (loginScreen) loginScreen.classList.remove('hidden');
    updateUserHeaderBadge();
  }

  function handleLogin(username, password) {
    const cleanUser = (username || '').trim().toLowerCase();
    const cleanPass = (password || '').trim();

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
    isAdminAuthenticated = false;

    const loginScreen = document.getElementById('loginScreen');
    if (loginScreen) {
      loginScreen.classList.remove('hidden');
      const passField = document.getElementById('loginPassword');
      if (passField) passField.value = '';
    }

    const adminPanel = document.getElementById('adminPanel');
    if (adminPanel) adminPanel.classList.add('hidden');

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

    if (userField) {
      userField.value = name;
    }
    if (passField) {
      passField.focus();
    }
  };

  // Load data.json from server if present (for permanent cross-device sync)
  async function loadDataJson() {
    try {
      const res = await fetch('data.json?t=' + Date.now(), { cache: 'no-store' });
      if (res.ok) {
        const remoteData = await res.json();
        if (remoteData && remoteData.bill) {
          appState = {
            ...defaultData,
            ...appState,
            ...remoteData,
            flatName: remoteData.flatName || appState.flatName || 'ROOM NO 12',
            bill: { ...defaultData.bill, ...appState.bill, ...(remoteData.bill || {}) },
            roommates: Array.isArray(remoteData.roommates) && remoteData.roommates.length > 0
              ? remoteData.roommates
              : appState.roommates,
            adminPin: appState.adminPin || DEFAULT_PIN
          };
          saveState();
          renderAll();
        }
      }
    } catch (e) {
      console.warn('data.json check:', e);
    }
  }

  function downloadDataJson() {
    try {
      const exportData = {
        flatName: appState.flatName || 'ROOM NO 12',
        activeMonth: appState.activeMonth,
        dueNote: appState.dueNote,
        upiId: appState.upiId,
        adminPhone: appState.adminPhone,
        razorpayKey: appState.razorpayKey,
        bill: appState.bill,
        roommates: appState.roommates
      };
      const jsonStr = JSON.stringify(exportData, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'data.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast('data.json downloaded! Upload it to your GitHub repository to update all browsers permanently.');
    } catch (err) {
      console.error('Error generating data.json download:', err);
    }
  }

  // Generate URL that encodes full current state
  function getShareableUrl() {
    try {
      const exportData = {
        flatName: appState.flatName,
        activeMonth: appState.activeMonth,
        dueNote: appState.dueNote,
        upiId: appState.upiId,
        adminPhone: appState.adminPhone,
        razorpayKey: appState.razorpayKey,
        bill: appState.bill,
        roommates: appState.roommates
      };
      const jsonStr = JSON.stringify(exportData);
      const b64 = safeUtf8ToBase64(jsonStr);
      const base = window.location.origin + window.location.pathname;
      return `${base}#data=${b64}`;
    } catch (e) {
      console.error('Failed to create share link', e);
      return window.location.href;
    }
  }

  // Month selector options
  function initMonthSelector() {
    const monthSelect = document.getElementById('monthSelect');
    if (!monthSelect) return;

    const months = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    const currDate = new Date();
    const currYear = currDate.getFullYear();

    const options = [];
    for (let y = currYear; y <= currYear + 1; y++) {
      for (let m = 0; m < 12; m++) {
        const str = `${months[m]} ${y}`;
        options.push(str);
      }
    }

    // Ensure currently selected month is included
    if (appState.activeMonth && !options.includes(appState.activeMonth)) {
      options.unshift(appState.activeMonth);
    }

    monthSelect.innerHTML = options.map(m => {
      const selected = m === appState.activeMonth ? 'selected' : '';
      return `<option value="${escapeHtml(m)}" ${selected} class="bg-slate-800 text-white">${escapeHtml(m)}</option>`;
    }).join('');

    monthSelect.addEventListener('change', (e) => {
      appState.activeMonth = e.target.value;
      const adminMonthInput = document.getElementById('inputAdminMonth');
      if (adminMonthInput) adminMonthInput.value = e.target.value;
      saveState();
      renderAll();
    });
  }

  // Build standard UPI URI for payments
  function buildUpiUri(amount, roommateName) {
    const upiId = appState.upiId || '8459807346@slc';
    const note = encodeURIComponent(`${roommateName} ${appState.activeMonth} Rent & Bills`);
    const name = encodeURIComponent(appState.flatName || 'Flat Rent');
    return `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${name}&am=${amount}&tn=${note}&cu=INR`;
  }

  // Main Render Function
  function renderAll() {
    const rent = Number(appState.bill.roomRent) || 8500;
    const bldgMaint = Number(appState.bill.buildingMaintenance) || 500;
    const cleanMaint = Number(appState.bill.cleaningMaintenance) || 500;
    const light = Number(appState.bill.lightBill) || 0;
    const total = rent + bldgMaint + cleanMaint + light;
    const count = appState.roommates.length || 5;
    const perHead = Math.round(total / count);

    // Header & Titles
    document.getElementById('headerFlatName').textContent = appState.flatName;
    document.getElementById('headerMonthBadge').textContent = appState.activeMonth;
    document.getElementById('activeMonthTitle').textContent = appState.activeMonth;
    document.getElementById('dueDateNotice').textContent = appState.dueNote || 'Due by 5th of every month';
    document.getElementById('breakdownMonth').textContent = appState.activeMonth;

    // Overview Stats
    document.getElementById('statRentTotal').textContent = `₹${rent.toLocaleString('en-IN')}`;
    document.getElementById('statMaintenanceTotal').textContent = `₹${(bldgMaint + cleanMaint).toLocaleString('en-IN')}`;
    document.getElementById('statMaintenanceSubtext').textContent = `₹${bldgMaint} bldg + ₹${cleanMaint} clean`;
    document.getElementById('statLightTotal').textContent = `₹${light.toLocaleString('en-IN')}`;
    document.getElementById('statPerPerson').textContent = `₹${perHead.toLocaleString('en-IN')}`;
    document.getElementById('statRoommateCount').textContent = `for ${count} roommates`;

    // Detailed Breakdown List
    document.getElementById('detailRent').textContent = `₹${rent.toLocaleString('en-IN')}`;
    document.getElementById('detailBuildingMaint').textContent = `₹${bldgMaint.toLocaleString('en-IN')}`;
    document.getElementById('detailCleaningMaint').textContent = `₹${cleanMaint.toLocaleString('en-IN')}`;
    document.getElementById('detailLight').textContent = `₹${light.toLocaleString('en-IN')}`;
    document.getElementById('detailGrandTotal').textContent = `₹${total.toLocaleString('en-IN')}`;
    document.getElementById('detailSplitPerHead').textContent = `₹${perHead.toLocaleString('en-IN')} / person`;

    // Admin Inputs
    document.getElementById('inputRoomRent').value = appState.bill.roomRent;
    document.getElementById('inputBuildingMaint').value = appState.bill.buildingMaintenance;
    document.getElementById('inputCleaningMaint').value = appState.bill.cleaningMaintenance;
    document.getElementById('inputLightBill').value = appState.bill.lightBill;
    document.getElementById('inputUpiId').value = appState.upiId || '8459807346@slc';
    document.getElementById('inputAdminPhone').value = appState.adminPhone || '';
    document.getElementById('inputRazorpayKey').value = appState.razorpayKey || '';

    if (document.getElementById('inputDueNote')) {
      document.getElementById('inputDueNote').value = appState.dueNote || 'Due by 5th of every month';
    }

    if (document.getElementById('inputAdminMonth')) {
      document.getElementById('inputAdminMonth').value = appState.activeMonth;
    }

    // Sync top month selector dropdown
    const monthSelect = document.getElementById('monthSelect');
    if (monthSelect) {
      // If active month is not in options, append it
      let exists = false;
      for (let i = 0; i < monthSelect.options.length; i++) {
        if (monthSelect.options[i].value === appState.activeMonth) {
          exists = true;
          break;
        }
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

    // Prefill unit calculator fields
    if (document.getElementById('calcPrevUnits') && !document.getElementById('calcPrevUnits').value) {
      document.getElementById('calcPrevUnits').value = appState.bill.lightMeterPrev || '';
    }
    if (document.getElementById('calcCurrUnits') && !document.getElementById('calcCurrUnits').value) {
      document.getElementById('calcCurrUnits').value = appState.bill.lightMeterCurr || '';
    }
    if (document.getElementById('calcRatePerUnit') && !document.getElementById('calcRatePerUnit').value) {
      document.getElementById('calcRatePerUnit').value = appState.bill.lightRatePerUnit || 9.5;
    }

    document.getElementById('adminRoommateCount').textContent = appState.roommates.length;

    // Render Roommate Cards
    renderRoommateCards(perHead);

    // Refresh Lucide Icons
    if (window.lucide) {
      window.lucide.createIcons();
    }
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
             <i data-lucide="check" class="w-3.5 h-3.5"></i> Paid ${r.paidOn ? `(${r.paidOn})` : ''}
           </span>`
        : `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-300">
             <i data-lucide="clock" class="w-3.5 h-3.5"></i> Pending
           </span>`;

      // Admin quick toggle button
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
                ${r.name.charAt(0).toUpperCase()}
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

    // Update Counter Badges
    document.getElementById('badgePaidCount').textContent = `${paidCount} Paid`;
    document.getElementById('badgePendingCount').textContent = `${pendingCount} Pending`;
  }

  // Setup Event Listeners
  function setupEventListeners() {
    // Admin Toggle
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

    // Admin PIN Submit
    const adminPinSubmitBtn = document.getElementById('adminPinSubmitBtn');
    const adminPinInput = document.getElementById('adminPinInput');

    const handlePinVerify = () => {
      const pin = adminPinInput.value.trim();
      if (pin === (appState.adminPin || DEFAULT_PIN)) {
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

    // Bill Form Submit
    document.getElementById('billForm').addEventListener('submit', (e) => {
      e.preventDefault();
      appState.bill.roomRent = Number(document.getElementById('inputRoomRent').value) || 0;
      appState.bill.buildingMaintenance = Number(document.getElementById('inputBuildingMaint').value) || 0;
      appState.bill.cleaningMaintenance = Number(document.getElementById('inputCleaningMaint').value) || 0;
      appState.bill.lightBill = Number(document.getElementById('inputLightBill').value) || 0;
      appState.upiId = document.getElementById('inputUpiId').value.trim() || '8459807346@slc';
      appState.adminPhone = document.getElementById('inputAdminPhone').value.trim();
      appState.razorpayKey = document.getElementById('inputRazorpayKey').value.trim();

      const newMonth = document.getElementById('inputAdminMonth') ? document.getElementById('inputAdminMonth').value.trim() : '';
      if (newMonth) {
        appState.activeMonth = newMonth;
      }

      const newDue = document.getElementById('inputDueNote') ? document.getElementById('inputDueNote').value.trim() : '';
      if (newDue) {
        appState.dueNote = newDue;
      }

      const newPin = document.getElementById('inputAdminPinChange').value.trim();
      if (newPin && newPin.length >= 4) {
        appState.adminPin = newPin;
      }

      saveState();
      renderAll();
      showToast('Saved! Use WhatsApp button or Download data.json to sync with roommates.');
    });

    // Light Calculator Toggle & Apply
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

    // Share Link Button
    document.getElementById('copyShareLinkBtn').addEventListener('click', () => {
      const shareUrl = getShareableUrl();
      navigator.clipboard.writeText(shareUrl).then(() => {
        showToast('Sharable link copied to clipboard! Roommates will see latest bills.');
      }).catch(() => {
        prompt('Copy this link to share with roommates:', shareUrl);
      });
    });

    // WhatsApp Share Button
    document.getElementById('whatsappShareBtn').addEventListener('click', () => {
      const rent = Number(appState.bill.roomRent) || 8500;
      const bldgMaint = Number(appState.bill.buildingMaintenance) || 500;
      const cleanMaint = Number(appState.bill.cleaningMaintenance) || 500;
      const light = Number(appState.bill.lightBill) || 0;
      const total = rent + bldgMaint + cleanMaint + light;
      const count = appState.roommates.length || 5;
      const perHead = Math.round(total / count);
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
      if (appState.dueNote) {
        text += `⏰ *Notice:* ${appState.dueNote}\n`;
      }
      text += `\n💳 *Pay Directly on Website:* ${shareUrl}`;

      const waUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`;
      window.open(waUrl, '_blank');
    });

    // Roommate Modal
    document.getElementById('manageRoommatesModalBtn').addEventListener('click', () => {
      renderManageRoommatesList();
      document.getElementById('roommatesModal').classList.remove('hidden');
    });

    document.getElementById('addRoommateForm').addEventListener('submit', (e) => {
      e.preventDefault();
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

    // Hosting Guide Modal
    document.getElementById('viewHostingGuideBtn').addEventListener('click', () => {
      document.getElementById('hostingGuideModal').classList.remove('hidden');
    });

    // Checkout Tabs Switching
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

    // Copy UPI ID in checkout modal
    document.getElementById('copyUpiIdBtn').addEventListener('click', () => {
      const upiId = appState.upiId || '8459807346@slc';
      navigator.clipboard.writeText(upiId).then(() => {
        showToast('UPI ID copied to clipboard: ' + upiId);
      });
    });

    // UTR Confirmation Form Submission
    document.getElementById('utrConfirmForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const utr = document.getElementById('inputUtrNumber').value.trim();
      if (!utr) return;

      if (activePayingRoommate) {
        completePayment(activePayingRoommate.id, utr, 'UPI Transfer');
      }
    });

    // Razorpay Launch Button
    document.getElementById('btnLaunchRazorpay').addEventListener('click', () => {
      if (!activePayingRoommate) return;

      const rent = Number(appState.bill.roomRent) || 8500;
      const bldgMaint = Number(appState.bill.buildingMaintenance) || 500;
      const cleanMaint = Number(appState.bill.cleaningMaintenance) || 500;
      const light = Number(appState.bill.lightBill) || 0;
      const total = rent + bldgMaint + cleanMaint + light;
      const count = appState.roommates.length || 5;
      const perHead = Math.round(total / count);

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
        amount: perHead * 100, // paise
        currency: 'INR',
        name: appState.flatName,
        description: `${appState.activeMonth} Rent & Electricity Bill`,
        image: 'https://cdn-icons-png.flaticon.com/512/619/619153.png',
        handler: function (response) {
          if (response && response.razorpay_payment_id) {
            completePayment(activePayingRoommate.id, response.razorpay_payment_id, 'Razorpay Online');
          }
        },
        prefill: {
          name: activePayingRoommate.name,
        },
        theme: {
          color: '#16a34a'
        }
      };

      try {
        const rzp = new Razorpay(options);
        rzp.open();
      } catch (err) {
        console.error('Razorpay initialization error:', err);
        alert('Error launching Razorpay: ' + err.message);
      }
    });

    // Send Proof via WhatsApp
    document.getElementById('sendProofWhatsAppBtn').addEventListener('click', () => {
      if (!activeReceiptRoommate) return;

      const rent = Number(appState.bill.roomRent) || 8500;
      const bldgMaint = Number(appState.bill.buildingMaintenance) || 500;
      const cleanMaint = Number(appState.bill.cleaningMaintenance) || 500;
      const light = Number(appState.bill.lightBill) || 0;
      const total = rent + bldgMaint + cleanMaint + light;
      const count = appState.roommates.length || 5;
      const perHead = Math.round(total / count);

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

    // Login Form Submit
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
      loginForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const u = document.getElementById('loginUsername').value;
        const p = document.getElementById('loginPassword').value;
        handleLogin(u, p);
      });
    }

    // Toggle Login Password Visibility
    const toggleLoginPassBtn = document.getElementById('toggleLoginPasswordBtn');
    if (toggleLoginPassBtn) {
      toggleLoginPassBtn.addEventListener('click', () => {
        const pass = document.getElementById('loginPassword');
        if (pass) {
          pass.type = pass.type === 'password' ? 'text' : 'password';
        }
      });
    }

    // Logout Button
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', () => {
        if (confirm('Are you sure you want to log out?')) {
          handleLogout();
        }
      });
    }

    // Download data.json button
    const downloadDataJsonBtn = document.getElementById('downloadDataJsonBtn');
    if (downloadDataJsonBtn) {
      downloadDataJsonBtn.addEventListener('click', downloadDataJson);
    }
  }

  // Handle click on Roommate card: on mobile, auto-redirects directly to UPI app!
  window.handlePaymentRedirectClick = function (event, id) {
    const roommate = appState.roommates.find(r => r.id === id);
    if (!roommate) return;

    activePayingRoommate = roommate;

    const rent = Number(appState.bill.roomRent) || 8500;
    const bldgMaint = Number(appState.bill.buildingMaintenance) || 500;
    const cleanMaint = Number(appState.bill.cleaningMaintenance) || 500;
    const light = Number(appState.bill.lightBill) || 0;
    const total = rent + bldgMaint + cleanMaint + light;
    const count = appState.roommates.length || 5;
    const perHead = Math.round(total / count);

    const upiUri = buildUpiUri(perHead, roommate.name);

    if (isMobileDevice()) {
      // Clean single redirect without double navigation collision
      event.preventDefault();
      setupCheckoutModalUI(roommate, perHead, upiUri);
      document.getElementById('checkoutModal').classList.remove('hidden');

      setTimeout(() => {
        window.location.href = upiUri;
      }, 150);
    } else {
      event.preventDefault();
      setupCheckoutModalUI(roommate, perHead, upiUri);
      document.getElementById('checkoutModal').classList.remove('hidden');
    }

    if (window.lucide) window.lucide.createIcons();
  };

  // Setup the Checkout Modal UI
  function setupCheckoutModalUI(roommate, perHead, upiUri) {
    const upiId = appState.upiId || '8459807346@slc';

    document.getElementById('checkoutModalName').textContent = `Pay Rent - ${roommate.name}`;
    document.getElementById('checkoutModalAmount').textContent = `₹${perHead.toLocaleString('en-IN')}`;
    document.getElementById('checkoutModalMonth').textContent = appState.activeMonth;
    document.getElementById('checkoutModalUpiId').textContent = upiId;
    document.getElementById('btnLaunchRazorpayText').textContent = `Pay ₹${perHead.toLocaleString('en-IN')} with Razorpay`;
    document.getElementById('inputUtrNumber').value = '';

    // Direct app buttons in modal
    const btnDirect = document.getElementById('btnPayDirectAll');
    btnDirect.href = upiUri;
    btnDirect.onclick = function (e) {
      if (isMobileDevice()) {
        // allow native link navigation
      } else {
        e.preventDefault();
        showToast('UPI app redirect is available on mobile phones. Please scan the QR code above.');
      }
    };

    document.getElementById('btnPayGPay').href = upiUri;
    document.getElementById('btnPayPhonePe').href = upiUri;
    document.getElementById('btnPayPaytm').href = upiUri;

    // Generate dynamic QR Code for fallback container if Slice QR image fails to load
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

    // Default to UPI tab
    document.getElementById('tabUpiBtn').click();
  }

  // Complete Payment Action (Shared by UPI UTR submission and Razorpay)
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

    saveState();
    renderAll();

    // Trigger celebratory confetti 🎉
    if (window.confetti) {
      window.confetti({
        particleCount: 80,
        spread: 60,
        origin: { y: 0.6 }
      });
    }

    // Hide checkout modal
    document.getElementById('checkoutModal').classList.add('hidden');

    // Open receipt modal
    window.openReceiptModal(roommate.id);
    showToast(`Payment recorded for ${roommate.name}!`);
  }

  // Render Roommates in Management Modal
  function renderManageRoommatesList() {
    const list = document.getElementById('manageRoommatesList');
    if (!list) return;

    list.innerHTML = appState.roommates.map((r, idx) => `
      <div class="py-2.5 flex items-center justify-between">
        <div class="flex items-center gap-2">
          <span class="w-6 h-6 rounded-full bg-slate-100 text-slate-700 flex items-center justify-center text-xs font-bold">${idx + 1}</span>
          <div>
            <p class="text-sm font-semibold text-slate-800 leading-tight">${escapeHtml(r.name)}</p>
            <p class="text-[11px] text-slate-400">${r.status === 'paid' ? `Paid (${r.paidOn || 'Yes'})` : 'Pending'}</p>
          </div>
        </div>
        <button onclick="window.removeRoommate('${r.id}')" class="text-xs text-red-500 hover:text-red-700 font-medium px-2 py-1 hover:bg-red-50 rounded-lg">
          Remove
        </button>
      </div>
    `).join('');
  }

  // Global functions attached to window for HTML event handlers
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
    if (appState.roommates.length <= 1) {
      alert('You need at least 1 roommate.');
      return;
    }
    appState.roommates = appState.roommates.filter(r => r.id !== id);
    saveState();
    renderManageRoommatesList();
    renderAll();
  };

  // Open Checkout Modal
  window.openCheckoutModal = function (id) {
    const roommate = appState.roommates.find(r => r.id === id);
    if (!roommate) return;

    activePayingRoommate = roommate;

    const rent = Number(appState.bill.roomRent) || 8500;
    const bldgMaint = Number(appState.bill.buildingMaintenance) || 500;
    const cleanMaint = Number(appState.bill.cleaningMaintenance) || 500;
    const light = Number(appState.bill.lightBill) || 0;
    const total = rent + bldgMaint + cleanMaint + light;
    const count = appState.roommates.length || 5;
    const perHead = Math.round(total / count);

    const upiUri = buildUpiUri(perHead, roommate.name);
    setupCheckoutModalUI(roommate, perHead, upiUri);
    document.getElementById('checkoutModal').classList.remove('hidden');

    if (window.lucide) window.lucide.createIcons();
  };

  // Open Digital Receipt Modal
  window.openReceiptModal = function (id) {
    const roommate = appState.roommates.find(r => r.id === id);
    if (!roommate) return;

    activeReceiptRoommate = roommate;

    const rent = Number(appState.bill.roomRent) || 8500;
    const bldgMaint = Number(appState.bill.buildingMaintenance) || 500;
    const cleanMaint = Number(appState.bill.cleaningMaintenance) || 500;
    const light = Number(appState.bill.lightBill) || 0;
    const total = rent + bldgMaint + cleanMaint + light;
    const count = appState.roommates.length || 5;
    const perHead = Math.round(total / count);

    const receiptNum = `REC-${appState.activeMonth.replace(/\s+/g, '').substring(0, 5).toUpperCase()}-${roommate.id.slice(-4)}`;

    document.getElementById('receiptNumber').textContent = receiptNum;
    document.getElementById('receiptAmount').textContent = `₹${perHead.toLocaleString('en-IN')}`;
    document.getElementById('receiptMonthYear').textContent = appState.activeMonth;
    document.getElementById('receiptRoommateName').textContent = roommate.name;
    document.getElementById('receiptFlatName').textContent = appState.flatName;
    document.getElementById('receiptPaymentMode').textContent = roommate.method || 'Online Transfer';
    document.getElementById('receiptUtr').textContent = roommate.utr || 'VERIFIED-01';
    document.getElementById('receiptDateTime').textContent = roommate.paidAt || roommate.paidOn || 'Recently Paid';

    // Detailed expense breakdown in receipt
    if (document.getElementById('receiptRentBreakdown')) {
      document.getElementById('receiptRentBreakdown').textContent = `₹${rent.toLocaleString('en-IN')}`;
    }
    if (document.getElementById('receiptBldgBreakdown')) {
      document.getElementById('receiptBldgBreakdown').textContent = `₹${bldgMaint.toLocaleString('en-IN')}`;
    }
    if (document.getElementById('receiptCleanBreakdown')) {
      document.getElementById('receiptCleanBreakdown').textContent = `₹${cleanMaint.toLocaleString('en-IN')}`;
    }
    if (document.getElementById('receiptLightBreakdown')) {
      document.getElementById('receiptLightBreakdown').textContent = `₹${light.toLocaleString('en-IN')}`;
    }

    document.getElementById('receiptModal').classList.remove('hidden');
    if (window.lucide) window.lucide.createIcons();
  };

  function showToast(msg) {
    const toast = document.createElement('div');
    toast.className = 'fixed bottom-5 right-5 bg-slate-900 text-white px-4 py-2.5 rounded-xl text-xs font-semibold shadow-xl z-50 animate-bounce';
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3500);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>'"]/g, tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag));
  }

})();
