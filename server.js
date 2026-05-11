const express = require("express");
const path = require("path");
const stocks = require("./data/stocks");
const { fetchQuote, getApiKey } = require("./lib/twelve-data");
const {
  readStocksCache,
  writeStocksCache
} = require("./lib/stocks-cache");

const app = express();
const port = process.env.PORT || 3000;
const publicDir = path.join(__dirname, "public");
const cacheTtlMs = Number(process.env.STOCKS_CACHE_TTL_MINUTES || 15) * 60 * 1000;
const refreshBatchSize = Number(process.env.TWELVE_DATA_BATCH_SIZE || 8);
const refreshCooldownMs = Number(process.env.TWELVE_DATA_COOLDOWN_SECONDS || 65) * 1000;

const runtime = {
  refreshPromise: null
};

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

function countLoadedCompanies(companies) {
  return companies.filter((company) => (
    typeof company.currentPrice === "number" &&
    typeof company.week52Low === "number" &&
    typeof company.week52High === "number" &&
    company.week52High > company.week52Low
  )).length;
}

function sortCompaniesForRefresh(companies, nowMs) {
  return companies
    .map((company, index) => ({ company, index }))
    .sort((left, right) => {
      const leftLoaded = Number.isFinite(left.company.currentPrice);
      const rightLoaded = Number.isFinite(right.company.currentPrice);

      if (leftLoaded !== rightLoaded) {
        return leftLoaded ? 1 : -1;
      }

      const leftUpdatedAt = Date.parse(left.company.quoteUpdatedAt || "");
      const rightUpdatedAt = Date.parse(right.company.quoteUpdatedAt || "");
      const leftAge = Number.isFinite(leftUpdatedAt) ? nowMs - leftUpdatedAt : Number.MAX_SAFE_INTEGER;
      const rightAge = Number.isFinite(rightUpdatedAt) ? nowMs - rightUpdatedAt : Number.MAX_SAFE_INTEGER;

      if (leftAge !== rightAge) {
        return rightAge - leftAge;
      }

      return left.index - right.index;
    });
}

function buildPayload(cachePayload) {
  const loadedCount = countLoadedCompanies(cachePayload.companies);
  const marketDate = cachePayload.companies.reduce((latest, company) => (
    company.marketDate && (!latest || company.marketDate > latest) ? company.marketDate : latest
  ), null);

  return {
    updatedAt: cachePayload.updatedAt,
    updatedLabel: cachePayload.updatedLabel,
    marketDate,
    loadedCount,
    totalCount: cachePayload.companies.length,
    warning: cachePayload.warning,
    companies: cachePayload.companies
  };
}

async function refreshCache({ forceRefresh = false } = {}) {
  if (!getApiKey()) {
    const error = new Error("Missing TWELVE_DATA_API_KEY environment variable.");
    error.statusCode = 500;
    throw error;
  }

  const nowMs = Date.now();
  const cachePayload = await readStocksCache(stocks);
  const lastUpdatedAtMs = Date.parse(cachePayload.updatedAt || "");
  const lastAttemptAtMs = Date.parse(cachePayload.lastAttemptAt || "");
  const isStale = !Number.isFinite(lastUpdatedAtMs) || (nowMs - lastUpdatedAtMs) >= cacheTtlMs;
  const needsWarmup = countLoadedCompanies(cachePayload.companies) < stocks.length;
  const inCooldown = Number.isFinite(lastAttemptAtMs) && (nowMs - lastAttemptAtMs) < refreshCooldownMs;

  if (!forceRefresh && inCooldown) {
    return buildPayload(cachePayload);
  }

  if (!forceRefresh && !isStale && !cachePayload.warning && !needsWarmup) {
    return buildPayload(cachePayload);
  }

  const rankedCompanies = sortCompaniesForRefresh(cachePayload.companies, nowMs);
  const companiesToRefresh = rankedCompanies
    .slice(0, Math.max(1, Math.min(refreshBatchSize, stocks.length)))
    .map(({ company }) => company);

  const companiesBySymbol = new Map(cachePayload.companies.map((company) => [company.symbol, company]));
  const successfulSymbols = [];

  try {
    for (const company of companiesToRefresh) {
      const quote = await fetchQuote(company, getApiKey());
      successfulSymbols.push(company.symbol);
      companiesBySymbol.set(company.symbol, {
        ...companiesBySymbol.get(company.symbol),
        ...quote,
        quoteUpdatedAt: new Date().toISOString()
      });
    }

    const nextPayload = {
      ...cachePayload,
      updatedAt: new Date().toISOString(),
      updatedLabel: formatTimestamp(new Date()),
      lastAttemptAt: new Date().toISOString(),
      warning: null,
      companies: stocks.map((stock) => companiesBySymbol.get(stock.symbol))
    };

    await writeStocksCache(nextPayload);
    return buildPayload(nextPayload);
  } catch (error) {
    const warning = successfulSymbols.length
      ? `Partial refresh completed before Twelve Data stopped the request: ${error.message}`
      : error.message;

    const fallbackPayload = {
      ...cachePayload,
      updatedAt: cachePayload.updatedAt || new Date().toISOString(),
      updatedLabel: cachePayload.updatedLabel || formatTimestamp(new Date()),
      lastAttemptAt: new Date().toISOString(),
      warning,
      companies: stocks.map((stock) => companiesBySymbol.get(stock.symbol))
    };

    await writeStocksCache(fallbackPayload);
    return buildPayload(fallbackPayload);
  }
}

async function getStocksPayload(options = {}) {
  if (runtime.refreshPromise) {
    return runtime.refreshPromise;
  }

  runtime.refreshPromise = refreshCache(options);

  try {
    return await runtime.refreshPromise;
  } finally {
    runtime.refreshPromise = null;
  }
}

app.use(express.static(publicDir));

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/stocks", async (req, res) => {
  try {
    const payload = await getStocksPayload({
      forceRefresh: req.query.refresh === "true"
    });
    res.json(payload);
  } catch (error) {
    console.error("Failed to load stock data:", error);
    res.status(error.statusCode || 502).json({
      error: error.message || "Unable to load stock data right now."
    });
  }
});

app.get("/", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

app.listen(port, () => {
  console.log(`Stock slider app listening on port ${port}`);
});
