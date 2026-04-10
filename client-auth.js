(function setupClientAuth() {
  var STORAGE_KEY = 'multipixels_client_token';

  function dispatchChange() {
    document.dispatchEvent(new CustomEvent('multipixels:client-auth-changed', {
      detail: { token: getToken() }
    }));
  }

  function getToken() {
    try {
      return window.localStorage.getItem(STORAGE_KEY) || '';
    } catch (_) {
      return '';
    }
  }

  function setToken(token) {
    try {
      if (token) window.localStorage.setItem(STORAGE_KEY, token);
      else window.localStorage.removeItem(STORAGE_KEY);
    } catch (_) {
      return;
    }
    dispatchChange();
  }

  function clearToken() {
    setToken('');
  }

  async function request(url, options) {
    var config = options || {};
    var headers = Object.assign({ 'Content-Type': 'application/json' }, config.headers || {});
    var token = getToken();
    if (token) headers.Authorization = 'Bearer ' + token;

    var response = await window.fetch(url, Object.assign({}, config, { headers: headers }));
    var data = {};
    try {
      data = await response.json();
    } catch (_) {
      data = {};
    }

    if (!response.ok || data.ok === false) {
      var message = data && data.error && data.error.message ? data.error.message : 'Une erreur est survenue.';
      var error = new Error(message);
      error.payload = data;
      error.status = response.status;
      throw error;
    }

    return data;
  }

  async function login(payload) {
    var data = await request('/api/client/login', { method: 'POST', body: JSON.stringify(payload || {}) });
    if (data.token) setToken(data.token);
    return data;
  }

  async function register(payload) {
    var data = await request('/api/client/register', { method: 'POST', body: JSON.stringify(payload || {}) });
    if (data.token) setToken(data.token);
    return data;
  }

  async function logout() {
    try {
      await request('/api/client/logout', { method: 'POST' });
    } catch (_) {}
    clearToken();
  }

  function getSession() { return request('/api/client/session', { method: 'GET' }); }
  function getDashboard() { return request('/api/client/dashboard', { method: 'GET' }); }
  function getOrders() { return request('/api/client/orders', { method: 'GET' }); }
  function getTickets() { return request('/api/client/tickets', { method: 'GET' }); }
  function createTicket(payload) { return request('/api/client/tickets', { method: 'POST', body: JSON.stringify(payload || {}) }); }
  function updateProfile(payload) { return request('/api/client/profile', { method: 'PATCH', body: JSON.stringify(payload || {}) }); }
  function requestPasswordReset(payload) { return request('/api/client/request-password-reset', { method: 'POST', body: JSON.stringify(payload || {}) }); }
  async function resetPassword(payload) {
    var data = await request('/api/client/reset-password', { method: 'POST', body: JSON.stringify(payload || {}) });
    if (data.token) setToken(data.token);
    return data;
  }

  window.MultipixelsClientAuth = {
    getToken: getToken,
    setToken: setToken,
    clearToken: clearToken,
    login: login,
    register: register,
    logout: logout,
    getSession: getSession,
    getDashboard: getDashboard,
    getOrders: getOrders,
    getTickets: getTickets,
    createTicket: createTicket,
    updateProfile: updateProfile,
    requestPasswordReset: requestPasswordReset,
    resetPassword: resetPassword
  };
})();

