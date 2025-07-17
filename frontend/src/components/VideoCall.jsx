import React, { useEffect, useRef, useState, useCallback } from "react";
import { useAuthStore } from "../store/useAuthStore";
import { AlertCircle, Camera, CameraOff, Mic, MicOff, Phone, PhoneOff, RefreshCw, Wifi, WifiOff } from "lucide-react";

// Get rejectCall from useAuthStore outside the component to avoid re-creation on re-renders
const { rejectCall } = useAuthStore.getState();

const VideoCall = ({ onCallEnd }) => {
  // Move useRef inside the component
  const ringAudio = useRef(new Audio("/ringtone.mp3")); // <-- Corrected line

  const {
    socket,
    authUser,
    callAccepted,
    callEnded,
    caller,
    receivingCall,
    callSignal,
    answerCall,
    sendIceCandidate,
    endCall,
  } = useAuthStore();

  // Media and connection states
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [peerConnection, setPeerConnection] = useState(null);
  const [micMuted, setMicMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [isInitiator, setIsInitiator] = useState(false);
  
  // Enhanced error handling states
  const [mediaError, setMediaError] = useState(null);
  const [connectionError, setConnectionError] = useState(null);
  const [socketError, setSocketError] = useState(null);
  const [isLoadingMedia, setIsLoadingMedia] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [retryAttempts, setRetryAttempts] = useState(0);
  const [callStatus, setCallStatus] = useState('idle'); // idle, connecting, connected, disconnected, failed
  const [networkQuality, setNetworkQuality] = useState('unknown'); // good, fair, poor
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [deviceErrors, setDeviceErrors] = useState({ camera: false, microphone: false });

  // Refs for video elements and timers
  const localVideoRef = useRef();
  const remoteVideoRef = useRef();
  const callStartTimeRef = useRef();
  const reconnectTimeoutRef = useRef();
  const statsIntervalRef = useRef();

  // Constants for retry logic and intervals
  const MAX_RETRY_ATTEMPTS = 3;
  const RECONNECT_TIMEOUT = 5000; // 5 seconds
  const STATS_INTERVAL = 1000; // 1 second

  // Enhanced permissions check with detailed device info
  const checkMediaPermissions = useCallback(async () => {
    try {
      // Query permissions for camera and microphone
      const permissions = await Promise.all([
        navigator.permissions.query({ name: 'camera' }),
        navigator.permissions.query({ name: 'microphone' })
      ]);
      
      const [cameraPermission, micPermission] = permissions;
      
      // Enumerate devices to check for physical availability
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cameras = devices.filter(device => device.kind === 'videoinput');
      const microphones = devices.filter(device => device.kind === 'audioinput');
      
      return {
        camera: {
          permission: cameraPermission.state,
          available: cameras.length > 0,
          devices: cameras // List of available camera devices
        },
        microphone: {
          permission: micPermission.state,
          available: microphones.length > 0,
          devices: microphones // List of available microphone devices
        }
      };
    } catch (error) {
      console.log("Permissions API not fully supported or error:", error);
      // Fallback for browsers not fully supporting Permissions API
      return { 
        camera: { permission: 'unknown', available: true, devices: [] },
        microphone: { permission: 'unknown', available: true, devices: [] }
      };
    }
  }, []);

  // Enhanced media access with fallback constraints and error handling
  const getMediaWithErrorHandling = useCallback(async (constraints = { video: true, audio: true }) => {
    setIsLoadingMedia(true);
    setMediaError(null);
    setPermissionDenied(false);
    setDeviceErrors({ camera: false, microphone: false }); // Reset device errors

    try {
      // Basic browser support check for getUserMedia
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("BROWSER_NOT_SUPPORTED");
      }

      // Check detailed permissions and device availability
      const permissionStatus = await checkMediaPermissions();
      console.log("Media permissions status:", permissionStatus);

      // Adjust constraints if devices are not available
      if (!permissionStatus.camera.available && constraints.video) {
        setDeviceErrors(prev => ({ ...prev, camera: true }));
        constraints.video = false; // Disable video if no camera
      }

      if (!permissionStatus.microphone.available && constraints.audio) {
        setDeviceErrors(prev => ({ ...prev, microphone: true }));
        constraints.audio = false; // Disable audio if no microphone
      }

      // Attempt to get media stream with the (possibly adjusted) constraints
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      
      // Verify that tracks are actually obtained, even if constraints were true
      const videoTracks = stream.getVideoTracks();
      const audioTracks = stream.getAudioTracks();
      
      if (constraints.video && videoTracks.length === 0) {
        setDeviceErrors(prev => ({ ...prev, camera: true }));
      }
      
      if (constraints.audio && audioTracks.length === 0) {
        setDeviceErrors(prev => ({ ...prev, microphone: true }));
      }

      setLocalStream(stream);
      setCallStatus('connected'); // Media stream successfully obtained
      
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      // Add listeners to tracks to detect if they end unexpectedly (e.g., device unplugged)
      stream.getTracks().forEach(track => {
        track.addEventListener('ended', () => {
          console.log(`${track.kind} track ended unexpectedly`);
          if (track.kind === 'video') {
            setDeviceErrors(prev => ({ ...prev, camera: true }));
          } else if (track.kind === 'audio') {
            setDeviceErrors(prev => ({ ...prev, microphone: true }));
          }
        });
      });

      return stream;
    } catch (error) {
      console.error("Media access error:", error);
      setCallStatus('failed'); // Media access failed
      handleMediaError(error); // Detailed error handling
      return null;
    } finally {
      setIsLoadingMedia(false);
    }
  }, [checkMediaPermissions, retryAttempts]); // Dependency on retryAttempts to trigger re-attempt

  // Centralized media error handling based on error name
  const handleMediaError = useCallback((error) => {
    let errorMessage = "";
    let canRetry = true; // Flag to indicate if a retry attempt is possible

    switch (error.name || error.message) {
      case 'NotAllowedError':
      case 'PermissionDeniedError':
        setPermissionDenied(true); // User explicitly denied permissions
        errorMessage = "Camera and microphone access denied. Please allow permissions in your browser settings and refresh the page.";
        canRetry = false; // Cannot retry without user intervention
        break;
      
      case 'NotFoundError':
      case 'DevicesNotFoundError':
        errorMessage = "No camera or microphone found. Please connect your devices and try again.";
        break;
      
      case 'NotReadableError':
      case 'TrackStartError':
        errorMessage = "Camera or microphone is already in use by another application. Please close other applications and try again.";
        break;
      
      case 'OverconstrainedError':
      case 'ConstraintNotSatisfiedError':
        errorMessage = "Camera/microphone constraints cannot be satisfied. Trying with lower quality...";
        if (retryAttempts < MAX_RETRY_ATTEMPTS) {
          // Attempt with less demanding constraints
          setTimeout(() => {
            setRetryAttempts(prev => prev + 1);
            getMediaWithErrorHandling({ 
              video: { width: 640, height: 480, frameRate: 15 }, 
              audio: { echoCancellation: true, noiseSuppression: true } 
            });
          }, 1000);
        } else {
          errorMessage = "Failed to get media with available constraints after multiple attempts.";
          canRetry = false;
        }
        break;
      
      case 'NotSupportedError':
        errorMessage = "Media constraints are not supported by this browser. Please update your browser.";
        canRetry = false;
        break;
      
      case 'TypeError':
        errorMessage = "Invalid media constraints. Please refresh the page and try again.";
        break;
      
      case 'BROWSER_NOT_SUPPORTED':
        errorMessage = "Your browser doesn't support video calling. Please use a modern browser like Chrome, Firefox, or Safari.";
        canRetry = false;
        break;
      
      default:
        errorMessage = `Media access error: ${error.message}. Please check your device permissions and try again.`;
    }

    setMediaError({ message: errorMessage, canRetry });
  }, [retryAttempts, getMediaWithErrorHandling]);

  // Monitor network quality using RTCPeerConnection stats
  const monitorNetworkQuality = useCallback(async () => {
    if (!peerConnection) return;

    try {
      const stats = await peerConnection.getStats();
      let bytesReceived = 0;
      let bytesSent = 0;
      let packetsLost = 0;

      stats.forEach(report => {
        if (report.type === 'inbound-rtp') {
          bytesReceived += report.bytesReceived || 0;
          packetsLost += report.packetsLost || 0;
        }
        if (report.type === 'outbound-rtp') {
          bytesSent += report.bytesSent || 0;
        }
      });

      // Simple quality assessment based on packet loss
      const quality = packetsLost > 100 ? 'poor' : 
                     packetsLost > 10 ? 'fair' : 'good';
      
      setNetworkQuality(quality);
    } catch (error) {
      console.error('Error monitoring network quality:', error);
    }
  }, [peerConnection]);

  // Enhanced reconnection logic for peer connection
  const handleReconnection = useCallback(async () => {
    if (isReconnecting) return; // Prevent multiple reconnection attempts

    setIsReconnecting(true);
    setConnectionError('Connection lost. Attempting to reconnect...');

    try {
      // Clear any existing reconnection timeout
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }

      // Wait for a short period before attempting to reconnect
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Check if socket is still connected
      if (!socket || !socket.connected) {
        setSocketError('Socket disconnected. Please refresh the page.');
        return;
      }

      // If local stream was lost, try to re-acquire it
      if (!localStream) {
        await getMediaWithErrorHandling();
      }

      // Reset connection error after successful reconnection
      setConnectionError(null);
      setCallStatus('connected');
    } catch (error) {
      console.error('Reconnection failed:', error);
      setConnectionError('Failed to reconnect. Please end the call and try again.');
    } finally {
      setIsReconnecting(false);
    }
  }, [isReconnecting, socket, localStream, getMediaWithErrorHandling]);

  // Effect for call duration timer
  useEffect(() => {
    if (callAccepted && !callEnded) {
      callStartTimeRef.current = Date.now(); // Record call start time
      const interval = setInterval(() => {
        setCallDuration(Math.floor((Date.now() - callStartTimeRef.current) / 1000));
      }, 1000); // Update every second
      
      return () => clearInterval(interval); // Cleanup interval on unmount or call end
    }
  }, [callAccepted, callEnded]);

  // Effect for network quality monitoring
  useEffect(() => {
    if (peerConnection && callAccepted) {
      statsIntervalRef.current = setInterval(monitorNetworkQuality, STATS_INTERVAL);
      return () => {
        if (statsIntervalRef.current) {
          clearInterval(statsIntervalRef.current);
        }
      };
    }
  }, [peerConnection, callAccepted, monitorNetworkQuality]);

  // Effect for socket error handling
  useEffect(() => {
    if (!socket) return;

    const handleSocketError = (error) => {
      console.error('Socket error:', error);
      setSocketError('Connection to server lost. Please refresh the page.');
    };

    const handleDisconnect = () => {
      setSocketError('Disconnected from server. Please refresh the page.');
    };

    const handleReconnect = () => {
      setSocketError(null); // Clear socket error on successful reconnect
    };

    socket.on('error', handleSocketError);
    socket.on('disconnect', handleDisconnect);
    socket.on('reconnect', handleReconnect);

    return () => {
      socket.off('error', handleSocketError);
      socket.off('disconnect', handleDisconnect);
      socket.off('reconnect', handleReconnect);
    };
  }, [socket]);

  // Initial media access on component mount
  useEffect(() => {
    getMediaWithErrorHandling();

    // Cleanup function for component unmount
    return () => {
      if (localStream) {
        localStream.getTracks().forEach((track) => track.stop());
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (statsIntervalRef.current) {
        clearInterval(statsIntervalRef.current);
      }
    };
  }, [getMediaWithErrorHandling]);

  // Peer connection setup and signaling logic
  useEffect(() => {
    // Ensure socket, localStream are available, and no media error
    if (!socket || !localStream || mediaError) return;

    setCallStatus('connecting');
    setConnectionError(null); // Clear previous connection errors

    try {
      // Create a new RTCPeerConnection instance
      const pc = new RTCPeerConnection({
        iceServers: [ // Google STUN servers for NAT traversal
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
          { urls: "stun:stun2.l.google.com:19302" }
        ],
        iceCandidatePoolSize: 10, // Improve ICE gathering speed
      });

      setPeerConnection(pc); // Store peer connection in state

      // Add local stream tracks to the peer connection
      localStream.getTracks().forEach((track) => {
        pc.addTrack(track, localStream);
      });

      // Event listener for when a remote track is received
      pc.ontrack = (event) => {
        const [stream] = event.streams;
        setRemoteStream(stream);
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = stream;
        }
      };

      // Event listener for ICE candidates (network information)
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          // Send ICE candidate to the other peer via socket
          // Determine recipient based on call role (caller or receiver)
          const to = receivingCall ? caller.from : caller.from; 
          sendIceCandidate(event.candidate, to);
        } else {
          console.log('ICE candidate gathering completed');
        }
      };

      // Enhanced connection state monitoring for RTCPeerConnection
      pc.onconnectionstatechange = () => {
        console.log("Connection state:", pc.connectionState);
        switch (pc.connectionState) {
          case 'connected':
            setCallStatus('connected');
            setConnectionError(null); // Clear error on successful connection
            break;
          case 'disconnected':
            setCallStatus('disconnected');
            handleReconnection(); // Attempt to reconnect
            break;
          case 'failed':
            setCallStatus('failed');
            setConnectionError('Connection failed. Please check your network and try again.');
            break;
          case 'closed':
            setCallStatus('idle');
            break;
        }
      };

      // ICE connection state monitoring (more granular than connectionstatechange)
      pc.oniceconnectionstatechange = () => {
        console.log("ICE connection state:", pc.iceConnectionState);
        switch (pc.iceConnectionState) {
          case 'failed':
            setConnectionError('Network connection failed. Please check your internet connection.');
            break;
          case 'disconnected':
            handleReconnection(); // Attempt to reconnect
            break;
        }
      };

      // Handle incoming call (if current user is the receiver)
      if (receivingCall && callSignal && !callAccepted) {
        setIsInitiator(false); // Current user is not the initiator
        pc.setRemoteDescription(new RTCSessionDescription(callSignal)) // Set remote offer
          .then(() => pc.createAnswer()) // Create answer
          .then((answer) => pc.setLocalDescription(answer)) // Set local answer
          .then(() => {
            answerCall(pc.localDescription); // Send answer to caller via socket
          })
          .catch((error) => {
            console.error("Error handling incoming call:", error);
            setConnectionError("Failed to establish connection. Please try again.");
          });
      }

      // Handle call accepted (if current user is the initiator and call is accepted)
      if (callAccepted && callSignal && !receivingCall) {
        setIsInitiator(true); // Current user is the initiator
        pc.setRemoteDescription(new RTCSessionDescription(callSignal)) // Set remote answer
          .catch((error) => {
            console.error("Error setting remote description:", error);
            setConnectionError("Failed to establish connection. Please try again.");
          });
      }

      // Cleanup function for peer connection on unmount or dependency change
      return () => {
        pc.close(); // Close peer connection
      };
    } catch (error) {
      console.error("Error setting up peer connection:", error);
      setConnectionError("Failed to initialize video call. Please try again.");
      setCallStatus('failed');
    }
  }, [socket, localStream, receivingCall, callSignal, callAccepted, mediaError, handleReconnection, answerCall, sendIceCandidate, caller?.from]); // Corrected dependency array
  
  // Effect to handle incoming ICE candidates from socket
  useEffect(() => {
    if (!socket || !peerConnection) return;

    const handleIceCandidate = (candidate) => {
      peerConnection.addIceCandidate(new RTCIceCandidate(candidate))
        .catch((error) => {
          console.error("Error adding ICE candidate:", error);
          setConnectionError("Network connectivity issue. Please check your connection.");
        });
    };

    socket.on("iceCandidate", handleIceCandidate);

    return () => {
      socket.off("iceCandidate", handleIceCandidate);
    };
  }, [socket, peerConnection]);

  // Toggle microphone state
  const toggleMic = useCallback(() => {
    if (!localStream) return;
    localStream.getAudioTracks().forEach((track) => {
      track.enabled = !track.enabled; // Enable/disable audio track
    });
    setMicMuted(!micMuted);
  }, [localStream, micMuted]);

  // Toggle camera state
  const toggleCamera = useCallback(() => {
    if (!localStream) return;
    localStream.getVideoTracks().forEach((track) => {
      track.enabled = !track.enabled; // Enable/disable video track
    });
    setCameraOff(!cameraOff);
  }, [localStream, cameraOff]);

  // Handle ending the call
  const handleEndCall = useCallback(() => {
    // Stop all tracks in the local stream
    if (localStream) {
      localStream.getTracks().forEach((track) => track.stop());
    }
    // Close the peer connection
    if (peerConnection) {
      peerConnection.close();
    }
    
    // Clear all timers and intervals
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    if (statsIntervalRef.current) {
      clearInterval(statsIntervalRef.current);
    }
    
    // Reset all call-related states
    setMediaError(null);
    setConnectionError(null);
    setSocketError(null);
    setCallStatus('idle');
    setPermissionDenied(false);
    setRetryAttempts(0);
    setIsReconnecting(false);
    setCallDuration(0);
    setNetworkQuality('unknown');
    setDeviceErrors({ camera: false, microphone: false });
    
    endCall(); // Call the endCall action from useAuthStore
    onCallEnd(); // Callback to parent component (e.g., HomePage)
  }, [localStream, peerConnection, endCall, onCallEnd]);

  // Function to retry media access after an error
  const retryMediaAccess = useCallback(() => {
    setRetryAttempts(0); // Reset retry attempts
    getMediaWithErrorHandling(); // Re-attempt media access
  }, [getMediaWithErrorHandling]);

  // Utility function to format call duration
  const formatDuration = useCallback((seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`; // Format as MM:SS
  }, []);

  // Component to display errors
  const ErrorDisplay = ({ error, onRetry, showRetry = true }) => (
    <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
      <div className="flex items-center gap-2 text-red-700">
        <AlertCircle size={20} />
        <span className="font-medium">Error</span>
      </div>
      <p className="text-red-600 mt-1">{error.message || error}</p>
      {showRetry && error.canRetry !== false && ( // Only show retry if allowed
        <button
          onClick={onRetry}
          className="mt-2 px-3 py-1 bg-red-600 text-white rounded text-sm hover:bg-red-700 flex items-center gap-2"
        >
          <RefreshCw size={14} />
          Retry
        </button>
      )}
    </div>
  );

  // Component to request permissions
  const PermissionRequest = () => (
    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
      <div className="flex items-center gap-2 text-blue-700">
        <Camera size={20} />
        <span className="font-medium">Camera & Microphone Access Required</span>
      </div>
      <p className="text-blue-600 mt-1">
        Please allow access to your camera and microphone to start the video call.
      </p>
      <div className="mt-3 text-sm text-blue-600">
        <p>• Click "Allow" when prompted by your browser</p>
        <p>• Check if your camera/microphone is not being used by another app</p>
        <p>• Make sure your browser supports video calling</p>
        <p>• Try refreshing the page if problems persist</p>
      </div>
      <button
        onClick={retryMediaAccess}
        className="mt-2 px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 flex items-center gap-2"
      >
        <RefreshCw size={14} />
        Request Permissions
      </button>
    </div>
  );

  // Loading indicator component
  const LoadingDisplay = () => (
    <div className="flex items-center justify-center p-8">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      <span className="ml-2 text-gray-600">Setting up video call...</span>
    </div>
  );

  // Network quality indicator component
  const NetworkQualityIndicator = () => (
    <div className={`flex items-center gap-1 px-2 py-1 rounded text-sm ${
      networkQuality === 'good' ? 'bg-green-100 text-green-700' :
      networkQuality === 'fair' ? 'bg-yellow-100 text-yellow-700' :
      networkQuality === 'poor' ? 'bg-red-100 text-red-700' :
      'bg-gray-100 text-gray-700'
    }`}>
      {networkQuality === 'good' ? <Wifi size={14} /> : <WifiOff size={14} />}
      <span className="capitalize">{networkQuality}</span>
    </div>
  );

  // Device status indicators (camera/microphone unavailable)
  const DeviceStatusIndicators = () => (
    <div className="flex gap-2">
      {deviceErrors.camera && (
        <div className="bg-red-100 text-red-700 px-2 py-1 rounded text-sm">
          Camera unavailable
        </div>
      )}
      {deviceErrors.microphone && (
        <div className="bg-red-100 text-red-700 px-2 py-1 rounded text-sm">
          Microphone unavailable
        </div>
      )}
    </div>
  );

  // --- Ringtone effect for incoming call ---
  useEffect(() => {
    if (receivingCall && !callAccepted) {
      if (ringAudio.current) {
        ringAudio.current.loop = true;
        ringAudio.current.play().catch(e => console.error("Ringtone play error:", e));
      }
      return () => {
        if (ringAudio.current) {
          ringAudio.current.pause();
          ringAudio.current.currentTime = 0;
        }
      };
    }
  }, [receivingCall, callAccepted]);

  // --- Stop ringtone when call is accepted ---
  useEffect(() => {
    if (callAccepted && ringAudio.current) {
      ringAudio.current.pause();
      ringAudio.current.currentTime = 0;
    }
  }, [callAccepted]);

  // --- Conditional rendering ---
  let content = null;

  // Display "Calling..." screen when initiating a call
  if (!receivingCall && !callAccepted && !callEnded && caller?.from) {
    content = (
      <div className="fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center z-50">
        <div className="text-white text-lg font-semibold">
          Calling {caller.name || "user"}...
        </div>
      </div>
    );
  }
  // Show incoming call notification
  else if (receivingCall && !callAccepted) {
    content = (
      <div className="fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center z-50">
        <div className="bg-white p-6 rounded-lg text-center max-w-md mx-4">
          <h3 className="text-lg font-semibold mb-4">
            Incoming call from {caller.name}
          </h3>
          
          {permissionDenied && <PermissionRequest />}
          {mediaError && <ErrorDisplay error={mediaError} onRetry={retryMediaAccess} />}
          {socketError && <ErrorDisplay error={socketError} showRetry={false} />}
          {isLoadingMedia && <LoadingDisplay />}
          
          <DeviceStatusIndicators />
          
          <div className="flex gap-4 justify-center mt-4">
            <button
              onClick={() => {
                rejectCall(); // Reject the call via socket
                handleEndCall(); // Clean up local state and streams
              }}
              className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
            >
              <PhoneOff size={16} />
              Decline
            </button>
            <button
              onClick={() => {
                answerCall(peerConnection.localDescription); // Answer the call
                // No need to call handleEndCall here, as the call will now be accepted
                // and the UI will switch to the active call interface
              }}
              disabled={isLoadingMedia || mediaError || permissionDenied} // Disable if media is not ready
              className={`flex items-center gap-2 px-4 py-2 rounded transition-colors ${
                isLoadingMedia || mediaError || permissionDenied ? "bg-gray-400 cursor-not-allowed" : "bg-green-600 hover:bg-green-700"
              } text-white`}
            >
              <Phone size={16} />
              Answer
            </button>
          </div>
        </div>
      </div>
    );
  }
  // Show active video call interface
  else if (callAccepted && !callEnded) {
    content = (
      <div className="fixed inset-0 bg-black bg-opacity-90 flex flex-col items-center justify-center z-50 p-4">
        {/* Error displays */}
        <div className="absolute top-4 left-4 right-4 z-10 space-y-2">
          {mediaError && <ErrorDisplay error={mediaError} onRetry={retryMediaAccess} />}
          {connectionError && <ErrorDisplay error={connectionError} onRetry={handleReconnection} />}
          {socketError && <ErrorDisplay error={socketError} showRetry={false} />}
        </div>

        {/* Status indicators */}
        <div className="absolute top-4 right-4 z-10 flex flex-col gap-2">
          {/* Call status */}
          <div className={`px-3 py-1 rounded-full text-sm font-medium flex items-center gap-2 ${
            callStatus === 'connected' ? 'bg-green-100 text-green-700' :
            callStatus === 'connecting' ? 'bg-yellow-100 text-yellow-700' :
            callStatus === 'failed' ? 'bg-red-100 text-red-700' :
            'bg-gray-100 text-gray-700'
          }`}>
            {isReconnecting && <RefreshCw size={14} className="animate-spin" />}
            {callStatus === 'connected' ? 'Connected' :
             callStatus === 'connecting' ? 'Connecting...' :
             callStatus === 'failed' ? 'Connection Failed' :
             'Idle'}
          </div>

          {/* Call duration */}
          {callDuration > 0 && (
            <div className="bg-black bg-opacity-50 text-white px-3 py-1 rounded-full text-sm">
              {formatDuration(callDuration)}
            </div>
          )}

          {/* Network quality */}
          <NetworkQualityIndicator />
        </div>

        {/* Device status */}
        <div className="absolute bottom-20 left-4 z-10">
          <DeviceStatusIndicators />
        </div>

        {/* Video containers */}
        <div className="flex gap-4 w-full max-w-5xl">
          <div className="relative w-1/3 aspect-video rounded-lg overflow-hidden"> {/* Added aspect-video for consistent ratio */}
            <video
              ref={localVideoRef}
              autoPlay
              muted // Mute local video to prevent echo
              playsInline
              className="w-full h-full object-cover bg-black"
            />
            <div className="absolute bottom-2 left-2 bg-black bg-opacity-50 px-2 py-1 rounded text-white text-sm">
              You {micMuted && "(Muted)"} {cameraOff && "(Camera Off)"}
            </div>
          </div>
          <div className="relative w-2/3 aspect-video rounded-lg overflow-hidden"> {/* Added aspect-video */}
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className="w-full h-full object-cover bg-black"
            />
            <div className="absolute bottom-2 left-2 bg-black bg-opacity-50 px-2 py-1 rounded text-white text-sm">
              {caller.name || "Remote User"}
            </div>
            {!remoteStream && (
              <div className="absolute inset-0 flex items-center justify-center bg-gray-800 rounded-lg">
                <span className="text-white">Waiting for remote video...</span>
              </div>
            )}
          </div>
        </div>

        {/* Enhanced controls */}
        <div className="mt-4 flex gap-4">
          <button
            onClick={toggleMic}
            disabled={deviceErrors.microphone}
            className={`flex items-center gap-2 px-4 py-2 rounded transition-colors ${
              micMuted ? "bg-red-600 hover:bg-red-700" : "bg-green-600 hover:bg-green-700"
            } text-white disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {micMuted ? <MicOff size={16} /> : <Mic size={16} />}
            {micMuted ? "Unmute" : "Mute"}
          </button>
          
          <button
            onClick={toggleCamera}
            disabled={deviceErrors.camera}
            className={`flex items-center gap-2 px-4 py-2 rounded transition-colors ${
              cameraOff ? "bg-red-600 hover:bg-red-700" : "bg-green-600 hover:bg-green-700"
            } text-white disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {cameraOff ? <CameraOff size={16} /> : <Camera size={16} />}
            {cameraOff ? "Turn Camera On" : "Turn Camera Off"}
          </button>
          
          <button
            onClick={handleEndCall}
            className="flex items-center gap-2 px-4 py-2 rounded bg-red-700 text-white hover:bg-red-800 transition-colors"
          >
            <PhoneOff size={16} />
            End Call
          </button>
        </div>
      </div>
    );
  }

  // Render nothing if no call is active or incoming
  return content;
};

export default VideoCall;
