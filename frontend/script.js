/* 
================================================================
   SOCIETY MANAGEMENT PRO - CORE SCRIPT (RESTORATION)
================================================================
*/

let currentSociety = "";
let isAdmin = false;
let propertyType = localStorage.getItem('propertyType') || '';
// API_BASE and Api.* are defined in api.js (loads before this file)

function getFlatList(blockConfig) {
    if (Array.isArray(blockConfig)) return blockConfig;
    let max = parseInt(blockConfig) || 0;
    let arr = [];
    for (let i = 1; i <= max; i++) arr.push(String(i));
    return arr;
}

function getBlockConfig(soc, block) {
    let flats = soc.config?.flats;
    if (!flats) return 0;
    if (typeof flats === 'object') {
        if (Array.isArray(flats)) {
            const blockIndex = block.charCodeAt(0) - 65;
            return flats[blockIndex];
        }
        return flats[block];
    }
    return flats;
}

let loggedInFlat = null;
let vault = {}; // Will be populated from the database
let blockStates = JSON.parse(localStorage.getItem('blockStates')) || {};
const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
let editingExpenseIndex = null;
let editingNoticeIndex = null;
let editingRuleIndex = null;
let editingComplaintIndex = null;

// ================================================================
//  DYNAMIC TERMINOLOGY TRANSLATION (FLAT TO BUNGLOW)
// ================================================================
function translateTerm(text) {
    if (!text) return text;
    if (propertyType !== 'bungalow') return text;
    
    // Replace terms preserving casing
    let res = text;
    res = res.replace(/Flat Number/g, 'Bunglow Number');
    res = res.replace(/flat number/g, 'bunglow number');
    res = res.replace(/Same flats/g, 'Same bunglows');
    res = res.replace(/same flats/g, 'same bunglows');
    res = res.replace(/Overdue Flats/g, 'Overdue Bunglows');
    res = res.replace(/Search any flat/g, 'Search any bunglow');
    res = res.replace(/Flat saved/g, 'Bunglow saved');
    res = res.replace(/Flat/g, 'Bunglow');
    res = res.replace(/Flats/g, 'Bunglows');
    res = res.replace(/flat/g, 'bunglow');
    res = res.replace(/flats/g, 'bunglows');
    res = res.replace(/FLAT/g, 'BUNGLOW');
    res = res.replace(/FLATS/g, 'BUNGLOWS');
    return res;
}

function updatePageTerminology() {
    const isBunglow = propertyType === 'bungalow';
    
    // Elements to update textContent
    const textElements = [
        { id: 'sameFlatsLabel', flatVal: 'Same flats in all blocks', bunglowVal: 'Same bunglows in all blocks' },
        { id: 'overdueFlatsLabel', flatVal: 'Overdue Flats', bunglowVal: 'Overdue Bunglows' },
        { id: 'thFlatHeader', flatVal: 'FLAT', bunglowVal: 'BUNGLOW' },
    ];
    
    textElements.forEach(item => {
        const el = document.getElementById(item.id);
        if (el) {
            el.textContent = isBunglow ? item.bunglowVal : item.flatVal;
        }
    });

    // Elements to update placeholders
    const placeholderElements = [
        { id: 'resFlatNum', flatVal: 'Flat Number (e.g. A-1)', bunglowVal: 'Bunglow Number (e.g. A-1)' },
        { id: 'searchBox', flatVal: 'Search any flat details...', bunglowVal: 'Search any bunglow details...' },
        { id: 'rfFlat', flatVal: 'Flat Number (e.g. A-1)', bunglowVal: 'Bunglow Number (e.g. A-1)' },
        { id: 'complaintFlat', flatVal: 'Flat Number e.g. A-1', bunglowVal: 'Bunglow Number e.g. A-1' },
    ];

    placeholderElements.forEach(item => {
        const el = document.getElementById(item.id);
        if (el) {
            el.setAttribute('placeholder', isBunglow ? item.bunglowVal : item.flatVal);
        }
    });
}


// ================================================================
//  GLOBAL TOAST NOTIFICATION — replaces all alert() calls
// ================================================================
function showToast(message, type = 'error') {
    let container = document.getElementById('toastContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toastContainer';
        container.style.cssText = `
            position:fixed; top:24px; left:50%; transform:translateX(-50%);
            z-index:9999; display:flex; flex-direction:column; align-items:center; gap:10px;
            pointer-events:none; min-width:320px;
        `;
        document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    const isSuccess = type === 'success';
    const isInfo = type === 'info';
    toast.style.cssText = `
        display:flex; align-items:center; gap:12px;
        background:${isSuccess ? 'rgba(21,128,61,0.96)' : isInfo ? 'rgba(37,99,235,0.96)' : 'rgba(185,28,28,0.96)'};
        color:white; padding:16px 26px; border-radius:16px;
        font-size:20px; font-weight:700; letter-spacing:0.3px;
        box-shadow:0 8px 32px rgba(0,0,0,0.22); backdrop-filter:blur(12px);
        pointer-events:all; max-width:480px; text-align:center;
        animation:toastIn 0.35s cubic-bezier(.21,1.02,.73,1) forwards;
        transition:opacity 0.3s, transform 0.3s;
    `;
    const icon = isSuccess ? '✅' : isInfo ? 'ℹ️' : '⚠️';
    toast.innerHTML = `<span style="font-size:22px;">${icon}</span><span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-12px)';
        setTimeout(() => toast.remove(), 320);
    }, 3200);
}

// ================================================================
//  GLOBAL CONFIRM MODAL (replaces confirm())
// ================================================================
let pendingConfirmCallback = null;

function showConfirm(message, confirmText, isDestructive, callback) {
    document.getElementById('confirmMsg').textContent = message;
    const yesBtn = document.getElementById('confirmYesBtn');
    yesBtn.textContent = confirmText;

    if (isDestructive) {
        yesBtn.style.background = '#DC2626';
        yesBtn.style.boxShadow = '0 8px 24px rgba(220,38,38,0.25)';
    } else {
        yesBtn.style.background = '#D97706';
        yesBtn.style.boxShadow = '0 8px 24px rgba(217,119,6,0.25)';
    }

    pendingConfirmCallback = callback;
    document.getElementById('globalConfirmModal').classList.remove('hidden');
}

function handleConfirm(isConfirmed) {
    document.getElementById('globalConfirmModal').classList.add('hidden');
    if (isConfirmed && pendingConfirmCallback) {
        pendingConfirmCallback();
    }
    pendingConfirmCallback = null;
}

(function () {
    if (!document.getElementById('toastStyle')) {
        const s = document.createElement('style');
        s.id = 'toastStyle';
        s.textContent = `@keyframes toastIn { from { opacity:0; transform:translateY(-18px) scale(0.95); } to { opacity:1; transform:translateY(0) scale(1); } }`;
        document.head.appendChild(s);
    }
})();

// Resident login inline error helpers
function showResidentErr(msg) {
    let el = document.getElementById('resLoginErr');
    if (!el) {
        el = document.createElement('p');
        el.id = 'resLoginErr';
        el.style.cssText = 'color:#DC2626;font-size:22px;font-weight:700;text-align:center;margin-top:6px;display:none;';
        const btn = document.querySelector('#residentInterface button');
        if (btn && btn.parentNode) btn.parentNode.insertBefore(el, btn);
    }
    el.textContent = msg;
    el.style.display = 'block';
}
function hideResidentErr() {
    const el = document.getElementById('resLoginErr');
    if (el) { el.style.display = 'none'; el.textContent = ''; }
}

// Setup page inline error helpers
function showSetupErr(msg) {
    let el = document.getElementById('setupErr');
    if (!el) {
        el = document.createElement('p');
        el.id = 'setupErr';
        el.style.cssText = 'color:#DC2626;font-size:22px;font-weight:700;text-align:center;margin-top:6px;';
        const btn = document.querySelector('#setupInterface .space-y-6 button');
        if (btn && btn.parentNode) btn.parentNode.insertBefore(el, btn);
    }
    el.textContent = msg;
    el.style.display = 'block';
}
function hideSetupErr() {
    const el = document.getElementById('setupErr');
    if (el) el.style.display = 'none';
}

function saveExpense() {
    const title = document.getElementById("expenseTitle").value.trim();
    const amount = Number(document.getElementById("expenseAmount").value);
    const details = document.getElementById("expenseDetails").value.trim();

    if (!title) return showToast("Please enter expenditure title.");
    if (!amount || amount <= 0) return showToast("Please enter a valid amount.");
    if (!details) return showToast("Please enter expenditure details.");

    const month = document.getElementById("viewMonth").value;
    const year = document.getElementById("viewYear").value;
    const period = `${month}-${year}`;

    const now = new Date();
    const date = `${String(now.getDate()).padStart(2, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${now.getFullYear()}`;

    const expenseData = {
        id: editingExpenseIndex, // This will be the DB ID if editing
        society_name: currentSociety,
        title,
        amount,
        details,
        period,
        year,
        date,
        property_type: propertyType
    };

    Api.saveExpense(expenseData)
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                showToast("Expenditure saved!", "success");
                editingExpenseIndex = null;
                loadDashboardData();
            }
        });

    document.getElementById("expenseTitle").value = "";
    document.getElementById("expenseAmount").value = "";
    document.getElementById("expenseDetails").value = "";
    document.getElementById("expenseDetails").value = "";
}

function renderExpenses() {
    const soc = vault[currentSociety];
    const box = document.getElementById("expenseList");

    if (!soc || !box) return;
    if (!soc.expenses) soc.expenses = [];

    const month = document.getElementById("viewMonth").value;
    const year = document.getElementById("viewYear").value;
    const period = `${month}-${year}`;

    let monthlyTotal = 0;
    let yearlyTotal = 0;

    soc.expenses.forEach(e => {
        if (e.period === period) monthlyTotal += Number(e.amount || 0);
        if (String(e.year) === String(year)) yearlyTotal += Number(e.amount || 0);
    });

    document.getElementById("expenseMonthlyTotal").innerText = `₹${monthlyTotal}`;
    document.getElementById("expenseYearlyTotal").innerText = `₹${yearlyTotal}`;

    const expenses = soc.expenses.filter(e => e.period === period);

    box.innerHTML = expenses.length
        ? expenses.map(e => `
    <div class="notice-card">
        <div style="display:flex;justify-content:space-between;gap:16px;align-items:flex-start;">
            <div>
                <h3>${e.title}</h3>
                <p>${e.details}</p>

                <p style="font-size:28px;font-weight:900;color:#8B5E3C;">
                    ₹${e.amount}
                </p>

                <div style="font-size:16px;font-weight:800;color:#8B5E3C;margin-top:10px;">
                    <p>Added: ${e.date}</p>
                    ${e.updated_date ? `<p style="color:#D97706;">Updated: ${e.updated_date}</p>` : ""}
                </div>
            </div>

            ${isAdmin
                ? `
                    <div style="display:flex;gap:10px;">
                        <button onclick="editExpense(${e.id})" style="
                            background:#2563EB;color:white;border:none;
                            border-radius:12px;padding:12px 18px;font-weight:900;
                        ">Edit</button>

                        <button onclick="deleteExpense(${e.id})" style="
                            background:#DC2626;color:white;border:none;
                            border-radius:12px;padding:12px 18px;font-weight:900;
                        ">Delete</button>
                    </div>
                `
                : ""
            }
        </div>
    </div>
`).join("")
        : `<p style="font-size:22px;font-weight:800;color:#7A6855;">
    No expenditure added .
</p>`;
}

function editExpense(id) {
    const e = vault[currentSociety].expenses.find(exp => exp.id === id);

    document.getElementById("expenseTitle").value = e.title;
    document.getElementById("expenseAmount").value = e.amount;
    document.getElementById("expenseDetails").value = e.details;

    editingExpenseIndex = id;

    window.scrollTo({ top: 0, behavior: "smooth" });
}

function deleteExpense(id) {
    if (!isAdmin) return;
    showConfirm("Delete this expenditure?", "Yes, Delete", true, () => {
        Api.deleteExpense(id)
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    loadDashboardData();
                }
            });
    });
}

// ================================================================
//  SERVER ERROR OVERLAY — shown when backend is unreachable
// ================================================================
function showServerError() {
    // Remove any existing overlay
    const existing = document.getElementById('serverErrorOverlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'serverErrorOverlay';
    overlay.style.cssText = `
        position: fixed; inset: 0; z-index: 99999;
        background: rgba(15, 10, 5, 0.92);
        backdrop-filter: blur(16px);
        display: flex; align-items: center; justify-content: center;
        flex-direction: column; gap: 0; font-family: 'Inter', sans-serif;
        animation: fadeInOverlay 0.4s ease;
    `;

    overlay.innerHTML = `
        <style>
            @keyframes fadeInOverlay { from { opacity:0; } to { opacity:1; } }
            @keyframes pulse { 0%,100% { transform:scale(1); } 50% { transform:scale(1.08); } }
            #serverErrorOverlay .retry-btn:hover { background: #B45309 !important; transform: translateY(-2px); }
            #serverErrorOverlay .retry-btn:active { transform: translateY(0); }
        </style>
        <div style="
            background: linear-gradient(135deg, #1a0f07, #2d1a0a);
            border: 1.5px solid rgba(217,119,6,0.35);
            border-radius: 28px;
            padding: 48px 44px;
            max-width: 480px;
            width: 90%;
            text-align: center;
            box-shadow: 0 32px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.03);
        ">
            <div style="
                width: 72px; height: 72px; border-radius: 50%;
                background: rgba(220,38,38,0.15);
                border: 2px solid rgba(220,38,38,0.4);
                display: flex; align-items: center; justify-content: center;
                margin: 0 auto 24px;
                animation: pulse 2s infinite;
            ">
                <svg width="34" height="34" viewBox="0 0 24 24" fill="none">
                    <path d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                          stroke="#EF4444" stroke-width="2" stroke-linecap="round"/>
                </svg>
            </div>

            <h2 style="color:#FFF; font-size:22px; font-weight:800; margin:0 0 8px;">
                Server Not Running
            </h2>
            <p style="color:rgba(255,255,255,0.55); font-size:14px; margin:0 0 28px; line-height:1.6;">
                The backend server is not reachable on <strong style="color:#D97706;">localhost:5000</strong>.<br>
                Please start the server, then click Retry.
            </p>

            <div style="
                background: rgba(255,255,255,0.04);
                border: 1px solid rgba(255,255,255,0.08);
                border-radius: 12px;
                padding: 14px 18px;
                margin-bottom: 28px;
                text-align: left;
            ">
                <p style="color:rgba(255,255,255,0.4); font-size:11px; font-weight:700; letter-spacing:1px; margin:0 0 8px; text-transform:uppercase;">How to start the server</p>
                <p style="color:#86EFAC; font-size:13px; font-family:monospace; margin:0 0 4px;">▶ Double-click: <strong>start-server.bat</strong></p>
                <p style="color:rgba(255,255,255,0.35); font-size:12px; margin:0;">or run <code style="color:#FCD34D;">node server.js</code> in terminal</p>
            </div>

            <button class="retry-btn" onclick="retryConnection()" style="
                background: #D97706;
                color: white;
                border: none;
                padding: 14px 36px;
                border-radius: 14px;
                font-size: 15px;
                font-weight: 800;
                cursor: pointer;
                width: 100%;
                transition: background 0.2s, transform 0.2s;
                box-shadow: 0 8px 24px rgba(217,119,6,0.3);
                letter-spacing: 0.3px;
            ">
                🔄 Retry Connection
            </button>
        </div>
    `;

    document.body.appendChild(overlay);
}

function retryConnection() {
    const overlay = document.getElementById('serverErrorOverlay');
    if (overlay) {
        const btn = overlay.querySelector('.retry-btn');
        if (btn) { btn.textContent = '⏳ Connecting...'; btn.disabled = true; }
    }

    Api.getSocieties()
        .then(res => res.json())
        .then(data => {
            // Server is back — remove overlay and initialize normally
            const overlay = document.getElementById('serverErrorOverlay');
            if (overlay) overlay.remove();

            const dl = document.getElementById('societyList');
            if (dl) {
                dl.innerHTML = '';
                data.forEach(name => {
                    if (!vault[name]) vault[name] = {};
                    dl.innerHTML += `<option value="${name}">`;
                });
            } else {
                data.forEach(name => { if (!vault[name]) vault[name] = {}; });
            }

            const sessionSoc = localStorage.getItem('activeSociety');
            if (sessionSoc) {
                currentSociety = sessionSoc;
                isAdmin = localStorage.getItem('isAdmin') === 'true';
                if (!isAdmin) loggedInFlat = JSON.parse(localStorage.getItem('residentFlat'));
                loadDashboardData();
            } else {
                showLanding();
            }
            showToast("Connected to server!", "success");
        })
        .catch(() => {
            const overlay = document.getElementById('serverErrorOverlay');
            if (overlay) {
                const btn = overlay.querySelector('.retry-btn');
                if (btn) { btn.textContent = '🔄 Retry Connection'; btn.disabled = false; }
            }
            showToast("Still unable to connect. Make sure server is running.", "error");
        });
}

function init() {
    const now = new Date();
    const vy = document.getElementById('viewYear'), vm = document.getElementById('viewMonth');
    if (vy) {
        vy.innerHTML = '';
        for (let y = 2020; y <= 2040; y++) vy.add(new Option(y, y));
        vy.value = now.getFullYear();
    }
    if (vm) {
        vm.innerHTML = '';
        months.forEach(m => vm.add(new Option(m, m)));
        vm.value = months[now.getMonth()];
    }

    // Fetch society names to populate vault keys
    Api.getSocieties()
        .then(res => res.json())
        .then(data => {
            console.log("Found societies:", data);
            const dl = document.getElementById('societyList');
            if (dl) {
                dl.innerHTML = '';
                data.forEach(name => {
                    if (!vault[name]) vault[name] = {};
                    dl.innerHTML += `<option value="${name}">`;
                });
            } else {
                data.forEach(name => {
                    if (!vault[name]) vault[name] = {};
                });
            }

            const sessionSoc = localStorage.getItem('activeSociety');
            if (sessionSoc) {
                currentSociety = sessionSoc;
                isAdmin = localStorage.getItem('isAdmin') === 'true';
                if (!isAdmin) loggedInFlat = JSON.parse(localStorage.getItem('residentFlat'));
                loadDashboardData();
            } else {
                // Always start at the Landing (property type selection)
                showLanding();
            }
        })
        .catch(err => {
            console.error("Failed to fetch societies:", err);
            showServerError();
        });
}

// ================================================================
//  LOGIN FORM FIELD CLEAR
//  Call this whenever navigating away from or to any login screen
//  so browser-cached values never appear after a refresh.
// ================================================================
function clearLoginForms() {
    const ids = [
        'resLoginUsername', 'resSocName', 'resFlatNum', 'resPhone', 'resPassword',
        'loginSociety', 'loginUser', 'loginPass',
        'setupSocietyName', 'setupUser', 'setupPass'
    ];
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    // Clear any visible inline error messages
    const errIds = ['loginErr', 'resLoginErr', 'setupErr'];
    errIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.textContent = ''; el.style.display = 'none'; }
    });

    // Reset login buttons from loading state
    const adminBtn = document.querySelector('#loginInterface button[onclick="attemptLogin()"]');
    if (adminBtn) {
        adminBtn.disabled = false;
        adminBtn.textContent = 'Access Dashboard';
    }
    const resBtn = document.querySelector('#residentInterface button[onclick="attemptResidentLogin()"]');
    if (resBtn) {
        resBtn.disabled = false;
        resBtn.textContent = 'Verify & Enter';
    }
}

// ================================================================
//  LANDING SCREEN NAVIGATION
// ================================================================
function showLanding() {
    document.body.classList.remove("main-page");
    document.getElementById('landingInterface').classList.remove('hidden');
    document.getElementById('setupInterface').classList.add('hidden');
    document.getElementById('loginInterface').classList.add('hidden');
    document.getElementById('residentInterface').classList.add('hidden');
    document.getElementById('dashboardInterface').classList.add('hidden');
    clearLoginForms();
    checkFloatingComplaintVisibility();
}

function selectPropertyType(type) {
    propertyType = type;
    localStorage.setItem('propertyType', type);

    // Animate the selected card briefly before navigating
    const card = document.getElementById(type === 'flat' ? 'flatCard' : 'bungalowCard');
    if (card) {
        card.style.transform = 'scale(0.95)';
        card.style.background = type === 'flat'
            ? 'linear-gradient(135deg,rgba(139,94,60,0.12),rgba(192,138,91,0.18))'
            : 'linear-gradient(135deg,rgba(91,140,60,0.12),rgba(125,181,90,0.18))';
        card.style.borderColor = type === 'flat' ? '#8B5E3C' : '#5B8C3C';
        setTimeout(() => showSocietyPortal(), 200);
    } else {
        showSocietyPortal();
    }
}

// ================================================================
//  CENTRAL NAVIGATION: Show Society Portal (the second screen)
// ================================================================
function showSocietyPortal() {
    document.body.classList.remove("main-page");
    document.getElementById('landingInterface').classList.add('hidden');
    document.getElementById('dashboardInterface').classList.add('hidden');
    document.getElementById('loginInterface').classList.add('hidden');
    document.getElementById('residentInterface').classList.add('hidden');
    document.getElementById('setupInterface').classList.remove('hidden');
    checkFloatingComplaintVisibility();
    updatePageTerminology();
}


function loadDashboardData() {
    Api.getSociety(currentSociety, propertyType)
        .then(res => {
            if (!res.ok) throw new Error(`Server error: ${res.status}`);
            return res.json();
        })
        .then(data => {
            vault[currentSociety] = data;
            loadDashboard();
        })
        .catch(err => {
            console.error('Failed to load dashboard data:', err);
            showToast('Failed to load society data. Please refresh the page.', 'error');
        });
}

function attemptResidentLogin() {
    hideResidentErr();

    const usernameInp = document.getElementById('resLoginUsername').value.trim();
    const passInp = document.getElementById('resPassword').value.trim();

    if (!usernameInp) { showResidentErr('Please enter Resident Username.'); return; }
    if (!passInp) { showResidentErr('Please enter Password.'); return; }

    // Show loading state on button
    const resBtn = document.querySelector('#residentInterface button[onclick="attemptResidentLogin()"]');
    const resBtnText = resBtn ? resBtn.textContent.trim() : '';
    if (resBtn) { resBtn.disabled = true; resBtn.textContent = 'Please wait...'; }

    Api.residentLogin({
            username: usernameInp,
            password: passInp,
            property_type: propertyType
        })
        .then(res => res.json())
        .then(data => {
            if (!data.success) {
                if (resBtn) { resBtn.disabled = false; resBtn.textContent = resBtnText; }
                showResidentErr(data.message || 'Invalid credentials. Please check your details.');
                return;
            }

            currentSociety = data.society;
            propertyType = data.property_type || 'flat';
            isAdmin = false;
            loggedInFlat = {
                block: data.block,
                num: data.flat
            };

            localStorage.setItem('activeSociety', currentSociety);
            localStorage.setItem('propertyType', propertyType);
            localStorage.setItem('isAdmin', 'false');
            localStorage.setItem('residentFlat', JSON.stringify(loggedInFlat));
            localStorage.setItem('jwt_token', data.token);

            loadDashboardData();
        })
        .catch(err => {
            if (resBtn) { resBtn.disabled = false; resBtn.textContent = resBtnText; }
            console.error('Resident login error:', err);
            showResidentErr('Server error. Please try again.');
        });
}

function attemptLogin() {
    const errEl = document.getElementById('loginErr');
    errEl.style.display = 'none';
    errEl.textContent = '';

    const username = document.getElementById('loginUser').value.trim();
    const password = document.getElementById('loginPass').value.trim();

    if (!username) { errEl.textContent = 'Enter username'; errEl.style.display = 'block'; return; }
    if (!password) { errEl.textContent = 'Enter password'; errEl.style.display = 'block'; return; }

    // Show loading state on button
    const btn = document.querySelector('#loginInterface button[onclick="attemptLogin()"]');
    const originalText = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Please wait...'; }

    Api.login({ user: username, pass: password, property_type: propertyType })
        .then(res => {
            if (!res.ok) throw new Error(`Server returned ${res.status}`);
            return res.json();
        })
        .then(data => {
            if (data.success) {
                currentSociety = data.society.society_name;
                propertyType = data.society.property_type || 'flat';
                isAdmin = true;
                localStorage.setItem('activeSociety', currentSociety);
                localStorage.setItem('propertyType', propertyType);
                localStorage.setItem('isAdmin', 'true');
                localStorage.setItem('jwt_token', data.token);
                loadDashboardData();
            } else {
                if (btn) { btn.disabled = false; btn.textContent = originalText; }
                errEl.textContent = data.message || 'Login failed. Please try again.';
                errEl.style.display = 'block';
            }
        })
        .catch((err) => {
            if (btn) { btn.disabled = false; btn.textContent = originalText; }
            console.error("Login Error:", err);
            errEl.textContent = `Error: ${err.message || 'Could not connect to server. Is the server running?'}`;
            errEl.style.display = 'block';
        });
}

function loadDashboard() {
    updatePageTerminology();
    document.querySelectorAll('#landingInterface, #setupInterface, #loginInterface, #residentInterface')
        .forEach(el => el.classList.add('hidden'));
    document.body.classList.toggle("admin-view", isAdmin);
    document.getElementById('dashboardInterface').classList.remove('hidden');
    document.getElementById('societyTitle').innerText = currentSociety;

    document.getElementById("noticeBtnText").innerText =
        isAdmin ? "Manage Notices" : "All Notices";

    document.body.classList.add("main-page");

    const residentPanel = document.getElementById('residentPanel');
    const adminStats = document.getElementById('adminStats');
    const analyticsPanel = document.getElementById('analyticsPanel');
    const exportBtn = document.getElementById('exportBtn');
    const blockFilterContainer = document.getElementById('blockFilterContainer');
    const mainFlatArea = document.querySelector('#dashboardTable')?.closest('.flex-1');
    const waPendingBtn = document.getElementById('waBlasPendingBtn');
    const waPaidBtn = document.getElementById('waBlastPaidBtn');

    if (residentPanel) residentPanel.classList.toggle('hidden', isAdmin);
    if (adminStats) adminStats.classList.toggle('hidden', !isAdmin);
    if (analyticsPanel) analyticsPanel.classList.toggle('hidden', !isAdmin);
    // Show/hide Admin buttons
    if (exportBtn) exportBtn.style.display = isAdmin ? 'inline-flex' : 'none';
    if (waPendingBtn) waPendingBtn.style.display = isAdmin ? 'inline-flex' : 'none';
    if (waPaidBtn) waPaidBtn.style.display = isAdmin ? 'inline-flex' : 'none';
    



    if (mainFlatArea) {
        mainFlatArea.style.display = isAdmin ? "block" : "none";
    }

    if (blockFilterContainer) {
        blockFilterContainer.classList.toggle('hidden', !isAdmin);
    }

    const soc = vault[currentSociety];
    const defaultDueDay = soc.config?.defaultDueDay || 1;
    const mIdx = months.indexOf(document.getElementById('viewMonth').value);
    const year = parseInt(document.getElementById('viewYear').value);
    const dueDate = new Date(year, mIdx, defaultDueDay);

    document.getElementById('globalDueDate').value =
        `${dueDate.getFullYear()}-${String(dueDate.getMonth() + 1).padStart(2, '0')}-${String(dueDate.getDate()).padStart(2, '0')}`;

    document.getElementById('globalDueDate').disabled = !isAdmin;

    const paymentDropdown = document.getElementById("paymentMethodFilter");
    if (paymentDropdown) {
        paymentDropdown.style.setProperty("display", isAdmin ? "block" : "none", "important");
        if (!isAdmin) paymentDropdown.value = "all";
    }

    const adminBankSection = document.getElementById('adminBankSection');
    if (adminBankSection) {
        adminBankSection.classList.toggle('hidden', !isAdmin);
    }

    if (isAdmin) {
        populateBlockFilter();
        displayFlats();
    } else {
        renderResidentSidebar();
        document.getElementById('dashboardTable').innerHTML = "";
    }

    loadBank();
    updateAnalytics();
    renderNotices();
    renderExpenses();
    renderRules();
    renderComplaints();

    const noticeForm = document.getElementById("adminNoticeForm");
    if (noticeForm) {
        noticeForm.style.display = isAdmin ? "grid" : "none";
    }

    checkFloatingComplaintVisibility();
}
function populateBlockFilter() {
    const soc = vault[currentSociety];
    const blockFilter = document.getElementById('blockFilter');
    const blocks = Object.keys(soc.apartmentData).sort();

    // Clear existing options except "All Blocks"
    while (blockFilter.options.length > 1) {
        blockFilter.remove(1);
    }

    blocks.forEach(b => {
        blockFilter.add(new Option(`Block ${b}`, b));
    }); checkFloatingComplaintVisibility();
}

function applyFilters() {
    const selectedBlock =
        document.getElementById('blockFilter')?.value || '';

    const selectedStatus =
        document.getElementById('statusFilter')?.value || '';

    const selectedPlan =
        document.getElementById('planFilter')?.value || 'all';

    const paymentMethodFilter =
        document.getElementById('paymentMethodFilter')?.value || 'all';

    const searchQuery =
        document.getElementById('searchBox')?.value.toLowerCase() || '';

    const period =
        `${document.getElementById('viewMonth').value}-${document.getElementById('viewYear').value}`;

    const soc = vault[currentSociety];
    const visibleBlocks = {};

    document.querySelectorAll('#dashboardTable tr').forEach(row => {

        if (row.id.startsWith('detail-')) {
            row.classList.add('hidden');
            return;
        }

        if (row.id.startsWith('block-header-')) return;

        const flatCell = row.querySelector('td:first-child');
        if (!flatCell) return;

        const flatText = flatCell.textContent.trim();
        const blockLetter = flatText.split('-')[0];
        const flatNumber = flatText.split('-')[1];

        const flatData =
            soc.apartmentData[blockLetter]?.[flatNumber] || {};

        const monthData =
            getEffectiveMonthData(flatData, period);

        const blockKey = `${currentSociety}-${blockLetter}`;
        const isCollapsed = blockStates[blockKey] === true;

        const displayOwner = monthData.owner || flatData.owner || '';
        const isOccupied = (displayOwner && displayOwner.trim() !== "");

        const hasStatusFilter = selectedStatus && selectedStatus !== 'all';
        const hasPlanFilter = selectedPlan && selectedPlan !== 'all';
        const hasPaymentFilter = paymentMethodFilter && paymentMethodFilter !== 'all';

        const matchBlock =
            !selectedBlock || blockLetter === selectedBlock;

        const matchStatus =
            !isOccupied
                ? !hasStatusFilter
                : (!selectedStatus || selectedStatus === 'all' || monthData.status === selectedStatus);

        const matchPlan =
            !isOccupied
                ? !hasPlanFilter
                : (selectedPlan === 'all' || monthData.plan === selectedPlan);

        const paymentMethodMatch =
            !isOccupied
                ? !hasPaymentFilter
                : (paymentMethodFilter === 'all' || monthData.paymentMethod === paymentMethodFilter);

        const matchSearch =
            !searchQuery ||
            row.innerText.toLowerCase().includes(searchQuery);

        const shouldShowRow =
            matchBlock &&
            matchStatus &&
            matchPlan &&
            paymentMethodMatch &&
            matchSearch &&
            !isCollapsed;

        row.style.display = shouldShowRow ? '' : 'none';

        if (matchBlock && matchStatus && matchPlan && paymentMethodMatch && matchSearch) {
            visibleBlocks[blockLetter] = true;
        }
    });

    document.querySelectorAll('#dashboardTable tr[id^="block-header-"]').forEach(header => {
        const block = header.id.replace('block-header-', '');
        header.style.display =
            (!selectedBlock || block === selectedBlock) && visibleBlocks[block]
                ? ''
                : 'none';
    });
}
function renderResidentSidebar() {
    const soc = vault[currentSociety];
    if (!soc || !loggedInFlat) return;

    const d = soc.apartmentData?.[loggedInFlat.block]?.[loggedInFlat.num];
    if (!d) return;

    const panel = document.getElementById("residentPanel");
    if (!panel) return;

    const period = `${document.getElementById("viewMonth").value}-${document.getElementById("viewYear").value}`;
    const mData = getEffectiveMonthData(d, period);
    
    const defaultDueDay = soc.config?.defaultDueDay || 1;
    const mIdx = months.indexOf(document.getElementById('viewMonth').value);
    const year = parseInt(document.getElementById('viewYear').value);
    const dDate = new Date(year, mIdx, defaultDueDay);
    const dueDate = `${String(dDate.getDate()).padStart(2, '0')} ${document.getElementById('viewMonth').value.substring(0, 3)} ${dDate.getFullYear()}`;
    
    const bank = soc.bank || {};
    const isPaid = mData.status === "Paid";

    const history = Object.entries(d.months || {}).sort((a, b) => {
        const [ma, ya] = a[0].split("-");
        const [mb, yb] = b[0].split("-");
        return (Number(yb) - Number(ya)) || (months.indexOf(mb) - months.indexOf(ma));
    });

    const paidCount = history.filter(([, h]) => h.status === "Paid").length;
    const totalCount = history.length;
    const streakPct = totalCount > 0 ? Math.round((paidCount / totalCount) * 100) : 0;

    const checkIcon = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17L4 12" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    const dotIcon = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="3" fill="white"/></svg>`;
    const alertIcon = `<path d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>`;
    const checkPath = `<path d="M20 6L9 17L4 12" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;

    panel.innerHTML = `
    <div class="rpd-root">

        <div class="rpd-banner">
            <div class="rpd-banner-circles">
                <div class="rpd-circle rpd-c1"></div>
                <div class="rpd-circle rpd-c2"></div>
                <div class="rpd-circle rpd-c3"></div>
            </div>
            <div class="rpd-banner-left">
                <div class="rpd-eyebrow">
                    <span class="rpd-dot ${isPaid ? 'dot-green' : 'dot-red'}"></span>
                    Resident Portal &bull; ${currentSociety}
                </div>
                <h1 class="rpd-name">${translateTerm('Flat')} ${loggedInFlat.block}-${loggedInFlat.num}</h1>
                <div class="rpd-owner-name" style="font-size: 20px; font-weight: 700; color: rgba(255,255,255,0.85); margin-top: -5px; margin-bottom: 10px;">${mData.owner || 'N/A'}</div>
                <p class="rpd-period-label">Viewing Period: <strong>${period}</strong></p>
                ${isPaid ? `
                <div style="
                    margin-top: 10px;
                    background: rgba(255,255,255,0.12);
                    border: 1px solid rgba(255,255,255,0.2);
                    border-radius: 10px;
                    padding: 8px 16px;
                    display: inline-flex;
                    align-items: center;
                    gap: 10px;
                    backdrop-filter: blur(6px);
                ">
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none"><rect x="2" y="5" width="20" height="14" rx="2" stroke="rgba(255,255,255,0.75)" stroke-width="2"/><path d="M2 10h20" stroke="rgba(255,255,255,0.75)" stroke-width="2"/></svg>
                    <span style="font-size:16px; font-weight:800; color:rgba(255,255,255,0.85);">Payment Method: <span style="color:white; font-weight:900;">${mData.paymentMethod || '-'}</span></span>
                </div>` : ''}
            </div>
            <div class="rpd-banner-right">
                <div class="rpd-status-badge ${isPaid ? 'badge-paid' : 'badge-pending'}">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                        ${isPaid ? checkPath : alertIcon}
                    </svg>
                    ${mData.status || "Pending"}
                </div>
                <div class="rpd-amount-display">
                    <span class="rpd-amount-label">Amount Due</span>
                    <span class="rpd-amount-value">&#8377;${Number(mData.amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                </div>
                ${isPaid ? `
                    <button onclick="downloadReceipt('${period}')" style="
                        margin-top: 15px;
                        background: white;
                        color: #5B3C1D;
                        border: none;
                        padding: 8px 16px;
                        border-radius: 10px;
                        font-weight: 800;
                        font-size: 14px;
                        cursor: pointer;
                        display: flex;
                        align-items: center;
                        gap: 6px;
                        box-shadow: 0 4px 12px rgba(0,0,0,0.1);
                    ">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                        Receipt
                    </button>
                ` : ''}
            </div>
        </div>

        <div class="rpd-pills-row">
            <div class="rpd-pill">
                <div class="rpd-pill-icon rpd-pill-icon--plan">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
                </div>
                <div>
                    <div class="rpd-pill-label">Plan</div>
                    <div class="rpd-pill-value">${mData.plan === "yearly" ? "Yearly" : "Monthly"}</div>
                </div>
            </div>
            <div class="rpd-pill">
                <div class="rpd-pill-icon rpd-pill-icon--date">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><rect x="3" y="4" width="18" height="18" rx="2" stroke="currentColor" stroke-width="2"/><path d="M16 2v4M8 2v4M3 10h18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
                </div>
                <div>
                    <div class="rpd-pill-label">Due Date</div>
                    <div class="rpd-pill-value">${dueDate}</div>
                </div>
            </div>

            <div class="rpd-pill">
                <div class="rpd-pill-icon rpd-pill-icon--paid">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                </div>
                <div>
                    <div class="rpd-pill-label">Paid On</div>
                    <div class="rpd-pill-value">${isPaid ? (mData.paidDate || "-") : "-"}</div>
                </div>
            </div>

            <div class="rpd-pill">
                <div class="rpd-pill-icon" style="background: ${d.isRental === 'Yes' ? 'linear-gradient(135deg, #FEF3C7, #FDE68A)' : 'linear-gradient(135deg, #D1FAE5, #A7F3D0)'}; color: ${d.isRental === 'Yes' ? '#D97706' : '#059669'};">
                    ${d.isRental === 'Yes'
                        ? `<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><polyline points="9 22 9 12 15 12 15 22" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`
                        : `<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="7" r="4" stroke="currentColor" stroke-width="2"/></svg>`
                    }
                </div>
                <div>
                    <div class="rpd-pill-label">${d.isRental === 'Yes' ? 'Rental' : 'Occupancy'}</div>
                    <div class="rpd-pill-value">
                        ${d.isRental === 'Yes'
                            ? `${d.rentalName || 'Tenant'}<br><span style="font-size:18px; font-weight:800; color:#9C6B45; letter-spacing:0.5px; display:inline-block; margin-top:2px;">${d.rentalPhone || ''}</span>`
                            : 'Self Occupied'
                        }
                    </div>
                </div>
            </div>
        </div>

        <div class="rpd-main-grid">

            <div class="rpd-left-col">



                <div class="rpd-card rpd-bank-card">
                    <div class="rpd-card-header">
                        <div>
                            <div class="rpd-card-eyebrow">Payment Gateway</div>
                            <div class="rpd-card-title">Bank Details</div>
                        </div>
                        <div class="rpd-secure-badge">Secure</div>
                    </div>
                    <div class="rpd-bank-body">
                        <div class="rpd-bank-fields">
                            <div class="rpd-bank-row">
                                <span>Bank Name</span>
                                <strong>${bank.n || "-"}</strong>
                            </div>
                            <div class="rpd-bank-row">
                                <span>Account No.</span>
                                <strong>${bank.a ? "****" + String(bank.a).slice(-4) : "-"}</strong>
                            </div>
                            <div class="rpd-bank-row">
                                <span>IFSC Code</span>
                                <strong>${bank.i || "-"}</strong>
                            </div>
                        </div>
                        <div class="rpd-qr-wrap">
                            ${bank.q
            ? `<img src="${bank.q}" alt="QR Code" class="rpd-qr-img"><p class="rpd-qr-hint">Scan to Pay</p>`
            : `<div class="rpd-qr-placeholder"><span>No QR Available</span></div>`
        }
                        </div>
                    </div>
                </div>

            </div>

            <div class="rpd-card rpd-history-card">
                <div class="rpd-card-header">
                    <div>
                        <div class="rpd-card-eyebrow">Payment Records</div>
                        <div class="rpd-card-title">Maintenance History</div>
                    </div>
                    <div class="rpd-history-count">${history.length} <span>records</span></div>
                </div>
                <div class="rpd-timeline">
                    ${history.length ? history.map(([p, h], idx) => `
                        <div class="rpd-timeline-item ${h.status === 'Paid' ? 'tl-paid' : 'tl-pending'}">
                            <div class="rpd-tl-dot-wrap">
                                <div class="rpd-tl-dot ${h.status === 'Paid' ? 'tl-dot-paid' : 'tl-dot-pending'}">
                                    ${h.status === 'Paid' ? checkIcon : dotIcon}
                                </div>
                                ${idx < history.length - 1 ? '<div class="rpd-tl-line"></div>' : ''}
                            </div>
                            <div class="rpd-tl-content">
                                <div class="rpd-tl-top">
                                    <strong class="rpd-tl-period">${p}</strong>
                                    <span class="rpd-tl-status ${h.status === 'Paid' ? 'tls-paid' : 'tls-pending'}">${h.status || 'Pending'}</span>
                                </div>
                                <div class="rpd-tl-meta">
                                    <span>&#8377;${Number(h.amount || 0).toLocaleString('en-IN')}</span>
                                    <span class="rpd-tl-sep">&#183;</span>
                                    <span>${h.plan === 'yearly' ? 'Yearly' : 'Monthly'}</span>
                                    ${h.status === 'Paid' ? `<span class="rpd-tl-sep">&#183;</span><span>${h.paymentMethod || '-'}</span><span class="rpd-tl-sep">&#183;</span><span>${h.paidDate || '-'}</span><span class="rpd-tl-sep">&#183;</span><button onclick="downloadReceipt('${p}')" style="background:none; border:none; color:#8B5E3C; font-weight:800; cursor:pointer; text-decoration:underline; font-size:14px; padding:0;">Receipt</button>` : ''}
                                </div>
                            </div>
                        </div>
                    `).join('') : `
                        <div class="rpd-no-history">
                            <p>No payment history yet.</p>
                        </div>
                    `}
                </div>
            </div>

        </div>
    </div>`;
}

function parsePaidDate(dateStr) {
    if (!dateStr || dateStr === '-') return null;

    const parts = dateStr.split('-');

    // Your saved format is DD-MM-YYYY
    if (parts.length === 3) {
        return new Date(parts[2], parts[1] - 1, parts[0]);
    }

    return null;
}

function isPeriodBefore(p1, p2) {
    if (!p1 || !p2) return false;
    const monthsList = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const [m1, y1] = p1.split('-');
    const [m2, y2] = p2.split('-');
    const year1 = parseInt(y1);
    const year2 = parseInt(y2);
    if (year1 < year2) return true;
    if (year1 > year2) return false;
    return monthsList.indexOf(m1) < monthsList.indexOf(m2);
}

function getEffectiveMonthData(d, period) {
    const [monthName, yearValue] = period.split('-');
    const selectedMonthIndex = months.indexOf(monthName);
    const selectedYear = parseInt(yearValue);

    const existingMonth = d.months?.[period] || {};

    let defaultOwner = d.owner;
    let defaultPhone = d.phone;
    let defaultIsRental = d.isRental || 'No';
    let defaultRentalName = d.rentalName || '';
    let defaultRentalPhone = d.rentalPhone || '';

    if (d.transferPeriod) {
        if (isPeriodBefore(period, d.transferPeriod)) {
            defaultOwner = d.pastOwner || d.owner;
            defaultPhone = d.pastPhone || d.phone;
            defaultIsRental = d.pastRentalName ? 'Yes' : 'No';
            defaultRentalName = d.pastRentalName || '';
            defaultRentalPhone = d.pastRentalPhone || '';
        }
    }

    let mData = {
        status: existingMonth.status || 'Pending',
        amount: existingMonth.amount || d.latestAmount || 0,
        paidDate: existingMonth.paidDate || '-',
        plan: existingMonth.plan || 'monthly',
        paymentMethod: existingMonth.paymentMethod || d.latestPaymentMethod || 'Cash',
        owner: (existingMonth && existingMonth.hasOwnProperty('owner') && existingMonth.owner !== null) ? existingMonth.owner : defaultOwner, // Historical owner if exists, else current/resolved
        phone: defaultPhone,
        isRental: defaultIsRental,
        rentalName: defaultRentalName,
        rentalPhone: defaultRentalPhone,
        yearlyActive: false
    };

    const selectedMonthStart = new Date(selectedYear, selectedMonthIndex, 1);
    const selectedMonthEnd = new Date(selectedYear, selectedMonthIndex + 1, 0);

    Object.entries(d.months || {}).forEach(([mPeriod, m]) => {
        if (m.plan === 'yearly' && m.status === 'Paid' && m.paidDate) {
            const paidDate = parsePaidDate(m.paidDate);
            if (!paidDate) return;

            const expiryDate = new Date(paidDate);
            expiryDate.setFullYear(expiryDate.getFullYear() + 1);

            if (selectedMonthEnd >= paidDate && selectedMonthStart < expiryDate) {
                mData = {
                    status: 'Paid',
                    amount: m.amount || d.latestAmount || 0,
                    paidDate: m.paidDate,
                    plan: 'yearly',
                    paymentMethod: m.paymentMethod || 'Cash',
                    owner: m.owner || mData.owner, // Preserve owner in yearly logic
                    isRental: mData.isRental,
                    rentalName: mData.rentalName,
                    rentalPhone: mData.rentalPhone,
                    yearlyActive: true,
                    startPeriod: mPeriod
                };
            }
        }
    });

    return mData;
}
function displayFlats() {
    const tbody = document.getElementById('dashboardTable');

    // IMPORTANT FIX:
    // The edit form is moved inside a table row when editing a flat.
    // Before rebuilding the table, move it back to <body>; otherwise tbody.innerHTML='' deletes it.
    const form = document.getElementById('adminForm');
    if (form) {
        form.classList.add('hidden');
        document.body.appendChild(form);
    }

    tbody.innerHTML = '';
    const soc = vault[currentSociety], period = `${document.getElementById('viewMonth').value}-${document.getElementById('viewYear').value}`;
    const displayDate = getCalculatedDueDate().split('-').reverse().join('-');
    let stats = { occ: 0, paid: 0, pend: 0, rent: 0 };

    Object.keys(soc.apartmentData).sort().forEach(block => {
        // Add block header
        const blockHeaderRow = tbody.insertRow();
        blockHeaderRow.id = `block-header-${block}`;
        blockHeaderRow.className = "block-header";

        const isCollapsed = blockStates[`${currentSociety}-${block}`] === true;

        blockHeaderRow.innerHTML = `
            <td colspan="6" style="padding: 0;">
                <div class="block-header-text" onclick="toggleBlockCollapse('${block}')">
                    <span class="block-toggle-icon ${isCollapsed ? 'collapsed' : ''}">▼</span>
                    <span>Block ${block}</span>
                    <span class="block-action-text" style="margin-left: auto; font-size: 12px; font-weight: normal;">Click to ${isCollapsed ? 'expand' : 'collapse'}</span>
                </div>
            </td>
        `;

        // Add flat rows for this block
        const blockStartIdx = tbody.rows.length;

        let blockConfig = getBlockConfig(soc, block);
        let flatList = getFlatList(blockConfig);

        for (let flatNum of flatList) {
            const d = soc.apartmentData[block][flatNum] || {};
            const mData = getEffectiveMonthData(d, period);
            const displayOwner = mData.owner;
            const isOccupied = (displayOwner && displayOwner.trim() !== "");
            if (isOccupied) {
                stats.occ++;
                mData.status === 'Paid' ? stats.paid++ : stats.pend++;
                if (mData.isRental === 'Yes') stats.rent++;
            }

            let residentDisplay = `<span class="font-bold text-[#3E2C1C]">${displayOwner || 'Vacant'}</span> ${isOccupied && mData.phone ? `<span class="phone-badge">(${mData.phone})</span>` : ''}`;
            if (mData.isRental === 'Yes' && mData.rentalName) residentDisplay += `<div class="text-[20px] text-amber-400 mt-1 uppercase tracking-tighter">Tenant: ${mData.rentalName} ${mData.rentalPhone ? `(${mData.rentalPhone})` : ''}</div>`;

            const row = tbody.insertRow();
            row.className = `hover:bg-amber-900/5 transition-colors ${isAdmin ? 'cursor-pointer admin-flat-row' : ''} block-row-${block}`;
            row.id = `flat-${block}-${flatNum}`;
            if (isAdmin) row.onclick = () => scrollToEdit(block, flatNum);

            if (isCollapsed) {
                row.style.display = 'none';
            }

            row.innerHTML = `
                <td class="p-6 font-bold text-[#8B5E3C] whitespace-nowrap">
${block}-${flatNum}
</td>
                <td class="p-6">${residentDisplay}</td>
                <td class="p-6">
                    <span class="${isOccupied ? (mData.status === 'Paid' ? 'status-pill-paid' : 'status-pill-pending') : 'text-[#9C6B45]'} px-2 py-0.5 rounded-full text-[12px] font-bold">
                        ${isOccupied ? mData.status : '-'}
                    </span>

${mData.yearlyActive ? `
<div style="
    margin-top:10px;
    display:inline-block;
    background:none;
    color:green;
    padding:6px 12px;
    border-radius:999px;
    font-size:17px;
    font-weight:900;
    letter-spacing:1px;
">
     YEARLY
</div>
` : ''}
</td>
                <td class="p-6 text-[18px] font-bold text-[#7A6855]">
${mData.status === 'Paid' ? (mData.paidDate || '-') : '-'}
</td>
                                <td class="p-6 font-mono text-2xl">${isOccupied ? `₹${mData.amount || 0}` : '-'}</td>
                <td class="p-6 text-center">
${(isOccupied && isAdmin)
                    ? `
    <div style="display:flex; gap:10px; justify-content:center; flex-wrap:wrap;">
       ${mData.status !== 'Paid'
                        ? `
<button
    onclick="event.stopPropagation(); markMaintenancePaid('${block}', '${flatNum}')"
    style="
        background:#16A34A;
        color:white;
        border:none;
        padding:12px 18px;
        border-radius:12px;
        font-size:16px;
        font-weight:900;
        cursor:pointer;
    "
>
    ✅ Paid
</button>
`
                        : ''
                    }

        <button
            onclick="event.stopPropagation(); sendNotice('${mData.phone || ''}', '${mData.status}', '${displayOwner}', '${mData.amount}', '${displayDate}', '${block}', '${flatNum}')"
            style="
                background:rgba(139,94,60,0.12);
                color:#8B5E3C;
                border:1px solid rgba(139,94,60,0.25);
                padding:12px 18px;
                border-radius:12px;
                font-size:16px;
                font-weight:900;
                cursor:pointer;
            "
        >
            Send
        </button>
    </div>
`
                    : '-'
                }
</td>
            `;
            const detailRow = tbody.insertRow();
            detailRow.id = `detail-${block}-${flatNum}`;
            detailRow.className = "hidden bg-white/80";
            detailRow.innerHTML = `<td colspan="6" class="p-0"><div id="container-${block}-${flatNum}" class="px-8 pb-4"></div></td>`;
        }
    });
    document.getElementById('totalOccupied').innerText = stats.occ;
    document.getElementById('paidCount').innerText = stats.paid;
    document.getElementById('pendingCount').innerText = stats.pend;
    const rentalBox = document.getElementById("rentalCount");
    if (rentalBox) rentalBox.innerText = stats.rent;
}

function toggleBlockCollapse(block) {
    const key = `${currentSociety}-${block}`;
    blockStates[key] = !blockStates[key];
    localStorage.setItem('blockStates', JSON.stringify(blockStates));
    const isCollapsed = blockStates[key];

    document.querySelectorAll(`.block-row-${block}`).forEach(row => {
        row.style.display = isCollapsed ? 'none' : '';
    });

    document.querySelectorAll(`[id^="detail-${block}-"]`).forEach(row => {
        row.classList.add('hidden');
        row.style.display = isCollapsed ? 'none' : '';
    });

    const icon = document.querySelector(`#block-header-${block} .block-toggle-icon`);
    if (icon) icon.classList.toggle('collapsed', isCollapsed);

    const label = document.querySelector(`#block-header-${block} .block-action-text`);
    if (label) label.innerText = `Click to ${isCollapsed ? 'expand' : 'collapse'}`;
}

// --- COMMON UTILS ---
function getCalculatedDueDate() {
    const soc = vault[currentSociety];
    const defaultDueDay = soc?.config?.defaultDueDay || 1;
    const mIdx = months.indexOf(document.getElementById('viewMonth').value);
    const year = parseInt(document.getElementById('viewYear').value);

    // If defaultDueDay is larger than days in month, use last day
    const lastDateOfMonth = new Date(year, mIdx + 1, 0).getDate();
    const actualDueDay = Math.min(defaultDueDay, lastDateOfMonth);
    const dueDate = new Date(year, mIdx, actualDueDay);

    return `${dueDate.getFullYear()}-${String(dueDate.getMonth() + 1).padStart(2, '0')}-${String(dueDate.getDate()).padStart(2, '0')}`;
}

function handlePeriodChange() {
    document.getElementById('globalDueDate').value = getCalculatedDueDate();

    displayFlats();
    updateAnalytics();
    renderExpenses();

    if (!isAdmin) renderResidentSidebar();
    else {
        const b = document.getElementById('block').value;
        const f = document.getElementById('flatNumber').value;
        if (b && f) loadFlatData(b, f);
    }
}

let flatSaveInProgress = false;

function saveFlat() {
    if (flatSaveInProgress) return;

    const ownerName = document.getElementById('ownerName').value.trim();
    const phone = document.getElementById('phone').value.trim();
    const isRental = document.getElementById('isRental').value;
    const rentalName = document.getElementById('rentalName').value.trim();
    const rentalPhone = document.getElementById('rentalPhone').value.trim();
    const maintenanceAmount = document.getElementById('maintenanceAmount').value.trim();
    const paymentPlan = document.getElementById('paymentPlan').value;

    const resSection = document.getElementById('residentCredentialsSection');
    const credentialsVisible = resSection && resSection.style.display !== 'none';
    const residentUsername = credentialsVisible ? document.getElementById('resUsername').value.trim() : '';
    const residentPassword = credentialsVisible ? document.getElementById('resPasswordInput').value.trim() : '';

    if (!ownerName) return showToast("Please fill Owner Name.");
    if (!phone) return showToast("Please fill Owner Phone Number.");

    if (isRental === "Yes") {
        if (!rentalName) return showToast("Please fill Tenant Name.");
        if (!rentalPhone) return showToast("Please fill Tenant Phone Number.");
    }

    if (!maintenanceAmount) return showToast("Please fill Maintenance Amount.");

    const b = document.getElementById('block').value;
    const f = document.getElementById('flatNumber').value;
    const period = `${document.getElementById('editMonth').value}-${document.getElementById('editYear').value}`;
    const status = document.getElementById('maintenance').value;
    const paymentMethod = document.getElementById('paymentMethod').value;

    const now = new Date();
    const dateStr = status === 'Paid' ? `${String(now.getDate()).padStart(2, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${now.getFullYear()}` : '-';

    // --- OWNERSHIP TRANSFER ---
    const transferEnabled = document.getElementById('enableTransfer')?.checked;
    const futureOwnerName = document.getElementById('futureOwnerName')?.value.trim();
    const futureOwnerPhone = document.getElementById('futureOwnerPhone')?.value.trim();
    const transferMonth = document.getElementById('transferMonth')?.value;
    const transferYear = document.getElementById('transferYear')?.value;

    if (transferEnabled) {
        if (!futureOwnerName) {
            return showToast("Please enter the New Owner Name for the transfer.");
        }
        if (!futureOwnerPhone || futureOwnerPhone.length !== 10 || isNaN(futureOwnerPhone)) {
            return showToast("Please enter a valid 10-digit New Owner Phone Number.");
        }
    }

    const flatData = {
        society_name: currentSociety,
        block: b,
        flat_number: f,
        owner: ownerName,
        phone: phone,
        isRental: isRental,
        rentalName: rentalName,
        rentalPhone: rentalPhone,
        amount: maintenanceAmount,
        period: period,
        status: status,
        plan: paymentPlan,
        paymentMethod: paymentMethod,
        dateStr: dateStr,
        // Send transfer fields only if checkbox is ticked
        futureOwner: transferEnabled ? futureOwnerName : null,
        futureOwnerPhone: transferEnabled ? futureOwnerPhone : null,
        transferMonth: transferEnabled ? transferMonth : null,
        transferYear: transferEnabled ? transferYear : null,
        property_type: propertyType,
        residentUsername: residentUsername,
        residentPassword: residentPassword
    };

    flatSaveInProgress = true;
    Api.saveFlat(flatData)
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                const msg = transferEnabled
                    ? `Saved! ${ownerName} → ${futureOwnerName} from ${transferMonth} ${transferYear}`
                    : translateTerm(`Flat saved successfully!`);
                showToast(msg, 'success');
                document.getElementById('adminForm').classList.add('hidden');
                loadDashboardData();
            } else {
                showToast(data.message || 'Failed to save flat details.', 'error');
            }
        })
        .catch(() => {
            showToast('Server error. Please try again.', 'error');
        })
        .finally(() => {
            flatSaveInProgress = false;
        });
}
function scrollToEdit(b, f) {
    if (!isAdmin) return;

    const form = document.getElementById('adminForm');

    if (!form) return;

    document.getElementById('block').value = b;
    document.getElementById('flatNumber').value = f;
    document.getElementById('editMonth').value = document.getElementById('viewMonth').value;
    document.getElementById('editYear').value = document.getElementById('viewYear').value;

    loadFlatData(b, f);

    form.classList.remove('hidden');
}

function loadFlatData(b, f) {

    const soc = vault[currentSociety],
        period = `${document.getElementById('viewMonth').value}-${document.getElementById('viewYear').value}`;

    const d = soc.apartmentData[b][f] || { months: {} },
        m = getEffectiveMonthData(d, period);

    document.getElementById('ownerName').value = (m.hasOwnProperty('owner') && m.owner !== null) ? m.owner : (d.owner || '');

    document.getElementById('phone').value = m.phone || d.phone || '';

    document.getElementById('isRental').value = m.isRental || 'No';

    document.getElementById('rentalName').value = m.rentalName || '';

    document.getElementById('rentalPhone').value = m.rentalPhone || '';

    const hasRealResidentUsername = d.residentUsername && !/^_(owner|tenant|placeholder_owner)_/i.test(d.residentUsername);
    document.getElementById('resUsername').value = hasRealResidentUsername ? d.residentUsername : '';
    document.getElementById('resPasswordInput').value = '';

    const resSection = document.getElementById('residentCredentialsSection');
    if (hasRealResidentUsername) {
        resSection.style.display = 'none';
    } else {
        resSection.style.display = '';
    }

    document.getElementById('maintenance').value =
        m.status || 'Pending';

    document.getElementById('maintenanceAmount').value =
        m.amount || 0;
    document.getElementById('paymentPlan').value =
        m.plan || 'monthly';

    document.getElementById('paymentMethod').value =
        m.paymentMethod || 'Cash';

    toggleRentalFields();

    // --- Reset ownership transfer section ---
    const enableTransferEl = document.getElementById('enableTransfer');
    const transferFieldsEl = document.getElementById('transferFields');
    const futureOwnerEl = document.getElementById('futureOwnerName');
    const transferYearEl = document.getElementById('transferYear');
    const transferMonthEl = document.getElementById('transferMonth');

    if (enableTransferEl) enableTransferEl.checked = false;
    if (transferFieldsEl) transferFieldsEl.classList.add('hidden');
    if (futureOwnerEl) futureOwnerEl.value = '';
    const futureOwnerPhoneEl = document.getElementById('futureOwnerPhone');
    if (futureOwnerPhoneEl) futureOwnerPhoneEl.value = '';

    // Populate transfer year dropdown
    if (transferYearEl) {
        transferYearEl.innerHTML = '';
        const currentYear = new Date().getFullYear();
        for (let y = currentYear; y <= currentYear + 5; y++) {
            const opt = document.createElement('option');
            opt.value = y;
            opt.textContent = y;
            transferYearEl.appendChild(opt);
        }
        // Default to next year
        transferYearEl.value = currentYear + 1;
    }

    // Default transfer month to January
    if (transferMonthEl) transferMonthEl.value = 'January';

    updateTransferPreview();
}

function toggleTransferFields() {
    const enabled = document.getElementById('enableTransfer')?.checked;
    const fieldsEl = document.getElementById('transferFields');
    if (fieldsEl) fieldsEl.classList.toggle('hidden', !enabled);
    updateTransferPreview();
}

function updateTransferPreview() {
    const previewEl = document.getElementById('transferPreviewText');
    if (!previewEl) return;

    const enabled = document.getElementById('enableTransfer')?.checked;
    const ownerName = document.getElementById('ownerName')?.value.trim() || 'Current Owner';
    const futureOwner = document.getElementById('futureOwnerName')?.value.trim() || 'New Owner';
    const month = document.getElementById('transferMonth')?.value || 'January';
    const year = document.getElementById('transferYear')?.value || '';

    if (!enabled) {
        previewEl.textContent = '📋 Check the box above to schedule an ownership transfer.';
        return;
    }

    previewEl.textContent = `📋 Preview: "${ownerName}" keeps all months before ${month} ${year}. "${futureOwner}" takes over from ${month} ${year} onwards.`;
}

function toggleBankModal() { document.getElementById('bankModal').classList.toggle('hidden'); checkFloatingComplaintVisibility(); }
function toggleCommitteeModal() {
    document.getElementById('committeeModal').classList.toggle('hidden');
    if (!document.getElementById('committeeModal').classList.contains('hidden')) {
        loadCommittee();
        document.getElementById('adminCommitteeSection').classList.toggle('hidden', !isAdmin);

    }
    checkFloatingComplaintVisibility();
}

function loadCommittee() {
    const container = document.getElementById('committeeListView');
    container.innerHTML = '';
    const members = vault[currentSociety].committee || [];
    if (members.length === 0) { container.innerHTML = `<p class="text-[#7A6855] text-center py-10">No members listed.</p>`; return; }
    members.forEach((m) => {
        const div = document.createElement('div');
        div.className = "bg-amber-900/5 p-4 rounded-2xl flex justify-between items-center border border-amber-900/10";
        div.innerHTML = `<div><p class="text-[22px] text-amber-400 font-bold uppercase tracking-widest">${m.role}</p><p class="text-2xl font-bold text-[#3E2C1C]">${m.name}</p><p class="text-2xl text-[#7A6855] font-mono">${m.phone}</p></div>
        <div class="flex gap-2">
            <button onclick="window.open('https://wa.me/${m.phone}')" class="text-emerald-400">WA</button>
            ${isAdmin ? `<button onclick="deleteComm(${m.id})" class="text-rose-600">DEL</button>` : ''}
        </div>`;
        container.appendChild(div);
    });
}

function saveCommitteeMember() {
    const n = document.getElementById('commName').value, r = document.getElementById('commRole').value, p = document.getElementById('commPhone').value;
    if (!n || !r || !p) return showToast("Please fill all committee fields.");

    // Immediate UI feedback
    document.getElementById('commName').value = '';
    document.getElementById('commRole').value = '';
    document.getElementById('commPhone').value = '';

    Api.saveCommittee({ society_name: currentSociety, name: n, role: r, phone: p, property_type: propertyType })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                if (!vault[currentSociety].committee) vault[currentSociety].committee = [];
                vault[currentSociety].committee.push({ id: data.id, name: n, role: r, phone: p });
                loadCommittee();
            } else {
                showToast("Error adding member. Please try again.");
            }
        });
}

function deleteComm(id) {
    if (!isAdmin) return;
    showConfirm("Are you sure you want to remove this committee member?", "Yes, Remove", true, () => {
        Api.deleteCommittee(id)
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    if (vault[currentSociety].committee) {
                        vault[currentSociety].committee = vault[currentSociety].committee.filter(c => c.id != id);
                    }
                    loadCommittee();
                    loadDashboardData();
                } else {
                    showToast("Error deleting member.");
                }
            });
    });
}

function saveBank() {
    const file = document.getElementById('eqr').files[0];
    const executeSave = (qrData) => {
        const bankData = {
            society_name: currentSociety,
            bank_name: document.getElementById('ebank').value,
            bank_acc: document.getElementById('eacc').value,
            bank_ifsc: document.getElementById('eifsc').value,
            qr_code: qrData || vault[currentSociety].bank?.q || "",
            property_type: propertyType
        };

        Api.saveBank(bankData)
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    loadDashboardData();
                    showToast("Bank details updated!", "success");
                }
            });
    };
    if (file) { const reader = new FileReader(); reader.onloadend = () => executeSave(reader.result); reader.readAsDataURL(file); }
    else executeSave();
}

function loadBank() {
    const b = vault[currentSociety]?.bank || {};
    document.getElementById('vBank').innerText = b.n || '-';
    document.getElementById('vAcc').innerText = b.a || '-';
    document.getElementById('vIfsc').innerText = b.i || '-';
    if (b.q) { document.getElementById('qrPreview').src = b.q; document.getElementById('qrPreview').classList.remove('hidden'); }
    else document.getElementById('qrPreview').classList.add('hidden');
    document.getElementById('ebank').value = b.n || ''; document.getElementById('eacc').value = b.a || ''; document.getElementById('eifsc').value = b.i || '';
}

function generateFlatInputs(blocksVal) {
    const container = document.getElementById('dynamicFlatsContainer');
    const globalContainer = document.getElementById('globalFlatsInputs');
    if (!container) return;
    container.innerHTML = '';
    const blocks = parseInt(blocksVal);

    // Show/hide the "same flats" toggle row
    const toggleRow = document.getElementById('sameFlatsToggleRow');
    if (toggleRow) {
        if (isNaN(blocks) || blocks < 1 || blocks > 26) {
            toggleRow.style.display = 'none';
            return;
        }
        toggleRow.style.display = 'flex';
    } else {
        if (isNaN(blocks) || blocks < 1 || blocks > 26) return;
    }

    // Generate Global Inputs based on Property Type
    let globalHtml = '';
    if (propertyType === 'flat') {
        globalHtml = `
            <input id="globalFloors" type="number" min="1" max="99" oninput="applyAllFlats()" placeholder="Floors" style="flex:1; min-width:0; height:60px; padding:10px; border-radius:12px; font-size:18px; font-weight:700;" class="input-field">
            <input id="globalFlats" type="number" min="1" max="99" oninput="applyAllFlats()" placeholder="Flats/Floor" style="flex:1; min-width:0; height:60px; padding:10px; border-radius:12px; font-size:18px; font-weight:700;" class="input-field">
            <select id="globalBase" onchange="applyAllFlats()" style="flex:1.2; min-width:0; height:60px; min-height:60px; padding:0 8px; border-radius:12px; font-size:16px; font-weight:700;" class="input-field">
                <option value="1">A-1, A-2, A-3...</option>
                <option value="10" selected>A-11, A-12, A-13...</option>
                <option value="100">A-101, A-102, A-103...</option>
            </select>
        `;
    } else {
        globalHtml = `
            <input id="globalCount" type="number" min="1" max="99" oninput="applyAllFlats()" placeholder="Bunglows/Block" style="width:160px; height:60px; padding:10px; border-radius:12px; font-size:20px; font-weight:700;" class="input-field">
        `;
    }
    if (globalContainer) globalContainer.innerHTML = globalHtml;

    // Reset same-flats toggle state when block count changes
    const sameCheck = document.getElementById('sameFlatsCheck');
    if (sameCheck) sameCheck.checked = false;
    if (globalContainer) globalContainer.style.display = 'none';

    const track = document.getElementById('sameFlatsTrack');
    const thumb = document.getElementById('sameFlatsThumb');
    if (track) track.style.background = '#D9C3AE';
    if (thumb) thumb.style.left = '4px';

    // Build individual block inputs
    let html = '';
    container.className = propertyType === 'flat' ? 'grid grid-cols-1 gap-5' : 'grid grid-cols-2 gap-5';

    for (let i = 0; i < blocks; i++) {
        const bName = String.fromCharCode(65 + i);
        if (propertyType === 'flat') {
            html += `
                <div style="display:flex; gap:10px; align-items:center; background:white; padding:12px; border-radius:18px; border:1px solid rgba(139,94,60,0.15);">
                    <span style="font-size:24px; font-weight:900; color:#8B5E3C; min-width:30px; text-align:center;">${bName}</span>
                    <input id="setupFloors_${bName}" type="number" min="1" max="99" placeholder="Floors" style="flex:1; min-width:0; height:60px; padding:10px; border-radius:12px; font-size:18px; font-weight:700;" class="input-field">
                    <input id="setupFlats_${bName}" type="number" min="1" max="99" placeholder="Flats/Floor" style="flex:1; min-width:0; height:60px; padding:10px; border-radius:12px; font-size:18px; font-weight:700;" class="input-field">
                    <select id="setupBase_${bName}" style="flex:1.2; min-width:0; height:60px; min-height:60px; padding:0 8px; border-radius:12px; font-size:16px; font-weight:700;" class="input-field">
                        <option value="1">${bName}-1, ${bName}-2, ${bName}-3...</option>
                        <option value="10" selected>${bName}-11, ${bName}-12, ${bName}-13...</option>
                        <option value="100">${bName}-101, ${bName}-102, ${bName}-103...</option>
                    </select>
                </div>
            `;
        } else {
            html += `
                <input id="setupFlats_${bName}" type="number" min="1" max="99"
                    oninput="if(this.value.length > 2) this.value = this.value.slice(0,2);"
                    placeholder="Bunglows in Block ${bName}" style="
                        width:100%;
                        height:92px;
                        padding:24px 28px;
                        border-radius:24px;
                        font-size:24px;
                        font-weight:700;
                    " class="input-field">
            `;
        }
    }
    container.innerHTML = html;
}

function toggleSameFlats() {
    const checked = document.getElementById('sameFlatsCheck').checked;
    const globalContainer = document.getElementById('globalFlatsInputs');
    const track = document.getElementById('sameFlatsTrack');
    const thumb = document.getElementById('sameFlatsThumb');

    // Animate toggle
    if (track) track.style.background = checked ? '#8B5E3C' : '#D9C3AE';
    if (thumb) thumb.style.left = checked ? '30px' : '4px';

    if (globalContainer) {
        globalContainer.style.display = checked ? 'flex' : 'none';
    }

    if (checked) {
        // Disable individual inputs
        const blocks = parseInt(document.getElementById('setupBlocks').value) || 0;
        for (let i = 0; i < blocks; i++) {
            const bName = String.fromCharCode(65 + i);
            if (propertyType === 'flat') {
                const elFloors = document.getElementById('setupFloors_' + bName);
                const elFlats = document.getElementById('setupFlats_' + bName);
                const elBase = document.getElementById('setupBase_' + bName);
                if (elFloors) elFloors.disabled = true;
                if (elFlats) elFlats.disabled = true;
                if (elBase) elBase.disabled = true;
            } else {
                const el = document.getElementById('setupFlats_' + bName);
                if (el) el.disabled = true;
            }
        }
        applyAllFlats();
    } else {
        // Enable individual inputs
        const blocks = parseInt(document.getElementById('setupBlocks').value) || 0;
        for (let i = 0; i < blocks; i++) {
            const bName = String.fromCharCode(65 + i);
            if (propertyType === 'flat') {
                const elFloors = document.getElementById('setupFloors_' + bName);
                const elFlats = document.getElementById('setupFlats_' + bName);
                const elBase = document.getElementById('setupBase_' + bName);
                if (elFloors) elFloors.disabled = false;
                if (elFlats) elFlats.disabled = false;
                if (elBase) elBase.disabled = false;
            } else {
                const el = document.getElementById('setupFlats_' + bName);
                if (el) el.disabled = false;
            }
        }
    }
}

function applyAllFlats() {
    const checked = document.getElementById('sameFlatsCheck').checked;
    if (!checked) return;

    const blocks = parseInt(document.getElementById('setupBlocks').value) || 0;

    if (propertyType === 'flat') {
        const fVal = document.getElementById('globalFloors').value;
        const perFVal = document.getElementById('globalFlats').value;
        const bVal = document.getElementById('globalBase').value;

        for (let i = 0; i < blocks; i++) {
            const bName = String.fromCharCode(65 + i);
            const elFloors = document.getElementById('setupFloors_' + bName);
            const elFlats = document.getElementById('setupFlats_' + bName);
            const elBase = document.getElementById('setupBase_' + bName);
            if (elFloors) elFloors.value = fVal;
            if (elFlats) elFlats.value = perFVal;
            if (elBase) elBase.value = bVal;
        }
    } else {
        const uVal = document.getElementById('globalCount').value;
        for (let i = 0; i < blocks; i++) {
            const bName = String.fromCharCode(65 + i);
            const el = document.getElementById('setupFlats_' + bName);
            if (el) el.value = uVal;
        }
    }
}


function runSetup() {
    hideSetupErr();

    const name = document.getElementById('setupSocietyName').value.trim();
    const blocksInput = document.getElementById('setupBlocks').value.trim();
    const user = document.getElementById('setupUser').value.trim();
    const pass = document.getElementById('setupPass').value.trim();

    if (!name) { showSetupErr('Please fill Society Name.'); return; }

    const isCreatingNew =
        !document.getElementById('configFields').classList.contains('hidden');

    if (isCreatingNew) {

        const duplicateSociety = Object.keys(vault).find(
            s => s.toLowerCase() === name.toLowerCase()
        );

        if (duplicateSociety) {
            showSetupErr('This society name already exists. Please use another name.');
            return;
        }

        if (!blocksInput) { showSetupErr('Please fill Number of Blocks.'); return; }
        if (!user) { showSetupErr('Please fill Admin Username.'); return; }
        if (!pass) { showSetupErr('Please fill Admin Password.'); return; }

        const blocks = parseInt(blocksInput);

        if (blocks < 1 || blocks > 26) {
            showSetupErr('Blocks must be between 1 and 26.');
            return;
        }

        let flatsConfig = {};
        for (let i = 0; i < blocks; i++) {
            const bName = String.fromCharCode(65 + i);
            let blockFlats = [];

            if (propertyType === 'flat') {
                const floorsEl = document.getElementById('setupFloors_' + bName);
                const flatsEl = document.getElementById('setupFlats_' + bName);
                const baseEl = document.getElementById('setupBase_' + bName);

                if (!floorsEl || !floorsEl.value || !flatsEl || !flatsEl.value) {
                    showSetupErr(`Please specify floors and flats for Block ${bName}.`);
                    return;
                }

                const floors = parseInt(floorsEl.value);
                const flatsPerFloor = parseInt(flatsEl.value);
                const base = parseInt(baseEl.value) || 10;

                if (floors < 1 || flatsPerFloor < 1) {
                    showSetupErr(`Block ${bName} must have at least 1 floor and 1 flat.`);
                    return;
                }

                for (let f = 1; f <= floors; f++) {
                    for (let n = 1; n <= flatsPerFloor; n++) {
                        if (base === 1) {
                            blockFlats.push(String((f - 1) * flatsPerFloor + n));
                        } else {
                            let multiplier = base === 10 ? 10 : 100;
                            // Auto-upgrade to 100 multiplier if base 10 would cause collisions (i.e. >9 flats per floor)
                            if (base === 10 && flatsPerFloor >= 10) multiplier = 100;

                            let flatNum = (f * multiplier) + n;
                            // If base 100 and floor 1, we want 101, 102.
                            // But wait, what if they chose base 100 and flats >= 100? Edge case.
                            blockFlats.push(String(flatNum));
                        }
                    }
                }
            } else {
                const inputEl = document.getElementById('setupFlats_' + bName);
                if (!inputEl || !inputEl.value.trim()) {
                    showSetupErr(`Please specify units for Block ${bName}.`);
                    return;
                }
                const fVal = parseInt(inputEl.value.trim());
                if (fVal < 1) {
                    showSetupErr(`Block ${bName} must have at least 1 unit.`);
                    return;
                }
                for (let n = 1; n <= fVal; n++) {
                    blockFlats.push(String(n));
                }
            }
            flatsConfig[bName] = blockFlats;
        }

        vault[name] = {
            config: {
                blocks: blocks,
                flats: flatsConfig,
                user: user,
                pass: pass,
                defaultDueDay: 1
            },
            apartmentData: {},
            bank: {},
            committee: [],
            globalSettings: { defaultDueDay: 1 }
        };

        for (let i = 0; i < blocks; i++) {
            vault[name].apartmentData[String.fromCharCode(65 + i)] = {};
        }

        currentSociety = name;
        
        // Show loading state or disable button
        const setupBtn = document.querySelector('#setupInterface button');
        const originalText = setupBtn ? setupBtn.textContent : 'Save & Continue';
        if (setupBtn) {
            setupBtn.disabled = true;
            setupBtn.textContent = 'Saving...';
        }

        saveVault()
            .then(data => {
                if (setupBtn) {
                    setupBtn.disabled = false;
                    setupBtn.textContent = originalText;
                }
                if (data && data.success) {
                    document.getElementById('setupInterface').classList.add('hidden');
                    document.getElementById('loginInterface').classList.remove('hidden');
                } else {
                    // Show error from backend
                    showSetupErr(data.error || 'Failed to save configuration.');
                    // Clean up local vault config on failure
                    delete vault[name];
                }
            })
            .catch(err => {
                if (setupBtn) {
                    setupBtn.disabled = false;
                    setupBtn.textContent = originalText;
                }
                showSetupErr('Server connection failed. Please try again.');
                delete vault[name];
            });

    } else {
        if (!vault[name]) {
            showSetupErr('Society not found. Please create it first or check the name.');
            return;
        }

        currentSociety = name;
        document.getElementById('setupInterface').classList.add('hidden');
        document.getElementById('loginInterface').classList.remove('hidden');
    }
}
function saveVault() {
    // save to MySQL
    let flatsToSave = vault[currentSociety]?.config?.flats || 0;
    if (typeof flatsToSave === 'object') {
        flatsToSave = JSON.stringify(flatsToSave);
    }

    return Api.setup({
            society_name: currentSociety,
            blocks: vault[currentSociety]?.config?.blocks || 0,
            flats: flatsToSave,
            username: vault[currentSociety]?.config?.user || "",
            password: vault[currentSociety]?.config?.pass || "",
            default_due_day: vault[currentSociety]?.config?.defaultDueDay || 1,
            property_type: propertyType
        })
        .then(res => res.json())
        .then(data => {
            console.log("Saved to MySQL:", data);
            return data;
        })
        .catch(err => {
            console.log("MySQL Error:", err);
            throw err;
        });
}
function confirmLogout() {
    showConfirm("Are you sure you want to logout?", "Logout", false, () => {
        handleLogout();
    });
}
function handleLogout() {
    localStorage.removeItem('activeSociety');
    localStorage.removeItem('isAdmin');
    localStorage.removeItem('residentFlat');
    localStorage.removeItem('propertyType');
    currentSociety = '';
    isAdmin = false;
    loggedInFlat = null;
    showLanding();
    checkFloatingComplaintVisibility();
}



// ================================================================
//  WHATSAPP BLAST FEATURE
// ================================================================
let waBlastResidents = [];
let waBlastType = 'pending';

function openWhatsAppBlast(type) {
    const soc = vault[currentSociety];
    if (!soc) return;

    waBlastType = type;
    const period = `${document.getElementById('viewMonth').value}-${document.getElementById('viewYear').value}`;
    const isPending = type === 'pending';

    // Collect matching residents across all blocks/flats
    waBlastResidents = [];
    Object.entries(soc.apartmentData || {}).forEach(([block, flats]) => {
        Object.entries(flats || {}).forEach(([flatNum, flatData]) => {
            if (!flatData) return;
            const mData = getEffectiveMonthData(flatData, period);
            const displayOwner = mData.owner || flatData.owner || '';
            if (!displayOwner || displayOwner.trim() === "") return;
            
            const status = mData.status || 'Pending';
            if ((isPending && status !== 'Paid') || (!isPending && status === 'Paid')) {
                const phone = flatData.phone || flatData.rentalPhone || '';
                waBlastResidents.push({
                    flat: `${block}-${flatNum}`,
                    owner: displayOwner || '-',
                    phone: phone,
                    amount: mData.amount || 0,
                    status,
                    paidDate: mData.paidDate || '-',
                    method: mData.paymentMethod || '-'
                });
            }
        });
    });

    if (waBlastResidents.length === 0) {
        showToast(isPending ? 'There are no pending flats.' : 'There are no paid flats.', 'error');
        return;
    }

    // Build default message
    const society = currentSociety;
    let defaultMsg = '';
    if (isPending) {
        const flatList = waBlastResidents.map(r => `• ${translateTerm('Flat')} ${r.flat} (${r.owner}) — ₹${Number(r.amount).toLocaleString('en-IN')}`).join('\n');
        defaultMsg = `🏢 *${society} — Maintenance Reminder* 🏢\n\nDear Residents,\n\nThe following ${translateTerm('flats')} have *pending maintenance* for *${period}*:\n\n${flatList || 'None found.'}\n\nKindly clear your dues at the earliest.\n\n_Thank you,\nSociety Management_`;
    } else {
        const flatList = waBlastResidents.map(r => `✅ ${translateTerm('Flat')} ${r.flat} (${r.owner}) — ₹${Number(r.amount).toLocaleString('en-IN')} on ${r.paidDate}`).join('\n');
        defaultMsg = `🏢 *${society} — Payment Acknowledgement* 🏢\n\nDear Residents,\n\nThank you! The following ${translateTerm('flats')} have *cleared maintenance* for *${period}*:\n\n${flatList || 'None found.'}\n\n_Thank you for your timely payment!_\n_Society Management_`;
    }

    // Populate modal
    const icon = document.getElementById('waBlastIcon');
    const sendBtn = document.getElementById('waBlastSendBtn');
    const sendAllBtn = document.getElementById('waBlastSendAllBtn');
    if (isPending) {
        icon.style.background = 'linear-gradient(135deg,#25D366,#128C7E)';
        sendBtn.style.background = 'linear-gradient(135deg,#25D366,#128C7E)';
        if (sendAllBtn) {
            sendAllBtn.style.background = 'linear-gradient(135deg,#FF9800,#F57C00)';
            sendAllBtn.style.boxShadow = '0 8px 16px rgba(245,124,0,0.25)';
        }
        document.getElementById('waBlastTitle').textContent = `Notify Pending Residents`;
        document.getElementById('waBlastSubtitle').textContent = `${waBlastResidents.length} ${translateTerm('flat(s)')} with pending maintenance for ${period}`;
    } else {
        icon.style.background = 'linear-gradient(135deg,#3B82F6,#1D4ED8)';
        sendBtn.style.background = 'linear-gradient(135deg,#3B82F6,#1D4ED8)';
        if (sendAllBtn) {
            sendAllBtn.style.background = 'linear-gradient(135deg,#6366F1,#4F46E5)';
            sendAllBtn.style.boxShadow = '0 8px 16px rgba(99,102,241,0.25)';
        }
        document.getElementById('waBlastTitle').textContent = `Acknowledge Paid Residents`;
        document.getElementById('waBlastSubtitle').textContent = `${waBlastResidents.length} ${translateTerm('flat(s)')} have paid for ${period}`;
    }

    document.getElementById('waBlastMessage').value = defaultMsg;
    document.getElementById('waBlastCount').textContent = waBlastResidents.length;

    // Build resident list cards
    const listEl = document.getElementById('waBlastList');
    if (waBlastResidents.length === 0) {
        listEl.innerHTML = `<div style="text-align:center;padding:30px;font-size:18px;font-weight:800;color:#9A6B45;">No residents found for this filter.</div>`;
    } else {
        listEl.innerHTML = waBlastResidents.map(r => {
            const hasPhone = r.phone && r.phone.length >= 10;
            const waLink = hasPhone
                ? `https://wa.me/91${r.phone.replace(/\D/g, '').slice(-10)}?text=${encodeURIComponent(`Dear ${r.owner}, this is a reminder from ${society} regarding your maintenance dues for ${period}.`)}`
                : '#';
            return `
            <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-radius:16px;background:rgba(248,245,240,0.9);border:1px solid rgba(139,94,60,0.1);">
                <div>
                    <div style="font-size:18px;font-weight:950;color:#2C1A0E;">Flat ${r.flat} — ${r.owner}</div>
                    <div style="font-size:15px;font-weight:700;color:#9A6B45;margin-top:3px;">
                        ${hasPhone ? `📱 ${r.phone}` : '⚠️ No phone on record'} &nbsp;·&nbsp; ₹${Number(r.amount).toLocaleString('en-IN')}
                        ${isPending ? '' : ` &nbsp;·&nbsp; Paid: ${r.paidDate}`}
                    </div>
                </div>
                ${hasPhone
                    ? `<a href="${waLink}" target="_blank" style="background:linear-gradient(135deg,#25D366,#128C7E);color:white;text-decoration:none;padding:10px 18px;border-radius:12px;font-size:15px;font-weight:900;white-space:nowrap;">Send ↗</a>`
                    : `<span style="color:#EF4444;font-size:14px;font-weight:800;">No Phone</span>`
                }
            </div>`;
        }).join('');
    }

    document.getElementById('waBlastModal').classList.remove('hidden');
}

function closeWaBlastModal() {
    document.getElementById('waBlastModal').classList.add('hidden');
    waBlastResidents = [];
}

function sendAllBlastIndividually() {
    const matching = waBlastResidents.filter(r => r.phone && r.phone.replace(/\D/g, '').length >= 10);
    
    if (matching.length === 0) {
        showToast("No residents with valid phone numbers found to notify.", "error");
        return;
    }
    
    const societyName = currentSociety;
    const month = document.getElementById('viewMonth').value;
    const year = document.getElementById('viewYear').value;
    const isPending = waBlastType === 'pending';
    const dueDay = getCalculatedDueDate().split('-').reverse().join('-'); // Format DD-MM-YYYY
    
    showToast(`Sending personalized messages to ${matching.length} residents... Please allow popups if prompted.`, "success");
    
    matching.forEach((flat, index) => {
        const cleanPhone = String(flat.phone).replace(/\D/g, '').slice(-10);
        let message = "";

        if (isPending) {
            message = `*MAINTENANCE REMINDER* 🏢\n\n` +
                      `Society: *${societyName}*\n` +
                      `${translateTerm('Flat')}: *${flat.flat}*\n` +
                      `Resident Name: *${flat.owner}*\n` +
                      `Phone Number: *${flat.phone}*\n` +
                      `Maintenance Amount: *₹${flat.amount}*\n` +
                      `Selected Month & Year: *${month} ${year}*\n` +
                      `Due Date: *${dueDay}*\n\n` +
                      `Dear ${flat.owner}, this is a friendly reminder that your maintenance payment of ₹${flat.amount} for ${month} ${year} is pending. Kindly pay by the due date ${dueDay}. Thank you!`;
        } else {
            message = `*PAYMENT CONFIRMATION / RECEIPT* ✅\n\n` +
                      `Society: *${societyName}*\n` +
                      `${translateTerm('Flat')}: *${flat.flat}*\n` +
                      `Resident Name: *${flat.owner}*\n` +
                      `Phone Number: *${flat.phone}*\n` +
                      `Maintenance Amount: *₹${flat.amount}*\n` +
                      `Selected Month & Year: *${month} ${year}*\n` +
                      `Paid Date: *${flat.paidDate}*\n\n` +
                      `Dear ${flat.owner}, we have received your maintenance payment of ₹${flat.amount} for ${month} ${year} via ${flat.method} on ${flat.paidDate}. Thank you for your payment!`;
        }

        const waUrl = `https://wa.me/91${cleanPhone}?text=${encodeURIComponent(message)}`;

        // Open tabs sequentially with a small delay to prevent browser popup blockers from catching them
        setTimeout(() => {
            window.open(waUrl, '_blank');
        }, index * 1000);
    });
}

function copyWaMessage() {
    const msg = document.getElementById('waBlastMessage').value;
    navigator.clipboard.writeText(msg).then(() => {
        showToast('Message copied! Paste it in your WhatsApp group.', 'success');
    }).catch(() => {
        showToast('Could not copy. Please select and copy manually.');
    });
}

function shareWaSummary() {
    const msg = document.getElementById('waBlastMessage').value;
    if (!msg) return;
    const waLink = `https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}`;
    window.open(waLink, '_blank');
}

function shareWhatsAppDirect(type) {
    const soc = vault[currentSociety];
    if (!soc) return;

    const period = `${document.getElementById('viewMonth').value}-${document.getElementById('viewYear').value}`;
    const isPending = type === 'pending';
    const residents = [];

    Object.entries(soc.apartmentData || {}).forEach(([block, flats]) => {
        Object.entries(flats || {}).forEach(([flatNum, flatData]) => {
            if (!flatData) return;
            const mData = getEffectiveMonthData(flatData, period);
            const displayOwner = mData.owner || flatData.owner || '';
            if (!displayOwner || displayOwner.trim() === "") return;

            const status = mData.status || 'Pending';
            if ((isPending && status !== 'Paid') || (!isPending && status === 'Paid')) {
                residents.push({
                    flat: `${block}-${flatNum}`,
                    owner: displayOwner,
                    amount: mData.amount || 0,
                    paidDate: mData.paidDate || '-'
                });
            }
        });
    });

    if (residents.length === 0) {
        showToast(`No ${type} residents found for this period.`);
        return;
    }

    const society = currentSociety;
    let msg = '';
    if (isPending) {
        const flatList = residents.map(r => `• ${translateTerm('Flat')} ${r.flat} (${r.owner}) — ₹${Number(r.amount).toLocaleString('en-IN')}`).join('\n');
        msg = `🏢 *${society} — Maintenance Reminder* 🏢\n\nDear Residents,\n\nThe following ${translateTerm('flats')} have *pending maintenance* for *${period}*:\n\n${flatList}\n\nKindly clear your dues at the earliest.\n\n_Thank you,\nSociety Management_`;
    } else {
        const flatList = residents.map(r => `✅ ${translateTerm('Flat')} ${r.flat} (${r.owner}) — ₹${Number(r.amount).toLocaleString('en-IN')} on ${r.paidDate}`).join('\n');
        msg = `🏢 *${society} — Payment Acknowledgement* 🏢\n\nDear Residents,\n\nThank you! The following ${translateTerm('flats')} have *cleared maintenance* for *${period}*:\n\n${flatList}\n\n_Thank you for your timely payment!_\n_Society Management_`;
    }

    const waLink = `https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}`;
    window.open(waLink, '_blank');
}

function backToSetup() {
    showSocietyPortal();
    clearLoginForms();
}
function searchFlat() {
    const q = document.getElementById('searchBox').value.toLowerCase();
    document.querySelectorAll('#dashboardTable tr').forEach(r => {
        if (!r.id.startsWith('detail') && !r.id.startsWith('block-header')) {
            r.style.display = r.innerText.toLowerCase().includes(q) ? '' : 'none';
        }
    });
}
function toggleLoginMode() {
    document.getElementById('landingInterface').classList.add('hidden');
    document.getElementById('setupInterface').classList.add('hidden');
    document.getElementById('residentInterface').classList.add('hidden');
    document.getElementById('dashboardInterface').classList.add('hidden');
    document.getElementById('loginInterface').classList.remove('hidden');
    clearLoginForms();
}
function toggleRentalFields() { document.getElementById('rentalInputs').classList.toggle('hidden', document.getElementById('isRental').value === 'No'); }
function closeForm() {
    const form = document.getElementById('adminForm');
    if (form) {
        form.classList.add('hidden');
        document.body.appendChild(form);
    }
    document.querySelectorAll('[id^="detail-"]').forEach(r => r.classList.add('hidden'));
    checkFloatingComplaintVisibility();
}
function toggleResidentLogin() {
    document.body.classList.remove("main-page");
    const resident = document.getElementById('residentInterface');
    const isCurrentlyHidden = resident.classList.contains('hidden');

    if (isCurrentlyHidden) {
        // Opening resident login from Society Portal
        document.getElementById('setupInterface').classList.add('hidden');
        document.getElementById('loginInterface').classList.add('hidden');
        document.getElementById('dashboardInterface').classList.add('hidden');
        resident.classList.remove('hidden');
        clearLoginForms();
        checkFloatingComplaintVisibility();
    } else {
        // Back button — return to Society Portal
        showSocietyPortal();
        clearLoginForms();
    }
}
function updateGlobalDueDay() {
    if (!isAdmin) return;
    const value = document.getElementById('globalDueDate').value;
    if (!value) return showToast("Please select a valid due date.");

    if (!vault[currentSociety].config) vault[currentSociety].config = {};
    const d = new Date(value).getDate();
    vault[currentSociety].config.defaultDueDay = d;

    // Use dedicated endpoint instead of saveVault() to prevent double-hashing admin password
    Api.updateDueDay({
            society_name: currentSociety,
            default_due_day: d,
            property_type: propertyType
        })
    .then(res => res.json())
    .then(data => {
        if (data.success) showToast("Due day updated!", "success");
    })
    .catch(() => showToast("Failed to save due day.", "error"));

    displayFlats();
}
function sendNotice(p, s, n, a, d, block, flat) {
    const phone = String(p || '').replace(/\D/g, '');
    if (!phone) return showToast(translateTerm("Phone number is missing for this flat."));

    const month = document.getElementById('viewMonth').value;
    const year = document.getElementById('viewYear').value;
    const amount = a || 0;

    const period = `${month}-${year}`;
    const flatData = vault[currentSociety]?.apartmentData?.[block]?.[flat] || {};
    const monthData = flatData.months?.[period] || {};

    const planText =
        monthData.plan === "yearly"
            ? "Yearly Maintenance"
            : "Monthly Maintenance";

    let msg = "";

    if (s === 'Paid') {
        msg =
            `Receipt: ${planText} ₹${amount} for ${month} ${year} received from ${n} for ${currentSociety} ${translateTerm('Flat')} ${block}-${flat}.`;

        if (monthData.plan === "yearly") {
            msg += ` Yearly maintenance is paid for ${month} ${year}.`;
        }

    } else {
        msg =
            `Reminder: ${planText} ₹${amount} for ${month} ${year} is pending for ${n || currentSociety} (${currentSociety}  ${block}-${flat}). Due date: ${d}.`;

        if (monthData.plan === "yearly") {
            msg += ` This is yearly maintenance.`;
        }
    }

    if (s === 'Paid') {
        adminSendReceiptPDF(block, flat, period);
    }
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, '_blank');
}
function exportToExcel() {
    const soc = vault[currentSociety];
    const m = document.getElementById('viewMonth').value;
    const y = document.getElementById('viewYear').value;
    const period = `${m}-${y}`;

    if (!soc) return;

    // 1. Maintenance Status Sheet
    let maintenanceData = [];
    Object.keys(soc.apartmentData).forEach(b => {
        let blockConfig = getBlockConfig(soc, b);
        let flatList = getFlatList(blockConfig);

        for (let flatNum of flatList) {
            let f = soc.apartmentData[b][flatNum] || {}, md = (f.months && f.months[period]) || {};
            const displayOwner = (f.months && f.months[period] && f.months[period].owner) || f.owner || '';
            const isOccupied = (displayOwner && displayOwner.trim() !== "");
            
            maintenanceData.push({
                [translateTerm("Flat")]: `${b}-${flatNum}`,
                Owner: displayOwner || '-',
                Status: isOccupied ? (md.status || 'Pending') : '-',
                Amount: isOccupied ? (md.amount || 0) : '-',
                "Payment Method": md.paymentMethod || '-',
                "Paid Date": md.paidDate || '-'
            });
        }
    });

    // 2. Expenses Sheet
    let expenseData = (soc.expenses || []).filter(e => e.period === period).map(e => ({
        Title: e.title,
        Details: e.details,
        Amount: Number(e.amount || 0),
        Date: e.date || '-',
        Year: e.year
    }));

    // 3. Analytics Sheet (Summary for the Year)
    let summaryData = months.map(monthName => {
        const p = `${monthName}-${y}`;
        let col = 0;
        let exp = 0;

        // Calculate collection
        Object.values(soc.apartmentData).forEach(block => {
            Object.values(block).forEach(flat => {
                const md = (flat.months && flat.months[p]) || {};
                if (md.status === "Paid") col += Number(md.amount || 0);
            });
        });

        // Calculate expenses
        (soc.expenses || []).forEach(e => {
            if (e.period === p) exp += Number(e.amount || 0);
        });

        return {
            "Month": monthName,
            "Total Collection (₹)": col,
            "Total Expenses (₹)": exp,
            "Net Balance (₹)": col - exp
        };
    });

    const wb = XLSX.utils.book_new();

    const ws1 = XLSX.utils.json_to_sheet(maintenanceData);
    XLSX.utils.book_append_sheet(wb, ws1, "Maintenance Status");

    const ws2 = XLSX.utils.json_to_sheet(expenseData.length ? expenseData : [{ "Message": "No expenses found for this period" }]);
    XLSX.utils.book_append_sheet(wb, ws2, "Expenditure");

    const ws3 = XLSX.utils.json_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(wb, ws3, "Monthly Analytics");

    XLSX.writeFile(wb, `${currentSociety}_Financial_Report_${period}.xlsx`);
}
// Duplicate deleteComm removed

function deleteSociety(name) {
    delete vault[name];
    // We should ideally have a DELETE /api/society/:name endpoint
    // For now, removing from vault is enough for the session
    location.reload();
}

function updateCommitteeButton() {
    const name = document.getElementById("commName").value.trim();
    const role = document.getElementById("commRole").value.trim();
    const phone = document.getElementById("commPhone").value.trim();
    const btn = document.getElementById("addMemberBtn");

    if (!btn) return;

    if (name && role && phone) {
        btn.style.setProperty("background", "linear-gradient(135deg,#16A34A,#22C55E)", "important");
        btn.style.setProperty("box-shadow", "0 10px 24px rgba(34,197,94,0.35)", "important");
    } else {
        btn.style.setProperty("background", "linear-gradient(135deg,#D97706,#F59E0B)", "important");
        btn.style.setProperty("box-shadow", "0 10px 24px rgba(217,119,6,0.22)", "important");
    }
}


function checkMaintenanceDueAlerts() {

    const soc = vault[currentSociety];

    if (!soc) return;

    const today = new Date();

    const dueDateValue =
        document.getElementById("globalDueDate")?.value;

    if (!dueDateValue) return;

    const dueDate = new Date(dueDateValue);

    const fineDate = new Date(dueDate);

    fineDate.setDate(fineDate.getDate() + 5);

    Object.keys(soc.apartmentData).forEach(block => {

        Object.keys(soc.apartmentData[block]).forEach(flat => {

            const d = soc.apartmentData[block][flat];

            if (!d) return;

            const period =
                `${document.getElementById('viewMonth').value}-${document.getElementById('viewYear').value}`;

            const mData =
                (d.months && d.months[period])
                    ? d.months[period]
                    : null;

            if (!mData) return;

            const displayOwner = mData.owner || d.owner || '';
            if (!displayOwner || displayOwner.trim() === "") return;

            if (mData.status === "Paid") return;

            const phone =
                d.isRental === "Yes"
                    ? d.rentalPhone || d.phone
                    : d.phone;

            if (!phone) return;

            /* AFTER DUE DATE WARNING */

            if (today > dueDate && today <= fineDate) {

                const msg =
                    `Reminder from ${currentSociety}

Dear ${d.owner},

Your maintenance payment for Flat ${block}-${flat} is overdue.

Please complete the payment immediately.

If payment is not completed within 5 days after the due date, a fine of ₹250 will be added automatically.

Thank you.`;

                console.log("SEND WARNING:", phone, msg);

                /*
                   Add WhatsApp API here later
                */
            }

            /* AFTER 5 DAYS FINE */

            if (today > fineDate) {

                // Fine is logged; actual fine amount must be saved via the flat edit form
                // saveVault() is NOT called here to prevent double-hashing the admin password
                const msg =
                    `Important Notice from ${currentSociety}

Dear ${d.owner},

A fine of ₹250 has been added to your maintenance dues for Flat ${block}-${flat} because the payment was not completed within 5 days after the due date.

Please clear your dues immediately.

Thank you.`;

                console.log("FINE ALERT (manual action required):", phone, msg);

                /*
                   Add WhatsApp API here later
                */
            }

        });

    });

}
function markMaintenancePaid(block, flat) {
    const period = `${document.getElementById('viewMonth').value}-${document.getElementById('viewYear').value}`;
    const flatDataObj = vault[currentSociety].apartmentData[block][flat];
    const mData = getEffectiveMonthData(flatDataObj, period);

    const now = new Date();
    const paidDate = `${String(now.getDate()).padStart(2, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${now.getFullYear()}`;

    const updateData = {
        society_name: currentSociety,
        block: block,
        flat_number: flat,
        owner: flatDataObj.owner,
        phone: flatDataObj.phone,
        isRental: flatDataObj.isRental,
        rentalName: flatDataObj.rentalName,
        rentalPhone: flatDataObj.rentalPhone,
        amount: mData.amount,
        period: period,
        status: "Paid",
        plan: mData.plan,
        paymentMethod: mData.paymentMethod || "Cash",
        dateStr: paidDate,
        property_type: propertyType
    };

    Api.saveFlat(updateData)
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                loadDashboardData();
                showToast(`Flat ${block}-${flat} marked as Paid!`, "success");
            }
        });
}
// NOTE: Duplicate mousemove listener removed here.
// The combined handler below (line ~2934) handles both rowTooltip and expenseTooltip.
function updateYearlyAmount() {
    const plan = document.getElementById("paymentPlan").value;
    const amountInput = document.getElementById("maintenanceAmount");

    const currentAmount = Number(amountInput.value) || 0;

    if (plan === "yearly") {
        amountInput.value = currentAmount * 11;
    } else {
        amountInput.value = Math.round(currentAmount / 11);
    }
}
function updateAnalytics() {

    const soc = vault[currentSociety];
    if (!soc || !soc.apartmentData) return;

    const month = document.getElementById('viewMonth').value;
    const year = document.getElementById('viewYear').value;
    const period = `${month}-${year}`;

    let monthlyCollection = 0;
    let pendingAmount = 0;
    let yearlyCollection = 0;
    let overdueCount = 0;

    Object.keys(soc.apartmentData).forEach(block => {

        Object.keys(soc.apartmentData[block]).forEach(flatNo => {

            const flat = soc.apartmentData[block][flatNo];
            if (!flat) return;

            const mData = getEffectiveMonthData(flat, period);
            const displayOwner = mData.owner || flat.owner || '';
            const isOccupied = (displayOwner && displayOwner.trim() !== "");

            if (!isOccupied) return;

            const amount = Number(mData.amount || flat.latestAmount || 0);

            if (mData.status === "Paid" && mData.plan === "monthly") {
                monthlyCollection += amount;
            }

            if (mData.status === "Pending" && mData.plan === "monthly") {
                pendingAmount += amount;
            }

            if (mData.status === "Paid" && mData.plan === "yearly") {
                yearlyCollection += amount;
            }

            const dueDate = new Date(getCalculatedDueDate());
            const today = new Date();

            if (mData.status === "Pending" && today > dueDate) {
                overdueCount++;
            }
        });

    });

    document.getElementById('monthlyCollection').innerText = `₹${monthlyCollection}`;
    document.getElementById('pendingAmount').innerText = `₹${pendingAmount}`;
    document.getElementById('yearlyPaidCount').innerText = `₹${yearlyCollection}`;
    document.getElementById('overdueCount').innerText = overdueCount;
    let monthlyExpenseTotal = 0;

    if (soc.expenses) {
        soc.expenses.forEach(e => {
            if (e.period === period) {
                monthlyExpenseTotal += Number(e.amount || 0);
            }
        });
    }

    const monthlyExpenseBox = document.getElementById("monthlyExpense");
    if (monthlyExpenseBox) {
        monthlyExpenseBox.innerText = `₹${monthlyExpenseTotal}`;
    }
}
function addNotice() {
    const title = document.getElementById("noticeTitle").value.trim();
    const details = document.getElementById("noticeDetails").value.trim();

    if (!title) return showToast("Please enter notice title.");
    if (!details) return showToast("Please enter notice details.");

    const now = new Date();
    const date = `${String(now.getDate()).padStart(2, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${now.getFullYear()}`;

    const noticeData = {
        id: editingNoticeIndex,
        society_name: currentSociety,
        title,
        details,
        date,
        property_type: propertyType
    };

    Api.saveNotice(noticeData)
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                showToast("Notice saved!", "success");
                editingNoticeIndex = null;
                loadDashboardData();
            }
        });

    document.getElementById("noticeTitle").value = "";
    document.getElementById("noticeDetails").value = "";
}
function renderNotices() {
    const soc = vault[currentSociety];
    const fullBox = document.getElementById("noticeList");
    const recentBox = document.getElementById("recentNoticeList");

    if (!soc) return;

    const notices = soc.notices || [];

    if (recentBox) {
        const recent = notices.slice(0, 2);

        recentBox.innerHTML = recent.length
            ? recent.map(n => `
        <div class="notice-card">
            <h3>${n.title}</h3>
            <p>${n.details}</p>
            <small style="font-size:16px;font-weight:900;color:#8B5E3C;">
                ${n.date}
            </small>
        </div>
    `).join("")
            : `<p style="font-size:22px;font-weight:800;color:#7A6855;">No recent notices.</p>`;
    }

    if (!fullBox) return;

    fullBox.innerHTML = notices.length
        ? notices.map((n) => `
    <div class="notice-card">
        <div style="display:flex;justify-content:space-between;gap:16px;align-items:flex-start;">
            <div>
                <h3>${n.title}</h3>
                <p>${n.details}</p>
                <div style="font-size:16px;font-weight:800;color:#8B5E3C;margin-top:10px;">
                    <p>Added: ${n.date}</p>
                    ${n.updated_date ? `<p style="color:#D97706;">Updated: ${n.updated_date}</p>` : ""}
                </div>
            </div>

            ${isAdmin
                ? `
                    <div style="display:flex;gap:10px;">
                        <button onclick="editNotice(${n.id})" style="
                            background:#2563EB;color:white;border:none;
                            border-radius:12px;padding:12px 18px;font-weight:900;
                        ">Edit</button>

                        <button onclick="deleteNotice(${n.id})" style="
                            background:#DC2626;color:white;border:none;
                            border-radius:12px;padding:12px 18px;font-weight:900;
                        ">Delete</button>
                    </div>
                `
                : ""
            }
        </div>
    </div>
`).join("")
        : `<p style="font-size:22px;font-weight:800;color:#7A6855;">No notices added yet.</p>`;
}
function editNotice(id) {
    const notice = vault[currentSociety].notices.find(n => n.id === id);

    document.getElementById("noticeTitle").value = notice.title;
    document.getElementById("noticeDetails").value = notice.details;

    editingNoticeIndex = id;

    window.scrollTo({
        top: 0,
        behavior: "smooth"
    });
}
function deleteNotice(id) {
    if (!isAdmin) return;
    showConfirm("Delete this notice?", "Yes, Delete", true, () => {
        Api.deleteNotice(id)
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    loadDashboardData();
                }
            });
    });
}


function toggleRulesPage() {
    const page = document.getElementById("rulesPage");
    page.classList.toggle("hidden");

    if (!page.classList.contains("hidden")) {
        document.body.classList.remove("main-page");
        document.body.classList.add("rules-open");

        renderRules();

        const form = document.getElementById("adminRulesForm");
        if (form) form.style.display = isAdmin ? "block" : "none";

    } else {
        document.body.classList.remove("rules-open");
        document.body.classList.add("main-page");
    }
    checkFloatingComplaintVisibility()
}


function saveRule() {
    const title = document.getElementById("ruleTitle").value.trim();
    const details = document.getElementById("ruleDetails").value.trim();

    if (!title) return showToast("Please enter rule title.");
    if (!details) return showToast("Please enter rule details.");

    const now = new Date();
    const date = `${String(now.getDate()).padStart(2, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${now.getFullYear()}`;

    const ruleData = {
        id: editingRuleIndex, // This will be the DB ID if editing
        society_name: currentSociety,
        title,
        details,
        date,
        property_type: propertyType
    };

    Api.saveRule(ruleData)
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                showToast("Rule saved!", "success");
                editingRuleIndex = null;
                loadDashboardData();
            }
        });

    document.getElementById("ruleTitle").value = "";
    document.getElementById("ruleDetails").value = "";

    renderRules();
}

function renderRules() {
    const soc = vault[currentSociety];
    const box = document.getElementById("rulesList");

    if (!box || !soc) return;

    const defaultRules = [
        {
            title: "Maintenance Payment",
            details: "All residents must pay monthly maintenance before the due date. If maintenance is not paid within 5 days after the due date, ₹250 fine will be added.",
            date: "Default Rule",
            updatedDate: ""
        },
        {
            title: "Parking Rules",
            details: "Vehicles must be parked only in designated parking areas.",
            date: "Default Rule",
            updatedDate: ""
        },
        {
            title: "Noise Restrictions",
            details: "Loud music and disturbances are prohibited after 10 PM.",
            date: "Default Rule",
            updatedDate: ""
        }
    ];

    if (!soc.rules || soc.rules.length === 0) {
        // If no rules, persist default rules one by one
        defaultRules.forEach(r => {
            Api.saveRule({
                society_name: currentSociety,
                title: r.title,
                details: r.details,
                date: "Default Rule"
            });
        });
        // We don't call loadDashboardData here to avoid loops, 
        // the user will see them on next refresh or we can manually push them
        soc.rules = defaultRules;
    }

    box.innerHTML = soc.rules.map((r, index) => `
<div class="card-bg p-6 rounded-3xl">

    <div style="display:flex;justify-content:space-between;gap:20px;align-items:flex-start;">
        <div>
            <h3 style="font-size:34px;font-weight:900;color:#4A3425;">
                ${index + 1}. ${r.title}
            </h3>

            <p style="font-size:24px;color:#7A6855;margin-top:10px;line-height:1.7;">
                ${r.details}
            </p>

            <div style="font-size:18px;font-weight:900;color:#8B5E3C;margin-top:14px;">
                <p>Added: ${r.date || ""}</p>
                ${r.updated_date ? `<p style="color:#D97706;">Updated: ${r.updated_date}</p>` : ""}
            </div>
        </div>

        ${isAdmin
            ? `
                <div style="display:flex;gap:10px;">
                    <button onclick="editRule(${r.id})" style="
                        background:#2563EB;
                        color:white;
                        border:none;
                        border-radius:12px;
                        padding:12px 18px;
                        font-weight:900;
                    ">
                        Edit
                    </button>

                    <button onclick="deleteRule(${r.id})" style="
                        background:#DC2626;
                        color:white;
                        border:none;
                        border-radius:12px;
                        padding:12px 18px;
                        font-weight:900;
                    ">
                        Delete
                    </button>
                </div>
            `
            : ""
        }
    </div>

</div>
`).join("");
}

function editRule(id) {
    const rule = vault[currentSociety].rules.find(r => r.id === id);

    document.getElementById("ruleTitle").value = rule.title;
    document.getElementById("ruleDetails").value = rule.details;

    editingRuleIndex = id;

    window.scrollTo({ top: 0, behavior: "smooth" });
}

function deleteRule(id) {
    if (!isAdmin) return;
    showConfirm("Delete this rule?", "Yes, Delete", true, () => {
        Api.deleteRule(id)
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    loadDashboardData();
                }
            });
    });
}
function toggleNoticePage() {
    const page = document.getElementById("noticePage");
    page.classList.toggle("hidden");

    if (!page.classList.contains("hidden")) {
        renderNotices();

        const form = document.getElementById("adminNoticeForm");
        if (form) form.style.display = isAdmin ? "block" : "none";
    } checkFloatingComplaintVisibility();
}
// saveVault removed as it is now defined above with SQL support.
function toggleExpensePage() {
    const page = document.getElementById("expensePage");
    page.classList.toggle("hidden");

    if (!page.classList.contains("hidden")) {
        document.body.classList.remove("main-page");
        document.body.classList.add("expenses-open");
        renderExpenses();

        const form = document.getElementById("adminExpenseForm");
        if (form) form.style.display = isAdmin ? "block" : "none";
    } else {
        document.body.classList.remove("expenses-open");
        document.body.classList.add("main-page");
    }
    checkFloatingComplaintVisibility();
}
document.addEventListener("mousemove", (e) => {

    const rowTooltip = document.getElementById("rowHoverTooltip");
    const expenseTooltip = document.getElementById("expenseHoverTooltip");

    const row = e.target.closest(".admin-flat-row");
    const expenseCard = e.target.closest(".expense-hover-trigger");

    if (rowTooltip) {
        if (row && isAdmin) {
            rowTooltip.style.display = "block";
            rowTooltip.style.left = (e.clientX + 18) + "px";
            rowTooltip.style.top = (e.clientY + 18) + "px";
        } else {
            rowTooltip.style.display = "none";
        }
    }

    if (expenseTooltip) {
        if (expenseCard) {
            expenseTooltip.style.display = "block";
            expenseTooltip.style.left = (e.clientX + 18) + "px";
            expenseTooltip.style.top = (e.clientY + 18) + "px";
        } else {
            expenseTooltip.style.display = "none";
        }
    }
});
document.addEventListener("input", function (e) {

    if (
        e.target.id === "phone" ||
        e.target.id === "rentalPhone" ||
        e.target.id === "commPhone"
    ) {

        e.target.value =
            e.target.value.replace(/\D/g, '');

    }

});
function openComplaintPage() {
    const page = document.getElementById("complaintPage");
    if (!page) {
        console.warn("Complaint page not found");
        return;
    }

    if (!currentSociety) {
        const resSocNameInp = document.getElementById("resSocName");
        const resSocName = resSocNameInp ? resSocNameInp.value.trim() : "";
        if (resSocName) {
            currentSociety = resSocName;
            Api.getSociety(currentSociety, propertyType)
                .then(res => res.json())
                .then(data => {
                    vault[currentSociety] = data;
                    proceedOpeningComplaintPage();
                })
                .catch(err => {
                    console.error("Failed to load society data for complaints:", err);
                    showToast("Error loading complaints. Is society name correct?", "error");
                    currentSociety = ""; // reset
                });
            return;
        } else {
            showToast("Please enter Society Name first to access complaints.", "error");
            return;
        }
    }

    proceedOpeningComplaintPage();
}

function proceedOpeningComplaintPage() {
    const page = document.getElementById("complaintPage");
    page.classList.remove("hidden");

    const btn = document.getElementById("floatingComplaintBtn");
    if (btn) btn.style.display = "none";

    const residentData = JSON.parse(localStorage.getItem("residentFlat"));
    const flatInput = document.getElementById("complaintFlat");
    if (flatInput) {
        if (residentData) {
            flatInput.value = `${residentData.block}-${residentData.num}`;
            flatInput.disabled = true;
        } else {
            flatInput.value = "";
            flatInput.disabled = false;
        }
    }

    renderComplaints();
    checkFloatingComplaintVisibility();
}

function toggleComplaintPage() {
    const page = document.getElementById("complaintPage");
    page.classList.toggle("hidden");

    if (!page.classList.contains("hidden")) {
        document.body.classList.remove("main-page");
        document.body.classList.add("complaints-open");
        renderComplaints();

        const form = document.getElementById("adminComplaintForm");
        if (form) form.style.display = isAdmin ? "block" : "none";
    } else {
        document.body.classList.remove("complaints-open");
        document.body.classList.add("main-page");
    }
    checkFloatingComplaintVisibility();
}

function closeComplaintPage() {
    document.getElementById("complaintPage")
        .classList.add("hidden");

    const sessionSoc = localStorage.getItem('activeSociety');
    if (!sessionSoc) {
        currentSociety = "";
    }

    checkFloatingComplaintVisibility();
}


function getLoggedInComplaintFlat() {
    if (isAdmin) return "ADMIN";

    const residentData = JSON.parse(localStorage.getItem("residentFlat"));

    if (!residentData || !residentData.block || !residentData.num) return "";

    return `${residentData.block}-${residentData.num}`.toUpperCase();
}

function saveComplaint() {
    const title = document.getElementById("complaintTitle").value.trim();
    const flat = document.getElementById("complaintFlat").value.trim().toUpperCase();
    const details = document.getElementById("complaintDetails").value.trim();

    if (!title || !flat || !details) {
        showToast("Please fill all complaint fields.");
        return;
    }

    const loggedFlat = getLoggedInComplaintFlat();

    if (!isAdmin && flat !== loggedFlat) {
        showToast(translateTerm("You can only write a complaint for your own flat."));
        return;
    }

    const soc = vault[currentSociety];
    if (!soc.complaints) soc.complaints = [];

    const now = new Date();
    const date = `${String(now.getDate()).padStart(2, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${now.getFullYear()}`;

    const complaintData = {
        id: editingComplaintIndex,
        society_name: currentSociety,
        title,
        flat,
        details,
        date,
        createdBy: isAdmin ? "ADMIN" : loggedFlat,
        property_type: propertyType
    };

    Api.saveComplaint(complaintData)
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                showToast("Complaint saved!", "success");
                editingComplaintIndex = null;
                // Clear form fields after confirmed save
                document.getElementById("complaintTitle").value = "";
                document.getElementById("complaintDetails").value = "";
                if (!isAdmin) {
                    document.getElementById("complaintFlat").value = loggedFlat;
                } else {
                    document.getElementById("complaintFlat").value = "";
                }
                loadDashboardData();
            } else {
                showToast("Error saving complaint. Please try again.", "error");
            }
        })
        .catch(() => showToast("Server error saving complaint.", "error"));

    // Clear form fields after successful API submission (inside .then)
    // renderComplaints() and loadDashboardData() are called inside .then() above
}

function renderComplaints() {
    const soc = vault[currentSociety];
    if (!soc) return; // Guard: society data not loaded yet
    if (!soc.complaints) soc.complaints = [];

    const list = document.getElementById("complaintList");
    const loggedFlat = getLoggedInComplaintFlat();

    list.innerHTML = soc.complaints.map((c) => {
        const ownerAccess = isAdmin || (loggedFlat !== "" && (c.created_by === loggedFlat || c.flat === loggedFlat));

        return `
<div class="notice-card">
    <div class="flex justify-between items-start gap-6">
        <div>
            <h3>${c.title}</h3>

            <p style="margin-top:8px;">
                ${translateTerm('Flat')}: <b>${c.flat}</b>
            </p>

            <p style="margin-top:8px;">
                ${c.details}
            </p>

            <div style="font-size:16px;font-weight:800;margin-top:8px;color:#8B5E3C;">
                <p>Added: ${c.date}</p>
                ${c.updated_date ? `<p style="color:#D97706;">Updated: ${c.updated_date}</p>` : ""}
            </div>
        </div>

        ${ownerAccess ? `
        <div class="flex gap-3">
            <button onclick="editComplaint(${c.id})" style="
                background:#2563EB;
                color:white;
                border:none;
                border-radius:12px;
                padding:12px 18px;
                font-weight:900;
            ">
                Edit
            </button>

            <button onclick="deleteComplaint(${c.id})" style="
                background:#DC2626;
                color:white;
                border:none;
                border-radius:12px;
                padding:12px 18px;
                font-weight:900;
            ">
                Delete
            </button>
        </div>
        ` : ""}
    </div>
</div>
`;
    }).join('');

    if (document.getElementById("totalComplaints")) {
        document.getElementById("totalComplaints").innerText =
            soc.complaints.length;
    }
}

function editComplaint(id) {
    const c = vault[currentSociety].complaints.find(comp => comp.id === id);
    const loggedFlat = getLoggedInComplaintFlat();

    if (!isAdmin && (loggedFlat === "" || (c.created_by !== loggedFlat && c.flat !== loggedFlat))) {
        showToast(translateTerm("You can only edit your own complaint."));
        return;
    }

    document.getElementById("complaintTitle").value = c.title;
    document.getElementById("complaintFlat").value = c.flat;
    document.getElementById("complaintDetails").value = c.details;

    editingComplaintIndex = id;
}

function deleteComplaint(id) {
    const c = vault[currentSociety].complaints.find(comp => comp.id === id);
    const loggedFlat = getLoggedInComplaintFlat();

    if (!isAdmin && (loggedFlat === "" || (c.created_by !== loggedFlat && c.flat !== loggedFlat))) {
        showToast(translateTerm("You can only delete your own complaint."));
        return;
    }

    showConfirm("Delete this complaint?", "Yes, Delete", true, () => {
        Api.deleteComplaint(id)
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    loadDashboardData();
                }
            });
    });
}
function checkFloatingComplaintVisibility() {

    const btn = document.getElementById("floatingComplaintBtn");
    if (!btn) return;

    const dashboardVisible =
        !document.getElementById("dashboardInterface")?.classList.contains("hidden");

    const residentLoginVisible =
        !document.getElementById("residentInterface")?.classList.contains("hidden");

    const anyPageOpen =
        !document.getElementById("complaintPage")?.classList.contains("hidden") ||
        !document.getElementById("noticePage")?.classList.contains("hidden") ||
        !document.getElementById("expensePage")?.classList.contains("hidden") ||
        document.getElementById("rulesPage") &&
        !document.getElementById("rulesPage").classList.contains("hidden") ||
        !document.getElementById("committeeModal")?.classList.contains("hidden") ||
        !document.getElementById("bankModal")?.classList.contains("hidden") ||
        !document.getElementById("adminForm")?.classList.contains("hidden");

    const landingVisible =
        !document.getElementById('landingInterface')?.classList.contains('hidden');

    if (dashboardVisible && !landingVisible && !anyPageOpen) {
        btn.style.setProperty("display", "flex", "important");
    } else {
        btn.style.setProperty("display", "none", "important");
    }
}
// ===== RESIDENT FORGOT PASSWORD MODAL =====
function forgotResidentPassword() {
    // Reset the modal state
    rfGoBack(1);
    document.getElementById('rfSociety').value = '';
    document.getElementById('rfFlat').value = '';
    document.getElementById('rfPhone').value = '';
    document.getElementById('rfOtp').value = '';
    document.getElementById('rfNewPass').value = '';
    document.getElementById('rfConfirmPass').value = '';
    rfHideAllErrors();
    document.getElementById('residentForgotModal').classList.remove('hidden');
}

function closeResidentForgotModal() {
    document.getElementById('residentForgotModal').classList.add('hidden');
}

function rfHideAllErrors() {
    ['rfSocietyErr', 'rfFlatErr', 'rfPhoneErr', 'rfStep1GeneralErr', 'rfOtpErr', 'rfNewPassErr', 'rfConfirmPassErr'].forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.style.display = 'none'; el.textContent = ''; }
    });
}

function rfShowErr(id, msg) {
    const el = document.getElementById(id);
    if (el) { el.textContent = msg; el.style.display = 'block'; }
}

function rfHideErr(id) {
    const el = document.getElementById(id);
    if (el) { el.style.display = 'none'; el.textContent = ''; }
}

function rfGoToStep(step) {
    ['rfStep1', 'rfStep2', 'rfStep3'].forEach((id, i) => {
        document.getElementById(id).classList.toggle('hidden', i + 1 !== step);
    });
    const dots = ['rfStep1Dot', 'rfStep2Dot', 'rfStep3Dot'];
    dots.forEach((id, i) => {
        const dot = document.getElementById(id);
        if (i + 1 === step) {
            dot.style.width = '14px'; dot.style.height = '14px'; dot.style.background = '#8B5E3C';
        } else {
            dot.style.width = '8px'; dot.style.height = '8px'; dot.style.background = '#D2B48C';
        }
    });
    const labels = ['Step 1: Verify your identity', 'Step 2: Enter OTP', 'Step 3: Set new password'];
    document.getElementById('rfStepLabel').textContent = labels[step - 1];
}

function rfGoBack(step) {
    rfGoToStep(step);
    rfHideAllErrors();
}

function rfSendOtp() {
    rfHideAllErrors();
    const society = document.getElementById('rfSociety').value.trim();
    const flat = document.getElementById('rfFlat').value.trim();
    const phone = document.getElementById('rfPhone').value.trim();

    let valid = true;
    if (!society) { rfShowErr('rfSocietyErr', 'Society name is required.'); valid = false; }
    if (!flat) { rfShowErr('rfFlatErr', translateTerm('Flat number is required.')); valid = false; }
    if (!phone || phone.length < 10) { rfShowErr('rfPhoneErr', 'Enter a valid 10-digit phone number.'); valid = false; }
    if (!valid) return;

    const btn = document.getElementById('rfSendOtpBtn');
    btn.textContent = 'Sending...';
    btn.disabled = true;

    Api.requestResidentOtp({ society, flat, phone, property_type: propertyType })
        .then(res => res.json())
        .then(data => {
            btn.textContent = 'Send OTP';
            btn.disabled = false;
            if (data.success) {
                if (data.simulated) {
                    showToast(data.message, 'info');
                    // Alert the user with the code for easy testing
                    setTimeout(() => {
                        alert(`SIMULATED OTP: ${data.debugOtp}\n(Twilio limit reached for today)`);
                    }, 500);
                } else {
                    showToast("OTP sent successfully to your registered number.", 'success');
                }
                rfGoToStep(2);
            } else {
                rfShowErr('rfStep1GeneralErr', data.message || 'Verification failed. Please check your details.');
            }
        })
        .catch(() => {
            btn.textContent = 'Send OTP';
            btn.disabled = false;
            rfShowErr('rfStep1GeneralErr', 'Server error. Please try again.');
        });
}

function rfVerifyOtp() {
    rfHideErr('rfOtpErr');
    const otp = document.getElementById('rfOtp').value.trim();
    if (!otp || otp.length !== 6) {
        rfShowErr('rfOtpErr', 'Please enter the complete 6-digit OTP.');
        return;
    }

    const society = document.getElementById('rfSociety').value.trim();
    const flat = document.getElementById('rfFlat').value.trim();
    const phone = document.getElementById('rfPhone').value.trim();

    // We verify OTP along with a dummy password first — we'll do the actual reset in step 3
    // Store OTP in memory and move to step 3 (real verification happens on submit)
    window._rfOtpVerified = { society, flat, phone, otp };
    rfGoToStep(3);
}

function rfResetPassword() {
    rfHideErr('rfNewUsernameErr');
    rfHideErr('rfNewPassErr');
    rfHideErr('rfConfirmPassErr');
    const newUsername = document.getElementById('rfNewUsername').value.trim(); // Optional
    const newPass = document.getElementById('rfNewPass').value;
    const confirmPass = document.getElementById('rfConfirmPass').value;

    let valid = true;
    if (!newPass || newPass.length < 4) { rfShowErr('rfNewPassErr', 'Password must be at least 4 characters.'); valid = false; }
    if (newPass !== confirmPass) { rfShowErr('rfConfirmPassErr', 'Passwords do not match.'); valid = false; }
    if (!valid) return;

    const { society, flat, phone, otp } = window._rfOtpVerified;

    Api.verifyResidentOtp({ society, flat, phone, otp, newUsername: newUsername, newPassword: newPass, property_type: propertyType })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                closeResidentForgotModal();
                // Show a brief success message on the resident login screen
                const info = document.createElement('p');
                info.textContent = '✅ Password reset successfully! Please login.';
                info.style.cssText = 'color:#15803d;font-size:20px;font-weight:700;text-align:center;margin-top:12px;';
                info.id = 'rfSuccessMsg';
                const existing = document.getElementById('rfSuccessMsg');
                if (existing) existing.remove();
                const resInterface = document.querySelector('#residentInterface .space-y-6');
                if (resInterface) resInterface.appendChild(info);
                setTimeout(() => { const m = document.getElementById('rfSuccessMsg'); if (m) m.remove(); }, 4000);
            } else {
                if (data.message && data.message.includes('Username')) {
                    rfShowErr('rfNewUsernameErr', data.message);
                } else {
                    // OTP was wrong — go back to OTP step
                    rfGoToStep(2);
                    rfShowErr('rfOtpErr', data.message || 'Invalid OTP. Please try again.');
                }
            }
        })
        .catch(() => {
            rfShowErr('rfNewPassErr', 'Server error. Please try again.');
        });
}

// ===== ADMIN FORGOT PASSWORD MODAL =====
function forgotAdminPassword() {
    ['afUsername', 'afChairmanPhone', 'afOtp', 'afNewUsername', 'afNewPass', 'afConfirmPass'].forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.value = ''; el.disabled = false; }
    });
    ['afUsernameErr', 'afChairmanPhoneErr', 'afOtpErr', 'afNewUsernameErr', 'afNewPassErr', 'afConfirmPassErr', 'afGeneralErr'].forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.style.display = 'none'; el.textContent = ''; }
    });
    const genErr = document.getElementById('afGeneralErr');
    if (genErr) genErr.style.color = '#DC2626';
    document.getElementById('afSuccess').style.display = 'none';
    document.getElementById('afOtpSection').style.display = 'none';
    document.getElementById('afNewCredentialsSection').style.display = 'none';
    document.getElementById('afVerifyBtn').style.display = 'block';
    const otpBtn = document.getElementById('afConfirmOtpBtn');
    if (otpBtn) { otpBtn.style.display = 'block'; otpBtn.textContent = 'Confirm Code'; }
    document.getElementById('adminForgotModal').classList.remove('hidden');
}

function afVerifyIdentity() {
    ['afUsernameErr', 'afChairmanPhoneErr', 'afGeneralErr'].forEach(id => afHideErr(id));
    
    const username = document.getElementById('afUsername').value.trim();
    const chairmanPhone = document.getElementById('afChairmanPhone').value.trim();
    
    let valid = true;
    if (!username) { afShowErr('afUsernameErr', 'enter username'); valid = false; }
    if (!chairmanPhone || chairmanPhone.length !== 10) { afShowErr('afChairmanPhoneErr', 'enter valid 10-digit phone'); valid = false; }
    if (!valid) return;

    const btn = document.getElementById('afVerifyBtn');
    btn.textContent = 'Sending OTP...';
    btn.disabled = true;

    Api.adminVerifyIdentity({ username, chairmanPhone })
    .then(res => res.json())
    .then(data => {
        btn.textContent = 'Verify Identity & Send OTP';
        btn.disabled = false;
        if (data.success) {
            document.getElementById('afUsername').disabled = true;
            document.getElementById('afChairmanPhone').disabled = true;
            btn.style.display = 'none';
            document.getElementById('afOtpSection').style.display = 'block';
            if (data.simulated) {
                afShowErr('afGeneralErr', data.message + " OTP is: " + data.debugOtp);
                document.getElementById('afGeneralErr').style.color = '#10B981'; // Green success
            } else {
                afShowErr('afGeneralErr', data.message); // Not an error, just a message
                document.getElementById('afGeneralErr').style.color = '#10B981'; // Green success message
            }
        } else {
            afShowErr('afUsernameErr', data.message || "Username or Phone not matched");
            afShowErr('afChairmanPhoneErr', data.message || "Username or Phone not matched");
        }
    })
    .catch(() => {
        btn.textContent = 'Verify Identity & Send OTP';
        btn.disabled = false;
        afShowErr('afUsernameErr', 'Server error. Please try again.');
    });
}

function closeAdminForgotModal() {
    document.getElementById('adminForgotModal').classList.add('hidden');
}

function afVerifyOtp() {
    ['afOtpErr', 'afGeneralErr'].forEach(id => afHideErr(id));
    
    const username = document.getElementById('afUsername').value.trim();
    const chairmanPhone = document.getElementById('afChairmanPhone').value.trim();
    const otp = document.getElementById('afOtp').value.trim();
    
    if (!otp || otp.length !== 6) {
        afShowErr('afOtpErr', 'enter 6-digit OTP');
        return;
    }

    const btn = document.getElementById('afConfirmOtpBtn');
    btn.textContent = 'Verifying...';
    btn.disabled = true;

    Api.adminVerifyOtp({ username, chairmanPhone, otp })
    .then(res => res.json())
    .then(data => {
        btn.textContent = 'Confirm Code';
        btn.disabled = false;
        if (data.success) {
            document.getElementById('afOtp').disabled = true;
            btn.style.display = 'none';
            document.getElementById('afNewCredentialsSection').style.display = 'block';
        } else {
            afShowErr('afOtpErr', data.message || "Invalid OTP");
        }
    })
    .catch(() => {
        btn.textContent = 'Confirm Code';
        btn.disabled = false;
        afShowErr('afOtpErr', 'Server error. Please try again.');
    });
}

function afShowErr(id, msg) {
    const el = document.getElementById(id);
    if (el) { el.textContent = msg; el.style.display = 'block'; }
}

function afHideErr(id) {
    const el = document.getElementById(id);
    if (el) { el.style.display = 'none'; el.textContent = ''; }
}

function afResetPassword() {
    ['afUsernameErr', 'afChairmanPhoneErr', 'afOtpErr', 'afNewUsernameErr', 'afNewPassErr', 'afConfirmPassErr', 'afGeneralErr'].forEach(id => afHideErr(id));
    document.getElementById('afGeneralErr').style.color = '#DC2626'; // Reset to red
    document.getElementById('afSuccess').style.display = 'none';

    const username = document.getElementById('afUsername').value.trim();
    const chairmanPhone = document.getElementById('afChairmanPhone').value.trim();
    const otp = document.getElementById('afOtp').value.trim();
    const newUsername = document.getElementById('afNewUsername').value.trim(); // optional
    const newPass = document.getElementById('afNewPass').value;
    const confirmPass = document.getElementById('afConfirmPass').value;

    let valid = true;
    if (!otp || otp.length !== 6) { afShowErr('afOtpErr', 'enter 6-digit OTP'); valid = false; }
    if (!newPass || newPass.length < 4) { afShowErr('afNewPassErr', 'Password must be at least 4 characters.'); valid = false; }
    if (newPass !== confirmPass) { afShowErr('afConfirmPassErr', 'Passwords do not match.'); valid = false; }
    if (!valid) return;

    Api.adminResetPassword({ username, chairmanPhone, otp, newUsername: newUsername || username, newPassword: newPass })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                document.getElementById('afSuccess').style.display = 'block';
                setTimeout(() => closeAdminForgotModal(), 2500);
            } else {
                if (data.message && data.message.toLowerCase().includes('otp')) {
                    afShowErr('afOtpErr', data.message);
                } else {
                    afShowErr('afGeneralErr', data.message);
                }
            }
        })
        .catch(() => {
            afShowErr('afGeneralErr', 'Server error. Please try again.');
        });
}
// Removed redundant init() call that was causing duplicate dropdown population

setTimeout(() => {
    checkMaintenanceDueAlerts();
}, 500);

function numberToWords(num) {
    const a = ['', 'One ', 'Two ', 'Three ', 'Four ', 'Five ', 'Six ', 'Seven ', 'Eight ', 'Nine ', 'Ten ', 'Eleven ', 'Twelve ', 'Thirteen ', 'Fourteen ', 'Fifteen ', 'Sixteen ', 'Seventeen ', 'Eighteen ', 'Nineteen '];
    const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
    if ((num = num.toString()).length > 9) return 'overflow';
    let n = ('000000000' + num).substr(-9).match(/^(\d{2})(\d{2})(\d{2})(\d{1})(\d{2})$/);
    if (!n) return '';
    let str = '';
    str += (n[1] != 0) ? (a[Number(n[1])] || b[n[1][0]] + ' ' + a[n[1][1]]) + 'Crore ' : '';
    str += (n[2] != 0) ? (a[Number(n[2])] || b[n[2][0]] + ' ' + a[n[2][1]]) + 'Lakh ' : '';
    str += (n[3] != 0) ? (a[Number(n[3])] || b[n[3][0]] + ' ' + a[n[3][1]]) + 'Thousand ' : '';
    str += (n[4] != 0) ? (a[Number(n[4])] || b[n[4][0]] + ' ' + a[n[4][1]]) + 'Hundred ' : '';
    str += (n[5] != 0) ? ((str != '') ? 'and ' : '') + (a[Number(n[5])] || b[n[5][0]] + ' ' + a[n[5][1]]) : '';
    return str.trim() + ' Only';
}

async function downloadReceipt(period) {
    const soc = vault[currentSociety];
    const d = soc.apartmentData[loggedInFlat.block][loggedInFlat.num];
    const mData = getEffectiveMonthData(d, period);
    if (!mData || mData.status !== 'Paid') return showToast("Receipt only available for paid months.");

    // Prepare data
    const rData = {
        societyName: currentSociety.toUpperCase(),
        residentName: mData.owner || d.owner || 'Resident',
        flatNo: `${loggedInFlat.block}-${loggedInFlat.num}`,
        phoneNo: d.phone || '-',
        blockName: `${loggedInFlat.block} Wing`,
        paymentDate: mData.paidDate || '-',
        paymentMode: mData.paymentMethod || 'UPI',
        period: (mData.plan === 'yearly' && mData.startPeriod) ? mData.startPeriod : period,
        amount: Number(mData.amount || 0),
        bank: soc.bank || {},
        receiptId: `RCPT-${currentSociety.substring(0, 3).toUpperCase()}-${new Date().getFullYear()}-${loggedInFlat.block}${loggedInFlat.num}-${Math.floor(1000 + Math.random() * 9000)}`,
        plan: mData.plan || 'monthly'
    };

    // Generate Verification Code (Simple Hash)
    const hashInput = `${rData.societyName}${rData.flatNo}${rData.amount}${rData.paymentDate}${rData.receiptId}`;
    const encoder = new TextEncoder();
    const data = encoder.encode(hashInput);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, "0")).join("").toUpperCase();
    const vCode = `${hashHex.slice(0, 4)}-${hashHex.slice(4, 8)}-${hashHex.slice(8, 12)}`;

    const receiptHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Receipt - ${rData.flatNo}</title>
<style>
*{ margin:0; padding:0; box-sizing:border-box; font-family:'Segoe UI',sans-serif; }
body{ background:#f3f4f6; padding:40px; }
.receipt-container{ max-width:950px; margin:auto; background:white; border-radius:18px; overflow:hidden; box-shadow:0 10px 35px rgba(0,0,0,0.15); border:1px solid #e5e7eb; position:relative; }
.watermark{ position:absolute; inset:0; display:flex; align-items:center; justify-content:center; font-size:54px; font-weight:900; color:rgba(91,60,29,0.06); transform:rotate(-28deg); pointer-events:none; text-align:center; z-index:0; }
.receipt-header{ background:linear-gradient(135deg,#5b3c1d,#8b5e3c); color:white; padding:30px 40px; display:flex; justify-content:space-between; align-items:center; position:relative; z-index:1; }
.society-details h1{ font-size:32px; letter-spacing:1px; }
.society-details p{ margin-top:6px; font-size:15px; opacity:.9; }
.receipt-badge{ background:white; color:#5b3c1d; padding:12px 24px; border-radius:12px; font-size:18px; font-weight:800; }
.receipt-body{ padding:40px; position:relative; z-index:1; }
.security-strip{ background:#fff7ed; border:1px dashed #8b5e3c; padding:14px 18px; border-radius:12px; margin-bottom:25px; color:#5b3c1d; font-weight:700; text-align:center; }
.top-grid{ display:grid; grid-template-columns:1fr 1fr; gap:25px; margin-bottom:30px; }
.info-card{ background:#f9fafb; border:1px solid #e5e7eb; border-radius:14px; padding:22px; }
.info-card h3{ color:#5b3c1d; margin-bottom:18px; font-size:20px; border-bottom:2px solid #d6b08c; padding-bottom:8px; }
.info-row{ display:flex; justify-content:space-between; gap:20px; margin-bottom:14px; font-size:15px; }
.info-row span:first-child{ color:#6b7280; font-weight:600; }
.info-row span:last-child{ color:#111827; font-weight:800; text-align:right; }
.status-paid{ color:green !important; }
table{ width:100%; border-collapse:collapse; margin-top:10px; border-radius:12px; overflow:hidden; }
thead{ background:#5b3c1d; color:white; }
th,td{ padding:16px; text-align:left; font-size:15px; }
td{ border-bottom:1px solid #e5e7eb; }
tbody tr:nth-child(even){ background:#fafafa; }
.total-section{ margin-top:25px; display:flex; justify-content:flex-end; }
.total-box{ width:330px; background:#5b3c1d; color:white; padding:25px; border-radius:16px; }
.total-row{ display:flex; justify-content:space-between; margin-bottom:12px; font-size:16px; }
.grand-total{ border-top:1px solid rgba(255,255,255,.3); padding-top:14px; margin-top:14px; font-size:24px; font-weight:800; }
.verification-section{ margin-top:35px; display:grid; grid-template-columns:1fr; gap:25px; align-items:stretch; }
.seal{ width:150px; height:150px; border:5px double #5b3c1d; border-radius:50%; display:flex; flex-direction:column; align-items:center; justify-content:center; color:#5b3c1d; font-weight:900; text-align:center; margin:20px auto 0; transform:rotate(-8deg); }
.seal span{ font-size:14px; }
.seal strong{ font-size:20px; }
.signature-box{ margin-top:50px; display:grid; grid-template-columns:1fr 1fr; gap:40px; }
.sign{ text-align:center; padding-top:50px; border-top:2px dashed #9ca3af; font-weight:700; color:#374151; }
.footer{ background:#f9fafb; padding:20px 40px; text-align:center; color:#6b7280; font-size:14px; border-top:1px solid #e5e7eb; position:relative; z-index:1; }
@media print { body { background:white; padding:0; } .receipt-container { box-shadow:none; border:none; } }
</style>
</head>
<body>
<div class="receipt-container">
    <div class="watermark">${rData.societyName} • VERIFIED RECEIPT</div>
    <div class="receipt-header">
        <div class="society-details">
            <h1>${rData.societyName}</h1>
            <p>Verified Maintenance Payment Receipt</p>
        </div>
        <div class="receipt-badge">VERIFIED RECEIPT</div>
    </div>
    <div class="receipt-body">
        <div class="security-strip">
            Secure Receipt ID: ${rData.receiptId} |
            Verification Code: ${vCode}
        </div>
        <div class="top-grid">
            <div class="info-card">
                <h3>Resident Details</h3>
                <div class="info-row"><span>Resident Name</span><span>${rData.residentName}</span></div>
                <div class="info-row"><span>${translateTerm('Flat Number')}</span><span>${rData.flatNo}</span></div>
                <div class="info-row"><span>Phone Number</span><span>${rData.phoneNo}</span></div>
                <div class="info-row"><span>Block</span><span>${rData.blockName}</span></div>
            </div>
            <div class="info-card">
                <h3>Receipt Details</h3>
                <div class="info-row"><span>Receipt No.</span><span>${rData.receiptId}</span></div>
                <div class="info-row"><span>Payment Date</span><span>${rData.paymentDate}</span></div>
                <div class="info-row"><span>Payment Mode</span><span>${rData.paymentMode}</span></div>
                <div class="info-row"><span>Status</span><span class="status-paid">PAID</span></div>
            </div>
        </div>
        <table>
            <thead><tr><th>Description</th><th>Period</th><th>Amount</th></tr></thead>
            <tbody>
                <tr><td>${rData.plan === 'yearly' ? 'Yearly Maintenance' : 'Monthly Maintenance'}</td><td>${rData.plan === 'yearly' ? rData.period.split('-')[0] + ' ' + rData.period.split('-')[1] + '-' + (parseInt(rData.period.split('-')[1]) + 1).toString().slice(2) : rData.period}</td><td>₹ ${rData.amount.toLocaleString('en-IN')}</td></tr>
            </tbody>
        </table>
        <div class="total-section">
            <div class="total-box">
                <div class="total-row"><span>Subtotal</span><span>₹ ${rData.amount.toLocaleString('en-IN')}</span></div>
                <div class="total-row"><span>Tax</span><span>₹ 0</span></div>
                <div class="total-row grand-total"><span>Total</span><span>₹ ${rData.amount.toLocaleString('en-IN')}</span></div>
            </div>
        </div>
        <div class="verification-section">
            <div class="info-card" style="display:flex; flex-direction:column; justify-content:space-between;">
                <div>
                    <h3 style="margin-bottom:10px;">Payment Terms & Notes</h3>
                    <ul style="font-size:13px; color:#4b5563; padding-left:18px; line-height:1.6; list-style-type: square;">
                        <li>This is a digitally generated receipt; no physical signature is required.</li>
                        <li>Total Amount in Words: <strong>${numberToWords(rData.amount)}</strong></li>
                        <li>Payments made are subject to realization of funds in the society account.</li>
                        <li>For any queries regarding this receipt, please contact the society administrator.</li>
                    </ul>
                </div>
                <div style="margin-top:15px; display:flex; align-items:center; gap:20px;">
                    <div class="seal" style="width:110px; height:110px; margin:0; border-width:4px;">
                        <span style="font-size:11px;">PAID</span>
                        <strong style="font-size:16px;">VERIFIED</strong>
                        <span style="font-size:9px;">OFFICIAL</span>
                    </div>
                    <div style="font-size:12px; color:#6b7280; font-style:italic;">
                        Verification Date: ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </div>
                </div>
            </div>
        </div>
        <div class="signature-box"><div class="sign">Resident Signature</div><div class="sign">Treasurer / Admin Signature</div></div>
    </div>
    <div class="footer">© ${new Date().getFullYear()} ${rData.societyName} Management System • Verified Digital Receipt</div>
</div>
<script>
    window.onload = () => { setTimeout(() => window.print(), 800); };
</script>
</body>
</html>
`;

    const win = window.open('', '_blank');
    win.document.write(receiptHtml);
    win.document.close();
}

async function getReceiptHTML(rData, vCode) {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Receipt - ${rData.flatNo}</title>
<style>
*{ margin:0; padding:0; box-sizing:border-box; font-family:'Segoe UI',sans-serif; }
body{ background:white; padding:40px; }
.receipt-container{ max-width:950px; margin:auto; background:white; border:1px solid #e5e7eb; position:relative; }
.watermark{ position:absolute; inset:0; display:flex; align-items:center; justify-content:center; font-size:54px; font-weight:900; color:rgba(91,60,29,0.06); transform:rotate(-28deg); pointer-events:none; text-align:center; z-index:0; }
.receipt-header{ background:linear-gradient(135deg,#5b3c1d,#8b5e3c); color:white; padding:30px 40px; display:flex; justify-content:space-between; align-items:center; position:relative; z-index:1; }
.society-details h1{ font-size:32px; letter-spacing:1px; }
.society-details p{ margin-top:6px; font-size:15px; opacity:.9; }
.receipt-badge{ background:white; color:#5b3c1d; padding:12px 24px; border-radius:12px; font-size:18px; font-weight:800; }
.receipt-body{ padding:40px; position:relative; z-index:1; }
.security-strip{ background:#fff7ed; border:1px dashed #8b5e3c; padding:14px 18px; border-radius:12px; margin-bottom:25px; color:#5b3c1d; font-weight:700; text-align:center; }
.top-grid{ display:grid; grid-template-columns:1fr 1fr; gap:25px; margin-bottom:30px; }
.info-card{ background:#f9fafb; border:1px solid #e5e7eb; border-radius:14px; padding:22px; }
.info-card h3{ color:#5b3c1d; margin-bottom:18px; font-size:20px; border-bottom:2px solid #d6b08c; padding-bottom:8px; }
.info-row{ display:flex; justify-content:space-between; gap:20px; margin-bottom:14px; font-size:15px; }
.info-row span:first-child{ color:#6b7280; font-weight:600; }
.info-row span:last-child{ color:#111827; font-weight:800; text-align:right; }
.status-paid{ color:green !important; }
table{ width:100%; border-collapse:collapse; margin-top:10px; border-radius:12px; overflow:hidden; }
thead{ background:#5b3c1d; color:white; }
th,td{ padding:16px; text-align:left; font-size:15px; }
td{ border-bottom:1px solid #e5e7eb; }
tbody tr:nth-child(even){ background:#fafafa; }
.total-section{ margin-top:25px; display:flex; justify-content:flex-end; }
.total-box{ width:330px; background:#5b3c1d; color:white; padding:25px; border-radius:16px; }
.total-row{ display:flex; justify-content:space-between; margin-bottom:12px; font-size:16px; }
.grand-total{ border-top:1px solid rgba(255,255,255,.3); padding-top:14px; margin-top:14px; font-size:24px; font-weight:800; }
.verification-section{ margin-top:35px; display:grid; grid-template-columns:1fr; gap:25px; align-items:stretch; }
.seal{ width:150px; height:150px; border:5px double #5b3c1d; border-radius:50%; display:flex; flex-direction:column; align-items:center; justify-content:center; color:#5b3c1d; font-weight:900; text-align:center; margin:20px auto 0; transform:rotate(-8deg); }
.seal span{ font-size:14px; }
.seal strong{ font-size:20px; }
.signature-box{ margin-top:50px; display:grid; grid-template-columns:1fr 1fr; gap:40px; }
.sign{ text-align:center; padding-top:50px; border-top:2px dashed #9ca3af; font-weight:700; color:#374151; }
.footer{ background:#f9fafb; padding:20px 40px; text-align:center; color:#6b7280; font-size:14px; border-top:1px solid #e5e7eb; position:relative; z-index:1; }
</style>
</head>
<body>
<div id="receipt-content" class="receipt-container">
    <div class="watermark">${rData.societyName} • VERIFIED RECEIPT</div>
    <div class="receipt-header">
        <div class="society-details">
            <h1>${rData.societyName}</h1>
            <p>Verified Maintenance Payment Receipt</p>
        </div>
        <div class="receipt-badge">VERIFIED RECEIPT</div>
    </div>
    <div class="receipt-body">
        <div class="security-strip">
            Secure Receipt ID: ${rData.receiptId} |
            Verification Code: ${vCode}
        </div>
        <div class="top-grid">
            <div class="info-card">
                <h3>Resident Details</h3>
                <div class="info-row"><span>Resident Name</span><span>${rData.residentName}</span></div>
                <div class="info-row"><span>${translateTerm('Flat Number')}</span><span>${rData.flatNo}</span></div>
                <div class="info-row"><span>Phone Number</span><span>${rData.phoneNo}</span></div>
                <div class="info-row"><span>Block</span><span>${rData.blockName}</span></div>
            </div>
            <div class="info-card">
                <h3>Receipt Details</h3>
                <div class="info-row"><span>Receipt No.</span><span>${rData.receiptId}</span></div>
                <div class="info-row"><span>Payment Date</span><span>${rData.paymentDate}</span></div>
                <div class="info-row"><span>Payment Mode</span><span>${rData.paymentMode}</span></div>
                <div class="info-row"><span>Status</span><span class="status-paid">PAID</span></div>
            </div>
        </div>
        <table>
            <thead><tr><th>Description</th><th>Period</th><th>Amount</th></tr></thead>
            <tbody>
                <tr><td>${rData.plan === 'yearly' ? 'Yearly Maintenance' : 'Monthly Maintenance'}</td><td>${rData.plan === 'yearly' ? rData.period.split('-')[0] + ' ' + rData.period.split('-')[1] + '-' + (parseInt(rData.period.split('-')[1]) + 1).toString().slice(2) : rData.period}</td><td>₹ ${rData.amount.toLocaleString('en-IN')}</td></tr>
            </tbody>
        </table>
        <div class="total-section">
            <div class="total-box">
                <div class="total-row"><span>Subtotal</span><span>₹ ${rData.amount.toLocaleString('en-IN')}</span></div>
                <div class="total-row"><span>Tax</span><span>₹ 0</span></div>
                <div class="total-row grand-total"><span>Total</span><span>₹ ${rData.amount.toLocaleString('en-IN')}</span></div>
            </div>
        </div>
        <div class="verification-section">
            <div class="info-card" style="display:flex; flex-direction:column; justify-content:space-between;">
                <div>
                    <h3 style="margin-bottom:10px;">Payment Terms & Notes</h3>
                    <ul style="font-size:13px; color:#4b5563; padding-left:18px; line-height:1.6; list-style-type: square;">
                        <li>This is a digitally generated receipt; no physical signature is required.</li>
                        <li>Total Amount in Words: <strong>${numberToWords(rData.amount)}</strong></li>
                        <li>Payments made are subject to realization of funds in the society account.</li>
                        <li>For any queries regarding this receipt, please contact the society administrator.</li>
                    </ul>
                </div>
                <div style="margin-top:15px; display:flex; align-items:center; gap:20px;">
                    <div class="seal" style="width:110px; height:110px; margin:0; border-width:4px;">
                        <span style="font-size:11px;">PAID</span>
                        <strong style="font-size:16px;">VERIFIED</strong>
                        <span style="font-size:9px;">OFFICIAL</span>
                    </div>
                    <div style="font-size:12px; color:#6b7280; font-style:italic;">
                        Verification Date: ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </div>
                </div>
            </div>
        </div>
        <div class="signature-box"><div class="sign">Resident Signature</div><div class="sign">Treasurer / Admin Signature</div></div>
    </div>
    <div class="footer">© ${new Date().getFullYear()} ${rData.societyName} Management System • Verified Digital Receipt</div>
</div>
</body>
</html>`;
}

async function adminSendReceiptPDF(block, flat, period) {
    const soc = vault[currentSociety];
    const d = soc.apartmentData[block][flat];
    const mData = getEffectiveMonthData(d, period);
    if (!mData || mData.status !== 'Paid') return;

    const rData = {
        societyName: currentSociety.toUpperCase(),
        residentName: mData.owner || d.owner || 'Resident',
        flatNo: `${block}-${flat}`,
        phoneNo: d.phone || '-',
        blockName: `${block} Wing`,
        paymentDate: mData.paidDate || '-',
        paymentMode: mData.paymentMethod || 'UPI',
        period: (mData.plan === 'yearly' && mData.startPeriod) ? mData.startPeriod : period,
        amount: Number(mData.amount || 0),
        bank: soc.bank || {},
        receiptId: `RCPT-${currentSociety.substring(0, 3).toUpperCase()}-${new Date().getFullYear()}-${block}${flat}-${Math.floor(1000 + Math.random() * 9000)}`,
        plan: mData.plan || 'monthly'
    };

    const hashInput = `${rData.societyName}${rData.flatNo}${rData.amount}${rData.paymentDate}${rData.receiptId}`;
    const encoder = new TextEncoder();
    const data = encoder.encode(hashInput);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
    const vCode = `${hashHex.slice(0, 4)}-${hashHex.slice(4, 8)}-${hashHex.slice(8, 12)}`;

    const html = await getReceiptHTML(rData, vCode);
    const tempDiv = document.createElement('div');
    tempDiv.style.position = 'absolute';
    tempDiv.style.left = '-9999px';
    tempDiv.innerHTML = html;
    document.body.appendChild(tempDiv);

    // Short delay for layout/render
    setTimeout(() => {
        const opt = {
            margin: 0,
            filename: `Receipt_${rData.flatNo}_${period}.pdf`,
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: { scale: 2, useCORS: true },
            jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' }
        };
        html2pdf().from(tempDiv.querySelector('#receipt-content')).set(opt).save().then(() => {
            document.body.removeChild(tempDiv);
        });
    }, 800);
}

// Initialize the application
init();
