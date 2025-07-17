import { create } from "zustand";
import { axiosInstance } from "../lib/axios.js";
import toast from "react-hot-toast";
import { io } from "socket.io-client";

const BASE_URL = import.meta.env.MODE === "development" ? "http://localhost:5001" : "/";

export const useAuthStore = create((set, get) => ({
  authUser: null,
  isSigningUp: false,
  isLoggingIn: false,
  isUpdatingProfile: false,
  isCheckingAuth: true,
  onlineUsers: [],
  socket: null,

  callAccepted: false,
  callEnded: false,
  caller: {},
  receivingCall: false,
  stream: null, // This stream is not directly used in VideoCall, it's managed locally there.
  callSignal: null,

  checkAuth: async () => {
    try {
      const res = await axiosInstance.get("/auth/check");
      set({ authUser: res.data });
      get().connectSocket();
    } catch (error) {
      console.log("Error in checkAuth:", error);
      set({ authUser: null });
    } finally {
      set({ isCheckingAuth: false });
    }
  },

  signup: async (data) => {
    set({ isSigningUp: true });
    try {
      const res = await axiosInstance.post("/auth/signup", data);
      set({ authUser: res.data });
      toast.success("Account created successfully");
      get().connectSocket();
    } catch (error) {
      toast.error(error.response.data.message);
    } finally {
      set({ isSigningUp: false });
    }
  },

  login: async (data) => {
    set({ isLoggingIn: true });
    try {
      const res = await axiosInstance.post("/auth/login", data);
      toast.success("Logged in successfully");
      set({ authUser: res.data });
      get().connectSocket();
    } catch (error) {
      toast.error(error.response.data.message);
    } finally {
      set({ isLoggingIn: false });
    }
  },

  logout: async () => {
    try {
      await axiosInstance.post("/auth/logout");
      set({ authUser: null });
      toast.success("Logged out successfully");
      get().disconnectSocket();
    } catch (error) {
      toast.error(error.response.data.message);
    }
  },

  updateProfile: async (data) => {
    set({ isUpdatingProfile: true });
    try {
      const res = await axiosInstance.put("/auth/update-profile", data);
      set({ authUser: res.data });
      toast.success("Profile updated successfully");
    } catch (error) {
      console.log("error in update profile:", error);
      toast.error(error.response.data.message);
    } finally {
      set({ isUpdatingProfile: false });
    }
  },

  connectSocket: () => {
    const { authUser } = get();
    if (!authUser || get().socket?.connected) return;

    // Initialize socket connection with user ID
    const socket = io(BASE_URL, {
      query: {
        userId: authUser._id,
      },
    });
    socket.connect();

    set({ socket: socket });

    // Listen for online users updates
    socket.on("getOnlineUsers", (userIds) => {
      set({ onlineUsers: userIds });
    });

    // WebRTC signaling event listeners
    socket.on("callUser", ({ from, name, signal }) => {
      // Set state for incoming call
      set({
        receivingCall: true,
        caller: { from, name },
        callSignal: signal,
        callAccepted: false,
        callEnded: false,
      });
    });

    socket.on("callAccepted", (signal) => {
      // Set state when call is accepted by the remote peer
      set({ callAccepted: true, callSignal: signal });
    });

    socket.on("callEnded", () => {
      // Reset call state when call ends
      set({ 
        callEnded: true, 
        callAccepted: false, 
        receivingCall: false, 
        caller: {}, 
        callSignal: null 
      });
    });

    socket.on("callRejected", () => {
      // Handle call rejection by the remote peer
      toast.error("Call rejected by user");
      set({ 
        callEnded: true, // Treat as ended for cleanup
        callAccepted: false, 
        receivingCall: false, 
        caller: {}, 
        callSignal: null 
      });
    });

    // ICE candidate handling will be done in the component (VideoCall.jsx)
    socket.on("iceCandidate", (candidate) => {
      // This event is primarily handled within the RTCPeerConnection in VideoCall component
      // No direct state update needed here, but the event needs to be listened for.
    });
  },

  disconnectSocket: () => {
    if (get().socket?.connected) get().socket.disconnect();
  },

  // Action to initiate a call
  callUser: (userToCall, signalData, name) => {
    const socket = get().socket;
    const { authUser } = get();
    if (socket && authUser) {
      socket.emit("callUser", {
        userToCall,
        signalData,
        from: authUser._id,
        name: authUser.fullName,
      });

      // Set caller information and signal data for the initiating user
      set({
        caller: { from: userToCall, name },
        receivingCall: false, // Not receiving, but initiating
        callSignal: signalData,
      });

      // Add timeout logic for unanswered calls
      setTimeout(() => {
        if (!get().callAccepted && !get().callEnded) { // Check if call is still active
          toast.error("Call not answered");
          get().endCall(); // End the call if not answered within timeout
        }
      }, 15000); // 15 seconds timeout
    }
  },

  // Action to answer an incoming call
  answerCall: (signal) => {
    const socket = get().socket;
    const { caller } = get();
    if (socket && caller.from) {
      socket.emit("answerCall", { signal, to: caller.from });
      set({ callAccepted: true }); // Mark call as accepted
    }
  },

  // Action to send ICE candidates
  sendIceCandidate: (candidate, to) => {
    const socket = get().socket;
    if (socket && to) {
      socket.emit("iceCandidate", { candidate, to });
    }
  },

  // Action to end a call
  endCall: () => {
    const socket = get().socket;
    const { caller } = get();
    
    // Emit "endCall" event to the other peer if a caller is set
    if (socket && caller.from) {
      socket.emit("endCall", { to: caller.from });
    }
    
    // Reset all call-related states
    set({ 
      callEnded: true, 
      callAccepted: false, 
      receivingCall: false, 
      caller: {}, 
      callSignal: null 
    });
  },

  // Action to reject an incoming call
  rejectCall: () => {
    const socket = get().socket;
    const { caller } = get();
    if (socket && caller.from) {
      socket.emit("rejectCall", { to: caller.from }); // Emit reject event
      set({ 
        receivingCall: false, 
        caller: {}, 
        callSignal: null 
      });
    }
  },

  // Reset all call-related states (useful for cleanup)
  resetCallState: () => {
    set({
      callAccepted: false,
      callEnded: false,
      caller: {},
      receivingCall: false,
      callSignal: null,
    });
  },
}));
