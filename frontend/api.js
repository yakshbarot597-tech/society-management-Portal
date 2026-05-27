const API_BASE = (window.location.protocol === 'file:' || window.location.hostname === '')
    ? 'http://localhost:5000/api'
    : '/api';


function getHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    const token = localStorage.getItem('jwt_token');
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
}

async function fetchWithAuth(url, options = {}) {
    if (!options.headers) {
        options.headers = getHeaders();
    } else {
        options.headers = { ...getHeaders(), ...options.headers };
    }

    const response = await fetch(url, options);
    if (response.status === 401 || response.status === 403) {
        // Token expired or invalid — clear session and send back to start
        localStorage.removeItem('jwt_token');
        localStorage.removeItem('activeSociety');
        localStorage.removeItem('isAdmin');
        localStorage.removeItem('propertyType');
        localStorage.removeItem('residentFlat');
        alert('Your session has expired. Please log in again.');
        window.location.reload();
    }
    return response;
}


const Api = {
    setup: (data) => fetch(`${API_BASE}/setup`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data) }),
    login: (data) => fetch(`${API_BASE}/login`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data) }),
    residentLogin: (data) => fetch(`${API_BASE}/resident-login`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data) }),
    getSocieties: () => fetch(`${API_BASE}/societies`),
    getSociety: (name, type) => fetchWithAuth(`${API_BASE}/society/${encodeURIComponent(name)}/${encodeURIComponent(type)}`),
    saveFlat: (data) => fetchWithAuth(`${API_BASE}/flat`, { method: 'POST', body: JSON.stringify(data) }),
    saveExpense: (data) => fetchWithAuth(`${API_BASE}/expense`, { method: 'POST', body: JSON.stringify(data) }),
    deleteExpense: (id) => fetchWithAuth(`${API_BASE}/expense/${id}`, { method: 'DELETE' }),
    saveNotice: (data) => fetchWithAuth(`${API_BASE}/notice`, { method: 'POST', body: JSON.stringify(data) }),
    deleteNotice: (id) => fetchWithAuth(`${API_BASE}/notice/${id}`, { method: 'DELETE' }),
    saveRule: (data) => fetchWithAuth(`${API_BASE}/rule`, { method: 'POST', body: JSON.stringify(data) }),
    deleteRule: (id) => fetchWithAuth(`${API_BASE}/rule/${id}`, { method: 'DELETE' }),
    saveComplaint: (data) => fetchWithAuth(`${API_BASE}/complaint`, { method: 'POST', body: JSON.stringify(data) }),
    deleteComplaint: (id) => fetchWithAuth(`${API_BASE}/complaint/${id}`, { method: 'DELETE' }),
    saveCommittee: (data) => fetchWithAuth(`${API_BASE}/committee`, { method: 'POST', body: JSON.stringify(data) }),
    deleteCommittee: (id) => fetchWithAuth(`${API_BASE}/committee/${id}`, { method: 'DELETE' }),
    saveBank: (data) => fetchWithAuth(`${API_BASE}/bank`, { method: 'POST', body: JSON.stringify(data) }),
    requestResidentOtp: (data) => fetch(`${API_BASE}/request-resident-otp`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data) }),
    verifyResidentOtp: (data) => fetch(`${API_BASE}/verify-resident-otp`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data) }),
    adminVerifyIdentity: (data) => fetch(`${API_BASE}/admin-verify-identity`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data) }),
    adminVerifyOtp: (data) => fetch(`${API_BASE}/admin-verify-otp`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data) }),
    adminResetPassword: (data) => fetch(`${API_BASE}/admin-reset-password`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data) }),
    updateDueDay: (data) => fetchWithAuth(`${API_BASE}/update-due-day`, { method: 'POST', body: JSON.stringify(data) })
};
