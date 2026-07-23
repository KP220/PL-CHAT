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

- direct: 54.37 MB/s (1 run)
- download: 55.63 MB/s (1 run)
- chunked: 130.13 MB/s (1 run)
- range: 56.75 MB/s (1 run)

## Measurements

| Test | Size (MB) | Time (ms) | Throughput (MB/s) |
| --- | ---: | ---: | ---: |
| health-check | 0 | 40.89 | 0 |
| direct-upload-run-1 | 8 | 147.15 | 54.37 |
| full-download-run-1 | 8 | 143.82 | 55.63 |
| chunk-upload-run-1 | 128 | 983.6 | 130.13 |
| range-download-run-1 | 8 | 140.96 | 56.75 |

## Cleanup

- Benchmark uploads requested for soft deletion: 2
- Temporary local files removed: yes

## Limitation

This is a baseline on the same computer through localhost. It does not represent external internet speed or prove 10-20 GB transfer stability.


