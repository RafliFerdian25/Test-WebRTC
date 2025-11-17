'use client';

import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';

const SIGNALING_URL = process.env.NEXT_PUBLIC_SIGNALING_URL || 'http://localhost:3001';

const iceConfig: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    // TURN server
    {
      urls: process.env.NEXT_PUBLIC_TURN_URL || 'turn:webrtc.incom.id:3478?transport=udp',
      username: process.env.NEXT_PUBLIC_TURN_USERNAME || 'webrtcuser',
      credential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL || 'Password123',
    },
  ],
  iceCandidatePoolSize: 10,
};

export default function VideoCall({ roomId }: { roomId: string }) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isCalling, setIsCalling] = useState(false);
  const [isReceiver, setIsReceiver] = useState(false);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [isRemoteAudioEnabled, setIsRemoteAudioEnabled] = useState(true);
  const [callDuration, setCallDuration] = useState(0); // in seconds
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const pendingIceCandidatesRef = useRef<RTCIceCandidate[]>([]); // Buffer untuk ICE candidates
  const callTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const s = io(SIGNALING_URL);
    setSocket(s);

    s.on('connect', () => {
      console.log('Connected to signaling server');
      setIsConnected(true);
      // Auto join room (sudah disiapkan dari call flow)
      s.emit('join', { roomId });
      
      // PENTING: Setup media stream DULU sebelum peer connection
      // Agar saat menerima offer, tracks sudah siap
      setTimeout(async () => {
        try {
          // Ambil media stream dulu
          if (!localStreamRef.current) {
            localStreamRef.current = await navigator.mediaDevices.getUserMedia({
              video: true,
              audio: true,
            });
            if (localVideoRef.current) {
              localVideoRef.current.srcObject = localStreamRef.current;
            }
            console.log('Local media stream acquired on connect');
          }
          
          // Baru setup peer connection
          await ensurePeerConnection(s);
          console.log('Peer connection initialized on join');
          
          // Cek apakah user ini adalah caller yang baru accept call
          const wasCaller = sessionStorage.getItem('wasCaller');
          console.log('Checking wasCaller status:', wasCaller);
          if (wasCaller === 'true') {
            console.log('Will auto-start call when peer joins...');
          }
        } catch (error) {
          console.error('Error initializing peer connection:', error);
        }
      }, 500);
    });

    s.on('disconnect', () => {
      console.log('Disconnected from signaling server');
      setIsConnected(false);
    });

    s.on('peer-mute-status', ({ socketId, isAudioEnabled }: { socketId: string; isAudioEnabled: boolean }) => {
      console.log(`Peer ${socketId} audio status: ${isAudioEnabled ? 'enabled' : 'muted'}`);
      setIsRemoteAudioEnabled(isAudioEnabled);
    });

    s.on('peer-joined', async ({ socketId }) => {
      console.log('Peer joined:', socketId);
      
      // Clear buffer ICE candidates untuk koneksi baru
      pendingIceCandidatesRef.current = [];
      console.log('Cleared ICE candidate buffer for new connection');
      
      // Auto-start call when peer joins (for caller)
      const wasCaller = sessionStorage.getItem('wasCaller');
      console.log('peer-joined - wasCaller:', wasCaller);
      
      if (wasCaller === 'true') {
        console.log('Auto-starting call as caller...');
        sessionStorage.removeItem('wasCaller'); // Remove immediately
        
        // Tunggu sebentar untuk pastikan peer connection ready
        setTimeout(async () => {
          try {
            await ensurePeerConnection(s);
            const pc = pcRef.current;
            if (pc && pc.signalingState === 'stable') {
              setIsCalling(true);
              
              // Start call timer untuk caller
              setCallDuration(0);
              if (callTimerRef.current) {
                clearInterval(callTimerRef.current);
              }
              callTimerRef.current = setInterval(() => {
                setCallDuration(prev => prev + 1);
              }, 1000);
              
              const offer = await pc.createOffer();
              await pc.setLocalDescription(offer);
              s.emit('offer', { roomId, sdp: offer });
              console.log('Offer sent automatically by caller');
            } else {
              console.warn('Peer connection not ready for offer, state:', pc?.signalingState);
            }
          } catch (error) {
            console.error('Error auto-starting call:', error);
          }
        }, 500);
      } else {
        // Receiver - siapkan peer connection untuk menerima offer
        console.log('Preparing to receive offer as receiver...');
        await ensurePeerConnection(s);
      }
    });

    s.on('offer', async ({ sdp, from }) => {
      console.log('Received offer from:', from);
      // Ignore if we sent this offer
      if (from === s.id) {
        console.log('Ignoring own offer');
        return;
      }
      
      // Set status DULU sebelum processing
      setIsReceiver(true);
      setIsCalling(true);
      console.log('Receiver: starting call automatically');
      
      // Start call timer
      setCallDuration(0);
      if (callTimerRef.current) {
        clearInterval(callTimerRef.current);
      }
      callTimerRef.current = setInterval(() => {
        setCallDuration(prev => prev + 1);
      }, 1000);
      
      // Clear buffer ICE candidates untuk koneksi baru
      pendingIceCandidatesRef.current = [];
      
      await ensurePeerConnection(s);
      const pc = pcRef.current!;
      
      // Check state before setting remote description
      if (pc.signalingState !== 'stable') {
        console.warn('Peer connection not in stable state, current state:', pc.signalingState);
      }
      
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      console.log('Set remote description (offer), state:', pc.signalingState);

      // Add buffered ICE candidates setelah remote description di-set
      if (pendingIceCandidatesRef.current.length > 0) {
        console.log(`Adding ${pendingIceCandidatesRef.current.length} buffered ICE candidates`);
        for (const candidate of pendingIceCandidatesRef.current) {
          try {
            await pc.addIceCandidate(candidate);
            console.log('Added buffered ICE candidate');
          } catch (e) {
            console.error('Error adding buffered ICE candidate:', e);
          }
        }
        pendingIceCandidatesRef.current = [];
      }

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

      // Add buffered ICE candidates setelah remote description di-set
      if (pendingIceCandidatesRef.current.length > 0) {
        console.log(`Adding ${pendingIceCandidatesRef.current.length} buffered ICE candidates`);
        for (const candidate of pendingIceCandidatesRef.current) {
          try {
            await pc.addIceCandidate(candidate);
            console.log('Added buffered ICE candidate');
          } catch (e) {
            console.error('Error adding buffered ICE candidate:', e);
          }
        }
        pendingIceCandidatesRef.current = [];
      }
    });

    s.on('ice-candidate', async ({ candidate, from }) => {
      // Ignore if we sent this candidate
      if (from === s.id) {
        return;
      }
      
      const pc = pcRef.current;
      if (!pc || !candidate) return;
      
      // Buffer ICE candidates jika remote description belum di-set
      if (!pc.remoteDescription) {
        console.log('Buffering ICE candidate (remote description not set yet)');
        pendingIceCandidatesRef.current.push(new RTCIceCandidate(candidate));
        return;
      }
      
      // Add ICE candidate langsung jika remote description sudah ada
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
        console.log('Added ICE candidate from:', from);
      } catch (e) {
        console.error('Error add ICE', e);
      }
    });

    s.on('peer-left', ({ socketId }) => {
      console.log('Peer left:', socketId, '- ending call and redirecting...');
      
      // Stop timer
      if (callTimerRef.current) {
        clearInterval(callTimerRef.current);
        callTimerRef.current = null;
      }
      
      // Cleanup peer connection and streams
      pcRef.current?.close();
      pcRef.current = null;
      localStreamRef.current?.getTracks().forEach(t => t.stop());
      localStreamRef.current = null;
      
      // Redirect ke home
      window.location.href = '/';
    });

    s.on('call-ended', () => {
      console.log('Call ended by peer, redirecting to home...');
      
      // Stop timer
      if (callTimerRef.current) {
        clearInterval(callTimerRef.current);
        callTimerRef.current = null;
      }
      
      // Cleanup
      pcRef.current?.close();
      pcRef.current = null;
      localStreamRef.current?.getTracks().forEach(t => t.stop());
      localStreamRef.current = null;
      // Redirect ke home
      window.location.href = '/';
    });

    return () => {
      s.disconnect();
      pcRef.current?.close();
      pcRef.current = null;
      localStreamRef.current?.getTracks().forEach(t => t.stop());
      if (callTimerRef.current) {
        clearInterval(callTimerRef.current);
      }
    };
  }, [roomId]);

  const ensurePeerConnection = async (socketInstance: Socket) => {
    // Reset peer connection jika sudah ada (untuk koneksi baru yang bersih)
    if (pcRef.current) {
      console.log('Closing existing peer connection for fresh start');
      pcRef.current.close();
      pcRef.current = null;
    }
    
    // PENTING: Pastikan local stream sudah ada SEBELUM create peer connection
    if (!localStreamRef.current) {
      try {
        localStreamRef.current = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = localStreamRef.current;
        }
        console.log('Local media stream acquired');
      } catch (error) {
        console.error('Error accessing media devices:', error);
        alert('Tidak dapat mengakses kamera/mikrofon. Pastikan izin sudah diberikan.');
        throw error;
      }
    }
    
    // Buat peer connection baru
    console.log('Creating new peer connection...');
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

    // Add tracks ke peer connection SEKARANG (sebelum create offer/answer)
    localStreamRef.current.getTracks().forEach((track) => {
      pc.addTrack(track, localStreamRef.current!);
      console.log('Added track to peer connection:', track.kind);
    });
    
    console.log('Peer connection setup complete with tracks');
  };

  const startCall = async () => {
    if (!socket) {
      alert('Tidak terhubung ke server');
      return;
    }
    try {
      setIsCalling(true);
      
      // Start call timer
      setCallDuration(0);
      if (callTimerRef.current) {
        clearInterval(callTimerRef.current);
      }
      callTimerRef.current = setInterval(() => {
        setCallDuration(prev => prev + 1);
      }, 1000);
      
      await ensurePeerConnection(socket);
      const pc = pcRef.current!;
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('offer', { roomId, sdp: offer });
      console.log('Sent offer manually');
    } catch (error) {
      console.error('Error starting call:', error);
      setIsCalling(false);
      if (callTimerRef.current) {
        clearInterval(callTimerRef.current);
        callTimerRef.current = null;
      }
    }
  };

  const hangUp = () => {
    pcRef.current?.close();
    pcRef.current = null;
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
    setIsCalling(false);
  };

  const endCallAndExit = () => {
    // Stop timer
    if (callTimerRef.current) {
      clearInterval(callTimerRef.current);
      callTimerRef.current = null;
    }
    
    // Save call duration to sessionStorage for logging
    sessionStorage.setItem('lastCallDuration', callDuration.toString());
    
    // Emit event ke server untuk notify peer lain
    if (socket) {
      socket.emit('end-call', { roomId });
      console.log('Sent end-call event to room');
    }
    
    hangUp();
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    localStreamRef.current = null;
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }
    // Redirect back to home
    window.location.href = '/';
  };

  const toggleVideo = () => {
    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoEnabled(videoTrack.enabled);
        console.log('Video', videoTrack.enabled ? 'enabled' : 'disabled');
      }
    }
  };

  const toggleAudio = () => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsAudioEnabled(audioTrack.enabled);
        console.log('Audio toggled:', audioTrack.enabled);
        
        // Kirim status mute ke remote peer melalui signaling
        if (socket) {
          socket.emit('mute-status', {
            roomId,
            isAudioEnabled: audioTrack.enabled,
          });
          console.log('Sent mute status to peers:', audioTrack.enabled);
        }
      }
    }
  };

  return (
    <div className="relative min-h-screen bg-black">
      {/* Remote Video (Full Screen) */}
      <div className="absolute inset-0 w-full h-full">
        <video 
          ref={remoteVideoRef} 
          autoPlay 
          playsInline 
          className="w-full h-full object-cover"
        />
        
        {/* Remote Mute Indicator */}
        {!isRemoteAudioEnabled && (
          <div className="absolute top-20 left-1/2 transform -translate-x-1/2 bg-red-500/90 backdrop-blur-md px-6 py-3 rounded-full shadow-2xl z-10">
            <div className="flex items-center gap-3">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                <line x1="18" y1="9" x2="22" y2="13" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
                <line x1="22" y1="9" x2="18" y2="13" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
              </svg>
              <span className="text-white font-semibold text-sm">Peer is muted</span>
            </div>
          </div>
        )}
      </div>

      {/* Local Video (Picture in Picture - Top Right) */}
      <div className="absolute top-4 right-4 w-48 h-36 bg-gray-900 rounded-lg shadow-2xl overflow-hidden border-2 border-white/30 z-10">
        <video 
          ref={localVideoRef} 
          autoPlay 
          muted 
          playsInline 
          className="w-full h-full object-cover"
        />
      </div>

      {/* Top Bar - Connection Status */}
      <div className="absolute top-4 left-4 z-10">
        <div className={`inline-flex items-center px-4 py-2 rounded-full text-sm backdrop-blur-md ${isConnected ? 'bg-green-500/80 text-white' : 'bg-red-500/80 text-white'}`}>
          <span className={`w-2 h-2 rounded-full mr-2 ${isConnected ? 'bg-white' : 'bg-white'}`}></span>
          {isConnected ? 'Connected' : 'Disconnected'}
        </div>
      </div>

      {/* Call Duration Timer */}
      {isCalling && (
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-10">
          <div className="bg-white/10 backdrop-blur-sm px-3 py-1 rounded-full border border-white/20">
            <span className="text-white font-mono text-sm tracking-wide">
              {Math.floor(callDuration / 60).toString().padStart(2, '0')}:{(callDuration % 60).toString().padStart(2, '0')}
            </span>
          </div>
        </div>
      )}

      {/* Bottom Controls Bar */}
      <div className="absolute bottom-0 left-0 right-0 z-20 pt-20 pb-8">
        <div className="flex justify-center items-center gap-4">
          {/* Toggle Video Button */}
          <button
            onClick={toggleVideo}
            className={`w-14 h-14 rounded-full font-semibold transition-all shadow-lg flex items-center justify-center ${
              isVideoEnabled
                ? 'bg-white/40 hover:bg-white/30 backdrop-blur-md text-white'
                : 'bg-red-600 hover:bg-red-700 text-white'
            }`}
            title={isVideoEnabled ? 'Turn off camera' : 'Turn on camera'}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {isVideoEnabled ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
              )}
            </svg>
          </button>
          
          {/* End Call Button */}
          <button 
            onClick={endCallAndExit}
            className="w-16 h-16 bg-red-600 hover:bg-red-700 text-white rounded-full font-semibold transition-all shadow-2xl flex items-center justify-center transform hover:scale-105"
            title="End call"
          >
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 8l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M5 3a2 2 0 00-2 2v1c0 8.284 6.716 15 15 15h1a2 2 0 002-2v-3.28a1 1 0 00-.684-.948l-4.493-1.498a1 1 0 00-1.21.502l-1.13 2.257a11.042 11.042 0 01-5.516-5.517l2.257-1.128a1 1 0 00.502-1.21L9.228 3.683A1 1 0 008.279 3H5z" />
            </svg>
          </button>

          {/* Toggle Audio Button */}
          <button
            onClick={toggleAudio}
            className={`w-14 h-14 rounded-full font-semibold transition-all shadow-lg flex items-center justify-center ${
              isAudioEnabled
                ? 'bg-white/40 hover:bg-white/30 backdrop-blur-md text-white'
                : 'bg-red-600 hover:bg-red-700 text-white'
            }`}
            title={isAudioEnabled ? 'Mute microphone' : 'Unmute microphone'}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {isAudioEnabled ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
              )}
            </svg>
          </button>
        </div>

        {/* Room ID Info */}
        <div className="text-center mt-4">
          <p className="text-white/60 text-sm">Room: <span className="text-white/80 font-mono">{roomId}</span></p>
        </div>
      </div>
    </div>
  );
}
