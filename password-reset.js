(function setupPasswordResetPage() {
  var auth = window.MultipixelsClientAuth;
  if (!auth) return;

  var requestForm = document.getElementById('password-reset-request-form');
  var resetForm = document.getElementById('password-reset-form');
  var statusNode = document.getElementById('password-reset-status');
  var requestPanel = document.getElementById('password-reset-request-panel');
  var resetPanel = document.getElementById('password-reset-panel');
  var tokenInput = document.getElementById('password-reset-token');
  var params = new URLSearchParams(window.location.search);
  var token = params.get('token') || '';

  function setStatus(message, tone) {
    if (!statusNode) return;
    statusNode.textContent = message || '';
    statusNode.className = 'client-auth-status';
    if (tone) statusNode.classList.add('is-' + tone);
  }

  if (token && tokenInput) {
    tokenInput.value = token;
    if (requestPanel) requestPanel.hidden = true;
    if (resetPanel) resetPanel.hidden = false;
  } else {
    if (requestPanel) requestPanel.hidden = false;
    if (resetPanel) resetPanel.hidden = true;
  }

  if (requestForm) {
    requestForm.addEventListener('submit', async function (event) {
      event.preventDefault();
      setStatus('Vérification en cours...', 'muted');
      try {
        var data = await auth.requestPasswordReset({ email: requestForm.email.value });
        setStatus(data.resetUrl ? 'Lien généré : ' + data.resetUrl : 'Si un compte existe, un email de réinitialisation a été préparé.', 'success');
      } catch (error) {
        setStatus(error.message || 'Impossible de lancer la réinitialisation.', 'error');
      }
    });
  }

  if (resetForm) {
    resetForm.addEventListener('submit', async function (event) {
      event.preventDefault();
      if (resetForm.password.value !== resetForm.confirmPassword.value) {
        setStatus('Les mots de passe ne correspondent pas.', 'error');
        return;
      }
      setStatus('Mise à jour du mot de passe...', 'muted');
      try {
        await auth.resetPassword({ token: tokenInput.value, password: resetForm.password.value });
        setStatus('Mot de passe mis à jour. Redirection vers votre compte...', 'success');
        window.location.href = 'mon-compte.html';
      } catch (error) {
        setStatus(error.message || 'Impossible de réinitialiser le mot de passe.', 'error');
      }
    });
  }
})();
