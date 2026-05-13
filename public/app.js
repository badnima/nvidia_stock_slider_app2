const rows = document.getElementById("rows");
const updatedAt = document.getElementById("updated-at");
const creditsUsed = document.getElementById("credits-used");
const refreshButton = document.getElementById("refresh-button");
const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD"
});

function positionPercent(company) {
  return ((company.currentPrice - company.week52Low) / (company.week52High - company.week52Low)) * 100;
}

function renderMessage(message) {
  rows.innerHTML = `
    <tr class="message-row">
      <td colspan="2">${message}</td>
    </tr>
  `;
}

function renderCompanies(companies) {
  rows.innerHTML = companies.map((company) => {
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
  }).join("");
}

async function loadCreditsUsage() {
  if (!creditsUsed) {
    return;
  }

  try {
    const response = await fetch(`/api/credits?ts=${Date.now()}`, {
      cache: "no-store"
    });

    if (response.status === 204) {
      creditsUsed.textContent = "";
      creditsUsed.hidden = true;
      return;
    }

    const payload = await response.json();

    if (!response.ok || typeof payload.usedToday !== "number" || typeof payload.limit !== "number") {
      throw new Error("Unable to load API credit usage.");
    }

    creditsUsed.hidden = false;
    creditsUsed.textContent = `API Credits Used today: ${payload.usedToday}/${payload.limit} API calls`;
  } catch (error) {
    console.error("Failed to load API credit usage:", error);
    creditsUsed.hidden = false;
    creditsUsed.textContent = "API Credits Used today: unavailable";
  }
}

async function loadStocks({ showLoading = true } = {}) {
  if (showLoading) {
    renderMessage("Loading latest market close data...");
  }

  if (refreshButton) {
    refreshButton.disabled = true;
    refreshButton.textContent = "Refreshing...";
  }

  try {
    const response = await fetch(`/stocks-data.json?ts=${Date.now()}`, {
      cache: "no-store"
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error("Unable to load market close data.");
    }

    const companies = payload.companies.filter((company) => (
      typeof company.currentPrice === "number" &&
      typeof company.week52Low === "number" &&
      typeof company.week52High === "number" &&
      company.week52High > company.week52Low
    ));

    companies.sort((left, right) => positionPercent(right) - positionPercent(left));

    if (updatedAt) {
      updatedAt.textContent = payload.marketDate
        ? `Latest close: ${payload.marketDate} · Snapshot refreshed: ${payload.updatedAt}`
        : `Snapshot refreshed: ${payload.updatedAt}`;
    }

    if (!companies.length) {
      renderMessage("No stock data is currently available.");
      return;
    }

    renderCompanies(companies);
  } catch (error) {
    console.error("Failed to load market close data:", error);
    if (updatedAt) {
      updatedAt.textContent = "Latest close: unavailable";
    }
    renderMessage("Unable to load market close data right now.");
  } finally {
    if (refreshButton) {
      refreshButton.disabled = false;
      refreshButton.textContent = "Reload";
    }
  }
}

if (refreshButton) {
  refreshButton.addEventListener("click", () => {
    loadCreditsUsage();
    loadStocks({ showLoading: false });
  });
}

loadCreditsUsage();
loadStocks();
