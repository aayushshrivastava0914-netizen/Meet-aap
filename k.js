const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

app.get("/{*splat}", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

// roomId -> admin socket id
const rooms = new Map();

// socket -> room
const socketRooms = new Map();

io.on("connection", (socket) => {

    // CREATE ROOM
    socket.on("create-room", ({ roomId, name }) => {

        rooms.set(roomId, {
            admin: socket.id,
            adminName: name || "Admin",
            participants: new Map()
        });

        socket.join(roomId);
        socketRooms.set(socket.id, roomId);

        socket.emit("room-created", {
            roomId,
            admin: true
        });

        console.log(`👑 Room ${roomId} created by ${name}`);
    });


    // REQUEST TO JOIN
    socket.on("request-join", ({ roomId, name }) => {

        const room = rooms.get(roomId);

        if (!room) {
            socket.emit("join-error", "Room does not exist.");
            return;
        }

        socket.data.pendingRoom = roomId;
        socket.data.name = name || "Guest";

        const adminSocket = io.sockets.sockets.get(room.admin);

        if (!adminSocket) {
            socket.emit("join-error", "Admin is offline.");
            return;
        }

        adminSocket.emit("join-request", {
            socketId: socket.id,
            name: name || "Guest"
        });

        socket.emit("waiting-approval");

        console.log(`🕐 Join request: ${name} -> ${roomId}`);
    });


    // ADMIN APPROVES
    socket.on("approve-user", ({ roomId, socketId }) => {

        const room = rooms.get(roomId);

        if (!room || room.admin !== socket.id) {
            return;
        }

        const user = io.sockets.sockets.get(socketId);

        if (!user) return;

        const name = user.data.name || "Guest";

        user.join(roomId);
        socketRooms.set(socketId, roomId);

        room.participants.set(socketId, {
            name
        });

        user.emit("approved", {
            roomId,
            name
        });

        socket.emit("user-approved", {
            socketId,
            name
        });

        // Existing participants get new user's ID
        socket.to(roomId).emit("user-joined", {
            socketId,
            name
        });

        console.log(`✅ ${name} approved in ${roomId}`);
    });


    // ADMIN REJECTS
    socket.on("reject-user", ({ roomId, socketId }) => {

        const room = rooms.get(roomId);

        if (!room || room.admin !== socket.id) {
            return;
        }

        const user = io.sockets.sockets.get(socketId);

        if (user) {
            user.emit("rejected");
        }

        console.log(`❌ User rejected from ${roomId}`);
    });


    // SIGNALING
    socket.on("signal", ({ to, data }) => {

        const target = io.sockets.sockets.get(to);

        if (!target) return;

        target.emit("signal", {
            from: socket.id,
            data
        });
    });


    // CHAT
    socket.on("chat-message", ({ roomId, name, message }) => {

        const room = rooms.get(roomId);

        if (!room) return;

        const isMember =
            room.admin === socket.id ||
            room.participants.has(socket.id);

        if (!isMember) return;

        io.to(roomId).emit("chat-message", {
            name,
            message
        });
    });


    // ADMIN REMOVE USER
    socket.on("remove-user", ({ roomId, socketId }) => {

        const room = rooms.get(roomId);

        if (!room || room.admin !== socket.id) {
            return;
        }

        const user = io.sockets.sockets.get(socketId);

        if (!user) return;

        user.emit("removed");

        user.leave(roomId);

        room.participants.delete(socketId);

        socket.to(roomId).emit("user-left", socketId);

        console.log(`🚪 User removed from ${roomId}`);
    });


    // DISCONNECT
    socket.on("disconnect", () => {

        const roomId = socketRooms.get(socket.id);

        if (!roomId) return;

        const room = rooms.get(roomId);

        if (!room) return;

        // Admin left
        if (room.admin === socket.id) {

            io.to(roomId).emit("room-closed");

            rooms.delete(roomId);

            console.log(`👑 Admin closed room ${roomId}`);
        } else {

            room.participants.delete(socket.id);

            socket.to(roomId).emit("user-left", socket.id);
        }

        socketRooms.delete(socket.id);
    });

});

server.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Ayush Meet running on port ${PORT}`);
});
