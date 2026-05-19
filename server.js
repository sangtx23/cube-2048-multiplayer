const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: { origin: "*" }
});

app.use(express.static('public'));

const PORT = process.env.PORT || 3000;

const MAP_WIDTH = 3600;
const MAP_HEIGHT = 3600;
const BASE_HEAD_SIZE = 42;

let serverPlayers = {}; 
let serverCubes = [];   
let serverItems = [];   
let playerDeathCounts = {};

const BOT_NAMES_POOL = [
    "Gấu Đô Đốc", "Sói Đơn Độc", "Rắn Đại Hiệp", "CubeVương", "Chiến Thần", "Pro2048", "Ẩn Sĩ", "NinjaCube",
    "Độc Cô Cầu Bại", "Lão Đại 2048", "Hắc Báo", "Sát Thủ Khối", "Tử Thần", "Vua Tốc Độ", "Thợ Săn Cube", "Bá Chủ Arena"
];

function spawnCube() {
    const vals = [2, 4, 8, 16];
    return {
        id: Math.random().toString(36).substring(2, 9),
        x: Math.random() * (MAP_WIDTH - 100) + 50,
        y: Math.random() * (MAP_HEIGHT - 100) + 50,
        value: vals[Math.floor(Math.random() * vals.length)]
    };
}

for (let i = 0; i < 250; i++) {
    serverCubes.push(spawnCube());
}

function spawnItem() {
    const types = ["magnet", "shield", "ghost"];
    return {
        id: Math.random().toString(36).substring(2, 9),
        x: Math.random() * (MAP_WIDTH - 100) + 50,
        y: Math.random() * (MAP_HEIGHT - 100) + 50,
        type: types[Math.floor(Math.random() * types.length)]
    };
}
for (let i = 0; i < 15; i++) {
    serverItems.push(spawnItem());
}

function createBot() {
    let botId = "bot_" + Math.random().toString(36).substring(2, 9);
    let name = BOT_NAMES_POOL[Math.floor(Math.random() * BOT_NAMES_POOL.length)];
    let rx = Math.random() * (MAP_WIDTH - 200) + 100;
    let ry = Math.random() * (MAP_HEIGHT - 200) + 100;
    
    let initialValues = [2, 2, 4];
    let body = [];
    let curX = rx;
    for(let i = 0; i < initialValues.length; i++) {
        body.push({ x: curX, y: ry, value: initialValues[i] });
        curX -= 25;
    }

    serverPlayers[botId] = {
        id: botId,
        name: name + " (Bot)",
        isBot: true,
        angle: Math.random() * Math.PI * 2,
        isMouseDown: false,
        lastDashTime: 0,
        body: body,
        score: 8,
        killCount: 0,
        killStreak: 0,
        targetAngleTimer: 0,
        color: "hsl(" + Math.floor(Math.random() * 360) + ", 85%, 60%)",
        activeItem: null,
        itemTimer: 0
    };
}

for (let i = 0; i < 12; i++) {
    createBot();
}

function getHeadRadius(score) {
    return BASE_HEAD_SIZE + Math.sqrt(score) * 1.5;
}

function smartMergeOnServer(player, startIndex = 0, itemType = "none") {
    let changed = true;
    while (changed) {
        changed = false;
        for (let i = startIndex; i < player.body.length - 1; i++) {
            if (player.body[i].value === player.body[i + 1].value) {
                player.body[i].value *= 2;
                player.body.splice(i + 1, 1);
                changed = true;
                break;
            }
        }
    }
    let total = 0;
    player.body.forEach(node => total += node.value);
    player.score = total;
}

function handlePlayerDeath(id) {
    let p = serverPlayers[id];
    if (!p) return;
    
    if(!playerDeathCounts[p.name]) playerDeathCounts[p.name] = 0;
    playerDeathCounts[p.name]++;

    p.body.forEach(node => {
        if (Math.random() < 0.65) {
            serverCubes.push({
                id: Math.random().toString(36).substring(2, 9),
                x: node.x + (Math.random() - 0.5) * 45,
                y: node.y + (Math.random() - 0.5) * 45,
                value: node.value
            });
        }
    });

    let isBot = p.isBot;
    delete serverPlayers[id];

    if (isBot) {
        setTimeout(() => { if (Object.keys(serverPlayers).filter(k=>serverPlayers[k].isBot).length < 12) createBot(); }, 3000);
    }
}

io.on('connection', (socket) => {
    socket.on('joinGame', (data) => {
        let rx = Math.random() * (MAP_WIDTH - 200) + 100;
        let ry = Math.random() * (MAP_HEIGHT - 200) + 100;
        let initialValues = [2, 2, 4];
        let body = [];
        let curX = rx;
        for(let i = 0; i < initialValues.length; i++) {
            body.push({ x: curX, y: ry, value: initialValues[i] });
            curX -= 25;
        }

        serverPlayers[socket.id] = {
            id: socket.id,
            name: data.name || "Vô danh",
            isBot: false,
            angle: 0,
            isMouseDown: false,
            lastDashTime: 0,
            body: body,
            score: 8,
            killCount: 0,
            killStreak: 0,
            color: "hsl(" + Math.floor(Math.random() * 360) + ", 90%, 55%)",
            activeItem: null,
            itemTimer: 0
        };
    });

    socket.on('move', (angle) => {
        let p = serverPlayers[socket.id];
        if (p) p.angle = angle;
    });

    socket.on('setMouseDown', (state) => {
        let p = serverPlayers[socket.id];
        if (p) p.isMouseDown = state;
    });

    socket.on('disconnect', () => {
        if (serverPlayers[socket.id]) {
            handlePlayerDeath(socket.id);
        }
    });
});

setInterval(() => {
    let currentTime = Date.now();

    for (let id in serverPlayers) {
        let p = serverPlayers[id];
        
        if (p.isBot) {
            p.targetAngleTimer -= 1000/60;
            if (p.targetAngleTimer <= 0) {
                let closestCube = null;
                let minDist = 400;
                serverCubes.forEach(c => {
                    let d = Math.hypot(c.x - p.body[0].x, c.y - p.body[0].y);
                    if (d < minDist) { minDist = d; closestCube = c; }
                });
                if (closestCube) {
                    p.angle = Math.atan2(closestCube.y - p.body[0].y, closestCube.x - p.body[0].x);
                } else {
                    p.angle += (Math.random() - 0.5) * 1.2;
                }
                p.targetAngleTimer = Math.random() * 1500 + 500;
            }
            
            if (!p.isMouseDown && Math.random() < 0.002 && p.body.length > 2) {
                if (currentTime - p.lastDashTime >= 20000) {
                    p.isMouseDown = true;
                    p.lastDashTime = currentTime;
                    setTimeout(() => { if(serverPlayers[p.id]) serverPlayers[p.id].isMouseDown = false; }, 2000);
                }
            }
        }

        let speedFactor = 1.0;
        let headRadius = getHeadRadius(p.score);
        if (headRadius > BASE_HEAD_SIZE) {
            speedFactor = 1.0 - ((headRadius - BASE_HEAD_SIZE) * 0.0035);
            if (speedFactor < 0.42) speedFactor = 0.42;
        }

        let baseStep = 2.86 * speedFactor;

        // KIỂM TRA ĐIỀU KIỆN TĂNG TỐC COOLDOWN 20S (KHÔNG ĐỨT ĐUÔI)
        if (p.isMouseDown && p.body.length > 1) {
            if (p.lastDashTime === undefined) p.lastDashTime = 0;
            if (currentTime - p.lastDashTime >= 20000) {
                p.lastDashTime = currentTime;
            }
            if (currentTime - p.lastDashTime < 2000) {
                baseStep *= 1.65;
            } else {
                p.isMouseDown = false; // Tự động ngắt sau 2 giây lướt
            }
        }

        let head = p.body[0];
        let nextX = head.x + Math.cos(p.angle) * baseStep;
        let nextY = head.y + Math.sin(p.angle) * baseStep;

        if (nextX < headRadius) nextX = headRadius;
        if (nextX > MAP_WIDTH - headRadius) nextX = MAP_WIDTH - headRadius;
        if (nextY < headRadius) nextY = headRadius;
        if (nextY > MAP_HEIGHT - headRadius) nextY = MAP_HEIGHT - headRadius;

        let prevX = head.x;
        let prevY = head.y;
        head.x = nextX;
        head.y = nextY;

        let spacing = headRadius * 0.46;
        if (spacing < 14) spacing = 14;

        for (let i = 1; i < p.body.length; i++) {
            let curr = p.body[i];
            let dx = prevX - curr.x;
            let dy = prevY - curr.y;
            let dist = Math.hypot(dx, dy);
            if (dist > spacing) {
                let ratio = spacing / dist;
                let targetX = prevX - dx * ratio;
                let targetY = prevY - dy * ratio;
                curr.x += (targetX - curr.x) * 0.75;
                curr.y += (targetY - curr.y) * 0.75;
            }
            prevX = curr.x;
            prevY = curr.y;
        }

        if (p.activeItem) {
            p.itemTimer -= 1000/60;
            if (p.itemTimer <= 0) { p.activeItem = null; }
            else if (p.activeItem === "magnet") {
                serverCubes.forEach(c => {
                    let d = Math.hypot(c.x - p.body[0].x, c.y - p.body[0].y);
                    if (d < 280) {
                        c.x += (p.body[0].x - c.x) * 0.09;
                        c.y += (p.body[0].y - c.y) * 0.09;
                    }
                });
            }
        }

        for (let i = serverCubes.length - 1; i >= 0; i--) {
            let c = serverCubes[i];
            let d = Math.hypot(c.x - p.body[0].x, c.y - p.body[0].y);
            if (d < headRadius + 12) {
                p.body.push({ x: p.body[p.body.length - 1].x, y: p.body[p.body.length - 1].y, value: c.value });
                serverCubes.splice(i, 1);
                smartMergeOnServer(p, 0, "none");
                serverCubes.push(spawnCube());
            }
        }

        for (let i = serverItems.length - 1; i >= 0; i--) {
            let it = serverItems[i];
            let d = Math.hypot(it.x - p.body[0].x, it.y - p.body[0].y);
            if (d < headRadius + 15) {
                p.activeItem = it.type;
                p.itemTimer = 7000; 
                serverItems.splice(i, 1);
                setTimeout(() => { serverItems.push(spawnItem()); }, 8000);
            }
        }
    }

    let deadPlayersThisTick = new Set();
    for (let id1 in serverPlayers) {
        let p1 = serverPlayers[id1];
        if (deadPlayersThisTick.has(p1.id)) continue;
        let hr1 = getHeadRadius(p1.score);

        for (let id2 in serverPlayers) {
            if (id1 === id2) continue;
            let p2 = serverPlayers[id2];
            if (deadPlayersThisTick.has(p2.id)) continue;
            if (p1.activeItem === "ghost" || p2.activeItem === "ghost") continue;

            for (let i = 0; i < p2.body.length; i++) {
                let segment = p2.body[i];
                let segRadius = (i === 0) ? getHeadRadius(p2.score) : 22;
                let d = Math.hypot(p1.body[0].x - segment.x, p1.body[0].y - segment.y);

                if (d < hr1 + segRadius * 0.85) {
                    if (i === 0) {
                        if (p1.score < p2.score) {
                            if (p1.activeItem === "shield") { p1.activeItem = null; break; }
                            deadPlayersThisTick.add(p1.id);
                            p2.killCount++; p2.killStreak++;
                            handlePlayerDeath(p1.id);
                        } else if (p1.score > p2.score) {
                            if (p2.activeItem === "shield") { p2.activeItem = null; break; }
                            deadPlayersThisTick.add(p2.id);
                            p1.killCount++; p1.killStreak++;
                            handlePlayerDeath(p2.id);
                        } else {
                            deadPlayersThisTick.add(p1.id);
                            deadPlayersThisTick.add(p2.id);
                            handlePlayerDeath(p1.id);
                            handlePlayerDeath(p2.id);
                        }
                        break;
                    } else {
                        if (p1.activeItem === "shield") { p1.activeItem = null; break; }
                        deadPlayersThisTick.add(p1.id);
                        p2.killCount++; p2.killStreak++;
                        
                        let triggersMega = (p2.killStreak % 10 === 0 && p2.killStreak >= 10);
                        if (triggersMega) {
                            io.emit('triggerGlobalMegaFireworks', { killerName: p2.name, killStreak: p2.killStreak });
                        }

                        io.emit('playerKilled', { 
                            killerId: p2.id, killerName: p2.name, victimId: p1.id, victimName: p1.name,
                            killCount: p2.killCount, killStreak: p2.killStreak, fireworks: true 
                        });
                        
                        handlePlayerDeath(p1.id);
                        break;
                    }
                }
            }
            if (deadPlayersThisTick.has(p1.id)) break;
        }
    }

    io.emit('gameTick', {
        players: serverPlayers,
        cubes: serverCubes,
        items: serverItems
    });
}, 1000 / 60);

http.listen(PORT, () => {
    console.log(`[SERVER] Đang chạy mượt mà tại Port : ${PORT}`);
});
