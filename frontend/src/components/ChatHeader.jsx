import { X, Video, VideoOff } from "lucide-react";
import { useAuthStore } from "../store/useAuthStore";
import { useChatStore } from "../store/useChatStore";
import { useState } from "react";

const ChatHeader = () => {
  const { selectedUser, setSelectedUser } = useChatStore();
  const { onlineUsers, callUser } = useAuthStore();
  const [isCheckingPermissions, setIsCheckingPermissions] = useState(false);
  const [permissionError, setPermissionError] = useState(null);

  // Check media permissions before making a call
  const checkMediaPermissions = async () => {
    try {
      setIsCheckingPermissions(true);
      setPermissionError(null);

      // Check if getUserMedia is supported by the browser
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("Video calling is not supported in this browser");
      }

      // Try to get media access to check permissions without actually using the stream
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });

      // If successful, stop the tracks immediately
      // The actual stream will be acquired in the VideoCall component
      stream.getTracks().forEach(track => track.stop());
      
      return true;
    } catch (error) {
      console.error("Permission check failed:", error);
      
      let errorMessage = "Unable to access camera and microphone. ";
      
      if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        errorMessage += "Please allow camera and microphone access and try again.";
      } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
        errorMessage += "No camera or microphone found. Please check your devices.";
      } else if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
        errorMessage += "Camera or microphone is already in use by another application.";
      } else {
        errorMessage += error.message;
      }
      
      setPermissionError(errorMessage);
      return false;
    } finally {
      setIsCheckingPermissions(false);
    }
  };

  const handleCallUser = async () => {
    if (!selectedUser) return;

    // Check if the selected user is online
    if (!onlineUsers.includes(selectedUser._id)) {
      setPermissionError("User is currently offline. Cannot start video call.");
      return;
    }

    // Check media permissions first
    const hasPermissions = await checkMediaPermissions();
    if (!hasPermissions) return;

    try {
      // Create a new RTCPeerConnection for the caller
      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
        ],
      });

      // Get user media (this stream will be used to create the offer,
      // but the actual video stream for display will be handled in VideoCall component)
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });

      // Add local tracks to the peer connection
      stream.getTracks().forEach((track) => {
        pc.addTrack(track, stream);
      });

      // Create an offer (SDP)
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // Send the call request with the offer to the selected user
      callUser(selectedUser._id, offer, selectedUser.fullName);

      // Clean up the temporary stream used for offer creation
      stream.getTracks().forEach(track => track.stop());
      
    } catch (error) {
      console.error("Error starting call:", error);
      setPermissionError("Failed to start video call. Please try again.");
    }
  };

  return (
    <div className="p-2.5 border-b border-base-300">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {/* Avatar */}
          <div className="size-10 rounded-full relative">
            <img 
              src={selectedUser.profilePic || "/avatar.png"} 
              alt={selectedUser.fullName}
              className="w-full h-full rounded-full object-cover"
            />
          </div>

          {/* User info */}
          <div>
            <h3 className="font-medium">{selectedUser.fullName}</h3>
            <p className="text-sm text-base-content/70">
              {onlineUsers.includes(selectedUser._id) ? "Online" : "Offline"}
            </p>
          </div>

          {/* Video call button */}
          <button
            onClick={handleCallUser}
            disabled={isCheckingPermissions || !onlineUsers.includes(selectedUser._id)}
            className={`ml-4 p-2 rounded-full transition-colors ${
              onlineUsers.includes(selectedUser._id)
                ? "hover:bg-green-100 text-green-600"
                : "text-gray-400 cursor-not-allowed"
            }`}
            title={
              onlineUsers.includes(selectedUser._id)
                ? "Start Video Call"
                : "User is offline"
            }
          >
            {isCheckingPermissions ? (
              <div className="animate-spin rounded-full h-5 w-5 border-2 border-green-600 border-t-transparent"></div>
            ) : onlineUsers.includes(selectedUser._id) ? (
              <Video size={20} />
            ) : (
              <VideoOff size={20} />
            )}
          </button>
        </div>

        {/* Close button */}
        <button 
          onClick={() => setSelectedUser(null)}
          className="p-1 hover:bg-base-300 rounded"
        >
          <X />
        </button>
      </div>

      {/* Error message display */}
      {permissionError && (
        <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
          <div className="flex items-center justify-between">
            <span>{permissionError}</span>
            <button
              onClick={() => setPermissionError(null)}
              className="text-red-500 hover:text-red-700"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ChatHeader;
