// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

io.on('connection', socket => {
  console.log('Socket connected:', socket.id);

  socket.on('join-room', roomId => {
    socket.join(roomId);
    console.log(`${socket.id} joined room ${roomId}`);

    // Notify others in the room
    socket.to(roomId).emit('new-peer', socket.id);

    // Signaling
    socket.on('signal', ({ to, data }) => {
      io.to(to).emit('signal', { from: socket.id, data });
    });

    // Chat messages
    socket.on('chat-message', message => {
      socket.to(roomId).emit('chat-message', message);
    });

    // Disconnect
    socket.on('disconnect', () => {
      socket.to(roomId).emit('peer-disconnected', socket.id);
      console.log('Socket disconnected:', socket.id);
    });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
