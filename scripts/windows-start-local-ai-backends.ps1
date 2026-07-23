$ErrorActionPreference = 'Stop'

function Wait-Ready([string]$Url, [int]$Seconds) {
  $until = (Get-Date).AddSeconds($Seconds)
  do {
    try { if ((Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 5).StatusCode -lt 500) { return $true } } catch {}
    Start-Sleep -Seconds 2
  } while ((Get-Date) -lt $until)
  return $false
}

# Local Qwen is registered in the current user's Windows Startup.  Do not start
# a second llama-server here: the image model in this workspace is Flux, not Qwen.
if (!(Wait-Ready 'http://127.0.0.1:8080/v1/models' 180)) { throw 'Local Qwen did not become ready from Windows Startup.' }

if (!(Wait-Ready 'http://127.0.0.1:8188/system_stats' 2)) {
  $comfyRoot = 'C:\Users\PC\Documents\Codex\KAVEEP-ComfyUI\ComfyUI_windows_portable'
  $starter = Join-Path $comfyRoot 'run_amd_gpu.bat'
  if (!(Test-Path $starter)) { throw 'ComfyUI starter was not found.' }
  Start-Process -FilePath 'cmd.exe' -ArgumentList @('/c', "`"$starter`"") -WorkingDirectory $comfyRoot -WindowStyle Hidden
  if (!(Wait-Ready 'http://127.0.0.1:8188/system_stats' 120)) { throw 'ComfyUI did not become ready.' }
}
