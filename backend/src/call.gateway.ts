import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({
  cors: {
    origin: '*', // di produksi batasi ke domain FE kamu
  },
})
export class CallGateway implements OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  // roomId -> array of socketId
  private rooms = new Map<string, Set<string>>();
  
  // userCode -> socketId (untuk mapping user code ke socket)
  private userCodeToSocket = new Map<string, string>();
  
  // socketId -> userCode (untuk reverse lookup)
  private socketToUserCode = new Map<string, string>();

  // Generate random user code (format: 6 digit angka)
  private generateUserCode(): string {
    let code: string;
    do {
      code = Math.floor(100000 + Math.random() * 900000).toString();
    } while (this.userCodeToSocket.has(code));
    return code;
  }

  @SubscribeMessage('register-user')
  handleRegisterUser(@ConnectedSocket() client: Socket) {
    // Generate user code untuk client ini
    const userCode = this.generateUserCode();
    this.userCodeToSocket.set(userCode, client.id);
    this.socketToUserCode.set(client.id, userCode);
    
    console.log(`User registered: ${userCode} -> ${client.id}`);
    
    // Kirim user code ke client
    client.emit('user-registered', { userCode });
    
    return { userCode };
  }

  @SubscribeMessage('call-user')
  handleCallUser(
    @MessageBody() { targetUserCode, callerName }: { targetUserCode: string; callerName?: string },
    @ConnectedSocket() client: Socket,
  ) {
    const targetSocketId = this.userCodeToSocket.get(targetUserCode);
    const callerUserCode = this.socketToUserCode.get(client.id);
    
    if (!targetSocketId) {
      client.emit('call-error', { message: 'User code tidak ditemukan' });
      console.log(`Call failed: User code ${targetUserCode} not found`);
      return;
    }
    
    if (!callerUserCode) {
      client.emit('call-error', { message: 'Anda belum terdaftar' });
      return;
    }
    
    // Generate room ID untuk call ini
    const roomId = `call-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    
    console.log(`Call request: ${callerUserCode} -> ${targetUserCode}, room: ${roomId}`);
    
    // Kirim call request ke target user
    this.server.to(targetSocketId).emit('incoming-call', {
      from: callerUserCode,
      callerName: callerName || callerUserCode,
      roomId,
      callerSocketId: client.id,
    });
    
    // Kirim confirmation ke caller
    client.emit('call-initiated', { targetUserCode, roomId });
  }

  @SubscribeMessage('accept-call')
  handleAcceptCall(
    @MessageBody() { roomId, callerSocketId }: { roomId: string; callerSocketId: string },
    @ConnectedSocket() client: Socket,
  ) {
    console.log(`Call accepted by ${client.id}, room: ${roomId}`);
    
    // Notify caller bahwa call diterima
    this.server.to(callerSocketId).emit('call-accepted', { roomId });
    
    // JANGAN join room di sini - biarkan handleJoin yang handle
    // Ini akan memastikan peer-joined event di-trigger dengan benar
    if (!this.rooms.has(roomId)) {
      this.rooms.set(roomId, new Set());
    }
  }

  @SubscribeMessage('reject-call')
  handleRejectCall(
    @MessageBody() { callerSocketId }: { callerSocketId: string },
    @ConnectedSocket() client: Socket,
  ) {
    console.log(`Call rejected by ${client.id}`);
    
    // Notify caller bahwa call ditolak
    this.server.to(callerSocketId).emit('call-rejected', {
      message: 'Panggilan ditolak',
    });
  }

  @SubscribeMessage('cancel-call')
  handleCancelCall(
    @MessageBody() { targetUserCode }: { targetUserCode: string },
    @ConnectedSocket() client: Socket,
  ) {
    const targetSocketId = this.userCodeToSocket.get(targetUserCode);
    
    if (targetSocketId) {
      this.server.to(targetSocketId).emit('call-cancelled', {
        message: 'Panggilan dibatalkan',
      });
    }
    
    console.log(`Call cancelled by ${client.id}`);
  }

  @SubscribeMessage('join')
  handleJoin(
    @MessageBody() { roomId }: { roomId: string },
    @ConnectedSocket() client: Socket,
  ) {
    if (!this.rooms.has(roomId)) {
      this.rooms.set(roomId, new Set());
    }
    
    // Simpan dulu siapa yang sudah ada di room
    const existingPeers = Array.from(this.rooms.get(roomId)!);
    
    // Add client ke room
    this.rooms.get(roomId)!.add(client.id);
    client.join(roomId);

    console.log(`Client ${client.id} joined room ${roomId}`);
    
    // Emit peer-joined ke semua user yang sudah ada di room
    client.to(roomId).emit('peer-joined', { socketId: client.id });
    
    // Emit peer-joined ke client baru untuk setiap peer yang sudah ada
    // Ini penting agar caller yang join duluan bisa tahu ada peer baru
    existingPeers.forEach(peerId => {
      client.emit('peer-joined', { socketId: peerId });
      console.log(`Notifying ${client.id} about existing peer ${peerId}`);
    });
  }

  @SubscribeMessage('offer')
  handleOffer(
    @MessageBody() data: { roomId: string; sdp: any },
    @ConnectedSocket() client: Socket,
  ) {
    console.log(`Offer from ${client.id} in room ${data.roomId}`);
    client.to(data.roomId).emit('offer', { sdp: data.sdp, from: client.id });
  }

  @SubscribeMessage('answer')
  handleAnswer(
    @MessageBody() data: { roomId: string; sdp: any },
    @ConnectedSocket() client: Socket,
  ) {
    console.log(`Answer from ${client.id} in room ${data.roomId}`);
    client.to(data.roomId).emit('answer', { sdp: data.sdp, from: client.id });
  }

  @SubscribeMessage('ice-candidate')
  handleIce(
    @MessageBody() data: { roomId: string; candidate: any },
    @ConnectedSocket() client: Socket,
  ) {
    console.log(`ICE candidate from ${client.id} in room ${data.roomId}`);
    client.to(data.roomId).emit('ice-candidate', {
      candidate: data.candidate,
      from: client.id,
    });
  }

  @SubscribeMessage('end-call')
  handleEndCall(
    @MessageBody() data: { roomId: string },
    @ConnectedSocket() client: Socket,
  ) {
    console.log(`End call from ${client.id} in room ${data.roomId}`);
    // Broadcast ke semua peer di room bahwa call sudah berakhir
    client.to(data.roomId).emit('call-ended');
  }

  handleDisconnect(client: Socket) {
    console.log(`Client ${client.id} disconnected`);
    
    // Hapus user code mapping
    const userCode = this.socketToUserCode.get(client.id);
    if (userCode) {
      this.userCodeToSocket.delete(userCode);
      this.socketToUserCode.delete(client.id);
      console.log(`User code ${userCode} removed`);
    }
    
    // hapus dari rooms
    for (const [roomId, set] of this.rooms.entries()) {
      if (set.has(client.id)) {
        set.delete(client.id);
        client.to(roomId).emit('peer-left', { socketId: client.id });
        if (set.size === 0) this.rooms.delete(roomId);
      }
    }
  }
}
