(function setupInvoiceDataPages() {
  const auth = window.MultipixelsAdminAuth;
  if (!auth) return;

  const section = document.body.getAttribute('data-admin-section') || '';
  const statusNode = document.getElementById('admin-status');
  const logoutButton = document.getElementById('admin-logout');
  const clientForm = document.getElementById('invoice-client-form');
  const clientList = document.getElementById('invoice-client-list');
  const clientCount = document.getElementById('invoice-client-count');
  const clientReset = document.getElementById('invoice-client-reset');
  const referenceForm = document.getElementById('invoice-reference-form');
  const referenceList = document.getElementById('invoice-reference-list');
  const referenceCount = document.getElementById('invoice-reference-count');
  const referenceReset = document.getElementById('invoice-reference-reset');

  document.querySelectorAll('.reveal').forEach(function (node) { node.classList.add('is-visible'); });
  document.querySelectorAll('[data-admin-nav]').forEach(function (link) {
    const isActive = link.getAttribute('data-admin-nav') === section;
    link.classList.toggle('is-active', isActive);
    if (isActive) link.setAttribute('aria-current', 'page');
  });

  function setStatus(message, tone) {
    if (!statusNode) return;
    statusNode.textContent = message || '';
    statusNode.className = 'client-auth-status';
    if (tone) statusNode.classList.add('is-' + tone);
  }

  function escapeHtml(value) {
    return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function formatPrice(value) {
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(Number(value || 0));
  }

  function getFormPayload(form) {
    const data = new FormData(form);
    const payload = {};
    data.forEach(function (value, key) { payload[key] = String(value || '').trim(); });
    return payload;
  }

  function renderClients(clients) {
    const list = Array.isArray(clients) clients : [];
    if (clientCount) clientCount.textContent = list.length + ' client' + (list.length > 1 's' : '');
    if (!clientList) return;
    if (!list.length) {
      clientList.innerHTML = '<article class="client-empty-card">Aucun client de facturation enregistré pour le moment.</article>';
      return;
    }
    clientList.innerHTML = list.map(function (client) {
      const address = [client.addressLine1, client.addressLine2, [client.postalCode, client.city].filter(Boolean).join(' '), client.country].filter(Boolean).join(' - ');
      return [
        '<article class="client-panel-card admin-data-card admin-invoice-data-card">',
        '<div class="client-panel-top"><div><span class="client-kicker">Client facture</span><h3>' + escapeHtml(client.name) + '</h3></div><button class="btn btn-outline admin-danger" type="button" data-invoice-client-delete="' + escapeHtml(client.id) + '">Supprimer</button></div>',
        '<div class="client-order-meta"><span>' + escapeHtml(client.email || '-') + '</span><span>' + escapeHtml(client.phone || '-') + '</span><span>' + escapeHtml(client.company || '-') + '</span></div>',
        '<p class="client-order-note">' + escapeHtml(address || 'Adresse à compléter') + '</p>',
        '</article>'
      ].join('');
    }).join('');
  }

  function renderReferences(references) {
    const list = Array.isArray(references) references : [];
    if (referenceCount) referenceCount.textContent = list.length + ' référence' + (list.length > 1 's' : '');
    if (!referenceList) return;
    if (!list.length) {
      referenceList.innerHTML = '<article class="client-empty-card">Aucune référence enregistrée pour le moment.</article>';
      return;
    }
    referenceList.innerHTML = list.map(function (item) {
      return [
        '<article class="client-panel-card admin-data-card admin-invoice-data-card">',
        '<div class="client-panel-top"><div><span class="client-kicker">' + escapeHtml(item.reference) + '</span><h3>' + escapeHtml(item.designation) + '</h3></div><span class="client-status-chip is-success">' + escapeHtml(formatPrice(item.price)) + '</span></div>',
        '<div class="admin-inline-editor"><button class="btn btn-outline admin-danger" type="button" data-invoice-reference-delete="' + escapeHtml(item.id) + '">Supprimer</button></div>',
        '</article>'
      ].join('');
    }).join('');
  }

  async function loadClients() {
    const payload = await auth.request('/api/admin/invoice-clients');
    renderClients(payload.clients || []);
  }

  async function loadReferences() {
    const payload = await auth.request('/api/admin/invoice-references');
    renderReferences(payload.references || []);
  }

  async function boot() {
    try {
      await auth.request('/api/admin/session');
    } catch (_) {
      window.location.href = 'admin.html';
      return;
    }
    try {
      if (clientForm) await loadClients();
      if (referenceForm) await loadReferences();
    } catch (error) {
      setStatus(error.message || 'Impossible de charger les données de facturation.', 'error');
    }
  }

  if (logoutButton) {
    logoutButton.addEventListener('click', async function () {
      await auth.logout();
      window.location.href = 'admin.html';
    });
  }

  if (clientForm) {
    clientForm.addEventListener('submit', async function (event) {
      event.preventDefault();
      const payload = getFormPayload(clientForm);
      if (!payload.name) return setStatus('Le nom du client est obligatoire.', 'error');
      setStatus('Ajout du client en cours...', 'muted');
      try {
        const response = await auth.request('/api/admin/invoice-clients', { method: 'POST', body: JSON.stringify(payload) });
        clientForm.reset();
        if (clientForm.country) clientForm.country.value = 'France';
        renderClients(response.clients || []);
        setStatus('Client ajouté à la base facture.', 'success');
      } catch (error) {
        setStatus(error.message || 'Impossible d’ajouter ce client.', 'error');
      }
    });
    if (clientReset) clientReset.addEventListener('click', function () { clientForm.reset(); if (clientForm.country) clientForm.country.value = 'France'; });
    clientList.addEventListener('click', async function (event) {
      const button = event.target.closest('[data-invoice-client-delete]');
      if (!button) return;
      if (!window.confirm('Supprimer ce client de la base facture ')) return;
      try {
        const response = await auth.request('/api/admin/invoice-clientsid=' + encodeURIComponent(button.getAttribute('data-invoice-client-delete')), { method: 'DELETE' });
        renderClients(response.clients || []);
        setStatus('Client supprimé.', 'success');
      } catch (error) {
        setStatus(error.message || 'Impossible de supprimer ce client.', 'error');
      }
    });
  }

  if (referenceForm) {
    referenceForm.addEventListener('submit', async function (event) {
      event.preventDefault();
      const payload = getFormPayload(referenceForm);
      if (!payload.reference || !payload.designation) return setStatus('Référence et désignation sont obligatoires.', 'error');
      setStatus('Ajout de la référence en cours...', 'muted');
      try {
        const response = await auth.request('/api/admin/invoice-references', { method: 'POST', body: JSON.stringify(payload) });
        referenceForm.reset();
        renderReferences(response.references || []);
        setStatus('Référence ajoutée à la base facture.', 'success');
      } catch (error) {
        setStatus(error.message || 'Impossible d’ajouter cette référence.', 'error');
      }
    });
    if (referenceReset) referenceReset.addEventListener('click', function () { referenceForm.reset(); });
    referenceList.addEventListener('click', async function (event) {
      const button = event.target.closest('[data-invoice-reference-delete]');
      if (!button) return;
      if (!window.confirm('Supprimer cette référence facture ')) return;
      try {
        const response = await auth.request('/api/admin/invoice-referencesid=' + encodeURIComponent(button.getAttribute('data-invoice-reference-delete')), { method: 'DELETE' });
        renderReferences(response.references || []);
        setStatus('Référence supprimée.', 'success');
      } catch (error) {
        setStatus(error.message || 'Impossible de supprimer cette référence.', 'error');
      }
    });
  }

  boot();
})();
