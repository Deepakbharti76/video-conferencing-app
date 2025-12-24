const ROOM_PASSWORD = "7644";

// ================= DATA STORES =================
const users = {}; // socket.id -> { username, roomId }
const roomCounts = {}; // roomId -> participants count
const feedbacks = []; // feedbacks (memory)
const roomHistory = {}; // room analytics

// ================= SETUP =================
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(express.static("public"));
app.use(express.json());

// ================= ANALYTICS ENDPOINT =================
app.get("/api/analytics/:roomId", (req, res) => {
  const { roomId } = req.params;
  const analytics = roomHistory[roomId] || {
    totalParticipants: 0,
    peakParticipants: 0,
    duration: 0,
    messages: 0
  };
  res.json(analytics);
});

// ================= SOCKET =================
io.on("connection", (socket) => {
  console.log("Connected:", socket.id);

  // ================= JOIN ROOM =================
  socket.on("join-room", ({ roomId, password, username }) => {
    if (!roomId || !username) return;

    if (password !== ROOM_PASSWORD) {
      socket.emit("join-error", "Wrong password");
      return;
    }

    if (socket.roomId) return;

    // Store user info
    users[socket.id] = { username, roomId, joinedAt: Date.now() };
    socket.roomId = roomId;

    // Get existing users
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

    socket.join(roomId);

    // Update count
    roomCounts[roomId] = (roomCounts[roomId] || 0) + 1;

    // Track analytics
    if (!roomHistory[roomId]) {
      roomHistory[roomId] = {
        totalParticipants: 0,
        peakParticipants: 0,
        duration: 0,
        messages: 0,
        startTime: Date.now()
      };
    }
    
    roomHistory[roomId].totalParticipants++;
    if (roomCounts[roomId] > roomHistory[roomId].peakParticipants) {
      roomHistory[roomId].peakParticipants = roomCounts[roomId];
    }

    console.log(`${username} joined room ${roomId}. Count: ${roomCounts[roomId]}`);

    socket.emit("join-success", {
      users: existingUsers,
      count: roomCounts[roomId],
    });

    io.to(roomId).emit("participants", roomCounts[roomId]);

    socket.to(roomId).emit("chat-message", {
      sender: "System",
      message: `${username} joined the room`,
    });

    socket.to(roomId).emit("new-peer", {
      id: socket.id,
      name: username,
    });
  });

  // ================= CHAT =================
  socket.on("chat-message", ({ roomId, sender, message }) => {
    if (!roomId || !message) return;
    
    // Track message count
    if (roomHistory[roomId]) {
      roomHistory[roomId].messages++;
    }
    
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

  // ================= REACTIONS =================
  socket.on("send-reaction", ({ roomId, userId, emoji }) => {
    if (!roomId || !emoji) return;
    
    socket.to(roomId).emit("reaction", { userId, emoji });
  });

  // ================= RAISE HAND =================
  socket.on("raise-hand", ({ roomId, userId, raised }) => {
    if (!roomId) return;
    
    io.to(roomId).emit("hand-raised", { userId, raised });
    
    if (raised) {
      const username = users[socket.id]?.username || "Someone";
      socket.to(roomId).emit("chat-message", {
        sender: "System",
        message: `${username} raised their hand ✋`,
      });
    }
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

    const { username, roomId, joinedAt } = userInfo;

    if (roomId) {
      roomCounts[roomId] = Math.max((roomCounts[roomId] || 1) - 1, 0);

      // Update session duration
      if (roomHistory[roomId]) {
        const sessionDuration = Date.now() - joinedAt;
        roomHistory[roomId].duration += sessionDuration;
      }

      console.log(`${username} left room ${roomId}. Count: ${roomCounts[roomId]}`);

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
  console.log(`
╔══════════════════════════════════════════╗
║  VidChat Pro Ultra - Server Running      ║
║  http://localhost:${PORT}                   ║
║                                          ║
║  Features:                               ║
║  ✓ HD Video Quality                      ║
║  ✓ Screen Recording                      ║
║  ✓ Background Blur                       ║
║  ✓ Reactions & Emojis                    ║
║  ✓ Raise Hand                            ║
║  ✓ Gallery/Speaker View                  ║
║  ✓ Advanced Analytics                    ║
║                                          ║
║  Default Password: 7644                  ║
╚══════════════════════════════════════════╝
  `);
});