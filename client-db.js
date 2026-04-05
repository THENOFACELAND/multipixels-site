const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const APP_DATA_DIR = path.join(__dirname, 'assets', 'data');
const LEGACY_JSON_PATH = path.join(APP_DATA_DIR, 'client-space.json');
const DB_DATA_DIR = resolveDataDirectory();
const DB_PATH = path.join(DB_DATA_DIR, 'client-space.sqlite');
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const RESET_TTL_MS = 1000 * 60 * 30;

function ensureDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function resolveDataDirectory() {
  const candidates = [
    process.env.MULTIPIXELS_DATA_DIR,
    process.env.DATA_DIR,
    process.env.RAILWAY_VOLUME_MOUNT_PATH,
    process.platform === 'win32' ? '' : '/data'
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      ensureDirectory(candidate);
      return candidate;
    } catch (_) {
      // Ignore invalid or unavailable runtime data directories.
    }
  }

  ensureDirectory(APP_DATA_DIR);
  return APP_DATA_DIR;
}

function nowIso() {
  return new Date().toISOString();
}

function createId(prefix) {
  return prefix + '_' + crypto.randomBytes(6).toString('hex');
}

function createReference(prefix) {
  const random = String(Math.floor(Math.random() * 9000) + 1000);
  return prefix + '-' + new Date().getFullYear() + '-' + random;
}

function createPasswordRecord(password, saltHex) {
  const salt = saltHex ? Buffer.from(saltHex, 'hex') : crypto.randomBytes(16);
  const hash = crypto.pbkdf2Sync(String(password || ''), salt, 120000, 32, 'sha256');
  return { salt: salt.toString('hex'), hash: hash.toString('hex') };
}

function verifyPassword(password, user) {
  if (!user || !user.passwordSalt || !user.passwordHash) return false;
  const candidate = createPasswordRecord(password, user.passwordSalt);
  const left = Buffer.from(candidate.hash, 'hex');
  const right = Buffer.from(user.passwordHash, 'hex');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function parseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch (_) {
    return fallback;
  }
}

function getDisplayName(user) {
  const full = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  if (user.accountType === 'professionnel' && user.company) {
    return full ? full + ' - ' + user.company : user.company;
  }
  return full || user.company || user.email;
}

function toPublicUser(row) {
  return {
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
    lastLoginAt: row.lastLoginAt || null,
    displayName: getDisplayName(row)
  };
}

function serializeOrder(row) {
  return {
    id: row.id,
    reference: row.reference,
    title: row.title,
    status: row.status,
    statusLabel: row.statusLabel,
    statusTone: row.statusTone,
    createdAt: row.createdAt,
    estimatedShipDate: row.estimatedShipDate || null,
    updatedAt: row.updatedAt || row.createdAt,
    total: Number(row.total || 0),
    deliveryMode: row.deliveryMode || '',
    clientNote: row.clientNote || '',
    items: parseJson(row.itemsJson, []),
    timeline: parseJson(row.timelineJson, [])
  };
}

function serializeTicket(row) {
  return {
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
    lastReply: row.lastReply || ''
  };
}

function mapUserRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    accountType: row.accountType,
    firstName: row.firstName,
    lastName: row.lastName,
    company: row.company,
    email: row.email,
    phone: row.phone,
    addressLine1: row.addressLine1,
    addressLine2: row.addressLine2,
    createdAt: row.createdAt,
    lastLoginAt: row.lastLoginAt,
    passwordSalt: row.passwordSalt,
    passwordHash: row.passwordHash
  };
}

function buildClientDb() {
  ensureDirectory(path.dirname(DB_PATH));
  const db = new DatabaseSync(DB_PATH);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS client_users (
      id TEXT PRIMARY KEY,
      accountType TEXT NOT NULL,
      firstName TEXT NOT NULL,
      lastName TEXT NOT NULL,
      company TEXT,
      email TEXT NOT NULL UNIQUE,
      phone TEXT,
      createdAt TEXT NOT NULL,
      lastLoginAt TEXT,
      passwordSalt TEXT NOT NULL,
      passwordHash TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS client_sessions (
      token TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      lastSeenAt TEXT NOT NULL,
      expiresAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS client_password_resets (
      token TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      expiresAt TEXT NOT NULL,
      usedAt TEXT
    );
    CREATE TABLE IF NOT EXISTS client_orders (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      reference TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      statusLabel TEXT NOT NULL,
      statusTone TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      estimatedShipDate TEXT,
      total REAL NOT NULL DEFAULT 0,
      deliveryMode TEXT,
      clientNote TEXT,
      itemsJson TEXT NOT NULL,
      timelineJson TEXT NOT NULL,
      stripeSessionId TEXT,
      stripePaymentStatus TEXT
    );
    CREATE TABLE IF NOT EXISTS client_tickets (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      orderReference TEXT,
      subject TEXT NOT NULL,
      category TEXT NOT NULL,
      status TEXT NOT NULL,
      statusLabel TEXT NOT NULL,
      statusTone TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      messagePreview TEXT,
      lastReply TEXT
    );
  `);

  ensureUserColumn(db, 'addressLine1', 'TEXT');
  ensureUserColumn(db, 'addressLine2', 'TEXT');

  const count = db.prepare('SELECT COUNT(*) as count FROM client_users').get().count;
  if (!count) {
    seedDatabase(db);
  }

  const api = {
    cleanupSessions() {
      db.prepare('DELETE FROM client_sessions WHERE expiresAt <= ?').run(nowIso());
      db.prepare('DELETE FROM client_password_resets WHERE expiresAt <= ? OR usedAt IS NOT NULL').run(nowIso());
    },
    findUserByEmail(email) {
      return mapUserRow(db.prepare('SELECT * FROM client_users WHERE lower(email) = lower(?)').get(String(email || '').trim()));
    },
    findUserById(id) {
      return mapUserRow(db.prepare('SELECT * FROM client_users WHERE id = ?').get(id));
    },
    createUser(payload) {
      const passwordRecord = createPasswordRecord(payload.password);
      const user = {
        id: createId('client'),
        accountType: payload.accountType === 'professionnel' ? 'professionnel' : 'particulier',
        firstName: payload.firstName,
        lastName: payload.lastName,
        company: payload.company || '',
        email: String(payload.email || '').toLowerCase(),
        phone: payload.phone || '',
        addressLine1: payload.addressLine1 || '',
        addressLine2: payload.addressLine2 || '',
        createdAt: nowIso(),
        lastLoginAt: null,
        passwordSalt: passwordRecord.salt,
        passwordHash: passwordRecord.hash
      };
      db.prepare(`INSERT INTO client_users (id, accountType, firstName, lastName, company, email, phone, addressLine1, addressLine2, createdAt, lastLoginAt, passwordSalt, passwordHash)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(user.id, user.accountType, user.firstName, user.lastName, user.company, user.email, user.phone, user.addressLine1, user.addressLine2, user.createdAt, user.lastLoginAt, user.passwordSalt, user.passwordHash);
      return user;
    },
    verifyUser(email, password) {
      const user = api.findUserByEmail(email);
      if (!user || !verifyPassword(password, user)) return null;
      return user;
    },
    touchLastLogin(userId) {
      const timestamp = nowIso();
      db.prepare('UPDATE client_users SET lastLoginAt = ? WHERE id = ?').run(timestamp, userId);
      return api.findUserById(userId);
    },
    createSession(userId) {
      api.cleanupSessions();
      db.prepare('DELETE FROM client_sessions WHERE userId = ?').run(userId);
      const token = crypto.randomBytes(24).toString('hex');
      const createdAt = nowIso();
      const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
      db.prepare('INSERT INTO client_sessions (token, userId, createdAt, lastSeenAt, expiresAt) VALUES (?, ?, ?, ?, ?)').run(token, userId, createdAt, createdAt, expiresAt);
      return token;
    },
    getSession(token) {
      api.cleanupSessions();
      const session = db.prepare('SELECT * FROM client_sessions WHERE token = ?').get(token);
      if (!session) return null;
      const updated = nowIso();
      const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
      db.prepare('UPDATE client_sessions SET lastSeenAt = ?, expiresAt = ? WHERE token = ?').run(updated, expiresAt, token);
      const user = api.findUserById(session.userId);
      if (!user) {
        db.prepare('DELETE FROM client_sessions WHERE token = ?').run(token);
        return null;
      }
      return { token, user };
    },
    deleteSession(token) {
      db.prepare('DELETE FROM client_sessions WHERE token = ?').run(token);
    },
    listOrders(userId) {
      return db.prepare('SELECT * FROM client_orders WHERE userId = ? ORDER BY datetime(updatedAt) DESC').all(userId).map(serializeOrder);
    },
    listTickets(userId) {
      return db.prepare('SELECT * FROM client_tickets WHERE userId = ? ORDER BY datetime(updatedAt) DESC').all(userId).map(serializeTicket);
    },
    getDashboard(userId) {
      const user = api.findUserById(userId);
      const orders = api.listOrders(userId);
      const tickets = api.listTickets(userId);
      return {
        user: toPublicUser(user),
        stats: {
          totalOrders: orders.length,
          activeOrders: orders.filter((order) => order.status !== 'delivered' && order.status !== 'closed').length,
          totalTickets: tickets.length,
          openTickets: tickets.filter((ticket) => ticket.status !== 'closed').length
        },
        orders,
        tickets
      };
    },
    createTicket(userId, payload) {
      const ticket = {
        id: createId('sav'),
        userId,
        orderReference: payload.orderReference || '',
        subject: payload.subject,
        category: payload.category || 'SAV',
        status: 'open',
        statusLabel: 'Ouvert',
        statusTone: 'in-progress',
        createdAt: nowIso(),
        updatedAt: nowIso(),
        messagePreview: String(payload.message || '').slice(0, 180),
        lastReply: 'Ticket recu, notre equipe reviendra vers vous sous 24 a 48h.'
      };
      db.prepare(`INSERT INTO client_tickets (id, userId, orderReference, subject, category, status, statusLabel, statusTone, createdAt, updatedAt, messagePreview, lastReply)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        ticket.id, ticket.userId, ticket.orderReference, ticket.subject, ticket.category, ticket.status, ticket.statusLabel, ticket.statusTone, ticket.createdAt, ticket.updatedAt, ticket.messagePreview, ticket.lastReply
      );
      return serializeTicket(db.prepare('SELECT * FROM client_tickets WHERE id = ?').get(ticket.id));
    },
    updateProfile(userId, payload) {
      db.prepare(`UPDATE client_users SET firstName = ?, lastName = ?, company = ?, phone = ?, addressLine1 = ?, addressLine2 = ?, accountType = ? WHERE id = ?`).run(
        payload.firstName,
        payload.lastName,
        payload.company || '',
        payload.phone || '',
        payload.addressLine1 || '',
        payload.addressLine2 || '',
        payload.accountType === 'professionnel' ? 'professionnel' : 'particulier',
        userId
      );
      return api.findUserById(userId);
    },
    createPasswordReset(userId) {
      api.cleanupSessions();
      db.prepare('DELETE FROM client_password_resets WHERE userId = ?').run(userId);
      const token = crypto.randomBytes(24).toString('hex');
      const createdAt = nowIso();
      const expiresAt = new Date(Date.now() + RESET_TTL_MS).toISOString();
      db.prepare('INSERT INTO client_password_resets (token, userId, createdAt, expiresAt, usedAt) VALUES (?, ?, ?, ?, NULL)').run(token, userId, createdAt, expiresAt);
      return { token, createdAt, expiresAt };
    },
    resetPassword(token, newPassword) {
      api.cleanupSessions();
      const row = db.prepare('SELECT * FROM client_password_resets WHERE token = ? AND usedAt IS NULL').get(token);
      if (!row) return null;
      const passwordRecord = createPasswordRecord(newPassword);
      db.prepare('UPDATE client_users SET passwordSalt = ?, passwordHash = ? WHERE id = ?').run(passwordRecord.salt, passwordRecord.hash, row.userId);
      db.prepare('UPDATE client_password_resets SET usedAt = ? WHERE token = ?').run(nowIso(), token);
      db.prepare('DELETE FROM client_sessions WHERE userId = ?').run(row.userId);
      return api.findUserById(row.userId);
    },
    createCheckoutDraft(userId, payload) {
      const order = {
        id: createId('cmd'),
        userId,
        reference: createReference('MP'),
        title: payload.title || 'Commande en cours de paiement',
        status: 'payment',
        statusLabel: 'Paiement initialise',
        statusTone: 'pending',
        createdAt: nowIso(),
        updatedAt: nowIso(),
        estimatedShipDate: null,
        total: Number(payload.total || 0),
        deliveryMode: payload.deliveryMode || 'Checkout Stripe',
        clientNote: payload.clientNote || 'Commande reliee a votre espace client avant confirmation de paiement.',
        itemsJson: JSON.stringify(payload.items || []),
        timelineJson: JSON.stringify([
          { label: 'Panier valide', date: 'Aujourd\'hui', done: true },
          { label: 'Paiement Stripe', date: 'En attente', done: false },
          { label: 'Validation atelier', date: 'Apres paiement', done: false }
        ]),
        stripeSessionId: '',
        stripePaymentStatus: 'pending'
      };
      db.prepare(`INSERT INTO client_orders (id, userId, reference, title, status, statusLabel, statusTone, createdAt, updatedAt, estimatedShipDate, total, deliveryMode, clientNote, itemsJson, timelineJson, stripeSessionId, stripePaymentStatus)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        order.id, order.userId, order.reference, order.title, order.status, order.statusLabel, order.statusTone, order.createdAt, order.updatedAt, order.estimatedShipDate, order.total, order.deliveryMode, order.clientNote, order.itemsJson, order.timelineJson, order.stripeSessionId, order.stripePaymentStatus
      );
      return order;
    },
    attachStripeSession(orderId, sessionId) {
      db.prepare('UPDATE client_orders SET stripeSessionId = ?, updatedAt = ? WHERE id = ?').run(sessionId, nowIso(), orderId);
    }
  };

  return api;
}

function ensureUserColumn(db, columnName, definition) {
  var columns = db.prepare('PRAGMA table_info(client_users)').all();
  var exists = columns.some(function (column) { return column.name === columnName; });
  if (!exists) db.exec('ALTER TABLE client_users ADD COLUMN ' + columnName + ' ' + definition);
}

function seedDatabase(db) {
  let legacy = null;
  if (fs.existsSync(LEGACY_JSON_PATH)) {
    try {
      legacy = JSON.parse(fs.readFileSync(LEGACY_JSON_PATH, 'utf8'));
    } catch (_) {
      legacy = null;
    }
  }

  const users = legacy && Array.isArray(legacy.users) && legacy.users.length ? legacy.users : [
    {
      id: 'client_particulier_demo',
      accountType: 'particulier',
      firstName: 'Camille',
      lastName: 'Martin',
      company: '',
      email: 'particulier@multipixels.fr',
      phone: '06 27 14 08 40',
      createdAt: '2026-03-01T09:00:00.000Z',
      lastLoginAt: null,
      passwordSalt: createPasswordRecord('Multipixels!2026').salt,
      passwordHash: createPasswordRecord('Multipixels!2026').hash,
      orders: [],
      tickets: []
    },
    {
      id: 'client_professionnel_demo',
      accountType: 'professionnel',
      firstName: 'Julien',
      lastName: 'Dubois',
      company: 'Nord Events',
      email: 'pro@multipixels.fr',
      phone: '06 27 14 08 40',
      createdAt: '2026-02-18T08:45:00.000Z',
      lastLoginAt: null,
      passwordSalt: createPasswordRecord('Multipixels!2026').salt,
      passwordHash: createPasswordRecord('Multipixels!2026').hash,
      orders: [],
      tickets: []
    }
  ];

  users.forEach((user) => {
    db.prepare(`INSERT INTO client_users (id, accountType, firstName, lastName, company, email, phone, createdAt, lastLoginAt, passwordSalt, passwordHash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      user.id,
      user.accountType,
      user.firstName,
      user.lastName,
      user.company || '',
      String(user.email || '').toLowerCase(),
      user.phone || '',
      user.createdAt || nowIso(),
      user.lastLoginAt || null,
      user.passwordSalt,
      user.passwordHash
    );

    (user.orders || []).forEach((order) => {
      db.prepare(`INSERT INTO client_orders (id, userId, reference, title, status, statusLabel, statusTone, createdAt, updatedAt, estimatedShipDate, total, deliveryMode, clientNote, itemsJson, timelineJson, stripeSessionId, stripePaymentStatus)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        order.id || createId('cmd'),
        user.id,
        order.reference,
        order.title,
        order.status,
        order.statusLabel,
        order.statusTone,
        order.createdAt || nowIso(),
        order.updatedAt || order.createdAt || nowIso(),
        order.estimatedShipDate || null,
        Number(order.total || 0),
        order.deliveryMode || '',
        order.clientNote || '',
        JSON.stringify(order.items || []),
        JSON.stringify(order.timeline || []),
        order.stripeSessionId || '',
        order.stripePaymentStatus || ''
      );
    });

    (user.tickets || []).forEach((ticket) => {
      db.prepare(`INSERT INTO client_tickets (id, userId, orderReference, subject, category, status, statusLabel, statusTone, createdAt, updatedAt, messagePreview, lastReply)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        ticket.id || createId('sav'),
        user.id,
        ticket.orderReference || '',
        ticket.subject,
        ticket.category || 'SAV',
        ticket.status || 'open',
        ticket.statusLabel || 'Ouvert',
        ticket.statusTone || 'in-progress',
        ticket.createdAt || nowIso(),
        ticket.updatedAt || ticket.createdAt || nowIso(),
        ticket.messagePreview || '',
        ticket.lastReply || ''
      );
    });
  });
}

module.exports = {
  buildClientDb,
  toPublicUser,
  verifyPassword,
  createPasswordRecord
};













