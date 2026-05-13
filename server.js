const express = require("express");
const path = require("path");

const app = express();
const port = process.env.PORT || 3000;
const publicDir = path.join(__dirname, "public");
const usageCache = {
  payload: null,
  expiresAt: 0
};

const USAGE_CACHE_TTL_MS = 60 * 60 * 1000;

function getTwelveDataApiKey() {
  return process.env.TWELVE_DATA_API_KEY || process.env.TWELVEDATA_API_KEY || null;
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

    res.json(payload);
  } catch (error) {
    console.error("Failed to load Twelve Data usage:", error);
    res.status(502).json({
      error: "Unable to load API credit usage right now."
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
