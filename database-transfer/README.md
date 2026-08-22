# Encrypted Production Database Transfer

`kapil-production-20260804.zip.enc` is the verified PocketBase production backup prepared for the Windows local-primary installation. It is encrypted with AES-256-CBC, PBKDF2-SHA256, 300,000 iterations. The recovery key is deliberately not stored in GitHub.

Encrypted file SHA-256:

```text
0f5d64fbbc37370355d331182c64f431a7d70f553ddd1dcd4f9b01d2d1a55c62
```

After cloning on Windows, save the separately provided recovery key as `runtime\transfer\recovery-key.txt`. From PowerShell, use the OpenSSL included with Git for Windows:

```powershell
Get-FileHash -Algorithm SHA256 .\database-transfer\kapil-production-20260804.zip.enc
& 'C:\Program Files\Git\usr\bin\openssl.exe' enc -d -aes-256-cbc -pbkdf2 -iter 300000 -md sha256 `
  -in .\database-transfer\kapil-production-20260804.zip.enc `
  -out .\runtime\transfer\kapil-windows-transfer-20260804.zip `
  -pass file:.\runtime\transfer\recovery-key.txt
Get-FileHash -Algorithm SHA256 .\runtime\transfer\kapil-windows-transfer-20260804.zip
```

The decrypted archive must have this SHA-256 before restore:

```text
59c27ed55352a121ac5e01d8ad32263c28e4eb71c054d0fa49f66a23fd56449d
```

Then restore it:

```powershell
.\windows\restore-kapil.ps1 -Archive .\runtime\transfer\kapil-windows-transfer-20260804.zip
```

Never commit `recovery-key.txt` or the decrypted ZIP. Both are excluded by `.gitignore` when placed under `runtime`.
