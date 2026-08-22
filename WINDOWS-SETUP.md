# Kapil Billing on One Windows PC

This branch runs Kapil Billing entirely on one Windows PC. It does not require Docker and does not expose the site to your home network.

## Requirements

- 64-bit Windows 10 or Windows 11
- 4 GB RAM or more
- Node.js LTS and Git for Windows for installation and updates
- PowerShell 5.1 or newer
- at least 5 GB free on the installation drive
- a separate external drive for disaster-recovery backup copies

Install Git and Node.js, restart PowerShell, then clone only the Windows branch:

```powershell
git clone --branch kapil-windows --single-branch https://github.com/JayeshVegda/Kapil_pro.git C:\Kapil\kapil-windows
cd C:\Kapil\kapil-windows
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
.\windows\setup.ps1
```

The setup script downloads native `pocketbase.exe` and `caddy.exe`, records their versions and SHA-256 hashes, installs dependencies, builds the frontend, and starts both services. Downloaded programs remain in `runtime\bin` and are ignored by Git.

## Import the real database

Do not start entering real bills into a fresh database. The encrypted production transfer is versioned under `database-transfer/`; its recovery key is supplied separately and never stored in GitHub. Follow `database-transfer/README.md` to decrypt it into:

```text
C:\Kapil\kapil-windows\runtime\transfer\
```

Verify the displayed hash against the `.sha256.txt` file:

```powershell
Get-FileHash -Algorithm SHA256 .\runtime\transfer\kapil-windows-transfer_*.zip
```

Restore the exact archive:

```powershell
.\windows\restore-kapil.ps1 -Archive .\runtime\transfer\kapil-windows-transfer_YYYYMMDDTHHMMSSz.zip
```

Then run:

```powershell
.\windows\health-check.ps1
```

Open `http://127.0.0.1:4174`, sign in, and compare at least these values with the transfer manifest or final VPS screenshot:

1. customer count;
2. latest bill reference and date;
3. latest payment amount and date;
4. Aryan Enterprice balance;
5. current brass market rate.

Only after those checks should this PC become the active writable primary. Stop entering data on the old hosted instance to prevent two diverging databases.

## Automatic startup and backup

Install current-user Windows tasks:

```powershell
.\windows\install-tasks.ps1 -BackupTime 18:00
```

The app starts when you sign in and creates a stopped-database backup daily at 6 PM. Change the time if the PC is normally off then.

## Everyday use

```powershell
.\windows\start-kapil.ps1       # starts services and opens the browser
.\windows\health-check.ps1      # verifies app, database, and processes
.\windows\backup-kapil.ps1      # creates an immediate backup
.\windows\stop-kapil.ps1        # clean shutdown
```

The website is `http://127.0.0.1:4174`. PocketBase administration is `http://127.0.0.1:8090/_/` and should be used only for recovery or schema administration.

## Updating code

Run:

```powershell
.\windows\update-kapil.ps1
```

It backs up the database, stops services, fast-forwards the `kapil-windows` branch, rebuilds and verifies the app, then restarts it. Runtime data is not replaced.

## Removing build-only files later

Node.js and `node_modules` are not used while the built app is running. Keep Node.js installed if the Windows AI will update the project. If disk cleanup is needed, `node_modules` can be removed after a successful build and recreated later with `npm ci`.
