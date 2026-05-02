import express from "express";
import { createServer } from "node:http";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import QRCode from "qrcode";
import { Server } from "socket.io";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "responses.json");
const PUBLIC_DIR = path.join(__dirname, "public");
const MAX_VISIBLE_WORDS = 400;
const MAX_RECENT_ENTRIES = 250;

const app = express();
const server = createServer(app);
const io = new Server(server, {
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000,
    skipMiddlewares: true
  }
});

let entries = [];
let locked = false;
let saveQueue = Promise.resolve();
const configCache = new Map();

const demoWords = [
  "libertate", "pace", "Erasmus", "solidaritate", "Europa", "viitor",
  "drepturi", "Schengen", "unitate", "diversitate", "oportunitati",
  "calatorii", "educatie", "democratie", "cooperare", "siguranta",
  "cultura", "moneda euro", "comunitate", "identitate", "speranta",
  "responsabilitate", "alegeri", "dialog", "inovatie", "mobilitate",
  "granite deschise", "respect", "clima", "tineri", "sanatate",
  "voluntariat", "cetatenie", "sprijin", "reguli", "birocratie"
];

await initData();

app.use(express.json({ limit: "1mb" }));
app.use(express.static(PUBLIC_DIR, {
  etag: true,
  maxAge: 0
}));

app.get("/", (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.get("/join", (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "join.html"));
});

app.get("/admin", (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "admin.html"));
});

app.get("/api/config", async (req, res) => {
  res.json(await getConfig(req));
});

app.get("/api/export.json", (_req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=fsgc-wordcloud-responses.json");
  res.send(JSON.stringify(entries, null, 2));
});

app.get("/api/export.csv", (_req, res) => {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=fsgc-wordcloud-responses.csv");
  res.send(toCsv(entries));
});

app.post("/api/submit", async (req, res) => {
  if (locked) {
    res.status(423).json({ ok: false, message: "Momentan colectarea este pauzata." });
    return;
  }

  const result = await addSubmission(req.body?.text);
  res.status(result.ok ? 201 : 400).json(result);
});

io.on("connection", async (socket) => {
  socket.emit("config", await getConfig(socket));
  socket.emit("snapshot", makeSnapshot());

  socket.on("submit-word", async (payload, ack) => {
    const reply = typeof ack === "function" ? ack : () => {};
    if (locked) {
      reply({ ok: false, message: "Momentan colectarea este pauzata." });
      return;
    }

    const result = await addSubmission(payload?.text ?? payload);
    reply(result.ok ? { ok: true, message: result.message } : result);
  });

  socket.on("admin-lock", async (value, ack) => {
    locked = Boolean(value);
    io.emit("snapshot", makeSnapshot());
    if (typeof ack === "function") ack({ ok: true, locked });
  });

  socket.on("admin-delete", async (id, ack) => {
    const before = entries.length;
    entries = entries.filter((entry) => entry.id !== id);
    if (entries.length !== before) await persistEntries();
    io.emit("snapshot", makeSnapshot());
    if (typeof ack === "function") ack({ ok: true });
  });

  socket.on("admin-clear", async (_payload, ack) => {
    entries = [];
    await persistEntries();
    io.emit("snapshot", makeSnapshot());
    if (typeof ack === "function") ack({ ok: true });
  });

  socket.on("admin-seed-demo", async (_payload, ack) => {
    const now = Date.now();
    const seeded = demoWords.flatMap((word, index) => {
      const repeat = index < 8 ? 5 - Math.floor(index / 2) : index < 18 ? 2 : 1;
      return Array.from({ length: repeat }, (_, repeatIndex) => {
        const normalized = normalizeSubmission(word).normalized;
        return {
          id: randomUUID(),
          word,
          normalized,
          raw: word,
          createdAt: new Date(now + index * 100 + repeatIndex).toISOString()
        };
      });
    });
    entries.push(...seeded);
    await persistEntries();
    io.emit("snapshot", makeSnapshot());
    if (typeof ack === "function") ack({ ok: true, added: seeded.length });
  });
});

server.listen(PORT, "0.0.0.0", async () => {
  const localNetworkUrl = getLocalNetworkUrl();
  console.log(`FSGC Word Cloud live on http://localhost:${PORT}/`);
  console.log(`Participant link: http://localhost:${PORT}/join`);
  if (localNetworkUrl) console.log(`Local network: ${localNetworkUrl}`);
});

async function addSubmission(value) {
  const result = normalizeSubmission(value);
  if (!result.ok) return result;

  const entry = {
    id: randomUUID(),
    word: result.word,
    normalized: result.normalized,
    raw: result.raw,
    createdAt: new Date().toISOString()
  };

  entries.push(entry);
  await persistEntries();
  const snapshot = makeSnapshot();

  io.emit("word-added", {
    id: entry.id,
    word: entry.word,
    normalized: entry.normalized,
    count: snapshot.counts.find((item) => item.normalized === entry.normalized)?.count || 1,
    total: snapshot.total
  });
  io.emit("snapshot", snapshot);

  return {
    ok: true,
    message: `"${entry.word}" a intrat in cloud.`,
    entry,
    total: snapshot.total,
    unique: snapshot.unique
  };
}

async function initData() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    const raw = await fs.readFile(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw);
    entries = Array.isArray(parsed)
      ? parsed.filter((entry) => entry && entry.word && entry.normalized && entry.createdAt)
      : [];
  } catch (error) {
    if (error.code !== "ENOENT") console.warn("Could not read stored responses:", error.message);
    entries = [];
    await persistEntries();
  }
}

function persistEntries() {
  const payload = JSON.stringify(entries, null, 2);
  const tempFile = `${DATA_FILE}.tmp`;
  saveQueue = saveQueue
    .then(async () => {
      await fs.writeFile(tempFile, payload, "utf8");
      await fs.rename(tempFile, DATA_FILE);
    })
    .catch((error) => {
      console.error("Could not persist responses:", error);
    });
  return saveQueue;
}

function makeSnapshot() {
  const counts = getCounts();
  return {
    total: entries.length,
    unique: counts.length,
    visibleLimit: MAX_VISIBLE_WORDS,
    counts: counts.slice(0, MAX_VISIBLE_WORDS),
    recent: entries.slice(-MAX_RECENT_ENTRIES).reverse(),
    locked,
    clients: io.engine.clientsCount,
    updatedAt: new Date().toISOString()
  };
}

function getCounts() {
  const map = new Map();

  for (const entry of entries) {
    const current = map.get(entry.normalized) || {
      word: entry.word,
      normalized: entry.normalized,
      count: 0,
      latest: entry.createdAt,
      variants: new Map()
    };
    current.count += 1;
    current.latest = entry.createdAt;
    current.variants.set(entry.word, (current.variants.get(entry.word) || 0) + 1);
    current.word = chooseDisplayVariant(current.variants);
    map.set(entry.normalized, current);
  }

  return [...map.values()]
    .map(({ variants, ...item }) => item)
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word, "ro"));
}

function chooseDisplayVariant(variants) {
  return [...variants.entries()]
    .sort((a, b) => b[1] - a[1] || scoreRomanianDisplay(b[0]) - scoreRomanianDisplay(a[0]) || a[0].localeCompare(b[0], "ro"))[0][0];
}

function scoreRomanianDisplay(value) {
  return (value.match(/[ăâîșțĂÂÎȘȚ]/g) || []).length;
}

function normalizeSubmission(value) {
  const raw = String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!raw) return { ok: false, message: "Scrie un cuvant sau o expresie scurta." };

  const word = raw
    .slice(0, 48)
    .replace(/[“”„"'`]/g, "")
    .replace(/[!?.,;:()[\]{}<>/\\|+=*_~^%$#@]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("ro");

  if (word.length < 2) return { ok: false, message: "Raspunsul trebuie sa aiba minimum 2 caractere." };
  if ([...word].length > 36) return { ok: false, message: "Pastreaza raspunsul sub 36 de caractere." };

  const normalized = word
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("ro");

  if (normalized.length < 2) return { ok: false, message: "Raspunsul nu poate contine doar simboluri." };

  return { ok: true, raw, word, normalized };
}

async function getConfig(context) {
  const localNetworkUrl = getLocalNetworkUrl();
  const baseUrl = resolvePublicBaseUrl(context, localNetworkUrl);
  if (configCache.has(baseUrl)) return configCache.get(baseUrl);

  const joinUrl = `${baseUrl}/join`;
  const presenterUrl = `${baseUrl}/`;
  const adminUrl = `${baseUrl}/admin`;
  const qrDataUrl = await QRCode.toDataURL(joinUrl, {
    margin: 1,
    width: 720,
    color: {
      dark: "#003399",
      light: "#ffffff"
    }
  });

  const config = {
    port: PORT,
    joinUrl,
    presenterUrl,
    adminUrl,
    localNetworkUrl,
    localhostUrl: `http://localhost:${PORT}`
  };

  config.qrDataUrl = qrDataUrl;
  configCache.set(baseUrl, config);
  return config;
}

function resolvePublicBaseUrl(context, localNetworkUrl) {
  if (process.env.PUBLIC_URL) return cleanBaseUrl(process.env.PUBLIC_URL);

  const headers = context?.headers || context?.handshake?.headers || {};
  const host = typeof context?.get === "function"
    ? context.get("host")
    : headers.host;
  const forwardedProto = String(headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const protocol = forwardedProto || context?.protocol || (context?.handshake?.secure ? "https" : "http");

  if (!host) return localNetworkUrl || `http://localhost:${PORT}`;
  if (isLoopbackHost(host) && localNetworkUrl) return localNetworkUrl;
  return cleanBaseUrl(`${protocol}://${host}`);
}

function cleanBaseUrl(value) {
  return String(value || "").replace(/\/+$/, "");
}

function isLoopbackHost(host) {
  const hostname = String(host).split(":")[0].toLowerCase();
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function getLocalNetworkUrl() {
  const interfaces = os.networkInterfaces();
  for (const details of Object.values(interfaces)) {
    for (const detail of details || []) {
      if (detail.family === "IPv4" && !detail.internal) {
        return `http://${detail.address}:${PORT}`;
      }
    }
  }
  return "";
}

function toCsv(items) {
  const header = ["index", "word", "normalized", "raw", "createdAt"].join(",");
  const rows = items.map((entry, index) => [
    index + 1,
    csvCell(entry.word),
    csvCell(entry.normalized),
    csvCell(entry.raw || entry.word),
    csvCell(entry.createdAt)
  ].join(","));
  return `${header}\n${rows.join("\n")}`;
}

function csvCell(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}
