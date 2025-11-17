'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { io, Socket } from 'socket.io-client';

const SIGNALING_URL = process.env.NEXT_PUBLIC_SIGNALING_URL || 'http://localhost:3001';

interface CallLog {
  id: string;
  type: 'outgoing' | 'incoming' | 'missed';
  userCode: string;
  timestamp: number;
  duration?: number; // in seconds
  status: 'completed' | 'rejected' | 'cancelled' | 'timeout' | 'no-answer';
}

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
  const [isCopied, setIsCopied] = useState(false);
  const callTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const incomingCallTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const timeOutCall = 60000; // 60 seconds
  const [showCallLog, setShowCallLog] = useState(false);
  const [callLogs, setCallLogs] = useState<CallLog[]>([]);

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

  // Load user code from localStorage on mount
  useEffect(() => {
    const storedUserCode = localStorage.getItem('webrtc-user-code');
    if (storedUserCode) {
      console.log('Loaded user code from localStorage:', storedUserCode);
      setUserCode(storedUserCode);
    }
    
    // Load call logs
    const storedLogs = localStorage.getItem('webrtc-call-logs');
    if (storedLogs) {
      try {
        setCallLogs(JSON.parse(storedLogs));
      } catch (e) {
        console.error('Error parsing call logs:', e);
      }
    }
    
    // Check if returning from a call
    const lastCallDuration = sessionStorage.getItem('lastCallDuration');
    const lastCallPeer = sessionStorage.getItem('lastCallPeer');
    const lastCallType = sessionStorage.getItem('lastCallType');
    
    if (lastCallDuration && lastCallPeer && lastCallType) {
      // Log completed call
      const newLog: CallLog = {
        id: `${Date.now()}-${Math.random().toString(36).substring(7)}`,
        type: lastCallType as 'outgoing' | 'incoming',
        userCode: lastCallPeer,
        timestamp: Date.now(),
        duration: parseInt(lastCallDuration),
        status: 'completed',
      };
      
      const logs = JSON.parse(storedLogs || '[]');
      const updatedLogs = [newLog, ...logs].slice(0, 50);
      setCallLogs(updatedLogs);
      localStorage.setItem('webrtc-call-logs', JSON.stringify(updatedLogs));
      
      // Clear session storage
      sessionStorage.removeItem('lastCallDuration');
      sessionStorage.removeItem('lastCallPeer');
      sessionStorage.removeItem('lastCallType');
    }
  }, []);

  useEffect(() => {
    const s = io(SIGNALING_URL);
    setSocket(s);

    s.on('connect', () => {
      console.log('Connected to server');
      setIsConnected(true);
      
      // Cek apakah sudah ada user code di localStorage
      const storedUserCode = localStorage.getItem('webrtc-user-code');
      if (storedUserCode) {
        console.log('Reusing stored user code:', storedUserCode);
        // Register dengan user code yang sudah ada
        s.emit('register-user', { userCode: storedUserCode });
      } else {
        // Generate user code baru
        console.log('Requesting new user code');
        s.emit('register-user');
      }
    });

    s.on('disconnect', () => {
      console.log('Disconnected from server');
      setIsConnected(false);
    });

    s.on('user-registered', ({ userCode }: { userCode: string }) => {
      console.log('User code received:', userCode);
      setUserCode(userCode);
      // Simpan ke localStorage
      localStorage.setItem('webrtc-user-code', userCode);
      console.log('User code saved to localStorage');
    });

    s.on('call-initiated', ({ roomId }: { roomId: string }) => {
      console.log('Call initiated, waiting for response...');
      setIsCalling(true);
      // Simpan roomId dan targetUserCode untuk nanti
      sessionStorage.setItem('pendingRoomId', roomId);
      sessionStorage.setItem('pendingTargetUserCode', targetUserCode);
      
      // Set timeout 60 detik, jika tidak diterima otomatis batalkan
      const savedTargetUserCode = targetUserCode; // Simpan dalam closure
      callTimeoutRef.current = setTimeout(() => {
        console.log('Call timeout - no response after 60 seconds');
        setIsCalling(false);
        
        // Log timeout call dengan userCode yang tersimpan
        addCallLog({
          type: 'outgoing',
          userCode: savedTargetUserCode,
          status: 'timeout',
        });
        
        // Emit cancel-call ke server
        if (s && savedTargetUserCode) {
          s.emit('cancel-call', { targetUserCode: savedTargetUserCode });
        }
        
        // Stop ringtone
        ringtoneRef.current?.pause();
        if (ringtoneRef.current) {
          ringtoneRef.current.currentTime = 0;
        }
        
        alert('Panggilan tidak dijawab (timeout 60 detik)');
        setTargetUserCode('');
        sessionStorage.removeItem('pendingTargetUserCode');
      }, timeOutCall); // 60 seconds
    });

    s.on('call-accepted', ({ roomId }: { roomId: string }) => {
      console.log('Call accepted! Redirecting to room:', roomId);
      setIsCalling(false);
      
      // Clear timeout karena call sudah diterima
      if (callTimeoutRef.current) {
        clearTimeout(callTimeoutRef.current);
        callTimeoutRef.current = null;
      }
      
      // Get targetUserCode from sessionStorage
      const savedTargetUserCode = sessionStorage.getItem('pendingTargetUserCode') || targetUserCode;
      
      // Save call info for logging
      sessionStorage.setItem('lastCallPeer', savedTargetUserCode);
      sessionStorage.setItem('lastCallType', 'outgoing');
      sessionStorage.removeItem('pendingTargetUserCode');
      
      // Mark as caller for auto-start
      sessionStorage.setItem('wasCaller', 'true');
      router.push(`/call/${roomId}`);
    });

    s.on('call-rejected', () => {
      console.log('Call rejected');
      setIsCalling(false);
      
      // Clear timeout karena call sudah ditolak
      if (callTimeoutRef.current) {
        clearTimeout(callTimeoutRef.current);
        callTimeoutRef.current = null;
      }
      
      // Get targetUserCode from sessionStorage
      const savedTargetUserCode = sessionStorage.getItem('pendingTargetUserCode') || targetUserCode;
      
      // Log rejected call
      addCallLog({
        type: 'outgoing',
        userCode: savedTargetUserCode,
        status: 'rejected',
      });
      
      sessionStorage.removeItem('pendingTargetUserCode');
      alert('Panggilan ditolak oleh user');
    });

    s.on('incoming-call', (data: { from: string; callerName: string; roomId: string; callerSocketId: string }) => {
      console.log('Incoming call from:', data.from);
      setIncomingCall(data);
      
      // Set timeout 60 detik untuk incoming call
      incomingCallTimeoutRef.current = setTimeout(() => {
        console.log('Incoming call timeout - no response after 60 seconds');
        
        // Log missed call
        addCallLog({
          type: 'incoming',
          userCode: data.from,
          status: 'no-answer',
        });
        
        setIncomingCall(null);
        
        // Stop ringtone
        ringtoneRef.current?.pause();
        if (ringtoneRef.current) {
          ringtoneRef.current.currentTime = 0;
        }
        
        console.log('Incoming call modal closed due to timeout');
      }, timeOutCall); // 60 seconds
    });

    s.on('call-cancelled', () => {
      console.log('Call cancelled');
      setIncomingCall(null);
      
      // Clear incoming call timeout
      if (incomingCallTimeoutRef.current) {
        clearTimeout(incomingCallTimeoutRef.current);
        incomingCallTimeoutRef.current = null;
      }
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
    
    // Clear incoming call timeout
    if (incomingCallTimeoutRef.current) {
      clearTimeout(incomingCallTimeoutRef.current);
      incomingCallTimeoutRef.current = null;
    }
    
    // Save call info for logging
    sessionStorage.setItem('lastCallPeer', incomingCall.from);
    sessionStorage.setItem('lastCallType', 'incoming');
    
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
    
    // Clear incoming call timeout
    if (incomingCallTimeoutRef.current) {
      clearTimeout(incomingCallTimeoutRef.current);
      incomingCallTimeoutRef.current = null;
    }
    
    // Log rejected incoming call
    addCallLog({
      type: 'incoming',
      userCode: incomingCall.from,
      status: 'rejected',
    });
    
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
    if (!socket) return;
    
    // Get targetUserCode from sessionStorage or state
    const savedTargetUserCode = sessionStorage.getItem('pendingTargetUserCode') || targetUserCode;
    if (!savedTargetUserCode) return;
    
    // Clear timeout
    if (callTimeoutRef.current) {
      clearTimeout(callTimeoutRef.current);
      callTimeoutRef.current = null;
    }
    
    // Log cancelled call
    addCallLog({
      type: 'outgoing',
      userCode: savedTargetUserCode,
      status: 'cancelled',
    });
    
    // Stop ringtone
    ringtoneRef.current?.pause();
    if (ringtoneRef.current) {
      ringtoneRef.current.currentTime = 0;
    }
    
    socket.emit('cancel-call', { targetUserCode: savedTargetUserCode });
    setIsCalling(false);
    setTargetUserCode('');
    sessionStorage.removeItem('pendingTargetUserCode');
  };

  const copyUserCode = () => {
    navigator.clipboard.writeText(userCode);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  const addCallLog = (log: Omit<CallLog, 'id' | 'timestamp'>) => {
    const newLog: CallLog = {
      ...log,
      id: `${Date.now()}-${Math.random().toString(36).substring(7)}`,
      timestamp: Date.now(),
    };
    
    const updatedLogs = [newLog, ...callLogs].slice(0, 50); // Keep last 50 logs
    setCallLogs(updatedLogs);
    localStorage.setItem('webrtc-call-logs', JSON.stringify(updatedLogs));
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
            <div className="mb-6 p-4 bg-gradient-to-r from-blue-500 to-indigo-600 rounded-lg relative">
              <p className="text-white text-sm mb-1">Your User Code:</p>
              <div className="flex items-center justify-between">
                <span className="text-3xl font-bold text-white tracking-wider">{userCode}</span>
                <button
                  onClick={copyUserCode}
                  className="px-3 py-1 bg-white text-blue-600 rounded text-sm font-semibold hover:bg-blue-50 transition relative"
                >
                  {isCopied ? (
                    <>
                      <svg className="w-4 h-4 inline mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      Copied!
                    </>
                  ) : (
                    'Copy'
                  )}
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
                placeholder="User Code"
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
              <li>• Bagikan <strong>User Code</strong> Anda ke pengguna lain</li>
              <li>• Masukkan User Code pengguna lain untuk memanggil</li>
              <li>• Tunggu pengguna lain menerima panggilan</li>
              <li>• Pastikan kamera dan mikrofon diizinkan</li>
            </ul>
          </div>

          {/* Call Log Button */}
          <button
            onClick={() => setShowCallLog(true)}
            className="mt-4 w-full bg-gray-100 text-gray-700 py-2 rounded-lg font-medium hover:bg-gray-200 transition flex items-center justify-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Riwayat Panggilan ({callLogs.length})
          </button>
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

        {/* Call Log Modal */}
        {showCallLog && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl p-6 max-w-lg w-full max-h-[80vh] overflow-hidden shadow-2xl flex flex-col">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-2xl font-bold text-gray-800">Riwayat Panggilan</h2>
                <button
                  onClick={() => setShowCallLog(false)}
                  className="text-gray-500 hover:text-gray-700 transition"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {callLogs.length === 0 ? (
                <div className="text-center py-12">
                  <svg className="w-16 h-16 text-gray-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                  </svg>
                  <p className="text-gray-500 text-lg">Belum ada riwayat panggilan</p>
                </div>
              ) : (
                <div className="overflow-y-auto flex-1">
                  {callLogs.map((log) => {
                    const date = new Date(log.timestamp);
                    const timeStr = date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
                    const dateStr = date.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
                    
                    const getStatusIcon = () => {
                      if (log.status === 'completed') {
                        return log.type === 'outgoing' ? (
                          <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                          </svg>
                        ) : (
                          <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 10h-10a8 8 0 00-8 8v2M21 10l-6 6m6-6l-6-6" />
                          </svg>
                        );
                      } else if (log.status === 'rejected' || log.status === 'no-answer') {
                        return (
                          <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        );
                      } else {
                        return (
                          <svg className="w-5 h-5 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                        );
                      }
                    };

                    const getStatusText = () => {
                      switch (log.status) {
                        case 'completed': return 'Selesai';
                        case 'rejected': return 'Ditolak';
                        case 'cancelled': return 'Dibatalkan';
                        case 'timeout': return 'Timeout';
                        case 'no-answer': return 'Tidak Dijawab';
                        default: return log.status;
                      }
                    };

                    const formatDuration = (seconds: number) => {
                      const mins = Math.floor(seconds / 60);
                      const secs = seconds % 60;
                      return `${mins}:${secs.toString().padStart(2, '0')}`;
                    };

                    return (
                      <div key={log.id} className="border-b border-gray-200 py-3 hover:bg-gray-50 transition px-2 rounded">
                        <div className="flex items-start gap-3">
                          <div className="mt-1">
                            {getStatusIcon()}
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center justify-between">
                              <p className="font-semibold text-gray-800 text-lg">{log.userCode}</p>
                              <span className="text-xs text-gray-500">{timeStr}</span>
                            </div>
                            <div className="flex items-center gap-2 mt-1">
                              <span className={`text-xs px-2 py-0.5 rounded-full ${
                                log.type === 'outgoing' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
                              }`}>
                                {log.type === 'outgoing' ? 'Keluar' : 'Masuk'}
                              </span>
                              <span className="text-xs text-gray-600">• {getStatusText()}</span>
                              {log.duration !== undefined && (
                                <span className="text-xs text-gray-600">• {formatDuration(log.duration)}</span>
                              )}
                            </div>
                            <p className="text-xs text-gray-500 mt-1">{dateStr}</p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="mt-4 pt-4 border-t border-gray-200">
                <button
                  onClick={() => setShowCallLog(false)}
                  className="w-full bg-blue-600 text-white py-2 rounded-lg font-semibold hover:bg-blue-700 transition"
                >
                  Tutup
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}