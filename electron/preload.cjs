const { contextBridge, ipcRenderer, webUtils } = require('electron');

const desktopUpdaterChannels = {
  getAppVersion: 'plchat:updater:get-app-version',
  checkForUpdates: 'plchat:updater:check-for-updates',
  downloadUpdate: 'plchat:updater:download-update',
  installUpdate: 'plchat:updater:install-update',
  restartAndInstall: 'plchat:updater:restart-and-install',
  repairInstall: 'plchat:updater:repair-install',
  getUpdateStatus: 'plchat:updater:get-update-status',
  getUpdateHistory: 'plchat:updater:get-update-history'
};

function invokeDesktopUpdater(channelKey, payload) {
  const channel = desktopUpdaterChannels[channelKey];
  if (!channel) return Promise.reject(new Error('Desktop updater is available only in PL CHAT Desktop App.'));
  return ipcRenderer.invoke(channel, payload);
}

contextBridge.exposeInMainWorld('plChatDesktop', {
  getInfo: () => ipcRenderer.invoke('plchat:get-desktop-info'),
  retryLoad: () => ipcRenderer.invoke('plchat:retry-load'),
  setServerUrl: (appUrl) => ipcRenderer.invoke('plchat:set-desktop-server-url', { appUrl }),
  testServer: (appUrl) => ipcRenderer.invoke('plchat:test-desktop-server', { appUrl }),
  clearCache: () => ipcRenderer.invoke('plchat:clear-desktop-cache'),
  openLogs: () => ipcRenderer.invoke('plchat:open-desktop-logs'),
  getDiagnostics: () => ipcRenderer.invoke('plchat:get-desktop-diagnostics'),
  setPreferences: (patch) => ipcRenderer.invoke('plchat:set-desktop-preferences', patch),
  showNotification: (payload) => ipcRenderer.invoke('plchat:show-native-notification', payload),
  startParallelDownload: (payload) => ipcRenderer.invoke('plchat:download:start', payload),
  startBatchDownload: (payload) => ipcRenderer.invoke('plchat:download:batch-start', payload),
  pauseDownload: (id) => ipcRenderer.invoke('plchat:download:pause', id),
  resumeDownload: (id) => ipcRenderer.invoke('plchat:download:resume', id),
  showDownloadInFolder: (id) => ipcRenderer.invoke('plchat:download:show-in-folder', id),
  openDownloadFile: (id) => ipcRenderer.invoke('plchat:download:open-file', id),
  openDownloadFolder: (id) => ipcRenderer.invoke('plchat:download:open-folder', id),
  listDownloads: () => ipcRenderer.invoke('plchat:download:list'),
  clearDownloadHistory: () => ipcRenderer.invoke('plchat:download:clear-history'),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  startUpload: (payload) => ipcRenderer.invoke('plchat:upload:start', payload),
  pauseUpload: (id) => ipcRenderer.invoke('plchat:upload:pause', id),
  resumeUpload: (id) => ipcRenderer.invoke('plchat:upload:resume', id),
  cancelUpload: (id) => ipcRenderer.invoke('plchat:upload:cancel', id),
  listUploads: () => ipcRenderer.invoke('plchat:upload:list'),
  updater: {
    getAppVersion: () => invokeDesktopUpdater('getAppVersion'),
    checkForUpdates: (payload) => invokeDesktopUpdater('checkForUpdates', payload),
    downloadUpdate: (payload) => invokeDesktopUpdater('downloadUpdate', payload),
    installUpdate: (payload) => invokeDesktopUpdater('installUpdate', payload),
    restartAndInstall: (payload) => invokeDesktopUpdater('restartAndInstall', payload),
    repairInstall: (payload) => invokeDesktopUpdater('repairInstall', payload),
    getUpdateStatus: () => invokeDesktopUpdater('getUpdateStatus'),
    getUpdateHistory: () => invokeDesktopUpdater('getUpdateHistory')
  },
  onNotificationClick: (listener) => {
    const handler = (_event, targetUrl) => listener(targetUrl);
    ipcRenderer.on('plchat:native-notification-click', handler);
    return () => ipcRenderer.removeListener('plchat:native-notification-click', handler);
  },
  onPreferencesChanged: (listener) => {
    const handler = (_event, preferences) => listener(preferences);
    ipcRenderer.on('plchat:desktop-preferences', handler);
    return () => ipcRenderer.removeListener('plchat:desktop-preferences', handler);
  },
  onDownloadUpdated: (listener) => {
    const handler = (_event, job) => listener(job);
    ipcRenderer.on('plchat:desktop-download-updated', handler);
    return () => ipcRenderer.removeListener('plchat:desktop-download-updated', handler);
  },
  onUploadUpdated: (listener) => {
    const handler = (_event, job) => listener(job);
    ipcRenderer.on('plchat:desktop-upload-updated', handler);
    return () => ipcRenderer.removeListener('plchat:desktop-upload-updated', handler);
  },
  onUpdateProgress: (listener) => {
    const handler = (_event, progress) => listener(progress);
    ipcRenderer.on('plchat:desktop-update-progress', handler);
    return () => ipcRenderer.removeListener('plchat:desktop-update-progress', handler);
  }
});

window.addEventListener('DOMContentLoaded', () => {
  document.documentElement.dataset.desktop = 'true';
});
