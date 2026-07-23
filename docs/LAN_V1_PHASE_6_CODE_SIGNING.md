# PL CHAT LAN v1 Phase 6 Code Signing

The current LAN build is still unsigned. Windows SmartScreen may warn users.

## Required external item

Buy or provision a Windows code signing certificate:

- OV code signing certificate: easier, still may show reputation warning at first.
- EV code signing certificate: stronger SmartScreen trust but usually requires hardware token/cloud signing.

## Implementation plan

1. Store signing credentials outside the repository.
2. Configure `electron-builder` signing through environment variables or a secure signing hook.
3. Build `PL CHAT Setup x.y.z.exe`.
4. Verify both installer and installed `PL CHAT.exe` with:

```powershell
Get-AuthenticodeSignature "PL CHAT Setup x.y.z.exe"
Get-AuthenticodeSignature "$env:LOCALAPPDATA\Programs\PL CHAT\PL CHAT.exe"
```

5. Publish SHA256 next to every release.
6. Keep release notes and manifest for every version.

## Acceptance

- Installer signature status is `Valid`.
- Installed executable signature status is `Valid`.
- SHA256 is published in the release package.
- Version numbers are monotonic, for example `1.0.1`, `1.0.2`.
