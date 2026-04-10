(function setupAdminAuth() {
  const TOKEN_KEY = 'multipixels_admin_token';

  async function request(path, options) {
    if (window.location.protocol === 'file:') {
      throw new Error('Ouvrez cette page via le serveur local, pas en double-cliquant le fichier. Lancez `npm start` puis allez sur http://localhost:3000/admin.html');
    }

    const config = Object.assign({ method: 'GET', headers: {} }, options || {});
    const token = window.localStorage.getItem(TOKEN_KEY);
    if (token) config.headers.Authorization = 'Bearer ' + token;
    if (config.body && !config.headers['Content-Type']) {
      config.headers['Content-Type'] = 'application/json';
    }

    let response;
    try {
      response = await fetch(path, config);
    } catch (_) {
      throw new Error('Le serveur MULTIPIXELS ne répond pas. Lancez `npm start` puis ouvrez http://localhost:3000/admin.html');
    }

    const payload = await response.json().catch(function () { return {}; });
    if (!response.ok || payload.ok === false) {
      const message = payload && payload.error && payload.error.message ? payload.error.message : 'Erreur administrateur.';
      throw new Error(message);
    }
    return payload;
  }

  async function login(email, password) {
    const payload = await request('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ email: email, password: password })
    });
    window.localStorage.setItem(TOKEN_KEY, payload.token);
    return payload;
  }

  async function logout() {
    try {
      await request('/api/admin/logout', { method: 'POST' });
    } catch (_) {}
    window.localStorage.removeItem(TOKEN_KEY);
  }

  function hasToken() {
    return !!window.localStorage.getItem(TOKEN_KEY);
  }

  window.MultipixelsAdminAuth = {
    request: request,
    login: login,
    logout: logout,
    hasToken: hasToken,
    tokenKey: TOKEN_KEY
  };
})();

