const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

io.on("connection", socket => {

    socket.on("join-room", roomId => {

        const room = io.sockets.adapter.rooms.get(roomId);
        const existingUsers = room ? [...room] : [];

        socket.join(roomId);

        socket.emit("existing-users", existingUsers);

        socket.to(roomId).emit("user-joined", socket.id);

        socket.on("signal", ({ to, data }) => {
            io.to(to).emit("signal", {
                from: socket.id,
                data
            });
        });

        socket.on("chat-message", ({ roomId, name, message }) => {
            io.to(roomId).emit("chat-message", {
                name,
                message
            });
        });

        socket.on("disconnect", () => {
            socket.to(roomId).emit("user-left", socket.id);
        });
    });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Ayush Meet running on port ${PORT}`);
});
