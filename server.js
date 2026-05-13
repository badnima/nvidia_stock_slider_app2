const fs = require("fs/promises");
const express = require("express");
const path = require("path");

const stocks = require("./data/stocks");
const { createEmptyPayload, normalizePayload, readStocksCache, writeStocksCache } = require("./lib/stocks-cache");
const { fetchQuote, getApiKey } = require("./lib/twelve-data");

const app = express();
const port = process.env.PORT || 3000;
const publicDir = path.join(__dirname, "public");
const snapshotFile = path.join(publicDir, "stocks-data.json");

const usageCache = {
  payload: null,
  expiresAt: 0
};

let refreshInFlight = null;

const USAGE_CACHE_TTL_MS = 60 * 60 * 1000;
const STOCKS_CACHE_TTL_MS = parsePositiveInt(process.env.STOCKS_CACHE_TTL_MINUTES, 15) * 60 * 1000;
const TWELVE_DATA_BATCH_SIZE = clamp(parsePositiveInt(process.env.TWELVE_DATA_BATCH_SIZE, 8), 1, 8);
const TWELVE_DATA_CONCURRENCY = clamp(parsePositiveInt(process.env.TWELVE_DATA_CONCURRENCY, 5), 1, 8);
const TWELVE_DATA_COOLDOWN_MS = parsePositiveInt(process.env.TWELVE_DATA_COOLDOWN_SECONDS, 65) * 1000;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function formatTimestamp(date) {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Los_Angeles",
    timeZoneName: "short"
  }).format(date);
}

function isPopulatedCompany(company) {
  return (
    typeof company?.currentPrice === "number" &&
    typeof company?.week52Low === "number" &&
    typeof company?.week52High === "number"
  );
}

function isPopulatedPayload(payload) {
  return Array.isArray(payload?.companies) && payload.companies.some(isPopulatedCompany);
}

function getMarketDate(companies) {
  return companies.reduce((latest, company) => (
    company.marketDate && (!latest || company.marketDate > latest) ? company.marketDate : latest
  ), null);
}

function getBatch(stocksList, startIndex, batchSize) {
  if (!stocksList.length) {
    return [];
  }

  const batch = [];
  for (let offset = 0; offset < batchSize; offset += 1) {
    batch.push(stocksList[(startIndex + offset) % stocksList.length]);
  }
  return batch;
}

async function readSnapshotFallback() {
  try {
    const contents = await fs.readFile(snapshotFile, "utf8");
    const payload = JSON.parse(contents);
    const normalized = normalizePayload(payload, stocks);
    normalized.updatedLabel = payload?.updatedAt || normalized.updatedLabel;
    normalized.updatedAt = payload?.updatedAt || normalized.updatedAt;
    normalized.warning = normalized.warning || "Showing cached snapshot data until live quotes refresh.";
    return normalized;
  } catch {
    return createEmptyPayload(stocks);
  }
}

async function loadCurrentPayload() {
  const cachePayload = await readStocksCache(stocks);
  if (isPopulatedPayload(cachePayload)) {
    return cachePayload;
  }

  return readSnapshotFallback();
}

async function runWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let index = 0;

  async function runWorker() {
    while (index < items.length) {
      const currentIndex = index;
      index += 1;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => runWorker());
  await Promise.all(workers);
  return results;
}

async function refreshQuotes({ force = false } = {}) {
  if (refreshInFlight) {
    return refreshInFlight;
  }

  refreshInFlight = (async () => {
    const payload = await loadCurrentPayload();
    const now = new Date();
    const nowMs = now.getTime();
    const apiKey = getApiKey();

    if (!apiKey) {
      payload.warning = "Missing Twelve Data API key. Showing cached data.";
      return payload;
    }

    const lastAttemptMs = payload.lastAttemptAt ? Date.parse(payload.lastAttemptAt) : 0;
    const lastUpdatedMs = payload.updatedAt ? Date.parse(payload.updatedAt) : 0;
    const hasFreshEnoughCache = lastAttemptMs && lastUpdatedMs && (nowMs - lastUpdatedMs) < STOCKS_CACHE_TTL_MS;
    const inCooldownWindow = lastAttemptMs && (nowMs - lastAttemptMs) < TWELVE_DATA_COOLDOWN_MS;

    if (!force && hasFreshEnoughCache) {
      return payload;
    }

    if (inCooldownWindow) {
      payload.warning = `Rate limit cooldown active. Try again in ${Math.ceil((TWELVE_DATA_COOLDOWN_MS - (nowMs - lastAttemptMs)) / 1000)}s.`;
      return payload;
    }

    const batch = getBatch(stocks, payload.refreshCursor || 0, TWELVE_DATA_BATCH_SIZE);
    const companyBySymbol = new Map(payload.companies.map((company) => [company.symbol, company]));

    try {
      const quotes = await runWithConcurrency(batch, TWELVE_DATA_CONCURRENCY, (stock) => fetchQuote(stock, apiKey));

      for (const quote of quotes) {
        const existing = companyBySymbol.get(quote.symbol) || { name: quote.name, symbol: quote.symbol };
        companyBySymbol.set(quote.symbol, {
          ...existing,
          ...quote,
          quoteUpdatedAt: formatTimestamp(now)
        });
      }

      payload.companies = stocks.map((stock) => companyBySymbol.get(stock.symbol) || {
        name: stock.name,
        symbol: stock.symbol,
        currentPrice: null,
        week52Low: null,
        week52High: null,
        marketDate: null,
        quoteUpdatedAt: null
      });
      payload.refreshCursor = (payload.refreshCursor + batch.length) % stocks.length;
      payload.marketDate = getMarketDate(payload.companies);
      payload.lastAttemptAt = now.toISOString();
      payload.updatedAt = now.toISOString();
      payload.updatedLabel = formatTimestamp(now);
      payload.warning = payload.companies.some((company) => !isPopulatedCompany(company))
        ? "Rolling live cache in progress. Some symbols may still be using older values."
        : null;

      await writeStocksCache(payload);
      return payload;
    } catch (error) {
      payload.lastAttemptAt = now.toISOString();
      payload.warning = String(error.message || error);
      await writeStocksCache(payload);
      return payload;
    }
  })();

  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

function serializePayload(payload) {
  return {
    updatedAt: payload.updatedLabel || payload.updatedAt || null,
    updatedIso: payload.updatedAt || null,
    marketDate: payload.marketDate || null,
    lastAttemptAt: payload.lastAttemptAt || null,
    refreshCursor: payload.refreshCursor || 0,
    warning: payload.warning || null,
    companies: payload.companies
  };
}

async function getUsagePayload() {
  const now = Date.now();

  if (usageCache.payload && usageCache.expiresAt > now) {
    return usageCache.payload;
  }

  const apiKey = getTwelveDataApiKey();
  if (!apiKey) {
    return null;
  }

  const response = await fetch(`https://api.twelvedata.com/api_usage?apikey=${encodeURIComponent(apiKey)}`, {
    headers: {
      "user-agent": "nvidia-stock-slider-app/1.0"
    }
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Twelve Data usage endpoint returned ${response.status}. ${detail.slice(0, 200)}`);
  }

  const payload = await response.json();
  const usedHeader = response.headers.get("api-credits-used");
  const leftHeader = response.headers.get("api-credits-left");
  const used = Number(usedHeader);
  const left = Number(leftHeader);
  const limit = Number.isFinite(used) && Number.isFinite(left) ? used + left : 800;

  const normalized = {
    usedToday: Number.isFinite(used) ? used : null,
    limit,
    leftToday: Number.isFinite(left) ? left : null,
    raw: payload
  };

  usageCache.payload = normalized;
  usageCache.expiresAt = now + USAGE_CACHE_TTL_MS;

  return normalized;
}

function getTwelveDataApiKey() {
  return process.env.TWELVE_DATA_API_KEY || process.env.TWELVEDATA_API_KEY || null;
}

app.use(express.static(publicDir));

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/credits", async (_req, res) => {
  try {
    const payload = await getUsagePayload();
    if (!payload) {
      res.status(204).end();
      return;
    }

    res.set("Cache-Control", "no-store");
    res.json(payload);
  } catch (error) {
    console.error("Failed to load Twelve Data usage:", error);
    res.status(502).json({
      error: "Unable to load API credit usage right now."
    });
  }
});

app.get("/api/stocks", async (req, res) => {
  try {
    const force = req.query.refresh === "true";
    const payload = await refreshQuotes({ force });
    res.set("Cache-Control", "no-store");
    res.json(serializePayload(payload));
  } catch (error) {
    console.error("Failed to load stock quotes:", error);
    res.status(502).json({
      error: "Unable to load stock data right now."
    });
  }
});

app.get("/", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

app.get("/stock_slider.html", (_req, res) => {
  res.sendFile(path.join(publicDir, "stock_slider.html"));
});

app.listen(port, () => {
  console.log(`Stock slider app listening on port ${port}`);
});
