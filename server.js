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
    const clients = Array.from(io.sockets.adapter.rooms.get(roomId) || []);
    // notify others in room about new peer
    socket.to(roomId).emit('new-peer', socket.id);
    console.log(`${socket.id} joined ${roomId}. Clients in room:`, clients.length);

    socket.on('signal', ({ to, data }) => {
      io.to(to).emit('signal', { from: socket.id, data });
    });

    socket.on('disconnect', () => {
      socket.to(roomId).emit('peer-disconnected', socket.id);
      console.log('Socket disconnected:', socket.id);
    });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
