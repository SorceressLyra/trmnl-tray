const path = require("path");
const fs = require("fs");
const axios = require("axios");
const Store = require("electron-store");

const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  ipcMain,
  nativeImage,
  screen,
  nativeTheme,
} = require("electron");

const API_URL = "https://usetrmnl.com/api/current_screen";

const store = new Store({
  name: "config",
  defaults: {
    accessToken: "",
    refreshRateSeconds: 1800,
  },
});

let tray = null;
let window = null;
let refreshTimer = null;
let state = {
  accessToken: "",
  refreshRateSeconds: 1800,
  imageUrl: "",
  imageDataUrl: "",
  lastFetchedAt: null,
  statusText: "Waiting…",
  isLoading: false,
};

function clearRefreshTimer() {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
}

function scheduleNextRefresh() {
  clearRefreshTimer();
  const seconds = Number(state.refreshRateSeconds) || 1800;
  refreshTimer = setTimeout(() => {
    refreshCurrentScreen().catch(() => {});
  }, Math.max(5, seconds) * 1000);
}

function broadcastState() {
  if (!window || window.isDestroyed()) return;
  window.webContents.send("trmnl:stateChanged", {
    accessToken: state.accessToken,
    refreshRateSeconds: state.refreshRateSeconds,
    imageUrl: state.imageUrl,
    imageDataUrl: state.imageDataUrl,
    lastFetchedAt: state.lastFetchedAt,
    statusText: state.statusText,
    isLoading: state.isLoading,
  });
}

async function fetchImageAsDataUrl(url) {
  const response = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: 15_000,
    maxRedirects: 10,
    validateStatus: () => true,
    headers: {
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    },
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`image fetch HTTP ${response.status}`);
  }

  const contentType =
    (response.headers && response.headers["content-type"]) || "image/png";
  const base64 = Buffer.from(response.data).toString("base64");
  return `data:${contentType};base64,${base64}`;
}

async function refreshCurrentScreen() {
  const token = (state.accessToken || "").trim();
  if (!token) {
    state.statusText = "Enter an access token to load the screen.";
    state.isLoading = false;
    state.imageUrl = "";
    state.imageDataUrl = "";
    broadcastState();
    clearRefreshTimer();
    return;
  }

  state.isLoading = true;
  state.statusText = "Refreshing…";
  broadcastState();

  try {
    const response = await axios.get(API_URL, {
      headers: {
        "access-token": token,
      },
      timeout: 15_000,
      validateStatus: () => true,
    });

    const data = (() => {
      if (response.data && typeof response.data === "object") return response.data;
      if (typeof response.data !== "string") return {};
      try {
        return JSON.parse(response.data);
      } catch {
        try {
          const rubyish = response.data
            .replace(/=>/g, ":")
            .replace(/\bnil\b/g, "null");
          return JSON.parse(rubyish);
        } catch {
          return {};
        }
      }
    })();

    const effectiveStatus =
      typeof data.status === "number" ? data.status : response.status;
    if (effectiveStatus !== 200) {
      state.statusText = `API error: ${effectiveStatus}`;
      state.isLoading = false;
      broadcastState();
      scheduleNextRefresh();
      return;
    }

    const imageUrl = typeof data.image_url === "string" ? data.image_url : "";
    const refreshRateSeconds =
      typeof data.refresh_rate === "number"
        ? data.refresh_rate
        : Number(data.refresh_rate) || 1800;

    if (!imageUrl) {
      state.statusText = "API response missing image_url.";
      state.isLoading = false;
      broadcastState();
      scheduleNextRefresh();
      return;
    }

    let imageDataUrl = "";
    try {
      imageDataUrl = await fetchImageAsDataUrl(imageUrl);
    } catch (error) {
      state.statusText = `Image load failed: ${error?.message || "unknown error"}`;
      state.imageUrl = imageUrl;
      state.imageDataUrl = "";
      state.refreshRateSeconds = Math.max(5, refreshRateSeconds);
      state.lastFetchedAt = new Date().toISOString();
      state.isLoading = false;
      store.set("refreshRateSeconds", state.refreshRateSeconds);
      broadcastState();
      scheduleNextRefresh();
      return;
    }

    state.imageUrl = imageUrl;
    state.imageDataUrl = imageDataUrl;
    state.refreshRateSeconds = Math.max(5, refreshRateSeconds);
    state.lastFetchedAt = new Date().toISOString();
    state.statusText = "Up to date.";
    state.isLoading = false;

    store.set("refreshRateSeconds", state.refreshRateSeconds);
    broadcastState();
    scheduleNextRefresh();
  } catch (error) {
    state.statusText = `Network error: ${error?.message || "unknown error"}`;
    state.isLoading = false;
    broadcastState();
    scheduleNextRefresh();
  }
}

function createWindow() {
  window = new BrowserWindow({
    width: 460,
    height: 360,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    fullscreenable: false,
    hasShadow: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    transparent: true,
    backgroundColor: "#00000000",
    ...(process.platform === "darwin"
      ? { vibrancy: "menu", visualEffectState: "active" }
      : {}),
    ...(process.platform === "win32" ? { backgroundMaterial: "acrylic" } : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.loadFile(path.join(__dirname, "renderer.html"));

  window.on("blur", () => {
    if (window && window.isVisible()) window.hide();
  });

  if (process.platform === "darwin") {
    window.setWindowButtonVisibility(false);
    window.setAlwaysOnTop(true, "screen-saver");
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  } else {
    window.setAlwaysOnTop(true);
  }
}

function getTrayIcon() {
  const assetsDir = path.join(__dirname, "..", "assets");
  const isDark = nativeTheme.shouldUseDarkColors;

  if (process.platform !== "darwin") {
    const themedCandidate = path.join(
      assetsDir,
      isDark ? "tray-icon-light.png" : "tray-icon-dark.png"
    );
    if (fs.existsSync(themedCandidate)) {
      const themed = nativeImage.createFromPath(themedCandidate);
      return themed.isEmpty() ? nativeImage.createEmpty() : themed;
    }
  }

  const iconPath = path.join(assetsDir, "tray-icon.png");
  const image = nativeImage.createFromPath(iconPath);
  if (image.isEmpty()) return nativeImage.createEmpty();
  if (process.platform === "darwin") image.setTemplateImage(true);
  return image;
}

function updateTrayIcon() {
  if (!tray) return;
  tray.setImage(getTrayIcon());
}

function positionWindow() {
  if (!tray || !window) return;

  const trayBounds = tray.getBounds();
  const windowBounds = window.getBounds();
  const display = screen.getDisplayNearestPoint({
    x: trayBounds.x,
    y: trayBounds.y,
  });
  const workArea = display.workArea;

  const centerX = Math.round(trayBounds.x + trayBounds.width / 2);
  let x = Math.round(centerX - windowBounds.width / 2);
  x = Math.max(workArea.x, Math.min(x, workArea.x + workArea.width - windowBounds.width));

  const belowY = Math.round(trayBounds.y + trayBounds.height + 8);
  const aboveY = Math.round(trayBounds.y - windowBounds.height - 8);
  const fitsBelow = belowY + windowBounds.height <= workArea.y + workArea.height;
  const y = fitsBelow ? belowY : Math.max(workArea.y, aboveY);

  window.setPosition(x, y, false);
}

function toggleWindow() {
  if (!window) return;
  if (window.isVisible()) {
    window.hide();
    return;
  }
  positionWindow();
  window.show();
  window.focus();
  broadcastState();
}

function createTray() {
  tray = new Tray(getTrayIcon());
  tray.setToolTip("TRMNL Tray");

  tray.on("click", toggleWindow);
  nativeTheme.on("updated", updateTrayIcon);

  const contextMenu = Menu.buildFromTemplate([
    { label: "Open", click: toggleWindow },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        app.quit();
      },
    },
  ]);
  tray.on("right-click", () => tray.popUpContextMenu(contextMenu));
}

ipcMain.handle("trmnl:getState", async () => {
  return {
    accessToken: state.accessToken,
    refreshRateSeconds: state.refreshRateSeconds,
    imageUrl: state.imageUrl,
    imageDataUrl: state.imageDataUrl,
    lastFetchedAt: state.lastFetchedAt,
    statusText: state.statusText,
    isLoading: state.isLoading,
  };
});

ipcMain.handle("trmnl:setAccessToken", async (_event, token) => {
  const accessToken = typeof token === "string" ? token.trim() : "";
  state.accessToken = accessToken;
  store.set("accessToken", accessToken);
  broadcastState();
  await refreshCurrentScreen();
  return { ok: true };
});

ipcMain.handle("trmnl:manualRefresh", async () => {
  await refreshCurrentScreen();
  return { ok: true };
});

app.on("window-all-closed", (event) => {
  event.preventDefault();
});

app.on("before-quit", () => {
  clearRefreshTimer();
});

app.whenReady().then(async () => {
  if (process.platform === "darwin") {
    app.dock.hide();
  }

  state.accessToken = String(store.get("accessToken") || "").trim();
  state.refreshRateSeconds = Number(store.get("refreshRateSeconds")) || 1800;

  createWindow();
  createTray();

  if (state.accessToken) {
    await refreshCurrentScreen();
  } else {
    toggleWindow();
  }
});
