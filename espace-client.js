(function setupClientSpacePage() {
  var auth = window.MultipixelsClientAuth;
  if (!auth) return;

  var loginForm = document.getElementById('client-login-form');
  var registerForm = document.getElementById('client-register-form');
  var statusNode = document.getElementById('client-auth-status');
  var accountTypeInput = document.getElementById('client-account-type');
  var companyField = document.getElementById('client-company-field');
  var companyInput = companyField ? companyField.querySelector('input') : null;
  var accountSwitches = Array.from(document.querySelectorAll('[data-account-switch]'));

  function setStatus(message, tone) {
    if (!statusNode) return;
    statusNode.textContent = message || '';
    statusNode.className = 'client-auth-status';
    if (tone) statusNode.classList.add('is-' + tone);
  }

  function syncAccountType(type) {
    var value = type === 'professionnel' ? 'professionnel' : 'particulier';
    var isProfessional = value === 'professionnel';
    if (accountTypeInput) accountTypeInput.value = value;
    if (companyField) companyField.hidden = !isProfessional;
    if (companyInput) {
      companyInput.disabled = !isProfessional;
      companyInput.required = false;
      if (!isProfessional) companyInput.value = '';
    }
    accountSwitches.forEach(function (button) {
      button.classList.toggle('is-active', button.getAttribute('data-account-switch') === value);
    });
  }

  accountSwitches.forEach(function (button) {
    button.addEventListener('click', function () {
      syncAccountType(button.getAttribute('data-account-switch'));
    });
  });

  syncAccountType(accountTypeInput ? accountTypeInput.value : 'particulier');

  auth.getSession().then(function () {
    window.location.href = 'mon-compte.html';
  }).catch(function () {
    // Visitor is not logged in yet.
  });

  if (loginForm) {
    loginForm.addEventListener('submit', async function (event) {
      event.preventDefault();
      setStatus('Connexion en cours...', 'muted');
      var submit = loginForm.querySelector('button[type="submit"]');
      if (submit) submit.disabled = true;
      try {
        await auth.login({
          email: loginForm.email.value,
          password: loginForm.password.value
        });
        setStatus('Connexion validée. Redirection...', 'success');
        window.location.href = 'mon-compte.html';
      } catch (error) {
        setStatus(error.message || 'Connexion impossible.', 'error');
      } finally {
        if (submit) submit.disabled = false;
      }
    });
  }

  if (registerForm) {
    registerForm.addEventListener('submit', async function (event) {
      event.preventDefault();
      setStatus('Création du compte en cours...', 'muted');
      var submit = registerForm.querySelector('button[type="submit"]');
      if (submit) submit.disabled = true;
      try {
        await auth.register({
          accountType: accountTypeInput ? accountTypeInput.value : 'particulier',
          firstName: registerForm.firstName.value,
          lastName: registerForm.lastName.value,
          company: companyInput && !companyInput.disabled ? companyInput.value : '',
          email: registerForm.email.value,
          phone: registerForm.phone.value,
          password: registerForm.password.value
        });
        setStatus('Compte créé. Redirection vers votre espace client...', 'success');
        window.location.href = 'mon-compte.html';
      } catch (error) {
        setStatus(error.message || 'Création du compte impossible.', 'error');
      } finally {
        if (submit) submit.disabled = false;
      }
    });
  }
})();

