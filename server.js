const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const crypto = require("crypto");
let nodemailer;
let Stripe;
const { buildClientDb, toPublicUser: dbToPublicUser } = require("./client-db");
const { createAdminTools } = require("./admin-tools");

try {
  nodemailer = require("nodemailer");
} catch (_) {
  nodemailer = null;
}

try {
  Stripe = require("stripe");
} catch (_) {
  Stripe = null;
}

const ROOT = __dirname;

function loadDotEnvFile() {
  const dotenvPath = path.join(ROOT, ".env");
  if (!fs.existsSync(dotenvPath)) return;

  const raw = fs.readFileSync(dotenvPath, "utf8");
  raw.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const sep = trimmed.indexOf("=");
    if (sep <= 0) return;
    const key = trimmed.slice(0, sep).trim();
    let value = trimmed.slice(sep + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!Object.prototype.hasOwnProperty.call(process.env, key)) {
      process.env[key] = value;
    }
  });
}

loadDotEnvFile();

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const API_KEY = (process.env.GOOGLE_MAPS_API_KEY || "").trim();
const DEFAULT_PLACE_ID = (process.env.GOOGLE_PLACE_ID || "").trim();
const DEFAULT_QUERY = (process.env.GOOGLE_PLACE_QUERY || "MULTIPIXELS, 190 Chemin Blanc, 62180 Rang-du-Fliers").trim();
const CONTACT_TO = (process.env.CONTACT_TO || "contact@multipixels.fr").trim();
const SMTP_HOST = (process.env.SMTP_HOST || "").trim();
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_SECURE = String(process.env.SMTP_SECURE || "").trim().toLowerCase() === "true" || SMTP_PORT === 465;
const SMTP_USER = (process.env.SMTP_USER || "").trim();
const SMTP_PASS = (process.env.SMTP_PASS || "").trim();
const DEFAULT_CONTACT_EMAIL = 'contact@multipixels.fr';
const CONTACT_FROM = (process.env.CONTACT_FROM || DEFAULT_CONTACT_EMAIL).trim() || DEFAULT_CONTACT_EMAIL;
const INVOICE_COPY_TO = (process.env.INVOICE_COPY_TO || CONTACT_FROM || DEFAULT_CONTACT_EMAIL).trim();
const ADMIN_DOCUMENTS_PATH = path.join(ROOT, "assets", "data", "admin-documents.json");
const INVOICE_SEQUENCE_START = Math.max(1, Number(process.env.INVOICE_SEQUENCE_START || 33));

// Stripe is intentionally prepared here so test and production can be separated cleanly.
const STRIPE_MODE = (process.env.STRIPE_MODE || "test").trim();
const STRIPE_PUBLISHABLE_KEY = (process.env.STRIPE_PUBLISHABLE_KEY || "").trim();
const STRIPE_SECRET_KEY = (process.env.STRIPE_SECRET_KEY || "").trim();
const STRIPE_SUCCESS_URL = (process.env.STRIPE_SUCCESS_URL || "https://www.multipixels.fr/commande-confirmee.html").trim();
const STRIPE_CANCEL_URL = (process.env.STRIPE_CANCEL_URL || "https://www.multipixels.fr/panier.html").trim();
const CLIENT_STORE_PATH = path.join(ROOT, "assets", "data", "client-space.json");
const CLIENT_SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const CLIENT_APP_BASE_URL = (process.env.CLIENT_APP_BASE_URL || "https://www.multipixels.fr").trim();

const clientDb = buildClientDb();
const adminTools = createAdminTools({ root: ROOT, env: process.env });

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8"
};

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*"
  });
  res.end(JSON.stringify(payload));
}

function sendText(res, status, message) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(message);
}

function parseJsonBody(req, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];

    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error("REQUEST_BODY_TOO_LARGE"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8").trim();
        resolve(raw ? JSON.parse(raw) : {});
      } catch (_) {
        reject(new Error("INVALID_JSON"));
      }
    });

    req.on("error", reject);
  });
}

function sanitizeLine(value, maxLen = 4000) {
  return String(value || "").replace(/\r?\n/g, " ").trim().slice(0, maxLen);
}

function normalizeWhitespace(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function repairText(value) {
  let repaired = String(value || "");
  if (!repaired) return "";

  const replacements = [
    [/Ã‰/g, "É"],
    [/Ãˆ/g, "È"],
    [/Ã€/g, "À"],
    [/Ã™/g, "Ù"],
    [/Ã‚/g, "Â"],
    [/Ãª/g, "ê"],
    [/Ã¨/g, "è"],
    [/Ã©/g, "é"],
    [/Ã«/g, "ë"],
    [/Ã /g, "à"],
    [/Ã¹/g, "ù"],
    [/Ã¢/g, "â"],
    [/Ã´/g, "ô"],
    [/Ã®/g, "î"],
    [/Ã¯/g, "ï"],
    [/Ã§/g, "ç"],
    [/Ã»/g, "û"],
    [/Ã¼/g, "ü"],
    [/â€™/g, "’"],
    [/â€œ/g, '"'],
    [/â€/g, '"'],
    [/â€“/g, "-"],
    [/â€”/g, "-"],
    [/Â/g, ""],
    [/ðŸ‘/g, "👍"],
    [/ðŸ”¥/g, "🔥"],
    [/ðŸ˜Š/g, "😊"],
    [/ï¿½/g, ""]
  ];

  replacements.forEach(([pattern, replacement]) => {
    repaired = repaired.replace(pattern, replacement);
  });

  return normalizeWhitespace(repaired);
}

async function handleContactApi(req, res) {
  if (!nodemailer) {
    sendJson(res, 500, {
      ok: false,
      error: {
        code: "MAILER_UNAVAILABLE",
        message: "Module d'envoi d'email manquant (installez nodemailer)."
      }
    });
    return;
  }

  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !CONTACT_TO) {
    sendJson(res, 500, {
      ok: false,
      error: {
        code: "SMTP_NOT_CONFIGURED",
        message: "Configuration SMTP incomplète sur le serveur."
      }
    });
    return;
  }

  let body;
  try {
    body = await parseJsonBody(req, 14 * 1024 * 1024);
  } catch (error) {
    if (error && error.message === "REQUEST_BODY_TOO_LARGE") {
      sendJson(res, 413, {
        ok: false,
        error: { code: "PAYLOAD_TOO_LARGE", message: "Le message est trop volumineux." }
      });
      return;
    }

    sendJson(res, 400, {
      ok: false,
      error: { code: "INVALID_JSON", message: "Format de requête invalide." }
    });
    return;
  }

  const nom = sanitizeLine(body.nom, 120);
  const email = sanitizeLine(body.email, 180);
  const tel = sanitizeLine(body.tel, 80);
  const service = sanitizeLine(body.service, 120);
  const quantite = sanitizeLine(body.quantite, 40);
  const website = sanitizeLine(body.website, 240);
  const message = String(body.message || "").trim().slice(0, 6000);
  let attachment = null;

  if (website) {
    sendJson(res, 200, { ok: true, message: "Message envoyé avec succès." });
    return;
  }

  if (body.attachment && typeof body.attachment === "object") {
    const filename = sanitizeLine(body.attachment.filename, 180);
    const contentType = sanitizeLine(body.attachment.contentType || "application/octet-stream", 120);
    const size = Number(body.attachment.size || 0);
    const rawBase64 = String(body.attachment.contentBase64 || "").replace(/^data:[^;]+;base64,/, "").trim();

    if (!filename || !rawBase64) {
      sendJson(res, 400, {
        ok: false,
        error: { code: "INVALID_ATTACHMENT", message: "Pièce jointe invalide." }
      });
      return;
    }

    const maxAttachmentBytes = 8 * 1024 * 1024;
    const estimatedBytes = Math.floor((rawBase64.length * 3) / 4);
    const attachmentBytes = size > 0 ? size : estimatedBytes;
    if (attachmentBytes > maxAttachmentBytes) {
      sendJson(res, 413, {
        ok: false,
        error: { code: "ATTACHMENT_TOO_LARGE", message: "Le fichier joint dépasse la limite de 8 Mo." }
      });
      return;
    }

    attachment = {
      filename,
      contentType,
      content: Buffer.from(rawBase64, "base64")
    };
  }

  if (!nom || !email || !tel || !message) {
    sendJson(res, 400, {
      ok: false,
      error: { code: "VALIDATION_ERROR", message: "Nom, email, téléphone et message sont obligatoires." }
    });
    return;
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    sendJson(res, 400, {
      ok: false,
      error: { code: "INVALID_EMAIL", message: "Adresse email invalide." }
    });
    return;
  }

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS
    }
  });

  const subject = `[MULTIPIXELS] Nouvelle demande - ${service || "Contact"}`;
  const text = [
    "Nouvelle demande depuis le formulaire contact",
    "",
    `Nom: ${nom}`,
    `Email: ${email}`,
    `Téléphone: ${tel || "-"}`,
    `Service: ${service || "-"}`,
    `Quantité estimée: ${quantite || "-"}`,
    `Pièce jointe: ${attachment ? attachment.filename : "-"}`,
    "",
    "Message:",
    message
  ].join("\n");

  try {
    await transporter.sendMail({
      from: CONTACT_FROM,
      to: CONTACT_TO,
      replyTo: email,
      subject,
      text,
      attachments: attachment ? [attachment] : []
    });
  } catch (_) {
    sendJson(res, 502, {
      ok: false,
      error: { code: "EMAIL_SEND_FAILED", message: "Impossible d'envoyer le message pour le moment." }
    });
    return;
  }

  sendJson(res, 200, { ok: true, message: "Message envoyé avec succès." });
}

function httpGetJson(urlString) {
  return new Promise((resolve, reject) => {
    https.get(urlString, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        try {
          resolve({
            statusCode: response.statusCode || 0,
            body: JSON.parse(Buffer.concat(chunks).toString("utf8"))
          });
        } catch (_) {
          reject(new Error("Réponse Google invalide (JSON non parseable)."));
        }
      });
    }).on("error", reject);
  });
}

async function findPlaceIdByQuery(query) {
  const endpoint = new URL("https://maps.googleapis.com/maps/api/place/findplacefromtext/json");
  endpoint.searchParams.set("input", query);
  endpoint.searchParams.set("inputtype", "textquery");
  endpoint.searchParams.set("fields", "place_id,name");
  endpoint.searchParams.set("language", "fr");
  endpoint.searchParams.set("key", API_KEY);

  const { body } = await httpGetJson(endpoint.toString());
  const candidates = Array.isArray(body.candidates) ? body.candidates : [];
  return body.status === "OK" && candidates[0] && candidates[0].place_id ? candidates[0].place_id : null;
}

async function getPlaceDetails(placeId) {
  const endpoint = new URL("https://maps.googleapis.com/maps/api/place/details/json");
  endpoint.searchParams.set("place_id", placeId);
  endpoint.searchParams.set("fields", "place_id,name,rating,user_ratings_total,reviews,url");
  endpoint.searchParams.set("reviews_sort", "newest");
  endpoint.searchParams.set("language", "fr");
  endpoint.searchParams.set("key", API_KEY);

  const { body } = await httpGetJson(endpoint.toString());
  if (body.status !== "OK" || !body.result) {
    return { ok: false, googleStatus: body.status || "UNKNOWN_ERROR" };
  }

  const result = body.result;
  const reviews = Array.isArray(result.reviews) ? result.reviews.slice(0, 5) : [];

  return {
    ok: true,
    placeId: result.place_id || placeId,
    name: repairText(result.name || "Établissement Google"),
    rating: Number(result.rating || 0),
    ratingCount: Number(result.user_ratings_total || 0),
    url: repairText(result.url || ""),
    reviews: reviews.map((review) => ({
      author: repairText(review.author_name || "Client Google"),
      rating: Number(review.rating || 0),
      text: repairText(review.text || "Avis client Google", { preserveLineBreaks: true }),
      time: repairText(review.relative_time_description || "")
    }))
  };
}

async function handleReviewsApi(res, requestUrl) {
  if (!API_KEY) {
    sendJson(res, 500, {
      ok: false,
      error: { code: "MISSING_API_KEY", message: "Variable GOOGLE_MAPS_API_KEY manquante sur le serveur." }
    });
    return;
  }

  const placeIdFromQuery = (requestUrl.searchParams.get("placeId") || "").trim();
  const queryFromQuery = (requestUrl.searchParams.get("query") || "").trim();

  let selectedPlaceId = placeIdFromQuery || DEFAULT_PLACE_ID;
  if (!selectedPlaceId) {
    const candidates = [queryFromQuery || DEFAULT_QUERY, "MULTIPIXELS Rang-du-Fliers", "MULTIPIXELS"];
    for (const candidate of candidates) {
      if (!candidate) continue;
      selectedPlaceId = await findPlaceIdByQuery(candidate);
      if (selectedPlaceId) break;
    }
  }

  if (!selectedPlaceId) {
    sendJson(res, 404, {
      ok: false,
      error: { code: "PLACE_NOT_FOUND", message: "Impossible de trouver la fiche Google à partir des requêtes configurées." }
    });
    return;
  }

  const place = await getPlaceDetails(selectedPlaceId);
  if (!place.ok) {
    sendJson(res, 502, {
      ok: false,
      error: {
        code: "GOOGLE_PLACE_DETAILS_FAILED",
        message: "Google n'a pas retourné les détails de la fiche.",
        googleStatus: place.googleStatus
      }
    });
    return;
  }

  sendJson(res, 200, {
    ok: true,
    source: "google_places_api",
    placeId: place.placeId,
    name: place.name,
    rating: place.rating,
    ratingCount: place.ratingCount,
    url: place.url,
    reviews: place.reviews
  });
}

function getStripeConfig() {
  return {
    ok: true,
    stripe: {
      mode: STRIPE_MODE,
      enabled: Boolean(STRIPE_PUBLISHABLE_KEY && STRIPE_SECRET_KEY),
      publishableKey: STRIPE_PUBLISHABLE_KEY || null
    }
  };
}

async function handleCheckoutSessionApi(req, res) {
  let body;
  try {
    body = await parseJsonBody(req, 1024 * 1024);
  } catch (error) {
    sendJson(res, 400, {
      ok: false,
      error: { code: "INVALID_JSON", message: "Corps de requête invalide." }
    });
    return;
  }

  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) {
    sendJson(res, 400, {
      ok: false,
      error: { code: "EMPTY_CART", message: "Le panier est vide." }
    });
    return;
  }

  if (!STRIPE_PUBLISHABLE_KEY || !STRIPE_SECRET_KEY) {
    sendJson(res, 501, {
      ok: false,
      error: {
        code: "STRIPE_NOT_CONFIGURED",
        message: "Stripe n'est pas encore configuré sur le serveur. Le tunnel est prêt mais les clés d'environnement doivent être ajoutées."
      }
    });
    return;
  }

  if (!Stripe) {
    sendJson(res, 501, {
      ok: false,
      error: {
        code: "STRIPE_PACKAGE_MISSING",
        message: "Le package Stripe n'est pas installé côté serveur. Ajoutez la dépendance avant d'activer le checkout."
      }
    });
    return;
  }

  const normalizedItems = items
    .map((item) => ({
      id: sanitizeLine(item.id, 80),
      name: sanitizeLine(item.name, 160),
      quantity: Math.max(1, Number(item.quantity || 1)),
      price: Number(item.price || 0)
    }))
    .filter((item) => item.name && item.price > 0);

  if (!normalizedItems.length) {
    sendJson(res, 400, {
      ok: false,
      error: {
        code: "INVALID_CART",
        message: "Le panier ne contient pas de produits valides pour le checkout."
      }
    });
    return;
  }

  try {
    const stripe = new Stripe(STRIPE_SECRET_KEY);
    const clientAuth = getClientAuth(req);
    const clientUser = clientAuth && clientAuth.user ? clientAuth.user : null;
    const totalAmount = normalizedItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const draftOrder = clientUser ? clientDb.createCheckoutDraft(clientUser.id, {
      title: normalizedItems.length === 1 ? normalizedItems[0].name : 'Commande catalogue MULTIPIXELS',
      total: totalAmount,
      items: normalizedItems.map((item) => ({ name: item.name, quantity: item.quantity, technique: '', color: '' })),
      deliveryMode: 'Checkout Stripe',
      clientNote: 'Session Stripe lancee depuis votre espace client.'
    }) : null;

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      success_url: STRIPE_SUCCESS_URL,
      cancel_url: STRIPE_CANCEL_URL,
      customer_email: clientUser ? clientUser.email : undefined,
      metadata: {
        multipixels_client_id: clientUser ? clientUser.id : '',
        multipixels_client_email: clientUser ? clientUser.email : '',
        multipixels_order_reference: draftOrder ? draftOrder.reference : ''
      },
      line_items: normalizedItems.map((item) => ({
        quantity: item.quantity,
        price_data: {
          currency: "eur",
          unit_amount: Math.round(item.price * 100),
          product_data: {
            name: item.name,
            metadata: {
              multipixels_product_id: item.id,
              multipixels_client_id: clientUser ? clientUser.id : ''
            }
          }
        }
      }))
    });

    if (draftOrder) {
      clientDb.attachStripeSession(draftOrder.id, session.id);
    }

    sendJson(res, 200, {
      ok: true,
      url: session.url,
      sessionId: session.id,
      orderReference: draftOrder ? draftOrder.reference : null
    });
  } catch (error) {
    sendJson(res, 502, {
      ok: false,
      error: {
        code: "STRIPE_CHECKOUT_FAILED",
        message: error && error.message ? error.message : "Impossible de créer la session Stripe."
      }
    });
  }
}


function ensureDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function createId(prefix) {
  return prefix + '_' + crypto.randomBytes(6).toString('hex');
}

function createPasswordRecord(password, saltHex) {
  const salt = saltHex ? Buffer.from(saltHex, 'hex') : crypto.randomBytes(16);
  const hash = crypto.pbkdf2Sync(String(password || ''), salt, 120000, 32, 'sha256');
  return {
    salt: salt.toString('hex'),
    hash: hash.toString('hex')
  };
}

function verifyPassword(password, user) {
  if (!user || !user.passwordSalt || !user.passwordHash) return false;
  const candidate = createPasswordRecord(password, user.passwordSalt);
  const left = Buffer.from(candidate.hash, 'hex');
  const right = Buffer.from(user.passwordHash, 'hex');
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function sortByDateDesc(list, key) {
  return list.slice().sort((a, b) => {
    const aTime = new Date(a[key] || 0).getTime();
    const bTime = new Date(b[key] || 0).getTime();
    return bTime - aTime;
  });
}

function getClientDisplayName(user) {
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  if (user.accountType === 'professionnel' && user.company) {
    return fullName ? fullName + ' - ' + user.company : user.company;
  }
  return fullName || user.company || user.email;
}

function toPublicUser(user) {
  return {
    id: user.id,
    accountType: user.accountType,
    firstName: user.firstName,
    lastName: user.lastName,
    company: user.company || '',
    email: user.email,
    phone: user.phone || '',
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt || null,
    displayName: getClientDisplayName(user)
  };
}

function serializeOrders(orders) {
  return sortByDateDesc(Array.isArray(orders) ? orders : [], 'createdAt').map((order) => ({
    id: order.id,
    reference: order.reference,
    title: order.title,
    status: order.status,
    statusLabel: order.statusLabel,
    statusTone: order.statusTone,
    createdAt: order.createdAt,
    estimatedShipDate: order.estimatedShipDate || null,
    updatedAt: order.updatedAt || order.createdAt,
    total: order.total,
    deliveryMode: order.deliveryMode || '',
    clientNote: order.clientNote || '',
    items: Array.isArray(order.items) ? order.items : [],
    timeline: Array.isArray(order.timeline) ? order.timeline : []
  }));
}

function serializeTickets(tickets) {
  return sortByDateDesc(Array.isArray(tickets) ? tickets : [], 'updatedAt').map((ticket) => ({
    id: ticket.id,
    orderReference: ticket.orderReference || '',
    subject: ticket.subject,
    category: ticket.category,
    status: ticket.status,
    statusLabel: ticket.statusLabel,
    statusTone: ticket.statusTone,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
    messagePreview: ticket.messagePreview || '',
    lastReply: ticket.lastReply || ''
  }));
}

function buildClientDashboard(user) {
  const orders = serializeOrders(user.orders || []);
  const tickets = serializeTickets(user.tickets || []);
  const activeOrders = orders.filter((order) => order.status !== 'delivered' && order.status !== 'closed').length;
  const openTickets = tickets.filter((ticket) => ticket.status !== 'closed').length;

  return {
    user: toPublicUser(user),
    stats: {
      totalOrders: orders.length,
      activeOrders,
      totalTickets: tickets.length,
      openTickets
    },
    orders,
    tickets
  };
}

function buildSeedStore() {
  const demoPassword = 'Multipixels!2026';
  const particulierPassword = createPasswordRecord(demoPassword);
  const professionnelPassword = createPasswordRecord(demoPassword);

  return {
    version: 1,
    users: [
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
        passwordSalt: particulierPassword.salt,
        passwordHash: particulierPassword.hash,
        orders: [
          {
            id: 'cmd_demo_001',
            reference: 'MP-2026-0412',
            title: 'Sweats personnalises - EVJF',
            status: 'production',
            statusLabel: 'En production',
            statusTone: 'in-progress',
            createdAt: '2026-03-21T10:30:00.000Z',
            updatedAt: '2026-03-29T15:00:00.000Z',
            estimatedShipDate: '2026-04-04T00:00:00.000Z',
            total: 129.9,
            deliveryMode: 'Expedition partout en France',
            clientNote: 'Validation BAT recue, lancement atelier confirme.',
            items: [
              { name: 'Sweat capuche femme', quantity: 8, technique: 'DTF', color: 'Rose poudre' },
              { name: 'Tote bag cadeau', quantity: 8, technique: 'Flocage', color: 'Naturel' }
            ],
            timeline: [
              { label: 'Commande enregistree', date: '21 mars 2026', done: true },
              { label: 'Visuels verifies', date: '22 mars 2026', done: true },
              { label: 'Production atelier', date: '29 mars 2026', done: true },
              { label: 'Expedition', date: '04 avril 2026', done: false }
            ]
          }
        ],
        tickets: [
          {
            id: 'sav_demo_001',
            orderReference: 'MP-2026-0412',
            subject: 'Ajout d\'un prenom supplementaire',
            category: 'Modification commande',
            status: 'awaiting',
            statusLabel: 'En attente atelier',
            statusTone: 'pending',
            createdAt: '2026-03-28T11:00:00.000Z',
            updatedAt: '2026-03-29T09:15:00.000Z',
            messagePreview: 'Pouvez-vous ajouter un prenom supplementaire avant la fin de production ?',
            lastReply: 'Notre atelier verifie la faisabilite avant validation.'
          }
        ]
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
        passwordSalt: professionnelPassword.salt,
        passwordHash: professionnelPassword.hash,
        orders: [
          {
            id: 'cmd_demo_002',
            reference: 'MP-2026-0387',
            title: 'Polos entreprise - 42 pieces',
            status: 'shipped',
            statusLabel: 'Expediee',
            statusTone: 'success',
            createdAt: '2026-03-12T14:10:00.000Z',
            updatedAt: '2026-03-27T16:40:00.000Z',
            estimatedShipDate: '2026-03-27T00:00:00.000Z',
            total: 684,
            deliveryMode: 'Chronopost entreprise',
            clientNote: 'Commande prioritaire avec broderie poitrine et manche.',
            items: [
              { name: 'Polo premium homme', quantity: 30, technique: 'Broderie', color: 'Bleu marine' },
              { name: 'Polo premium femme', quantity: 12, technique: 'Broderie', color: 'Blanc' }
            ],
            timeline: [
              { label: 'Brief commercial valide', date: '12 mars 2026', done: true },
              { label: 'BAT signe', date: '15 mars 2026', done: true },
              { label: 'Production finalisee', date: '25 mars 2026', done: true },
              { label: 'Expedition', date: '27 mars 2026', done: true }
            ]
          },
          {
            id: 'cmd_demo_003',
            reference: 'MP-2026-0424',
            title: 'Softshells chantier - 18 pieces',
            status: 'quote',
            statusLabel: 'Validation devis',
            statusTone: 'warning',
            createdAt: '2026-03-29T10:00:00.000Z',
            updatedAt: '2026-03-30T08:30:00.000Z',
            estimatedShipDate: '2026-04-09T00:00:00.000Z',
            total: 972,
            deliveryMode: 'Retrait atelier ou expedition',
            clientNote: 'En attente de validation finale des tailles.',
            items: [
              { name: 'Softshell travail', quantity: 18, technique: 'Broderie', color: 'Noir' }
            ],
            timeline: [
              { label: 'Demande recue', date: '29 mars 2026', done: true },
              { label: 'Devis emis', date: '30 mars 2026', done: true },
              { label: 'Validation client', date: 'A confirmer', done: false },
              { label: 'Production', date: 'A planifier', done: false }
            ]
          }
        ],
        tickets: [
          {
            id: 'sav_demo_002',
            orderReference: 'MP-2026-0387',
            subject: 'Besoin de duplicata facture',
            category: 'Facturation',
            status: 'open',
            statusLabel: 'Ouvert',
            statusTone: 'in-progress',
            createdAt: '2026-03-30T09:00:00.000Z',
            updatedAt: '2026-03-30T09:00:00.000Z',
            messagePreview: 'Pouvez-vous envoyer la facture au format PDF pour notre comptabilite ?',
            lastReply: 'Ticket recu, un retour est prevu sous 24h.'
          }
        ]
      }
    ],
    sessions: []
  };
}

function readClientStore() {
  ensureDirectory(path.dirname(CLIENT_STORE_PATH));
  if (!fs.existsSync(CLIENT_STORE_PATH)) {
    const seed = buildSeedStore();
    fs.writeFileSync(CLIENT_STORE_PATH, JSON.stringify(seed, null, 2), 'utf8');
    return seed;
  }

  try {
    const raw = fs.readFileSync(CLIENT_STORE_PATH, 'utf8');
    const parsed = raw ? JSON.parse(raw) : {};
    const store = {
      version: Number(parsed.version || 1),
      users: Array.isArray(parsed.users) ? parsed.users : [],
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : []
    };
    return store;
  } catch (_) {
    const seed = buildSeedStore();
    fs.writeFileSync(CLIENT_STORE_PATH, JSON.stringify(seed, null, 2), 'utf8');
    return seed;
  }
}

function writeClientStore(store) {
  ensureDirectory(path.dirname(CLIENT_STORE_PATH));
  fs.writeFileSync(CLIENT_STORE_PATH, JSON.stringify(store, null, 2), 'utf8');
}

function cleanupClientSessions(store) {
  const now = Date.now();
  store.sessions = (store.sessions || []).filter((session) => new Date(session.expiresAt || 0).getTime() > now);
}

function createSession(store, userId) {
  const now = new Date();
  const token = crypto.randomBytes(24).toString('hex');
  store.sessions = (store.sessions || []).filter((session) => session.userId !== userId);
  store.sessions.push({
    token,
    userId,
    createdAt: now.toISOString(),
    lastSeenAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + CLIENT_SESSION_TTL_MS).toISOString()
  });
  return token;
}

function getAuthToken(req) {
  const authHeader = String(req.headers.authorization || '').trim();
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7).trim();
  }
  return String(req.headers['x-client-token'] || '').trim();
}

function ensureAdminDocumentsStore() {
  const dir = path.dirname(ADMIN_DOCUMENTS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(ADMIN_DOCUMENTS_PATH)) {
    fs.writeFileSync(ADMIN_DOCUMENTS_PATH, JSON.stringify({ quotes: [], invoices: [] }, null, 2), 'utf8');
  }
}

function readAdminDocumentsStore() {
  ensureAdminDocumentsStore();
  try {
    const raw = fs.readFileSync(ADMIN_DOCUMENTS_PATH, 'utf8').replace(/^\uFEFF/, '');
    const parsed = JSON.parse(raw);
    return {
      quotes: Array.isArray(parsed.quotes) ? parsed.quotes : [],
      invoices: Array.isArray(parsed.invoices) ? parsed.invoices : []
    };
  } catch (_) {
    return { quotes: [], invoices: [] };
  }
}

function writeAdminDocumentsStore(store) {
  ensureAdminDocumentsStore();
  fs.writeFileSync(ADMIN_DOCUMENTS_PATH, JSON.stringify(store, null, 2), 'utf8');
}

function cleanInvoiceField(value, maxLen) {
  return String(value || '').replace(/\r?\n/g, ' ').trim().slice(0, maxLen || 240);
}

function createAdminDocumentId(prefix) {
  return String(prefix || 'doc') + '_' + Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
}

function formatInvoiceDayCode(issueDate) {
  const safe = cleanInvoiceField(issueDate, 20);
  const match = safe.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) return match[3] + match[2] + match[1].slice(2);
  const now = new Date();
  return String(now.getDate()).padStart(2, '0') + String(now.getMonth() + 1).padStart(2, '0') + String(now.getFullYear()).slice(2);
}

function getNextInvoiceReference(issueDate, excludeId) {
  const store = readAdminDocumentsStore();
  const dayCode = formatInvoiceDayCode(issueDate);
  let maxSequence = INVOICE_SEQUENCE_START - 1;
  (store.invoices || []).forEach((invoice) => {
    if (!invoice || !invoice.sentAt) return;
    if (excludeId && String(invoice.id) === String(excludeId)) return;
    const match = String(invoice.reference || '').match(/^(\d+)-(\d{6})$/);
    if (!match || match[2] !== dayCode) return;
    const sequence = Number(match[1] || 0);
    if (sequence > maxSequence) maxSequence = sequence;
  });
  return String(maxSequence + 1) + '-' + dayCode;
}

function addDaysToIsoDate(issueDate, days) {
  const base = new Date((cleanInvoiceField(issueDate, 20) || new Date().toISOString().slice(0, 10)) + 'T00:00:00');
  if (Number.isNaN(base.getTime())) return new Date().toISOString().slice(0, 10);
  base.setDate(base.getDate() + Math.max(0, Number(days || 0)));
  return base.toISOString().slice(0, 10);
}

function normalizeInvoiceItems(items) {
  return (Array.isArray(items) ? items : []).map((item) => {
    const quantity = Math.max(1, Number(item && item.quantity || 1));
    const unitPrice = Math.max(0, Number(item && item.unitPrice || 0));
    return {
      reference: cleanInvoiceField(item && item.reference, 80),
      description: cleanInvoiceField(item && item.description, 240),
      quantity,
      unitPrice: Number(unitPrice.toFixed(2)),
      total: Number((quantity * unitPrice).toFixed(2))
    };
  }).filter((item) => item.reference || item.description);
}

function buildInvoiceRecord(existingInvoice, payload, forcedReference) {
  const items = normalizeInvoiceItems(payload.items);
  const issueDate = cleanInvoiceField(payload.issueDate, 20) || new Date().toISOString().slice(0, 10);
  const paymentDueDays = Math.max(0, Number(payload.paymentDueDays || 0));
  const dueDate = addDaysToIsoDate(issueDate, paymentDueDays);
  const vatRate = Math.max(0, Number(payload.vatRate || 0));
  const total = Number(items.reduce((sum, item) => sum + item.total, 0).toFixed(2));
  const now = new Date().toISOString();
  const emailSubject = cleanInvoiceField(payload.emailSubject, 220) || ('Votre facture - Multipixels.fr, n° ' + forcedReference);
  const emailMessage = String(payload.emailMessage || '').trim();
  return {
    id: existingInvoice ? existingInvoice.id : createAdminDocumentId('invoice'),
    type: 'invoice',
    reference: forcedReference,
    customerName: cleanInvoiceField(payload.customerName || (existingInvoice && existingInvoice.customerName), 140),
    company: cleanInvoiceField(payload.company || (existingInvoice && existingInvoice.company), 140),
    email: cleanInvoiceField(payload.email || (existingInvoice && existingInvoice.email), 180),
    phone: cleanInvoiceField(payload.phone || (existingInvoice && existingInvoice.phone), 60),
    addressLine1: cleanInvoiceField(payload.addressLine1 || (existingInvoice && existingInvoice.addressLine1), 180),
    addressLine2: cleanInvoiceField(payload.addressLine2 || (existingInvoice && existingInvoice.addressLine2), 180),
    postalCode: cleanInvoiceField(payload.postalCode || (existingInvoice && existingInvoice.postalCode), 20),
    city: cleanInvoiceField(payload.city || (existingInvoice && existingInvoice.city), 120),
    country: cleanInvoiceField(payload.country || (existingInvoice && existingInvoice.country) || 'France', 120),
    address: [cleanInvoiceField(payload.addressLine1 || (existingInvoice && existingInvoice.addressLine1), 180), cleanInvoiceField(payload.addressLine2 || (existingInvoice && existingInvoice.addressLine2), 180), [cleanInvoiceField(payload.postalCode || (existingInvoice && existingInvoice.postalCode), 20), cleanInvoiceField(payload.city || (existingInvoice && existingInvoice.city), 120)].filter(Boolean).join(' '), cleanInvoiceField(payload.country || (existingInvoice && existingInvoice.country) || 'France', 120)].filter(Boolean).join(', '),
    issueDate,
    dueDate,
    paymentDueDays,
    vatRate: Number(vatRate.toFixed(2)),
    vatMention: cleanInvoiceField(payload.vatMention || (existingInvoice && existingInvoice.vatMention) || 'TVA non applicable, art. 293B du CGI', 180),
    isPaid: !!payload.isPaid,
    notes: cleanInvoiceField(payload.notes || (existingInvoice && existingInvoice.notes), 1200),
    emailSubject,
    emailMessage,
    items,
    total,
    status: payload.isPaid ? 'paid' : 'sent',
    sentAt: existingInvoice && existingInvoice.sentAt ? existingInvoice.sentAt : now,
    lastSentAt: now,
    createdAt: existingInvoice ? existingInvoice.createdAt : now,
    updatedAt: now
  };
}

function saveInvoiceRecord(invoice) {
  const store = readAdminDocumentsStore();
  const index = (store.invoices || []).findIndex((entry) => String(entry.id) === String(invoice.id));
  if (index >= 0) {
    store.invoices[index] = invoice;
  } else {
    store.invoices.unshift(invoice);
  }
  writeAdminDocumentsStore(store);
  return invoice;
}

function escapeInvoiceHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatInvoiceDateFr(value) {
  const date = new Date((value || '') + 'T00:00:00');
  if (Number.isNaN(date.getTime())) return value || '';
  return new Intl.DateTimeFormat('fr-FR').format(date);
}

function formatInvoiceMoney(value) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(Number(value || 0));
}

function buildInvoiceEmailHtml(invoice) {
  const addressLines = [invoice.customerName, invoice.company, invoice.email, invoice.addressLine1, invoice.addressLine2, [invoice.postalCode, invoice.city].filter(Boolean).join(' '), invoice.country].filter(Boolean);
  const rows = (invoice.items || []).map((item) => '<tr><td style="padding:8px;border:1px solid #c6d6e7;">' + escapeInvoiceHtml(item.reference || '-') + '</td><td style="padding:8px;border:1px solid #c6d6e7;">' + escapeInvoiceHtml(item.description || '-') + '</td><td style="padding:8px;border:1px solid #c6d6e7;text-align:center;">' + item.quantity + '</td><td style="padding:8px;border:1px solid #c6d6e7;text-align:right;">' + escapeInvoiceHtml(formatInvoiceMoney(item.unitPrice)) + '</td><td style="padding:8px;border:1px solid #c6d6e7;text-align:right;">' + escapeInvoiceHtml(formatInvoiceMoney(item.total)) + '</td></tr>').join('');
  const intro = invoice.emailMessage ? invoice.emailMessage.split(/\r?\n/).map((line) => '<div>' + escapeInvoiceHtml(line) + '</div>').join('') : '<div>Bonjour,</div><div style="margin-top:12px;">Veuillez trouver ci-dessous votre facture.</div>';
  return '<div style="font-family:Arial,sans-serif;color:#10213b;background:#eef5fd;padding:24px;">'
    + '<div style="max-width:920px;margin:0 auto;background:#ffffff;border:1px solid #d8e4f2;padding:28px;">'
    + intro
    + '<table style="width:100%;margin-top:24px;border-collapse:collapse;">'
    + '<tr><td style="vertical-align:top;padding-right:20px;">'
    + '<img src="https://multipixels.fr/assets/Background/favicon.png" alt="MULTIPIXELS" style="width:88px;height:88px;object-fit:contain;display:block;margin-bottom:12px;" />'
    + '<div style="font-size:30px;font-weight:800;color:#0f2350;">MULTIPIXELS.FR</div>'
    + '<div style="color:#587094;font-style:italic;margin-top:4px;">votre expert textile</div>'
    + '<div style="margin-top:18px;line-height:1.6;font-size:14px;">190 Chemin Blanc<br/>62180 Rang du Fliers<br/>06 27 14 08 40 | contact@multipixels.fr<br/>N° SIRET : 80 49 81 835 0000 23<br/>Code APE: 18.12Z</div>'
    + '</td><td style="width:290px;vertical-align:top;">'
    + '<div style="border:1px solid #435774;"><div style="padding:8px 12px;background:#bfdbe9;font-weight:700;text-transform:uppercase;text-align:center;">Adresse de facturation</div><div style="padding:16px 18px;text-align:center;line-height:1.6;">' + (addressLines.length ? addressLines.map(escapeInvoiceHtml).join('<br/>') : 'Informations client à compléter') + '</div></div>'
    + '</td></tr></table>'
    + '<table style="width:100%;margin-top:26px;border-collapse:collapse;">'
    + '<tr><th colspan="2" style="text-align:left;background:#bfdbe9;border:1px solid #435774;padding:10px 12px;">FACTURE N° ' + escapeInvoiceHtml(invoice.reference) + '</th></tr>'
    + '<tr><td style="border:1px solid #c6d6e7;padding:8px 12px;">Date de facturation</td><td style="border:1px solid #c6d6e7;padding:8px 12px;font-weight:700;">' + escapeInvoiceHtml(formatInvoiceDateFr(invoice.issueDate)) + '</td></tr>'
    + '<tr><td colspan="2" style="border:1px solid #c6d6e7;padding:8px 12px;">Paiement à ' + invoice.paymentDueDays + ' jours à réception de la facture</td></tr>'
    + '</table>'
    + '<table style="width:100%;margin-top:18px;border-collapse:collapse;">'
    + '<thead><tr><th style="padding:8px;border:1px solid #8ea8bd;background:#d7e8f3;text-align:left;">Référence</th><th style="padding:8px;border:1px solid #8ea8bd;background:#d7e8f3;text-align:left;">Description</th><th style="padding:8px;border:1px solid #8ea8bd;background:#d7e8f3;text-align:center;">Qté</th><th style="padding:8px;border:1px solid #8ea8bd;background:#d7e8f3;text-align:right;">Prix unitaire</th><th style="padding:8px;border:1px solid #8ea8bd;background:#d7e8f3;text-align:right;">Total TTC</th></tr></thead>'
    + '<tbody>' + rows + '</tbody></table>'
    + '<table style="width:100%;margin-top:24px;border-collapse:collapse;">'
    + '<tr><td style="vertical-align:top;padding-right:12px;">'
    + '<div style="border:1px solid #435774;"><div style="padding:8px 12px;background:#bfdbe9;text-align:center;">Conditions de paiement</div><div style="padding:16px 18px;line-height:1.7;text-align:center;">Méthodes de paiement acceptées :<br/><strong>Chèque, Virement, Espèce, CB</strong><br/><br/>VIREMENT BANCAIRE<br/>Banque : CA Nord de France<br/>IBAN : FR76 1670 6000 5154 0091 5025 361<br/>BIC : AGRIFRPP867<br/>Titulaire du compte : BAUDELOT Guillaume<br/><br/>En cas de retard de paiement, une indemnité forfaitaire de 40€ pourra être appliquée</div></div>'
    + '</td><td style="width:220px;vertical-align:top;">'
    + '<div style="border:1px solid #435774;"><div style="padding:8px 12px;background:#bfdbe9;text-align:center;font-weight:700;">TOTAL TTC</div><div style="padding:16px 18px;text-align:center;"><div style="font-size:28px;font-weight:800;">' + escapeInvoiceHtml(formatInvoiceMoney(invoice.total)) + '</div><div style="margin-top:10px;font-size:13px;">' + escapeInvoiceHtml(invoice.vatRate > 0 ? ('TVA ' + invoice.vatRate + ' % appliquée') : invoice.vatMention) + '</div></div></div>'
    + '</td></tr></table>'
    + '<div style="margin-top:24px;text-align:center;color:#3867b3;font-weight:700;">www.multipixels.fr</div></div></div>';
}

function buildInvoiceEmailText(invoice) {
  return [
    'Bonjour,',
    '',
    'Voici votre facture ' + invoice.reference + '.',
    'Date : ' + formatInvoiceDateFr(invoice.issueDate),
    'Total TTC : ' + formatInvoiceMoney(invoice.total),
    '',
    'Client : ' + invoice.customerName,
    '',
    'MULTIPIXELS.FR',
    '190 Chemin Blanc',
    '62180 Rang du Fliers',
    '06 27 14 08 40',
    'contact@multipixels.fr'
  ].join('\n');
}

function handleAdminInvoiceNextReferenceApi(req, res, requestUrl) {
  const session = requireAuthenticatedAdmin(req, res);
  if (!session) return;
  const issueDate = cleanInvoiceField(requestUrl.searchParams.get('issueDate'), 20) || new Date().toISOString().slice(0, 10);
  const documentId = cleanInvoiceField(requestUrl.searchParams.get('id'), 120);
  sendJson(res, 200, { ok: true, reference: getNextInvoiceReference(issueDate, documentId) });
}

async function handleAdminSendInvoiceApi(req, res) {
  const session = requireAuthenticatedAdmin(req, res);
  if (!session) return;

  let body;
  try {
    body = await parseJsonBody(req, 1024 * 1024);
  } catch (_) {
    sendJson(res, 400, { ok: false, error: { code: 'INVALID_JSON', message: 'Requête invalide.' } });
    return;
  }

  const items = normalizeInvoiceItems(body.items);
  const customerName = cleanInvoiceField(body.customerName, 140);
  const email = cleanInvoiceField(body.email, 180).toLowerCase();
  if (!customerName || !email || !items.length) {
    sendJson(res, 400, { ok: false, error: { code: 'ADMIN_INVOICE_INVALID', message: 'Nom client, email et au moins une ligne sont obligatoires.' } });
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    sendJson(res, 400, { ok: false, error: { code: 'ADMIN_INVOICE_EMAIL_INVALID', message: 'L’adresse email client est invalide.' } });
    return;
  }

  const store = readAdminDocumentsStore();
  const existingInvoice = (store.invoices || []).find((entry) => String(entry.id) === String(cleanInvoiceField(body.id, 120))) || null;
  const officialReference = existingInvoice && existingInvoice.sentAt ? existingInvoice.reference : getNextInvoiceReference(body.issueDate, existingInvoice && existingInvoice.id);
  const invoice = buildInvoiceRecord(existingInvoice, Object.assign({}, body, { items: items, email: email, customerName: customerName }), officialReference);

  const sent = await sendClientEmail({
    from: CONTACT_FROM,
    to: invoice.email,
    bcc: INVOICE_COPY_TO || undefined,
    replyTo: CONTACT_FROM,
    subject: invoice.emailSubject,
    text: buildInvoiceEmailText(invoice),
    html: buildInvoiceEmailHtml(invoice)
  }).catch(function () { return false; });

  if (!sent) {
    sendJson(res, 502, { ok: false, error: { code: 'ADMIN_INVOICE_SEND_FAILED', message: 'Impossible d’envoyer la facture pour le moment. Vérifiez la configuration SMTP.' } });
    return;
  }

  saveInvoiceRecord(invoice);
  sendJson(res, 200, {
    ok: true,
    invoice,
    nextReference: getNextInvoiceReference(invoice.issueDate)
  });
}
function requireAuthenticatedClient(req, res) {
  const store = readClientStore();
  cleanupClientSessions(store);
  const token = getAuthToken(req);
  if (!token) {
    writeClientStore(store);
    sendJson(res, 401, { ok: false, error: { code: 'AUTH_REQUIRED', message: 'Connexion requise.' } });
    return null;
  }

  const session = (store.sessions || []).find((item) => item.token === token);
  if (!session) {
    writeClientStore(store);
    sendJson(res, 401, { ok: false, error: { code: 'INVALID_SESSION', message: 'Session invalide ou expiree.' } });
    return null;
  }

  const user = (store.users || []).find((item) => item.id === session.userId);
  if (!user) {
    store.sessions = (store.sessions || []).filter((item) => item.token !== token);
    writeClientStore(store);
    sendJson(res, 401, { ok: false, error: { code: 'UNKNOWN_USER', message: 'Compte introuvable.' } });
    return null;
  }

  session.lastSeenAt = new Date().toISOString();
  session.expiresAt = new Date(Date.now() + CLIENT_SESSION_TTL_MS).toISOString();
  writeClientStore(store);
  return { store, user, session, token };
}

async function handleClientRegisterApi(req, res) {
  let body;
  try {
    body = await parseJsonBody(req, 256 * 1024);
  } catch (_) {
    sendJson(res, 400, { ok: false, error: { code: 'INVALID_JSON', message: 'Requete invalide.' } });
    return;
  }

  const accountType = sanitizeLine(body.accountType, 40).toLowerCase() === 'professionnel' ? 'professionnel' : 'particulier';
  const firstName = sanitizeLine(body.firstName, 80);
  const lastName = sanitizeLine(body.lastName, 80);
  const company = sanitizeLine(body.company, 140);
  const email = sanitizeLine(body.email, 180).toLowerCase();
  const phone = sanitizeLine(body.phone, 40);
  const password = String(body.password || '');

  if (!firstName || !lastName || !email || password.length < 8) {
    sendJson(res, 400, { ok: false, error: { code: 'INVALID_FIELDS', message: 'Merci de remplir correctement les informations de connexion.' } });
    return;
  }

  const store = readClientStore();
  cleanupClientSessions(store);
  const exists = (store.users || []).some((user) => String(user.email || '').toLowerCase() === email);
  if (exists) {
    writeClientStore(store);
    sendJson(res, 409, { ok: false, error: { code: 'EMAIL_EXISTS', message: 'Un compte existe deja avec cette adresse email.' } });
    return;
  }

  const passwordRecord = createPasswordRecord(password);
  const user = {
    id: createId('client'),
    accountType,
    firstName,
    lastName,
    company,
    email,
    phone,
    createdAt: new Date().toISOString(),
    lastLoginAt: null,
    passwordSalt: passwordRecord.salt,
    passwordHash: passwordRecord.hash,
    orders: [],
    tickets: []
  };

  store.users.push(user);
  user.lastLoginAt = new Date().toISOString();
  const token = createSession(store, user.id);
  writeClientStore(store);

  sendJson(res, 201, {
    ok: true,
    token,
    user: toPublicUser(user),
    dashboard: buildClientDashboard(user)
  });
}

async function handleClientLoginApi(req, res) {
  let body;
  try {
    body = await parseJsonBody(req, 16 * 1024 * 1024);
  } catch (_) {
    sendJson(res, 400, { ok: false, error: { code: 'INVALID_JSON', message: 'Requete invalide.' } });
    return;
  }

  const email = sanitizeLine(body.email, 180).toLowerCase();
  const password = String(body.password || '');
  const store = readClientStore();
  cleanupClientSessions(store);
  const user = (store.users || []).find((item) => String(item.email || '').toLowerCase() === email);

  if (!user || !verifyPassword(password, user)) {
    writeClientStore(store);
    sendJson(res, 401, { ok: false, error: { code: 'INVALID_CREDENTIALS', message: 'Email ou mot de passe incorrect.' } });
    return;
  }

  user.lastLoginAt = new Date().toISOString();
  const token = createSession(store, user.id);
  writeClientStore(store);

  sendJson(res, 200, {
    ok: true,
    token,
    user: toPublicUser(user),
    dashboard: buildClientDashboard(user)
  });
}

function handleClientSessionApi(req, res) {
  const auth = requireAuthenticatedClient(req, res);
  if (!auth) return;
  sendJson(res, 200, { ok: true, user: toPublicUser(auth.user) });
}

function handleClientDashboardApi(req, res) {
  const auth = requireAuthenticatedClient(req, res);
  if (!auth) return;
  sendJson(res, 200, { ok: true, dashboard: buildClientDashboard(auth.user) });
}

function handleClientOrdersApi(req, res) {
  const auth = requireAuthenticatedClient(req, res);
  if (!auth) return;
  sendJson(res, 200, { ok: true, orders: serializeOrders(auth.user.orders || []) });
}

function handleClientTicketsApi(req, res) {
  const auth = requireAuthenticatedClient(req, res);
  if (!auth) return;
  sendJson(res, 200, { ok: true, tickets: serializeTickets(auth.user.tickets || []) });
}

async function handleClientCreateTicketApi(req, res) {
  const auth = requireAuthenticatedClient(req, res);
  if (!auth) return;

  let body;
  try {
    body = await parseJsonBody(req, 256 * 1024);
  } catch (_) {
    sendJson(res, 400, { ok: false, error: { code: 'INVALID_JSON', message: 'Requete invalide.' } });
    return;
  }

  const subject = sanitizeLine(body.subject, 140);
  const category = sanitizeLine(body.category, 80) || 'SAV';
  const orderReference = sanitizeLine(body.orderReference, 80);
  const message = normalizeWhitespace(String(body.message || '').slice(0, 3000));

  if (!subject || !message) {
    sendJson(res, 400, { ok: false, error: { code: 'INVALID_TICKET', message: 'Merci de preciser un sujet et votre demande SAV.' } });
    return;
  }

  const ticket = {
    id: createId('sav'),
    orderReference,
    subject,
    category,
    status: 'open',
    statusLabel: 'Ouvert',
    statusTone: 'in-progress',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messagePreview: message.slice(0, 180),
    lastReply: 'Ticket recu, notre equipe reviendra vers vous sous 24 a 48h.'
  };

  auth.user.tickets = Array.isArray(auth.user.tickets) ? auth.user.tickets : [];
  auth.user.tickets.unshift(ticket);
  writeClientStore(auth.store);
  sendJson(res, 201, { ok: true, ticket, tickets: serializeTickets(auth.user.tickets) });
}

async function handleClientProfileApi(req, res) {
  const auth = requireAuthenticatedClient(req, res);
  if (!auth) return;

  let body;
  try {
    body = await parseJsonBody(req, 16 * 1024 * 1024);
  } catch (_) {
    sendJson(res, 400, { ok: false, error: { code: 'INVALID_JSON', message: 'Requete invalide.' } });
    return;
  }

  auth.user.firstName = sanitizeLine(body.firstName || auth.user.firstName, 80) || auth.user.firstName;
  auth.user.lastName = sanitizeLine(body.lastName || auth.user.lastName, 80) || auth.user.lastName;
  auth.user.company = sanitizeLine(body.company || auth.user.company, 140);
  auth.user.phone = sanitizeLine(body.phone || auth.user.phone, 40);
  if (sanitizeLine(body.accountType, 40)) {
    auth.user.accountType = sanitizeLine(body.accountType, 40).toLowerCase() === 'professionnel' ? 'professionnel' : 'particulier';
  }

  writeClientStore(auth.store);
  sendJson(res, 200, { ok: true, user: toPublicUser(auth.user), dashboard: buildClientDashboard(auth.user) });
}

function handleClientLogoutApi(req, res) {
  const token = getAuthToken(req);
  const store = readClientStore();
  cleanupClientSessions(store);
  if (token) {
    store.sessions = (store.sessions || []).filter((session) => session.token !== token);
  }
  writeClientStore(store);
  sendJson(res, 200, { ok: true });
}


function getClientAuth(req) {
  const token = getAuthToken(req);
  if (!token) return null;
  return clientDb.getSession(token);
}

async function sendClientEmail(options) {
  if (!nodemailer || !SMTP_HOST || !SMTP_USER || !SMTP_PASS || !options || !options.to) return false;
  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });
  await transporter.sendMail({
    from: options.from || CONTACT_FROM,
    sender: SMTP_USER || CONTACT_FROM,
    to: options.to,
    bcc: options.bcc || undefined,
    replyTo: options.replyTo || undefined,
    subject: options.subject,
    text: options.text,
    html: options.html
  });
  return true;
}

function ensureAdminDocumentsStore() {
  const dir = path.dirname(ADMIN_DOCUMENTS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(ADMIN_DOCUMENTS_PATH)) {
    fs.writeFileSync(ADMIN_DOCUMENTS_PATH, JSON.stringify({ quotes: [], invoices: [] }, null, 2), 'utf8');
  }
}

function readAdminDocumentsStore() {
  ensureAdminDocumentsStore();
  try {
    const raw = fs.readFileSync(ADMIN_DOCUMENTS_PATH, 'utf8').replace(/^\uFEFF/, '');
    const parsed = JSON.parse(raw);
    return {
      quotes: Array.isArray(parsed.quotes) ? parsed.quotes : [],
      invoices: Array.isArray(parsed.invoices) ? parsed.invoices : []
    };
  } catch (_) {
    return { quotes: [], invoices: [] };
  }
}

function writeAdminDocumentsStore(store) {
  ensureAdminDocumentsStore();
  fs.writeFileSync(ADMIN_DOCUMENTS_PATH, JSON.stringify(store, null, 2), 'utf8');
}

function cleanInvoiceField(value, maxLen) {
  return String(value || '').replace(/\r?\n/g, ' ').trim().slice(0, maxLen || 240);
}

function createAdminDocumentId(prefix) {
  return String(prefix || 'doc') + '_' + Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
}

function formatInvoiceDayCode(issueDate) {
  const safe = cleanInvoiceField(issueDate, 20);
  const match = safe.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) return match[3] + match[2] + match[1].slice(2);
  const now = new Date();
  return String(now.getDate()).padStart(2, '0') + String(now.getMonth() + 1).padStart(2, '0') + String(now.getFullYear()).slice(2);
}

function getNextInvoiceReference(issueDate, excludeId) {
  const store = readAdminDocumentsStore();
  const dayCode = formatInvoiceDayCode(issueDate);
  let maxSequence = INVOICE_SEQUENCE_START - 1;
  (store.invoices || []).forEach((invoice) => {
    if (!invoice || !invoice.sentAt) return;
    if (excludeId && String(invoice.id) === String(excludeId)) return;
    const match = String(invoice.reference || '').match(/^(\d+)-(\d{6})$/);
    if (!match || match[2] !== dayCode) return;
    const sequence = Number(match[1] || 0);
    if (sequence > maxSequence) maxSequence = sequence;
  });
  return String(maxSequence + 1) + '-' + dayCode;
}

function addDaysToIsoDate(issueDate, days) {
  const base = new Date((cleanInvoiceField(issueDate, 20) || new Date().toISOString().slice(0, 10)) + 'T00:00:00');
  if (Number.isNaN(base.getTime())) return new Date().toISOString().slice(0, 10);
  base.setDate(base.getDate() + Math.max(0, Number(days || 0)));
  return base.toISOString().slice(0, 10);
}

function normalizeInvoiceItems(items) {
  return (Array.isArray(items) ? items : []).map((item) => {
    const quantity = Math.max(1, Number(item && item.quantity || 1));
    const unitPrice = Math.max(0, Number(item && item.unitPrice || 0));
    return {
      reference: cleanInvoiceField(item && item.reference, 80),
      description: cleanInvoiceField(item && item.description, 240),
      quantity,
      unitPrice: Number(unitPrice.toFixed(2)),
      total: Number((quantity * unitPrice).toFixed(2))
    };
  }).filter((item) => item.reference || item.description);
}

function buildInvoiceRecord(existingInvoice, payload, forcedReference) {
  const items = normalizeInvoiceItems(payload.items);
  const issueDate = cleanInvoiceField(payload.issueDate, 20) || new Date().toISOString().slice(0, 10);
  const paymentDueDays = Math.max(0, Number(payload.paymentDueDays || 0));
  const dueDate = addDaysToIsoDate(issueDate, paymentDueDays);
  const vatRate = Math.max(0, Number(payload.vatRate || 0));
  const total = Number(items.reduce((sum, item) => sum + item.total, 0).toFixed(2));
  const now = new Date().toISOString();
  const emailSubject = cleanInvoiceField(payload.emailSubject, 220) || ('Votre facture - Multipixels.fr, n° ' + forcedReference);
  const emailMessage = String(payload.emailMessage || '').trim();
  return {
    id: existingInvoice ? existingInvoice.id : createAdminDocumentId('invoice'),
    type: 'invoice',
    reference: forcedReference,
    customerName: cleanInvoiceField(payload.customerName || (existingInvoice && existingInvoice.customerName), 140),
    company: cleanInvoiceField(payload.company || (existingInvoice && existingInvoice.company), 140),
    email: cleanInvoiceField(payload.email || (existingInvoice && existingInvoice.email), 180),
    phone: cleanInvoiceField(payload.phone || (existingInvoice && existingInvoice.phone), 60),
    addressLine1: cleanInvoiceField(payload.addressLine1 || (existingInvoice && existingInvoice.addressLine1), 180),
    addressLine2: cleanInvoiceField(payload.addressLine2 || (existingInvoice && existingInvoice.addressLine2), 180),
    postalCode: cleanInvoiceField(payload.postalCode || (existingInvoice && existingInvoice.postalCode), 20),
    city: cleanInvoiceField(payload.city || (existingInvoice && existingInvoice.city), 120),
    country: cleanInvoiceField(payload.country || (existingInvoice && existingInvoice.country) || 'France', 120),
    address: [cleanInvoiceField(payload.addressLine1 || (existingInvoice && existingInvoice.addressLine1), 180), cleanInvoiceField(payload.addressLine2 || (existingInvoice && existingInvoice.addressLine2), 180), [cleanInvoiceField(payload.postalCode || (existingInvoice && existingInvoice.postalCode), 20), cleanInvoiceField(payload.city || (existingInvoice && existingInvoice.city), 120)].filter(Boolean).join(' '), cleanInvoiceField(payload.country || (existingInvoice && existingInvoice.country) || 'France', 120)].filter(Boolean).join(', '),
    issueDate,
    dueDate,
    paymentDueDays,
    vatRate: Number(vatRate.toFixed(2)),
    vatMention: cleanInvoiceField(payload.vatMention || (existingInvoice && existingInvoice.vatMention) || 'TVA non applicable, art. 293B du CGI', 180),
    isPaid: !!payload.isPaid,
    notes: cleanInvoiceField(payload.notes || (existingInvoice && existingInvoice.notes), 1200),
    emailSubject,
    emailMessage,
    items,
    total,
    status: payload.isPaid ? 'paid' : 'sent',
    sentAt: existingInvoice && existingInvoice.sentAt ? existingInvoice.sentAt : now,
    lastSentAt: now,
    createdAt: existingInvoice ? existingInvoice.createdAt : now,
    updatedAt: now
  };
}

function saveInvoiceRecord(invoice) {
  const store = readAdminDocumentsStore();
  const index = (store.invoices || []).findIndex((entry) => String(entry.id) === String(invoice.id));
  if (index >= 0) {
    store.invoices[index] = invoice;
  } else {
    store.invoices.unshift(invoice);
  }
  writeAdminDocumentsStore(store);
  return invoice;
}

function escapeInvoiceHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatInvoiceDateFr(value) {
  const date = new Date((value || '') + 'T00:00:00');
  if (Number.isNaN(date.getTime())) return value || '';
  return new Intl.DateTimeFormat('fr-FR').format(date);
}

function formatInvoiceMoney(value) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(Number(value || 0));
}

function buildInvoiceEmailHtml(invoice) {
  const addressLines = [invoice.customerName, invoice.company, invoice.email, invoice.addressLine1, invoice.addressLine2, [invoice.postalCode, invoice.city].filter(Boolean).join(' '), invoice.country].filter(Boolean);
  const rows = (invoice.items || []).map((item) => '<tr><td style="padding:8px;border:1px solid #c6d6e7;">' + escapeInvoiceHtml(item.reference || '-') + '</td><td style="padding:8px;border:1px solid #c6d6e7;">' + escapeInvoiceHtml(item.description || '-') + '</td><td style="padding:8px;border:1px solid #c6d6e7;text-align:center;">' + item.quantity + '</td><td style="padding:8px;border:1px solid #c6d6e7;text-align:right;">' + escapeInvoiceHtml(formatInvoiceMoney(item.unitPrice)) + '</td><td style="padding:8px;border:1px solid #c6d6e7;text-align:right;">' + escapeInvoiceHtml(formatInvoiceMoney(item.total)) + '</td></tr>').join('');
  const intro = invoice.emailMessage ? invoice.emailMessage.split(/\r?\n/).map((line) => '<div>' + escapeInvoiceHtml(line) + '</div>').join('') : '<div>Bonjour,</div><div style="margin-top:12px;">Veuillez trouver ci-dessous votre facture.</div>';
  return '<div style="font-family:Arial,sans-serif;color:#10213b;background:#eef5fd;padding:24px;">'
    + '<div style="max-width:920px;margin:0 auto;background:#ffffff;border:1px solid #d8e4f2;padding:28px;">'
    + intro
    + '<table style="width:100%;margin-top:24px;border-collapse:collapse;">'
    + '<tr><td style="vertical-align:top;padding-right:20px;">'
    + '<img src="https://multipixels.fr/assets/Background/favicon.png" alt="MULTIPIXELS" style="width:88px;height:88px;object-fit:contain;display:block;margin-bottom:12px;" />'
    + '<div style="font-size:30px;font-weight:800;color:#0f2350;">MULTIPIXELS.FR</div>'
    + '<div style="color:#587094;font-style:italic;margin-top:4px;">votre expert textile</div>'
    + '<div style="margin-top:18px;line-height:1.6;font-size:14px;">190 Chemin Blanc<br/>62180 Rang du Fliers<br/>06 27 14 08 40 | contact@multipixels.fr<br/>N° SIRET : 80 49 81 835 0000 23<br/>Code APE: 18.12Z</div>'
    + '</td><td style="width:290px;vertical-align:top;">'
    + '<div style="border:1px solid #435774;"><div style="padding:8px 12px;background:#bfdbe9;font-weight:700;text-transform:uppercase;text-align:center;">Adresse de facturation</div><div style="padding:16px 18px;text-align:center;line-height:1.6;">' + (addressLines.length ? addressLines.map(escapeInvoiceHtml).join('<br/>') : 'Informations client à compléter') + '</div></div>'
    + '</td></tr></table>'
    + '<table style="width:100%;margin-top:26px;border-collapse:collapse;">'
    + '<tr><th colspan="2" style="text-align:left;background:#bfdbe9;border:1px solid #435774;padding:10px 12px;">FACTURE N° ' + escapeInvoiceHtml(invoice.reference) + '</th></tr>'
    + '<tr><td style="border:1px solid #c6d6e7;padding:8px 12px;">Date de facturation</td><td style="border:1px solid #c6d6e7;padding:8px 12px;font-weight:700;">' + escapeInvoiceHtml(formatInvoiceDateFr(invoice.issueDate)) + '</td></tr>'
    + '<tr><td colspan="2" style="border:1px solid #c6d6e7;padding:8px 12px;">Paiement à ' + invoice.paymentDueDays + ' jours à réception de la facture</td></tr>'
    + '</table>'
    + '<table style="width:100%;margin-top:18px;border-collapse:collapse;">'
    + '<thead><tr><th style="padding:8px;border:1px solid #8ea8bd;background:#d7e8f3;text-align:left;">Référence</th><th style="padding:8px;border:1px solid #8ea8bd;background:#d7e8f3;text-align:left;">Description</th><th style="padding:8px;border:1px solid #8ea8bd;background:#d7e8f3;text-align:center;">Qté</th><th style="padding:8px;border:1px solid #8ea8bd;background:#d7e8f3;text-align:right;">Prix unitaire</th><th style="padding:8px;border:1px solid #8ea8bd;background:#d7e8f3;text-align:right;">Total TTC</th></tr></thead>'
    + '<tbody>' + rows + '</tbody></table>'
    + '<table style="width:100%;margin-top:24px;border-collapse:collapse;">'
    + '<tr><td style="vertical-align:top;padding-right:12px;">'
    + '<div style="border:1px solid #435774;"><div style="padding:8px 12px;background:#bfdbe9;text-align:center;">Conditions de paiement</div><div style="padding:16px 18px;line-height:1.7;text-align:center;">Méthodes de paiement acceptées :<br/><strong>Chèque, Virement, Espèce, CB</strong><br/><br/>VIREMENT BANCAIRE<br/>Banque : CA Nord de France<br/>IBAN : FR76 1670 6000 5154 0091 5025 361<br/>BIC : AGRIFRPP867<br/>Titulaire du compte : BAUDELOT Guillaume<br/><br/>En cas de retard de paiement, une indemnité forfaitaire de 40€ pourra être appliquée</div></div>'
    + '</td><td style="width:220px;vertical-align:top;">'
    + '<div style="border:1px solid #435774;"><div style="padding:8px 12px;background:#bfdbe9;text-align:center;font-weight:700;">TOTAL TTC</div><div style="padding:16px 18px;text-align:center;"><div style="font-size:28px;font-weight:800;">' + escapeInvoiceHtml(formatInvoiceMoney(invoice.total)) + '</div><div style="margin-top:10px;font-size:13px;">' + escapeInvoiceHtml(invoice.vatRate > 0 ? ('TVA ' + invoice.vatRate + ' % appliquée') : invoice.vatMention) + '</div></div></div>'
    + '</td></tr></table>'
    + '<div style="margin-top:24px;text-align:center;color:#3867b3;font-weight:700;">www.multipixels.fr</div></div></div>';
}

function buildInvoiceEmailText(invoice) {
  return [
    'Bonjour,',
    '',
    'Voici votre facture ' + invoice.reference + '.',
    'Date : ' + formatInvoiceDateFr(invoice.issueDate),
    'Total TTC : ' + formatInvoiceMoney(invoice.total),
    '',
    'Client : ' + invoice.customerName,
    '',
    'MULTIPIXELS.FR',
    '190 Chemin Blanc',
    '62180 Rang du Fliers',
    '06 27 14 08 40',
    'contact@multipixels.fr'
  ].join('\n');
}

function handleAdminInvoiceNextReferenceApi(req, res, requestUrl) {
  const session = requireAuthenticatedAdmin(req, res);
  if (!session) return;
  const issueDate = cleanInvoiceField(requestUrl.searchParams.get('issueDate'), 20) || new Date().toISOString().slice(0, 10);
  const documentId = cleanInvoiceField(requestUrl.searchParams.get('id'), 120);
  sendJson(res, 200, { ok: true, reference: getNextInvoiceReference(issueDate, documentId) });
}

async function handleAdminSendInvoiceApi(req, res) {
  const session = requireAuthenticatedAdmin(req, res);
  if (!session) return;

  let body;
  try {
    body = await parseJsonBody(req, 1024 * 1024);
  } catch (_) {
    sendJson(res, 400, { ok: false, error: { code: 'INVALID_JSON', message: 'Requête invalide.' } });
    return;
  }

  const items = normalizeInvoiceItems(body.items);
  const customerName = cleanInvoiceField(body.customerName, 140);
  const email = cleanInvoiceField(body.email, 180).toLowerCase();
  if (!customerName || !email || !items.length) {
    sendJson(res, 400, { ok: false, error: { code: 'ADMIN_INVOICE_INVALID', message: 'Nom client, email et au moins une ligne sont obligatoires.' } });
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    sendJson(res, 400, { ok: false, error: { code: 'ADMIN_INVOICE_EMAIL_INVALID', message: 'L’adresse email client est invalide.' } });
    return;
  }

  const store = readAdminDocumentsStore();
  const existingInvoice = (store.invoices || []).find((entry) => String(entry.id) === String(cleanInvoiceField(body.id, 120))) || null;
  const officialReference = existingInvoice && existingInvoice.sentAt ? existingInvoice.reference : getNextInvoiceReference(body.issueDate, existingInvoice && existingInvoice.id);
  const invoice = buildInvoiceRecord(existingInvoice, Object.assign({}, body, { items: items, email: email, customerName: customerName }), officialReference);

  const sent = await sendClientEmail({
    from: CONTACT_FROM,
    to: invoice.email,
    bcc: INVOICE_COPY_TO || undefined,
    replyTo: CONTACT_FROM,
    subject: invoice.emailSubject,
    text: buildInvoiceEmailText(invoice),
    html: buildInvoiceEmailHtml(invoice)
  }).catch(function () { return false; });

  if (!sent) {
    sendJson(res, 502, { ok: false, error: { code: 'ADMIN_INVOICE_SEND_FAILED', message: 'Impossible d’envoyer la facture pour le moment. Vérifiez la configuration SMTP.' } });
    return;
  }

  saveInvoiceRecord(invoice);
  sendJson(res, 200, {
    ok: true,
    invoice,
    nextReference: getNextInvoiceReference(invoice.issueDate)
  });
}
function requireAuthenticatedClient(req, res) {
  const auth = getClientAuth(req);
  if (!auth || !auth.user) {
    sendJson(res, 401, { ok: false, error: { code: 'AUTH_REQUIRED', message: 'Connexion requise.' } });
    return null;
  }
  return auth;
}

async function handleClientRegisterApi(req, res) {
  let body;
  try {
    body = await parseJsonBody(req, 256 * 1024);
  } catch (_) {
    sendJson(res, 400, { ok: false, error: { code: 'INVALID_JSON', message: 'Requete invalide.' } });
    return;
  }

  const accountType = sanitizeLine(body.accountType, 40).toLowerCase() === 'professionnel' ? 'professionnel' : 'particulier';
  const firstName = sanitizeLine(body.firstName, 80);
  const lastName = sanitizeLine(body.lastName, 80);
  const company = sanitizeLine(body.company, 140);
  const email = sanitizeLine(body.email, 180).toLowerCase();
  const phone = sanitizeLine(body.phone, 40);
  const password = String(body.password || '');

  if (!firstName || !lastName || !email || password.length < 8) {
    sendJson(res, 400, { ok: false, error: { code: 'INVALID_FIELDS', message: 'Merci de remplir correctement les informations de connexion.' } });
    return;
  }

  if (clientDb.findUserByEmail(email)) {
    sendJson(res, 409, { ok: false, error: { code: 'EMAIL_EXISTS', message: 'Un compte existe deja avec cette adresse email.' } });
    return;
  }

  const user = clientDb.createUser({ accountType, firstName, lastName, company, email, phone, password });
  const refreshed = clientDb.touchLastLogin(user.id);
  const token = clientDb.createSession(user.id);
  sendJson(res, 201, { ok: true, token, user: dbToPublicUser(refreshed), dashboard: clientDb.getDashboard(user.id) });
}

async function handleClientLoginApi(req, res) {
  let body;
  try {
    body = await parseJsonBody(req, 16 * 1024 * 1024);
  } catch (_) {
    sendJson(res, 400, { ok: false, error: { code: 'INVALID_JSON', message: 'Requete invalide.' } });
    return;
  }

  const email = sanitizeLine(body.email, 180).toLowerCase();
  const password = String(body.password || '');
  const user = clientDb.verifyUser(email, password);
  if (!user) {
    sendJson(res, 401, { ok: false, error: { code: 'INVALID_CREDENTIALS', message: 'Email ou mot de passe incorrect.' } });
    return;
  }

  const refreshed = clientDb.touchLastLogin(user.id);
  const token = clientDb.createSession(user.id);
  sendJson(res, 200, { ok: true, token, user: dbToPublicUser(refreshed), dashboard: clientDb.getDashboard(user.id) });
}

function handleClientSessionApi(req, res) {
  const auth = requireAuthenticatedClient(req, res);
  if (!auth) return;
  sendJson(res, 200, { ok: true, user: dbToPublicUser(auth.user) });
}

function handleClientDashboardApi(req, res) {
  const auth = requireAuthenticatedClient(req, res);
  if (!auth) return;
  sendJson(res, 200, { ok: true, dashboard: clientDb.getDashboard(auth.user.id) });
}

function handleClientOrdersApi(req, res) {
  const auth = requireAuthenticatedClient(req, res);
  if (!auth) return;
  sendJson(res, 200, { ok: true, orders: clientDb.listOrders(auth.user.id) });
}

function handleClientTicketsApi(req, res) {
  const auth = requireAuthenticatedClient(req, res);
  if (!auth) return;
  sendJson(res, 200, { ok: true, tickets: clientDb.listTickets(auth.user.id) });
}

async function handleClientCreateTicketApi(req, res) {
  const auth = requireAuthenticatedClient(req, res);
  if (!auth) return;
  let body;
  try {
    body = await parseJsonBody(req, 256 * 1024);
  } catch (_) {
    sendJson(res, 400, { ok: false, error: { code: 'INVALID_JSON', message: 'Requete invalide.' } });
    return;
  }

  const subject = sanitizeLine(body.subject, 140);
  const category = sanitizeLine(body.category, 80) || 'SAV';
  const orderReference = sanitizeLine(body.orderReference, 80);
  const message = normalizeWhitespace(String(body.message || '').slice(0, 3000));
  if (!subject || !message) {
    sendJson(res, 400, { ok: false, error: { code: 'INVALID_TICKET', message: 'Merci de preciser un sujet et votre demande SAV.' } });
    return;
  }

  const ticket = clientDb.createTicket(auth.user.id, { subject, category, orderReference, message });
  sendJson(res, 201, { ok: true, ticket, tickets: clientDb.listTickets(auth.user.id) });
}

async function handleClientProfileApi(req, res) {
  const auth = requireAuthenticatedClient(req, res);
  if (!auth) return;
  let body;
  try {
    body = await parseJsonBody(req, 16 * 1024 * 1024);
  } catch (_) {
    sendJson(res, 400, { ok: false, error: { code: 'INVALID_JSON', message: 'Requete invalide.' } });
    return;
  }

  const hasField = function (field) {
    return Object.prototype.hasOwnProperty.call(body, field);
  };

  const updated = clientDb.updateProfile(auth.user.id, {
    firstName: hasField('firstName') ? (sanitizeLine(body.firstName, 80) || auth.user.firstName) : auth.user.firstName,
    lastName: hasField('lastName') ? (sanitizeLine(body.lastName, 80) || auth.user.lastName) : auth.user.lastName,
    company: hasField('company') ? sanitizeLine(body.company, 140) : auth.user.company,
    phone: hasField('phone') ? sanitizeLine(body.phone, 40) : auth.user.phone,
    addressLine1: hasField('addressLine1') ? sanitizeLine(body.addressLine1, 180) : auth.user.addressLine1,
    addressLine2: hasField('addressLine2') ? sanitizeLine(body.addressLine2, 180) : auth.user.addressLine2,
    postalCode: hasField('postalCode') ? sanitizeLine(body.postalCode, 10) : auth.user.postalCode,
    city: hasField('city') ? sanitizeLine(body.city, 120) : auth.user.city,
    accountType: hasField('accountType') ? sanitizeLine(body.accountType, 40) : auth.user.accountType
  });

  sendJson(res, 200, { ok: true, user: dbToPublicUser(updated), dashboard: clientDb.getDashboard(auth.user.id) });
}

function handleClientLogoutApi(req, res) {
  const token = getAuthToken(req);
  if (token) clientDb.deleteSession(token);
  sendJson(res, 200, { ok: true });
}

async function handleClientRequestPasswordResetApi(req, res) {
  let body;
  try {
    body = await parseJsonBody(req, 16 * 1024 * 1024);
  } catch (_) {
    sendJson(res, 400, { ok: false, error: { code: 'INVALID_JSON', message: 'Requete invalide.' } });
    return;
  }

  const email = sanitizeLine(body.email, 180).toLowerCase();
  const user = clientDb.findUserByEmail(email);
  if (!user) {
    sendJson(res, 200, { ok: true, message: 'Si un compte existe, un email de reinitialisation sera envoye.' });
    return;
  }

  const reset = clientDb.createPasswordReset(user.id);
  const resetUrl = CLIENT_APP_BASE_URL.replace(/\/$/, '') + '/reinitialiser-mot-de-passe.html?token=' + encodeURIComponent(reset.token);
  try {
    await sendClientEmail({
      to: user.email,
      subject: 'Reinitialisation de votre mot de passe MULTIPIXELS',
      text: 'Bonjour,\n\nVoici votre lien de reinitialisation : ' + resetUrl + '\n\nCe lien expire dans 30 minutes.',
      html: '<p>Bonjour,</p><p>Voici votre lien de reinitialisation :</p><p><a href="' + resetUrl + '">' + resetUrl + '</a></p><p>Ce lien expire dans 30 minutes.</p>'
    });
    sendJson(res, 200, { ok: true, message: 'Si un compte existe, un email de reinitialisation sera envoye.' });
  } catch (_) {
    sendJson(res, 200, { ok: true, message: 'Lien de reinitialisation genere.', resetUrl });
  }
}

async function handleClientResetPasswordApi(req, res) {
  let body;
  try {
    body = await parseJsonBody(req, 16 * 1024 * 1024);
  } catch (_) {
    sendJson(res, 400, { ok: false, error: { code: 'INVALID_JSON', message: 'Requete invalide.' } });
    return;
  }

  const token = sanitizeLine(body.token, 120);
  const password = String(body.password || '');
  if (!token || password.length < 8) {
    sendJson(res, 400, { ok: false, error: { code: 'INVALID_FIELDS', message: 'Lien invalide ou mot de passe trop court.' } });
    return;
  }

  const user = clientDb.resetPassword(token, password);
  if (!user) {
    sendJson(res, 400, { ok: false, error: { code: 'RESET_TOKEN_INVALID', message: 'Le lien de reinitialisation est invalide ou expire.' } });
    return;
  }

  const refreshed = clientDb.touchLastLogin(user.id);
  const sessionToken = clientDb.createSession(user.id);
  sendJson(res, 200, { ok: true, token: sessionToken, user: dbToPublicUser(refreshed), dashboard: clientDb.getDashboard(user.id) });
}

function sanitizePathname(urlPath) {
  try {
    const decoded = decodeURIComponent(urlPath);
    return path.normalize(decoded).replace(/^(\.\.[/\\])+/, "");
  } catch (_) {
    return "";
  }
}

function getAdminToken(req) {
  const authHeader = String(req.headers.authorization || '').trim();
  if (authHeader.toLowerCase().startsWith('bearer ')) return authHeader.slice(7).trim();
  return String(req.headers['x-admin-token'] || '').trim();
}

function requireAuthenticatedAdmin(req, res) {
  const session = adminTools.getSession(getAdminToken(req));
  if (!session) {
    sendJson(res, 401, { ok: false, error: { code: 'ADMIN_UNAUTHORIZED', message: 'Connexion administrateur requise.' } });
    return null;
  }
  return session;
}

async function handleAdminLoginApi(req, res) {
  let body;
  try {
    body = await parseJsonBody(req, 64 * 1024);
  } catch (_) {
    sendJson(res, 400, { ok: false, error: { code: 'INVALID_JSON', message: 'Requête invalide.' } });
    return;
  }

  const result = adminTools.login(sanitizeLine(body.email, 180).toLowerCase(), String(body.password || ''));
  if (!result) {
    sendJson(res, 401, { ok: false, error: { code: 'INVALID_ADMIN_LOGIN', message: 'Identifiants administrateur invalides.' } });
    return;
  }

  sendJson(res, 200, { ok: true, token: result.token, admin: result.admin });
}

function handleAdminSessionApi(req, res) {
  const session = requireAuthenticatedAdmin(req, res);
  if (!session) return;
  sendJson(res, 200, { ok: true, admin: { email: session.email, role: 'admin', displayName: 'Administration MULTIPIXELS' } });
}

function handleAdminLogoutApi(req, res) {
  adminTools.logout(getAdminToken(req));
  sendJson(res, 200, { ok: true });
}

function handleAdminDashboardApi(req, res) {
  const session = requireAuthenticatedAdmin(req, res);
  if (!session) return;
  sendJson(res, 200, { ok: true, dashboard: adminTools.getDashboard() });
}

function handleAdminClientsApi(req, res) {
  const session = requireAuthenticatedAdmin(req, res);
  if (!session) return;
  sendJson(res, 200, { ok: true, clients: adminTools.listClients() });
}

function handleAdminOrdersApi(req, res) {
  const session = requireAuthenticatedAdmin(req, res);
  if (!session) return;
  sendJson(res, 200, { ok: true, orders: adminTools.listOrders() });
}

function handleAdminTicketsApi(req, res) {
  const session = requireAuthenticatedAdmin(req, res);
  if (!session) return;
  sendJson(res, 200, { ok: true, tickets: adminTools.listTickets() });
}

function handleCatalogueExtraProductsApi(req, res) {
  sendJson(res, 200, { ok: true, products: adminTools.listProducts() });
}

function handleAdminProductsApi(req, res) {
  const session = requireAuthenticatedAdmin(req, res);
  if (!session) return;
  sendJson(res, 200, { ok: true, products: adminTools.listProducts() });
}

async function handleAdminCreateProductApi(req, res) {
  const session = requireAuthenticatedAdmin(req, res);
  if (!session) return;
  let body;
  try {
    body = await parseJsonBody(req, 16 * 1024 * 1024);
  } catch (_) {
    sendJson(res, 400, { ok: false, error: { code: 'INVALID_JSON', message: 'Requête invalide.' } });
    return;
  }

  if (!sanitizeLine(body.name, 140) || !sanitizeLine(body.image, 260)) {
    sendJson(res, 400, { ok: false, error: { code: 'ADMIN_PRODUCT_INVALID', message: 'Le nom du produit et le visuel sont obligatoires.' } });
    return;
  }

  const product = adminTools.createProduct(body);
  sendJson(res, 201, { ok: true, product, products: adminTools.listProducts() });
}

async function handleAdminUpdateProductApi(req, res) {
  const session = requireAuthenticatedAdmin(req, res);
  if (!session) return;
  let body;
  try {
    body = await parseJsonBody(req, 16 * 1024 * 1024);
  } catch (_) {
    sendJson(res, 400, { ok: false, error: { code: 'INVALID_JSON', message: 'Requête invalide.' } });
    return;
  }

  const productId = sanitizeLine(body.id, 120);
  if (!productId) {
    sendJson(res, 400, { ok: false, error: { code: 'ADMIN_PRODUCT_ID_MISSING', message: 'Produit introuvable.' } });
    return;
  }

  const product = adminTools.updateProduct(productId, body);
  if (!product) {
    sendJson(res, 404, { ok: false, error: { code: 'ADMIN_PRODUCT_NOT_FOUND', message: 'Produit introuvable.' } });
    return;
  }

  sendJson(res, 200, { ok: true, product, products: adminTools.listProducts() });
}

function handleAdminDeleteProductApi(req, res, requestUrl) {
  const session = requireAuthenticatedAdmin(req, res);
  if (!session) return;
  const productId = sanitizeLine(requestUrl.searchParams.get('id'), 120);
  if (!productId) {
    sendJson(res, 400, { ok: false, error: { code: 'ADMIN_PRODUCT_ID_MISSING', message: 'Produit introuvable.' } });
    return;
  }
  const deleted = adminTools.deleteProduct(productId);
  if (!deleted) {
    sendJson(res, 404, { ok: false, error: { code: 'ADMIN_PRODUCT_NOT_FOUND', message: 'Produit introuvable.' } });
    return;
  }
  sendJson(res, 200, { ok: true, products: adminTools.listProducts() });
}

async function handleAdminUpdateOrderApi(req, res) {
  const session = requireAuthenticatedAdmin(req, res);
  if (!session) return;
  let body;
  try {
    body = await parseJsonBody(req, 64 * 1024);
  } catch (_) {
    sendJson(res, 400, { ok: false, error: { code: 'INVALID_JSON', message: 'Requête invalide.' } });
    return;
  }

  const orderId = sanitizeLine(body.id, 120);
  if (!orderId) {
    sendJson(res, 400, { ok: false, error: { code: 'ADMIN_ORDER_ID_MISSING', message: 'Commande introuvable.' } });
    return;
  }

  const order = adminTools.updateOrder(orderId, body);
  if (!order) {
    sendJson(res, 404, { ok: false, error: { code: 'ADMIN_ORDER_NOT_FOUND', message: 'Commande introuvable.' } });
    return;
  }

  sendJson(res, 200, { ok: true, order, orders: adminTools.listOrders() });
}

async function handleAdminUpdateTicketApi(req, res) {
  const session = requireAuthenticatedAdmin(req, res);
  if (!session) return;
  let body;
  try {
    body = await parseJsonBody(req, 64 * 1024);
  } catch (_) {
    sendJson(res, 400, { ok: false, error: { code: 'INVALID_JSON', message: 'Requête invalide.' } });
    return;
  }

  const ticketId = sanitizeLine(body.id, 120);
  if (!ticketId) {
    sendJson(res, 400, { ok: false, error: { code: 'ADMIN_TICKET_ID_MISSING', message: 'Ticket introuvable.' } });
    return;
  }

  const ticket = adminTools.updateTicket(ticketId, body);
  if (!ticket) {
    sendJson(res, 404, { ok: false, error: { code: 'ADMIN_TICKET_NOT_FOUND', message: 'Ticket introuvable.' } });
    return;
  }

  sendJson(res, 200, { ok: true, ticket, tickets: adminTools.listTickets() });
}

function handleAdminQuotesApi(req, res) {
  const session = requireAuthenticatedAdmin(req, res);
  if (!session) return;
  sendJson(res, 200, { ok: true, quotes: adminTools.listQuotes() });
}

async function handleAdminCreateQuoteApi(req, res) {
  const session = requireAuthenticatedAdmin(req, res);
  if (!session) return;
  let body;
  try {
    body = await parseJsonBody(req, 512 * 1024);
  } catch (_) {
    sendJson(res, 400, { ok: false, error: { code: 'INVALID_JSON', message: 'Requête invalide.' } });
    return;
  }

  if (!sanitizeLine(body.customerName, 140)) {
    sendJson(res, 400, { ok: false, error: { code: 'ADMIN_QUOTE_INVALID', message: 'Le nom client est obligatoire.' } });
    return;
  }

  const quote = adminTools.createQuote(body);
  sendJson(res, 201, { ok: true, quote, quotes: adminTools.listQuotes() });
}

async function handleAdminUpdateQuoteApi(req, res) {
  const session = requireAuthenticatedAdmin(req, res);
  if (!session) return;
  let body;
  try {
    body = await parseJsonBody(req, 512 * 1024);
  } catch (_) {
    sendJson(res, 400, { ok: false, error: { code: 'INVALID_JSON', message: 'Requête invalide.' } });
    return;
  }

  const documentId = sanitizeLine(body.id, 120);
  if (!documentId) {
    sendJson(res, 400, { ok: false, error: { code: 'ADMIN_QUOTE_ID_MISSING', message: 'Devis introuvable.' } });
    return;
  }

  const quote = adminTools.updateQuote(documentId, body);
  if (!quote) {
    sendJson(res, 404, { ok: false, error: { code: 'ADMIN_QUOTE_NOT_FOUND', message: 'Devis introuvable.' } });
    return;
  }

  sendJson(res, 200, { ok: true, quote, quotes: adminTools.listQuotes() });
}

function handleAdminDeleteQuoteApi(req, res, requestUrl) {
  const session = requireAuthenticatedAdmin(req, res);
  if (!session) return;
  const documentId = sanitizeLine(requestUrl.searchParams.get('id'), 120);
  if (!documentId) {
    sendJson(res, 400, { ok: false, error: { code: 'ADMIN_QUOTE_ID_MISSING', message: 'Devis introuvable.' } });
    return;
  }
  const deleted = adminTools.deleteQuote(documentId);
  if (!deleted) {
    sendJson(res, 404, { ok: false, error: { code: 'ADMIN_QUOTE_NOT_FOUND', message: 'Devis introuvable.' } });
    return;
  }
  sendJson(res, 200, { ok: true, quotes: adminTools.listQuotes() });
}


function handleAdminInvoiceClientsApi(req, res) {
  const session = requireAuthenticatedAdmin(req, res);
  if (!session) return;
  sendJson(res, 200, { ok: true, clients: adminTools.listInvoiceClients() });
}

async function handleAdminCreateInvoiceClientApi(req, res) {
  const session = requireAuthenticatedAdmin(req, res);
  if (!session) return;
  let body;
  try {
    body = await parseJsonBody(req, 128 * 1024);
  } catch (_) {
    sendJson(res, 400, { ok: false, error: { code: 'INVALID_JSON', message: 'Requête invalide.' } });
    return;
  }
  if (!sanitizeLine(body.name, 160)) {
    sendJson(res, 400, { ok: false, error: { code: 'INVOICE_CLIENT_INVALID', message: 'Le nom du client est obligatoire.' } });
    return;
  }
  const client = adminTools.createInvoiceClient(body);
  sendJson(res, 201, { ok: true, client, clients: adminTools.listInvoiceClients() });
}

function handleAdminDeleteInvoiceClientApi(req, res, requestUrl) {
  const session = requireAuthenticatedAdmin(req, res);
  if (!session) return;
  const clientId = sanitizeLine(requestUrl.searchParams.get('id'), 120);
  if (!clientId) {
    sendJson(res, 400, { ok: false, error: { code: 'INVOICE_CLIENT_ID_MISSING', message: 'Client introuvable.' } });
    return;
  }
  const deleted = adminTools.deleteInvoiceClient(clientId);
  if (!deleted) {
    sendJson(res, 404, { ok: false, error: { code: 'INVOICE_CLIENT_NOT_FOUND', message: 'Client introuvable.' } });
    return;
  }
  sendJson(res, 200, { ok: true, clients: adminTools.listInvoiceClients() });
}

function handleAdminInvoiceReferencesApi(req, res) {
  const session = requireAuthenticatedAdmin(req, res);
  if (!session) return;
  sendJson(res, 200, { ok: true, references: adminTools.listInvoiceReferences() });
}

async function handleAdminCreateInvoiceReferenceApi(req, res) {
  const session = requireAuthenticatedAdmin(req, res);
  if (!session) return;
  let body;
  try {
    body = await parseJsonBody(req, 128 * 1024);
  } catch (_) {
    sendJson(res, 400, { ok: false, error: { code: 'INVALID_JSON', message: 'Requête invalide.' } });
    return;
  }
  if (!sanitizeLine(body.reference, 80) || !sanitizeLine(body.designation, 260)) {
    sendJson(res, 400, { ok: false, error: { code: 'INVOICE_REFERENCE_INVALID', message: 'La référence et la désignation sont obligatoires.' } });
    return;
  }
  const reference = adminTools.createInvoiceReference(body);
  sendJson(res, 201, { ok: true, reference, references: adminTools.listInvoiceReferences() });
}

function handleAdminDeleteInvoiceReferenceApi(req, res, requestUrl) {
  const session = requireAuthenticatedAdmin(req, res);
  if (!session) return;
  const referenceId = sanitizeLine(requestUrl.searchParams.get('id'), 120);
  if (!referenceId) {
    sendJson(res, 400, { ok: false, error: { code: 'INVOICE_REFERENCE_ID_MISSING', message: 'Référence introuvable.' } });
    return;
  }
  const deleted = adminTools.deleteInvoiceReference(referenceId);
  if (!deleted) {
    sendJson(res, 404, { ok: false, error: { code: 'INVOICE_REFERENCE_NOT_FOUND', message: 'Référence introuvable.' } });
    return;
  }
  sendJson(res, 200, { ok: true, references: adminTools.listInvoiceReferences() });
}

function handleAdminInvoicesApi(req, res) {
  const session = requireAuthenticatedAdmin(req, res);
  if (!session) return;
  sendJson(res, 200, { ok: true, invoices: adminTools.listInvoices() });
}

async function handleAdminCreateInvoiceApi(req, res) {
  const session = requireAuthenticatedAdmin(req, res);
  if (!session) return;
  let body;
  try {
    body = await parseJsonBody(req, 512 * 1024);
  } catch (_) {
    sendJson(res, 400, { ok: false, error: { code: 'INVALID_JSON', message: 'Requête invalide.' } });
    return;
  }

  if (!sanitizeLine(body.customerName, 140)) {
    sendJson(res, 400, { ok: false, error: { code: 'ADMIN_INVOICE_INVALID', message: 'Le nom client est obligatoire.' } });
    return;
  }

  const invoice = adminTools.createInvoice(body);
  sendJson(res, 201, { ok: true, invoice, invoices: adminTools.listInvoices() });
}

async function handleAdminUpdateInvoiceApi(req, res) {
  const session = requireAuthenticatedAdmin(req, res);
  if (!session) return;
  let body;
  try {
    body = await parseJsonBody(req, 512 * 1024);
  } catch (_) {
    sendJson(res, 400, { ok: false, error: { code: 'INVALID_JSON', message: 'Requête invalide.' } });
    return;
  }

  const documentId = sanitizeLine(body.id, 120);
  if (!documentId) {
    sendJson(res, 400, { ok: false, error: { code: 'ADMIN_INVOICE_ID_MISSING', message: 'Facture introuvable.' } });
    return;
  }

  const invoice = adminTools.updateInvoice(documentId, body);
  if (!invoice) {
    sendJson(res, 404, { ok: false, error: { code: 'ADMIN_INVOICE_NOT_FOUND', message: 'Facture introuvable.' } });
    return;
  }

  sendJson(res, 200, { ok: true, invoice, invoices: adminTools.listInvoices() });
}

function handleAdminDeleteInvoiceApi(req, res, requestUrl) {
  const session = requireAuthenticatedAdmin(req, res);
  if (!session) return;
  const documentId = sanitizeLine(requestUrl.searchParams.get('id'), 120);
  if (!documentId) {
    sendJson(res, 400, { ok: false, error: { code: 'ADMIN_INVOICE_ID_MISSING', message: 'Facture introuvable.' } });
    return;
  }
  const deleted = adminTools.deleteInvoice(documentId);
  if (!deleted) {
    sendJson(res, 404, { ok: false, error: { code: 'ADMIN_INVOICE_NOT_FOUND', message: 'Facture introuvable.' } });
    return;
  }
  sendJson(res, 200, { ok: true, invoices: adminTools.listInvoices() });
}
function serveStaticFile(req, res, filePath) {
  fs.readFile(filePath, (error, data) => {
    if (error) {
      if (error.code === "ENOENT") {
        sendText(res, 404, "Not Found");
        return;
      }
      sendText(res, 500, "Internal Server Error");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = CONTENT_TYPES[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": contentType });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  if (!req.url) {
    sendText(res, 400, "Bad Request");
    return;
  }

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Token, X-Admin-Token"
    });
    res.end();
    return;
  }

  const requestUrl = new URL(req.url, `http://${req.headers.host || `localhost:${PORT}`}`);

  if (req.method === "GET" && requestUrl.pathname === "/api/google-reviews") {
    try {
      await handleReviewsApi(res, requestUrl);
    } catch (error) {
      sendJson(res, 500, {
        ok: false,
        error: { code: "INTERNAL_ERROR", message: error && error.message ? error.message : "Erreur serveur." }
      });
    }
    return;
  }

  if (req.method === "POST" && requestUrl.pathname === "/api/contact") {
    try {
      await handleContactApi(req, res);
    } catch (_) {
      sendJson(res, 500, {
        ok: false,
        error: { code: "INTERNAL_ERROR", message: "Erreur serveur." }
      });
    }
    return;
  }


  if (req.method === 'POST' && requestUrl.pathname === '/api/client/register') {
    await handleClientRegisterApi(req, res);
    return;
  }

  if (req.method === 'POST' && requestUrl.pathname === '/api/client/login') {
    await handleClientLoginApi(req, res);
    return;
  }

  if (req.method === 'POST' && requestUrl.pathname === '/api/client/logout') {
    handleClientLogoutApi(req, res);
    return;
  }

  if (req.method === 'POST' && requestUrl.pathname === '/api/client/request-password-reset') {
    await handleClientRequestPasswordResetApi(req, res);
    return;
  }

  if (req.method === 'POST' && requestUrl.pathname === '/api/client/reset-password') {
    await handleClientResetPasswordApi(req, res);
    return;
  }

  if (req.method === 'GET' && requestUrl.pathname === '/api/client/session') {
    handleClientSessionApi(req, res);
    return;
  }

  if (req.method === 'GET' && requestUrl.pathname === '/api/client/dashboard') {
    handleClientDashboardApi(req, res);
    return;
  }

  if (req.method === 'GET' && requestUrl.pathname === '/api/client/orders') {
    handleClientOrdersApi(req, res);
    return;
  }

  if (req.method === 'GET' && requestUrl.pathname === '/api/client/tickets') {
    handleClientTicketsApi(req, res);
    return;
  }

  if (req.method === 'POST' && requestUrl.pathname === '/api/client/tickets') {
    await handleClientCreateTicketApi(req, res);
    return;
  }

  if (req.method === 'PATCH' && requestUrl.pathname === '/api/client/profile') {
    await handleClientProfileApi(req, res);
    return;
  }

  if (req.method === 'POST' && requestUrl.pathname === '/api/admin/login') {
    await handleAdminLoginApi(req, res);
    return;
  }

  if (req.method === 'POST' && requestUrl.pathname === '/api/admin/logout') {
    handleAdminLogoutApi(req, res);
    return;
  }

  if (req.method === 'GET' && requestUrl.pathname === '/api/admin/session') {
    handleAdminSessionApi(req, res);
    return;
  }

  if (req.method === 'GET' && requestUrl.pathname === '/api/admin/dashboard') {
    handleAdminDashboardApi(req, res);
    return;
  }

  if (req.method === 'GET' && requestUrl.pathname === '/api/admin/clients') {
    handleAdminClientsApi(req, res);
    return;
  }

  if (req.method === 'GET' && requestUrl.pathname === '/api/admin/orders') {
    handleAdminOrdersApi(req, res);
    return;
  }

  if (req.method === 'GET' && requestUrl.pathname === '/api/admin/tickets') {
    handleAdminTicketsApi(req, res);
    return;
  }


  if (req.method === 'GET' && requestUrl.pathname === '/api/admin/quotes') {
    handleAdminQuotesApi(req, res);
    return;
  }

  if (req.method === 'POST' && requestUrl.pathname === '/api/admin/quotes') {
    await handleAdminCreateQuoteApi(req, res);
    return;
  }

  if (req.method === 'PATCH' && requestUrl.pathname === '/api/admin/quotes') {
    await handleAdminUpdateQuoteApi(req, res);
    return;
  }

  if (req.method === 'DELETE' && requestUrl.pathname === '/api/admin/quotes') {
    handleAdminDeleteQuoteApi(req, res, requestUrl);
    return;
  }


  if (req.method === 'GET' && requestUrl.pathname === '/api/admin/invoice-clients') {
    handleAdminInvoiceClientsApi(req, res);
    return;
  }

  if (req.method === 'POST' && requestUrl.pathname === '/api/admin/invoice-clients') {
    await handleAdminCreateInvoiceClientApi(req, res);
    return;
  }

  if (req.method === 'DELETE' && requestUrl.pathname === '/api/admin/invoice-clients') {
    handleAdminDeleteInvoiceClientApi(req, res, requestUrl);
    return;
  }

  if (req.method === 'GET' && requestUrl.pathname === '/api/admin/invoice-references') {
    handleAdminInvoiceReferencesApi(req, res);
    return;
  }

  if (req.method === 'POST' && requestUrl.pathname === '/api/admin/invoice-references') {
    await handleAdminCreateInvoiceReferenceApi(req, res);
    return;
  }

  if (req.method === 'DELETE' && requestUrl.pathname === '/api/admin/invoice-references') {
    handleAdminDeleteInvoiceReferenceApi(req, res, requestUrl);
    return;
  }

  if (req.method === 'GET' && requestUrl.pathname === '/api/admin/invoices/next-reference') {
      handleAdminInvoiceNextReferenceApi(req, res, requestUrl);
      return;
    }

    if (req.method === 'POST' && requestUrl.pathname === '/api/admin/invoices/send') {
      await handleAdminSendInvoiceApi(req, res);
      return;
    }

    if (req.method === 'GET' && requestUrl.pathname === '/api/admin/invoices') {
    handleAdminInvoicesApi(req, res);
    return;
  }

  if (req.method === 'POST' && requestUrl.pathname === '/api/admin/invoices') {
    await handleAdminCreateInvoiceApi(req, res);
    return;
  }

  if (req.method === 'PATCH' && requestUrl.pathname === '/api/admin/invoices') {
    await handleAdminUpdateInvoiceApi(req, res);
    return;
  }

  if (req.method === 'DELETE' && requestUrl.pathname === '/api/admin/invoices') {
    handleAdminDeleteInvoiceApi(req, res, requestUrl);
    return;
  }
  if (req.method === 'GET' && requestUrl.pathname === '/api/admin/products') {
    handleAdminProductsApi(req, res);
    return;
  }

  if (req.method === 'POST' && requestUrl.pathname === '/api/admin/products') {
    await handleAdminCreateProductApi(req, res);
    return;
  }

  if (req.method === 'PATCH' && requestUrl.pathname === '/api/admin/products') {
    await handleAdminUpdateProductApi(req, res);
    return;
  }

  if (req.method === 'DELETE' && requestUrl.pathname === '/api/admin/products') {
    handleAdminDeleteProductApi(req, res, requestUrl);
    return;
  }

  if (req.method === 'PATCH' && requestUrl.pathname === '/api/admin/orders') {
    await handleAdminUpdateOrderApi(req, res);
    return;
  }

  if (req.method === 'PATCH' && requestUrl.pathname === '/api/admin/tickets') {
    await handleAdminUpdateTicketApi(req, res);
    return;
  }

  if (req.method === 'GET' && requestUrl.pathname === '/api/catalogue-extra-products') {
    handleCatalogueExtraProductsApi(req, res);
    return;
  }
  if (req.method === "GET" && requestUrl.pathname === "/api/store-config") {
    sendJson(res, 200, getStripeConfig());
    return;
  }

  if (req.method === "POST" && requestUrl.pathname === "/api/create-checkout-session") {
    await handleCheckoutSessionApi(req, res);
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    sendText(res, 405, "Method Not Allowed");
    return;
  }

  const rawPath = requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
  const safePath = sanitizePathname(rawPath);
  const absolutePath = path.resolve(ROOT, `.${safePath.startsWith(path.sep) ? safePath : `/${safePath}`}`);

  if (!absolutePath.startsWith(ROOT)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  serveStaticFile(req, res, absolutePath);
});

server.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});


















