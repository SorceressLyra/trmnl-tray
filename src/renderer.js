function $(id) {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element: ${id}`);
  return element;
}

const tokenInput = $("token");
const refreshButton = $("refresh");
const screenImage = $("screen");
const placeholder = $("placeholder");
const overlay = $("overlay");
const statusText = $("statusText");
const refreshRate = $("refreshRate");

let currentState = null;

screenImage.addEventListener("error", () => {
  statusText.textContent = "Failed to render image.";
});

function applyImage(url) {
  if (!url) {
    screenImage.style.display = "none";
    placeholder.style.display = "block";
    return;
  }

  if (url.startsWith("data:")) {
    screenImage.src = url;
  } else {
    const cacheBusted = `${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`;
    screenImage.src = cacheBusted;
  }
  screenImage.style.display = "block";
  placeholder.style.display = "none";
}

function render(state) {
  currentState = state;
  statusText.textContent = state.statusText || "";

  if (state.refreshRateSeconds) {
    refreshRate.textContent = `auto: ${state.refreshRateSeconds}s`;
  } else {
    refreshRate.textContent = "";
  }

  overlay.style.display = state.isLoading ? "flex" : "none";
  refreshButton.disabled = state.isLoading;

  if (typeof state.accessToken === "string" && !tokenInput.value) {
    tokenInput.value = state.accessToken;
  }

  applyImage(state.imageDataUrl || state.imageUrl);
}

async function init() {
  const state = await window.trmnl.getState();
  render(state);

  window.trmnl.onStateChanged((nextState) => {
    render(nextState);
  });

  refreshButton.addEventListener("click", async () => {
    const token = tokenInput.value.trim();
    if (token && token !== (currentState?.accessToken || "")) {
      await window.trmnl.setAccessToken(token);
      return;
    }
    await window.trmnl.manualRefresh();
  });

  tokenInput.addEventListener("keydown", async (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    refreshButton.click();
  });
}

init().catch((error) => {
  statusText.textContent = error?.message || "Failed to start.";
});
