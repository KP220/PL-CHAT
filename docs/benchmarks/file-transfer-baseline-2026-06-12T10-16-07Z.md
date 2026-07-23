# PL CHAT File Transfer Benchmark Baseline

- Status: **passed**
- URL: `http://localhost:8788`
- Scope: Local loopback baseline only
- Direct upload sample: 8 MB
- Chunk upload sample: 128 MB
- Range download sample: 8 MB
- Chat messages created: 0
- User files modified: 0

## Average Throughput

- direct: 47.36 MB/s (3 run)
- download: 43.09 MB/s (3 run)
- chunked: 134.38 MB/s (3 run)
- range: 45.53 MB/s (3 run)

## Measurements

| Test | Size (MB) | Time (ms) | Throughput (MB/s) |
| --- | ---: | ---: | ---: |
| health-check | 0 | 41.96 | 0 |
| direct-upload-run-1 | 8 | 193.45 | 41.35 |
| full-download-run-1 | 8 | 168.48 | 47.48 |
| chunk-upload-run-1 | 128 | 941.52 | 135.95 |
| range-download-run-1 | 8 | 142.66 | 56.08 |
| direct-upload-run-2 | 8 | 151.5 | 52.81 |
| full-download-run-2 | 8 | 144.4 | 55.4 |
| chunk-upload-run-2 | 128 | 996.29 | 128.48 |
| range-download-run-2 | 8 | 144.45 | 55.38 |
| direct-upload-run-3 | 8 | 166.93 | 47.92 |
| full-download-run-3 | 8 | 303.09 | 26.39 |
| chunk-upload-run-3 | 128 | 922.72 | 138.72 |
| range-download-run-3 | 8 | 318.28 | 25.14 |

## Cleanup

- Benchmark uploads requested for soft deletion: 6
- Temporary local files removed: yes

## Limitation

This is a baseline on the same computer through localhost. It does not represent external internet speed or prove 10-20 GB transfer stability.


