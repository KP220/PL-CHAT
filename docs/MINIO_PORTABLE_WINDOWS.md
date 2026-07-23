# PL CHAT MinIO Portable Windows

Use this when Docker Desktop or WSL is not available. PL CHAT can run MinIO as a normal Windows background program.

## Files Needed

Put these files in `C:\minio`:

- `C:\minio\minio.exe` - MinIO server
- `C:\minio\mc.exe` - MinIO client

Official downloads:

- Server: `https://dl.min.io/server/minio/release/windows-amd64/minio.exe`
- Client: `https://dl.min.io/client/mc/release/windows-amd64/mc.exe`

## Start And Enable For PL CHAT

Run from the PL CHAT project folder:

```powershell
cd "C:\Users\PC\Documents\Codex\2026-05-28\ios"
.\scripts\windows-enable-minio-portable-storage.cmd
```

The script will:

- Start `minio.exe` without Docker
- Create `C:\minio\data`
- Create the private bucket `plchat-files`
- Verify direct multipart upload
- Switch PL CHAT to `FILE_STORAGE_DRIVER="s3"` only after verification passes
- Add a Windows startup task for MinIO

## Open MinIO

- API: `http://localhost:9000`
- Console: `http://localhost:9001`

The password is stored locally in `.env.production` and in the startup runner under `C:\minio`.

## Safety

If `C:\minio\minio.exe` is missing, the script stops and does not change PL CHAT storage. This prevents PL CHAT from switching to a half-configured storage system.
