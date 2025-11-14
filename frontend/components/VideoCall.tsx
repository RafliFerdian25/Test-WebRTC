'use client';

import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';

const SIGNALING_URL = process.env.NEXT_PUBLIC_SIGNALING_URL || 'http://localhost:3001';

const iceConfig: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    // TURN server di produksi
  ],
};

export default function VideoCall({ roomId }: { roomId: string }) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isCalling, setIsCalling] = useState(false);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    const s = io(SIGNALING_URL);
    setSocket(s);

    s.on('connect', () => {
      console.log('Connected to signaling server');
      setIsConnected(true);
      s.emit('join', { roomId });
    });

    s.on('disconnect', () => {
      console.log('Disconnected from signaling server');
      setIsConnected(false);
    });

    s.on('peer-joined', ({ socketId }) => {
      console.log('Peer joined:', socketId);
    });

    s.on('offer', async ({ sdp, from }) => {
      console.log('Received offer from:', from);
      // Ignore if we sent this offer
      if (from === s.id) {
        console.log('Ignoring own offer');
        return;
      }
      
      await ensurePeerConnection(s);
      const pc = pcRef.current!;
      
      // Check state before setting remote description
      if (pc.signalingState !== 'stable') {
        console.warn('Peer connection not in stable state, current state:', pc.signalingState);
      }
      
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      console.log('Set remote description (offer), state:', pc.signalingState);

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      console.log('Created and set local description (answer)');
      s.emit('answer', { roomId, sdp: answer });
    });

    s.on('answer', async ({ sdp, from }) => {
      console.log('Received answer from:', from);
      // Ignore if we sent this answer
      if (from === s.id) {
        console.log('Ignoring own answer');
        return;
      }
      
      const pc = pcRef.current;
      if (!pc) {
        console.warn('No peer connection when answer received');
        return;
      }
      
      // Only set remote description if we're expecting an answer
      if (pc.signalingState !== 'have-local-offer') {
        console.warn('Not expecting answer, current state:', pc.signalingState);
        return;
      }
      
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      console.log('Set remote description (answer), state:', pc.signalingState);
    });

    s.on('ice-candidate', async ({ candidate, from }) => {
      // Ignore if we sent this candidate
      if (from === s.id) {
        return;
      }
      
      const pc = pcRef.current;
      if (!pc || !candidate) return;
      
      // Only add ICE candidates after remote description is set
      if (pc.remoteDescription) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
          console.log('Added ICE candidate from:', from);
        } catch (e) {
          console.error('Error add ICE', e);
        }
      } else {
        console.warn('Received ICE candidate before remote description');
      }
    });

    s.on('peer-left', ({ socketId }) => {
      console.log('Peer left:', socketId);
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = null;
      }
    });

    return () => {
      s.disconnect();
      pcRef.current?.close();
      pcRef.current = null;
      localStreamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, [roomId]);

  const ensurePeerConnection = async (socketInstance: Socket) => {
    if (pcRef.current) return;
    const pc = new RTCPeerConnection(iceConfig);
    pcRef.current = pc;

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socketInstance.emit('ice-candidate', { roomId, candidate: event.candidate });
        console.log('Sent ICE candidate');
      }
    };

    pc.ontrack = (event) => {
      console.log('Received remote track');
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = event.streams[0];
      }
    };

    pc.onsignalingstatechange = () => {
      console.log('Signaling state changed:', pc.signalingState);
    };

    pc.oniceconnectionstatechange = () => {
      console.log('ICE connection state:', pc.iceConnectionState);
    };

    pc.onconnectionstatechange = () => {
      console.log('Connection state:', pc.connectionState);
    };

    if (!localStreamRef.current) {
      try {
        localStreamRef.current = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = localStreamRef.current;
        }
      } catch (error) {
        console.error('Error accessing media devices:', error);
        alert('Tidak dapat mengakses kamera/mikrofon. Pastikan izin sudah diberikan.');
        throw error;
      }
    }

    localStreamRef.current!.getTracks().forEach((track) => {
      pc.addTrack(track, localStreamRef.current!);
    });
  };

  const startCall = async () => {
    if (!socket) {
      alert('Tidak terhubung ke server');
      return;
    }
    try {
      setIsCalling(true);
      await ensurePeerConnection(socket);
      const pc = pcRef.current!;
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('offer', { roomId, sdp: offer });
      console.log('Sent offer');
    } catch (error) {
      console.error('Error starting call:', error);
      setIsCalling(false);
    }
  };

  const hangUp = () => {
    pcRef.current?.close();
    pcRef.current = null;
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    localStreamRef.current = null;
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
    setIsCalling(false);
  };

  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-3xl font-bold mb-2">WebRTC Video Call</h1>
        <p className="text-gray-600 mb-6">Room ID: <span className="font-mono bg-gray-200 px-2 py-1 rounded">{roomId}</span></p>
        
        <div className="mb-4">
          <div className={`inline-flex items-center px-3 py-1 rounded-full text-sm ${isConnected ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
            <span className={`w-2 h-2 rounded-full mr-2 ${isConnected ? 'bg-green-500' : 'bg-red-500'}`}></span>
            {isConnected ? 'Connected' : 'Disconnected'}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <div className="bg-white rounded-lg shadow-lg p-4">
            <h2 className="text-lg font-semibold mb-2">Local Video (You)</h2>
            <video 
              ref={localVideoRef} 
              autoPlay 
              muted 
              playsInline 
              className="w-full h-auto bg-black rounded"
            />
          </div>
          
          <div className="bg-white rounded-lg shadow-lg p-4">
            <h2 className="text-lg font-semibold mb-2">Remote Video (Peer)</h2>
            <video 
              ref={remoteVideoRef} 
              autoPlay 
              playsInline 
              className="w-full h-auto bg-black rounded"
            />
          </div>
        </div>

        <div className="flex gap-4">
          <button 
            onClick={startCall}
            disabled={!isConnected || isCalling}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition"
          >
            Start Call
          </button>
          <button 
            onClick={hangUp}
            disabled={!isCalling}
            className="px-6 py-3 bg-red-600 text-white rounded-lg font-semibold hover:bg-red-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition"
          >
            Hang Up
          </button>
        </div>

        <div className="mt-8 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
          <h3 className="font-semibold text-yellow-800 mb-2">Cara Menggunakan:</h3>
          <ol className="list-decimal list-inside text-sm text-yellow-700 space-y-1">
            <li>Buka halaman ini di 2 browser/tab berbeda dengan Room ID yang sama</li>
            <li>Klik "Start Call" di salah satu browser untuk memulai panggilan</li>
            <li>Browser lain akan otomatis menerima panggilan</li>
            <li>Video akan muncul di kedua sisi setelah koneksi berhasil</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
