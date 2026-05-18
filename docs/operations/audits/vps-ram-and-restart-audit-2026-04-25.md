# VPS RAM and Restart Audit - 2026-04-25

## Host Summary

- Provider/model: Amazon EC2 `t3.small`
- OS: Ubuntu 24.04.4 LTS
- CPU: 2 vCPU
- RAM: 1.9 GiB
- Swap: 2.0 GiB, almost full during audit
- Disk: 77 GiB root disk, 41% used

## Evidence Collected

- Current uptime during audit was only about 5 minutes.
- Boot history showed repeated boots on 2026-04-25:
  - 07:52 UTC
  - 10:33 UTC
  - 18:52 UTC
  - 20:28 UTC
- Memory at audit time:
  - RAM: 1.1 GiB used, 231 MiB free, 799 MiB available
  - Swap: 1.9 GiB used out of 2.0 GiB
- `/proc/meminfo` showed `Committed_AS` around 7.6 GiB against a `CommitLimit` around 3.0 GiB.
- Pressure stall information showed real memory and IO pressure:
  - memory full pressure was non-zero
  - IO full pressure was also high, consistent with swap thrashing
- Kernel journal did not show a clear `oom-killer` event for the current or previous boot.
- Docker had many services running on a 2 GiB host:
  - billing app
  - multiple Postgres containers
  - NocoDB
  - AdGuard Home
  - RSSHub and Redis
  - Nginx Proxy Manager
  - Dockge
  - Neohabit services
- A Docker build was active during the audit and used noticeable memory.
- Docker disk usage has large reclaimable data:
  - images: 13.63 GB total, 12.9 GB reclaimable
  - build cache: 6.947 GB total, 6.156 GB reclaimable

## Problems Found

1. The VPS is undersized for the current workload.
   - A `t3.small` has only about 2 GiB RAM.
   - The host is running many containers plus system services.
   - Build jobs on the same host can push it into swap pressure quickly.

2. Swap is nearly exhausted.
   - Swap was 1.9 GiB used out of 2.0 GiB.
   - This does not prove the machine rebooted from OOM, but it confirms the host is operating too close to memory limits.

3. `/etc/fstab` has duplicate swap entries.
   - `/swapfile none swap sw 0 0` appears four times.
   - systemd logs show generator errors at boot because of the duplicate swap entries.

4. `lifeos.service` is in a tight restart loop.
   - It is enabled with `Restart=always`.
   - It fails because `/home/ubuntu/life/.env.service` is missing.
   - Previous boot showed restart counter above 1600.
   - Current boot reached over 100 restarts within minutes.

5. `kapil-billing-web` was restarting during a compose rebuild.
   - Later it became healthy and was not OOM-killed.
   - The restart looked related to deploy/build replacement, not confirmed OOM.

6. `brass-bot.service` had earlier startup failures because it could not connect to `43.204.69.72:8283`.
   - It was running during the later audit.
   - Logs include a Telegram bot token, so rotate that token if these logs were exposed anywhere.

## Recommended Actions

### Do First

1. Upgrade the EC2 instance size.
   - Minimum recommendation: `t3.medium` or `t4g.medium` if your stack supports ARM.
   - Better for this number of containers: 4 GiB RAM or more.

2. Stop or disable broken services until fixed.
   - `lifeos.service` should be disabled or fixed because it is constantly restarting.
   - Fix by restoring `/home/ubuntu/life/.env.service`, or disable it if unused.

3. Fix duplicate swap entries in `/etc/fstab`.
   - Keep only one `/swapfile none swap sw 0 0` line.
   - Then run `sudo systemctl daemon-reload`.

4. Avoid building Docker images on this 2 GiB server.
   - Build locally or in CI, then pull the final image on the VPS.
   - If building on the server is required, stop nonessential containers before building.

### Improve Stability

5. Increase swap to 4 GiB only as a safety buffer.
   - This can reduce sudden failures but will not make a 2 GiB VPS fast.
   - Heavy swap use means the server is already overloaded.

6. Add memory limits to Docker services.
   - This prevents one container from taking the whole host down.
   - Start with limits for heavier services like NocoDB, Postgres, RSSHub, and AdGuard.

7. Remove unused Docker data.
   - Docker has about 19 GB reclaimable between images and build cache.
   - Clean only after confirming old images/build cache are not needed.

8. Add monitoring.
   - Track RAM, swap, load, and reboot history.
   - Install a lightweight monitor or use AWS CloudWatch memory agent.

## Useful Commands

Check memory:

```bash
free -h
vmstat 1 5
swapon --show
```

Check reboots:

```bash
journalctl --list-boots --no-pager
last -x reboot shutdown
```

Check OOM evidence:

```bash
journalctl -k -b --no-pager | rg -i 'oom|out of memory|killed process'
journalctl -k -b -1 --no-pager | rg -i 'oom|out of memory|killed process'
```

Check container memory:

```bash
docker stats --no-stream
```

Check restart loops:

```bash
systemctl status lifeos.service brass-bot.service --no-pager -l
journalctl -b -u lifeos.service -u brass-bot.service --no-pager
```

Clean Docker cache after review:

```bash
docker system df
docker builder prune
docker image prune -a
```

## Current Root Cause Assessment

The strongest evidence is not a confirmed kernel OOM kill. The strongest evidence is sustained memory pressure and swap exhaustion on an undersized `t3.small`, made worse by many always-on containers, Docker builds on the host, and a broken `lifeos.service` restart loop.

The best fix is to increase real RAM and reduce background workload. More swap can help avoid abrupt failures, but it should be treated as a backup, not the primary solution.
