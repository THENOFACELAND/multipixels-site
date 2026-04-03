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
  var params = new URLSearchParams(window.location.search);
  var isPreviewMode = params.get('preview') === '1';

  var previewDashboard = {
    user: {
      accountType: 'professionnel',
      firstName: 'Julien',
      lastName: 'Dubois',
      company: 'Nord Events',
      email: 'pro@multipixels.fr',
      phone: '06 27 14 08 40',
      addressLine1: '190 chemin Blanc',
      addressLine2: 'Bâtiment atelier',
      displayName: 'Julien Dubois - Nord Events'
    },
    stats: {
      totalOrders: 2,
      activeOrders: 1,
      totalTickets: 1,
      openTickets: 1
    },
    orders: [
      {
        reference: 'MP-2026-0387',
        title: 'Polos entreprise - 42 pièces',
        statusTone: 'success',
        statusLabel: 'Expédiée',
        createdAt: '2026-03-12T14:10:00.000Z',
        estimatedShipDate: '2026-03-27T00:00:00.000Z',
        total: 684,
        clientNote: 'Commande prioritaire avec broderie poitrine et manche.',
        items: [
          { name: 'Polo premium homme', quantity: 30, technique: 'Broderie', color: 'Bleu marine' },
          { name: 'Polo premium femme', quantity: 12, technique: 'Broderie', color: 'Blanc' }
        ],
        timeline: [
          { label: 'Brief commercial validé', date: '12 mars 2026', done: true },
          { label: 'BAT signé', date: '15 mars 2026', done: true },
          { label: 'Production finalisée', date: '25 mars 2026', done: true },
          { label: 'Expédition', date: '27 mars 2026', done: true }
        ]
      },
      {
        reference: 'MP-2026-0424',
        title: 'Softshells chantier - 18 pièces',
        statusTone: 'warning',
        statusLabel: 'Validation devis',
        createdAt: '2026-03-29T10:00:00.000Z',
        estimatedShipDate: '2026-04-09T00:00:00.000Z',
        total: 972,
        clientNote: 'En attente de validation finale des tailles.',
        items: [
          { name: 'Softshell travail', quantity: 18, technique: 'Broderie', color: 'Noir' }
        ],
        timeline: [
          { label: 'Demande reçue', date: '29 mars 2026', done: true },
          { label: 'Devis émis', date: '30 mars 2026', done: true },
          { label: 'Validation client', date: 'À confirmer', done: false },
          { label: 'Production', date: 'À planifier', done: false }
        ]
      }
    ],
    tickets: [
      {
        category: 'Facturation',
        subject: 'Besoin de duplicata facture',
        statusTone: 'in-progress',
        statusLabel: 'Ouvert',
        updatedAt: '2026-03-30T09:00:00.000Z',
        orderReference: 'MP-2026-0387',
        messagePreview: 'Pouvez-vous envoyer la facture au format PDF pour notre comptabilité ?',
        lastReply: 'Ticket reçu, un retour est prévu sous 24h.'
      }
    ]
  };

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
      var href = link.getAttribute('href') || '';
      if (isPreviewMode && href && href.indexOf('preview=1') === -1) {
        link.setAttribute('href', href + (href.indexOf('?') === -1 ? '?preview=1' : '&preview=1'));
      }
      link.classList.toggle('is-active', isActive);
      link.setAttribute('aria-current', isActive ? 'page' : 'false');
    });
  }

  logoutButtons.forEach(function (button) {
    button.addEventListener('click', async function () {
      if (isPreviewMode) {
        window.location.href = 'espace-client.html';
        return;
      }
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
    if (isPreviewMode) {
      Array.from(profileForm.elements).forEach(function (element) {
        element.disabled = true;
      });
    }
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
    if (isPreviewMode) {
      renderDashboard(previewDashboard);
      setStatus('Mode aperçu activé. Cette vue n’est pas liée à un vrai compte.', 'muted');
      if (ticketForm) {
        Array.from(ticketForm.elements).forEach(function (element) {
          element.disabled = true;
        });
      }
      return;
    }

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
      if (isPreviewMode) return;
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
      if (isPreviewMode) return;
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





