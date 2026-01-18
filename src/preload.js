const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("trmnl", {
  getState: () => ipcRenderer.invoke("trmnl:getState"),
  setAccessToken: (token) => ipcRenderer.invoke("trmnl:setAccessToken", token),
  manualRefresh: () => ipcRenderer.invoke("trmnl:manualRefresh"),
  onStateChanged: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("trmnl:stateChanged", listener);
    return () => ipcRenderer.removeListener("trmnl:stateChanged", listener);
  },
});
