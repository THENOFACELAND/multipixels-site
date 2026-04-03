(function setupClientDashboardPage() {
  var auth = window.MultipixelsClientAuth;
  if (!auth) return;

  var body = document.body;
  var currentPage = body && body.dataset ? (body.dataset.clientPage || 'overview') : 'overview';
  var welcomeNode = document.getElementById('client-dashboard-welcome');
  var leadNode = document.getElementById('client-dashboard-lead');
  var statsNode = document.getElementById('client-dashboard-stats');
  var ordersNode = document.getElementById('client-orders-list');
  var ticketsNode = document.getElementById('client-tickets-list');
  var profileForm = document.getElementById('client-profile-form');
  var ticketForm = document.getElementById('client-ticket-form');
  var statusNode = document.getElementById('client-dashboard-status');
  var logoutButtons = Array.from(document.querySelectorAll('[data-client-logout]'));
  var navLinks = Array.from(document.querySelectorAll('[data-dashboard-link]'));

  function setStatus(message, tone) {
    if (!statusNode) return;
    statusNode.textContent = message || '';
    statusNode.className = 'client-auth-status';
    if (tone) statusNode.classList.add('is-' + tone);
  }

  function formatDate(value) {
    if (!value) return '-';
    try {
      return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' }).format(new Date(value));
    } catch (_) {
      return value;
    }
  }

  function formatPrice(value) {
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(Number(value || 0));
  }

  function setActiveNav() {
    navLinks.forEach(function (link) {
      var isActive = link.getAttribute('data-dashboard-link') === currentPage;
      link.classList.toggle('is-active', isActive);
      link.setAttribute('aria-current', isActive ? 'page' : 'false');
    });
  }

  logoutButtons.forEach(function (button) {
    button.addEventListener('click', async function () {
      await auth.logout();
      window.location.href = 'espace-client.html';
    });
  });

  function renderStats(stats) {
    if (!statsNode) return;
    var cards = [
      { label: 'Commandes', value: stats.totalOrders },
      { label: 'Commandes actives', value: stats.activeOrders },
      { label: 'Tickets SAV', value: stats.totalTickets },
      { label: 'Tickets ouverts', value: stats.openTickets }
    ];
    statsNode.innerHTML = cards.map(function (card) {
      return '<article class="client-mini-card"><strong>' + card.value + '</strong><span>' + card.label + '</span></article>';
    }).join('');
  }

  function renderOrders(orders) {
    if (!ordersNode) return;
    if (!orders.length) {
      ordersNode.innerHTML = '<article class="client-empty-card"><h3>Aucune commande pour le moment</h3><p>Votre suivi de commande apparaîtra ici dès qu\'un dossier sera lancé avec l\'atelier.</p></article>';
      return;
    }

    ordersNode.innerHTML = orders.map(function (order) {
      var items = (order.items || []).map(function (item) {
        return '<li><strong>' + item.quantity + 'x</strong> ' + item.name + ' <span>' + (item.technique || '') + (item.color ? ' - ' + item.color : '') + '</span></li>';
      }).join('');
      var timeline = (order.timeline || []).map(function (step) {
        return '<li class="' + (step.done ? 'is-done' : '') + '"><strong>' + step.label + '</strong><span>' + step.date + '</span></li>';
      }).join('');
      return [
        '<article class="client-panel-card order-card">',
        '<div class="client-panel-top">',
        '<div><span class="client-kicker">' + order.reference + '</span><h3>' + order.title + '</h3></div>',
        '<span class="client-status-chip is-' + order.statusTone + '">' + order.statusLabel + '</span>',
        '</div>',
        '<div class="client-order-meta">',
        '<span>Passée le ' + formatDate(order.createdAt) + '</span>',
        '<span>Expédition prévue ' + formatDate(order.estimatedShipDate) + '</span>',
        '<span>' + formatPrice(order.total) + '</span>',
        '</div>',
        '<p class="client-order-note">' + (order.clientNote || '') + '</p>',
        '<ul class="client-order-items">' + items + '</ul>',
        '<ul class="client-timeline">' + timeline + '</ul>',
        '</article>'
      ].join('');
    }).join('');
  }

  function renderTickets(tickets) {
    if (!ticketsNode) return;
    if (!tickets.length) {
      ticketsNode.innerHTML = '<article class="client-empty-card"><h3>Aucun ticket SAV en cours</h3><p>Vous pourrez ouvrir ici une demande SAV, une modification de commande ou une question logistique.</p></article>';
      return;
    }

    ticketsNode.innerHTML = tickets.map(function (ticket) {
      return [
        '<article class="client-panel-card ticket-card">',
        '<div class="client-panel-top">',
        '<div><span class="client-kicker">' + ticket.category + '</span><h3>' + ticket.subject + '</h3></div>',
        '<span class="client-status-chip is-' + ticket.statusTone + '">' + ticket.statusLabel + '</span>',
        '</div>',
        '<div class="client-order-meta">',
        '<span>Mise à jour le ' + formatDate(ticket.updatedAt) + '</span>',
        '<span>' + (ticket.orderReference || 'Sans référence de commande') + '</span>',
        '</div>',
        '<p class="client-order-note">' + (ticket.messagePreview || '') + '</p>',
        '<p class="client-ticket-reply">' + (ticket.lastReply || '') + '</p>',
        '</article>'
      ].join('');
    }).join('');
  }

  function fillProfile(user) {
    if (!profileForm) return;
    profileForm.firstName.value = user.firstName || '';
    profileForm.lastName.value = user.lastName || '';
    profileForm.company.value = user.company || '';
    profileForm.email.value = user.email || '';
    profileForm.phone.value = user.phone || '';
    profileForm.addressLine1.value = user.addressLine1 || '';
    profileForm.addressLine2.value = user.addressLine2 || '';
    profileForm.accountType.value = user.accountType || 'particulier';
  }

  function renderDashboard(dashboard) {
    var user = dashboard.user;
    if (welcomeNode) welcomeNode.textContent = 'Bonjour ' + (user.firstName || user.displayName || 'client') + ',';
    if (leadNode) {
      if (currentPage === 'orders') {
        leadNode.textContent = 'Retrouvez ici vos commandes en cours, les étapes de production et les dates d’expédition prévues.';
      } else if (currentPage === 'sav') {
        leadNode.textContent = 'Centralisez vos demandes SAV, vos ajustements et vos échanges avec l’atelier dans un seul espace.';
      } else if (currentPage === 'profile') {
        leadNode.textContent = 'Mettez à jour vos informations client pour garder un suivi clair sur vos futures commandes.';
      } else {
        leadNode.textContent = user.accountType === 'professionnel'
          ? 'Votre espace professionnel centralise le suivi des commandes, la coordination atelier et le SAV.'
          : 'Retrouvez ici vos commandes, vos demandes SAV et vos informations de suivi avec l’atelier.';
      }
    }
    renderStats(dashboard.stats || {});
    renderOrders(dashboard.orders || []);
    renderTickets(dashboard.tickets || []);
    fillProfile(user);
  }

  async function hydrateDashboard() {
    try {
      var payload = await auth.getDashboard();
      renderDashboard(payload.dashboard);
      setStatus('', '');
    } catch (error) {
      await auth.logout();
      window.location.href = 'espace-client.html';
    }
  }

  if (ticketForm) {
    ticketForm.addEventListener('submit', async function (event) {
      event.preventDefault();
      setStatus('Envoi de votre demande SAV...', 'muted');
      var submit = ticketForm.querySelector('button[type="submit"]');
      if (submit) submit.disabled = true;
      try {
        await auth.createTicket({
          subject: ticketForm.subject.value,
          category: ticketForm.category.value,
          orderReference: ticketForm.orderReference.value,
          message: ticketForm.message.value
        });
        ticketForm.reset();
        await hydrateDashboard();
        setStatus('Votre demande a bien été enregistrée.', 'success');
      } catch (error) {
        setStatus(error.message || 'Impossible d’envoyer la demande SAV.', 'error');
      } finally {
        if (submit) submit.disabled = false;
      }
    });
  }

  if (profileForm) {
    profileForm.addEventListener('submit', async function (event) {
      event.preventDefault();
      setStatus('Mise à jour du profil...', 'muted');
      var submit = profileForm.querySelector('button[type="submit"]');
      if (submit) submit.disabled = true;
      try {
        await auth.updateProfile({
          firstName: profileForm.firstName.value,
          lastName: profileForm.lastName.value,
          company: profileForm.company.value,
          phone: profileForm.phone.value,
          addressLine1: profileForm.addressLine1.value,
          addressLine2: profileForm.addressLine2.value,
          accountType: profileForm.accountType.value
        });
        await hydrateDashboard();
        setStatus('Vos informations ont été mises à jour.', 'success');
      } catch (error) {
        setStatus(error.message || 'Impossible de mettre à jour le profil.', 'error');
      } finally {
        if (submit) submit.disabled = false;
      }
    });
  }

  setActiveNav();
  hydrateDashboard();
})();
