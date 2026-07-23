const { app, BrowserWindow, Menu, Notification, Tray, ipcMain, nativeImage, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { createHash } = require('crypto');
const { fileURLToPath, pathToFileURL } = require('url');

const APP_NAME = 'PL CHAT';
const LAN_APP_URL = 'http://192.168.1.117:8788';
const DEFAULT_APP_URL = LAN_APP_URL;
const STALE_LAN_HOSTS = new Set(['192.168.1.126']);
const UPDATE_MODE = 'lan-auto-update';
const UPDATE_FEED_ENV = 'PL_CHAT_UPDATE_FEED_URL';
const DEFAULT_WINDOW_STATE = { width: 1280, height: 840, maximized: false };
const DEFAULT_PREFERENCES = {
  minimizeToTray: false,
  notificationsEnabled: true,
  doNotDisturb: false,
  startWithWindows: true
};
const DESKTOP_UPDATER_ONLY_ERROR = 'Desktop updater is available only in PL CHAT Desktop App.';
const DEFAULT_UPDATE_STATUS = {
  state: 'idle',
  available: false,
  version: null,
  downloaded: false,
  lastCheckedAt: null,
  message: 'LAN-only v1 uses manual installer updates from the administrator.'
};

let mainWindow;
let tray;
let isQuitting = false;
let saveWindowTimer;
let workspaceLoadTimer;

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');

function safeReadJson(filePath, fallback) {
  try {
    return { ...fallback, ...JSON.parse(fs.readFileSync(filePath, 'utf8')) };
  } catch {
    return { ...fallback };
  }
}

function safeWriteJson(filePath, value) {
  const directory = path.dirname(filePath);
  const temporaryPath = `${filePath}.tmp`;
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  try {
    fs.renameSync(temporaryPath, filePath);
  } catch {
    fs.copyFileSync(temporaryPath, filePath);
    fs.unlinkSync(temporaryPath);
  }
}

function userDataPath(fileName) {
  return path.join(app.getPath('userData'), fileName);
}

function appendDesktopLog(message, detail = {}) {
  try {
    const directory = app.isReady() ? app.getPath('userData') : path.join(app.getPath('temp'), APP_NAME);
    const line = JSON.stringify({
      at: new Date().toISOString(),
      message,
      detail
    });
    fs.mkdirSync(directory, { recursive: true });
    fs.appendFileSync(path.join(directory, 'desktop-startup.log'), `${line}\n`, 'utf8');
  } catch {}
}

process.on('uncaughtException', (error) => {
  appendDesktopLog('uncaught-exception', {
    message: error?.message || String(error),
    stack: error?.stack || ''
  });
});

process.on('unhandledRejection', (reason) => {
  appendDesktopLog('unhandled-rejection', {
    message: reason?.message || String(reason),
    stack: reason?.stack || ''
  });
});

function bundledConfigPath() {
  return path.join(__dirname, 'desktop-config.json');
}

function desktopConfigPath() {
  return userDataPath('desktop-server.json');
}

function validAppUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    return ['http:', 'https:'].includes(url.protocol) ? url.toString().replace(/\/$/, '') : '';
  } catch {
    return '';
  }
}

function validUpdateFeedLocation(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    return ['http:', 'https:', 'file:'].includes(url.protocol) ? url.toString() : '';
  } catch {
    return path.isAbsolute(raw) ? raw : '';
  }
}

function isLoopbackAppUrl(value) {
  try {
    const hostname = new URL(String(value || '')).hostname.toLowerCase();
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  } catch {
    return false;
  }
}

function readDesktopConfig() {
  return safeReadJson(desktopConfigPath(), {});
}

function saveDesktopConfig(patch) {
  const next = { ...readDesktopConfig(), ...patch };
  const appUrl = validAppUrl(next.appUrl);
  if (appUrl && !patch.updateFeedUrl) next.updateFeedUrl = updateFeedUrlForAppUrl(appUrl);
  safeWriteJson(desktopConfigPath(), next);
  return next;
}

function updateFeedUrlForAppUrl(appUrl) {
  const cleanAppUrl = validAppUrl(appUrl) || DEFAULT_APP_URL;
  return `${cleanAppUrl}/api/desktop/update-feed`;
}

function hasStaleLanHost(value) {
  const raw = String(value || '');
  if (!raw) return false;
  try {
    return STALE_LAN_HOSTS.has(new URL(raw).hostname);
  } catch {
    return [...STALE_LAN_HOSTS].some((host) => raw.includes(host));
  }
}

function normalizeDesktopServerConfig(reason = 'startup') {
  const saved = readDesktopConfig();
  const savedAppUrl = validAppUrl(saved.appUrl);
  const savedFeedUrl = validUpdateFeedLocation(saved.updateFeedUrl);
  const shouldRepairAppUrl = !savedAppUrl || savedAppUrl !== DEFAULT_APP_URL || isLoopbackAppUrl(savedAppUrl) || hasStaleLanHost(savedAppUrl);
  const repairedAppUrl = shouldRepairAppUrl ? DEFAULT_APP_URL : savedAppUrl;
  const repairedFeedUrl = updateFeedUrlForAppUrl(repairedAppUrl);
  const shouldRepairFeedUrl = !savedFeedUrl || hasStaleLanHost(savedFeedUrl) || savedFeedUrl !== repairedFeedUrl;
  if (!shouldRepairAppUrl && !shouldRepairFeedUrl && saved.mode === 'lan-only-v1-url117') {
    return { repaired: false, appUrl: repairedAppUrl, updateFeedUrl: repairedFeedUrl };
  }
  const next = saveDesktopConfig({
    ...saved,
    appUrl: repairedAppUrl,
    updateFeedUrl: repairedFeedUrl,
    mode: 'lan-only-v1-url117',
    updatedAt: new Date().toISOString(),
    repairReason: shouldRepairAppUrl ? 'stale-host-url-or-non-url117' : `feed-normalized-${reason}`
  });
  appendDesktopLog('desktop-server-config-normalized', {
    reason,
    previousAppUrl: saved.appUrl || null,
    previousUpdateFeedUrl: saved.updateFeedUrl || null,
    appUrl: next.appUrl,
    updateFeedUrl: next.updateFeedUrl
  });
  return { repaired: true, appUrl: next.appUrl, updateFeedUrl: next.updateFeedUrl };
}

function getAppUrl() {
  const bundled = safeReadJson(bundledConfigPath(), {});
  const saved = readDesktopConfig();
  const savedAppUrl = validAppUrl(saved.appUrl);
  const bundledAppUrl = validAppUrl(bundled.appUrl);
  return validAppUrl(process.env.PL_CHAT_DESKTOP_URL)
    || validAppUrl(process.env.APP_PUBLIC_URL)
    || (savedAppUrl && !isLoopbackAppUrl(savedAppUrl) ? savedAppUrl : '')
    || bundledAppUrl
    || DEFAULT_APP_URL;
}

function getUpdateFeedUrl() {
  const bundled = safeReadJson(bundledConfigPath(), {});
  const saved = readDesktopConfig();
  return validUpdateFeedLocation(process.env[UPDATE_FEED_ENV])
    || validUpdateFeedLocation(saved.updateFeedUrl)
    || validUpdateFeedLocation(bundled.updateFeedUrl)
    || updateFeedUrlForAppUrl(getAppUrl())
    || '';
}

function getAllowedOrigin() {
  return new URL(getAppUrl()).origin;
}

function isAllowedAppNavigation(target) {
  try {
    const url = new URL(target);
    const offlineUrl = pathToFileURL(path.join(__dirname, 'offline.html')).toString();
    return url.origin === getAllowedOrigin() || url.toString().startsWith(offlineUrl);
  } catch {
    return false;
  }
}

function isSafeExternalUrl(target) {
  try {
    return ['https:', 'mailto:'].includes(new URL(target).protocol);
  } catch {
    return false;
  }
}

function safeInternalTarget(target) {
  try {
    const url = new URL(String(target || '/notifications'), getAppUrl());
    if (url.origin !== getAllowedOrigin()) return '/notifications';
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return '/notifications';
  }
}

function windowStatePath() {
  return userDataPath('window-state.json');
}

function preferencesPath() {
  return userDataPath('desktop-preferences.json');
}

function updateStatusPath() {
  return userDataPath('desktop-update-status.json');
}

function updateHistoryPath() {
  return userDataPath('desktop-update-history.json');
}

function readPreferences() {
  return safeReadJson(preferencesPath(), DEFAULT_PREFERENCES);
}

function savePreferences(patch) {
  const next = { ...readPreferences(), ...patch };
  safeWriteJson(preferencesPath(), next);
  return next;
}

function assertDesktopUpdaterRuntime(event) {
  if (!event?.senderFrame || event.senderFrame.url === 'about:blank') {
    throw new Error(DESKTOP_UPDATER_ONLY_ERROR);
  }
  if (event.sender.id !== mainWindow?.webContents.id) {
    throw new Error(DESKTOP_UPDATER_ONLY_ERROR);
  }
  if (!isAllowedAppNavigation(event.senderFrame.url)) {
    throw new Error(DESKTOP_UPDATER_ONLY_ERROR);
  }
}

function readUpdateStatus() {
  return safeReadJson(updateStatusPath(), DEFAULT_UPDATE_STATUS);
}

function saveUpdateStatus(patch) {
  const next = { ...readUpdateStatus(), ...patch };
  safeWriteJson(updateStatusPath(), next);
  return next;
}

function appendUpdateHistory(action, detail = {}) {
  const data = safeReadJson(updateHistoryPath(), { items: [] });
  const items = Array.isArray(data.items) ? data.items : [];
  items.unshift({ action, detail, createdAt: new Date().toISOString() });
  safeWriteJson(updateHistoryPath(), { items: items.slice(0, 80) });
  return items[0];
}

function reconcileUpdateStatus() {
  const status = readUpdateStatus();
  if (!['installing', 'installer-opened'].includes(status.state)) return status;
  const targetVersion = String(status.version || '');
  if (targetVersion && compareVersions(app.getVersion(), targetVersion) >= 0) {
    const next = saveUpdateStatus({
      ...status,
      state: 'installed',
      available: false,
      downloaded: false,
      installedAt: new Date().toISOString(),
      message: `PL CHAT Desktop App ${app.getVersion()} is installed.`
    });
    appendUpdateHistory('update-install-verified', {
      expectedVersion: targetVersion,
      appVersion: app.getVersion()
    });
    return next;
  }
  const startedAt = status.installStartedAt ? Date.parse(status.installStartedAt) : 0;
  const finishedAt = status.installFinishedAt ? Date.parse(status.installFinishedAt) : 0;
  const ageMs = startedAt ? Date.now() - startedAt : 0;
  const graceMs = 12 * 60 * 1000;
  if (status.state === 'installing' && startedAt && ageMs >= 0 && ageMs < graceMs && !finishedAt) {
    return saveUpdateStatus({
      ...status,
      downloaded: Boolean(status.installerPath && fs.existsSync(status.installerPath)),
      message: `PL CHAT is still installing ${targetVersion || 'the update'}. Please wait, then reopen PL CHAT.`
    });
  }
  if (status.state === 'installing') {
    const next = saveUpdateStatus({
      ...status,
      state: 'install-failed',
      available: true,
      downloaded: Boolean(status.installerPath && fs.existsSync(status.installerPath)),
      message: `The installer finished or timed out, but the Desktop runtime is still ${app.getVersion()}. Run Repair install or open the installer manually.`
    });
    appendUpdateHistory('update-install-not-applied', {
      expectedVersion: targetVersion || null,
      appVersion: app.getVersion(),
      installerPath: status.installerPath || null,
      installStartedAt: status.installStartedAt || null,
      installFinishedAt: status.installFinishedAt || null,
      installExitCode: status.installExitCode ?? null
    });
    return next;
  }
  return status;
}

function manualInstallerStatus(message = 'LAN-only v1 is updated by installing the latest PL CHAT Setup from the administrator.') {
  return saveUpdateStatus({
    state: 'manual',
    available: false,
    version: null,
    downloaded: false,
    lastCheckedAt: new Date().toISOString(),
    feedUrl: getUpdateFeedUrl() || null,
    updateMode: UPDATE_MODE,
    message
  });
}

function compareVersions(left, right) {
  const a = String(left || '').split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
  const b = String(right || '').split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (a[index] || 0) - (b[index] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function isHttpUrl(value) {
  try {
    return ['http:', 'https:'].includes(new URL(String(value)).protocol);
  } catch {
    return false;
  }
}

function isFileUrl(value) {
  try {
    return new URL(String(value)).protocol === 'file:';
  } catch {
    return false;
  }
}

function localPathFromLocation(location) {
  if (isFileUrl(location)) return fileURLToPath(location);
  return path.resolve(String(location));
}

function resolveUpdateAssetLocation(baseLocation, assetLocation) {
  const raw = String(assetLocation || '').trim();
  if (!raw) return '';
  if (validUpdateFeedLocation(raw)) return raw;
  if (isHttpUrl(baseLocation) || isFileUrl(baseLocation)) return new URL(raw, baseLocation).toString();
  return path.resolve(path.dirname(localPathFromLocation(baseLocation)), raw);
}

function selectUpdateInstaller(manifest, feedUrl) {
  const files = Array.isArray(manifest.files) ? manifest.files : [];
  const platform = process.platform;
  const arch = process.arch;
  const match = files.find((file) => {
    const filePlatform = String(file.platform || platform);
    const fileArch = String(file.arch || arch);
    return filePlatform === platform && fileArch === arch && (file.url || file.path);
  }) || files.find((file) => file.url || file.path) || manifest;
  const assetLocation = match.url || match.path || match.installerUrl || match.downloadUrl || manifest.installerUrl || manifest.downloadUrl || manifest.url || manifest.path;
  if (!assetLocation) return null;
  return {
    version: String(match.version || manifest.version || manifest.latestVersion || ''),
    releaseDate: match.releaseDate || manifest.releaseDate || null,
    notes: match.notes || manifest.notes || '',
    size: Number(match.size || manifest.size || 0) || null,
    sha256: String(match.sha256 || manifest.sha256 || '').toLowerCase() || null,
    fileName: String(match.fileName || manifest.fileName || '').trim() || null,
    installerUrl: resolveUpdateAssetLocation(feedUrl, assetLocation)
  };
}

function installerFromHostManifest(manifest = {}) {
  const installerUrl = String(manifest.downloadUrl || manifest.installerUrl || manifest.url || '').trim();
  const version = String(manifest.latestVersion || manifest.version || '').trim();
  if (!installerUrl || !version) return null;
  return {
    version,
    releaseDate: manifest.publishedAt || manifest.releaseDate || null,
    notes: manifest.releaseNotes || manifest.notes || '',
    size: Number(manifest.sizeBytes || manifest.size || 0) || null,
    sha256: String(manifest.sha256 || '').toLowerCase() || null,
    fileName: String(manifest.fileName || '').trim() || null,
    installerUrl
  };
}

async function readUpdateManifest(feedUrl) {
  if (isHttpUrl(feedUrl)) {
    const response = await fetch(feedUrl, { cache: 'no-store' });
    if (!response.ok) throw new Error(`update_feed_http_${response.status}`);
    return JSON.parse(await response.text());
  }
  return JSON.parse(fs.readFileSync(localPathFromLocation(feedUrl), 'utf8'));
}

function updateDownloadDirectory() {
  return userDataPath('desktop-updates');
}

function safeInstallerFileName(location, fallbackName = 'PL CHAT Setup.exe') {
  let name = '';
  try {
    const rawName = path.basename(isFileUrl(location) ? fileURLToPath(location) : new URL(location).pathname);
    name = isFileUrl(location) ? rawName : decodeURIComponent(rawName);
  } catch {
    name = path.basename(String(location));
  }
  name = name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '-').trim();
  if (!name || !/\.exe$/i.test(name)) {
    const fallback = String(fallbackName || 'PL CHAT Setup.exe').replace(/[<>:"/\\|?*\x00-\x1F]/g, '-').trim();
    name = /\.exe$/i.test(fallback) ? fallback : `${name || fallback || 'PL CHAT Setup'}.exe`;
  }
  return name;
}

function sha256File(filePath) {
  const hash = createHash('sha256');
  const data = fs.readFileSync(filePath);
  hash.update(data);
  return hash.digest('hex');
}

function emitDesktopUpdateProgress(progress) {
  mainWindow?.webContents.send('plchat:desktop-update-progress', {
    version: progress.version || null,
    fileName: progress.fileName || '',
    downloadedBytes: Number(progress.downloadedBytes || 0),
    totalBytes: Number(progress.totalBytes || 0),
    progress: Number(progress.progress || 0),
    status: progress.status || 'downloading'
  });
}

async function downloadUpdateInstaller(status) {
  if (!status?.installerUrl) throw new Error('no_update_installer');
  fs.mkdirSync(updateDownloadDirectory(), { recursive: true });
  const fallbackName = status.fileName || `PL CHAT Setup ${status.version || 'Update'}.exe`;
  const targetPath = path.join(updateDownloadDirectory(), safeInstallerFileName(status.installerUrl, fallbackName));
  const temporaryPath = `${targetPath}.download`;
  if (isHttpUrl(status.installerUrl)) {
    const response = await fetch(status.installerUrl, { cache: 'no-store' });
    if (!response.ok) throw new Error(`update_installer_http_${response.status}`);
    const totalBytes = Number(status.size || response.headers.get('content-length') || 0);
    const reader = response.body?.getReader?.();
    if (reader) {
      const writer = fs.createWriteStream(temporaryPath);
      let downloadedBytes = 0;
      await new Promise(async (resolve, reject) => {
        writer.on('error', reject);
        writer.on('finish', resolve);
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = Buffer.from(value);
            downloadedBytes += chunk.length;
            if (!writer.write(chunk)) await new Promise((resume) => writer.once('drain', resume));
            emitDesktopUpdateProgress({
              version: status.version,
              fileName: path.basename(targetPath),
              downloadedBytes,
              totalBytes,
              progress: totalBytes ? Math.round((downloadedBytes / totalBytes) * 1000) / 10 : 0
            });
          }
          writer.end();
        } catch (error) {
          writer.destroy(error);
        }
      });
      fs.renameSync(temporaryPath, targetPath);
    } else {
      const buffer = Buffer.from(await response.arrayBuffer());
      fs.writeFileSync(targetPath, buffer);
    }
  } else {
    fs.copyFileSync(localPathFromLocation(status.installerUrl), targetPath);
  }
  const size = fs.statSync(targetPath).size;
  if (status.size && Number(status.size) !== size) throw new Error('update_installer_size_mismatch');
  const sha256 = sha256File(targetPath);
  if (status.sha256 && String(status.sha256).toLowerCase() !== sha256) throw new Error('update_installer_sha256_mismatch');
  emitDesktopUpdateProgress({
    version: status.version,
    fileName: path.basename(targetPath),
    downloadedBytes: size,
    totalBytes: size,
    progress: 100,
    status: 'completed'
  });
  return { targetPath, size, sha256 };
}

function updaterRunnerPath() {
  return userDataPath('run-update.ps1');
}

function writeUpdateRunner(installerPath) {
  const installDir = path.dirname(process.execPath);
  const exePath = process.execPath;
  const logPath = userDataPath('run-update.log');
  const statusPath = updateStatusPath();
  const expectedVersion = readUpdateStatus().version || '';
  const script = [
    '$ErrorActionPreference = "Continue"',
    `$logPath = ${JSON.stringify(logPath)}`,
    `$statusPath = ${JSON.stringify(statusPath)}`,
    `$expectedVersion = ${JSON.stringify(expectedVersion)}`,
    `$exePath = ${JSON.stringify(exePath)}`,
    `$installDir = ${JSON.stringify(installDir)}`,
    `$installerPath = ${JSON.stringify(installerPath)}`,
    '$logDir = Split-Path -Parent $logPath',
    'New-Item -ItemType Directory -Path $logDir -Force | Out-Null',
    'function Write-RunLog($message) { Add-Content -LiteralPath $logPath -Value ("{0} {1}" -f (Get-Date).ToString("s"), $message) -Encoding UTF8 }',
    'function Save-Status($patch) {',
    '  if (!(Test-Path -LiteralPath $statusPath)) { return }',
    '  try {',
    '    $status = Get-Content -LiteralPath $statusPath -Raw | ConvertFrom-Json',
    '    foreach ($key in $patch.Keys) { $status | Add-Member -NotePropertyName $key -NotePropertyValue $patch[$key] -Force }',
    '    $status | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $statusPath -Encoding UTF8',
    '  } catch { Write-RunLog ("status update failed: {0}" -f $_.Exception.Message) }',
    '}',
    'function Stop-PlChatProcesses {',
    '  for ($round = 1; $round -le 12; $round++) {',
    '    $targets = @()',
    '    try {',
    '      $targets = Get-Process -ErrorAction SilentlyContinue | Where-Object {',
    '        $_.ProcessName -eq "PL CHAT" -or',
    '        ($_.Path -and $installDir -and $_.Path.StartsWith($installDir, [System.StringComparison]::OrdinalIgnoreCase))',
    '      }',
    '    } catch { $targets = @() }',
    '    if (!$targets -or $targets.Count -eq 0) { return }',
    '    foreach ($p in $targets) {',
    '      Write-RunLog ("stopping PL CHAT pid={0} path={1}" -f $p.Id, $p.Path)',
    '      Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue',
    '    }',
    '    Start-Sleep -Seconds 2',
    '  }',
    '}',
    'Write-RunLog "runner started"',
    'Save-Status @{ state = "installing"; installStartedAt = (Get-Date).ToUniversalTime().ToString("o"); message = "Closing PL CHAT and installing update..." }',
    'Start-Sleep -Seconds 3',
    'Stop-PlChatProcesses',
    'Start-Sleep -Seconds 2',
    'Write-RunLog ("starting installer: {0}" -f $installerPath)',
    '$installerProcess = Start-Process -FilePath $installerPath -ArgumentList "/S" -Wait -PassThru',
    'Write-RunLog ("installer finished exitCode={0}" -f $installerProcess.ExitCode)',
    'Start-Sleep -Seconds 4',
    '$installedVersion = ""',
    'if (Test-Path -LiteralPath $exePath) {',
    '  $item = Get-Item -LiteralPath $exePath',
    '  $installedVersion = $item.VersionInfo.ProductVersion',
    '  if (!$installedVersion) { $installedVersion = $item.VersionInfo.FileVersion }',
    '}',
    'Write-RunLog ("installed version={0}" -f $installedVersion)',
    'Save-Status @{ installExitCode = $installerProcess.ExitCode; installFinishedAt = (Get-Date).ToUniversalTime().ToString("o"); detectedVersion = $installedVersion; message = "Installer finished. PL CHAT will verify the runtime version after restart." }',
    'if (Test-Path -LiteralPath $exePath) { Start-Process -FilePath $exePath; Write-RunLog "restarted app" }',
    'Write-RunLog "runner finished"',
    ''
  ].join('\r\n');
  fs.writeFileSync(updaterRunnerPath(), script, 'utf8');
  return { runnerPath: updaterRunnerPath(), installDir, exePath };
}

async function openDownloadedInstaller(quitAfterOpen = false) {
  const status = readUpdateStatus();
  if (!status.installerPath || !fs.existsSync(status.installerPath)) throw new Error('downloaded_installer_missing');
  if (quitAfterOpen && process.platform === 'win32') {
    const runner = writeUpdateRunner(status.installerPath);
    const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', runner.runnerPath], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    });
    child.unref();
    appendUpdateHistory('auto-update-runner-started', {
      installerPath: status.installerPath,
      runnerPath: runner.runnerPath,
      version: status.version
    });
    const nextStatus = saveUpdateStatus({
      ...status,
      state: 'installing',
      installStartedAt: new Date().toISOString(),
      message: 'PL CHAT is closing to install the downloaded update.'
    });
    isQuitting = true;
    setTimeout(() => app.exit(0), 600);
    return nextStatus;
  }
  const openError = await shell.openPath(status.installerPath);
  if (openError) throw new Error(openError);
  appendUpdateHistory(quitAfterOpen ? 'restart-and-install-opened' : 'install-opened', {
    installerPath: status.installerPath,
    version: status.version
  });
  const nextStatus = saveUpdateStatus({
    ...status,
    state: 'installer-opened',
    message: 'PL CHAT Setup installer has been opened. Complete the installer to update the Desktop App.'
  });
  if (quitAfterOpen) setTimeout(() => app.quit(), 500);
  return nextStatus;
}

function syncStartWithWindows(enabled) {
  if (process.platform !== 'win32' || !app.isPackaged) return;
  app.setLoginItemSettings({
    openAtLogin: Boolean(enabled),
    openAsHidden: false,
    path: process.execPath
  });
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function openInternalTarget(target) {
  showMainWindow();
  const safeTarget = safeInternalTarget(target);
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.webContents.isLoading()) {
    mainWindow.webContents.once('did-finish-load', () => {
      mainWindow?.webContents.send('plchat:native-notification-click', safeTarget);
    });
    return;
  }
  mainWindow.webContents.send('plchat:native-notification-click', safeTarget);
}

function cleanNativeNotificationText(value, fallback) {
  const text = String(value || '').trim();
  const hits = (text.match(/(?:เธ|เน|โ|ย|ย|ย|โ€)/g) || []).length;
  if (!text || hits >= 3) return fallback;
  return text;
}

function showNativeNotification(payload = {}) {
  const preferences = readPreferences();
  if (!Notification.isSupported() || !preferences.notificationsEnabled || preferences.doNotDisturb) return false;
  const title = String(payload.title || APP_NAME).trim().slice(0, 120) || APP_NAME;
  const body = cleanNativeNotificationText(payload.body, 'มีข้อความใหม่จาก PL CHAT').slice(0, 500);
  const notification = new Notification({
    title,
    body,
    icon: fs.existsSync(path.join(__dirname, '..', 'assets', 'icon.png')) ? path.join(__dirname, '..', 'assets', 'icon.png') : path.join(__dirname, 'assets', 'icon.png'),
    silent: Boolean(payload.silent),
    urgency: payload.urgency === 'critical' ? 'critical' : 'normal'
  });
  notification.on('click', () => openInternalTarget(payload.targetUrl));
  notification.show();
  return true;
}

function buildTrayMenu() {
  const preferences = readPreferences();
  return Menu.buildFromTemplate([
    { label: 'Open PL CHAT', click: showMainWindow },
    { type: 'separator' },
    {
      label: 'Notifications',
      type: 'checkbox',
      checked: preferences.notificationsEnabled,
      click: (item) => {
        savePreferences({ notificationsEnabled: item.checked });
        mainWindow?.webContents.send('plchat:desktop-preferences', readPreferences());
      }
    },
    {
      label: 'Do Not Disturb',
      type: 'checkbox',
      checked: preferences.doNotDisturb,
      click: (item) => {
        savePreferences({ doNotDisturb: item.checked });
        mainWindow?.webContents.send('plchat:desktop-preferences', readPreferences());
      }
    },
    {
      label: 'Test Notification',
      click: () => showNativeNotification({
        title: 'PL CHAT',
        body: 'เธเธฒเธฃเนเธเนเธเน€เธ•เธทเธญเธเธเธเธเธญเธกเธเธดเธงเน€เธ•เธญเธฃเนเธเธฃเนเธญเธกเนเธเนเธเธฒเธเนเธฅเนเธง',
        targetUrl: '/notifications'
      })
    },
    {
      label: 'Keep PL CHAT in Tray on Close',
      type: 'checkbox',
      checked: preferences.minimizeToTray,
      click: (item) => {
        savePreferences({ minimizeToTray: item.checked });
        refreshTrayMenu();
      }
    },
    {
      label: 'Start with Windows',
      type: 'checkbox',
      checked: preferences.startWithWindows,
      click: (item) => {
        savePreferences({ startWithWindows: item.checked });
        syncStartWithWindows(item.checked);
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);
}

function refreshTrayMenu() {
  tray?.setContextMenu(buildTrayMenu());
}

function createTray() {
  if (tray) return;
  const iconPath = process.platform === 'win32'
    ? path.join(__dirname, '..', 'assets', 'icon.ico')
    : path.join(__dirname, '..', 'assets', 'icon.png');
  const icon = nativeImage.createFromPath(iconPath);
  tray = new Tray(icon);
  tray.setToolTip(APP_NAME);
  refreshTrayMenu();
  tray.on('click', showMainWindow);
  tray.on('double-click', showMainWindow);
}

function saveCurrentWindowState() {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMinimized()) return;
  const bounds = mainWindow.isMaximized() ? mainWindow.getNormalBounds() : mainWindow.getBounds();
  safeWriteJson(windowStatePath(), { ...bounds, maximized: mainWindow.isMaximized() });
}

function scheduleWindowStateSave() {
  clearTimeout(saveWindowTimer);
  saveWindowTimer = setTimeout(saveCurrentWindowState, 250);
}

function showWindowIfHidden() {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isVisible()) return;
  mainWindow.show();
}

function isMainWindowAlive() {
  return Boolean(mainWindow && !mainWindow.isDestroyed());
}

let offlinePageLoadInFlight = false;
let lastOfflinePageKey = '';
let lastOfflinePageAt = 0;

function showOfflinePage(reason = 'offline') {
  if (!isMainWindowAlive()) return;
  clearTimeout(workspaceLoadTimer);
  const appUrl = getAppUrl();
  const offlinePageKey = `${reason}:${appUrl}`;
  const now = Date.now();
  if (offlinePageLoadInFlight && offlinePageKey === lastOfflinePageKey && now - lastOfflinePageAt < 1500) {
    appendDesktopLog('show-offline-page-skip-duplicate', { reason, appUrl });
    return;
  }
  offlinePageLoadInFlight = true;
  lastOfflinePageKey = offlinePageKey;
  lastOfflinePageAt = now;
  appendDesktopLog('show-offline-page', { reason, appUrl });
  showWindowIfHidden();
  if (!isMainWindowAlive()) {
    offlinePageLoadInFlight = false;
    return;
  }
  mainWindow.loadFile(path.join(__dirname, 'offline.html'), { query: { appUrl, reason } })
    .catch((error) => appendDesktopLog('offline-page-load-failed', { reason, appUrl, error: error?.message || String(error) }))
    .finally(() => {
      offlinePageLoadInFlight = false;
    });
}

function loadWorkspace() {
  if (!isMainWindowAlive()) return;
  const appUrl = getAppUrl();
  clearTimeout(workspaceLoadTimer);
  appendDesktopLog('load-workspace-start', { appUrl });
  workspaceLoadTimer = setTimeout(() => {
    if (!isMainWindowAlive()) return;
    showOfflinePage('server-timeout');
  }, 7000);
  setTimeout(showWindowIfHidden, 1200);
  mainWindow.loadURL(appUrl).catch((error) => {
    appendDesktopLog('load-workspace-failed', { appUrl, error: error?.message || String(error) });
    if (!isMainWindowAlive()) return;
    showOfflinePage('load-failed');
  });
}

async function testServerConnection(targetUrl = getAppUrl()) {
  const appUrl = validAppUrl(targetUrl) || getAppUrl();
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(appUrl, { cache: 'no-store', signal: controller.signal });
    return {
      ok: response.ok,
      appUrl,
      status: response.status,
      elapsedMs: Date.now() - startedAt,
      message: response.ok ? 'PL CHAT host is reachable.' : `Host responded with HTTP ${response.status}.`
    };
  } catch (error) {
    return {
      ok: false,
      appUrl,
      status: null,
      elapsedMs: Date.now() - startedAt,
      message: error?.name === 'AbortError' ? 'Connection timed out.' : (error?.message || String(error))
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function clearDesktopRuntimeCache() {
  const result = { cache: false, storage: false };
  const browserSession = mainWindow?.webContents?.session;
  if (!browserSession) return result;
  await browserSession.clearCache();
  result.cache = true;
  await browserSession.clearStorageData({
    storages: ['appcache', 'shadercache', 'serviceworkers', 'cachestorage']
  }).catch(() => {});
  result.storage = true;
  appendDesktopLog('desktop-cache-cleared', { appUrl: getAppUrl() });
  appendUpdateHistory('desktop-cache-cleared', { appUrl: getAppUrl() });
  return result;
}

function desktopDiagnosticSummary() {
  return {
    appUrl: getAppUrl(),
    defaultAppUrl: DEFAULT_APP_URL,
    configPath: desktopConfigPath(),
    bundledConfigPath: bundledConfigPath(),
    userDataPath: app.getPath('userData'),
    startupLogPath: userDataPath('desktop-startup.log'),
    updateStatusPath: updateStatusPath(),
    updateHistoryPath: updateHistoryPath(),
    updateDownloadDirectory: updateDownloadDirectory(),
    appVersion: app.getVersion(),
    isPackaged: app.isPackaged,
    platform: process.platform,
    updateFeedUrl: getUpdateFeedUrl() || null
  };
}



const desktopDownloadJobs = new Map();
const desktopDownloadControllers = new Map();

function desktopDownloadsStatePath() {
  return userDataPath('desktop-downloads.json');
}

function readDesktopDownloadState() {
  const data = safeReadJson(desktopDownloadsStatePath(), { jobs: [] });
  return Array.isArray(data.jobs) ? data : { jobs: [] };
}

function saveDesktopDownloadState(patchJob) {
  const state = readDesktopDownloadState();
  const index = state.jobs.findIndex((job) => job.id === patchJob.id);
  if (index >= 0) state.jobs[index] = { ...state.jobs[index], ...patchJob };
  else state.jobs.unshift(patchJob);
  state.jobs = state.jobs.slice(0, 80);
  safeWriteJson(desktopDownloadsStatePath(), state);
  return patchJob;
}

function safeDownloadName(value) {
  return String(value || 'download.bin').replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').slice(0, 180) || 'download.bin';
}

function uniqueDownloadPath(fileName) {
  const downloadsDir = path.join(app.getPath('downloads'), 'PL CHAT Downloads');
  fs.mkdirSync(downloadsDir, { recursive: true });
  const parsed = path.parse(safeDownloadName(fileName));
  let candidate = path.join(downloadsDir, parsed.name + parsed.ext);
  let counter = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(downloadsDir, parsed.name + ' (' + counter + ')' + parsed.ext);
    counter += 1;
  }
  return candidate;
}

function safeDownloadFolderName(value) {
  return String(value || `PL CHAT Album ${new Date().toISOString().slice(0, 10)}`)
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'PL CHAT Album';
}

function uniqueDownloadPathInFolder(fileName, folderName) {
  const downloadsRoot = path.join(app.getPath('downloads'), 'PL CHAT Downloads');
  const folderPath = path.join(downloadsRoot, safeDownloadFolderName(folderName));
  fs.mkdirSync(folderPath, { recursive: true });
  const parsed = path.parse(safeDownloadName(fileName));
  let candidate = path.join(folderPath, parsed.name + parsed.ext);
  let counter = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(folderPath, parsed.name + ' (' + counter + ')' + parsed.ext);
    counter += 1;
  }
  return candidate;
}

function desktopDownloadsRoot() {
  const downloadsRoot = path.join(app.getPath('downloads'), 'PL CHAT Downloads');
  fs.mkdirSync(downloadsRoot, { recursive: true });
  return downloadsRoot;
}

function desktopPartDir(jobId) {
  const dir = path.join(app.getPath('userData'), 'download-parts', jobId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function publicDownloadJob(job) {
  const destinationFolder = job.destination ? path.dirname(job.destination) : '';
  return {
    id: job.id,
    fileName: job.fileName,
    fileId: job.fileId || '',
    destination: job.destination,
    destinationFolder,
    status: job.status,
    totalBytes: job.totalBytes,
    downloadedBytes: job.downloadedBytes || 0,
    progress: job.totalBytes ? Math.round(((job.downloadedBytes || 0) / job.totalBytes) * 1000) / 10 : 0,
    speed: Number(job.speed || 0),
    etaSeconds: Number(job.etaSeconds || 0),
    parallel: Boolean(job.parallel),
    concurrency: Number(job.concurrency || 1),
    route: job.route || 'standard',
    probe: job.probe || '',
    activeParts: job.parts?.filter((part) => part.active).length || 0,
    doneParts: job.parts?.filter((part) => part.done).length || 0,
    totalParts: job.parts?.length || 0,
    parts: job.parts?.map((part) => ({ index: part.index, start: part.start, end: part.end, done: Boolean(part.done), bytes: part.bytes || 0 })) || [],
    verified: Boolean(job.verified),
    error: job.error || null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt || null,
    batchId: job.batchId || '',
    batchFolder: job.batchFolder || ''
  };
}

function emitDesktopDownload(job) {
  mainWindow?.webContents.send('plchat:desktop-download-updated', publicDownloadJob(job));
}

function parseContentRangeTotal(value) {
  const match = String(value || '').match(/\/(\d+)$/);
  return match ? Number(match[1]) : 0;
}

async function fetchDownloadProbe(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(options.timeoutMs || 8000));
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchHeaders(url) {
  try {
    const response = await fetchDownloadProbe(url, { method: 'HEAD' });
    if (!response.ok) return {};
    const totalFromRange = parseContentRangeTotal(response.headers.get('content-range'));
    return {
      contentLength: totalFromRange || Number(response.headers.get('content-length') || 0),
      acceptRanges: response.status === 206 || /bytes/i.test(response.headers.get('accept-ranges') || ''),
      etag: response.headers.get('etag') || '',
      probe: 'head'
    };
  } catch {
    // Signed MinIO download URLs are signed for GET, so HEAD can be rejected even when ranged GET works.
  }
  try {
    const response = await fetchDownloadProbe(url, { headers: { Range: 'bytes=0-0' } });
    if (![200, 206].includes(response.status)) return {};
    response.body?.cancel?.().catch?.(() => {});
    const totalFromRange = parseContentRangeTotal(response.headers.get('content-range'));
    return {
      contentLength: totalFromRange || Number(response.headers.get('content-length') || 0),
      acceptRanges: response.status === 206 || /bytes/i.test(response.headers.get('accept-ranges') || ''),
      etag: response.headers.get('etag') || '',
      probe: 'range-get'
    };
  } catch {
    return {};
  }
}

function sameDownloadUrl(left, right) {
  try {
    return new URL(String(left || '')).toString() === new URL(String(right || '')).toString();
  } catch {
    return String(left || '') === String(right || '');
  }
}

function makeDesktopParts(totalBytes, count) {
  const parts = [];
  const partSize = Math.ceil(totalBytes / count);
  for (let index = 0; index < count; index += 1) {
    const start = index * partSize;
    const end = Math.min(totalBytes - 1, start + partSize - 1);
    if (start <= end) parts.push({ index, start, end, done: false, bytes: 0 });
  }
  return parts;
}

function isQuickTunnelDownloadUrl(value) {
  try {
    return /\.trycloudflare\.com$/i.test(new URL(value).hostname);
  } catch {
    return false;
  }
}

function desktopDownloadConnectionPlan(url, totalBytes) {
  const quickTunnel = isQuickTunnelDownloadUrl(url);
  if (quickTunnel) {
    const concurrency = totalBytes >= 512 * 1024 * 1024 ? 4 : totalBytes >= 128 * 1024 * 1024 ? 3 : 2;
    return {
      concurrency,
      fallbackConcurrency: concurrency >= 4 ? [3, 2, 1] : concurrency >= 3 ? [2, 1] : [1],
      route: 'quick_tunnel'
    };
  }
  return {
    concurrency: totalBytes >= 1024 * 1024 * 1024 ? 6 : 4,
    fallbackConcurrency: [2, 1],
    route: 'standard'
  };
}

function updateDesktopDownloadProgress(job, options = {}) {
  job.downloadedBytes = job.parts.reduce((total, item) => total + Number(item.bytes || 0), 0);
  const elapsedSeconds = Math.max((Date.now() - Number(job.startedAt || Date.now())) / 1000, 0.1);
  job.speed = Math.round(job.downloadedBytes / elapsedSeconds);
  const remainingBytes = Math.max(0, Number(job.totalBytes || 0) - Number(job.downloadedBytes || 0));
  job.etaSeconds = job.speed > 0 ? Math.ceil(remainingBytes / job.speed) : 0;
  job.updatedAt = new Date().toISOString();
  const now = Date.now();
  const force = Boolean(options.force) || job.status !== 'downloading';
  if (force || !job.lastProgressEmitAt || now - job.lastProgressEmitAt >= 250) {
    job.lastProgressEmitAt = now;
    saveDesktopDownloadState(job);
    emitDesktopDownload(job);
  }
}

async function streamResponseToFile(response, filePath, onChunk) {
  if (!response.body) throw new Error('download_response_empty');
  const writer = fs.createWriteStream(filePath, { flags: 'w' });
  const reader = response.body.getReader?.();
  if (!reader) {
    const { pipeline } = require('stream/promises');
    const { Readable } = require('stream');
    await pipeline(Readable.fromWeb(response.body), writer);
    return;
  }
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      if (onChunk) onChunk(chunk.length);
      if (!writer.write(chunk)) await new Promise((resolve) => writer.once('drain', resolve));
    }
    writer.end();
    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });
  } catch (error) {
    writer.destroy();
    throw error;
  }
}

async function writePartToFinal(partPath, writer, hash) {
  for await (const chunk of fs.createReadStream(partPath)) {
    hash.update(chunk);
    if (!writer.write(chunk)) {
      await new Promise((resolve) => writer.once('drain', resolve));
    }
  }
}

async function downloadDesktopPart(job, part, controller) {
  if (part.done) return;
  part.active = true;
  part.bytes = 0;
  updateDesktopDownloadProgress(job);
  const response = await fetch(job.url, {
    headers: job.parallel ? { Range: `bytes=${part.start}-${part.end}` } : {},
    signal: controller.signal
  });
  if (!response.ok || (job.parallel && response.status !== 206)) {
    part.active = false;
    updateDesktopDownloadProgress(job, { force: true });
    throw new Error(`download_part_failed:${response.status}`);
  }
  const partPath = path.join(desktopPartDir(job.id), `part-${part.index}`);
  try {
    await streamResponseToFile(response, partPath, (chunkBytes) => {
      part.bytes = Number(part.bytes || 0) + chunkBytes;
      updateDesktopDownloadProgress(job);
    });
  } catch (error) {
    part.active = false;
    updateDesktopDownloadProgress(job, { force: true });
    throw error;
  }
  const stat = fs.statSync(partPath);
  const expected = part.end - part.start + 1;
  if (job.parallel && stat.size !== expected) throw new Error(`download_part_size_mismatch:${part.index}`);
  part.done = true;
  part.active = false;
  part.bytes = stat.size;
  updateDesktopDownloadProgress(job, { force: true });
}

async function combineDesktopParts(job) {
  const { createHash } = require('crypto');
  const hash = createHash('sha256');
  const writer = fs.createWriteStream(job.destination, { flags: 'w' });
  try {
    for (const part of job.parts) {
      const partPath = path.join(desktopPartDir(job.id), `part-${part.index}`);
      await writePartToFinal(partPath, writer, hash);
    }
    writer.end();
    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });
  } catch (error) {
    writer.destroy();
    throw error;
  }
  const finalSize = fs.statSync(job.destination).size;
  if (job.totalBytes && finalSize !== job.totalBytes) throw new Error('download_size_verification_failed');
  job.sha256 = hash.digest('hex');
  if (job.expectedSha256 && job.sha256 !== job.expectedSha256) throw new Error('download_hash_verification_failed');
  job.verified = true;
}

function resetDesktopDownloadParts(job, concurrency) {
  fs.rmSync(desktopPartDir(job.id), { recursive: true, force: true });
  const selected = Math.max(1, Number(concurrency || 1));
  job.parallel = selected > 1;
  job.concurrency = selected;
  job.downloadedBytes = 0;
  job.parts = job.parallel
    ? makeDesktopParts(job.totalBytes, selected)
    : [{ index: 0, start: 0, end: Math.max(0, job.totalBytes - 1), done: false, bytes: 0 }];
}

async function runDesktopDownload(jobId) {
  const job = desktopDownloadJobs.get(jobId);
  if (!job || job.status === 'completed') return publicDownloadJob(job);
  const controller = new AbortController();
  desktopDownloadControllers.set(jobId, controller);
  try {
    job.status = 'downloading';
    job.startedAt ||= Date.now();
    job.updatedAt = new Date().toISOString();
    saveDesktopDownloadState(job);
    emitDesktopDownload(job);
    if (!job.parts?.length) {
      job.parts = [{ index: 0, start: 0, end: Math.max(0, job.totalBytes - 1), done: false, bytes: 0 }];
      job.parallel = false;
    }
    const concurrency = job.parallel ? Math.min(6, Math.max(2, Number(job.concurrency || 4))) : 1;
    let nextIndex = 0;
    const workers = Array.from({ length: concurrency }, async () => {
      while (nextIndex < job.parts.length) {
        const part = job.parts[nextIndex];
        nextIndex += 1;
        await downloadDesktopPart(job, part, controller);
      }
    });
    await Promise.all(workers);
    await combineDesktopParts(job);
    job.status = 'completed';
    job.completedAt = new Date().toISOString();
    job.updatedAt = job.completedAt;
    saveDesktopDownloadState(job);
    emitDesktopDownload(job);
    if (Notification.isSupported()) new Notification({ title: 'PL CHAT', body: `เธ”เธฒเธงเธเนเนเธซเธฅเธ”เน€เธชเธฃเนเธเนเธฅเนเธง: ${job.fileName}` }).show();
  } catch (error) {
    if (controller.signal.aborted || job.status === 'paused') {
      job.status = 'paused';
      job.error = null;
    } else if (job.parallel && Array.isArray(job.fallbackConcurrency) && job.fallbackConcurrency.length) {
      const nextConcurrency = Number(job.fallbackConcurrency.shift() || 1);
      resetDesktopDownloadParts(job, nextConcurrency);
      job.status = 'queued';
      job.error = `retrying_with_concurrency_${nextConcurrency}`;
      job.updatedAt = new Date().toISOString();
      saveDesktopDownloadState(job);
      emitDesktopDownload(job);
      setTimeout(() => runDesktopDownload(job.id), 250);
    } else if (job.fallbackUrl && !sameDownloadUrl(job.url, job.fallbackUrl)) {
      job.url = job.fallbackUrl;
      job.route = `${job.route || 'standard'}_fallback`;
      job.fallbackUrl = '';
      job.error = 'retrying_with_fallback_url';
      const headers = await fetchHeaders(job.url);
      if (headers.contentLength) job.totalBytes = Number(headers.contentLength);
      resetDesktopDownloadParts(job, 1);
      job.status = 'queued';
      job.updatedAt = new Date().toISOString();
      saveDesktopDownloadState(job);
      emitDesktopDownload(job);
      setTimeout(() => runDesktopDownload(job.id), 250);
    } else {
      job.status = 'failed';
      job.error = error?.message || 'download_failed';
    }
    job.updatedAt = new Date().toISOString();
    saveDesktopDownloadState(job);
    emitDesktopDownload(job);
  } finally {
    desktopDownloadControllers.delete(jobId);
  }
  return publicDownloadJob(job);
}

ipcMain.handle('plchat:download:start', async (_event, payload = {}) => {
  const targetUrl = String(payload.url || '').trim();
  const parsed = new URL(targetUrl);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('invalid_download_url');
  const fallbackUrl = payload.fallbackUrl ? new URL(String(payload.fallbackUrl), targetUrl).toString() : '';
  const headers = await fetchHeaders(targetUrl);
  const totalBytes = Number(payload.expectedBytes || headers.contentLength || 0);
  const connectionPlan = desktopDownloadConnectionPlan(targetUrl, totalBytes);
  const parallelAllowed = Boolean(payload.parallel !== false && totalBytes >= 64 * 1024 * 1024 && (headers.acceptRanges || parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'));
  const initialConcurrency = parallelAllowed ? connectionPlan.concurrency : 1;
  const id = `dl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const fileName = safeDownloadName(payload.fileName || path.basename(parsed.pathname) || 'download.bin');
  const job = {
    id,
    url: targetUrl,
    fallbackUrl,
    fileName,
    fileId: payload.fileId || '',
    destination: uniqueDownloadPath(fileName),
    totalBytes,
    expectedSha256: payload.sha256 || '',
    status: 'queued',
    parallel: parallelAllowed,
    concurrency: initialConcurrency,
    fallbackConcurrency: parallelAllowed ? connectionPlan.fallbackConcurrency : [],
    route: connectionPlan.route,
    probe: headers.probe || '',
    downloadedBytes: 0,
    parts: parallelAllowed ? makeDesktopParts(totalBytes, initialConcurrency) : [{ index: 0, start: 0, end: Math.max(0, totalBytes - 1), done: false, bytes: 0 }],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  desktopDownloadJobs.set(id, job);
  saveDesktopDownloadState(job);
  emitDesktopDownload(job);
  runDesktopDownload(id);
  return { ok: true, job: publicDownloadJob(job) };
});

ipcMain.handle('plchat:download:batch-start', async (_event, payload = {}) => {
  const files = Array.isArray(payload.files) ? payload.files.slice(0, 100) : [];
  if (!files.length) throw new Error('batch_download_files_required');
  const folderName = safeDownloadFolderName(payload.folderName || `PL CHAT Album ${new Date().toISOString().replace(/[:.]/g, '-')}`);
  const jobs = [];
  const baseUrl = String(payload.baseUrl || getAppUrl() || '').trim();
  for (const item of files) {
    const targetUrl = new URL(String(item.url || '').trim(), baseUrl || undefined).toString();
    const parsed = new URL(targetUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('invalid_download_url');
    const fallbackUrl = item.fallbackUrl ? new URL(String(item.fallbackUrl), targetUrl).toString() : '';
    const headers = await fetchHeaders(targetUrl);
    const totalBytes = Number(item.expectedBytes || headers.contentLength || 0);
    const connectionPlan = desktopDownloadConnectionPlan(targetUrl, totalBytes);
    const parallelAllowed = Boolean(item.parallel !== false && totalBytes >= 64 * 1024 * 1024 && (headers.acceptRanges || parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'));
    const initialConcurrency = parallelAllowed ? connectionPlan.concurrency : 1;
    const id = `dl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const fileName = safeDownloadName(item.fileName || path.basename(parsed.pathname) || 'download.bin');
    const job = {
      id,
      url: targetUrl,
      fallbackUrl,
      fileName,
      fileId: item.fileId || '',
      destination: uniqueDownloadPathInFolder(fileName, folderName),
      totalBytes,
      expectedSha256: item.sha256 || '',
      status: 'queued',
      parallel: parallelAllowed,
      concurrency: initialConcurrency,
      fallbackConcurrency: parallelAllowed ? connectionPlan.fallbackConcurrency : [],
      route: connectionPlan.route,
      probe: headers.probe || '',
      downloadedBytes: 0,
      parts: parallelAllowed ? makeDesktopParts(totalBytes, initialConcurrency) : [{ index: 0, start: 0, end: Math.max(0, totalBytes - 1), done: false, bytes: 0 }],
      batchId: payload.batchId || '',
      batchFolder: folderName,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    desktopDownloadJobs.set(id, job);
    saveDesktopDownloadState(job);
    emitDesktopDownload(job);
    runDesktopDownload(id);
    jobs.push(publicDownloadJob(job));
  }
  return {
    ok: true,
    folderName,
    destinationFolder: path.dirname(desktopDownloadJobs.get(jobs[0].id)?.destination || ''),
    jobs
  };
});

ipcMain.handle('plchat:download:pause', (_event, id) => {
  const job = desktopDownloadJobs.get(String(id));
  if (!job) throw new Error('download_not_found');
  job.status = 'paused';
  desktopDownloadControllers.get(job.id)?.abort();
  saveDesktopDownloadState(job);
  emitDesktopDownload(job);
  return publicDownloadJob(job);
});

ipcMain.handle('plchat:download:resume', (_event, id) => {
  const job = desktopDownloadJobs.get(String(id));
  if (!job) throw new Error('download_not_found');
  runDesktopDownload(job.id);
  return publicDownloadJob(job);
});

ipcMain.handle('plchat:download:list', () => {
  const state = readDesktopDownloadState();
  for (const job of state.jobs) if (!desktopDownloadJobs.has(job.id)) desktopDownloadJobs.set(job.id, job);
  return state.jobs.map(publicDownloadJob);
});

ipcMain.handle('plchat:download:clear-history', () => {
  const keepStatuses = new Set(['queued', 'downloading', 'paused']);
  const state = readDesktopDownloadState();
  const kept = [];
  for (const job of state.jobs) {
    if (keepStatuses.has(job.status)) {
      kept.push(job);
      desktopDownloadJobs.set(job.id, job);
    } else {
      desktopDownloadJobs.delete(job.id);
    }
  }
  safeWriteJson(desktopDownloadsStatePath(), { jobs: kept });
  return kept.map(publicDownloadJob);
});

ipcMain.handle('plchat:download:show-in-folder', (_event, id) => {
  const job = desktopDownloadJobs.get(String(id)) || readDesktopDownloadState().jobs.find((item) => item.id === String(id));
  if (!job?.destination && !job?.batchFolder) throw new Error('download_not_found');
  if (fs.existsSync(job.destination)) {
    shell.showItemInFolder(job.destination);
    return { ok: true, path: job.destination };
  }
  const folder = job.destination
    ? path.dirname(job.destination)
    : path.join(app.getPath('downloads'), 'PL CHAT Downloads', safeDownloadFolderName(job.batchFolder));
  if (fs.existsSync(folder)) {
    shell.openPath(folder);
    return { ok: true, path: folder };
  }
  const fallbackFolder = desktopDownloadsRoot();
  shell.openPath(fallbackFolder);
  return { ok: true, path: fallbackFolder };
});

ipcMain.handle('plchat:download:open-file', async (_event, id) => {
  const job = desktopDownloadJobs.get(String(id)) || readDesktopDownloadState().jobs.find((item) => item.id === String(id));
  if (!job?.destination) throw new Error('download_not_found');
  if (!fs.existsSync(job.destination)) throw new Error('download_file_not_found');
  const error = await shell.openPath(job.destination);
  if (error) throw new Error(error);
  return { ok: true, path: job.destination };
});

ipcMain.handle('plchat:download:open-folder', (_event, id) => {
  const job = desktopDownloadJobs.get(String(id)) || readDesktopDownloadState().jobs.find((item) => item.id === String(id));
  if (!job?.destination && !job?.batchFolder) throw new Error('download_not_found');
  const folder = job.destination
    ? path.dirname(job.destination)
    : path.join(app.getPath('downloads'), 'PL CHAT Downloads', safeDownloadFolderName(job.batchFolder));
  if (!fs.existsSync(folder)) {
    const fallbackFolder = desktopDownloadsRoot();
    shell.openPath(fallbackFolder);
    return { ok: true, path: fallbackFolder };
  }
  shell.openPath(folder);
  return { ok: true, path: folder };
});

const desktopUploadJobs = new Map();
const desktopUploadControllers = new Map();

function desktopUploadsStatePath() {
  return userDataPath('desktop-uploads.json');
}

function readDesktopUploadState() {
  const data = safeReadJson(desktopUploadsStatePath(), { jobs: [] });
  return Array.isArray(data.jobs) ? data : { jobs: [] };
}

function saveDesktopUploadState(patchJob) {
  const state = readDesktopUploadState();
  const index = state.jobs.findIndex((job) => job.id === patchJob.id);
  const publicPatch = publicUploadJob(patchJob);
  if (index >= 0) state.jobs[index] = { ...state.jobs[index], ...publicPatch };
  else state.jobs.unshift(publicPatch);
  state.jobs = state.jobs.slice(0, 80);
  safeWriteJson(desktopUploadsStatePath(), state);
  return patchJob;
}

function publicUploadJob(job) {
  return {
    id: job.id,
    clientItemId: job.clientItemId || '',
    uploadId: job.uploadId || '',
    fileName: job.fileName || '',
    filePath: job.filePath || '',
    fileSize: Number(job.fileSize || 0),
    mimeType: job.mimeType || 'application/octet-stream',
    roomId: job.roomId || '',
    status: job.status || 'queued',
    mode: job.mode || '',
    uploadedBytes: Number(job.uploadedBytes || 0),
    progress: job.fileSize ? Math.min(100, Math.round((Number(job.uploadedBytes || 0) / Number(job.fileSize || 1)) * 1000) / 10) : 0,
    speed: Number(job.speed || 0),
    concurrency: Number(job.concurrency || 1),
    partSizeBytes: Number(job.partSizeBytes || 0),
    totalParts: Number(job.totalParts || 0),
    completedParts: Array.isArray(job.completedParts) ? job.completedParts : [],
    route: job.route || 'desktop_native',
    sha256: job.sha256 || '',
    error: job.error || null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt || null,
    attachment: job.attachment || null
  };
}

function emitDesktopUpload(job) {
  mainWindow?.webContents.send('plchat:desktop-upload-updated', publicUploadJob(job));
}

function desktopApiUrl(baseUrl, pathname) {
  return new URL(pathname, String(baseUrl || getAppUrl()).replace(/\/+$/, '/') ).toString();
}

async function desktopApiJson(job, pathname, options = {}) {
  const response = await fetch(desktopApiUrl(job.baseUrl, pathname), {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${job.token}`,
      Accept: 'application/json'
    },
    signal: options.signal
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || body.message || `desktop_api_failed:${response.status}`);
  return body;
}

function createProgressFileStream(job, start, endInclusive, onProgress) {
  const { Transform } = require('stream');
  let loaded = 0;
  const stream = fs.createReadStream(job.filePath, { start, end: endInclusive });
  const counter = new Transform({
    transform(chunk, _encoding, callback) {
      loaded += chunk.length;
      if (onProgress) onProgress(loaded);
      callback(null, chunk);
    }
  });
  return stream.pipe(counter);
}

function updateDesktopUploadProgress(job, loadedByPart) {
  const uploaded = [...loadedByPart.values()].reduce((total, value) => total + Number(value || 0), 0);
  job.uploadedBytes = Math.min(Number(job.fileSize || 0), uploaded);
  const elapsedSeconds = Math.max((Date.now() - Number(job.startedAt || Date.now())) / 1000, 0.1);
  job.speed = Math.round(job.uploadedBytes / elapsedSeconds);
  job.updatedAt = new Date().toISOString();
  const now = Date.now();
  if (!job.lastEmitAt || now - job.lastEmitAt >= 250 || job.uploadedBytes >= job.fileSize) {
    job.lastEmitAt = now;
    saveDesktopUploadState(job);
    emitDesktopUpload(job);
  }
}

async function sha256DesktopFile(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

async function uploadDesktopBinary(job, controller) {
  const loadedByPart = new Map([[1, 0]]);
  const query = new URLSearchParams({ name: job.fileName, roomId: job.roomId || '' });
  const response = await fetch(desktopApiUrl(job.baseUrl, `/api/uploads/binary?${query.toString()}`), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${job.token}`,
      'Content-Type': job.mimeType || 'application/octet-stream',
      'X-File-Name': encodeURIComponent(job.fileName),
      'X-Room-Id': job.roomId || '',
      'Content-Length': String(job.fileSize)
    },
    body: createProgressFileStream(job, 0, Math.max(0, job.fileSize - 1), (loaded) => {
      loadedByPart.set(1, loaded);
      updateDesktopUploadProgress(job, loadedByPart);
    }),
    duplex: 'half',
    signal: controller.signal
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || body.message || 'desktop_binary_upload_failed');
  return body;
}

async function uploadDesktopMultipartPart(job, partNumber, controller, loadedByPart) {
  const retryLimit = Math.max(1, Number(job.retryLimit || 5));
  const start = (partNumber - 1) * job.partSizeBytes;
  const end = Math.min(job.fileSize, start + job.partSizeBytes);
  const bytes = Math.max(0, end - start);
  for (let attempt = 1; attempt <= retryLimit; attempt += 1) {
    if (job.status === 'paused') throw new Error('upload_paused');
    try {
      if (attempt > 1) {
        job.status = 'retrying';
        job.error = `retry_${attempt - 1}_part_${partNumber}`;
        emitDesktopUpload(job);
      }
      const signed = await desktopApiJson(job, `/api/uploads/multipart/${encodeURIComponent(job.uploadId)}/part-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partNumber }),
        signal: controller.signal
      });
      const partResponse = await fetch(signed.part?.url, {
        method: 'PUT',
        headers: { 'Content-Length': String(bytes) },
        body: createProgressFileStream(job, start, Math.max(start, end - 1), (loaded) => {
          loadedByPart.set(partNumber, loaded);
          updateDesktopUploadProgress(job, loadedByPart);
        }),
        duplex: 'half',
        signal: controller.signal
      });
      if (!partResponse.ok) throw new Error(`desktop_multipart_part_failed:${partResponse.status}`);
      const etag = partResponse.headers.get('ETag') || partResponse.headers.get('etag') || '';
      if (!etag) throw new Error('desktop_multipart_part_etag_missing');
      await desktopApiJson(job, `/api/uploads/multipart/${encodeURIComponent(job.uploadId)}/part-complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partNumber, etag }),
        signal: controller.signal
      });
      loadedByPart.set(partNumber, bytes);
      updateDesktopUploadProgress(job, loadedByPart);
      return { partNumber, etag };
    } catch (error) {
      if (controller.signal.aborted || job.status === 'paused') throw new Error('upload_paused');
      if (attempt >= retryLimit) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }
  throw new Error('desktop_multipart_part_failed');
}

async function uploadDesktopMultipart(job, controller) {
  let init = null;
  if (job.uploadId) {
    init = await desktopApiJson(job, `/api/uploads/multipart/${encodeURIComponent(job.uploadId)}/status`, { signal: controller.signal }).catch(() => null);
  }
  if (!init?.upload) {
    init = await desktopApiJson(job, '/api/uploads/multipart/init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: job.fileName,
        mimeType: job.mimeType,
        size: job.fileSize,
        roomId: job.roomId || '',
        concurrency: job.concurrency
      }),
      signal: controller.signal
    });
  }
  const upload = init.upload || {};
  job.uploadId = upload.uploadId || job.uploadId;
  job.partSizeBytes = Number(upload.partSizeBytes || job.partSizeBytes || 32 * 1024 * 1024);
  job.totalParts = Number(upload.totalParts || Math.ceil(job.fileSize / job.partSizeBytes));
  job.concurrency = Math.min(job.totalParts, Math.max(1, Number(upload.concurrency || job.concurrency || 6)));
  job.route = upload.concurrencyRoute || 'desktop_native';
  job.completedParts = Array.isArray(upload.completedParts) ? upload.completedParts : [];
  job.mode = 'desktop-multipart';
  job.status = 'uploading';
  saveDesktopUploadState(job);
  emitDesktopUpload(job);

  const parts = new Array(job.totalParts);
  const loadedByPart = new Map();
  for (const savedPart of (upload.parts || [])) {
    const partNumber = Number(savedPart.partNumber || 0);
    if (partNumber >= 1 && partNumber <= job.totalParts && savedPart.etag) {
      parts[partNumber - 1] = { partNumber, etag: savedPart.etag };
      const start = (partNumber - 1) * job.partSizeBytes;
      loadedByPart.set(partNumber, Math.min(job.partSizeBytes, job.fileSize - start));
    }
  }
  updateDesktopUploadProgress(job, loadedByPart);
  let nextPartNumber = 1;
  const worker = async () => {
    while (nextPartNumber <= job.totalParts) {
      const partNumber = nextPartNumber;
      nextPartNumber += 1;
      if (parts[partNumber - 1]) continue;
      const part = await uploadDesktopMultipartPart(job, partNumber, controller, loadedByPart);
      parts[partNumber - 1] = part;
      job.completedParts = parts.filter(Boolean).map((item) => item.partNumber);
    }
  };
  await Promise.all(Array.from({ length: job.concurrency }, () => worker()));
  return desktopApiJson(job, `/api/uploads/multipart/${encodeURIComponent(job.uploadId)}/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ parts }),
    signal: controller.signal
  });
}

async function runDesktopUpload(jobId) {
  const job = desktopUploadJobs.get(jobId);
  if (!job || job.status === 'completed') return publicUploadJob(job);
  const controller = new AbortController();
  desktopUploadControllers.set(jobId, controller);
  try {
    job.status = 'uploading';
    job.startedAt ||= Date.now();
    job.updatedAt = new Date().toISOString();
    saveDesktopUploadState(job);
    emitDesktopUpload(job);
    const body = job.useMultipart ? await uploadDesktopMultipart(job, controller) : await uploadDesktopBinary(job, controller);
    job.attachment = body.attachment || body.attachments?.[0] || null;
    job.sha256 = await sha256DesktopFile(job.filePath).catch(() => '');
    job.status = 'completed';
    job.uploadedBytes = job.fileSize;
    job.progress = 100;
    job.error = null;
    job.completedAt = new Date().toISOString();
    job.updatedAt = job.completedAt;
    saveDesktopUploadState(job);
    emitDesktopUpload(job);
    return { ok: true, attachment: job.attachment, upload: publicUploadJob(job), body };
  } catch (error) {
    if (controller.signal.aborted || job.status === 'paused') {
      job.status = 'paused';
      job.error = null;
    } else {
      job.status = 'failed';
      job.error = error?.message || 'desktop_upload_failed';
    }
    job.updatedAt = new Date().toISOString();
    saveDesktopUploadState(job);
    emitDesktopUpload(job);
    throw error;
  } finally {
    desktopUploadControllers.delete(jobId);
  }
}

ipcMain.handle('plchat:upload:start', async (_event, payload = {}) => {
  const filePath = String(payload.filePath || '').trim();
  if (!filePath || !fs.existsSync(filePath)) throw new Error('desktop_upload_file_not_found');
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) throw new Error('desktop_upload_path_not_file');
  const token = String(payload.token || '').trim();
  if (!token) throw new Error('desktop_upload_token_required');
  const fileSize = Number(payload.size || stat.size || 0);
  const threshold = Number(payload.multipartThresholdBytes || 64 * 1024 * 1024);
  const id = payload.desktopUploadId || `ul-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const job = {
    id,
    clientItemId: String(payload.clientItemId || ''),
    baseUrl: String(payload.baseUrl || getAppUrl()),
    token,
    filePath,
    fileName: safeDownloadName(payload.fileName || path.basename(filePath)),
    mimeType: String(payload.mimeType || 'application/octet-stream'),
    fileSize,
    roomId: String(payload.roomId || ''),
    uploadId: String(payload.uploadId || ''),
    status: 'queued',
    mode: '',
    useMultipart: Boolean(payload.useMultipart && fileSize >= threshold),
    concurrency: Math.max(1, Number(payload.concurrency || 6)),
    retryLimit: Math.max(1, Number(payload.retryLimit || 5)),
    uploadedBytes: 0,
    completedParts: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  desktopUploadJobs.set(id, job);
  saveDesktopUploadState(job);
  emitDesktopUpload(job);
  return runDesktopUpload(id);
});

ipcMain.handle('plchat:upload:pause', (_event, id) => {
  const job = desktopUploadJobs.get(String(id));
  if (!job) throw new Error('upload_not_found');
  job.status = 'paused';
  desktopUploadControllers.get(job.id)?.abort();
  saveDesktopUploadState(job);
  emitDesktopUpload(job);
  return publicUploadJob(job);
});

ipcMain.handle('plchat:upload:resume', (_event, id) => {
  const job = desktopUploadJobs.get(String(id));
  if (!job) throw new Error('upload_not_found');
  return runDesktopUpload(job.id);
});

ipcMain.handle('plchat:upload:cancel', (_event, id) => {
  const job = desktopUploadJobs.get(String(id));
  if (!job) throw new Error('upload_not_found');
  job.status = 'cancelled';
  desktopUploadControllers.get(job.id)?.abort();
  if (job.uploadId && job.token && job.baseUrl) {
    desktopApiJson(job, `/api/uploads/multipart/${encodeURIComponent(job.uploadId)}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    }).catch(() => {});
  }
  saveDesktopUploadState(job);
  emitDesktopUpload(job);
  return publicUploadJob(job);
});

ipcMain.handle('plchat:upload:list', () => {
  const state = readDesktopUploadState();
  for (const job of state.jobs) if (!desktopUploadJobs.has(job.id)) desktopUploadJobs.set(job.id, job);
  return state.jobs.map(publicUploadJob);
});

function createWindow() {
  const state = safeReadJson(windowStatePath(), DEFAULT_WINDOW_STATE);
  mainWindow = new BrowserWindow({
    width: Number(state.width) || DEFAULT_WINDOW_STATE.width,
    height: Number(state.height) || DEFAULT_WINDOW_STATE.height,
    x: Number.isFinite(state.x) ? state.x : undefined,
    y: Number.isFinite(state.y) ? state.y : undefined,
    minWidth: 960,
    minHeight: 640,
    title: APP_NAME,
    backgroundColor: '#F6F7F4',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    show: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      preload: path.join(__dirname, 'preload.cjs')
    }
  });

  if (state.maximized) mainWindow.maximize();

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowed = webContents.id === mainWindow.webContents.id
      && permission === 'notifications'
      && isAllowedAppNavigation(webContents.getURL());
    callback(allowed);
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isAllowedAppNavigation(url)) return;
    event.preventDefault();
    if (isSafeExternalUrl(url)) shell.openExternal(url);
  });

  mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault());
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, _description, validatedUrl, isMainFrame) => {
    const offlineUrl = pathToFileURL(path.join(__dirname, 'offline.html')).toString();
    appendDesktopLog('did-fail-load', { errorCode, description: _description, validatedUrl, isMainFrame });
    if (!isMainWindowAlive()) return;
    if (isMainFrame && errorCode !== -3 && !String(validatedUrl || '').startsWith(offlineUrl)) showOfflinePage(`load-error-${errorCode}`);
  });
  mainWindow.webContents.on('did-finish-load', () => {
    clearTimeout(workspaceLoadTimer);
    showWindowIfHidden();
    appendDesktopLog('did-finish-load', { url: mainWindow.webContents.getURL() });
    mainWindow.webContents.send('plchat:desktop-preferences', readPreferences());
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    appendDesktopLog('render-process-gone', details);
    if (!isMainWindowAlive()) return;
    showOfflinePage('render-process-gone');
  });
  mainWindow.on('unresponsive', () => appendDesktopLog('window-unresponsive'));

  mainWindow.on('ready-to-show', showWindowIfHidden);
  mainWindow.on('resize', scheduleWindowStateSave);
  mainWindow.on('move', scheduleWindowStateSave);
  mainWindow.on('minimize', (event) => {
    if (readPreferences().minimizeToTray) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on('close', (event) => {
    if (!isQuitting && readPreferences().minimizeToTray) {
      event.preventDefault();
      mainWindow.hide();
      return;
    }
    saveCurrentWindowState();
  });
  mainWindow.on('closed', () => {
    mainWindow = undefined;
  });

  loadWorkspace();
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', showMainWindow);
  app.whenReady().then(() => {
    app.setName(APP_NAME);
    if (process.platform === 'win32') app.setAppUserModelId('com.plchat.app');
    Menu.setApplicationMenu(null);
    normalizeDesktopServerConfig('app-ready');
    syncStartWithWindows(readPreferences().startWithWindows);
    reconcileUpdateStatus();
    createWindow();
    createTray();

    app.on('activate', showMainWindow);
  });
}

ipcMain.handle('plchat:retry-load', () => loadWorkspace());
ipcMain.handle('plchat:show-native-notification', (_event, payload) => showNativeNotification(payload));
ipcMain.handle('plchat:get-desktop-info', () => ({
  appUrl: getAppUrl(),
  defaultAppUrl: DEFAULT_APP_URL,
  configPath: desktopConfigPath(),
  bundledConfigPath: bundledConfigPath(),
  userDataPath: app.getPath('userData'),
  startupLogPath: userDataPath('desktop-startup.log'),
  appVersion: app.getVersion(),
  isPackaged: app.isPackaged,
  platform: process.platform,
  deploymentMode: 'lan-only-v1',
  updateMode: UPDATE_MODE,
  updateFeedUrl: getUpdateFeedUrl() || null,
  normalizedConfig: normalizeDesktopServerConfig('desktop-info'),
  preferences: readPreferences()
}));

ipcMain.handle('plchat:set-desktop-server-url', (_event, payload = {}) => {
  const appUrl = validAppUrl(payload.appUrl);
  if (!appUrl) {
    return { ok: false, error: 'invalid_app_url', appUrl: getAppUrl(), configPath: desktopConfigPath() };
  }
  saveDesktopConfig({ appUrl, updateFeedUrl: updateFeedUrlForAppUrl(appUrl), mode: 'lan-only-v1-url117', updatedAt: new Date().toISOString() });
  appendUpdateHistory('server-url-updated', { appUrl });
  return { ok: true, appUrl: getAppUrl(), configPath: desktopConfigPath() };
});

ipcMain.handle('plchat:test-desktop-server', async (_event, payload = {}) => {
  const result = await testServerConnection(payload.appUrl);
  appendDesktopLog('desktop-server-test', result);
  return result;
});

ipcMain.handle('plchat:clear-desktop-cache', async () => {
  const result = await clearDesktopRuntimeCache();
  return { ok: true, ...result };
});

ipcMain.handle('plchat:open-desktop-logs', async () => {
  const folder = app.getPath('userData');
  fs.mkdirSync(folder, { recursive: true });
  const error = await shell.openPath(folder);
  return { ok: !error, folder, error: error || null };
});

ipcMain.handle('plchat:get-desktop-diagnostics', () => ({
  ok: true,
  diagnostics: desktopDiagnosticSummary(),
  updateStatus: reconcileUpdateStatus(),
  preferences: readPreferences()
}));

ipcMain.handle('plchat:updater:get-app-version', (event) => {
  assertDesktopUpdaterRuntime(event);
  return { ok: true, version: app.getVersion(), platform: process.platform, isPackaged: app.isPackaged, updateMode: UPDATE_MODE, feedUrl: getUpdateFeedUrl() || null };
});

ipcMain.handle('plchat:updater:check-for-updates', async (event) => {
  assertDesktopUpdaterRuntime(event);
  const feedUrl = getUpdateFeedUrl();
  if (!feedUrl) {
    const status = manualInstallerStatus();
    appendUpdateHistory('manual-update-check', { available: status.available, updateMode: UPDATE_MODE });
    return { ok: true, status };
  }
  try {
    const manifest = await readUpdateManifest(feedUrl);
    const installer = selectUpdateInstaller(manifest, feedUrl);
    if (!installer?.version || compareVersions(installer.version, app.getVersion()) <= 0) {
      const status = saveUpdateStatus({
        state: 'checked',
        available: false,
        version: installer?.version || manifest.version || null,
        downloaded: false,
        lastCheckedAt: new Date().toISOString(),
        feedUrl,
        updateMode: 'feed',
        message: 'PL CHAT Desktop App is up to date.'
      });
      appendUpdateHistory('feed-update-check', { available: false, feedUrl, version: status.version });
      return { ok: true, status };
    }
    const status = saveUpdateStatus({
      state: 'available',
      available: true,
      version: installer.version,
      downloaded: false,
      installerPath: null,
      installerUrl: installer.installerUrl,
      sha256: installer.sha256,
      size: installer.size,
      notes: installer.notes,
      releaseDate: installer.releaseDate,
      lastCheckedAt: new Date().toISOString(),
      feedUrl,
      updateMode: 'feed',
      message: `PL CHAT Desktop App ${installer.version} is available.`
    });
    appendUpdateHistory('feed-update-check', { available: true, feedUrl, version: installer.version });
    return { ok: true, status };
  } catch (error) {
    const status = saveUpdateStatus({
      state: 'error',
      available: false,
      downloaded: false,
      lastCheckedAt: new Date().toISOString(),
      feedUrl,
      updateMode: 'feed',
      message: `Could not read PL CHAT update feed: ${error?.message || String(error)}`
    });
    appendUpdateHistory('feed-update-error', { feedUrl, error: error?.message || String(error) });
    return { ok: false, error: 'update_feed_unavailable', status };
  }
});

ipcMain.handle('plchat:updater:download-update', async (event, payload = {}) => {
  assertDesktopUpdaterRuntime(event);
  let current = readUpdateStatus();
  const hostInstaller = installerFromHostManifest(payload.manifest || payload);
  if (hostInstaller && compareVersions(hostInstaller.version, app.getVersion()) > 0) {
    current = saveUpdateStatus({
      ...current,
      state: 'available',
      available: true,
      version: hostInstaller.version,
      downloaded: false,
      installerPath: null,
      installerUrl: hostInstaller.installerUrl,
      sha256: hostInstaller.sha256,
      size: hostInstaller.size,
      notes: hostInstaller.notes,
      releaseDate: hostInstaller.releaseDate,
      lastCheckedAt: new Date().toISOString(),
      feedUrl: getAppUrl(),
      updateMode: UPDATE_MODE,
      message: `PL CHAT Desktop App ${hostInstaller.version} is available from the LAN host.`
    });
  }
  if (!current.available || !current.installerUrl) {
    const status = saveUpdateStatus({ ...current, state: 'checked', available: false, downloaded: false, message: 'No newer PL CHAT Desktop update is available from the LAN host.' });
    return { ok: false, error: 'manual_update_required', status };
  }
  try {
    const downloading = saveUpdateStatus({ ...current, state: 'downloading', downloaded: false, message: 'Downloading PL CHAT Desktop App update installer...' });
    const result = await downloadUpdateInstaller(downloading);
    const status = saveUpdateStatus({
      ...downloading,
      state: 'downloaded',
      downloaded: true,
      installerPath: result.targetPath,
      size: result.size,
      sha256: result.sha256,
      message: 'PL CHAT Desktop App update installer is downloaded and verified.'
    });
    appendUpdateHistory('feed-update-downloaded', { installerPath: result.targetPath, version: status.version, sha256: result.sha256 });
    return { ok: true, status };
  } catch (error) {
    const status = saveUpdateStatus({ ...current, state: 'error', downloaded: false, message: `Update download failed: ${error?.message || String(error)}` });
    appendUpdateHistory('feed-update-download-error', { version: current.version, error: error?.message || String(error) });
    return { ok: false, error: 'update_download_failed', status };
  }
});

ipcMain.handle('plchat:updater:install-update', async (event) => {
  assertDesktopUpdaterRuntime(event);
  try {
    const status = await openDownloadedInstaller(false);
    return { ok: true, status };
  } catch (error) {
    const status = saveUpdateStatus({ ...readUpdateStatus(), state: 'manual', message: 'Install updates by running the newest PL CHAT Setup installer from the administrator.' });
    appendUpdateHistory('manual-install-help', { error: error?.message || String(error) });
    return { ok: false, error: 'manual_update_required', status };
  }
});

ipcMain.handle('plchat:updater:restart-and-install', async (event) => {
  assertDesktopUpdaterRuntime(event);
  try {
    const status = await openDownloadedInstaller(true);
    return { ok: true, status };
  } catch (error) {
    const status = saveUpdateStatus({ ...readUpdateStatus(), state: 'manual', message: 'Restart/install is available after a verified installer has been downloaded.' });
    appendUpdateHistory('manual-restart-install-help', { error: error?.message || String(error) });
    return { ok: false, error: 'manual_update_required', status };
  }
});

ipcMain.handle('plchat:updater:repair-install', async (event) => {
  assertDesktopUpdaterRuntime(event);
  const status = readUpdateStatus();
  if (!status.installerPath || !fs.existsSync(status.installerPath)) {
    const nextStatus = saveUpdateStatus({
      ...status,
      state: 'repair-needed',
      message: 'Repair install requires a downloaded and verified installer.'
    });
    return { ok: false, error: 'downloaded_installer_missing', status: nextStatus };
  }
  try {
    const openError = await shell.openPath(status.installerPath);
    if (openError) throw new Error(openError);
    const nextStatus = saveUpdateStatus({
      ...status,
      state: 'repair-opened',
      downloaded: true,
      message: 'The verified PL CHAT Setup installer is open. Complete it, then reopen PL CHAT.'
    });
    appendUpdateHistory('repair-installer-opened', {
      installerPath: status.installerPath,
      version: status.version
    });
    return { ok: true, status: nextStatus };
  } catch (error) {
    const nextStatus = saveUpdateStatus({
      ...status,
      state: 'repair-failed',
      message: `Could not open the repair installer: ${error?.message || String(error)}`
    });
    appendUpdateHistory('repair-installer-error', { error: error?.message || String(error) });
    return { ok: false, error: 'repair_install_failed', status: nextStatus };
  }
});

ipcMain.handle('plchat:updater:get-update-status', (event) => {
  assertDesktopUpdaterRuntime(event);
  return { ok: true, status: reconcileUpdateStatus() };
});

ipcMain.handle('plchat:updater:get-update-history', (event) => {
  assertDesktopUpdaterRuntime(event);
  const data = safeReadJson(updateHistoryPath(), { items: [] });
  return { ok: true, history: Array.isArray(data.items) ? data.items : [] };
});

ipcMain.handle('plchat:set-desktop-preferences', (_event, patch = {}) => {
  const allowedPatch = {};
  for (const key of ['minimizeToTray', 'notificationsEnabled', 'doNotDisturb', 'startWithWindows']) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) allowedPatch[key] = Boolean(patch[key]);
  }
  const preferences = savePreferences(allowedPatch);
  syncStartWithWindows(preferences.startWithWindows);
  refreshTrayMenu();
  mainWindow?.webContents.send('plchat:desktop-preferences', preferences);
  return preferences;
});

app.on('before-quit', () => {
  isQuitting = true;
  saveCurrentWindowState();
});

app.on('window-all-closed', () => {
  if (process.platform === 'darwin') return;
  if (!readPreferences().minimizeToTray) app.quit();
});






