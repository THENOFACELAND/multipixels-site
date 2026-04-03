(function setupAdminLoginPage() {
  const auth = window.MultipixelsAdminAuth;
  if (!auth) return;

  const form = document.getElementById('admin-login-form');
  const statusNode = document.getElementById('admin-login-status');
  if (!form || !statusNode) return;

  function setStatus(message, tone) {
    statusNode.textContent = message || '';
    statusNode.className = 'client-auth-status';
    if (tone) statusNode.classList.add('is-' + tone);
  }

  if (window.location.protocol === 'file:') {
    setStatus('Cette page doit être ouverte via http://localhost:3000/admin.html après avoir lancé `npm start`.', 'error');
  }

  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    const submit = form.querySelector('button[type="submit"]');
    if (submit) submit.disabled = true;
    setStatus('Connexion administrateur en cours...', 'muted');
    try {
      await auth.login(form.email.value, form.password.value);
      setStatus('Connexion validée. Redirection...', 'success');
      window.location.href = 'admin-dashboard.html';
    } catch (error) {
      setStatus(error.message || 'Impossible de se connecter.', 'error');
    } finally {
      if (submit) submit.disabled = false;
    }
  });
})();
