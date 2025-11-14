# WebRTC Video Call Project

Project ini adalah implementasi WebRTC untuk video call menggunakan NestJS (backend) dan Next.js (frontend) dengan Socket.IO untuk signaling.

## 📁 Struktur Project

```
WebRTC/
├── backend/          # NestJS Backend dengan WebSocket
└── frontend/         # Next.js Frontend
```

## 🚀 Cara Menjalankan

### Backend (NestJS)

1. Masuk ke folder backend:
```bash
cd backend
```

2. Install dependencies (jika belum):
```bash
npm install
```

3. Jalankan server:
```bash
npm run start:dev
```

Server akan berjalan di `http://localhost:3001`

### Frontend (Next.js)

1. Masuk ke folder frontend:
```bash
cd frontend
```

2. Install dependencies (jika belum):
```bash
npm install
```

3. Jalankan development server:
```bash
npm run dev
```

Frontend akan berjalan di `http://localhost:3000`

## 📝 Cara Menggunakan

1. Buka browser dan akses `http://localhost:3000`
2. Masukkan Room ID atau klik "Generate Random Room" untuk membuat room baru
3. Bagikan Room ID tersebut dengan teman Anda
4. Buka browser/tab baru (atau minta teman Anda membuka) dengan Room ID yang sama
5. Klik "Start Call" di salah satu browser untuk memulai panggilan
6. Browser lain akan otomatis menerima panggilan
7. Video akan muncul di kedua sisi setelah koneksi berhasil

## 🔧 Teknologi yang Digunakan

### Backend
- **NestJS** - Framework Node.js
- **Socket.IO** - WebSocket untuk signaling
- **@nestjs/websockets** - WebSocket gateway untuk NestJS
- **@nestjs/platform-socket.io** - Platform adapter untuk Socket.IO

### Frontend
- **Next.js** - React framework
- **TypeScript** - Type safety
- **Socket.IO Client** - WebSocket client
- **Tailwind CSS** - Styling
- **WebRTC API** - Peer-to-peer communication

## 📡 Alur Komunikasi WebRTC

### 1. User A memulai panggilan:
```typescript
const pc = new RTCPeerConnection(config);
pc.ontrack = (event) => { /* handle remote stream */ };
pc.onicecandidate = (event) => { /* kirim ICE candidate */ };

const offer = await pc.createOffer();
await pc.setLocalDescription(offer);
socket.emit('offer', { roomId, sdp: offer });
```

### 2. User B menerima offer dan mengirim answer:
```typescript
socket.on('offer', async ({ sdp }) => {
  await pc.setRemoteDescription(new RTCSessionDescription(sdp));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  socket.emit('answer', { roomId, sdp: answer });
});
```

### 3. User A menerima answer:
```typescript
socket.on('answer', async ({ sdp }) => {
  await pc.setRemoteDescription(new RTCSessionDescription(sdp));
});
```

### 4. ICE Candidate Exchange:
```typescript
// Kirim ICE candidate
pc.onicecandidate = (event) => {
  if (event.candidate) {
    socket.emit('ice-candidate', { roomId, candidate: event.candidate });
  }
};

// Terima ICE candidate
socket.on('ice-candidate', async ({ candidate }) => {
  await pc.addIceCandidate(new RTCIceCandidate(candidate));
});
```

## 🔐 Konfigurasi

### Backend
Port default: `3001`
CORS: Diatur untuk menerima koneksi dari semua origin (untuk development)

### Frontend
Environment variables (`.env.local`):
```
NEXT_PUBLIC_SIGNALING_URL=http://localhost:3001
```

## ⚠️ Catatan Penting

1. **Izin Browser**: Pastikan browser memiliki izin untuk mengakses kamera dan mikrofon
2. **HTTPS**: Di produksi, WebRTC memerlukan HTTPS (kecuali localhost)
3. **TURN Server**: Untuk koneksi yang lebih stabil di produksi, gunakan TURN server
4. **CORS**: Di produksi, batasi CORS hanya ke domain frontend Anda
5. **Browser Support**: Gunakan browser modern (Chrome, Firefox, Edge, Safari)

## 🌐 Deployment ke Produksi

### Backend
1. Set CORS ke domain frontend yang spesifik
2. Gunakan environment variables untuk konfigurasi
3. Deploy ke layanan seperti Heroku, Railway, atau DigitalOcean

### Frontend
1. Update `NEXT_PUBLIC_SIGNALING_URL` ke URL backend production
2. Deploy ke Vercel, Netlify, atau platform hosting lainnya

### STUN/TURN Server
Untuk produksi, tambahkan TURN server untuk meningkatkan koneksi:
```typescript
{
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { 
      urls: 'turn:your-turn-server.com',
      username: 'username',
      credential: 'password'
    }
  ]
}
```

## 📚 Referensi

- [WebRTC API Documentation](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API)
- [NestJS WebSockets](https://docs.nestjs.com/websockets/gateways)
- [Socket.IO Documentation](https://socket.io/docs/v4/)
- [Next.js Documentation](https://nextjs.org/docs)

## 🐛 Troubleshooting

### Video tidak muncul
- Periksa console browser untuk error
- Pastikan izin kamera/mikrofon sudah diberikan
- Cek apakah backend sedang berjalan

### Koneksi gagal
- Pastikan backend dan frontend berjalan di port yang benar
- Periksa firewall atau antivirus yang mungkin memblokir koneksi
- Cek apakah SIGNALING_URL sudah benar

### ICE Connection Failed
- Jika di jaringan yang ketat, mungkin perlu TURN server
- Coba dengan jaringan yang berbeda

## 📄 License

MIT
