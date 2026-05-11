const rows = document.getElementById("rows");
const updatedAt = document.getElementById("updated-at");
const refreshButton = document.getElementById("refresh-button");
const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD"
});

function hasFullQuote(company) {
  return (
    typeof company.currentPrice === "number" &&
    typeof company.week52Low === "number" &&
    typeof company.week52High === "number" &&
    company.week52High > company.week52Low
  );
}

function positionPercent(company) {
  const range = company.week52High - company.week52Low;

  if (!Number.isFinite(range) || range <= 0) {
    return 0;
  }

  return ((company.currentPrice - company.week52Low) / range) * 100;
}

function renderMessage(message) {
  rows.innerHTML = `
    <tr class="message-row">
      <td colspan="2">${message}</td>
    </tr>
  `;
}

function renderPendingRow(company) {
  return `
    <tr>
      <td>
        <div class="company-name">${company.name}</div>
      </td>
      <td class="slider-cell">
        <div class="pending-state">Waiting for quote refresh.</div>
      </td>
    </tr>
  `;
}

function renderCompanyRow(company) {
  const percent = Math.max(0, Math.min(100, positionPercent(company)));
  return `
    <tr>
      <td>
        <div class="company-name">${company.name}</div>
      </td>
      <td class="slider-cell">
        <div class="slider-track" aria-label="${company.name} 52-week stock position">
          <div class="slider-fill" style="width: ${percent}%"></div>
          <div class="slider-thumb" style="left: ${percent}%"></div>
        </div>
        <div class="slider-scale">
          <span>${currencyFormatter.format(company.week52Low)}</span>
          <span>${currencyFormatter.format(company.currentPrice)}</span>
          <span>${currencyFormatter.format(company.week52High)}</span>
        </div>
      </td>
    </tr>
  `;
}

function renderCompanies(companies) {
  const sortedCompanies = [...companies].sort((left, right) => {
    const leftLoaded = hasFullQuote(left);
    const rightLoaded = hasFullQuote(right);

    if (leftLoaded !== rightLoaded) {
      return leftLoaded ? -1 : 1;
    }

    if (!leftLoaded) {
      return left.name.localeCompare(right.name);
    }

    return positionPercent(right) - positionPercent(left);
  });

  rows.innerHTML = sortedCompanies.map((company) => (
    hasFullQuote(company) ? renderCompanyRow(company) : renderPendingRow(company)
  )).join("");
}

async function loadStocks({ forceRefresh = false } = {}) {
  renderMessage("Loading latest market close data...");

  if (refreshButton) {
    refreshButton.disabled = true;
    refreshButton.textContent = "Refreshing...";
  }

  try {
    const params = new URLSearchParams({
      ts: String(Date.now())
    });

    if (forceRefresh) {
      params.set("refresh", "true");
    }

    const response = await fetch(`/api/stocks?${params.toString()}`, {
      cache: "no-store"
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload?.error || "Unable to load stock data.");
    }

    if (updatedAt) {
      const statusParts = [];

      if (payload.marketDate) {
        statusParts.push(`Latest close: ${payload.marketDate}`);
      }

      if (payload.updatedLabel || payload.updatedAt) {
        statusParts.push(`Updated: ${formatUpdatedAt(payload.updatedAt || payload.updatedLabel)}`);
      }

      if (typeof payload.loadedCount === "number" && typeof payload.totalCount === "number") {
        statusParts.push(`Loaded ${payload.loadedCount}/${payload.totalCount} stocks`);
      }

      if (payload.warning) {
        statusParts.push("Using cached and partial data");
      }

      updatedAt.textContent = statusParts.join(" · ") || "Latest close: unavailable";
    }

    if (!Array.isArray(payload.companies) || !payload.companies.length) {
      renderMessage("No stock data is currently available.");
      return;
    }

    renderCompanies(payload.companies);
  } catch (error) {
    console.error("Failed to load stock data:", error);
    updatedAt.textContent = "Latest close: unavailable";
    renderMessage("Unable to load stock data right now.");
  } finally {
    if (refreshButton) {
      refreshButton.disabled = false;
      refreshButton.textContent = "Refresh";
    }
  }
}

if (refreshButton) {
  refreshButton.addEventListener("click", () => {
    loadStocks({ forceRefresh: true });
  });
}

loadStocks();

function formatUpdatedAt(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value || "unavailable";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short"
  }).format(date);
}
