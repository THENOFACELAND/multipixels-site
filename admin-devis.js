(function setupAdminQuotesPage() {
  const auth = window.MultipixelsAdminAuth;
  if (!auth) return;

  const logoutButton = document.getElementById('admin-logout');
  const statusNode = document.getElementById('admin-status');
  const previewSheet = document.getElementById('quote-preview-sheet');
  const previewMeta = document.getElementById('quote-preview-meta');
  const form = document.getElementById('admin-quote-live-form');
  const lineItemsNode = document.getElementById('quote-lines');
  const addLineButton = document.getElementById('quote-add-line');
  const newButton = document.getElementById('quote-new');
  const recalcButton = document.getElementById('quote-recalc');
  const downloadButton = document.getElementById('quote-download');
  const idInput = document.getElementById('quote-id');
  const referenceInput = document.getElementById('quote-reference');
  const typeInput = document.getElementById('quote-type');
  const issueDateInput = document.getElementById('quote-issue-date');
  const vatRateInput = document.getElementById('quote-vat-rate');
  const paymentDaysInput = document.getElementById('quote-payment-days');
  const vatMentionInput = document.getElementById('quote-vat-mention');
  const approvedInput = document.getElementById('quote-approved');
  const customerNameInput = document.getElementById('quote-customer-name');
  const customerEmailInput = document.getElementById('quote-customer-email');
  const customerPhoneInput = document.getElementById('quote-customer-phone');
  const customerCompanyInput = document.getElementById('quote-customer-company');
  const address1Input = document.getElementById('quote-address-line1');
  const address2Input = document.getElementById('quote-address-line2');
  const postalCodeInput = document.getElementById('quote-postal-code');
  const cityInput = document.getElementById('quote-city');
  const countryInput = document.getElementById('quote-country');
  const clientSelect = document.getElementById('quote-client-select');
  const referenceSelect = document.getElementById('quote-reference-select');
  const accordionNodes = Array.from(document.querySelectorAll('.admin-invoice-accordion'));

  if (!form || !statusNode || !previewSheet) return;

  const LOGO_SRC = '/assets/Background/favicon.png';
  const SELLER_LINES = [
    '190 Chemin Blanc',
    '62180 Rang du Fliers',
    '06 27 14 08 40 | contact@multipixels.fr',
    'No SIRET : 80 49 81 835 0000 23',
    'Code APE: 18.12Z'
  ];
  const PAYMENT_LINES = [
    'Methodes de paiement acceptees :',
    '',
    'Cheque, Virement, Espece, CB',
    '',
    'VIREMENT BANCAIRE',
    'Banque : CA Nord de France',
    'IBAN : FR76 1670 6000 5154 0091 5025 361',
    'BIC : AGRIFRPP867',
    'Titulaire du compte : BAUDELOT Guillaume',
    '',
    'En cas de retard de paiement, une indemnite forfaitaire de 40 EUR pourra etre appliquee'
  ];

  let invoiceClients = [];
  let invoiceReferences = [];

  document.querySelectorAll('.reveal').forEach(function (node) {
    node.classList.add('is-visible');
  });

  function setOpenAccordion(targetKey) {
    accordionNodes.forEach(function (section) {
      const isOpen = !!targetKey && section.getAttribute('data-accordion') === targetKey;
      section.classList.toggle('is-open', isOpen);
      const button = section.querySelector('.admin-invoice-group-toggle');
      if (button) button.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });
  }

  accordionNodes.forEach(function (section, index) {
    const button = section.querySelector('.admin-invoice-group-toggle');
    if (!button) return;
    button.addEventListener('click', function () {
      const key = section.getAttribute('data-accordion');
      const isCurrentlyOpen = section.classList.contains('is-open');
      setOpenAccordion(isCurrentlyOpen ? '' : key);
    });
    if (index === 0) {
      section.classList.add('is-open');
      button.setAttribute('aria-expanded', 'true');
    } else {
      section.classList.remove('is-open');
      button.setAttribute('aria-expanded', 'false');
    }
  });

  function setStatus(message, tone) {
    statusNode.textContent = message || '';
    statusNode.className = 'client-auth-status';
    if (tone) statusNode.classList.add('is-' + tone);
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function formatDateFr(value) {
    if (!value) return '';
    const date = new Date(value + 'T00:00:00');
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat('fr-FR').format(date);
  }

  function formatMoney(value) {
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(Number(value || 0));
  }

  function todayIso() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return year + '-' + month + '-' + day;
  }

  function createLineItem(item) {
    const quantityRaw = Number(item && item.quantity || 1);
    const unitPriceRaw = Number(item && item.unitPrice || 0);
    return {
      reference: String(item && item.reference || ''),
      description: String(item && item.description || ''),
      quantity: Number.isFinite(quantityRaw) ? Math.max(1, quantityRaw) : 1,
      unitPrice: Number.isFinite(unitPriceRaw) ? unitPriceRaw : 0
    };
  }

  function getDiscountRate(item) {
    const key = String((item && item.reference) || '') + ' ' + String((item && item.description) || '');
    const normalized = key.toUpperCase();
    if (normalized.includes('REM10') || normalized.includes('-10%') || normalized.includes('REMISE 10')) return 0.10;
    if (normalized.includes('REM5') || normalized.includes('-5%') || normalized.includes('REMISE 5')) return 0.05;
    return 0;
  }

  function computeQuoteItems(rawItems) {
    const source = Array.isArray(rawItems) ? rawItems : [];
    const prepared = source.map(function (item) {
      const quantity = Math.max(1, Number(item && item.quantity || 1));
      const unitPrice = Number(item && item.unitPrice || 0);
      return {
        reference: String(item && item.reference || '').trim(),
        description: String(item && item.description || '').trim(),
        quantity: Number.isFinite(quantity) ? quantity : 1,
        unitPrice: Number.isFinite(unitPrice) ? unitPrice : 0,
        discountRate: getDiscountRate(item)
      };
    }).filter(function (item) {
      return item.reference || item.description;
    });

    const baseSubtotal = Number(prepared.reduce(function (sum, item) {
      if (item.discountRate > 0) return sum;
      return sum + (item.quantity * item.unitPrice);
    }, 0).toFixed(2));

    return prepared.map(function (item) {
      if (item.discountRate > 0) {
        const discountAmount = Number((-baseSubtotal * item.discountRate).toFixed(2));
        return {
          reference: item.reference,
          description: item.description,
          quantity: 1,
          unitPrice: discountAmount,
          total: discountAmount
        };
      }
      const unitPrice = Number(item.unitPrice.toFixed(2));
      const total = Number((item.quantity * unitPrice).toFixed(2));
      return {
        reference: item.reference,
        description: item.description,
        quantity: item.quantity,
        unitPrice: unitPrice,
        total: total
      };
    });
  }

  function renderQuoteDataSelects() {
    if (clientSelect) {
      clientSelect.innerHTML = '<option value="">Saisie manuelle</option>' + invoiceClients.map(function (client) {
        return '<option value="' + escapeHtml(client.id) + '">' + escapeHtml(client.name) + (client.email ? ' - ' + escapeHtml(client.email) : '') + '</option>';
      }).join('');
    }
    if (referenceSelect) {
      referenceSelect.innerHTML = '<option value="">Choisir une reference</option>' + invoiceReferences.map(function (item) {
        return '<option value="' + escapeHtml(item.id) + '">' + escapeHtml(item.reference) + ' - ' + escapeHtml(item.designation) + ' (' + formatMoney(item.price) + ')</option>';
      }).join('');
    }
  }

  async function loadQuoteDataSources() {
    try {
      const clientsPayload = await auth.request('/api/admin/invoice-clients');
      invoiceClients = clientsPayload.clients || [];
    } catch (_) {
      invoiceClients = [];
    }
    try {
      const referencesPayload = await auth.request('/api/admin/invoice-references');
      invoiceReferences = referencesPayload.references || [];
    } catch (_) {
      invoiceReferences = [];
    }
    renderQuoteDataSelects();
  }

  function applyClient(client) {
    if (!client) return;
    customerNameInput.value = client.name || '';
    customerEmailInput.value = client.email || '';
    customerPhoneInput.value = client.phone || '';
    customerCompanyInput.value = client.company || '';
    address1Input.value = client.addressLine1 || '';
    address2Input.value = client.addressLine2 || '';
    postalCodeInput.value = client.postalCode || '';
    cityInput.value = client.city || '';
    countryInput.value = client.country || 'France';
    renderPreview();
  }

  function addReferenceLine(reference) {
    if (!reference) return;
    const lines = readLineItems();
    lines.push(createLineItem({
      reference: reference.reference || '',
      description: reference.designation || '',
      quantity: 1,
      unitPrice: Number(reference.price || 0)
    }));
    renderLineItems(lines.length ? lines : [createLineItem()]);
    renderPreview();
  }

  function renderLineItems(items) {
    const source = Array.isArray(items) && items.length ? items : [createLineItem()];
    lineItemsNode.innerHTML = source.map(function (item, index) {
      return [
        '<div class="admin-invoice-line" data-line-index="' + index + '">',
        '<label class="admin-invoice-line-field admin-invoice-line-field-reference"><span>Reference</span><input type="text" data-line-field="reference" value="' + escapeHtml(item.reference) + '" /></label>',
        '<label class="admin-invoice-line-field admin-invoice-line-field-quantity"><span>Qte</span><input type="number" min="1" step="1" data-line-field="quantity" value="' + item.quantity + '" /></label>',
        '<label class="admin-invoice-line-field admin-invoice-line-field-price"><span>Prix unitaire</span><input type="number" min="0" step="0.01" data-line-field="unitPrice" value="' + item.unitPrice + '" /></label>',
        '<button class="btn btn-outline admin-invoice-line-remove" type="button" data-line-remove="' + index + '">Supprimer</button>',
        '<label class="admin-invoice-line-field admin-invoice-line-field-description"><span>Description</span><input type="text" data-line-field="description" value="' + escapeHtml(item.description) + '" /></label>',
        '</div>'
      ].join('');
    }).join('');
  }

  function readLineItems() {
    return Array.from(lineItemsNode.querySelectorAll('.admin-invoice-line')).map(function (line) {
      return createLineItem({
        reference: (line.querySelector('[data-line-field="reference"]') || {}).value,
        description: (line.querySelector('[data-line-field="description"]') || {}).value,
        quantity: (line.querySelector('[data-line-field="quantity"]') || {}).value,
        unitPrice: (line.querySelector('[data-line-field="unitPrice"]') || {}).value
      });
    }).filter(function (item) {
      return item.reference || item.description;
    });
  }

  function collectState() {
    const issueDate = issueDateInput.value || todayIso();
    const validityDays = Math.max(0, Number(paymentDaysInput.value || 0));
    const items = computeQuoteItems(readLineItems());
    const total = Number(items.reduce(function (sum, item) { return sum + item.total; }, 0).toFixed(2));
    const vatRate = Math.max(0, Number(vatRateInput.value || 0));

    return {
      id: idInput.value || '',
      type: typeInput.value,
      reference: referenceInput.value,
      issueDate: issueDate,
      paymentDueDays: validityDays,
      vatRate: vatRate,
      vatMention: vatMentionInput.value.trim(),
      isApproved: approvedInput.checked,
      customerName: customerNameInput.value.trim(),
      company: customerCompanyInput.value.trim(),
      email: customerEmailInput.value.trim(),
      phone: customerPhoneInput.value.trim(),
      addressLine1: address1Input.value.trim(),
      addressLine2: address2Input.value.trim(),
      postalCode: postalCodeInput.value.trim(),
      city: cityInput.value.trim(),
      country: countryInput.value.trim() || 'France',
      items: items,
      total: total
    };
  }

  function renderPreview() {
    const state = collectState();
    const addressLines = [state.customerName, state.company, state.email, state.addressLine1, state.addressLine2, [state.postalCode, state.city].filter(Boolean).join(' '), state.country].filter(Boolean);
    const validityText = 'Validite du devis : ' + state.paymentDueDays + ' jours';
    const linesMarkup = state.items.length
      ? state.items.map(function (item) {
          return '<tr><td>' + escapeHtml(item.reference || '-') + '</td><td>' + escapeHtml(item.description || '-') + '</td><td>' + item.quantity + '</td><td>' + formatMoney(item.unitPrice) + '</td><td>' + formatMoney(item.total) + '</td></tr>';
        }).join('')
      : '<tr><td>-</td><td>Aucune ligne pour le moment</td><td>0</td><td>' + formatMoney(0) + '</td><td>' + formatMoney(0) + '</td></tr>';

    previewMeta.textContent = 'Devis ' + (state.reference || '-') + ' | Date ' + formatDateFr(state.issueDate);
    previewSheet.innerHTML = [
      '<section class="invoice-sheet-top">',
      '  <div>',
      '    <div class="invoice-brand">',
      '      <div class="invoice-brand-logo"><img src="' + LOGO_SRC + '" alt="Logo MULTIPIXELS" /></div>',
      '      <h1>MULTIPIXELS.FR</h1>',
      '      <p>votre expert textile</p>',
      '    </div>',
      '    <div class="invoice-seller">' + SELLER_LINES.map(escapeHtml).join('<br />') + '</div>',
      '  </div>',
      '  <div class="invoice-address-box">',
      '    <h3>Information client</h3>',
      '    <div class="body">' + (addressLines.length ? addressLines.map(escapeHtml).join('<br />') : 'Informations client a completer') + '</div>',
      '  </div>',
      '</section>',
      '  <section class="invoice-meta-box">',
      '    <table class="invoice-meta-table">',
      '      <tr><th colspan="2">DEVIS No ' + escapeHtml(state.reference || '-') + '</th></tr>',
      '      <tr><td>Date du devis</td><td><strong>' + escapeHtml(formatDateFr(state.issueDate)) + '</strong></td></tr>',
      '      <tr><td colspan="2">' + escapeHtml(validityText) + '</td></tr>',
      '    </table>',
      '  </section>',
      '  <section class="invoice-lines">',
      '    <table class="invoice-lines-table">',
      '      <thead><tr><th>Reference</th><th>Description</th><th>Qte</th><th>Prix unitaire</th><th>Total TTC</th></tr></thead>',
      '      <tbody>' + linesMarkup + '</tbody>',
      '    </table>',
      '  </section>',
      '  <section class="invoice-bottom">',
      '    <div class="invoice-payment-box">',
      '      <h3>Conditions de paiement</h3>',
      '      <div class="body">',
      '        <div>' + PAYMENT_LINES.slice(0, 3).map(escapeHtml).join('<br />') + '</div>',
      '        <div class="invoice-payment-bank">' + escapeHtml(PAYMENT_LINES.slice(4).join('\n')) + '</div>',
      '      </div>',
      '    </div>',
      '    <div class="invoice-side-stack">',
      '      <div class="invoice-total-box">',
      '        <h3>Total TTC</h3>',
      '        <div class="body">',
      '          <div class="invoice-total-amount">' + escapeHtml(formatMoney(state.total)) + '</div>',
      '          <div class="invoice-total-note">' + escapeHtml(state.vatRate > 0 ? ('TVA ' + state.vatRate + ' % appliquee') : state.vatMention) + '</div>',
      '          <div class="invoice-total-note">' + (state.isApproved ? 'Devis marque comme accepte' : 'En attente de validation') + '</div>',
      '        </div>',
      '      </div>',
      '      <div class="invoice-signature-box">',
      '        <h3>Mention Bon pour accord + Signature</h3>',
      '        <div class="body">',
      '          <div></div>',
      '          <div class="invoice-signature-date">Date ___ / ___ / ______</div>',
      '        </div>',
      '      </div>',
      '    </div>',
      '  </section>',
      '  <div class="invoice-sheet-footer">www.multipixels.fr</div>'
    ].join('');
  }

  async function refreshReference() {
    const issueDate = issueDateInput.value || todayIso();
    try {
      const currentReference = referenceInput.value || '';
      const payload = await auth.request('/api/admin/quotes/next-reference?issueDate=' + encodeURIComponent(issueDate) + (idInput.value ? '&id=' + encodeURIComponent(idInput.value) : '') + (currentReference ? '&current=' + encodeURIComponent(currentReference) : '')); 
      var nextReference = payload.reference;
if (currentReference && nextReference === currentReference) {
var match = String(currentReference).match(/^(\\d+)-(\\d{6})$/);
if (match) {
nextReference = String(Number(match[1] || 0) + 1) + '-' + match[2];
}
}
referenceInput.value = nextReference;
      renderPreview();
    } catch (error) {
      setStatus(error.message || 'Impossible de calculer le numero de devis.', 'error');
    }
  }

  function resetForm(presetReference) {
    idInput.value = '';
    typeInput.value = 'Devis';
    issueDateInput.value = todayIso();
    vatRateInput.value = '0';
    paymentDaysInput.value = '15';
    vatMentionInput.value = 'TVA non applicable, art. 293B du CGI';
    approvedInput.checked = false;
    customerNameInput.value = '';
    customerEmailInput.value = '';
    customerPhoneInput.value = '';
    customerCompanyInput.value = '';
    address1Input.value = '';
    address2Input.value = '';
    postalCodeInput.value = '';
    cityInput.value = '';
    countryInput.value = 'France';
    if (clientSelect) clientSelect.value = '';
    renderLineItems([{ reference: '', description: '', quantity: 1, unitPrice: 0 }]);
    setStatus('', '');
    if (presetReference) {
      referenceInput.value = presetReference;
      renderPreview();
      return;
    }
    refreshReference();
  }

  async function boot() {
    try {
      await auth.request('/api/admin/session');
      await loadQuoteDataSources();
    } catch (_) {
      window.location.href = 'admin.html';
      return;
    }
    resetForm();
    renderPreview();
  }

  if (logoutButton) {
    logoutButton.addEventListener('click', async function () {
      await auth.logout();
      window.location.href = 'admin.html';
    });
  }

  addLineButton.addEventListener('click', function () {
    const lines = readLineItems();
    lines.push(createLineItem());
    renderLineItems(lines);
    renderPreview();
  });

  lineItemsNode.addEventListener('click', function (event) {
    const removeButton = event.target.closest('[data-line-remove]');
    if (!removeButton) return;
    const index = Number(removeButton.getAttribute('data-line-remove'));
    const lines = readLineItems();
    lines.splice(index, 1);
    renderLineItems(lines.length ? lines : [createLineItem()]);
    renderPreview();
  });

  lineItemsNode.addEventListener('input', renderPreview);
  form.addEventListener('input', renderPreview);
  issueDateInput.addEventListener('change', refreshReference);
  newButton.addEventListener('click', function () { resetForm(); });
  if (recalcButton) {
    recalcButton.addEventListener('click', function () {
      refreshReference();
    });
  }

  if (clientSelect) {
    clientSelect.addEventListener('change', function () {
      const selected = invoiceClients.find(function (client) { return client.id === clientSelect.value; });
      applyClient(selected);
    });
  }

  if (referenceSelect) {
    referenceSelect.addEventListener('change', function () {
      const selected = invoiceReferences.find(function (item) { return item.id === referenceSelect.value; });
      addReferenceLine(selected);
      referenceSelect.value = '';
    });
  }

  downloadButton.addEventListener('click', async function () {
    const payload = collectState();
    if (!payload.customerName) return setStatus('Le nom du client est obligatoire.', 'error');
    if (!payload.items.length) return setStatus('Ajoutez au moins une ligne au devis.', 'error');

    setStatus('Generation du PDF en cours...', 'warning');
    try {
      const token = localStorage.getItem(auth.tokenKey || 'multipixels_admin_token');
      const response = await fetch('/api/admin/quotes/pdf', {
        method: 'POST',
        headers: Object.assign(
          {
            'Content-Type': 'application/json'
          },
          token
            ? {
                Authorization: 'Bearer ' + token
              }
            : {}
        ),
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        const data = await response.json().catch(function () { return null; });
        throw new Error((data && data.error && data.error.message) || 'Impossible de generer le PDF.');
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const filename = response.headers.get('X-Quote-Filename') || 'devis.pdf';
      const nextReference = response.headers.get('X-Next-Quote-Reference') || '';
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(function () {
        URL.revokeObjectURL(objectUrl);
      }, 1000);
      resetForm(nextReference || '');
      setStatus('PDF du devis genere avec succes.' + (nextReference ? ' Prochaine reference : ' + nextReference + '.' : ''), 'success');
    } catch (error) {
      setStatus(error.message || 'Impossible de generer le PDF.', 'error');
    }
  });

  boot();
})();





