const ROOM_PASSWORD = "7644";

// ================= DATA STORES =================
const users = {}; // socket.id -> { username, roomId }
const roomCounts = {}; // roomId -> participants count
const feedbacks = []; // feedbacks (memory)

// ================= SETUP =================
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

// ================= SOCKET =================
io.on("connection", (socket) => {
  console.log("Connected:", socket.id);

  // ================= JOIN ROOM =================
  socket.on("join-room", ({ roomId, password, username }) => {
    if (!roomId || !username) return;

    // 🔐 password check
    if (password !== ROOM_PASSWORD) {
      socket.emit("join-error", "Wrong password");
      return;
    }

    // ❌ already joined protection
    if (socket.roomId) return;

    // Store user info
    users[socket.id] = { username, roomId };
    socket.roomId = roomId;

    // Get existing users in this room BEFORE joining
    const existingUsers = [];
    const roomSockets = io.sockets.adapter.rooms.get(roomId);

    if (roomSockets) {
      roomSockets.forEach((socketId) => {
        if (socketId !== socket.id && users[socketId]) {
          existingUsers.push({
            id: socketId,
            name: users[socketId].username,
          });
        }
      });
    }

    // Now join the room
    socket.join(roomId);

    // Update count
    roomCounts[roomId] = (roomCounts[roomId] || 0) + 1;

    console.log(
      `${username} joined room ${roomId}. Existing users:`,
      existingUsers.length
    );

    // ✅ Send join success with list of existing users
    socket.emit("join-success", {
      users: existingUsers,
      count: roomCounts[roomId],
    });

    // Update everyone's participant count
    io.to(roomId).emit("participants", roomCounts[roomId]);

    // 📢 system join message to others
    socket.to(roomId).emit("chat-message", {
      sender: "System",
      message: `${username} joined the room`,
    });

    // 🔔 notify OTHER users that NEW peer joined
    socket.to(roomId).emit("new-peer", {
      id: socket.id,
      name: username,
    });
  });

  // ================= CHAT =================
  socket.on("chat-message", ({ roomId, sender, message }) => {
    if (!roomId || !message) return;
    socket.to(roomId).emit("chat-message", { sender, message });
  });

  // ================= SIGNALING =================
  socket.on("signal", ({ to, data }) => {
    if (!to || !data) {
      console.log("Invalid signal data");
      return;
    }

    const signalType = data.type || "candidate";
    console.log(`Relaying ${signalType} from ${socket.id} to ${to}`);

    io.to(to).emit("signal", {
      from: socket.id,
      data,
    });
  });

  // ================= FEEDBACK =================
  socket.on("send-feedback", ({ roomId, user, feedback }) => {
    if (!feedback || !user) return;

    const entry = {
      roomId,
      user,
      feedback,
      time: new Date().toISOString(),
    };

    feedbacks.push(entry);
    console.log("📩 Feedback:", entry);

    if (roomId) {
      socket.to(roomId).emit("chat-message", {
        sender: "System",
        message: `${user} submitted feedback`,
      });
    }
  });

  // ================= DISCONNECT =================
  socket.on("disconnect", () => {
    const userInfo = users[socket.id];

    if (!userInfo) return;

    const { username, roomId } = userInfo;

    if (roomId) {
      roomCounts[roomId] = Math.max((roomCounts[roomId] || 1) - 1, 0);

      console.log(`${username} left room ${roomId}`);

      io.to(roomId).emit("participants", roomCounts[roomId]);

      socket.to(roomId).emit("chat-message", {
        sender: "System",
        message: `${username} left the room`,
      });

      socket.to(roomId).emit("peer-disconnected", socket.id);
    }

    delete users[socket.id];
  });
});

// ================= START SERVER =================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
