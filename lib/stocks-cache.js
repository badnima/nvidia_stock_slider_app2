const fs = require("fs/promises");
const path = require("path");

const cacheFile = path.join(__dirname, "..", "data", "stocks-cache.json");

function createEmptyCompany(stock) {
  return {
    name: stock.name,
    symbol: stock.symbol,
    currentPrice: null,
    week52Low: null,
    week52High: null,
    marketDate: null,
    quoteUpdatedAt: null
  };
}

function createEmptyPayload(stocks) {
  return {
    updatedAt: null,
    updatedLabel: null,
    marketDate: null,
    lastAttemptAt: null,
    refreshCursor: 0,
    warning: null,
    companies: stocks.map(createEmptyCompany)
  };
}

function normalizePayload(payload, stocks) {
  const companiesBySymbol = new Map(
    (Array.isArray(payload?.companies) ? payload.companies : []).map((company) => [company.symbol, company])
  );

  return {
    updatedAt: payload?.updatedAt || null,
    updatedLabel: payload?.updatedLabel || null,
    marketDate: payload?.marketDate || null,
    lastAttemptAt: payload?.lastAttemptAt || null,
    refreshCursor: Number.isInteger(payload?.refreshCursor) ? payload.refreshCursor : 0,
    warning: payload?.warning || null,
    companies: stocks.map((stock) => ({
      ...createEmptyCompany(stock),
      ...companiesBySymbol.get(stock.symbol)
    }))
  };
}

async function readStocksCache(stocks) {
  try {
    const fileContents = await fs.readFile(cacheFile, "utf8");
    return normalizePayload(JSON.parse(fileContents), stocks);
  } catch (error) {
    if (error.code === "ENOENT") {
      return createEmptyPayload(stocks);
    }

    throw error;
  }
}

async function writeStocksCache(payload) {
  await fs.writeFile(cacheFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

module.exports = {
  createEmptyPayload,
  normalizePayload,
  readStocksCache,
  writeStocksCache
};
