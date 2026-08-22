# Nginx Proxy Manager Routing

Use one public host for the app and one path for PocketBase.

## Proxy Host

- Domain: `kapil.cosearch.me`
- Forward hostname/IP: Docker host IP
- Forward port: `8088` (should be loopback-bound on host)
- Websockets: enabled
- SSL: request/attach Let's Encrypt certificate

## PocketBase Path

Add a custom location in Nginx Proxy Manager:

- Location: `/pb`
- Forward hostname/IP: Docker host IP
- Forward port: `8090` (should be loopback-bound on host)

Advanced location config:

```nginx
rewrite ^/pb/(.*)$ /$1 break;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
```

The React app should use:

```env
VITE_POCKETBASE_URL=https://kapil.cosearch.me/pb
```

## Security Notes

- Do not expose `8088` and `8090` publicly.
- Bind app and PocketBase containers to localhost only:
  - `127.0.0.1:8088->80`
  - `127.0.0.1:8090->8090`
- Keep only reverse proxy ingress (`80`/`443`) publicly reachable.
