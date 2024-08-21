const app = require('express')();
const cors = require('cors');
const http = require('http').Server(app);
const io = require('socket.io')(http, {
    cors: {
        origin: '*',
    }
});
app.use(cors());

const inMemoryStorage = {
    rooms: {},
};
let connectedPlayers = [];

const EVENTS = {
    CREATE_ROOM: "create room",
    JOIN_ROOM: "join room",
    START_ROOM: "start room",
    RESPONSE_CREATE_ROOM: "response create room",
    RESPONSE_JOIN_ROOM: "response join room",
    SEND_SONG: "send song",
    WANT_NEXT_SONG: "want next song",
    WANT_REVEAL_PLAYER: "want reveal player",
    QUIT_ROOM: "quit room",
    NEW_PLAYER: "new player",
    GET_ROOM_DATA: "get room data",
    RESPONSE_GET_ROOM_DATA: "response get room data",
    ERROR: "error",
    DISCONNECTING: "disconnecting"
};

io.on('connection', (socket) => {

    connectedPlayers.push({
        ...socket.handshake.auth,
        socketId: socket.id
    });
    io.sockets.emit('update-connections', connectedPlayers);

    socket.on("quit room", (data) => {
        const { roomName } = data
        socket.to(roomName).emit("player quit", socket.handshake.auth);
    })

    socket.on('disconnect', () => {
        console.log("player disconnected")
        connectedPlayers = connectedPlayers.filter((player) => player.id !== socket.handshake.auth.id);
        io.sockets.emit('update-connections', connectedPlayers);


    });
    socket.on("disconnecting", (reason) => {
        for (const room of socket.rooms) {
            if (room !== socket.id) {
                socket.leave(room)
                const roomData = inMemoryStorage.rooms[room];
                roomData._players = roomData._players.filter(
                    (player) => player._id !== socket.handshake.auth.id
                );
                socket.to(room).emit("player disconnected", { room: roomData, player: socket.handshake.auth })
                socket.to(room).emit("user has left", socket.handshake.auth);
            }
        }
    });


    socket.on(EVENTS.CREATE_ROOM, async (createdBy) => {
        try {
            const roomName = Math.random().toString(36).substring(7);
            const room = {
                _name: roomName,
                _createdBy: createdBy,
                _players: [createdBy],
                _songs: [],
                _started: false,
            };
            inMemoryStorage.rooms[roomName] = room;

            socket.join(roomName);
            socket.emit(EVENTS.RESPONSE_CREATE_ROOM, room);
            io.to(roomName).emit(EVENTS.NEW_PLAYER, room);

        } catch (error) {
            console.error(error);
            return;
        }
    });

    socket.on(EVENTS.JOIN_ROOM, async (data) => {
        try {

            const { roomName, player } = data;

            const room = inMemoryStorage.rooms[roomName];


            if (!room) {
                socket.emit("unable to join", "La room n'existe pas.");
                return;
            }

            if (room._started) {
                socket.emit("unable to join", "La room a déjà démarré.");
                return;
            }

            room._players.push(player);

            socket.join(roomName);
            socket.emit(EVENTS.RESPONSE_JOIN_ROOM, room);
            setTimeout(() => {
                io.to(roomName).emit("new player", room);
            }, 1000);

        } catch (error) {
            console.error(error);
            return;
        }
    });


    socket.on("invite friend", async (data) => {
        try {
            const { player, roomData } = data;
            let friend = connectedPlayers.find((p) => p.id === player._id);
            if (!friend) {
                console.error("Friend not found");
                return;
            }
            let socketFriend = io.sockets.sockets.get(friend.socketId);

            io.in(roomData._name).allSockets().then((clients) => {

                if (Array.from(clients).includes(socketFriend.id) === false) {
                    io.to(friend.socketId).emit("response invite friend", { player, roomData });
                }
            });


        } catch (error) {
            console.error(error);
        }
    });

    socket.on(EVENTS.GET_ROOM_DATA, async (roomName) => {
        const room = inMemoryStorage.rooms[roomName];
        if (room) {
            socket.emit(EVENTS.RESPONSE_GET_ROOM_DATA, room);
        } else {
            console.log("Room not found");
        }
    });

    socket.on(EVENTS.START_ROOM, async (data) => {
        const { roomData, player } = data;
        const room = inMemoryStorage.rooms[roomData._name];

        if (room && !room._started) {
            room._started = true;
            io.to(room._name).emit("game start", player);
        } else {
            socket.emit("unable to start", "La room a déjà démarré ou n'existe pas.");
        }
    });

    socket.on(EVENTS.SEND_SONG, async (data) => {
        const { songs, roomData } = data;
        const room = inMemoryStorage.rooms[roomData._name];
        if (room) {
            room._songs.push(songs);
            socket.emit("response send song");

            if (room._songs.length === room._players.length) {
                io.to(room._name).emit("all player send song", room);
            }
        }
    });

    socket.on(EVENTS.WANT_NEXT_SONG, async (data) => {
        const { player, roomData } = data;
        const room = inMemoryStorage.rooms[roomData._name];
        if (room) {
            io.to(room._name).emit("next song", player);
        }
    });

    socket.on(EVENTS.WANT_REVEAL_PLAYER, async (data) => {
        const { player, roomData } = data;
        const room = inMemoryStorage.rooms[roomData._name];
        if (room) {
            io.to(room._name).emit("reveal player", player);
        }
    });



    socket.on(EVENTS.QUIT_ROOM, async () => {
        const roomsArray = Array.from(socket.rooms);
        const roomName = roomsArray[1];
        if (roomName !== undefined) {

            const room = inMemoryStorage.rooms[roomName];
            if (room) {
                room._players = room._players.filter(
                    (player) => player._id !== socket.handshake.auth.id
                );
                socket.leave(roomName);

                io.to(roomName).emit('player disconnected', { room: room, player: socket.handshake.auth });

                if (room._players.length === 1) {
                    io.to(roomName).emit("quit");
                    delete inMemoryStorage.rooms[roomName];
                }
            }
        }
    });

});



// Broadcast the current server time as global message, every 1s
setInterval(() => {
    io.sockets.emit('time-msg', { time: new Date().toISOString() });
}, 1000);

// Start the express server
http.listen(3000, function () {
    console.log('listening on *:3000');
});