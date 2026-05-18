const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: { origin: "*" }
});

// Cấu hình để server đọc giao diện từ thư mục "public"
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;

let serverPlayers = {};
let serverCubes = [];

// Sinh khối ngẫu nhiên trên Server
function spawnCube() {
    const vals = [2, 4, 8, 16, 32, 64];
    return {
        id: Math.random().toString(36).substring(2, 9),
        x: Math.random() * 2600 + 100, // Tùy kích thước map của bạn
        y: Math.random() * 2600 + 100,
        value: vals[Math.floor(Math.random() * vals.length)]
    };
}

// Khởi tạo trước 100 khối hạt
for(let i = 0; i < 100; i++) {
    serverCubes.push(spawnCube());
}

io.on('connection', (socket) => {
    console.log(`Người chơi kết nối: ${socket.id}`);

    socket.on('joinGame', (data) => {
        serverPlayers[socket.id] = {
            id: socket.id,
            name: data.name || "Vô danh",
            alive: true,
            angle: 0,
            isMouseDown: false,
            body: [{ x: Math.random()*1000 + 400, y: Math.random()*1000 + 300, value: 2 }]
        };
    });

    socket.on('updateInput', (data) => {
        if (serverPlayers[socket.id] && serverPlayers[socket.id].alive) {
            serverPlayers[socket.id].angle = data.angle;
            serverPlayers[socket.id].isMouseDown = data.isMouseDown;
        }
    });

    socket.on('disconnect', () => {
        console.log(`Người chơi thoát: ${socket.id}`);
        delete serverPlayers[socket.id];
    });
});

// Vòng lặp cập nhật Game (60 khung hình / giây)
setInterval(() => {
    // [Tại đây bạn đưa logic di chuyển của Rắn/Khối và va chạm ăn nhau từ file index cũ lên]
    // Tạm thời xử lý di chuyển cơ bản cho các Player:
    Object.keys(serverPlayers).forEach(id => {
        let p = serverPlayers[id];
        if(!p.alive) return;
        let speed = p.isMouseDown ? 6 : 3; // Dash tăng tốc
        p.body[0].x += Math.cos(p.angle) * speed;
        p.body[0].y += Math.sin(p.angle) * speed;
    });

    // Phát dữ liệu đồng bộ cho toàn bộ máy con
    io.emit('gameTick', {
        players: serverPlayers,
        cubes: serverCubes
    });
}, 1000 / 60);

http.listen(PORT, () => {
    console.log(`Server đang chạy tại cổng: ${PORT}`);
});