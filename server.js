const httpServer = require("http").createServer();
const crypto = require('node:crypto')
const randomId = () => crypto.randomBytes(8).toString("hex");
const PORT = 3000; // You can choose any port you like
httpServer.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
const inMemoryStorage = {
    sessions: {},
    rooms: {},
};

const io = require("socket.io")(httpServer);

const EVENTS = {
    CREATE_ROOM: "create room",
    JOIN_ROOM: "join room",
    RESPONSE_CREATE_ROOM: "response create room",
    RESPONSE_JOIN_ROOM: "response join room",
    NEW_PLAYER: "new player",
    GET_ROOM_DATA: "get room data",
    RESPONSE_GET_ROOM_DATA: "response get room data",
    ERROR: "error",
};

io.use(async (socket, next) => {
    const sessionID = socket.handshake.auth.sessionID;
    if (sessionID) {
        const session = inMemoryStorage.sessions[sessionID];
        if (session) {
            socket.sessionID = sessionID;
            socket.userID = session.userID;
            socket.username = session.username;
            return next();
        }
    }

    const username = socket.handshake.auth.username;
    const id = socket.handshake.auth.id;
    if (!username) {
        return next(new Error("invalid username"));
    }

    socket.sessionID = randomId();
    socket.userID = id;
    socket.username = username;
    inMemoryStorage.sessions[socket.sessionID] = {
        userID: socket.userID,
        username: socket.username,
        connected: true,
    };

    next();
});

io.on("connection", async (socket) => {
    socket.emit("session", {
        sessionID: socket.sessionID,
        userID: socket.userID,
        username: socket.username,
    });

    socket.on(EVENTS.CREATE_ROOM, async (createdBy) => {
        console.log(createdBy);
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
    });

    socket.on('join room', async (data) => {
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
        io.to(roomName).emit("new player", room);
    });
    socket.on(EVENTS.GET_ROOM_DATA, async (roomName) => {
        const room = inMemoryStorage.rooms[roomName];
        if (room) {
            socket.emit(EVENTS.RESPONSE_GET_ROOM_DATA, room);
        } else {
            console.log("Room not found");
        }
    });

    socket.on("start room", async (data) => {
        const { roomData, player } = data;
        console.log(data)
        const room = inMemoryStorage.rooms[roomData._name];

        if (room && !room._started) {
            room._started = true;
            io.to(room._name).emit("game start", player);
        } else {
            socket.emit("unable to start", "La room a déjà démarré ou n'existe pas.");
        }
    });

    socket.on("send song", async (data) => {
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

    socket.on("want next song", async (data) => {
        const { player, roomData } = data;
        const room = inMemoryStorage.rooms[roomData._name];
        if (room) {
            io.to(room._name).emit("next song", player);
        }
    });

    socket.on("want reveal player", async (data) => {
        const { player, roomData } = data;
        const room = inMemoryStorage.rooms[roomData._name];
        if (room) {
            io.to(room._name).emit("reveal player", player);
        }
    });

    socket.on("quit room", async (roomData) => {
        socket.leave(roomData._name);
        socket.emit("response quit room");
    });

    socket.on("disconnecting", async () => {
        const roomsArray = Array.from(socket.rooms);
        const roomName = roomsArray[1];

        if (roomName !== undefined) {
            socket.leave(roomName);

            const room = inMemoryStorage.rooms[roomName];

            if (room) {
                room._players = room._players.filter(
                    (player) => player.userID !== socket.userID
                );

                io.to(roomName).emit('player disconnected', { room: room, player: socket.username });

                if (room._players.length === 1) {
                    io.to(roomName).emit("quit");
                    delete inMemoryStorage.rooms[roomName];
                }
            }
        }
    });

    socket.on("disconnect", async () => {
        const matchingSockets = await io.in(socket.userID).allSockets();
        const isDisconnected = matchingSockets.size === 0;
        if (isDisconnected) {
            socket.broadcast.emit("user disconnected", socket.userID);
            inMemoryStorage.sessions[socket.sessionID].connected = false;
        }
    });
});


