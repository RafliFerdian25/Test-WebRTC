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

  @SubscribeMessage('join')
  handleJoin(
    @MessageBody() { roomId }: { roomId: string },
    @ConnectedSocket() client: Socket,
  ) {
    if (!this.rooms.has(roomId)) {
      this.rooms.set(roomId, new Set());
    }
    this.rooms.get(roomId)!.add(client.id);
    client.join(roomId);

    // kasih info ke yang lain di room
    client.to(roomId).emit('peer-joined', { socketId: client.id });
    
    console.log(`Client ${client.id} joined room ${roomId}`);
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

  handleDisconnect(client: Socket) {
    console.log(`Client ${client.id} disconnected`);
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
