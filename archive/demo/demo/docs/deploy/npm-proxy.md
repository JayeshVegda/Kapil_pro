# Nginx Proxy Manager Routing

Use one public host for the app and one path for PocketBase.

## Proxy Host

- Domain: `kapil.cosearch.me`
- Forward hostname/IP: Docker host IP
- Forward port: `8088`
- Websockets: enabled
- SSL: request/attach Let's Encrypt certificate

## PocketBase Path

Add a custom location in Nginx Proxy Manager:

- Location: `/pb`
- Forward hostname/IP: Docker host IP
- Forward port: `8090`

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
