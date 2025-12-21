const ROOM_PASSWORD = "7644";

const users = {}; // socket.id -> username
const roomCounts = {}; // roomId -> count
const feedbacks = []; // store feedbacks (memory)

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

io.on("connection", (socket) => {
  console.log("Connected:", socket.id);

  // ---------------- JOIN ROOM ----------------
  socket.on("join-room", ({ roomId, password, username }) => {
    if (password !== ROOM_PASSWORD) {
      socket.emit("join-error", "Wrong password");
      return;
    }

    // prevent duplicate join
    if (socket.roomId) return;

    users[socket.id] = username;
    socket.roomId = roomId;

    socket.join(roomId);
    socket.emit("join-success");

    // participants count
    roomCounts[roomId] = (roomCounts[roomId] || 0) + 1;
    io.to(roomId).emit("participants", roomCounts[roomId]);

    // system join message
    socket.to(roomId).emit("chat-message", {
      sender: "System",
      message: `${username} joined the room`,
    });

    // new peer notify
    socket.to(roomId).emit("new-peer", {
      id: socket.id,
      name: username,
    });
  });

  // ---------------- CHAT ----------------
  socket.on("chat-message", ({ roomId, sender, message }) => {
    socket.to(roomId).emit("chat-message", { sender, message });
  });

  // ---------------- SIGNALING ----------------
  socket.on("signal", ({ to, data }) => {
    io.to(to).emit("signal", { from: socket.id, data });
  });

  // ---------------- FEEDBACK ----------------
  socket.on("send-feedback", ({ roomId, user, feedback }) => {
    const entry = {
      roomId,
      user,
      feedback,
      time: new Date().toISOString(),
    };

    feedbacks.push(entry);
    console.log("📩 Feedback:", entry);

    // optional system message
    socket.to(roomId).emit("chat-message", {
      sender: "System",
      message: `${user} submitted feedback`,
    });
  });

  // ---------------- DISCONNECT ----------------
  socket.on("disconnect", () => {
    const roomId = socket.roomId;
    const username = users[socket.id];

    if (roomId) {
      roomCounts[roomId] = Math.max((roomCounts[roomId] || 1) - 1, 0);
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

server.listen(process.env.PORT || 3000, () => console.log("Server running"));
