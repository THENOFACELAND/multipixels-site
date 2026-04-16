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

try {
  PDFDocument = require("pdfkit");
} catch (_) {
  PDFDocument = null;
}

const ROOT = __dirname;
const DATA_DIR = (process.env.MULTIPIXELS_DATA_DIR || process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(ROOT, 'assets', 'data'));
const ASSET_DATA_DIR = path.join(ROOT, 'assets', 'data');

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

function readJsonFileSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

function writeJsonFileSafe(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2) + "\n", "utf8");
}

function seedFileIfMissing(filename) {
  const targetPath = path.join(DATA_DIR, filename);
  const sourcePath = path.join(ASSET_DATA_DIR, filename);
  if (fs.existsSync(targetPath) || !fs.existsSync(sourcePath)) return;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
}

function seedDocumentsStore() {
  const targetPath = path.join(DATA_DIR, 'admin-documents.json');
  const sourcePath = path.join(ASSET_DATA_DIR, 'admin-documents.json');
  if (!fs.existsSync(sourcePath)) return;
  if (!fs.existsSync(targetPath)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.copyFileSync(sourcePath, targetPath);
    return;
  }
  const target = readJsonFileSafe(targetPath) || {};
  const source = readJsonFileSafe(sourcePath) || {};
  const targetClients = Array.isArray(target.invoiceClients) ? target.invoiceClients : [];
  const targetRefs = Array.isArray(target.invoiceReferences) ? target.invoiceReferences : [];
  const sourceClients = Array.isArray(source.invoiceClients) ? source.invoiceClients : [];
  const sourceRefs = Array.isArray(source.invoiceReferences) ? source.invoiceReferences : [];
  let changed = false;

  if (!targetClients.length && sourceClients.length) {
    target.invoiceClients = sourceClients;
    changed = true;
  }

  if (!targetRefs.length && sourceRefs.length) {
    target.invoiceReferences = sourceRefs;
    changed = true;
  }

  if (changed) {
    writeJsonFileSafe(targetPath, target);
  }
}

function seedPersistentData() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    seedFileIfMissing('admin-products.json');
    seedFileIfMissing('client-space.sqlite');
    seedDocumentsStore();
  } catch (error) {
    const message = error && error.message ? error.message : String(error || 'unknown');
    console.warn('[data-seed] failed: ' + message);
  }
}

seedPersistentData();

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const API_KEY = (process.env.GOOGLE_MAPS_API_KEY || "").trim();
const DEFAULT_PLACE_ID = (process.env.GOOGLE_PLACE_ID || "").trim();
const DEFAULT_QUERY = (process.env.GOOGLE_PLACE_QUERY || "MULTIPIXELS, 190 Chemin Blanc, 62180 Rang-du-Fliers").trim();
const GOOGLE_REVIEWS_OUTPUT_PATH = path.join(DATA_DIR, 'google-reviews.json');
const GOOGLE_REVIEWS_REFRESH_MINUTES = Math.max(15, Number(process.env.GOOGLE_REVIEWS_REFRESH_MINUTES || 240) || 240);
const GOOGLE_REVIEWS_REFRESH_MS = GOOGLE_REVIEWS_REFRESH_MINUTES * 60 * 1000;
const CONTACT_TO = (process.env.CONTACT_TO || "contact@multipixels.fr").trim();
const SMTP_HOST = (process.env.SMTP_HOST || "").trim();
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_SECURE = String(process.env.SMTP_SECURE || "").trim().toLowerCase() === "true" || SMTP_PORT === 465;
const SMTP_USER = (process.env.SMTP_USER || "").trim();
const SMTP_PASS = (process.env.SMTP_PASS || "").trim();
const DEFAULT_CONTACT_EMAIL = 'contact@multipixels.fr';
const CONTACT_FROM = (process.env.CONTACT_FROM || DEFAULT_CONTACT_EMAIL).trim() || DEFAULT_CONTACT_EMAIL;
const INVOICE_COPY_TO = (process.env.INVOICE_COPY_TO || CONTACT_FROM || DEFAULT_CONTACT_EMAIL).trim();
const MAIL_FROM_NAME = (process.env.MAIL_FROM_NAME || 'MULTIPIXELS').trim() || 'MULTIPIXELS';
const DEFAULT_RESEND_FROM_EMAIL = 'contact@mail.multipixels.fr';
const RESEND_FROM_EMAIL = (process.env.RESEND_FROM_EMAIL || DEFAULT_RESEND_FROM_EMAIL).trim() || DEFAULT_RESEND_FROM_EMAIL;
const RESEND_API_KEY = (process.env.RESEND_API_KEY || '').trim();
const BREVO_API_KEY = (process.env.BREVO_API_KEY || process.env.SENDINBLUE_API_KEY || '').trim();
const ADMIN_DOCUMENTS_PATH = path.join(DATA_DIR, 'admin-documents.json');
const INVOICE_SEQUENCE_START = Math.max(36, Number(process.env.INVOICE_SEQUENCE_START || 36) || 36);
const QUOTE_SEQUENCE_START = Math.max(187, Number(process.env.QUOTE_SEQUENCE_START || 187) || 187);

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
let googleReviewsRefreshInFlight = null;

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
  const repaired = String(value || "");
  if (!repaired) return "";
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
        message: "Configuration SMTP incomplÃƒÆ’Ã‚Â¨te sur le serveur."
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
      error: { code: "INVALID_JSON", message: "Format de requÃƒÆ’Ã‚Âªte invalide." }
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
    sendJson(res, 200, { ok: true, message: "Message envoyÃƒÆ’Ã‚Â© avec succÃƒÆ’Ã‚Â¨s." });
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
        error: { code: "INVALID_ATTACHMENT", message: "PiÃƒÆ’Ã‚Â¨ce jointe invalide." }
      });
      return;
    }

    const maxAttachmentBytes = 8 * 1024 * 1024;
    const estimatedBytes = Math.floor((rawBase64.length * 3) / 4);
    const attachmentBytes = size > 0 ? size : estimatedBytes;
    if (attachmentBytes > maxAttachmentBytes) {
      sendJson(res, 413, {
        ok: false,
        error: { code: "ATTACHMENT_TOO_LARGE", message: "Le fichier joint dÃƒÆ’Ã‚Â©passe la limite de 8 Mo." }
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
      error: { code: "VALIDATION_ERROR", message: "Nom, email, tÃƒÆ’Ã‚Â©lÃƒÆ’Ã‚Â©phone et message sont obligatoires." }
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
    `TÃƒÆ’Ã‚Â©lÃƒÆ’Ã‚Â©phone: ${tel || "-"}`,
    `Service: ${service || "-"}`,
    `QuantitÃƒÆ’Ã‚Â© estimÃƒÆ’Ã‚Â©e: ${quantite || "-"}`,
    `PiÃƒÆ’Ã‚Â¨ce jointe: ${attachment ? attachment.filename : "-"}`,
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

  sendJson(res, 200, { ok: true, message: "Message envoyÃƒÆ’Ã‚Â© avec succÃƒÆ’Ã‚Â¨s." });
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
          reject(new Error("RÃƒÆ’Ã‚Â©ponse Google invalide (JSON non parseable)."));
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
  const reviews = Array.isArray(result.reviews) ? result.reviews.slice(0, 4) : [];

  return {
    ok: true,
    placeId: result.place_id || placeId,
    name: repairText(result.name || "ÃƒÆ’Ã¢â‚¬Â°tablissement Google"),
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

async function resolveGooglePlaceId(preferredPlaceId, preferredQuery) {
  let selectedPlaceId = String(preferredPlaceId || "").trim() || DEFAULT_PLACE_ID;
  if (selectedPlaceId) return selectedPlaceId;

  const candidates = [String(preferredQuery || "").trim() || DEFAULT_QUERY, "MULTIPIXELS Rang-du-Fliers", "MULTIPIXELS"];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const placeId = await findPlaceIdByQuery(candidate);
    if (placeId) return placeId;
  }

  return "";
}

async function fetchGoogleReviewsPayload(options) {
  const preferredPlaceId = options && options.placeId ? options.placeId : "";
  const preferredQuery = options && options.query ? options.query : "";

  const placeId = await resolveGooglePlaceId(preferredPlaceId, preferredQuery);
  if (!placeId) {
    throw new Error('PLACE_NOT_FOUND');
  }

  const place = await getPlaceDetails(placeId);
  if (!place.ok) {
    const status = place.googleStatus || "UNKNOWN_ERROR";
    throw new Error('GOOGLE_PLACE_DETAILS_FAILED:' + status);
  }

  return {
    ok: true,
    source: "google_places_api",
    generatedAt: new Date().toISOString(),
    placeId: place.placeId,
    name: place.name,
    rating: place.rating,
    ratingCount: place.ratingCount,
    url: place.url,
    reviews: place.reviews
  };
}

function persistGoogleReviewsPayload(payload) {
  fs.mkdirSync(path.dirname(GOOGLE_REVIEWS_OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(GOOGLE_REVIEWS_OUTPUT_PATH, JSON.stringify(payload, null, 2) + "\n", "utf8");
}

async function refreshGoogleReviewsCache(reason) {
  if (!API_KEY) return false;
  if (googleReviewsRefreshInFlight) return googleReviewsRefreshInFlight;

  const refreshReason = String(reason || "scheduled");
  googleReviewsRefreshInFlight = (async () => {
    try {
      const payload = await fetchGoogleReviewsPayload({});
      persistGoogleReviewsPayload(payload);
      console.log('[google-reviews] updated (' + refreshReason + ')');
      return true;
    } catch (error) {
      const message = error && error.message ? error.message : String(error || 'unknown_error');
      console.error('[google-reviews] refresh failed (' + refreshReason + '): ' + message);
      return false;
    } finally {
      googleReviewsRefreshInFlight = null;
    }
  })();

  return googleReviewsRefreshInFlight;
}

function startGoogleReviewsAutoRefresh() {
  if (!API_KEY) {
    console.warn('[google-reviews] GOOGLE_MAPS_API_KEY missing, auto refresh disabled.');
    return;
  }

  refreshGoogleReviewsCache('startup');

  const timer = setInterval(() => {
    refreshGoogleReviewsCache('interval');
  }, GOOGLE_REVIEWS_REFRESH_MS);

  if (typeof timer.unref === 'function') {
    timer.unref();
  }

  console.log('[google-reviews] auto refresh every ' + GOOGLE_REVIEWS_REFRESH_MINUTES + ' min');
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

  try {
    const payload = await fetchGoogleReviewsPayload({
      placeId: placeIdFromQuery,
      query: queryFromQuery
    });

    if (!placeIdFromQuery && !queryFromQuery) {
      persistGoogleReviewsPayload(payload);
    }

    sendJson(res, 200, payload);
  } catch (error) {
    const message = error && error.message ? error.message : "";

    if (message === "PLACE_NOT_FOUND") {
      sendJson(res, 404, {
        ok: false,
        error: { code: "PLACE_NOT_FOUND", message: "Impossible de trouver la fiche Google ÃƒÆ’Ã‚Â  partir des requÃƒÆ’Ã‚Âªtes configurÃƒÆ’Ã‚Â©es." }
      });
      return;
    }

    if (message.startsWith("GOOGLE_PLACE_DETAILS_FAILED:")) {
      const googleStatus = message.split(":")[1] || "UNKNOWN_ERROR";
      sendJson(res, 502, {
        ok: false,
        error: {
          code: "GOOGLE_PLACE_DETAILS_FAILED",
          message: "Google n'a pas retournÃƒÆ’Ã‚Â© les dÃƒÆ’Ã‚Â©tails de la fiche.",
          googleStatus
        }
      });
      return;
    }

    sendJson(res, 500, {
      ok: false,
      error: {
        code: "GOOGLE_REVIEWS_INTERNAL_ERROR",
        message: "Impossible de rÃƒÆ’Ã‚Â©cupÃƒÆ’Ã‚Â©rer les avis Google pour le moment."
      }
    });
  }
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
      error: { code: "INVALID_JSON", message: "Corps de requÃƒÆ’Ã‚Âªte invalide." }
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
        message: "Stripe n'est pas encore configurÃƒÆ’Ã‚Â© sur le serveur. Le tunnel est prÃƒÆ’Ã‚Âªt mais les clÃƒÆ’Ã‚Â©s d'environnement doivent ÃƒÆ’Ã‚Âªtre ajoutÃƒÆ’Ã‚Â©es."
      }
    });
    return;
  }

  if (!Stripe) {
    sendJson(res, 501, {
      ok: false,
      error: {
        code: "STRIPE_PACKAGE_MISSING",
        message: "Le package Stripe n'est pas installÃƒÆ’Ã‚Â© cÃƒÆ’Ã‚Â´tÃƒÆ’Ã‚Â© serveur. Ajoutez la dÃƒÆ’Ã‚Â©pendance avant d'activer le checkout."
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
      clientNote: 'Session Stripe lanc?e depuis votre espace client.'
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
        message: error && error.message ? error.message : "Impossible de crÃƒÆ’Ã‚Â©er la session Stripe."
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
            clientNote: 'Validation BAT re?ue, lancement atelier confirm?.',
            items: [
              { name: 'Sweat capuche femme', quantity: 8, technique: 'DTF', color: 'Rose poudre' },
              { name: 'Tote bag cadeau', quantity: 8, technique: 'Flocage', color: 'Naturel' }
            ],
            timeline: [
              { label: 'Commande enregistr?e', date: '21 mars 2026', done: true },
              { label: 'Visuels v?rifi?s', date: '22 mars 2026', done: true },
              { label: 'Production atelier', date: '29 mars 2026', done: true },
              { label: 'Exp?dition', date: '04 avril 2026', done: false }
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
              { label: 'Demande re?ue', date: '29 mars 2026', done: true },
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
            messagePreview: 'Pouvez-vous envoyer la facture au format PDF pour notre comptabilitÃƒÆ’Ã‚Â© ?',
            lastReply: 'Ticket reÃƒÆ’Ã‚Â§u, un retour est prÃƒÆ’Ã‚Â©vu sous 24h.'
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
    fs.writeFileSync(ADMIN_DOCUMENTS_PATH, JSON.stringify({ quotes: [], invoices: [], invoiceClients: [], invoiceReferences: [] }, null, 2), 'utf8');
  }
}

function readAdminDocumentsStore() {
  ensureAdminDocumentsStore();
  try {
    const raw = fs.readFileSync(ADMIN_DOCUMENTS_PATH, 'utf8').replace(/^\uFEFF/, '');
    const parsed = JSON.parse(raw);
    return {
      quotes: Array.isArray(parsed.quotes) ? parsed.quotes : [],
      invoices: Array.isArray(parsed.invoices) ? parsed.invoices : [],
      invoiceClients: Array.isArray(parsed.invoiceClients) ? parsed.invoiceClients : [],
      invoiceReferences: Array.isArray(parsed.invoiceReferences) ? parsed.invoiceReferences : []
    };
  } catch (_) {
    return { quotes: [], invoices: [], invoiceClients: [], invoiceReferences: [] };
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
  if (currentReference) {
    const currentMatch = String(currentReference).match(/^(\d+)-(\d{6})$/);
    if (currentMatch && currentMatch[2] === dayCode) {
      const currentSeq = Number(currentMatch[1] || 0);
      if (currentSeq > maxSequence) maxSequence = currentSeq;
    }
  }
  return String(maxSequence + 1) + '-' + dayCode;
}

function addDaysToIsoDate(issueDate, days) {
  const base = new Date((cleanInvoiceField(issueDate, 20) || new Date().toISOString().slice(0, 10)) + 'T00:00:00');
  if (Number.isNaN(base.getTime())) return new Date().toISOString().slice(0, 10);
  base.setDate(base.getDate() + Math.max(0, Number(days || 0)));
  return base.toISOString().slice(0, 10);
}

function normalizeInvoiceItems(items) {
  const cleaned = (Array.isArray(items) ? items : []).map((item) => {
    const quantity = Math.max(1, Number(item && item.quantity || 1));
    const unitPrice = Number(item && item.unitPrice || 0);
    const reference = cleanInvoiceField(item && item.reference, 80);
    const description = cleanInvoiceField(item && item.description, 240);
    const key = (reference + ' ' + description).toUpperCase();
    const discountRate = (key.includes('REM10') || key.includes('-10%') || key.includes('REMISE 10'))
      ? 0.10
      : ((key.includes('REM5') || key.includes('-5%') || key.includes('REMISE 5')) ? 0.05 : 0);

    return {
      reference,
      description,
      quantity: Number.isFinite(quantity) ? quantity : 1,
      unitPrice: Number.isFinite(unitPrice) ? unitPrice : 0,
      discountRate
    };
  }).filter((item) => item.reference || item.description);

  const baseSubtotal = Number(cleaned.reduce((sum, item) => {
    if (item.discountRate > 0) return sum;
    return sum + (item.quantity * item.unitPrice);
  }, 0).toFixed(2));

  return cleaned.map((item) => {
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
    return {
      reference: item.reference,
      description: item.description,
      quantity: item.quantity,
      unitPrice,
      total: Number((item.quantity * unitPrice).toFixed(2))
    };
  });
}

function buildInvoiceRecord(existingInvoice, payload, forcedReference) {
  const items = normalizeInvoiceItems(payload.items);
  const issueDate = cleanInvoiceField(payload.issueDate, 20) || new Date().toISOString().slice(0, 10);
  const paymentDueDays = Math.max(0, Number(payload.paymentDueDays || 0));
  const dueDate = addDaysToIsoDate(issueDate, paymentDueDays);
  const vatRate = Math.max(0, Number(payload.vatRate || 0));
  const total = Number(items.reduce((sum, item) => sum + item.total, 0).toFixed(2));
  const now = new Date().toISOString();
  const emailSubject = cleanInvoiceField(payload.emailSubject, 220) || ('Votre facture - Multipixels.fr, nÃƒâ€šÃ‚Â° ' + forcedReference);
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
    + '<div style="margin-top:18px;line-height:1.6;font-size:14px;">190 Chemin Blanc<br/>62180 Rang du Fliers<br/>06 27 14 08 40 | contact@multipixels.fr<br/>NÃƒâ€šÃ‚Â° SIRET : 80 49 81 835 0000 23<br/>Code APE: 18.12Z</div>'
    + '</td><td style="width:290px;vertical-align:top;">'
    + '<div style="border:1px solid #435774;"><div style="padding:8px 12px;background:#bfdbe9;font-weight:700;text-transform:uppercase;text-align:center;">Adresse de facturation</div><div style="padding:16px 18px;text-align:center;line-height:1.6;">' + (addressLines.length ? addressLines.map(escapeInvoiceHtml).join('<br/>') : 'Informations client ÃƒÆ’Ã‚Â  complÃƒÆ’Ã‚Â©ter') + '</div></div>'
    + '</td></tr></table>'
    + '<table style="width:100%;margin-top:26px;border-collapse:collapse;">'
    + '<tr><th colspan="2" style="text-align:left;background:#bfdbe9;border:1px solid #435774;padding:10px 12px;">FACTURE NÃƒâ€šÃ‚Â° ' + escapeInvoiceHtml(invoice.reference) + '</th></tr>'
    + '<tr><td style="border:1px solid #c6d6e7;padding:8px 12px;">Date de facturation</td><td style="border:1px solid #c6d6e7;padding:8px 12px;font-weight:700;">' + escapeInvoiceHtml(formatInvoiceDateFr(invoice.issueDate)) + '</td></tr>'
    + '<tr><td colspan="2" style="border:1px solid #c6d6e7;padding:8px 12px;">Paiement ÃƒÆ’Ã‚Â  ' + invoice.paymentDueDays + ' jours ÃƒÆ’Ã‚Â  rÃƒÆ’Ã‚Â©ception de la facture</td></tr>'
    + '</table>'
    + '<table style="width:100%;margin-top:18px;border-collapse:collapse;">'
    + '<thead><tr><th style="padding:8px;border:1px solid #8ea8bd;background:#d7e8f3;text-align:left;">RÃƒÆ’Ã‚Â©fÃƒÆ’Ã‚Â©rence</th><th style="padding:8px;border:1px solid #8ea8bd;background:#d7e8f3;text-align:left;">Description</th><th style="padding:8px;border:1px solid #8ea8bd;background:#d7e8f3;text-align:center;">QtÃƒÆ’Ã‚Â©</th><th style="padding:8px;border:1px solid #8ea8bd;background:#d7e8f3;text-align:right;">Prix unitaire</th><th style="padding:8px;border:1px solid #8ea8bd;background:#d7e8f3;text-align:right;">Total TTC</th></tr></thead>'
    + '<tbody>' + rows + '</tbody></table>'
    + '<table style="width:100%;margin-top:24px;border-collapse:collapse;">'
    + '<tr><td style="vertical-align:top;padding-right:12px;">'
    + '<div style="border:1px solid #435774;"><div style="padding:8px 12px;background:#bfdbe9;text-align:center;">Conditions de paiement</div><div style="padding:16px 18px;line-height:1.7;text-align:center;">MÃƒÆ’Ã‚Â©thodes de paiement acceptÃƒÆ’Ã‚Â©es :<br/><strong>ChÃƒÆ’Ã‚Â¨que, Virement, EspÃƒÆ’Ã‚Â¨ce, CB</strong><br/><br/>VIREMENT BANCAIRE<br/>Banque : CA Nord de France<br/>IBAN : FR76 1670 6000 5154 0091 5025 361<br/>BIC : AGRIFRPP867<br/>Titulaire du compte : BAUDELOT Guillaume<br/><br/>En cas de retard de paiement, une indemnite forfaitaire de 40 EUR pourra etre appliquee'
    + '</td><td style="width:220px;vertical-align:top;">'
    + '<div style="border:1px solid #435774;"><div style="padding:8px 12px;background:#bfdbe9;text-align:center;font-weight:700;">TOTAL TTC</div><div style="padding:16px 18px;text-align:center;"><div style="font-size:28px;font-weight:800;">' + escapeInvoiceHtml(formatInvoiceMoney(invoice.total)) + '</div><div style="margin-top:10px;font-size:13px;">' + escapeInvoiceHtml(invoice.vatRate > 0 ? ('TVA ' + invoice.vatRate + ' % appliquÃƒÆ’Ã‚Â©e') : invoice.vatMention) + '</div></div></div>'
    + '</td></tr></table>'
    + '<div style="margin-top:24px;text-align:center;color:#3867b3;font-weight:700;">www.multipixels.fr</div></div></div>';
}

function buildInvoiceEmailText(invoice) {
  return [
    'Bonjour,',
    '',
    'Veuillez trouver en piÃƒÆ’Ã‚Â¨ce jointe votre facture ' + invoice.reference + '.',
    'Date : ' + formatInvoiceDateFr(invoice.issueDate),
    'Total TTC : ' + formatInvoiceMoney(invoice.total),
    '',
    'Pour toute question, vous pouvez rÃƒÆ’Ã‚Â©pondre ÃƒÆ’Ã‚Â  cet email ou nous contacter ÃƒÆ’Ã‚Â  contact@multipixels.fr.',
    '',
    'Cordialement,',
    'MULTIPIXELS.FR'
  ].join('\n');
}

function buildInvoiceAttachmentName(invoice) {
  const safeReference = String(invoice && invoice.reference || 'facture').replace(/[^a-zA-Z0-9_-]+/g, '-');
  return 'facture-' + safeReference + '.pdf';
}

function buildInvoiceEmailHtml(invoice) {
  const intro = invoice.emailMessage
    ? invoice.emailMessage.split(/\r?\n/).map((line) => '<div>' + escapeInvoiceHtml(line) + '</div>').join('')
    : '<div>Bonjour,</div><div style="margin-top:12px;">Veuillez trouver votre facture en piÃƒÆ’Ã‚Â¨ce jointe.</div>';
  return '<div style="font-family:Arial,sans-serif;color:#10213b;background:#eef5fd;padding:24px;">'
    + '<div style="max-width:760px;margin:0 auto;background:#ffffff;border:1px solid #d8e4f2;padding:28px;border-radius:12px;">'
    + '<div style="font-size:28px;font-weight:800;color:#0f2350;">MULTIPIXELS.FR</div>'
    + '<div style="color:#587094;font-style:italic;margin-top:4px;">votre expert textile</div>'
    + '<div style="margin-top:18px;line-height:1.7;font-size:15px;">' + intro + '</div>'
    + '<div style="margin-top:22px;padding:16px 18px;border:1px solid #d7e8f3;background:#f7fbff;border-radius:10px;">'
    + '<div><strong>RÃƒÆ’Ã‚Â©fÃƒÆ’Ã‚Â©rence :</strong> ' + escapeInvoiceHtml(invoice.reference) + '</div>'
    + '<div style="margin-top:6px;"><strong>Date :</strong> ' + escapeInvoiceHtml(formatInvoiceDateFr(invoice.issueDate)) + '</div>'
    + '<div style="margin-top:6px;"><strong>Total TTC :</strong> ' + escapeInvoiceHtml(formatInvoiceMoney(invoice.total)) + '</div>'
    + '</div>'
    + '<div style="margin-top:22px;font-size:14px;line-height:1.6;color:#4b607d;">Pour toute question, merci de ne pas rÃƒÆ’Ã‚Â©pondre directement ÃƒÆ’Ã‚Â  cet email et de nous contacter ÃƒÆ’Ã‚Â  <a href="mailto:contact@multipixels.fr" style="color:#1c56b3;">contact@multipixels.fr</a> ou au 06 27 14 08 40.</div>'
    + '</div>'
    + '</div>';
}

async function buildInvoicePdfBuffer(invoice) {
  if (!PDFDocument) {
    throw new Error('Le module PDF n\'est pas disponible sur le serveur.');
  }

  return await new Promise(function (resolve, reject) {
    const doc = new PDFDocument({ size: 'A4', margin: 36 });
    const chunks = [];
    const lineItems = Array.isArray(invoice.items) ? invoice.items : [];
    const logoPath = path.join(ROOT, 'assets', 'Background', 'favicon.png');
    const addressLines = [invoice.customerName, invoice.company, invoice.email, invoice.addressLine1, invoice.addressLine2, [invoice.postalCode, invoice.city].filter(Boolean).join(' '), invoice.country].filter(Boolean);

    doc.on('data', function (chunk) { chunks.push(chunk); });
    doc.on('end', function () { resolve(Buffer.concat(chunks)); });
    doc.on('error', reject);

    doc.rect(36, 36, 523, 770).fill('#ffffff');
    doc.fillColor('#10213b');

    if (fs.existsSync(logoPath)) {
      try {
        doc.image(logoPath, 54, 54, { fit: [72, 72], align: 'center', valign: 'center' });
      } catch (_) {}
    }

    doc.font('Helvetica-Bold').fontSize(22).fillColor('#0f2350').text('MULTIPIXELS.FR', 54, 136);
    doc.font('Helvetica-Oblique').fontSize(10).fillColor('#607796').text('votre expert textile', 54, 163);
    doc.font('Helvetica').fontSize(9).fillColor('#10213b').text('190 Chemin Blanc\\n62180 Rang du Fliers\\n06 27 14 08 40 | contact@multipixels.fr\\nN SIRET : 80 49 81 835 0000 23\\nCode APE: 18.12Z', 54, 195, { lineGap: 2 });

    const addressText = addressLines.length ? addressLines.join('\\n') : 'Informations client a completer';
    doc.font('Helvetica').fontSize(9);
    const addressBodyHeight = Math.max(62, doc.heightOfString(addressText, { width: 136, align: 'center', lineGap: 2 }) + 14);
    const addressBoxHeight = 22 + addressBodyHeight;
    doc.lineWidth(1).strokeColor('#435774').rect(360, 54, 165, addressBoxHeight).stroke();
    doc.rect(360, 54, 165, 22).fillAndStroke('#bfdbe9', '#435774');
    doc.fillColor('#10213b').font('Helvetica-Bold').fontSize(10).text('ADRESSE DE FACTURATION', 368, 61, { width: 149, align: 'center' });
    doc.font('Helvetica').fontSize(9).fillColor('#10213b').text(addressText, 374, 87, { width: 136, align: 'center', lineGap: 2 });

    doc.lineWidth(1).strokeColor('#435774').rect(54, 270, 471, 54).stroke();
    doc.rect(54, 270, 471, 18).fillAndStroke('#bfdbe9', '#435774');
    doc.fillColor('#10213b').font('Helvetica-Bold').fontSize(10).text('FACTURE No ' + invoice.reference, 62, 276);
    doc.font('Helvetica').fontSize(9);
    doc.rect(54, 288, 471, 18).stroke('#8ca6ba');
    doc.text('Date de facturation', 62, 294);
    doc.font('Helvetica-Bold').text(formatInvoiceDateFr(invoice.issueDate), 420, 294, { width: 90, align: 'right' });
    doc.font('Helvetica');
    doc.rect(54, 306, 471, 18).stroke('#8ca6ba');
    doc.text('Paiement a ' + invoice.paymentDueDays + ' jours a reception de la facture', 62, 312);

    const tableY = 340;
    const colX = [54, 130, 304, 348, 438];
    const colW = [76, 174, 44, 90, 87];
    const headers = ['Reference', 'Description', 'Qte', 'Prix unitaire', 'Total TTC'];
    headers.forEach(function (header, index) {
      doc.rect(colX[index], tableY, colW[index], 18).fillAndStroke('#d7e8f3', '#8ca6ba');
      doc.fillColor('#10213b').font('Helvetica-Bold').fontSize(8.5).text(header, colX[index] + 4, tableY + 5, { width: colW[index] - 8, align: index >= 2 ? 'center' : 'left' });
    });

    let currentY = tableY + 18;
    const rows = lineItems.length ? lineItems : [{ reference: '-', description: 'Aucune ligne pour le moment', quantity: 0, unitPrice: 0, total: 0 }];
    rows.forEach(function (item) {
      const values = [String(item.reference || '-'), String(item.description || '-'), String(item.quantity || 0), formatInvoiceMoney(item.unitPrice || 0), formatInvoiceMoney(item.total || 0)];
      const textHeights = values.map(function (value, index) {
        doc.font('Helvetica').fontSize(8.5);
        return doc.heightOfString(value, { width: colW[index] - 8, align: index >= 2 ? 'center' : 'left', lineGap: 1 });
      });
      const rowHeight = Math.max(22, Math.ceil(Math.max.apply(Math, textHeights)) + 10);
      values.forEach(function (value, index) {
        doc.rect(colX[index], currentY, colW[index], rowHeight).stroke('#c6d6e7');
        doc.font('Helvetica').fontSize(8.5).fillColor('#10213b').text(value, colX[index] + 4, currentY + 5, { width: colW[index] - 8, align: index >= 2 ? 'center' : 'left', lineGap: 1 });
      });
      currentY += rowHeight;
    });

    const bottomY = Math.max(560, currentY + 56);
    doc.rect(54, bottomY, 330, 150).stroke('#435774');
    doc.rect(54, bottomY, 330, 20).fillAndStroke('#bfdbe9', '#435774');
    doc.fillColor('#10213b').font('Helvetica-Bold').fontSize(10).text('Conditions de paiement', 54, bottomY + 6, { width: 330, align: 'center' });
    doc.font('Helvetica').fontSize(8.8).text('Methodes de paiement acceptees :\\n\\nCheque, Virement, Espece, CB\\n\\nVIREMENT BANCAIRE\\nBanque : CA Nord de France\\nIBAN : FR76 1670 6000 5154 0091 5025 361\\nBIC : AGRIFRPP867\\nTitulaire du compte : BAUDELOT Guillaume\\n\\nEn cas de retard de paiement, une indemnite forfaitaire de 40 EUR pourra etre appliquee', 72, bottomY + 34, { width: 294, align: 'center', lineGap: 2 });

    doc.rect(404, bottomY, 121, 76).stroke('#435774');
    doc.rect(404, bottomY, 121, 20).fillAndStroke('#bfdbe9', '#435774');
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#10213b').text('TOTAL TTC', 404, bottomY + 6, { width: 121, align: 'center' });
    doc.font('Helvetica-Bold').fontSize(18).text(formatInvoiceMoney(invoice.total), 404, bottomY + 34, { width: 121, align: 'center' });
    doc.font('Helvetica').fontSize(7.8).text(invoice.vatRate > 0 ? ('TVA ' + invoice.vatRate + ' % appliquee') : invoice.vatMention, 414, bottomY + 58, { width: 101, align: 'center' });

    const footerY = Math.min(744, bottomY + 184);
    doc.moveTo(54, footerY).lineTo(525, footerY).stroke('#c2d4e8');
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#3867b3').text('www.multipixels.fr', 54, footerY + 8, { width: 471, align: 'center' });
    doc.end();
  });
}

function handleAdminInvoiceNextReferenceApi(req, res, requestUrl) {
  const session = requireAuthenticatedAdmin(req, res);
  if (!session) return;
  const issueDate = cleanInvoiceField(requestUrl.searchParams.get('issueDate'), 20) || new Date().toISOString().slice(0, 10);
  const documentId = cleanInvoiceField(requestUrl.searchParams.get('id'), 120);
  const currentReference = cleanInvoiceField(requestUrl.searchParams.get('current'), 80);
  sendJson(res, 200, { ok: true, reference: getNextInvoiceReference(issueDate, documentId) });
}

async function handleAdminInvoicePdfApi(req, res) {
  const session = requireAuthenticatedAdmin(req, res);
  if (!session) return;

  let body;
  try {
    body = await parseJsonBody(req, 1024 * 1024);
  } catch (_) {
    sendJson(res, 400, { ok: false, error: { code: 'INVALID_JSON', message: 'Requ?te invalide.' } });
    return;
  }

  const items = normalizeInvoiceItems(body.items);
  const customerName = cleanInvoiceField(body.customerName, 140);
  const email = cleanInvoiceField(body.email, 180).toLowerCase();
  if (!customerName || !items.length) {
    sendJson(res, 400, { ok: false, error: { code: 'ADMIN_INVOICE_INVALID', message: 'Nom client et au moins une ligne sont obligatoires.' } });
    return;
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    sendJson(res, 400, { ok: false, error: { code: 'ADMIN_INVOICE_EMAIL_INVALID', message: 'L?adresse email client est invalide.' } });
    return;
  }

  const store = readAdminDocumentsStore();
  const existingInvoice = (store.invoices || []).find((entry) => String(entry.id) === String(cleanInvoiceField(body.id, 120))) || null;
  const officialReference = existingInvoice && existingInvoice.sentAt ? existingInvoice.reference : getNextInvoiceReference(body.issueDate, existingInvoice && existingInvoice.id);
  const invoice = buildInvoiceRecord(existingInvoice, Object.assign({}, body, { items: items, email: email, customerName: customerName }), officialReference);

  let pdfBuffer;
  try {
    pdfBuffer = await buildInvoicePdfBuffer(invoice);
  } catch (_) {
    sendJson(res, 500, { ok: false, error: { code: 'ADMIN_INVOICE_PDF_FAILED', message: 'Impossible de g?n?rer le PDF pour le moment.' } });
    return;
  }

  const filename = buildInvoiceAttachmentName(invoice);
  res.writeHead(200, {
    'Content-Type': 'application/pdf',
    'Content-Length': pdfBuffer.length,
    'Content-Disposition': 'attachment; filename="' + filename + '"',
    'X-Invoice-Filename': filename,
    'Cache-Control': 'no-store'
  });
  res.end(pdfBuffer);
}

async function handleAdminSendInvoiceApi(req, res) {
  const session = requireAuthenticatedAdmin(req, res);
  if (!session) return;

  let body;
  try {
    body = await parseJsonBody(req, 1024 * 1024);
  } catch (_) {
    sendJson(res, 400, { ok: false, error: { code: 'INVALID_JSON', message: 'Requ?te invalide.' } });
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
    sendJson(res, 400, { ok: false, error: { code: 'ADMIN_INVOICE_EMAIL_INVALID', message: 'L?adresse email client est invalide.' } });
    return;
  }

  const store = readAdminDocumentsStore();
  const existingInvoice = (store.invoices || []).find((entry) => String(entry.id) === String(cleanInvoiceField(body.id, 120))) || null;
  const officialReference = existingInvoice && existingInvoice.sentAt ? existingInvoice.reference : getNextInvoiceReference(body.issueDate, existingInvoice && existingInvoice.id);
  const invoice = buildInvoiceRecord(existingInvoice, Object.assign({}, body, { items: items, email: email, customerName: customerName }), officialReference);

  let pdfBuffer;
  try {
    pdfBuffer = await buildInvoicePdfBuffer(invoice);
  } catch (_) {
    sendJson(res, 500, { ok: false, error: { code: 'ADMIN_INVOICE_PDF_FAILED', message: 'Impossible de g?n?rer le PDF pour le moment.' } });
    return;
  }

  try {
    await sendClientEmail({
      from: CONTACT_FROM,
      to: invoice.email,
      bcc: INVOICE_COPY_TO || undefined,
      replyTo: CONTACT_FROM,
      subject: invoice.emailSubject,
      text: buildInvoiceEmailText(invoice),
      html: buildInvoiceEmailHtml(invoice),
      attachments: [{
        filename: buildInvoiceAttachmentName(invoice),
        content: pdfBuffer,
        contentType: 'application/pdf'
      }]
    });
  } catch (error) {
    const detail = error && error.message ? String(error.message) : 'VÃƒÆ’Ã‚Â©rifiez la configuration email.';
    sendJson(res, 502, { ok: false, error: { code: 'ADMIN_INVOICE_SEND_FAILED', message: 'Impossible dÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢envoyer la facture pour le moment. ' + detail } });
    return;
  }

  saveInvoiceRecord(invoice);
  sendJson(res, 200, {
    ok: true,
    invoice,
    nextReference: getNextInvoiceReference(invoice.issueDate)
  });
}
function getNextQuoteReference(issueDate, excludeId, currentReference) {
  const store = readAdminDocumentsStore();
  const dayCode = formatInvoiceDayCode(issueDate);
  let maxSequence = QUOTE_SEQUENCE_START - 1;
  (store.quotes || []).forEach((quote) => {
    if (!quote) return;
    if (excludeId && String(quote.id) === String(excludeId)) return;
    const match = String(quote.reference || '').match(/^(\d+)-(\d{6})$/);
    if (!match || match[2] !== dayCode) return;
    const sequence = Number(match[1] || 0);
    if (sequence > maxSequence) maxSequence = sequence;
  });
  if (currentReference) {
    const currentMatch = String(currentReference).match(/^(\d+)-(\d{6})$/);
    if (currentMatch && currentMatch[2] === dayCode) {
      const currentSeq = Number(currentMatch[1] || 0);
      if (currentSeq > maxSequence) maxSequence = currentSeq;
    }
  }
  return String(maxSequence + 1) + '-' + dayCode;
}

function buildQuoteRecord(existingQuote, payload, forcedReference) {
  const items = normalizeInvoiceItems(payload.items);
  const issueDate = cleanInvoiceField(payload.issueDate, 20) || new Date().toISOString().slice(0, 10);
  const paymentDueDays = Math.max(0, Number(payload.paymentDueDays || 0));
  const vatRate = Math.max(0, Number(payload.vatRate || 0));
  const total = Number(items.reduce((sum, item) => sum + item.total, 0).toFixed(2));
  const now = new Date().toISOString();
  return {
    id: existingQuote ? existingQuote.id : createAdminDocumentId('quote'),
    type: 'quote',
    reference: forcedReference,
    customerName: cleanInvoiceField(payload.customerName || (existingQuote && existingQuote.customerName), 140),
    company: cleanInvoiceField(payload.company || (existingQuote && existingQuote.company), 140),
    email: cleanInvoiceField(payload.email || (existingQuote && existingQuote.email), 180),
    phone: cleanInvoiceField(payload.phone || (existingQuote && existingQuote.phone), 60),
    addressLine1: cleanInvoiceField(payload.addressLine1 || (existingQuote && existingQuote.addressLine1), 180),
    addressLine2: cleanInvoiceField(payload.addressLine2 || (existingQuote && existingQuote.addressLine2), 180),
    postalCode: cleanInvoiceField(payload.postalCode || (existingQuote && existingQuote.postalCode), 20),
    city: cleanInvoiceField(payload.city || (existingQuote && existingQuote.city), 120),
    country: cleanInvoiceField(payload.country || (existingQuote && existingQuote.country) || 'France', 120),
    issueDate,
    paymentDueDays,
    vatRate: Number(vatRate.toFixed(2)),
    vatMention: cleanInvoiceField(payload.vatMention || (existingQuote && existingQuote.vatMention) || 'TVA non applicable, art. 293B du CGI', 180),
    isApproved: !!payload.isApproved,
    notes: cleanInvoiceField(payload.notes || (existingQuote && existingQuote.notes), 1200),
    items,
    total,
    status: payload.isApproved ? 'approved' : 'draft',
    downloadedAt: existingQuote && existingQuote.downloadedAt ? existingQuote.downloadedAt : now,
    lastDownloadedAt: now,
    createdAt: existingQuote ? existingQuote.createdAt : now,
    updatedAt: now
  };
}

function saveQuoteRecord(quote) {
  const store = readAdminDocumentsStore();
  const index = (store.quotes || []).findIndex((entry) => String(entry.id) === String(quote.id));
  if (index >= 0) {
    store.quotes[index] = quote;
  } else {
    store.quotes.unshift(quote);
  }
  writeAdminDocumentsStore(store);
  return quote;
}

function buildQuoteAttachmentName(quote) {
  const safeReference = String(quote && quote.reference || 'devis').replace(/[^a-zA-Z0-9_-]+/g, '-');
  return 'devis-' + safeReference + '.pdf';
}

async function buildQuotePdfBuffer(quote) {
  if (!PDFDocument) {
    throw new Error('Le module PDF n\'est pas disponible sur le serveur.');
  }

  return await new Promise(function (resolve, reject) {
    const doc = new PDFDocument({ size: 'A4', margin: 36 });
    const chunks = [];
    const lineItems = Array.isArray(quote.items) ? quote.items : [];
    const logoPath = path.join(ROOT, 'assets', 'Background', 'favicon.png');
    const addressLines = [quote.customerName, quote.company, quote.email, quote.addressLine1, quote.addressLine2, [quote.postalCode, quote.city].filter(Boolean).join(' '), quote.country].filter(Boolean);

    doc.on('data', function (chunk) { chunks.push(chunk); });
    doc.on('end', function () { resolve(Buffer.concat(chunks)); });
    doc.on('error', reject);

    doc.rect(36, 36, 523, 770).fill('#ffffff');
    doc.fillColor('#10213b');

    if (fs.existsSync(logoPath)) {
      try {
        doc.image(logoPath, 54, 54, { fit: [72, 72], align: 'center', valign: 'center' });
      } catch (_) {}
    }

    doc.font('Helvetica-Bold').fontSize(22).fillColor('#0f2350').text('MULTIPIXELS.FR', 54, 136);
    doc.font('Helvetica-Oblique').fontSize(10).fillColor('#607796').text('votre expert textile', 54, 163);
    doc.font('Helvetica').fontSize(9).fillColor('#10213b').text('190 Chemin Blanc\\n62180 Rang du Fliers\\n06 27 14 08 40 | contact@multipixels.fr\\nN SIRET : 80 49 81 835 0000 23\\nCode APE: 18.12Z', 54, 195, { lineGap: 2 });

    const addressText = addressLines.length ? addressLines.join('\\n') : 'Informations client a completer';
    doc.font('Helvetica').fontSize(9);
    const addressBodyHeight = Math.max(62, doc.heightOfString(addressText, { width: 136, align: 'center', lineGap: 2 }) + 14);
    const addressBoxHeight = 22 + addressBodyHeight;
    doc.lineWidth(1).strokeColor('#435774').rect(360, 54, 165, addressBoxHeight).stroke();
    doc.rect(360, 54, 165, 22).fillAndStroke('#bfdbe9', '#435774');
    doc.fillColor('#10213b').font('Helvetica-Bold').fontSize(10).text('INFORMATION CLIENT', 368, 61, { width: 149, align: 'center' });
    doc.font('Helvetica').fontSize(9).fillColor('#10213b').text(addressText, 374, 87, { width: 136, align: 'center', lineGap: 2 });

    doc.lineWidth(1).strokeColor('#435774').rect(54, 270, 471, 54).stroke();
    doc.rect(54, 270, 471, 18).fillAndStroke('#bfdbe9', '#435774');
    doc.fillColor('#10213b').font('Helvetica-Bold').fontSize(10).text('DEVIS No ' + quote.reference, 62, 276);
    doc.font('Helvetica').fontSize(9);
    doc.rect(54, 288, 471, 18).stroke('#8ca6ba');
    doc.text('Date du devis', 62, 294);
    doc.font('Helvetica-Bold').text(formatInvoiceDateFr(quote.issueDate), 420, 294, { width: 90, align: 'right' });
    doc.font('Helvetica');
    doc.rect(54, 306, 471, 18).stroke('#8ca6ba');
    doc.text('Validite du devis : ' + quote.paymentDueDays + ' jours', 62, 312);

    const tableY = 340;
    const colX = [54, 130, 304, 348, 438];
    const colW = [76, 174, 44, 90, 87];
    const headers = ['Reference', 'Description', 'Qte', 'Prix unitaire', 'Total TTC'];
    headers.forEach(function (header, index) {
      doc.rect(colX[index], tableY, colW[index], 18).fillAndStroke('#d7e8f3', '#8ca6ba');
      doc.fillColor('#10213b').font('Helvetica-Bold').fontSize(8.5).text(header, colX[index] + 4, tableY + 5, { width: colW[index] - 8, align: index >= 2 ? 'center' : 'left' });
    });

    let currentY = tableY + 18;
    const rows = lineItems.length ? lineItems : [{ reference: '-', description: 'Aucune ligne pour le moment', quantity: 0, unitPrice: 0, total: 0 }];
    rows.forEach(function (item) {
      const values = [String(item.reference || '-'), String(item.description || '-'), String(item.quantity || 0), formatInvoiceMoney(item.unitPrice || 0), formatInvoiceMoney(item.total || 0)];
      const textHeights = values.map(function (value, index) {
        doc.font('Helvetica').fontSize(8.5);
        return doc.heightOfString(value, { width: colW[index] - 8, align: index >= 2 ? 'center' : 'left', lineGap: 1 });
      });
      const rowHeight = Math.max(22, Math.ceil(Math.max.apply(Math, textHeights)) + 10);
      values.forEach(function (value, index) {
        doc.rect(colX[index], currentY, colW[index], rowHeight).stroke('#c6d6e7');
        doc.font('Helvetica').fontSize(8.5).fillColor('#10213b').text(value, colX[index] + 4, currentY + 5, { width: colW[index] - 8, align: index >= 2 ? 'center' : 'left', lineGap: 1 });
      });
      currentY += rowHeight;
    });

    const bottomY = Math.max(560, currentY + 52);
    const paymentBoxX = 54;
    const paymentBoxWidth = 300;
    const sideBoxX = 364;
    const sideBoxWidth = 161;
    const totalBoxHeight = 76;
    const signatureBoxY = bottomY + totalBoxHeight + 10;
    const signatureBoxHeight = 92;

    doc.rect(paymentBoxX, bottomY, paymentBoxWidth, 126).stroke('#435774');
    doc.rect(paymentBoxX, bottomY, paymentBoxWidth, 20).fillAndStroke('#bfdbe9', '#435774');
    doc.fillColor('#10213b').font('Helvetica-Bold').fontSize(10).text('Conditions de paiement', paymentBoxX, bottomY + 6, { width: paymentBoxWidth, align: 'center' });
    doc.font('Helvetica').fontSize(8.1).text('Methodes de paiement acceptees :\\n\\nCheque, Virement, Espece, CB\\n\\nVIREMENT BANCAIRE\\nBanque : CA Nord de France\\nIBAN : FR76 1670 6000 5154 0091 5025 361\\nBIC : AGRIFRPP867\\nTitulaire du compte : BAUDELOT Guillaume\\n\\nEn cas de retard de paiement, une indemnite forfaitaire de 40 EUR pourra etre appliquee', paymentBoxX + 16, bottomY + 30, { width: paymentBoxWidth - 32, align: 'center', lineGap: 1.5 });

    doc.rect(sideBoxX, bottomY, sideBoxWidth, totalBoxHeight).stroke('#435774');
    doc.rect(sideBoxX, bottomY, sideBoxWidth, 20).fillAndStroke('#bfdbe9', '#435774');
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#10213b').text('TOTAL TTC', sideBoxX, bottomY + 6, { width: sideBoxWidth, align: 'center' });
    doc.font('Helvetica-Bold').fontSize(18).text(formatInvoiceMoney(quote.total), sideBoxX, bottomY + 34, { width: sideBoxWidth, align: 'center' });
    doc.font('Helvetica').fontSize(7.8).text(quote.vatRate > 0 ? ('TVA ' + quote.vatRate + ' % appliquee') : quote.vatMention, sideBoxX + 10, bottomY + 58, { width: sideBoxWidth - 20, align: 'center' });

    doc.rect(sideBoxX, signatureBoxY, sideBoxWidth, signatureBoxHeight).stroke('#435774');
    doc.rect(sideBoxX, signatureBoxY, sideBoxWidth, 20).fillAndStroke('#bfdbe9', '#435774');
    doc.font('Helvetica-Bold').fontSize(7.6).fillColor('#10213b').text('Mention Bon pour accord + Signature', sideBoxX + 8, signatureBoxY + 5, { width: sideBoxWidth - 16, align: 'center' });
    doc.font('Helvetica').fontSize(10).text('Date ___ / ___ / ______', sideBoxX + 12, signatureBoxY + signatureBoxHeight - 24, { width: sideBoxWidth - 24 });

    const footerY = Math.min(768, signatureBoxY + signatureBoxHeight + 18);
    doc.moveTo(54, footerY).lineTo(525, footerY).stroke('#c2d4e8');
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#3867b3').text('www.multipixels.fr', 54, footerY + 8, { width: 471, align: 'center' });
    doc.end();
  });
}

function handleAdminQuoteNextReferenceApi(req, res, requestUrl) {
  const session = requireAuthenticatedAdmin(req, res);
  if (!session) return;

  const issueDate = cleanInvoiceField(requestUrl.searchParams.get('issueDate'), 20) || new Date().toISOString().slice(0, 10);
  const documentId = cleanInvoiceField(requestUrl.searchParams.get('id'), 120);
  const currentReference = cleanInvoiceField(requestUrl.searchParams.get('current'), 80);
  sendJson(res, 200, { ok: true, reference: getNextQuoteReference(issueDate, documentId, currentReference) });
}

async function handleAdminQuotePdfApi(req, res) {
  const session = requireAuthenticatedAdmin(req, res);
  if (!session) return;

  let body;
  try {
    body = await parseJsonBody(req, 1024 * 1024);
  } catch (_) {
    sendJson(res, 400, { ok: false, error: { code: 'INVALID_JSON', message: 'RequÃƒÆ’Ã‚Âªte invalide.' } });
    return;
  }

  const items = normalizeInvoiceItems(body.items);
  const customerName = cleanInvoiceField(body.customerName, 140);
  if (!customerName || !items.length) {
    sendJson(res, 400, { ok: false, error: { code: 'ADMIN_QUOTE_INVALID', message: 'Nom client et au moins une ligne sont obligatoires.' } });
    return;
  }

  const store = readAdminDocumentsStore();
  const existingQuote = (store.quotes || []).find((entry) => String(entry.id) === String(cleanInvoiceField(body.id, 120))) || null;
  const officialReference = existingQuote ? existingQuote.reference : getNextQuoteReference(body.issueDate, existingQuote && existingQuote.id);
  const quote = buildQuoteRecord(existingQuote, Object.assign({}, body, { items: items, customerName: customerName }), officialReference);

  let pdfBuffer;
  try {
    pdfBuffer = await buildQuotePdfBuffer(quote);
  } catch (error) {
    const detail = error && error.message ? String(error.message) : 'GÃƒÆ’Ã‚Â©nÃƒÆ’Ã‚Â©ration PDF impossible.';
    sendJson(res, 500, { ok: false, error: { code: 'ADMIN_QUOTE_PDF_FAILED', message: 'Impossible de gÃƒÆ’Ã‚Â©nÃƒÆ’Ã‚Â©rer le PDF du devis. ' + detail } });
    return;
  }

  saveQuoteRecord(quote);
  const filename = buildQuoteAttachmentName(quote);
  const nextReference = getNextQuoteReference(quote.issueDate);
  res.writeHead(200, {
    'Content-Type': 'application/pdf',
    'Content-Disposition': 'attachment; filename="' + filename + '"',
    'Content-Length': pdfBuffer.length,
    'Cache-Control': 'no-store',
    'X-Quote-Filename': filename,
    'X-Quote-Reference': quote.reference,
    'X-Next-Quote-Reference': nextReference
  });
  res.end(pdfBuffer);
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
    sendJson(res, 401, { ok: false, error: { code: 'INVALID_SESSION', message: 'Session invalide ou expirÃƒÆ’Ã‚Â©e.' } });
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
    sendJson(res, 409, { ok: false, error: { code: 'EMAIL_EXISTS', message: 'Un compte existe d?j? avec cette adresse email.' } });
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
    sendJson(res, 400, { ok: false, error: { code: 'INVALID_TICKET', message: 'Merci de pr?ciser un sujet et votre demande SAV.' } });
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
    lastReply: 'Ticket re?u, notre ?quipe reviendra vers vous sous 24 ? 48h.'
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

async function sendViaResend(mail) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + RESEND_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: MAIL_FROM_NAME + ' <' + mail.from + '>',
      to: [mail.to],
      bcc: mail.bcc ? [mail.bcc] : undefined,
      reply_to: mail.replyTo || undefined,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
      attachments: Array.isArray(mail.attachments) && mail.attachments.length
        ? mail.attachments.map(function (attachment) {
            return {
              filename: attachment.filename,
              content: Buffer.isBuffer(attachment.content) ? attachment.content.toString('base64') : String(attachment.content || ''),
              content_type: attachment.contentType || 'application/octet-stream'
            };
          })
        : undefined
    })
  });
  const payload = await response.json().catch(function () { return null; });
  if (!response.ok) {
    throw new Error((payload && (payload.message || payload.error)) || ('Resend HTTP ' + response.status));
  }
  return { ok: true, provider: 'resend', id: payload && payload.id ? payload.id : '' };
}

async function sendViaBrevo(mail) {
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': BREVO_API_KEY,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify({
      sender: { name: MAIL_FROM_NAME, email: mail.from },
      to: [{ email: mail.to }],
      bcc: mail.bcc ? [{ email: mail.bcc }] : undefined,
      replyTo: mail.replyTo ? { email: mail.replyTo } : undefined,
      subject: mail.subject,
      textContent: mail.text,
      htmlContent: mail.html,
      attachment: Array.isArray(mail.attachments) && mail.attachments.length
        ? mail.attachments.map(function (attachment) {
            return {
              name: attachment.filename,
              content: Buffer.isBuffer(attachment.content) ? attachment.content.toString('base64') : String(attachment.content || '')
            };
          })
        : undefined
    })
  });
  const payload = await response.json().catch(function () { return null; });
  if (!response.ok) {
    const message = payload && payload.message
      ? (Array.isArray(payload.message) ? payload.message.join(' ') : payload.message)
      : ('Brevo HTTP ' + response.status);
    throw new Error(message);
  }
  return { ok: true, provider: 'brevo', id: payload && payload.messageId ? payload.messageId : '' };
}

async function sendClientEmail(options) {
  if (!options || !options.to) {
    throw new Error('Destinataire email manquant.');
  }
  const preferredFrom = options.from || CONTACT_FROM;
  const baseMail = {
    from: preferredFrom,
    to: options.to,
    bcc: options.bcc || undefined,
    replyTo: options.replyTo || undefined,
    subject: options.subject,
    text: options.text,
    html: options.html,
    attachments: Array.isArray(options.attachments) ? options.attachments : []
  };

  if (RESEND_API_KEY) {
    return sendViaResend(Object.assign({}, baseMail, {
      from: RESEND_FROM_EMAIL,
      replyTo: baseMail.replyTo || CONTACT_FROM
    }));
  }

  if (BREVO_API_KEY) {
    return sendViaBrevo(baseMail);
  }

  if (!nodemailer || !SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    throw new Error('Configuration email incomplÃƒÆ’Ã‚Â¨te. Ajoutez RESEND_API_KEY, BREVO_API_KEY ou un SMTP complet.');
  }

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });

  try {
    await transporter.sendMail(Object.assign({}, baseMail, {
      from: preferredFrom,
      sender: SMTP_USER || preferredFrom
    }));
    return { ok: true, fromUsed: preferredFrom, provider: 'smtp' };
  } catch (primaryError) {
    const fallbackFrom = SMTP_USER || preferredFrom;
    if (fallbackFrom && fallbackFrom !== preferredFrom) {
      try {
        await transporter.sendMail(Object.assign({}, baseMail, {
          from: fallbackFrom,
          sender: fallbackFrom,
          replyTo: preferredFrom
        }));
        return { ok: true, fromUsed: fallbackFrom, fallback: true, provider: 'smtp' };
      } catch (fallbackError) {
        console.error('[invoice-email] SMTP fallback send failed', fallbackError);
        if (/timeout|ETIMEDOUT/i.test(String(fallbackError && fallbackError.message || ''))) {
          throw new Error('Connection timeout. Sur Railway, utilisez de prÃƒÆ’Ã‚Â©fÃƒÆ’Ã‚Â©rence RESEND_API_KEY ou BREVO_API_KEY.');
        }
        throw fallbackError;
      }
    }
    console.error('[invoice-email] SMTP send failed', primaryError);
    if (/timeout|ETIMEDOUT/i.test(String(primaryError && primaryError.message || ''))) {
      throw new Error('Connection timeout. Sur Railway, utilisez de prÃƒÆ’Ã‚Â©fÃƒÆ’Ã‚Â©rence RESEND_API_KEY ou BREVO_API_KEY.');
    }
    throw primaryError;
  }
}

function ensureAdminDocumentsStore() {
  const dir = path.dirname(ADMIN_DOCUMENTS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(ADMIN_DOCUMENTS_PATH)) {
    fs.writeFileSync(ADMIN_DOCUMENTS_PATH, JSON.stringify({ quotes: [], invoices: [], invoiceClients: [], invoiceReferences: [] }, null, 2), 'utf8');
  }
}

function readAdminDocumentsStore() {
  ensureAdminDocumentsStore();
  try {
    const raw = fs.readFileSync(ADMIN_DOCUMENTS_PATH, 'utf8').replace(/^\uFEFF/, '');
    const parsed = JSON.parse(raw);
    return {
      quotes: Array.isArray(parsed.quotes) ? parsed.quotes : [],
      invoices: Array.isArray(parsed.invoices) ? parsed.invoices : [],
      invoiceClients: Array.isArray(parsed.invoiceClients) ? parsed.invoiceClients : [],
      invoiceReferences: Array.isArray(parsed.invoiceReferences) ? parsed.invoiceReferences : []
    };
  } catch (_) {
    return { quotes: [], invoices: [], invoiceClients: [], invoiceReferences: [] };
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
  if (currentReference) {
    const currentMatch = String(currentReference).match(/^(\d+)-(\d{6})$/);
    if (currentMatch && currentMatch[2] === dayCode) {
      const currentSeq = Number(currentMatch[1] || 0);
      if (currentSeq > maxSequence) maxSequence = currentSeq;
    }
  }
  return String(maxSequence + 1) + '-' + dayCode;
}

function addDaysToIsoDate(issueDate, days) {
  const base = new Date((cleanInvoiceField(issueDate, 20) || new Date().toISOString().slice(0, 10)) + 'T00:00:00');
  if (Number.isNaN(base.getTime())) return new Date().toISOString().slice(0, 10);
  base.setDate(base.getDate() + Math.max(0, Number(days || 0)));
  return base.toISOString().slice(0, 10);
}

function normalizeInvoiceItems(items) {
  const cleaned = (Array.isArray(items) ? items : []).map((item) => {
    const quantity = Math.max(1, Number(item && item.quantity || 1));
    const unitPrice = Number(item && item.unitPrice || 0);
    const reference = cleanInvoiceField(item && item.reference, 80);
    const description = cleanInvoiceField(item && item.description, 240);
    const key = (reference + ' ' + description).toUpperCase();
    const discountRate = (key.includes('REM10') || key.includes('-10%') || key.includes('REMISE 10'))
      ? 0.10
      : ((key.includes('REM5') || key.includes('-5%') || key.includes('REMISE 5')) ? 0.05 : 0);

    return {
      reference,
      description,
      quantity: Number.isFinite(quantity) ? quantity : 1,
      unitPrice: Number.isFinite(unitPrice) ? unitPrice : 0,
      discountRate
    };
  }).filter((item) => item.reference || item.description);

  const baseSubtotal = Number(cleaned.reduce((sum, item) => {
    if (item.discountRate > 0) return sum;
    return sum + (item.quantity * item.unitPrice);
  }, 0).toFixed(2));

  return cleaned.map((item) => {
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
    return {
      reference: item.reference,
      description: item.description,
      quantity: item.quantity,
      unitPrice,
      total: Number((item.quantity * unitPrice).toFixed(2))
    };
  });
}

function buildInvoiceRecord(existingInvoice, payload, forcedReference) {
  const items = normalizeInvoiceItems(payload.items);
  const issueDate = cleanInvoiceField(payload.issueDate, 20) || new Date().toISOString().slice(0, 10);
  const paymentDueDays = Math.max(0, Number(payload.paymentDueDays || 0));
  const dueDate = addDaysToIsoDate(issueDate, paymentDueDays);
  const vatRate = Math.max(0, Number(payload.vatRate || 0));
  const total = Number(items.reduce((sum, item) => sum + item.total, 0).toFixed(2));
  const now = new Date().toISOString();
  const emailSubject = cleanInvoiceField(payload.emailSubject, 220) || ('Votre facture - Multipixels.fr, nÃƒâ€šÃ‚Â° ' + forcedReference);
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
    + '<div style="margin-top:18px;line-height:1.6;font-size:14px;">190 Chemin Blanc<br/>62180 Rang du Fliers<br/>06 27 14 08 40 | contact@multipixels.fr<br/>NÃƒâ€šÃ‚Â° SIRET : 80 49 81 835 0000 23<br/>Code APE: 18.12Z</div>'
    + '</td><td style="width:290px;vertical-align:top;">'
    + '<div style="border:1px solid #435774;"><div style="padding:8px 12px;background:#bfdbe9;font-weight:700;text-transform:uppercase;text-align:center;">Adresse de facturation</div><div style="padding:16px 18px;text-align:center;line-height:1.6;">' + (addressLines.length ? addressLines.map(escapeInvoiceHtml).join('<br/>') : 'Informations client ÃƒÆ’Ã‚Â  complÃƒÆ’Ã‚Â©ter') + '</div></div>'
    + '</td></tr></table>'
    + '<table style="width:100%;margin-top:26px;border-collapse:collapse;">'
    + '<tr><th colspan="2" style="text-align:left;background:#bfdbe9;border:1px solid #435774;padding:10px 12px;">FACTURE NÃƒâ€šÃ‚Â° ' + escapeInvoiceHtml(invoice.reference) + '</th></tr>'
    + '<tr><td style="border:1px solid #c6d6e7;padding:8px 12px;">Date de facturation</td><td style="border:1px solid #c6d6e7;padding:8px 12px;font-weight:700;">' + escapeInvoiceHtml(formatInvoiceDateFr(invoice.issueDate)) + '</td></tr>'
    + '<tr><td colspan="2" style="border:1px solid #c6d6e7;padding:8px 12px;">Paiement ÃƒÆ’Ã‚Â  ' + invoice.paymentDueDays + ' jours ÃƒÆ’Ã‚Â  rÃƒÆ’Ã‚Â©ception de la facture</td></tr>'
    + '</table>'
    + '<table style="width:100%;margin-top:18px;border-collapse:collapse;">'
    + '<thead><tr><th style="padding:8px;border:1px solid #8ea8bd;background:#d7e8f3;text-align:left;">RÃƒÆ’Ã‚Â©fÃƒÆ’Ã‚Â©rence</th><th style="padding:8px;border:1px solid #8ea8bd;background:#d7e8f3;text-align:left;">Description</th><th style="padding:8px;border:1px solid #8ea8bd;background:#d7e8f3;text-align:center;">QtÃƒÆ’Ã‚Â©</th><th style="padding:8px;border:1px solid #8ea8bd;background:#d7e8f3;text-align:right;">Prix unitaire</th><th style="padding:8px;border:1px solid #8ea8bd;background:#d7e8f3;text-align:right;">Total TTC</th></tr></thead>'
    + '<tbody>' + rows + '</tbody></table>'
    + '<table style="width:100%;margin-top:24px;border-collapse:collapse;">'
    + '<tr><td style="vertical-align:top;padding-right:12px;">'
    + '<div style="border:1px solid #435774;"><div style="padding:8px 12px;background:#bfdbe9;text-align:center;">Conditions de paiement</div><div style="padding:16px 18px;line-height:1.7;text-align:center;">MÃƒÆ’Ã‚Â©thodes de paiement acceptÃƒÆ’Ã‚Â©es :<br/><strong>ChÃƒÆ’Ã‚Â¨que, Virement, EspÃƒÆ’Ã‚Â¨ce, CB</strong><br/><br/>VIREMENT BANCAIRE<br/>Banque : CA Nord de France<br/>IBAN : FR76 1670 6000 5154 0091 5025 361<br/>BIC : AGRIFRPP867<br/>Titulaire du compte : BAUDELOT Guillaume<br/><br/>En cas de retard de paiement, une indemnite forfaitaire de 40 EUR pourra etre appliquee'
    + '</td><td style="width:220px;vertical-align:top;">'
    + '<div style="border:1px solid #435774;"><div style="padding:8px 12px;background:#bfdbe9;text-align:center;font-weight:700;">TOTAL TTC</div><div style="padding:16px 18px;text-align:center;"><div style="font-size:28px;font-weight:800;">' + escapeInvoiceHtml(formatInvoiceMoney(invoice.total)) + '</div><div style="margin-top:10px;font-size:13px;">' + escapeInvoiceHtml(invoice.vatRate > 0 ? ('TVA ' + invoice.vatRate + ' % appliquÃƒÆ’Ã‚Â©e') : invoice.vatMention) + '</div></div></div>'
    + '</td></tr></table>'
    + '<div style="margin-top:24px;text-align:center;color:#3867b3;font-weight:700;">www.multipixels.fr</div></div></div>';
}

function buildInvoiceEmailText(invoice) {
  return [
    'Bonjour,',
    '',
    'Veuillez trouver en piÃƒÆ’Ã‚Â¨ce jointe votre facture ' + invoice.reference + '.',
    'Date : ' + formatInvoiceDateFr(invoice.issueDate),
    'Total TTC : ' + formatInvoiceMoney(invoice.total),
    '',
    'Pour toute question, vous pouvez rÃƒÆ’Ã‚Â©pondre ÃƒÆ’Ã‚Â  cet email ou nous contacter ÃƒÆ’Ã‚Â  contact@multipixels.fr.',
    '',
    'Cordialement,',
    'MULTIPIXELS.FR'
  ].join('\n');
}

function buildInvoiceAttachmentName(invoice) {
  const safeReference = String(invoice && invoice.reference || 'facture').replace(/[^a-zA-Z0-9_-]+/g, '-');
  return 'facture-' + safeReference + '.pdf';
}

function buildInvoiceEmailHtml(invoice) {
  const intro = invoice.emailMessage
    ? invoice.emailMessage.split(/\r?\n/).map((line) => '<div>' + escapeInvoiceHtml(line) + '</div>').join('')
    : '<div>Bonjour,</div><div style="margin-top:12px;">Veuillez trouver votre facture en piÃƒÆ’Ã‚Â¨ce jointe.</div>';
  const logoUrl = 'https://www.multipixels.fr/assets/Background/favicon.png';
  return '<div style="font-family:Arial,sans-serif;color:#10213b;background:#eef5fd;padding:24px;">'
    + '<div style="max-width:760px;margin:0 auto;background:#ffffff;border:1px solid #d8e4f2;padding:28px;border-radius:12px;">'
    + '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">'
    + '<tr>'
    + '<td style="width:72px;vertical-align:middle;">'
    + '<img src="' + logoUrl + '" alt="MULTIPIXELS" width="56" height="56" style="display:block;width:56px;height:56px;border:0;">'
    + '</td>'
    + '<td style="vertical-align:middle;">'
    + '<div style="font-size:28px;font-weight:800;color:#0f2350;line-height:1.1;">MULTIPIXELS.FR</div>'
    + '<div style="color:#587094;font-style:italic;margin-top:4px;">votre expert textile</div>'
    + '</td>'
    + '</tr>'
    + '</table>'
    + '<div style="margin-top:18px;line-height:1.7;font-size:15px;">' + intro + '</div>'
    + '<div style="margin-top:22px;padding:16px 18px;border:1px solid #d7e8f3;background:#f7fbff;border-radius:10px;">'
    + '<div><strong>RÃƒÆ’Ã‚Â©fÃƒÆ’Ã‚Â©rence :</strong> ' + escapeInvoiceHtml(invoice.reference) + '</div>'
    + '<div style="margin-top:6px;"><strong>Date :</strong> ' + escapeInvoiceHtml(formatInvoiceDateFr(invoice.issueDate)) + '</div>'
    + '<div style="margin-top:6px;"><strong>Total TTC :</strong> ' + escapeInvoiceHtml(formatInvoiceMoney(invoice.total)) + '</div>'
    + '</div>'
    + '<div style="margin-top:22px;font-size:14px;line-height:1.6;color:#4b607d;">Pour toute question, merci de ne pas rÃƒÆ’Ã‚Â©pondre directement ÃƒÆ’Ã‚Â  cet email et de nous contacter ÃƒÆ’Ã‚Â  <a href="mailto:contact@multipixels.fr" style="color:#1c56b3;">contact@multipixels.fr</a> ou au 06 27 14 08 40.</div>'
    + '</div>'
    + '</div>';
}

async function buildInvoicePdfBuffer(invoice) {
  if (!PDFDocument) {
    throw new Error('Le module PDF n\'est pas disponible sur le serveur.');
  }

  return await new Promise(function (resolve, reject) {
    const doc = new PDFDocument({ size: 'A4', margin: 36 });
    const chunks = [];
    const lineItems = Array.isArray(invoice.items) ? invoice.items : [];
    const logoPath = path.join(ROOT, 'assets', 'Background', 'favicon.png');
    const addressLines = [invoice.customerName, invoice.company, invoice.email, invoice.addressLine1, invoice.addressLine2, [invoice.postalCode, invoice.city].filter(Boolean).join(' '), invoice.country].filter(Boolean);

    doc.on('data', function (chunk) { chunks.push(chunk); });
    doc.on('end', function () { resolve(Buffer.concat(chunks)); });
    doc.on('error', reject);

    doc.rect(36, 36, 523, 770).fill('#ffffff');
    doc.fillColor('#10213b');

    if (fs.existsSync(logoPath)) {
      try {
        doc.image(logoPath, 54, 54, { fit: [72, 72], align: 'center', valign: 'center' });
      } catch (_) {}
    }

    doc.font('Helvetica-Bold').fontSize(22).fillColor('#0f2350').text('MULTIPIXELS.FR', 54, 136);
    doc.font('Helvetica-Oblique').fontSize(10).fillColor('#607796').text('votre expert textile', 54, 163);
    doc.font('Helvetica').fontSize(9).fillColor('#10213b').text('190 Chemin Blanc\\n62180 Rang du Fliers\\n06 27 14 08 40 | contact@multipixels.fr\\nN SIRET : 80 49 81 835 0000 23\\nCode APE: 18.12Z', 54, 195, { lineGap: 2 });

    const addressText = addressLines.length ? addressLines.join('\\n') : 'Informations client a completer';
    doc.font('Helvetica').fontSize(9);
    const addressBodyHeight = Math.max(62, doc.heightOfString(addressText, { width: 136, align: 'center', lineGap: 2 }) + 14);
    const addressBoxHeight = 22 + addressBodyHeight;
    doc.lineWidth(1).strokeColor('#435774').rect(360, 54, 165, addressBoxHeight).stroke();
    doc.rect(360, 54, 165, 22).fillAndStroke('#bfdbe9', '#435774');
    doc.fillColor('#10213b').font('Helvetica-Bold').fontSize(10).text('ADRESSE DE FACTURATION', 368, 61, { width: 149, align: 'center' });
    doc.font('Helvetica').fontSize(9).fillColor('#10213b').text(addressText, 374, 87, { width: 136, align: 'center', lineGap: 2 });

    doc.lineWidth(1).strokeColor('#435774').rect(54, 270, 471, 54).stroke();
    doc.rect(54, 270, 471, 18).fillAndStroke('#bfdbe9', '#435774');
    doc.fillColor('#10213b').font('Helvetica-Bold').fontSize(10).text('FACTURE No ' + invoice.reference, 62, 276);
    doc.font('Helvetica').fontSize(9);
    doc.rect(54, 288, 471, 18).stroke('#8ca6ba');
    doc.text('Date de facturation', 62, 294);
    doc.font('Helvetica-Bold').text(formatInvoiceDateFr(invoice.issueDate), 420, 294, { width: 90, align: 'right' });
    doc.font('Helvetica');
    doc.rect(54, 306, 471, 18).stroke('#8ca6ba');
    doc.text('Paiement a ' + invoice.paymentDueDays + ' jours a reception de la facture', 62, 312);

    const tableY = 340;
    const colX = [54, 130, 304, 348, 438];
    const colW = [76, 174, 44, 90, 87];
    const headers = ['Reference', 'Description', 'Qte', 'Prix unitaire', 'Total TTC'];
    headers.forEach(function (header, index) {
      doc.rect(colX[index], tableY, colW[index], 18).fillAndStroke('#d7e8f3', '#8ca6ba');
      doc.fillColor('#10213b').font('Helvetica-Bold').fontSize(8.5).text(header, colX[index] + 4, tableY + 5, { width: colW[index] - 8, align: index >= 2 ? 'center' : 'left' });
    });

    let currentY = tableY + 18;
    const rows = lineItems.length ? lineItems : [{ reference: '-', description: 'Aucune ligne pour le moment', quantity: 0, unitPrice: 0, total: 0 }];
    rows.forEach(function (item) {
      const values = [String(item.reference || '-'), String(item.description || '-'), String(item.quantity || 0), formatInvoiceMoney(item.unitPrice || 0), formatInvoiceMoney(item.total || 0)];
      const textHeights = values.map(function (value, index) {
        doc.font('Helvetica').fontSize(8.5);
        return doc.heightOfString(value, { width: colW[index] - 8, align: index >= 2 ? 'center' : 'left', lineGap: 1 });
      });
      const rowHeight = Math.max(22, Math.ceil(Math.max.apply(Math, textHeights)) + 10);
      values.forEach(function (value, index) {
        doc.rect(colX[index], currentY, colW[index], rowHeight).stroke('#c6d6e7');
        doc.font('Helvetica').fontSize(8.5).fillColor('#10213b').text(value, colX[index] + 4, currentY + 5, { width: colW[index] - 8, align: index >= 2 ? 'center' : 'left', lineGap: 1 });
      });
      currentY += rowHeight;
    });

    const bottomY = Math.max(560, currentY + 56);
    doc.rect(54, bottomY, 330, 150).stroke('#435774');
    doc.rect(54, bottomY, 330, 20).fillAndStroke('#bfdbe9', '#435774');
    doc.fillColor('#10213b').font('Helvetica-Bold').fontSize(10).text('Conditions de paiement', 54, bottomY + 6, { width: 330, align: 'center' });
    doc.font('Helvetica').fontSize(8.8).text('Methodes de paiement acceptees :\\n\\nCheque, Virement, Espece, CB\\n\\nVIREMENT BANCAIRE\\nBanque : CA Nord de France\\nIBAN : FR76 1670 6000 5154 0091 5025 361\\nBIC : AGRIFRPP867\\nTitulaire du compte : BAUDELOT Guillaume\\n\\nEn cas de retard de paiement, une indemnite forfaitaire de 40 EUR pourra etre appliquee', 72, bottomY + 34, { width: 294, align: 'center', lineGap: 2 });

    doc.rect(404, bottomY, 121, 76).stroke('#435774');
    doc.rect(404, bottomY, 121, 20).fillAndStroke('#bfdbe9', '#435774');
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#10213b').text('TOTAL TTC', 404, bottomY + 6, { width: 121, align: 'center' });
    doc.font('Helvetica-Bold').fontSize(18).text(formatInvoiceMoney(invoice.total), 404, bottomY + 34, { width: 121, align: 'center' });
    doc.font('Helvetica').fontSize(7.8).text(invoice.vatRate > 0 ? ('TVA ' + invoice.vatRate + ' % appliquee') : invoice.vatMention, 414, bottomY + 58, { width: 101, align: 'center' });

    const footerY = Math.min(744, bottomY + 184);
    doc.moveTo(54, footerY).lineTo(525, footerY).stroke('#c2d4e8');
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#3867b3').text('www.multipixels.fr', 54, footerY + 8, { width: 471, align: 'center' });
    doc.end();
  });
}
async function handleAdminSendInvoiceApi(req, res) {
  const session = requireAuthenticatedAdmin(req, res);
  if (!session) return;

  let body;
  try {
    body = await parseJsonBody(req, 1024 * 1024);
  } catch (_) {
    sendJson(res, 400, { ok: false, error: { code: 'INVALID_JSON', message: 'RequÃƒÆ’Ã‚Âªte invalide.' } });
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
    sendJson(res, 400, { ok: false, error: { code: 'ADMIN_INVOICE_EMAIL_INVALID', message: 'LÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢adresse email client est invalide.' } });
    return;
  }

  const store = readAdminDocumentsStore();
  const existingInvoice = (store.invoices || []).find((entry) => String(entry.id) === String(cleanInvoiceField(body.id, 120))) || null;
  const officialReference = existingInvoice && existingInvoice.sentAt ? existingInvoice.reference : getNextInvoiceReference(body.issueDate, existingInvoice && existingInvoice.id);
  const invoice = buildInvoiceRecord(existingInvoice, Object.assign({}, body, { items: items, email: email, customerName: customerName }), officialReference);

  let pdfBuffer;
  try {
    pdfBuffer = await buildInvoicePdfBuffer(invoice);
  } catch (error) {
    const detail = error && error.message ? String(error.message) : 'GÃƒÆ’Ã‚Â©nÃƒÆ’Ã‚Â©ration PDF impossible.';
    sendJson(res, 500, { ok: false, error: { code: 'ADMIN_INVOICE_PDF_FAILED', message: 'Impossible de gÃƒÆ’Ã‚Â©nÃƒÆ’Ã‚Â©rer le PDF de la facture. ' + detail } });
    return;
  }

  let sent;
  try {
    sent = await sendClientEmail({
      from: CONTACT_FROM,
      to: invoice.email,
      bcc: INVOICE_COPY_TO || undefined,
      replyTo: CONTACT_FROM,
      subject: invoice.emailSubject,
      text: buildInvoiceEmailText(invoice),
      html: buildInvoiceEmailHtml(invoice),
      attachments: [{
        filename: buildInvoiceAttachmentName(invoice),
        content: pdfBuffer,
        contentType: 'application/pdf'
      }]
    });
  } catch (error) {
    const detail = error && error.message ? String(error.message) : 'VÃƒÆ’Ã‚Â©rifiez la configuration email.';
    sendJson(res, 502, { ok: false, error: { code: 'ADMIN_INVOICE_SEND_FAILED', message: 'Impossible dÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢envoyer la facture pour le moment. ' + detail } });
    return;
  }

  saveInvoiceRecord(invoice);
  sendJson(res, 200, {
    ok: true,
    invoice,
    nextReference: getNextInvoiceReference(invoice.issueDate)
  });
}
function getNextQuoteReference(issueDate, excludeId, currentReference) {
  const store = readAdminDocumentsStore();
  const dayCode = formatInvoiceDayCode(issueDate);
  let maxSequence = QUOTE_SEQUENCE_START - 1;
  (store.quotes || []).forEach((quote) => {
    if (!quote) return;
    if (excludeId && String(quote.id) === String(excludeId)) return;
    const match = String(quote.reference || '').match(/^(\d+)-(\d{6})$/);
    if (!match || match[2] !== dayCode) return;
    const sequence = Number(match[1] || 0);
    if (sequence > maxSequence) maxSequence = sequence;
  });
  if (currentReference) {
    const currentMatch = String(currentReference).match(/^(\d+)-(\d{6})$/);
    if (currentMatch && currentMatch[2] === dayCode) {
      const currentSeq = Number(currentMatch[1] || 0);
      if (currentSeq > maxSequence) maxSequence = currentSeq;
    }
  }
  return String(maxSequence + 1) + '-' + dayCode;
}

function buildQuoteRecord(existingQuote, payload, forcedReference) {
  const items = normalizeInvoiceItems(payload.items);
  const issueDate = cleanInvoiceField(payload.issueDate, 20) || new Date().toISOString().slice(0, 10);
  const paymentDueDays = Math.max(0, Number(payload.paymentDueDays || 0));
  const vatRate = Math.max(0, Number(payload.vatRate || 0));
  const total = Number(items.reduce((sum, item) => sum + item.total, 0).toFixed(2));
  const now = new Date().toISOString();
  return {
    id: existingQuote ? existingQuote.id : createAdminDocumentId('quote'),
    type: 'quote',
    reference: forcedReference,
    customerName: cleanInvoiceField(payload.customerName || (existingQuote && existingQuote.customerName), 140),
    company: cleanInvoiceField(payload.company || (existingQuote && existingQuote.company), 140),
    email: cleanInvoiceField(payload.email || (existingQuote && existingQuote.email), 180),
    phone: cleanInvoiceField(payload.phone || (existingQuote && existingQuote.phone), 60),
    addressLine1: cleanInvoiceField(payload.addressLine1 || (existingQuote && existingQuote.addressLine1), 180),
    addressLine2: cleanInvoiceField(payload.addressLine2 || (existingQuote && existingQuote.addressLine2), 180),
    postalCode: cleanInvoiceField(payload.postalCode || (existingQuote && existingQuote.postalCode), 20),
    city: cleanInvoiceField(payload.city || (existingQuote && existingQuote.city), 120),
    country: cleanInvoiceField(payload.country || (existingQuote && existingQuote.country) || 'France', 120),
    issueDate,
    paymentDueDays,
    vatRate: Number(vatRate.toFixed(2)),
    vatMention: cleanInvoiceField(payload.vatMention || (existingQuote && existingQuote.vatMention) || 'TVA non applicable, art. 293B du CGI', 180),
    isApproved: !!payload.isApproved,
    notes: cleanInvoiceField(payload.notes || (existingQuote && existingQuote.notes), 1200),
    items,
    total,
    status: payload.isApproved ? 'approved' : 'draft',
    downloadedAt: existingQuote && existingQuote.downloadedAt ? existingQuote.downloadedAt : now,
    lastDownloadedAt: now,
    createdAt: existingQuote ? existingQuote.createdAt : now,
    updatedAt: now
  };
}

function saveQuoteRecord(quote) {
  const store = readAdminDocumentsStore();
  const index = (store.quotes || []).findIndex((entry) => String(entry.id) === String(quote.id));
  if (index >= 0) {
    store.quotes[index] = quote;
  } else {
    store.quotes.unshift(quote);
  }
  writeAdminDocumentsStore(store);
  return quote;
}

function buildQuoteAttachmentName(quote) {
  const safeReference = String(quote && quote.reference || 'devis').replace(/[^a-zA-Z0-9_-]+/g, '-');
  return 'devis-' + safeReference + '.pdf';
}

async function buildQuotePdfBuffer(quote) {
  if (!PDFDocument) {
    throw new Error('Le module PDF n\'est pas disponible sur le serveur.');
  }

  return await new Promise(function (resolve, reject) {
    const doc = new PDFDocument({ size: 'A4', margin: 36 });
    const chunks = [];
    const lineItems = Array.isArray(quote.items) ? quote.items : [];
    const logoPath = path.join(ROOT, 'assets', 'Background', 'favicon.png');
    const addressLines = [quote.customerName, quote.company, quote.email, quote.addressLine1, quote.addressLine2, [quote.postalCode, quote.city].filter(Boolean).join(' '), quote.country].filter(Boolean);

    doc.on('data', function (chunk) { chunks.push(chunk); });
    doc.on('end', function () { resolve(Buffer.concat(chunks)); });
    doc.on('error', reject);

    doc.rect(36, 36, 523, 770).fill('#ffffff');
    doc.fillColor('#10213b');

    if (fs.existsSync(logoPath)) {
      try {
        doc.image(logoPath, 54, 54, { fit: [72, 72], align: 'center', valign: 'center' });
      } catch (_) {}
    }

    doc.font('Helvetica-Bold').fontSize(22).fillColor('#0f2350').text('MULTIPIXELS.FR', 54, 136);
    doc.font('Helvetica-Oblique').fontSize(10).fillColor('#607796').text('votre expert textile', 54, 163);
    doc.font('Helvetica').fontSize(9).fillColor('#10213b').text('190 Chemin Blanc\\n62180 Rang du Fliers\\n06 27 14 08 40 | contact@multipixels.fr\\nN SIRET : 80 49 81 835 0000 23\\nCode APE: 18.12Z', 54, 195, { lineGap: 2 });

    const addressText = addressLines.length ? addressLines.join('\\n') : 'Informations client a completer';
    doc.font('Helvetica').fontSize(9);
    const addressBodyHeight = Math.max(62, doc.heightOfString(addressText, { width: 136, align: 'center', lineGap: 2 }) + 14);
    const addressBoxHeight = 22 + addressBodyHeight;
    doc.lineWidth(1).strokeColor('#435774').rect(360, 54, 165, addressBoxHeight).stroke();
    doc.rect(360, 54, 165, 22).fillAndStroke('#bfdbe9', '#435774');
    doc.fillColor('#10213b').font('Helvetica-Bold').fontSize(10).text('INFORMATION CLIENT', 368, 61, { width: 149, align: 'center' });
    doc.font('Helvetica').fontSize(9).fillColor('#10213b').text(addressText, 374, 87, { width: 136, align: 'center', lineGap: 2 });

    doc.lineWidth(1).strokeColor('#435774').rect(54, 270, 471, 54).stroke();
    doc.rect(54, 270, 471, 18).fillAndStroke('#bfdbe9', '#435774');
    doc.fillColor('#10213b').font('Helvetica-Bold').fontSize(10).text('DEVIS No ' + quote.reference, 62, 276);
    doc.font('Helvetica').fontSize(9);
    doc.rect(54, 288, 471, 18).stroke('#8ca6ba');
    doc.text('Date du devis', 62, 294);
    doc.font('Helvetica-Bold').text(formatInvoiceDateFr(quote.issueDate), 420, 294, { width: 90, align: 'right' });
    doc.font('Helvetica');
    doc.rect(54, 306, 471, 18).stroke('#8ca6ba');
    doc.text('Validite du devis : ' + quote.paymentDueDays + ' jours', 62, 312);

    const tableY = 340;
    const colX = [54, 130, 304, 348, 438];
    const colW = [76, 174, 44, 90, 87];
    const headers = ['Reference', 'Description', 'Qte', 'Prix unitaire', 'Total TTC'];
    headers.forEach(function (header, index) {
      doc.rect(colX[index], tableY, colW[index], 18).fillAndStroke('#d7e8f3', '#8ca6ba');
      doc.fillColor('#10213b').font('Helvetica-Bold').fontSize(8.5).text(header, colX[index] + 4, tableY + 5, { width: colW[index] - 8, align: index >= 2 ? 'center' : 'left' });
    });

    let currentY = tableY + 18;
    const rows = lineItems.length ? lineItems : [{ reference: '-', description: 'Aucune ligne pour le moment', quantity: 0, unitPrice: 0, total: 0 }];
    rows.forEach(function (item) {
      const values = [String(item.reference || '-'), String(item.description || '-'), String(item.quantity || 0), formatInvoiceMoney(item.unitPrice || 0), formatInvoiceMoney(item.total || 0)];
      const textHeights = values.map(function (value, index) {
        doc.font('Helvetica').fontSize(8.5);
        return doc.heightOfString(value, { width: colW[index] - 8, align: index >= 2 ? 'center' : 'left', lineGap: 1 });
      });
      const rowHeight = Math.max(22, Math.ceil(Math.max.apply(Math, textHeights)) + 10);
      values.forEach(function (value, index) {
        doc.rect(colX[index], currentY, colW[index], rowHeight).stroke('#c6d6e7');
        doc.font('Helvetica').fontSize(8.5).fillColor('#10213b').text(value, colX[index] + 4, currentY + 5, { width: colW[index] - 8, align: index >= 2 ? 'center' : 'left', lineGap: 1 });
      });
      currentY += rowHeight;
    });

    const bottomY = Math.max(560, currentY + 52);
    const paymentBoxX = 54;
    const paymentBoxWidth = 300;
    const sideBoxX = 364;
    const sideBoxWidth = 161;
    const totalBoxHeight = 76;
    const signatureBoxY = bottomY + totalBoxHeight + 10;
    const signatureBoxHeight = 92;

    doc.rect(paymentBoxX, bottomY, paymentBoxWidth, 126).stroke('#435774');
    doc.rect(paymentBoxX, bottomY, paymentBoxWidth, 20).fillAndStroke('#bfdbe9', '#435774');
    doc.fillColor('#10213b').font('Helvetica-Bold').fontSize(10).text('Conditions de paiement', paymentBoxX, bottomY + 6, { width: paymentBoxWidth, align: 'center' });
    doc.font('Helvetica').fontSize(8.1).text('Methodes de paiement acceptees :\\n\\nCheque, Virement, Espece, CB\\n\\nVIREMENT BANCAIRE\\nBanque : CA Nord de France\\nIBAN : FR76 1670 6000 5154 0091 5025 361\\nBIC : AGRIFRPP867\\nTitulaire du compte : BAUDELOT Guillaume\\n\\nEn cas de retard de paiement, une indemnite forfaitaire de 40 EUR pourra etre appliquee', paymentBoxX + 16, bottomY + 30, { width: paymentBoxWidth - 32, align: 'center', lineGap: 1.5 });

    doc.rect(sideBoxX, bottomY, sideBoxWidth, totalBoxHeight).stroke('#435774');
    doc.rect(sideBoxX, bottomY, sideBoxWidth, 20).fillAndStroke('#bfdbe9', '#435774');
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#10213b').text('TOTAL TTC', sideBoxX, bottomY + 6, { width: sideBoxWidth, align: 'center' });
    doc.font('Helvetica-Bold').fontSize(18).text(formatInvoiceMoney(quote.total), sideBoxX, bottomY + 34, { width: sideBoxWidth, align: 'center' });
    doc.font('Helvetica').fontSize(7.8).text(quote.vatRate > 0 ? ('TVA ' + quote.vatRate + ' % appliquee') : quote.vatMention, sideBoxX + 10, bottomY + 58, { width: sideBoxWidth - 20, align: 'center' });

    doc.rect(sideBoxX, signatureBoxY, sideBoxWidth, signatureBoxHeight).stroke('#435774');
    doc.rect(sideBoxX, signatureBoxY, sideBoxWidth, 20).fillAndStroke('#bfdbe9', '#435774');
    doc.font('Helvetica-Bold').fontSize(7.6).fillColor('#10213b').text('Mention Bon pour accord + Signature', sideBoxX + 8, signatureBoxY + 5, { width: sideBoxWidth - 16, align: 'center' });
    doc.font('Helvetica').fontSize(10).text('Date ___ / ___ / ______', sideBoxX + 12, signatureBoxY + signatureBoxHeight - 24, { width: sideBoxWidth - 24 });

    const footerY = Math.min(768, signatureBoxY + signatureBoxHeight + 18);
    doc.moveTo(54, footerY).lineTo(525, footerY).stroke('#c2d4e8');
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#3867b3').text('www.multipixels.fr', 54, footerY + 8, { width: 471, align: 'center' });
    doc.end();
  });
}

function handleAdminQuoteNextReferenceApi(req, res, requestUrl) {
  const session = requireAuthenticatedAdmin(req, res);
  if (!session) return;

  const issueDate = cleanInvoiceField(requestUrl.searchParams.get('issueDate'), 20) || new Date().toISOString().slice(0, 10);
  const documentId = cleanInvoiceField(requestUrl.searchParams.get('id'), 120);
  const currentReference = cleanInvoiceField(requestUrl.searchParams.get('current'), 80);
  sendJson(res, 200, { ok: true, reference: getNextQuoteReference(issueDate, documentId, currentReference) });
}

async function handleAdminQuotePdfApi(req, res) {
  const session = requireAuthenticatedAdmin(req, res);
  if (!session) return;

  let body;
  try {
    body = await parseJsonBody(req, 1024 * 1024);
  } catch (_) {
    sendJson(res, 400, { ok: false, error: { code: 'INVALID_JSON', message: 'RequÃƒÆ’Ã‚Âªte invalide.' } });
    return;
  }

  const items = normalizeInvoiceItems(body.items);
  const customerName = cleanInvoiceField(body.customerName, 140);
  if (!customerName || !items.length) {
    sendJson(res, 400, { ok: false, error: { code: 'ADMIN_QUOTE_INVALID', message: 'Nom client et au moins une ligne sont obligatoires.' } });
    return;
  }

  const store = readAdminDocumentsStore();
  const existingQuote = (store.quotes || []).find((entry) => String(entry.id) === String(cleanInvoiceField(body.id, 120))) || null;
  const officialReference = existingQuote ? existingQuote.reference : getNextQuoteReference(body.issueDate, existingQuote && existingQuote.id);
  const quote = buildQuoteRecord(existingQuote, Object.assign({}, body, { items: items, customerName: customerName }), officialReference);

  let pdfBuffer;
  try {
    pdfBuffer = await buildQuotePdfBuffer(quote);
  } catch (error) {
    const detail = error && error.message ? String(error.message) : 'GÃƒÆ’Ã‚Â©nÃƒÆ’Ã‚Â©ration PDF impossible.';
    sendJson(res, 500, { ok: false, error: { code: 'ADMIN_QUOTE_PDF_FAILED', message: 'Impossible de gÃƒÆ’Ã‚Â©nÃƒÆ’Ã‚Â©rer le PDF du devis. ' + detail } });
    return;
  }

  saveQuoteRecord(quote);
  const filename = buildQuoteAttachmentName(quote);
  const nextReference = getNextQuoteReference(quote.issueDate);
  res.writeHead(200, {
    'Content-Type': 'application/pdf',
    'Content-Disposition': 'attachment; filename="' + filename + '"',
    'Content-Length': pdfBuffer.length,
    'Cache-Control': 'no-store',
    'X-Quote-Filename': filename,
    'X-Quote-Reference': quote.reference,
    'X-Next-Quote-Reference': nextReference
  });
  res.end(pdfBuffer);
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
    sendJson(res, 409, { ok: false, error: { code: 'EMAIL_EXISTS', message: 'Un compte existe d?j? avec cette adresse email.' } });
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
    sendJson(res, 400, { ok: false, error: { code: 'INVALID_TICKET', message: 'Merci de pr?ciser un sujet et votre demande SAV.' } });
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
    sendJson(res, 200, { ok: true, message: 'Si un compte existe, un email de r?initialisation sera envoy?.' });
    return;
  }

  const reset = clientDb.createPasswordReset(user.id);
  const resetUrl = CLIENT_APP_BASE_URL.replace(/\/$/, '') + '/reinitialiser-mot-de-passe.html?token=' + encodeURIComponent(reset.token);
  try {
    await sendClientEmail({
      to: user.email,
      subject: 'RÃƒÆ’Ã‚Â©initialisation de votre mot de passe MULTIPIXELS',
      text: 'Bonjour,\n\nVoici votre lien de r?initialisation : ' + resetUrl + '\n\nCe lien expire dans 30 minutes.',
      html: '<p>Bonjour,</p><p>Voici votre lien de r?initialisation :</p><p><a href="' + resetUrl + '">' + resetUrl + '</a></p><p>Ce lien expire dans 30 minutes.</p>'
    });
    sendJson(res, 200, { ok: true, message: 'Si un compte existe, un email de r?initialisation sera envoy?.' });
  } catch (_) {
    sendJson(res, 200, { ok: true, message: 'Lien de r?initialisation g?n?r?.', resetUrl });
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
    sendJson(res, 400, { ok: false, error: { code: 'RESET_TOKEN_INVALID', message: 'Le lien de r?initialisation est invalide ou expire.' } });
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
    sendJson(res, 400, { ok: false, error: { code: 'INVALID_JSON', message: 'RequÃƒÆ’Ã‚Âªte invalide.' } });
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
    sendJson(res, 400, { ok: false, error: { code: 'INVALID_JSON', message: 'RequÃƒÆ’Ã‚Âªte invalide.' } });
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
    sendJson(res, 400, { ok: false, error: { code: 'INVALID_JSON', message: 'RequÃƒÆ’Ã‚Âªte invalide.' } });
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
    sendJson(res, 400, { ok: false, error: { code: 'INVALID_JSON', message: 'RequÃƒÆ’Ã‚Âªte invalide.' } });
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
    sendJson(res, 400, { ok: false, error: { code: 'INVALID_JSON', message: 'RequÃƒÆ’Ã‚Âªte invalide.' } });
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
    sendJson(res, 400, { ok: false, error: { code: 'INVALID_JSON', message: 'RequÃƒÆ’Ã‚Âªte invalide.' } });
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
    sendJson(res, 400, { ok: false, error: { code: 'INVALID_JSON', message: 'RequÃƒÆ’Ã‚Âªte invalide.' } });
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
    sendJson(res, 400, { ok: false, error: { code: 'INVALID_JSON', message: 'RequÃƒÆ’Ã‚Âªte invalide.' } });
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
    sendJson(res, 400, { ok: false, error: { code: 'INVALID_JSON', message: 'RequÃƒÆ’Ã‚Âªte invalide.' } });
    return;
  }
  if (!sanitizeLine(body.reference, 80) || !sanitizeLine(body.designation, 260)) {
    sendJson(res, 400, { ok: false, error: { code: 'INVOICE_REFERENCE_INVALID', message: 'La rÃƒÆ’Ã‚Â©fÃƒÆ’Ã‚Â©rence et la dÃƒÆ’Ã‚Â©signation sont obligatoires.' } });
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
    sendJson(res, 400, { ok: false, error: { code: 'INVOICE_REFERENCE_ID_MISSING', message: 'RÃƒÆ’Ã‚Â©fÃƒÆ’Ã‚Â©rence introuvable.' } });
    return;
  }
  const deleted = adminTools.deleteInvoiceReference(referenceId);
  if (!deleted) {
    sendJson(res, 404, { ok: false, error: { code: 'INVOICE_REFERENCE_NOT_FOUND', message: 'RÃƒÆ’Ã‚Â©fÃƒÆ’Ã‚Â©rence introuvable.' } });
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
    sendJson(res, 400, { ok: false, error: { code: 'INVALID_JSON', message: 'RequÃƒÆ’Ã‚Âªte invalide.' } });
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
    sendJson(res, 400, { ok: false, error: { code: 'INVALID_JSON', message: 'RequÃƒÆ’Ã‚Âªte invalide.' } });
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


  if (req.method === 'GET' && requestUrl.pathname === '/api/admin/quotes/next-reference') {
    handleAdminQuoteNextReferenceApi(req, res, requestUrl);
    return;
  }

  if (req.method === 'POST' && requestUrl.pathname === '/api/admin/quotes/pdf') {
    await handleAdminQuotePdfApi(req, res);
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

    if (req.method === 'POST' && requestUrl.pathname === '/api/admin/invoices/pdf') {
      await handleAdminInvoicePdfApi(req, res);
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

startGoogleReviewsAutoRefresh();

server.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});







