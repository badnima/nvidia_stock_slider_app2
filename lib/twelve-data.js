const apiBaseUrl = "https://api.twelvedata.com";

function getApiKey() {
  return process.env.TWELVE_DATA_API_KEY || null;
}

function parseNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function mapQuote(stock, payload) {
  return {
    name: stock.name,
    symbol: stock.symbol,
    currentPrice: parseNumber(payload?.close),
    week52Low: parseNumber(payload?.fifty_two_week?.low),
    week52High: parseNumber(payload?.fifty_two_week?.high),
    marketDate: typeof payload?.datetime === "string" ? payload.datetime.slice(0, 10) : null
  };
}

async function parseJsonResponse(response) {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function fetchQuote(stock, apiKey) {
  const url = new URL("/quote", apiBaseUrl);
  url.searchParams.set("symbol", stock.symbol);
  url.searchParams.set("interval", "1day");
  url.searchParams.set("apikey", apiKey);

  const response = await fetch(url, {
    headers: {
      "user-agent": "nvidia-stock-slider-app/1.0"
    }
  });
  const payload = await parseJsonResponse(response);

  if (!response.ok || payload?.status === "error") {
    const detail = typeof payload === "string"
      ? payload
      : payload?.message || payload?.code || "Unexpected quote response.";
    throw new Error(`Twelve Data quote failed for ${stock.symbol} with ${response.status}: ${String(detail).slice(0, 220)}`);
  }

  return mapQuote(stock, payload);
}

module.exports = {
  fetchQuote,
  getApiKey
};
