const ROOM_PASSWORD = "7644";
const users = {};

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

io.on("connection", (socket) => {
  console.log("Connected:", socket.id);

  socket.on("join-room", ({ roomId, password, username }) => {
    // 🔐 Password check
    if (password !== ROOM_PASSWORD) {
      socket.emit("join-error", "Wrong password");
      return;
    }

    // store user
    users[socket.id] = username;

    socket.join(roomId);
    socket.emit("join-success");

    // notify others
    socket.to(roomId).emit("new-peer", {
      id: socket.id,
      name: username,
    });

    // signaling
    socket.on("signal", ({ to, data }) => {
      io.to(to).emit("signal", {
        from: socket.id,
        data,
      });
    });

    // 💬 chat
    socket.on("chat-message", ({ roomId, sender, message }) => {
      socket.to(roomId).emit("chat-message", {
        sender,
        message,
      });
    });

    // ❌ disconnect
    socket.on("disconnect", () => {
      delete users[socket.id];
      socket.to(roomId).emit("peer-disconnected", socket.id);
      console.log("Disconnected:", socket.id);
    });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () =>
  console.log(`Server running on http://localhost:${PORT}`)
);
