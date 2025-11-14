'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { io, Socket } from 'socket.io-client';

const SIGNALING_URL = process.env.NEXT_PUBLIC_SIGNALING_URL || 'http://localhost:3001';

export default function Home() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [userCode, setUserCode] = useState<string>('');
  const [targetUserCode, setTargetUserCode] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [isCalling, setIsCalling] = useState(false);
  const [incomingCall, setIncomingCall] = useState<{
    from: string;
    callerName: string;
    roomId: string;
    callerSocketId: string;
  } | null>(null);
  const router = useRouter();
  const ringtoneRef = useRef<HTMLAudioElement | null>(null);

  // Setup audio ringtone
  useEffect(() => {
    ringtoneRef.current = new Audio('/sound/phone-ring.mp3');
    ringtoneRef.current.loop = true;
    return () => {
      if (ringtoneRef.current) {
        ringtoneRef.current.pause();
        ringtoneRef.current = null;
      }
    };
  }, []);

  // Play/stop ringtone based on call state
  useEffect(() => {
    if (isCalling || incomingCall) {
      ringtoneRef.current?.play().catch(err => console.log('Audio play error:', err));
    } else {
      ringtoneRef.current?.pause();
      if (ringtoneRef.current) {
        ringtoneRef.current.currentTime = 0;
      }
    }
  }, [isCalling, incomingCall]);

  useEffect(() => {
    const s = io(SIGNALING_URL);
    setSocket(s);

    s.on('connect', () => {
      console.log('Connected to server');
      setIsConnected(true);
      // Register user dan dapatkan user code
      s.emit('register-user');
    });

    s.on('disconnect', () => {
      console.log('Disconnected from server');
      setIsConnected(false);
    });

    s.on('user-registered', ({ userCode }: { userCode: string }) => {
      console.log('User code received:', userCode);
      setUserCode(userCode);
    });

    s.on('call-initiated', ({ roomId }: { roomId: string }) => {
      console.log('Call initiated, waiting for response...');
      setIsCalling(true);
      // Simpan roomId untuk nanti
      sessionStorage.setItem('pendingRoomId', roomId);
    });

    s.on('call-accepted', ({ roomId }: { roomId: string }) => {
      console.log('Call accepted! Redirecting to room:', roomId);
      setIsCalling(false);
      // Mark as caller for auto-start
      sessionStorage.setItem('wasCaller', 'true');
      router.push(`/call/${roomId}`);
    });

    s.on('call-rejected', () => {
      console.log('Call rejected');
      setIsCalling(false);
      alert('Panggilan ditolak oleh user');
    });

    s.on('incoming-call', (data: { from: string; callerName: string; roomId: string; callerSocketId: string }) => {
      console.log('Incoming call from:', data.from);
      setIncomingCall(data);
    });

    s.on('call-cancelled', () => {
      console.log('Call cancelled');
      setIncomingCall(null);
    });

    s.on('call-error', ({ message }: { message: string }) => {
      console.error('Call error:', message);
      setIsCalling(false);
      alert(message);
    });

    return () => {
      s.disconnect();
    };
  }, [router]);

  const handleCallUser = (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetUserCode.trim() || !socket) return;

    if (targetUserCode === userCode) {
      alert('Tidak bisa memanggil diri sendiri!');
      return;
    }

    console.log('Calling user:', targetUserCode);
    socket.emit('call-user', { 
      targetUserCode: targetUserCode.trim(),
      callerName: userCode 
    });
  };

  const handleAcceptCall = () => {
    if (!incomingCall || !socket) return;
    
    // Stop ringtone
    ringtoneRef.current?.pause();
    if (ringtoneRef.current) {
      ringtoneRef.current.currentTime = 0;
    }
    
    console.log('Accepting call...');
    socket.emit('accept-call', {
      roomId: incomingCall.roomId,
      callerSocketId: incomingCall.callerSocketId,
    });
    
    setIncomingCall(null);
    router.push(`/call/${incomingCall.roomId}`);
  };

  const handleRejectCall = () => {
    if (!incomingCall || !socket) return;
    
    // Stop ringtone
    ringtoneRef.current?.pause();
    if (ringtoneRef.current) {
      ringtoneRef.current.currentTime = 0;
    }
    
    console.log('Rejecting call...');
    socket.emit('reject-call', {
      callerSocketId: incomingCall.callerSocketId,
    });
    
    setIncomingCall(null);
  };

  const handleCancelCall = () => {
    if (!socket || !targetUserCode) return;
    
    // Stop ringtone
    ringtoneRef.current?.pause();
    if (ringtoneRef.current) {
      ringtoneRef.current.currentTime = 0;
    }
    
    socket.emit('cancel-call', { targetUserCode });
    setIsCalling(false);
    setTargetUserCode('');
  };

  const copyUserCode = () => {
    navigator.clipboard.writeText(userCode);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
      <main className="w-full max-w-md p-8">
        <div className="bg-white rounded-2xl shadow-xl p-8">
          <h1 className="text-4xl font-bold text-center mb-2 text-gray-800">
            WebRTC Video Call
          </h1>
          <p className="text-center text-gray-600 mb-6">
            Panggil user lain dengan User Code
          </p>

          {/* Connection Status */}
          <div className="mb-6">
            <div className={`inline-flex items-center px-3 py-1 rounded-full text-sm ${isConnected ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
              <span className={`w-2 h-2 rounded-full mr-2 ${isConnected ? 'bg-green-500' : 'bg-red-500'}`}></span>
              {isConnected ? 'Connected' : 'Disconnected'}
            </div>
          </div>

          {/* User Code Display */}
          {userCode && (
            <div className="mb-6 p-4 bg-gradient-to-r from-blue-500 to-indigo-600 rounded-lg">
              <p className="text-white text-sm mb-1">Your User Code:</p>
              <div className="flex items-center justify-between">
                <span className="text-3xl font-bold text-white tracking-wider">{userCode}</span>
                <button
                  onClick={copyUserCode}
                  className="px-3 py-1 bg-white text-blue-600 rounded text-sm font-semibold hover:bg-blue-50 transition"
                >
                  Copy
                </button>
              </div>
              <p className="text-blue-100 text-xs mt-2">Bagikan kode ini untuk menerima panggilan</p>
            </div>
          )}

          {/* Call Form */}
          <form onSubmit={handleCallUser} className="space-y-4">
            <div>
              <label htmlFor="targetUserCode" className="block text-sm font-medium text-gray-700 mb-2">
                User Code Tujuan
              </label>
              <input
                id="targetUserCode"
                type="text"
                value={targetUserCode}
                onChange={(e) => setTargetUserCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="Masukkan 6 digit user code"
                maxLength={6}
                disabled={isCalling}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition text-gray-800 text-center text-2xl tracking-widest font-bold disabled:bg-gray-100"
              />
            </div>

            {!isCalling ? (
              <button
                type="submit"
                disabled={!targetUserCode.trim() || targetUserCode.length !== 6 || !isConnected}
                className="w-full bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition flex items-center justify-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                </svg>
                Panggil User
              </button>
            ) : (
              <button
                type="button"
                onClick={handleCancelCall}
                className="w-full bg-red-600 text-white py-3 rounded-lg font-semibold hover:bg-red-700 transition flex items-center justify-center gap-2"
              >
                <svg className="w-5 h-5 animate-pulse" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M6 18L18 6M6 6l12 12" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
                </svg>
                Batalkan Panggilan
              </button>
            )}
          </form>

          <div className="mt-8 p-4 bg-blue-50 rounded-lg">
            <h3 className="font-semibold text-blue-900 mb-2">📞 Cara Menggunakan:</h3>
            <ul className="text-sm text-blue-800 space-y-1">
              <li>• Bagikan <strong>User Code</strong> Anda ke teman</li>
              <li>• Masukkan User Code teman untuk memanggil</li>
              <li>• Tunggu teman menerima panggilan</li>
              <li>• Pastikan kamera dan mikrofon diizinkan</li>
            </ul>
          </div>
        </div>

        {/* Incoming Call Modal */}
        {incomingCall && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl p-8 max-w-sm w-full shadow-2xl">
              <div className="text-center">
                <div className="w-20 h-20 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-10 h-10 text-blue-600 animate-pulse" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                  </svg>
                </div>
                <h2 className="text-2xl font-bold text-gray-800 mb-2">Panggilan Masuk</h2>
                <p className="text-gray-600 mb-1">dari</p>
                <p className="text-3xl font-bold text-blue-600 mb-6 tracking-wider">{incomingCall.from}</p>
                
                <div className="flex gap-3">
                  <button
                    onClick={handleRejectCall}
                    className="flex-1 bg-red-600 text-white py-3 rounded-lg font-semibold hover:bg-red-700 transition flex items-center justify-center gap-2"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                    Tolak
                  </button>
                  <button
                    onClick={handleAcceptCall}
                    className="flex-1 bg-green-600 text-white py-3 rounded-lg font-semibold hover:bg-green-700 transition flex items-center justify-center gap-2"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Terima
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}