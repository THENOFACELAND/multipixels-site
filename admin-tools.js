const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeLine(value, maxLen) {
  return normalizeText(value).replace(/\r\n/g, ' ').slice(0, maxLen || 200);
}

function slugify(value) {
  return normalizeText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'article';
}

function splitList(value) {
  return String(value || '')
    .split(',')
    .map((item) => normalizeText(item))
    .filter(Boolean);
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function ensureJsonFile(filePath, fallback) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(fallback, null, 2), 'utf8');
  }
}

function parseJsonSafe(value, fallback) {
  try {
    return value JSON.parse(value) : fallback;
  } catch (_) {
    return fallback;
  }
}

function createAdminTools(options) {
  const root = options.root;
  const env = options.env || process.env;
  const dataDir = env.MULTIPIXELS_DATA_DIR || env.DATA_DIR || env.RAILWAY_VOLUME_MOUNT_PATH || path.join(root, 'assets', 'data');
  const dbPath = path.join(dataDir, 'client-space.sqlite');
  const productsPath = path.join(dataDir, 'admin-products.json');
  const documentsPath = path.join(dataDir, 'admin-documents.json');
  const sessionTtlMs = 1000 * 60 * 60 * 12;
  const adminSessionSecret = String(env.ADMIN_SESSION_SECRET || (String(env.ADMIN_PASSWORD || 'Brucamps80690') + '|' + String(env.ADMIN_EMAIL || 'contact@multipixels.fr')));

  ensureJsonFile(productsPath, { products: [] });

  function getAdminCredentials() {
    return {
      email: normalizeText(env.ADMIN_EMAIL || 'contact@multipixels.fr').toLowerCase(),
      password: String(env.ADMIN_PASSWORD || 'Brucamps80690')
    };
  }

  function openDb() {
    return new DatabaseSync(dbPath);
  }

  function toBase64Url(value) {
    return Buffer.from(String(value || ''), 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  function fromBase64Url(value) {
    const input = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
    const padding = input.length % 4 === 0 '' : '='.repeat(4 - (input.length % 4));
    return Buffer.from(input + padding, 'base64').toString('utf8');
  }

  function signAdminToken(payload) {
    const body = toBase64Url(JSON.stringify(payload));
    const signature = crypto.createHmac('sha256', adminSessionSecret).update(body).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    return body + '.' + signature;
  }

  function readAdminToken(token) {
    const raw = String(token || '').trim();
    if (!raw || raw.indexOf('.') < 0) return null;
    const parts = raw.split('.');
    if (parts.length !== 2) return null;
    const body = parts[0];
    const signature = parts[1];
    const expected = crypto.createHmac('sha256', adminSessionSecret).update(body).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    if (!safeEqual(signature, expected)) return null;
    try {
      const payload = JSON.parse(fromBase64Url(body));
      if (!payload || !payload.exp || Number(payload.exp) <= Date.now()) return null;
      return payload;
    } catch (_) {
      return null;
    }
  }

  function createSession() {
    const creds = getAdminCredentials();
    const now = Date.now();
    return signAdminToken({
      email: creds.email,
      createdAt: new Date(now).toISOString(),
      exp: now + sessionTtlMs
    });
  }

  function getSession(token) {
    const session = readAdminToken(token);
    if (!session) return null;
    return {
      email: session.email,
      createdAt: session.createdAt
    };
  }

  function login(email, password) {
    const creds = getAdminCredentials();
    const isValid = safeEqual(String(email || '').toLowerCase(), creds.email) && safeEqual(password, creds.password);
    if (!isValid) return null;
    const token = createSession();
    return {
      token,
      admin: {
        email: creds.email,
        role: 'super-admin',
        displayName: 'Administration MULTIPIXELS'
      }
    };
  }

  function logout() {
    return true;
  }

  function readProductsStore() {
    ensureJsonFile(productsPath, { products: [] });
    try {
      const raw = fs.readFileSync(productsPath, 'utf8').replace(/^\uFEFF/, '');
      const parsed = JSON.parse(raw);
      return { products: Array.isArray(parsed.products) parsed.products : [] };
    } catch (_) {
      return { products: [] };
    }
  }

  function writeProductsStore(payload) {
    fs.writeFileSync(productsPath, JSON.stringify(payload, null, 2), 'utf8');
  }

  function listClients() {
    const db = openDb();
    try {
      return db.prepare(`
        SELECT
          u.id,
          u.accountType,
          u.firstName,
          u.lastName,
          u.company,
          u.email,
          u.phone,
          u.addressLine1,
          u.addressLine2,
          u.createdAt,
          u.lastLoginAt,
          COUNT(DISTINCT o.id) AS ordersCount,
          COUNT(DISTINCT t.id) AS ticketsCount
        FROM client_users u
        LEFT JOIN client_orders o ON o.userId = u.id
        LEFT JOIN client_tickets t ON t.userId = u.id
        GROUP BY u.id
        ORDER BY datetime(u.createdAt) DESC
      `).all().map((row) => ({
        id: row.id,
        accountType: row.accountType,
        firstName: row.firstName,
        lastName: row.lastName,
        company: row.company || '',
        email: row.email,
        phone: row.phone || '',
        addressLine1: row.addressLine1 || '',
        addressLine2: row.addressLine2 || '',
        createdAt: row.createdAt,
        lastLoginAt: row.lastLoginAt || '',
        ordersCount: Number(row.ordersCount || 0),
        ticketsCount: Number(row.ticketsCount || 0)
      }));
    } finally {
      db.close();
    }
  }

  function listOrders() {
    const db = openDb();
    try {
      return db.prepare(`
        SELECT o.*, u.firstName, u.lastName, u.company, u.email
        FROM client_orders o
        LEFT JOIN client_users u ON u.id = o.userId
        ORDER BY datetime(o.updatedAt) DESC
      `).all().map((row) => ({
        id: row.id,
        reference: row.reference,
        title: row.title,
        status: row.status,
        statusLabel: row.statusLabel,
        statusTone: row.statusTone,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        estimatedShipDate: row.estimatedShipDate || '',
        total: Number(row.total || 0),
        deliveryMode: row.deliveryMode || '',
        clientNote: row.clientNote || '',
        customerName: [row.firstName, row.lastName].filter(Boolean).join(' ').trim() || row.company || row.email || 'Client',
        customerEmail: row.email || '',
        items: parseJsonSafe(row.itemsJson, []),
        timeline: parseJsonSafe(row.timelineJson, [])
      }));
    } finally {
      db.close();
    }
  }

  function listTickets() {
    const db = openDb();
    try {
      return db.prepare(`
        SELECT t.*, u.firstName, u.lastName, u.company, u.email
        FROM client_tickets t
        LEFT JOIN client_users u ON u.id = t.userId
        ORDER BY datetime(t.updatedAt) DESC
      `).all().map((row) => ({
        id: row.id,
        orderReference: row.orderReference || '',
        subject: row.subject,
        category: row.category,
        status: row.status,
        statusLabel: row.statusLabel,
        statusTone: row.statusTone,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        messagePreview: row.messagePreview || '',
        lastReply: row.lastReply || '',
        customerName: [row.firstName, row.lastName].filter(Boolean).join(' ').trim() || row.company || row.email || 'Client',
        customerEmail: row.email || ''
      }));
    } finally {
      db.close();
    }
  }

  function getDashboard() {
    const clients = listClients();
    const orders = listOrders();
    const tickets = listTickets();
    const products = readProductsStore().products;
    return {
      stats: {
        totalClients: clients.length,
        totalOrders: orders.length,
        activeOrders: orders.filter((order) => order.status !== 'delivered' && order.status !== 'closed').length,
        openTickets: tickets.filter((ticket) => ticket.status !== 'closed').length,
        managedProducts: products.length
      },
      recentOrders: orders.slice(0, 8),
      recentTickets: tickets.slice(0, 8),
      recentClients: clients.slice(0, 8),
      products
    };
  }

  function listProducts() {
    return readProductsStore().products;
  }

    const PRODUCT_CATEGORY_CONFIG = {
    homme: { label: 'Homme', segments: ['homme'] },
    femme: { label: 'Femme', segments: ['femme'] },
    enfant: { label: 'Enfant', segments: ['enfant'] },
    accessoires: { label: 'Accessoires', segments: ['accessoire'] },
    'vetement-travail': { label: 'Vêtement de travail', segments: ['workwear'] }
  };
  const PRODUCT_SIZE_OPTIONS = ['S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL'];

  function normalizeCategory(value, previousCategory) {
    const raw = slugify(value || previousCategory || 'homme');
    if (raw === 'accessoire') return 'accessoires';
    if (raw === 'vetement-de-travail' || raw === 'workwear') return 'vetement-travail';
    if (Object.prototype.hasOwnProperty.call(PRODUCT_CATEGORY_CONFIG, raw)) return raw;
    return Object.prototype.hasOwnProperty.call(PRODUCT_CATEGORY_CONFIG, previousCategory || '') previousCategory : 'homme';
  }

  function normalizeSizes(value, previous) {
    const source = Array.isArray(value) value : splitList(value || (Array.isArray(previous) previous.join(',') : previous));
    return source
      .map((item) => String(item || '').trim().toUpperCase())
      .filter((item, index, array) => PRODUCT_SIZE_OPTIONS.includes(item) && array.indexOf(item) === index);
  }

  function decodeImageDataUri(value) {
    const match = String(value || '').match(/^data:(image\/(:png|jpeg|webp));base64,(.+)$/);
    if (!match) return null;
    const extension = match[1] === 'image/png' 'png' : match[1] === 'image/webp' 'webp' : 'jpg';
    return {
      extension,
      buffer: Buffer.from(match[2], 'base64')
    };
  }

  function saveUploadedImages(uploadedImages, productSlug) {
    const images = Array.isArray(uploadedImages) uploadedImages : [];
    if (!images.length) return [];
    const uploadsDir = path.join(root, 'assets', 'uploads', 'catalogue-admin');
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
    return images.map((entry, index) => {
      const decoded = decodeImageDataUri(entry && entry.data);
      if (!decoded) return null;
      const filename = `${productSlug || 'produit'}-${Date.now()}-${index + 1}-${crypto.randomBytes(3).toString('hex')}.${decoded.extension}`;
      fs.writeFileSync(path.join(uploadsDir, filename), decoded.buffer);
      return `assets/uploads/catalogue-admin/${filename}`;
    }).filter(Boolean);
  }

  function normalizeProductPayload(payload, previous) {
    const baseName = normalizeLine(payload.name || (previous && previous.name), 140);
    const category = normalizeCategory(payload.category, previous && previous.category);
    const slug = slugify(payload.slug || (previous && previous.slug) || baseName);
    const uploadedGallery = saveUploadedImages(payload.uploadedImages, slug);
    const previousGallery = Array.isArray(previous && previous.gallery) previous.gallery.filter(Boolean) : [];
    const legacyImage = normalizeLine(payload.image || (previous && previous.image), 260);
    const gallery = uploadedGallery.length
      uploadedGallery
      : (previousGallery.length previousGallery : (legacyImage [legacyImage] : []));
    const stockStatus = String(payload.stockStatus || (previous && previous.stockStatus) || 'in-stock').toLowerCase() === 'out-of-stock'
      'out-of-stock'
      : 'in-stock';
    const sizes = normalizeSizes(payload.sizes, previous && previous.sizes);
    const basePrice = Math.max(0, Number(payload.price != null && payload.price !== '' payload.price : (previous && previous.price) || 0));
    const discountPrice = Math.max(0, Number(payload.discountPrice != null && payload.discountPrice !== '' payload.discountPrice : (previous && previous.discountPrice) || 0));
    const discountPercent = basePrice > 0 && discountPrice > 0 && discountPrice < basePrice Math.round(((basePrice - discountPrice) / basePrice) * 100) : 0;
    return {
      id: previous previous.id : slugify(payload.id || ((payload.slug || baseName) + '-' + Date.now())),
      slug,
      name: baseName,
      category,
      categoryLabel: PRODUCT_CATEGORY_CONFIG[category].label,
      segmentGroups: PRODUCT_CATEGORY_CONFIG[category].segments,
      audience: normalizeLine(payload.audience || (previous && previous.audience) || PRODUCT_CATEGORY_CONFIG[category].label, 140),
      price: basePrice,
      discountPrice: discountPercent > 0 discountPrice : 0,
      discountPercent,
      minimum: normalizeLine(payload.minimum || (previous && previous.minimum) || 'À partir de 1 pièce', 80),
      image: gallery[0] || '',
      gallery,
      imageAlt: normalizeLine(payload.imageAlt || (previous && previous.imageAlt) || baseName, 160),
      shortDescription: normalizeLine(payload.shortDescription || (previous && previous.shortDescription), 240),
      description: normalizeLine(payload.description || (previous && previous.description), 600),
      techniques: splitList(payload.techniques || (previous && previous.techniques previous.techniques.join(',') : '')),
      colors: splitList(payload.colors || (previous && previous.colors previous.colors.join(',') : '')),
      sizes,
      stockStatus,
      stockLabel: stockStatus === 'out-of-stock' 'Hors stock' : 'En stock',
      featured: String(payload.featured != null payload.featured : (previous && previous.featured)).toLowerCase() === 'true' || payload.featured === true,
      localSeo: normalizeLine(payload.localSeo || (previous && previous.localSeo), 200),
      createdAt: previous previous.createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      source: 'admin'
    };
  }
  function createProduct(payload) {
    const store = readProductsStore();
    const product = normalizeProductPayload(payload);
    store.products.unshift(product);
    writeProductsStore(store);
    return product;
  }

  function updateProduct(productId, payload) {
    const store = readProductsStore();
    const index = store.products.findIndex((product) => product.id === String(productId));
    if (index === -1) return null;
    const updated = normalizeProductPayload(payload, store.products[index]);
    store.products[index] = updated;
    writeProductsStore(store);
    return updated;
  }

  function deleteProduct(productId) {
    const store = readProductsStore();
    const nextProducts = store.products.filter((product) => product.id !== String(productId));
    const changed = nextProducts.length !== store.products.length;
    if (!changed) return false;
    writeProductsStore({ products: nextProducts });
    return true;
  }


  function readDocumentsStore() {
    ensureJsonFile(documentsPath, { quotes: [], invoices: [], invoiceClients: [], invoiceReferences: [] });
    try {
      const raw = fs.readFileSync(documentsPath, 'utf8').replace(/^\uFEFF/, '');
      const parsed = JSON.parse(raw);
      return {
        quotes: Array.isArray(parsed.quotes) parsed.quotes : [],
        invoices: Array.isArray(parsed.invoices) parsed.invoices : [],
        invoiceClients: Array.isArray(parsed.invoiceClients) parsed.invoiceClients : [],
        invoiceReferences: Array.isArray(parsed.invoiceReferences) parsed.invoiceReferences : []
      };
    } catch (_) {
      return { quotes: [], invoices: [], invoiceClients: [], invoiceReferences: [] };
    }
  }

  function writeDocumentsStore(payload) {
    fs.writeFileSync(documentsPath, JSON.stringify(payload, null, 2), 'utf8');
  }

  function normalizeDocumentItems(items, previousItems) {
    const source = Array.isArray(items) && items.length items : (Array.isArray(previousItems) previousItems : []);
    return source
      .map((item) => ({
        description: normalizeLine(item && item.description, 240),
        quantity: Math.max(1, Number(item && item.quantity || 1)),
        unitPrice: Math.max(0, Number(item && item.unitPrice || 0))
      }))
      .filter((item) => item.description)
      .map((item) => ({
        description: item.description,
        quantity: item.quantity,
        unitPrice: Number(item.unitPrice.toFixed(2)),
        total: Number((item.quantity * item.unitPrice).toFixed(2))
      }));
  }

  function createId(prefix) {
    return String(prefix || 'item') + '_' + crypto.randomBytes(8).toString('hex');
  }

  function normalizeDocumentPayload(type, payload, previous) {
    const items = normalizeDocumentItems(payload.items, previous && previous.items);
    const total = Number(items.reduce((sum, item) => sum + item.total, 0).toFixed(2));
    const prefix = type === 'invoice' 'FAC' : 'DEV';
    const sequence = String(Date.now()).slice(-6);
    return {
      id: previous previous.id : createId(type),
      reference: normalizeLine(payload.reference || (previous && previous.reference) || (prefix + '-' + sequence), 80),
      type,
      customerName: normalizeLine(payload.customerName || (previous && previous.customerName), 140),
      company: normalizeLine(payload.company || (previous && previous.company), 140),
      email: normalizeLine(payload.email || (previous && previous.email), 180),
      phone: normalizeLine(payload.phone || (previous && previous.phone), 40),
      address: normalizeLine(payload.address || (previous && previous.address), 260),
      issueDate: normalizeLine(payload.issueDate || (previous && previous.issueDate) || new Date().toISOString().slice(0, 10), 40),
      dueDate: normalizeLine(payload.dueDate || (previous && previous.dueDate), 40),
      status: normalizeLine(payload.status || (previous && previous.status) || 'draft', 40),
      notes: normalizeLine(payload.notes || (previous && previous.notes), 1200),
      items,
      total,
      createdAt: previous previous.createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }

  function listDocuments(type) {
    const store = readDocumentsStore();
    const key = type === 'invoice' 'invoices' : 'quotes';
    return store[key].slice().sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0));
  }

  function createDocument(type, payload) {
    const store = readDocumentsStore();
    const key = type === 'invoice' 'invoices' : 'quotes';
    const document = normalizeDocumentPayload(type, payload);
    store[key].unshift(document);
    writeDocumentsStore(store);
    return document;
  }

  function updateDocument(type, documentId, payload) {
    const store = readDocumentsStore();
    const key = type === 'invoice' 'invoices' : 'quotes';
    const index = store[key].findIndex((entry) => entry.id === String(documentId));
    if (index === -1) return null;
    const updated = normalizeDocumentPayload(type, payload, store[key][index]);
    store[key][index] = updated;
    writeDocumentsStore(store);
    return updated;
  }

  function deleteDocument(type, documentId) {
    const store = readDocumentsStore();
    const key = type === 'invoice' 'invoices' : 'quotes';
    const nextItems = store[key].filter((entry) => entry.id !== String(documentId));
    if (nextItems.length === store[key].length) return false;
    store[key] = nextItems;
    writeDocumentsStore(store);
    return true;
  }

  function normalizeInvoiceClientPayload(payload) {
    return {
      id: normalizeLine(payload.id, 120) || createId('invoice_client'),
      name: normalizeLine(payload.name, 160),
      company: normalizeLine(payload.company, 160),
      email: normalizeLine(payload.email, 180),
      phone: normalizeLine(payload.phone, 60),
      addressLine1: normalizeLine(payload.addressLine1, 260),
      addressLine2: normalizeLine(payload.addressLine2, 260),
      postalCode: normalizeLine(payload.postalCode, 20),
      city: normalizeLine(payload.city, 120),
      country: normalizeLine(payload.country || 'France', 80),
      createdAt: normalizeLine(payload.createdAt, 60) || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }

  function normalizeInvoiceReferencePayload(payload) {
    return {
      id: normalizeLine(payload.id, 120) || createId('invoice_ref'),
      reference: normalizeLine(payload.reference, 80),
      designation: normalizeLine(payload.designation, 260),
      price: Math.max(0, Number(payload.price || 0)),
      createdAt: normalizeLine(payload.createdAt, 60) || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }

  function listInvoiceClients() {
    return readDocumentsStore().invoiceClients.slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'fr'));
  }

  function createInvoiceClient(payload) {
    const store = readDocumentsStore();
    const client = normalizeInvoiceClientPayload(payload);
    store.invoiceClients = store.invoiceClients.filter((entry) => entry.id !== client.id);
    store.invoiceClients.unshift(client);
    writeDocumentsStore(store);
    return client;
  }

  function deleteInvoiceClient(clientId) {
    const store = readDocumentsStore();
    const nextItems = store.invoiceClients.filter((entry) => entry.id !== String(clientId));
    if (nextItems.length === store.invoiceClients.length) return false;
    store.invoiceClients = nextItems;
    writeDocumentsStore(store);
    return true;
  }

  function listInvoiceReferences() {
    return readDocumentsStore().invoiceReferences.slice().sort((a, b) => String(a.reference || '').localeCompare(String(b.reference || ''), 'fr'));
  }

  function createInvoiceReference(payload) {
    const store = readDocumentsStore();
    const reference = normalizeInvoiceReferencePayload(payload);
    store.invoiceReferences = store.invoiceReferences.filter((entry) => entry.id !== reference.id);
    store.invoiceReferences.unshift(reference);
    writeDocumentsStore(store);
    return reference;
  }

  function deleteInvoiceReference(referenceId) {
    const store = readDocumentsStore();
    const nextItems = store.invoiceReferences.filter((entry) => entry.id !== String(referenceId));
    if (nextItems.length === store.invoiceReferences.length) return false;
    store.invoiceReferences = nextItems;
    writeDocumentsStore(store);
    return true;
  }

  function updateOrder(orderId, payload) {
    const db = openDb();
    try {
      const current = db.prepare('SELECT * FROM client_orders WHERE id = ').get(String(orderId));
      if (!current) return null;
      const status = normalizeLine(payload.status || current.status, 40) || current.status;
      const statusLabel = normalizeLine(payload.statusLabel || current.statusLabel, 80) || current.statusLabel;
      const statusTone = normalizeLine(payload.statusTone || current.statusTone, 40) || current.statusTone;
      const clientNote = normalizeLine(payload.clientNote || current.clientNote, 400) || current.clientNote || '';
      db.prepare('UPDATE client_orders SET status = , statusLabel = , statusTone = , clientNote = , updatedAt = WHERE id = ').run(
        status,
        statusLabel,
        statusTone,
        clientNote,
        new Date().toISOString(),
        String(orderId)
      );
      return listOrders().find((order) => order.id === String(orderId)) || null;
    } finally {
      db.close();
    }
  }

  function updateTicket(ticketId, payload) {
    const db = openDb();
    try {
      const current = db.prepare('SELECT * FROM client_tickets WHERE id = ').get(String(ticketId));
      if (!current) return null;
      const status = normalizeLine(payload.status || current.status, 40) || current.status;
      const statusLabel = normalizeLine(payload.statusLabel || current.statusLabel, 80) || current.statusLabel;
      const statusTone = normalizeLine(payload.statusTone || current.statusTone, 40) || current.statusTone;
      const lastReply = normalizeLine(payload.lastReply || current.lastReply, 400) || current.lastReply || '';
      db.prepare('UPDATE client_tickets SET status = , statusLabel = , statusTone = , lastReply = , updatedAt = WHERE id = ').run(
        status,
        statusLabel,
        statusTone,
        lastReply,
        new Date().toISOString(),
        String(ticketId)
      );
      return listTickets().find((ticket) => ticket.id === String(ticketId)) || null;
    } finally {
      db.close();
    }
  }

  return {
    login,
    logout,
    getSession,
    getDashboard,
    listClients,
    listOrders,
    listTickets,
    listProducts,
    createProduct,
    updateProduct,
    deleteProduct,
    listQuotes: function () { return listDocuments('quote'); },
    listInvoices: function () { return listDocuments('invoice'); },
    createQuote: function (payload) { return createDocument('quote', payload); },
    createInvoice: function (payload) { return createDocument('invoice', payload); },
    updateQuote: function (documentId, payload) { return updateDocument('quote', documentId, payload); },
    updateInvoice: function (documentId, payload) { return updateDocument('invoice', documentId, payload); },
    deleteQuote: function (documentId) { return deleteDocument('quote', documentId); },
    deleteInvoice: function (documentId) { return deleteDocument('invoice', documentId); },
    listInvoiceClients,
    createInvoiceClient,
    deleteInvoiceClient,
    listInvoiceReferences,
    createInvoiceReference,
    deleteInvoiceReference,
    updateOrder,
    updateTicket
  };
}

module.exports = {
  createAdminTools
};










