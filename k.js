const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

const rooms = new Map();

function getRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      host: null,
      users: new Map(),
      pending: new Map()
    });
  }

  return rooms.get(roomId);
}

function roomState(room) {
  return {
    users: [...room.users.values()].map(u => ({
      id: u.id,
      name: u.name,
      host: u.id === room.host
    }))
  };
}

io.on("connection", socket => {

  socket.on("create-room", ({ roomId, name }) => {
    if (!roomId || !name) return;

    const room = getRoom(roomId);

    if (room.host && room.host !== socket.id) {
      socket.emit("error-message", "This meeting already exists.");
      return;
    }

    room.host = socket.id;

    room.users.set(socket.id, {
      id: socket.id,
      name
    });

    socket.join(roomId);

    socket.data.roomId = roomId;
    socket.data.name = name;
    socket.data.isHost = true;

    socket.emit("room-created", {
      roomId,
      name
    });

    io.to(roomId).emit("room-users", roomState(room));
  });

  socket.on("request-join", ({ roomId, name }) => {
    if (!roomId || !name) return;

    const room = rooms.get(roomId);

    if (!room || !room.host) {
      socket.emit("join-rejected", "Meeting not found.");
      return;
    }

    room.pending.set(socket.id, {
      id: socket.id,
      name
    });

    socket.data.roomId = roomId;
    socket.data.name = name;

    io.to(room.host).emit("join-request", {
      id: socket.id,
      name
    });

    socket.emit("waiting-approval");
  });

  socket.on("approve-user", ({ userId }) => {
    const roomId = socket.data.roomId;
    const room = rooms.get(roomId);

    if (!room || socket.id !== room.host) return;

    const user = room.pending.get(userId);

    if (!user) return;

    room.pending.delete(userId);

    room.users.set(userId, user);

    const target = io.sockets.sockets.get(userId);

    if (target) {
      target.join(roomId);
      target.data.roomId = roomId;
      target.data.name = user.name;
      target.data.isHost = false;

      target.emit("approved", {
        roomId,
        name: user.name
      });
    }

    io.to(roomId).emit("room-users", roomState(room));

    // Tell existing users about the new user.
    socket.to(roomId).emit("user-joined", {
      id: userId,
      name: user.name
    });

    // Tell the new user about existing users.
    if (target) {
      for (const existing of room.users.values()) {
        if (existing.id === userId) continue;

        target.emit("existing-user", {
          id: existing.id,
          name: existing.name
        });
      }
    }
  });

  socket.on("reject-user", ({ userId }) => {
    const roomId = socket.data.roomId;
    const room = rooms.get(roomId);

    if (!room || socket.id !== room.host) return;

    room.pending.delete(userId);

    const target = io.sockets.sockets.get(userId);

    if (target) {
      target.emit("join-rejected", "Host rejected your request.");
    }
  });

  // WebRTC signaling
  socket.on("offer", ({ to, offer }) => {
    if (!to || !offer) return;

    io.to(to).emit("offer", {
      from: socket.id,
      offer
    });
  });

  socket.on("answer", ({ to, answer }) => {
    if (!to || !answer) return;

    io.to(to).emit("answer", {
      from: socket.id,
      answer
    });
  });

  socket.on("ice-candidate", ({ to, candidate }) => {
    if (!to || !candidate) return;

    io.to(to).emit("ice-candidate", {
      from: socket.id,
      candidate
    });
  });

  socket.on("leave-room", () => {
    removeUser(socket);
  });

  socket.on("disconnect", () => {
    removeUser(socket);
  });

  function removeUser(sock) {
    const roomId = sock.data.roomId;

    if (!roomId) return;

    const room = rooms.get(roomId);

    if (!room) return;

    room.pending.delete(sock.id);

    const wasHost = room.host === sock.id;

    room.users.delete(sock.id);

    if (wasHost) {
      io.to(roomId).emit("meeting-ended");

      for (const user of room.users.values()) {
        const s = io.sockets.sockets.get(user.id);
        if (s) {
          s.leave(roomId);
          s.data.roomId = null;
        }
      }

      rooms.delete(roomId);
     
