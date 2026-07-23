# File Transfer V2 Quick Tunnel Decision

Generated: 2026-06-29

## Scope

This decision applies only when all conditions are true:

- Route is Cloudflare Quick Tunnel (`trycloudflare.com`).
- Storage path is MinIO/S3 signed multipart upload.
- File size is at least 100 MB.
- The PL CHAT server only issues signed URLs and completes metadata; it must not proxy the large file body.

## Benchmark Evidence

1 GB upload/download tests through Quick Tunnel + MinIO signed transfer:

| Multipart upload concurrency | Upload MB/s | Download MB/s | Range MB/s | Result |
| ---: | ---: | ---: | ---: | --- |
| 1 | 5.70 | 6.75 | 4.65 | Pass |
| 2 | 5.10 | 7.79 | 4.54 | Pass |
| 3 | 7.43 | 7.59 | 4.37 | Pass, best upload |
| 4 | 6.39 | 7.02 | 4.01 | Pass, slower than 3 |

Latest server-selected run after locking the rule:

| Route | Server-selected upload concurrency | Fallback | Upload MB/s | Server download MB/s |
| --- | ---: | --- | ---: | ---: |
| Quick Tunnel | 3 | 2, 1 | 5.94 | 0.99 |

## Decision

- Default Quick Tunnel multipart upload concurrency: `3`.
- Retry fallback order for reset/timeout/fetch failures: `2`, then `1`.
- Keep server download as fallback only. The 1 GB server-download result at `0.99 MB/s` confirms backend-proxied downloads are a bottleneck through Quick Tunnel.
- Prefer signed direct MinIO download for large files and benchmark it separately with `PL_CHAT_BENCHMARK_DOWNLOAD_MODE=signed`.
- When `PL_CHAT_BENCHMARK_DOWNLOAD_MODE=signed`, both full download and range download are measured against the signed MinIO URL.

## Not Yet Claimed

- 10 GB and 20 GB real throughput are not approved yet.
- For 10 GB / 20 GB, run capability checks first. Run real transfer only after 1 GB signed upload and signed download are stable through the current Quick Tunnel URLs.

## Next Acceptance Commands

```powershell
Set-Location 'C:\Users\PC\Documents\Codex\2026-05-28\ios'

$status = Get-Content .\pl-chat-data\tunnels\quick-tunnel-status.json | ConvertFrom-Json
$env:PL_CHAT_BENCHMARK_URL = $status.appUrl
$env:PL_CHAT_BENCHMARK_SIZES_MB = '1024'
$env:PL_CHAT_BENCHMARK_MAX_DEFAULT_REAL_MB = '1024'
$env:PL_CHAT_BENCHMARK_DOWNLOAD_MODE = 'signed'
Remove-Item Env:\PL_CHAT_BENCHMARK_MULTIPART_CONCURRENCY -ErrorAction SilentlyContinue

npm.cmd run plchat:benchmark:file-transfer:v2
```
