import { Server } from "socket.io";
import http from "http";
import express from "express";

const app = express();
const server = http.createServer(app);

// Configure Socket.IO server with CORS
const io = new Server(server, {
  cors: {
    origin: ["http://localhost:5173"], // Allow requests from your client-side application
  },
});

// Used to store online users and their socket IDs
const userSocketMap = {}; // {userId: socketId}

// Helper function to get the socket ID of a receiver
export function getReceiverSocketId(userId) {
  return userSocketMap[userId];
}

// Socket.IO connection event handler
io.on("connection", (socket) => {
  console.log("A user connected", socket.id);

  // Get userId from handshake query
  const userId = socket.handshake.query.userId;
  if (userId) {
    userSocketMap[userId] = socket.id; // Map userId to socketId
  }

  // Emit the list of online users to all connected clients
  io.emit("getOnlineUsers", Object.keys(userSocketMap));

  // WebRTC signaling handlers

  // Handle "callUser" event (initiating a call)
  socket.on("callUser", ({ userToCall, signalData, from, name }) => {
    console.log(`Call from ${from} to ${userToCall}`);
    const socketId = userSocketMap[userToCall]; // Get receiver's socket ID
    if (socketId) {
      // Emit "callUser" event to the receiver
      io.to(socketId).emit("callUser", { 
        signal: signalData, 
        from, 
        name 
      });
    } else {
      // If user is offline, notify the caller
      socket.emit("callFailed", { reason: "User is offline" });
    }
  });

  // Handle "answerCall" event (answering a call)
  socket.on("answerCall", (data) => {
    console.log(`Call answered, sending to ${data.to}`);
    const socketId = userSocketMap[data.to]; // Get caller's socket ID
    if (socketId) {
      // Emit "callAccepted" event to the caller with the answer signal
      io.to(socketId).emit("callAccepted", data.signal);
    }
  });

  // Handle "iceCandidate" event (exchanging ICE candidates)
  socket.on("iceCandidate", (data) => {
    console.log(`ICE candidate from ${socket.id} to ${data.to}`);
    const socketId = userSocketMap[data.to]; // Get recipient's socket ID
    if (socketId) {
      // Emit "iceCandidate" event to the recipient
      io.to(socketId).emit("iceCandidate", data.candidate);
    }
  });

  // Handle "endCall" event (ending a call)
  socket.on("endCall", (data) => {
    console.log(`Call ended, notifying ${data.to}`);
    const socketId = userSocketMap[data.to]; // Get other peer's socket ID
    if (socketId) {
      // Emit "callEnded" event to the other peer
      io.to(socketId).emit("callEnded");
    }
  });

  // Handle "rejectCall" event (rejecting an incoming call)
  socket.on("rejectCall", ({ to }) => {
    console.log(`Call rejected, notifying ${to}`);
    const socketId = userSocketMap[to]; // Get caller's socket ID
    if (socketId) {
      // Emit "callRejected" event to the caller
      io.to(socketId).emit("callRejected");
    }
  });

  // Handle "disconnect" event
  socket.on("disconnect", () => {
    console.log("A user disconnected", socket.id);
    // Remove user from online users map
    delete userSocketMap[userId];
    // Emit updated list of online users
    io.emit("getOnlineUsers", Object.keys(userSocketMap));
  });
});

export { io, app, server };
