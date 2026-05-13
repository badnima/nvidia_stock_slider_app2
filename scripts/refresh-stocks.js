const fs = require("fs/promises");
const path = require("path");
const stocks = require("../data/stocks");

const OUTPUT_FILE = path.join(__dirname, "..", "public", "stocks-data.json");

function formatApiDate(date) {
  return date.toISOString().slice(0, 10);
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

function mapHistory(stock, historyRows) {
  const normalizedRows = historyRows.map((row) => {
    const value = typeof row?.close === "number" ? row.close : row?.price;
    return {
      date: row?.date,
      value: typeof value === "number" ? value : null
    };
  }).filter((row) => row.date && typeof row.value === "number");

  if (!normalizedRows.length) {
    return {
      name: stock.name,
      symbol: stock.symbol,
      currentPrice: null,
      week52Low: null,
      week52High: null,
      marketDate: null
    };
  }

  const latestRow = normalizedRows.reduce((latest, row) => (
    row.date > latest.date ? row : latest
  ));

  return {
    name: stock.name,
    symbol: stock.symbol,
    currentPrice: latestRow.value,
    week52Low: Math.min(...normalizedRows.map((row) => row.value)),
    week52High: Math.max(...normalizedRows.map((row) => row.value)),
    marketDate: latestRow.date
  };
}

async function fetchSymbolHistory(stock, apiKey, from, to) {
  const url = `https://financialmodelingprep.com/stable/historical-price-eod/light?symbol=${encodeURIComponent(stock.symbol)}&from=${from}&to=${to}&apikey=${encodeURIComponent(apiKey)}`;
  const response = await fetch(url, {
    headers: {
      "user-agent": "nvidia-stock-slider-app/1.0"
    }
  });

  if (!response.ok) {
    const responseText = await response.text();
    const detail = responseText ? ` ${responseText.slice(0, 200)}` : "";
    throw new Error(`Historical price provider returned ${response.status} for ${stock.symbol}.${detail}`);
  }

  const payload = await response.json();
  const historyRows = Array.isArray(payload) ? payload : (
    Array.isArray(payload?.historical) ? payload.historical : []
  );

  return mapHistory(stock, historyRows);
}

async function main() {
  const apiKey = process.env.FMP_API_KEY;

  if (!apiKey) {
    throw new Error("Missing FMP_API_KEY environment variable.");
  }

  const toDate = new Date();
  const fromDate = new Date(toDate);
  fromDate.setUTCDate(fromDate.getUTCDate() - 370);
  const from = formatApiDate(fromDate);
  const to = formatApiDate(toDate);

  const companies = [];

  for (const stock of stocks) {
    const company = await fetchSymbolHistory(stock, apiKey, from, to);
    companies.push(company);
  }

  const marketDate = companies.reduce((latest, company) => (
    company.marketDate && (!latest || company.marketDate > latest) ? company.marketDate : latest
  ), null);

  const payload = {
    updatedAt: formatTimestamp(new Date()),
    marketDate,
    companies
  };

  await fs.writeFile(OUTPUT_FILE, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`Wrote ${OUTPUT_FILE}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
