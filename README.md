# NVIDIA Stock Slider App

Simple Node/Express web app that renders the NVIDIA-style stock position table and fetches live quote data from Twelve Data for the companies listed in [`data/stocks.js`](./data/stocks.js).

## What it does

- Uses the same table-based UI as the hosted stock slider
- Fetches quote data from Twelve Data for every stock in `stocks.js`
- Displays each stock's current price between its 52-week low and 52-week high
- Sorts the list from highest to lowest 52-week position
- Persists a rolling local cache in `data/stocks-cache.json`
- Refreshes only a limited batch of symbols per request so it can stay within low-credit Twelve Data plans

## Local run

1. Install dependencies:

```bash
npm install
```

2. Set your Twelve Data API key:

```bash
export TWELVE_DATA_API_KEY=your_twelve_data_api_key_here
```

3. Start the app:

```bash
npm start
```

Open:

- `http://localhost:3000/`

## Environment variables

- `TWELVE_DATA_API_KEY`
  Required. API key used for Twelve Data quote requests.

- `STOCKS_CACHE_TTL_MINUTES`
  Optional. Minimum time before the server tries another quote refresh cycle. Default: `15`

- `TWELVE_DATA_CONCURRENCY`
  Optional. Number of parallel Twelve Data requests. Default: `5`

- `TWELVE_DATA_BATCH_SIZE`
  Optional. Maximum number of symbols to refresh in one cycle. Default: `8`

- `TWELVE_DATA_COOLDOWN_SECONDS`
  Optional. Minimum backoff between refresh attempts. Default: `65`

## Render deploy

This repo includes a minimal [`render.yaml`](./render.yaml) for a single Docker-based web service.

Required Render environment variable:

- `TWELVE_DATA_API_KEY`

Optional Render environment variables:

- `STOCKS_CACHE_TTL_MINUTES`
- `TWELVE_DATA_BATCH_SIZE`
- `TWELVE_DATA_COOLDOWN_SECONDS`

## API

The server exposes:

- `GET /health`
- `GET /api/stocks`

Use `GET /api/stocks?refresh=true` to force one refresh cycle.
