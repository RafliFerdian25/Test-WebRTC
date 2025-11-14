# Deployment & Production Guide

## 🌍 Deploy ke Server Public dengan Domain

### 1. **Deploy Backend (NestJS)**

#### Option A: VPS (DigitalOcean, AWS, dll)
```bash
# 1. SSH ke server
ssh user@your-server.com

# 2. Clone project
git clone https://github.com/RafliFerdian25/Test-WebRTC.git
cd Test-WebRTC/backend

# 3. Install dependencies
npm install

# 4. Setup .env
nano .env
# PORT=3434
# NODE_ENV=production

# 5. Build
npm run build

# 6. Install PM2 untuk process manager
npm install -g pm2

# 7. Start dengan PM2
pm2 start dist/main.js --name webrtc-backend
pm2 save
pm2 startup
```

#### Option B: Railway/Render/Heroku
1. Connect repository
2. Set environment variables: `PORT=3434`
3. Build command: `npm run build`
4. Start command: `npm run start:prod`

---

### 2. **Deploy Frontend (Next.js)**

#### Option A: Vercel (Recommended)
```bash
# 1. Install Vercel CLI
npm i -g vercel

# 2. Deploy
cd frontend
vercel

# 3. Set environment variables di Vercel dashboard:
# NEXT_PUBLIC_SIGNALING_URL=https://your-backend-domain.com
```

#### Option B: VPS dengan Nginx
```bash
# 1. Build frontend
cd frontend
npm run build

# 2. Start dengan PM2
pm2 start npm --name webrtc-frontend -- start
```

---

## 🔒 Setup HTTPS (WAJIB untuk WebRTC)

WebRTC memerlukan **HTTPS** untuk getUserMedia (kamera/mic), kecuali localhost.

### Nginx Configuration
```nginx
server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

    # Frontend
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}

# Backend dengan WebSocket
server {
    listen 443 ssl http2;
    server_name api.your-domain.com;

    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

    location / {
        proxy_pass http://localhost:3434;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    # WebSocket
    location /socket.io/ {
        proxy_pass http://localhost:3434;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

### Install SSL Certificate (Let's Encrypt)
```bash
sudo apt-get update
sudo apt-get install certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com -d api.your-domain.com
```

---

## 🔄 Setup TURN Server (Untuk Lintas Jaringan)

### **Kenapa Perlu TURN?**
- STUN saja **TIDAK CUKUP** jika:
  - User di belakang Symmetric NAT
  - Corporate firewall
  - Mobile network ketat
  - Koneksi peer-to-peer langsung gagal

### **Option 1: Coturn (Self-Hosted)**

#### Install Coturn di VPS
```bash
# Ubuntu/Debian
sudo apt-get install coturn

# Edit config
sudo nano /etc/turnserver.conf
```

#### Minimal Configuration (`/etc/turnserver.conf`)
```conf
listening-port=3478
tls-listening-port=5349

# External IP VPS Anda
external-ip=YOUR_VPS_PUBLIC_IP

# Realm (domain Anda)
realm=your-domain.com

# Authentication
lt-cred-mech
user=username:password

# Certificate untuk TURN over TLS
cert=/etc/letsencrypt/live/your-domain.com/fullchain.pem
pkey=/etc/letsencrypt/live/your-domain.com/privkey.pem

# Logging
verbose
log-file=/var/log/turnserver.log

# Relay range
min-port=49152
max-port=65535

# Allow localhost
no-loopback-peers
```

#### Start Coturn
```bash
sudo systemctl enable coturn
sudo systemctl start coturn
sudo systemctl status coturn
```

#### Firewall Rules
```bash
sudo ufw allow 3478/tcp
sudo ufw allow 3478/udp
sudo ufw allow 5349/tcp
sudo ufw allow 5349/udp
sudo ufw allow 49152:65535/tcp
sudo ufw allow 49152:65535/udp
```

#### Update `.env.local` Frontend
```env
NEXT_PUBLIC_TURN_URL=turn:your-domain.com:3478
NEXT_PUBLIC_TURN_USERNAME=username
NEXT_PUBLIC_TURN_CREDENTIAL=password
```

#### Uncomment TURN di `VideoCall.tsx`
```typescript
const iceConfig: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    {
      urls: process.env.NEXT_PUBLIC_TURN_URL || 'turn:your-domain.com:3478',
      username: process.env.NEXT_PUBLIC_TURN_USERNAME,
      credential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL,
    },
  ],
  iceCandidatePoolSize: 10,
};
```

---

### **Option 2: Managed TURN Services (Berbayar tapi Mudah)**

#### **Twilio STUN/TURN**
```typescript
// Get token dari Twilio API
const iceConfig = {
  iceServers: [
    { urls: 'stun:global.stun.twilio.com:3478' },
    {
      urls: 'turn:global.turn.twilio.com:3478?transport=udp',
      username: 'your-twilio-username',
      credential: 'your-twilio-credential',
    },
  ],
};
```

#### **Xirsys** (https://xirsys.com)
- Free tier: 500MB/bulan
- Managed TURN/STUN servers
- Easy API untuk generate credentials

#### **Cloudflare Calls** (Beta)
- Gratis (untuk sekarang)
- https://developers.cloudflare.com/calls/

---

## 🧪 Testing Koneksi

### 1. Test STUN/TURN Server
Buka: https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/

Masukkan TURN server Anda dan test.

### 2. Check NAT Type
https://www.browserleaks.com/webrtc

### 3. Console Logging
Di browser console, perhatikan:
```
ICE connection state: checking -> connected
Connection state: connecting -> connected
```

Jika stuck di `checking` atau `failed`, berarti butuh TURN server.

---

## 📊 Architecture Production

```
┌─────────────┐         HTTPS          ┌──────────────┐
│   User A    │ ◄────────────────────► │   Frontend   │
│  (Browser)  │                         │   (Vercel)   │
└─────────────┘                         └──────────────┘
       │                                        │
       │                                        │
       │         WebSocket (wss://)             │
       │                                        ▼
       │                              ┌──────────────────┐
       │◄────────────────────────────►│    Backend       │
       │      Signaling Server        │   (NestJS/VPS)   │
       │                              └──────────────────┘
       │
       │         WebRTC P2P
       │       (Audio/Video)
       │◄───────────────────────────────────►┌─────────────┐
       │                                     │   User B    │
       │      (Direct or via TURN)           │  (Browser)  │
       │                                     └─────────────┘
       │
       │         (If direct fails)
       │
       ▼
┌─────────────┐
│ TURN Server │  Relay traffic jika P2P gagal
│   (Coturn)  │
└─────────────┘
```

---

## ⚠️ Checklist Deployment

- [ ] Backend deployed dengan HTTPS
- [ ] Frontend deployed dengan HTTPS
- [ ] WebSocket berfungsi (test di console: `socket.connected`)
- [ ] CORS diatur dengan benar di backend
- [ ] Environment variables diset
- [ ] TURN server setup (untuk production)
- [ ] Firewall rules opened (ports 3478, 5349, 49152-65535)
- [ ] SSL certificate installed
- [ ] Test dari 2 jaringan berbeda

---

## 💰 Estimasi Biaya

### Self-Hosted (VPS)
- **DigitalOcean Droplet**: $6-12/bulan (1-2GB RAM)
- **Frontend di Vercel**: Gratis
- **Domain**: $10-15/tahun
- **SSL**: Gratis (Let's Encrypt)

**Total**: ~$10/bulan + domain

### Managed Services
- **Backend**: Railway/Render free tier
- **Frontend**: Vercel free tier
- **TURN**: Twilio/Xirsys ~$20-50/bulan (tergantung usage)

**Total**: $0-50/bulan tergantung traffic

---

## 📝 Update CORS di Production

Edit `backend/src/main.ts`:
```typescript
app.enableCors({
  origin: [
    'https://your-frontend-domain.com',
    'http://localhost:3232', // untuk development
  ],
  credentials: true,
});
```

Edit `backend/src/call.gateway.ts`:
```typescript
@WebSocketGateway({
  cors: {
    origin: [
      'https://your-frontend-domain.com',
      'http://localhost:3232',
    ],
  },
})
```
