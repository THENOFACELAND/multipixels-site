(function setupAdminDashboardPage() {
  const auth = window.MultipixelsAdminAuth;
  if (!auth) return;

  const currentSection = document.body.getAttribute('data-admin-section') || 'overview';
  const welcomeNode = document.getElementById('admin-welcome');
  const introNode = document.getElementById('admin-intro');
  const statusNode = document.getElementById('admin-status');
  const statsNode = document.getElementById('admin-stats');
  const clientsNode = document.getElementById('admin-clients-list');
  const ordersNode = document.getElementById('admin-orders-list');
  const ticketsNode = document.getElementById('admin-tickets-list');
  const productsNode = document.getElementById('admin-products-list');
  const productsSearchInput = document.getElementById('admin-products-search');
  const productsCategoryFilter = document.getElementById('admin-products-category');
  const productsStockFilter = document.getElementById('admin-products-stock');
  const productsSortFilter = document.getElementById('admin-products-sort');
  const productsCountNode = document.getElementById('admin-products-count');
  const productsPageNode = document.getElementById('admin-products-page');
  const productsPrevButton = document.getElementById('admin-products-prev');
  const productsNextButton = document.getElementById('admin-products-next');
  const productForm = document.getElementById('admin-product-form');
  const productSubmit = document.getElementById('admin-product-submit');
  const productCancel = document.getElementById('admin-product-cancel');
  const logoutButton = document.getElementById('admin-logout');
  const productPhotosInput = document.getElementById('admin-product-photos');
  const productImagesPreview = document.getElementById('admin-product-images-preview');
  const quotesNode = document.getElementById('admin-quotes-list');
  const invoicesNode = document.getElementById('admin-invoices-list');
  const quotesCountNode = document.getElementById('admin-quotes-count');
  const invoicesCountNode = document.getElementById('admin-invoices-count');
  const quoteForm = document.getElementById('admin-quote-form');
  const invoiceForm = document.getElementById('admin-invoice-form');
  const quoteSubmit = document.getElementById('admin-quote-submit');
  const invoiceSubmit = document.getElementById('admin-invoice-submit');
  const quoteCancel = document.getElementById('admin-quote-cancel');
  const invoiceCancel = document.getElementById('admin-invoice-cancel');
  const quoteLinesNode = document.getElementById('admin-quote-lines');
  const invoiceLinesNode = document.getElementById('admin-invoice-lines');
  const quoteAddLineButton = document.getElementById('admin-quote-add-line');
  const invoiceAddLineButton = document.getElementById('admin-invoice-add-line');

  if (!statusNode) return;

  const categoryLabels = {
    homme: 'Homme',
    femme: 'Femme',
    enfant: 'Enfant',
    accessoires: 'Accessoires',
    'vetement-travail': 'Vêtement de travail'
  };
  const publicCatalogueByCategory = {
    homme: 'catalogue-homme.html',
    femme: 'catalogue-femme.html',
    enfant: 'catalogue-enfant.html',
    accessoires: 'catalogue-accessoire.html',
    'vetement-travail': 'catalogue-vetement-travail.html'
  };
  const PRODUCTS_PER_PAGE = 6;

  let adminState = {
    products: [],
    currentPage: 1
  };

  document.querySelectorAll('.reveal').forEach(function (node) {
    node.classList.add('is-visible');
  });

  document.querySelectorAll('[data-admin-nav]').forEach(function (link) {
    const isActive = link.getAttribute('data-admin-nav') === currentSection;
    link.classList.toggle('is-active', isActive);
    if (isActive) {
      link.setAttribute('aria-current', 'page');
    } else {
      link.removeAttribute('aria-current');
    }
  });

  function setStatus(message, tone) {
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

  function formatCategory(value) {
    return categoryLabels[value] || value || 'Catalogue';
  }

  function renderStats(stats) {
    if (!statsNode) return;
    const cards = [
      { label: 'Clients', value: stats.totalClients || 0 },
      { label: 'Commandes', value: stats.totalOrders || 0 },
      { label: 'Commandes actives', value: stats.activeOrders || 0 },
      { label: 'Tickets ouverts', value: stats.openTickets || 0 },
      { label: 'Produits admin', value: stats.managedProducts || 0 }
    ];
    statsNode.innerHTML = cards.map(function (card) {
      return '<article class="client-mini-card"><strong>' + card.value + '</strong><span>' + card.label + '</span></article>';
    }).join('');
  }

  function renderClients(clients) {
    if (!clientsNode) return;
    clientsNode.innerHTML = clients.map(function (client) {
      return [
        '<article class="client-panel-card admin-data-card">',
        '<div class="client-panel-top"><div><span class="client-kicker">' + (client.accountType || 'client') + '</span><h3>' + [client.firstName, client.lastName].filter(Boolean).join(' ') + '</h3></div><span class="client-status-chip is-in-progress">' + client.ordersCount + ' commandes</span></div>',
        '<div class="client-order-meta"><span>' + (client.company || 'Sans société') + '</span><span>' + client.email + '</span><span>' + (client.phone || '-') + '</span></div>',
        '<p class="client-order-note">' + [client.addressLine1, client.addressLine2].filter(Boolean).join(', ') + '</p>',
        '</article>'
      ].join('');
    }).join('');
  }

  function renderOrders(orders) {
    if (!ordersNode) return;
    ordersNode.innerHTML = orders.map(function (order) {
      return [
        '<article class="client-panel-card admin-data-card">',
        '<div class="client-panel-top"><div><span class="client-kicker">' + order.reference + '</span><h3>' + order.title + '</h3></div><span class="client-status-chip is-' + order.statusTone + '">' + order.statusLabel + '</span></div>',
        '<div class="client-order-meta"><span>' + order.customerName + '</span><span>' + formatDate(order.createdAt) + '</span><span>' + formatPrice(order.total) + '</span></div>',
        '<p class="client-order-note">' + (order.clientNote || '') + '</p>',
        '<div class="admin-inline-editor">',
        '<select data-admin-order-status="' + order.id + '">',
        '<option value="pending|En attente|pending"' + (order.status === 'pending' ? ' selected' : '') + '>En attente</option>',
        '<option value="validation|Validation atelier|warning"' + (order.status === 'validation' ? ' selected' : '') + '>Validation atelier</option>',
        '<option value="production|En production|in-progress"' + (order.status === 'production' ? ' selected' : '') + '>En production</option>',
        '<option value="shipped|Expédiée|success"' + (order.status === 'shipped' ? ' selected' : '') + '>Expédiée</option>',
        '<option value="delivered|Livrée|success"' + (order.status === 'delivered' ? ' selected' : '') + '>Livrée</option>',
        '<option value="closed|Clôturée|success"' + (order.status === 'closed' ? ' selected' : '') + '>Clôturée</option>',
        '</select>',
        '<button class="btn btn-outline" type="button" data-admin-order-save="' + order.id + '">Mettre à jour</button>',
        '</div>',
        '</article>'
      ].join('');
    }).join('');
  }

  function renderTickets(tickets) {
    if (!ticketsNode) return;
    ticketsNode.innerHTML = tickets.map(function (ticket) {
      return [
        '<article class="client-panel-card admin-data-card">',
        '<div class="client-panel-top"><div><span class="client-kicker">' + ticket.category + '</span><h3>' + ticket.subject + '</h3></div><span class="client-status-chip is-' + ticket.statusTone + '">' + ticket.statusLabel + '</span></div>',
        '<div class="client-order-meta"><span>' + ticket.customerName + '</span><span>' + (ticket.customerEmail || '-') + '</span><span>' + formatDate(ticket.updatedAt) + '</span></div>',
        '<p class="client-order-note">' + (ticket.messagePreview || '') + '</p>',
        '<textarea class="admin-reply-input" data-admin-ticket-reply="' + ticket.id + '" rows="3" placeholder="Réponse SAV">' + (ticket.lastReply || '') + '</textarea>',
        '<div class="admin-inline-editor">',
        '<select data-admin-ticket-status="' + ticket.id + '">',
        '<option value="open|Ouvert|in-progress"' + (ticket.status === 'open' ? ' selected' : '') + '>Ouvert</option>',
        '<option value="pending|En attente client|warning"' + (ticket.status === 'pending' ? ' selected' : '') + '>En attente client</option>',
        '<option value="resolved|Résolu|success"' + (ticket.status === 'resolved' ? ' selected' : '') + '>Résolu</option>',
        '<option value="closed|Clôturé|success"' + (ticket.status === 'closed' ? ' selected' : '') + '>Clôturé</option>',
        '</select>',
        '<button class="btn btn-outline" type="button" data-admin-ticket-save="' + ticket.id + '">Enregistrer</button>',
        '</div>',
        '</article>'
      ].join('');
    }).join('');
  }


  function createDocumentLineItem(item) {
    return {
      description: item && item.description ? String(item.description) : '',
      quantity: Math.max(1, Number(item && item.quantity || 1)),
      unitPrice: Number(item && item.unitPrice || 0)
    };
  }

  function makeDocumentLineMarkup(prefix, item, index) {
    return [
      '<div class="admin-doc-line" data-doc-line="' + prefix + '-' + index + '">',
      '<input type="text" data-doc-field="description" placeholder="Description" value="' + String(item.description || '').replace(/"/g, '&quot;') + '" />',
      '<input type="number" data-doc-field="quantity" min="1" step="1" value="' + Number(item.quantity || 1) + '" />',
      '<input type="number" data-doc-field="unitPrice" min="0" step="0.01" value="' + Number(item.unitPrice || 0) + '" />',
      '<button class="btn btn-outline admin-doc-line-remove" type="button" data-doc-remove="' + prefix + '">Supprimer</button>',
      '</div>'
    ].join('');
  }

  function renderDocumentLines(prefix, node, items) {
    if (!node) return;
    const list = Array.isArray(items) && items.length ? items : [createDocumentLineItem()];
    node.innerHTML = list.map(function (item, index) {
      return makeDocumentLineMarkup(prefix, createDocumentLineItem(item), index);
    }).join('');
  }

  function readDocumentItems(node) {
    if (!node) return [];
    return Array.from(node.querySelectorAll('.admin-doc-line')).map(function (line) {
      return createDocumentLineItem({
        description: (line.querySelector('[data-doc-field="description"]') || {}).value || '',
        quantity: (line.querySelector('[data-doc-field="quantity"]') || {}).value || 1,
        unitPrice: (line.querySelector('[data-doc-field="unitPrice"]') || {}).value || 0
      });
    }).filter(function (item) {
      return item.description;
    });
  }

  function getDocumentTotal(items) {
    return items.reduce(function (sum, item) {
      return sum + (Number(item.quantity || 0) * Number(item.unitPrice || 0));
    }, 0);
  }

  function renderDocumentList(node, countNode, prefix, documents) {
    if (!node) return;
    const list = Array.isArray(documents) ? documents.slice() : [];
    if (countNode) {
      countNode.textContent = list.length + ' ' + (prefix === 'quote' ? 'devis' : 'facture' + (list.length > 1 ? 's' : ''));
      if (prefix === 'quote' && list.length > 1) countNode.textContent = list.length + ' devis';
    }
    if (!list.length) {
      node.innerHTML = '<article class="client-empty-card">Aucun document enregistré pour le moment.</article>';
      return;
    }
    node.innerHTML = list.map(function (doc) {
      const total = getDocumentTotal(Array.isArray(doc.items) ? doc.items : []);
      return [
        '<article class="client-panel-card admin-data-card">',
        '<div class="client-panel-top"><div><span class="client-kicker">' + (doc.reference || '-') + '</span><h3>' + (doc.customerName || 'Client') + '</h3></div><span class="client-status-chip is-in-progress">' + (doc.status || 'draft') + '</span></div>',
        '<div class="client-order-meta"><span>' + (doc.company || doc.email || '-') + '</span><span>' + formatDate(doc.issueDate) + '</span><span>' + formatPrice(total) + '</span></div>',
        '<p class="client-order-note">' + (doc.notes || '') + '</p>',
        '<div class="admin-inline-editor">',
        '<button class="btn btn-outline" type="button" data-admin-doc-edit="' + prefix + ':' + doc.id + '">Modifier</button>',
        '<button class="btn btn-outline admin-danger" type="button" data-admin-doc-delete="' + prefix + ':' + doc.id + '">Supprimer</button>',
        '</div>',
        '</article>'
      ].join('');
    }).join('');
  }

  function resetDocumentForm(form, node, submitNode, cancelNode, submitLabel, prefix) {
    if (!form) return;
    form.reset();
    if (form.id) form.id.value = '';
    renderDocumentLines(prefix, node, [createDocumentLineItem()]);
    if (submitNode) submitNode.textContent = submitLabel;
    if (cancelNode) cancelNode.hidden = true;
  }

  function fillDocumentForm(form, node, submitNode, cancelNode, submitLabel, prefix, document) {
    if (!form || !document) return;
    if (form.id) form.id.value = document.id || '';
    form.reference.value = document.reference || '';
    form.status.value = document.status || 'draft';
    form.customerName.value = document.customerName || '';
    form.company.value = document.company || '';
    form.email.value = document.email || '';
    form.phone.value = document.phone || '';
    form.address.value = document.address || '';
    form.issueDate.value = document.issueDate || '';
    form.dueDate.value = document.dueDate || '';
    form.notes.value = document.notes || '';
    renderDocumentLines(prefix, node, Array.isArray(document.items) && document.items.length ? document.items : [createDocumentLineItem()]);
    if (submitNode) submitNode.textContent = submitLabel;
    if (cancelNode) cancelNode.hidden = false;
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function getFilteredProducts() {
    let items = adminState.products.slice();
    const query = productsSearchInput ? String(productsSearchInput.value || '').trim().toLowerCase() : '';
    const category = productsCategoryFilter ? String(productsCategoryFilter.value || '') : '';
    const stock = productsStockFilter ? String(productsStockFilter.value || '') : '';
    const sort = productsSortFilter ? String(productsSortFilter.value || 'updatedAt-desc') : 'updatedAt-desc';

    if (query) {
      items = items.filter(function (product) {
        return [product.name, product.shortDescription, product.categoryLabel, product.category]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .indexOf(query) >= 0;
      });
    }
    if (category) {
      items = items.filter(function (product) {
        return String(product.category || '') === category;
      });
    }
    if (stock) {
      items = items.filter(function (product) {
        return String(product.stockStatus || 'in-stock') === stock;
      });
    }

    items.sort(function (a, b) {
      switch (sort) {
        case 'updatedAt-asc':
          return new Date(a.updatedAt || a.createdAt || 0) - new Date(b.updatedAt || b.createdAt || 0);
        case 'price-asc':
          return Number(a.price || 0) - Number(b.price || 0);
        case 'price-desc':
          return Number(b.price || 0) - Number(a.price || 0);
        case 'name-asc':
          return String(a.name || '').localeCompare(String(b.name || ''), 'fr');
        case 'name-desc':
          return String(b.name || '').localeCompare(String(a.name || ''), 'fr');
        case 'updatedAt-desc':
        default:
          return new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0);
      }
    });

    return items;
  }

  function renderProducts(products) {
    adminState.products = products.slice();
    adminState.currentPage = 1;
    refreshProductsView();
  }

  function refreshProductsView() {
    if (!productsNode) return;
    const products = getFilteredProducts();
    const totalPages = Math.max(1, Math.ceil(products.length / PRODUCTS_PER_PAGE));
    if (adminState.currentPage > totalPages) adminState.currentPage = totalPages;
    if (adminState.currentPage < 1) adminState.currentPage = 1;
    const start = (adminState.currentPage - 1) * PRODUCTS_PER_PAGE;
    const pagedProducts = products.slice(start, start + PRODUCTS_PER_PAGE);

    if (productsCountNode) {
      productsCountNode.textContent = products.length + ' article' + (products.length > 1 ? 's' : '');
    }
    if (productsPageNode) {
      productsPageNode.textContent = 'Page ' + adminState.currentPage + ' / ' + totalPages;
    }
    if (productsPrevButton) productsPrevButton.disabled = adminState.currentPage <= 1;
    if (productsNextButton) productsNextButton.disabled = adminState.currentPage >= totalPages;

    if (!pagedProducts.length) {
      productsNode.innerHTML = '<article class="client-empty-card">Aucun article ne correspond à ce filtre.</article>';
      return;
    }

    productsNode.innerHTML = pagedProducts.map(function (product) {
      const stockChip = product.stockStatus === 'out-of-stock'
        ? '<span class="client-status-chip is-warning">Hors stock</span>'
        : '<span class="client-status-chip is-success">En stock</span>';
      const galleryCount = Array.isArray(product.gallery) ? product.gallery.length : (product.image ? 1 : 0);
      const discountBadge = product.discountPercent > 0 ? '<span class="admin-discount-badge">-' + product.discountPercent + '%</span>' : '';
      const previewImage = product.image ? '<div class="admin-product-thumb">' + discountBadge + '<img src="' + product.image + '" alt="' + (product.imageAlt || product.name) + '" loading="lazy" /></div>' : '';
      const sizes = Array.isArray(product.sizes) && product.sizes.length ? product.sizes.join(', ') : 'Tailles à définir';
      const publicLink = publicCatalogueByCategory[product.category] || 'catalogue.html';
      const priceMarkup = product.discountPrice > 0
        ? '<span class="admin-card-price">' + formatPrice(product.discountPrice) + '</span><span class="admin-card-price-old">' + formatPrice(product.price) + '</span>'
        : '<span class="admin-card-price">' + formatPrice(product.price) + '</span>';
      return [
        '<article class="client-panel-card admin-data-card">',
        previewImage,
        '<div class="client-panel-top"><div><span class="client-kicker">' + formatCategory(product.category) + '</span><h3>' + product.name + '</h3></div>' + stockChip + '</div>',
        '<div class="client-order-meta"><span class="admin-card-prices">' + priceMarkup + '</span><span>' + sizes + '</span><span>' + galleryCount + ' photo(s)</span></div>',
        '<p class="client-order-note">' + (product.shortDescription || '') + '</p>',
        '<div class="admin-inline-editor">',
        '<a class="btn btn-outline" href="' + publicLink + '" target="_blank" rel="noopener">Voir sur le site</a>',
        '<button class="btn btn-outline" type="button" data-admin-product-edit="' + product.id + '">Modifier</button>',
        '<button class="btn btn-outline admin-danger" type="button" data-admin-product-delete="' + product.id + '">Supprimer</button>',
        '</div>',
        '</article>'
      ].join('');
    }).join('');
  }

  function renderImagePreviews(imageList, mode) {
    if (!productImagesPreview) return;
    const items = Array.isArray(imageList) ? imageList.filter(Boolean) : [];
    if (!items.length) {
      productImagesPreview.innerHTML = '<div class="admin-image-empty">Aucune photo sélectionnée.</div>';
      return;
    }
    productImagesPreview.innerHTML = items.map(function (item) {
      return [
        '<figure class="admin-image-preview-card">',
        '<img src="' + item.src + '" alt="' + (item.alt || 'Visuel produit') + '" loading="lazy" />',
        '<figcaption>' + (mode === 'existing' ? 'Photo enregistrée' : 'Nouvelle photo') + '</figcaption>',
        '</figure>'
      ].join('');
    }).join('');
  }

  function getCheckedSizes() {
    if (!productForm) return [];
    return Array.from(productForm.querySelectorAll('input[name="sizes"]:checked')).map(function (input) {
      return input.value;
    });
  }

  function setCheckedSizes(sizes) {
    const values = Array.isArray(sizes) ? sizes : [];
    if (!productForm) return;
    productForm.querySelectorAll('input[name="sizes"]').forEach(function (input) {
      input.checked = values.indexOf(input.value) >= 0;
    });
  }

  async function filesToPayload(fileList) {
    const files = Array.from(fileList || []).filter(function (file) {
      return file && /^image\//.test(file.type);
    });
    const payloads = await Promise.all(files.map(function (file) {
      return new Promise(function (resolve, reject) {
        const reader = new FileReader();
        reader.onload = function () {
          resolve({
            name: file.name,
            type: file.type,
            data: reader.result
          });
        };
        reader.onerror = function () {
          reject(new Error('Impossible de lire une des images sélectionnées.'));
        };
        reader.readAsDataURL(file);
      });
    }));
    return payloads;
  }

  function resetProductForm() {
    if (!productForm) return;
    productForm.reset();
    productForm.id.value = '';
    setCheckedSizes([]);
    renderImagePreviews([], 'new');
    if (productSubmit) productSubmit.textContent = "Ajouter l'article";
    if (productCancel) productCancel.hidden = true;
  }

  function fillProductForm(productId) {
    const product = adminState.products.find(function (entry) { return entry.id === productId; });
    if (!product || !productForm) return;
    productForm.id.value = product.id || '';
    productForm.name.value = product.name || '';
    productForm.category.value = product.category || '';
    productForm.price.value = product.price || 0;
    if (productForm.discountPrice) productForm.discountPrice.value = product.discountPrice || '';
    productForm.minimum.value = product.minimum || '';
    productForm.stockStatus.value = product.stockStatus || 'in-stock';
    productForm.colors.value = Array.isArray(product.colors) ? product.colors.join(', ') : '';
    productForm.shortDescription.value = product.shortDescription || '';
    productForm.description.value = product.description || '';
    setCheckedSizes(Array.isArray(product.sizes) ? product.sizes : []);
    if (productPhotosInput) productPhotosInput.value = '';
    renderImagePreviews((Array.isArray(product.gallery) ? product.gallery : [product.image]).filter(Boolean).map(function (src) {
      return { src: src, alt: product.imageAlt || product.name };
    }), 'existing');
    if (productSubmit) productSubmit.textContent = 'Enregistrer les modifications';
    if (productCancel) productCancel.hidden = false;
    productForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function applyHeroCopy() {
    if (!introNode) return;
    const messages = {
      overview: 'Pilotez l\'ensemble de l\'activité administrateur depuis un seul espace.',
      clients: 'Consultez les comptes clients particuliers et professionnels dans une vue dédiée.',
      commandes: 'Suivez l\'état de chaque commande et mettez à jour l\'avancement atelier.',
      sav: 'Centralisez les tickets SAV et gardez un historique propre des réponses envoyées.',
      articles: 'Retrouvez rapidement tous les articles mis en ligne avec une recherche et des filtres dédiés.',
      catalogue: 'Ajoutez, modifiez et supprimez les articles visibles sur le site depuis une page dédiée.'
    };
    introNode.textContent = messages[currentSection] || messages.overview;
  }

  async function hydrate() {
    try {
      const session = await auth.request('/api/admin/session');
      if (welcomeNode) welcomeNode.textContent = 'Administration MULTIPIXELS';
      applyHeroCopy();

      if (statsNode) {
        const dashboardPayload = await auth.request('/api/admin/dashboard');
        renderStats((dashboardPayload.dashboard && dashboardPayload.dashboard.stats) || {});
      }
      if (clientsNode) {
        const clientsPayload = await auth.request('/api/admin/clients');
        renderClients(clientsPayload.clients || []);
      }
      if (ordersNode) {
        const ordersPayload = await auth.request('/api/admin/orders');
        renderOrders(ordersPayload.orders || []);
      }
      if (ticketsNode) {
        const ticketsPayload = await auth.request('/api/admin/tickets');
        renderTickets(ticketsPayload.tickets || []);
      }
      if (productsNode || productForm) {
        const productsPayload = await auth.request('/api/admin/products');
        renderProducts(productsPayload.products || []);
      }

      setStatus('Accès administrateur actif pour ' + session.admin.email + '.', 'success');
    } catch (error) {
      const message = String((error && error.message) || '');
      if (/Connexion administrateur requise|Identifiants administrateur invalides|ADMIN_UNAUTHORIZED|unauthorized/i.test(message)) {
        window.location.href = 'admin.html';
        return;
      }
      setStatus(message || 'Une erreur administrateur est survenue.', 'error');
    }
  }


  function bindDocumentLineControls(node, prefix) {
    if (!node) return;
    node.addEventListener('click', function (event) {
      const removeButton = event.target.closest('[data-doc-remove]');
      if (!removeButton || removeButton.getAttribute('data-doc-remove') !== prefix) return;
      const lines = Array.from(node.querySelectorAll('.admin-doc-line'));
      const target = event.target.closest('.admin-doc-line');
      if (lines.length <= 1) {
        renderDocumentLines(prefix, node, [createDocumentLineItem()]);
        return;
      }
      if (target) target.remove();
    });
  }

  function getDocumentCollection(prefix) {
    return prefix === 'quote' ? adminState.quotes : adminState.invoices;
  }

  function setupDocumentForm(config) {
    const form = config.form;
    if (!form) return;
    resetDocumentForm(form, config.linesNode, config.submitNode, config.cancelNode, config.submitLabel, config.prefix);
    bindDocumentLineControls(config.linesNode, config.prefix);
    if (config.addLineButton) {
      config.addLineButton.addEventListener('click', function () {
        const currentItems = readDocumentItems(config.linesNode);
        currentItems.push(createDocumentLineItem());
        renderDocumentLines(config.prefix, config.linesNode, currentItems);
      });
    }
    if (config.cancelNode) {
      config.cancelNode.addEventListener('click', function () {
        resetDocumentForm(form, config.linesNode, config.submitNode, config.cancelNode, config.submitLabel, config.prefix);
      });
    }
    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      if (config.submitNode) config.submitNode.disabled = true;
      const payload = {
        id: form.id && form.id.value ? form.id.value : '',
        reference: form.reference.value || '',
        status: form.status.value || 'draft',
        customerName: form.customerName.value || '',
        company: form.company.value || '',
        email: form.email.value || '',
        phone: form.phone.value || '',
        address: form.address.value || '',
        issueDate: form.issueDate.value || '',
        dueDate: form.dueDate.value || '',
        notes: form.notes.value || '',
        items: readDocumentItems(config.linesNode)
      };
      const editing = !!payload.id;
      setStatus(editing ? config.updateMessage : config.createMessage, 'muted');
      try {
        const response = await auth.request(config.endpoint, {
          method: editing ? 'PATCH' : 'POST',
          body: JSON.stringify(payload)
        });
        if (config.prefix === 'quote') {
          adminState.quotes = response.quotes || [];
          renderDocumentList(quotesNode, quotesCountNode, 'quote', adminState.quotes);
        } else {
          adminState.invoices = response.invoices || [];
          renderDocumentList(invoicesNode, invoicesCountNode, 'invoice', adminState.invoices);
        }
        resetDocumentForm(form, config.linesNode, config.submitNode, config.cancelNode, config.submitLabel, config.prefix);
        setStatus(editing ? config.savedMessage : config.createdStatusMessage, 'success');
      } catch (error) {
        setStatus(error.message || config.errorMessage, 'error');
      } finally {
        if (config.submitNode) config.submitNode.disabled = false;
      }
    });
  }
  if (logoutButton) {
    logoutButton.addEventListener('click', async function () {
      await auth.logout();
      window.location.href = 'admin.html';
    });
  }

  [productsSearchInput, productsCategoryFilter, productsStockFilter, productsSortFilter].filter(Boolean).forEach(function (input) {
    input.addEventListener('input', function () {
      adminState.currentPage = 1;
      refreshProductsView();
    });
    input.addEventListener('change', function () {
      adminState.currentPage = 1;
      refreshProductsView();
    });
  });

  if (productsPrevButton) {
    productsPrevButton.addEventListener('click', function () {
      if (adminState.currentPage > 1) {
        adminState.currentPage -= 1;
        refreshProductsView();
      }
    });
  }

  if (productsNextButton) {
    productsNextButton.addEventListener('click', function () {
      adminState.currentPage += 1;
      refreshProductsView();
    });
  }

  if (productPhotosInput) {
    productPhotosInput.addEventListener('change', function () {
      const previews = Array.from(productPhotosInput.files || []).map(function (file) {
        return {
          src: URL.createObjectURL(file),
          alt: file.name
        };
      });
      renderImagePreviews(previews, 'new');
    });
  }

  if (productCancel) {
    productCancel.addEventListener('click', function () {
      resetProductForm();
    });
  }

  if (productForm) {
    productForm.addEventListener('submit', async function (event) {
      event.preventDefault();
      const submit = productForm.querySelector('button[type="submit"]');
      if (submit) submit.disabled = true;
      const formData = new FormData(productForm);
      const payload = {
        id: formData.get('id') || '',
        name: formData.get('name') || '',
        category: formData.get('category') || '',
        price: formData.get('price') || '',
        discountPrice: formData.get('discountPrice') || '',
        minimum: formData.get('minimum') || '',
        stockStatus: formData.get('stockStatus') || 'in-stock',
        colors: formData.get('colors') || '',
        shortDescription: formData.get('shortDescription') || '',
        description: formData.get('description') || '',
        sizes: getCheckedSizes()
      };
      const editing = !!payload.id;
      setStatus(editing ? 'Mise à jour du produit en cours...' : 'Ajout du produit en cours...', 'muted');
      try {
        payload.uploadedImages = await filesToPayload(productPhotosInput ? productPhotosInput.files : []);
        await auth.request('/api/admin/products', {
          method: editing ? 'PATCH' : 'POST',
          body: JSON.stringify(payload)
        });
        resetProductForm();
        await hydrate();
        setStatus(editing ? 'Produit mis à jour.' : 'Produit ajouté au catalogue admin.', 'success');
      } catch (error) {
        setStatus(error.message || 'Impossible d’enregistrer ce produit.', 'error');
      } finally {
        if (submit) submit.disabled = false;
      }
    });
  }

  if (productsNode) {
    productsNode.addEventListener('click', async function (event) {
      const editButton = event.target.closest('[data-admin-product-edit]');
      const deleteButton = event.target.closest('[data-admin-product-delete]');
      if (editButton) {
        if (productForm) {
          fillProductForm(editButton.getAttribute('data-admin-product-edit'));
        } else {
          window.location.href = 'admin-catalogue.html?edit=' + encodeURIComponent(editButton.getAttribute('data-admin-product-edit'));
        }
        return;
      }
      if (deleteButton) {
        const id = deleteButton.getAttribute('data-admin-product-delete');
        if (!window.confirm('Supprimer cet article du catalogue administré ?')) return;
        try {
          await auth.request('/api/admin/products?id=' + encodeURIComponent(id), { method: 'DELETE' });
          await hydrate();
          setStatus('Produit supprimé.', 'success');
        } catch (error) {
          setStatus(error.message || 'Impossible de supprimer ce produit.', 'error');
        }
      }
    });
  }

  if (ordersNode) {
    ordersNode.addEventListener('click', async function (event) {
      const saveButton = event.target.closest('[data-admin-order-save]');
      if (!saveButton) return;
      const id = saveButton.getAttribute('data-admin-order-save');
      const select = ordersNode.querySelector('[data-admin-order-status="' + id + '"]');
      if (!select) return;
      const parts = String(select.value || '').split('|');
      try {
        await auth.request('/api/admin/orders', {
          method: 'PATCH',
          body: JSON.stringify({
            id: id,
            status: parts[0] || 'pending',
            statusLabel: parts[1] || 'En attente',
            statusTone: parts[2] || 'pending'
          })
        });
        await hydrate();
        setStatus('Commande mise à jour.', 'success');
      } catch (error) {
        setStatus(error.message || 'Impossible de mettre à jour cette commande.', 'error');
      }
    });
  }

  if (ticketsNode) {
    ticketsNode.addEventListener('click', async function (event) {
      const saveButton = event.target.closest('[data-admin-ticket-save]');
      if (!saveButton) return;
      const id = saveButton.getAttribute('data-admin-ticket-save');
      const select = ticketsNode.querySelector('[data-admin-ticket-status="' + id + '"]');
      const reply = ticketsNode.querySelector('[data-admin-ticket-reply="' + id + '"]');
      if (!select || !reply) return;
      const parts = String(select.value || '').split('|');
      try {
        await auth.request('/api/admin/tickets', {
          method: 'PATCH',
          body: JSON.stringify({
            id: id,
            status: parts[0] || 'open',
            statusLabel: parts[1] || 'Ouvert',
            statusTone: parts[2] || 'in-progress',
            lastReply: reply.value
          })
        });
        await hydrate();
        setStatus('Ticket SAV mis à jour.', 'success');
      } catch (error) {
        setStatus(error.message || 'Impossible de mettre à jour ce ticket.', 'error');
      }
    });
  }

  if (productForm) {
    resetProductForm();
    const params = new URLSearchParams(window.location.search);
    const editId = params.get('edit');
    if (editId) {
      window.setTimeout(function () {
        fillProductForm(editId);
      }, 150);
    }
  }

  hydrate();
})();




