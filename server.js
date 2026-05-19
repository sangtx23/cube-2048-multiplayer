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

function spawnItem(type) {
    // Yêu cầu 2: Loại bỏ vật phẩm tăng tốc (speed), chỉ random 3 loại còn lại: x2, /2, bomb
    let t = type || ['x2', '/2', 'bomb'][Math.floor(Math.random() * 3)];
    serverItems.push({
        id: Math.random().toString(36).substring(2, 9),
        x: Math.random() * (MAP_WIDTH - 150) + 75,
        y: Math.random() * (MAP_HEIGHT - 150) + 75,
        type: t
    });
}

for (let i = 0; i < 250; i++) serverCubes.push(spawnCube());
for (let i = 0; i < 18; i++) spawnItem();

setInterval(() => {
    while (serverCubes.length < 250) serverCubes.push(spawnCube());
    while (serverItems.length < 18) spawnItem();
}, 3000);

function calculateNodeScale(val) {
    return 1.0 + Math.log2(val || 2) * 0.08;
}

function smartMergeOnServer(player, valueToAdd, mode = "add") {
    if (!player || player.body.length === 0) return;
    
    if (mode === "add" && valueToAdd > 0) {
        player.body.push({ x: player.body[player.body.length - 1].x, y: player.body[player.body.length - 1].y, value: valueToAdd });
    }

    let sortedValues = player.body.map(node => node.value).sort((a, b) => b - a);
    player.body.forEach((node, idx) => {
        node.value = sortedValues[idx];
    });

    let changed = true;
    while (changed) {
        changed = false;
        for (let i = player.body.length - 1; i > 0; i--) {
            if (player.body[i] && player.body[i-1] && player.body[i].value === player.body[i-1].value) {
                let mergedValue = player.body[i].value * 2;
                player.body[i-1].value = mergedValue;
                
                io.emit('playClientSound', { playerId: player.id, type: 'merge', val: mergedValue });
                
                player.body.splice(i, 1);
                changed = true;
                break;
            }
        }
    }

    let finalSortedValues = player.body.map(node => node.value).sort((a, b) => b - a);
    player.body.forEach((node, idx) => {
        node.value = finalSortedValues[idx];
    });

    player.body.forEach((node, index) => {
        node.baseScale = calculateNodeScale(node.value) * (index === 0 ? 1.0 : 0.85);
    });
}

function explodeBodyToCubes(nodes) {
    nodes.forEach(n => {
        if (Math.random() < 0.65) {
            serverCubes.push({
                id: Math.random().toString(36).substring(2, 9),
                x: n.x + (Math.random() - 0.5) * 60,
                y: n.y + (Math.random() - 0.5) * 60,
                value: n.value
            });
        }
    });
}

function handlePlayerDeath(playerId) {
    let p = serverPlayers[playerId];
    if (!p) return;

    p.alive = false;
    explodeBodyToCubes(p.body);
    p.body = [];

    if (p.isBot) {
        delete serverPlayers[playerId];
        setTimeout(() => { spawnBot(); }, 1000);
    } else {
        if (!playerDeathCounts[playerId]) playerDeathCounts[playerId] = 0;
        playerDeathCounts[playerId]++;
        
        let delaySeconds = 3 + (playerDeathCounts[playerId] - 1) * 2;
        if (delaySeconds > 15) delaySeconds = 15;

        io.to(playerId).emit('respawnCountdown', { delay: delaySeconds });

        setTimeout(() => {
            let reCheck = serverPlayers[playerId];
            if (reCheck && !reCheck.alive) {
                reCheck.alive = true;
                reCheck.killStreak = 0;
                reCheck.skillSpeedActive = false; // Reset kĩ năng khi hồi sinh
                let rx = Math.random() * (MAP_WIDTH - 600) + 300;
                let ry = Math.random() * (MAP_HEIGHT - 600) + 300;
                reCheck.body = [{ x: rx, y: ry, value: 2, baseScale: 1.0 }];
                io.to(playerId).emit('respawnSuccess');
            }
        }, delaySeconds * 1000);
    }
}

function spawnBot() {
    let id = 'bot_' + Math.random().toString(36).substring(2, 9);
    let bx = Math.random() * (MAP_WIDTH - 600) + 300;
    let by = Math.random() * (MAP_HEIGHT - 600) + 300;
    
    let activeNames = Object.values(serverPlayers).map(p => p.name);
    let availableNames = BOT_NAMES_POOL.filter(n => !activeNames.includes(n));
    let name = availableNames.length > 0 ? availableNames[Math.floor(Math.random() * availableNames.length)] : "Khối Thầm Lặng";

    serverPlayers[id] = {
        id: id,
        name: name,
        isBot: true,
        alive: true,
        angle: Math.random() * Math.PI * 2,
        isMouseDown: false, // Ngăn chặn bot kích hoạt chuột nhấp tăng tốc cũ
        skillSpeedActive: false, 
        skillSpeedTimer: 0,
        killCount: 0,
        killStreak: 0,
        botTargetTimer: 0,
        botTargetType: 'cube',
        botTargetId: null,
        body: [{ x: bx, y: by, value: 2, baseScale: 1.0 }]
    };
}

for (let i = 0; i < 12; i++) spawnBot();

io.on('connection', (socket) => {
    socket.on('joinGame', (data) => {
        let cleanName = (data.name || "Player").substring(0, 10).trim();
        let finalName = cleanName || "Player";
        
        serverPlayers[socket.id] = {
            id: socket.id,
            name: finalName,
            isBot: false,
            alive: true,
            angle: 0,
            isMouseDown: false,
            skillSpeedActive: false, // Trạng thái kích hoạt tăng tốc x3 mới
            skillSpeedTimer: 0,      // Bộ đếm thời gian hiệu lực chạy trên server
            killCount: 0,
            killStreak: 0,
            body: [{ x: Math.random() * (MAP_WIDTH - 600) + 300, y: Math.random() * (MAP_HEIGHT - 600) + 300, value: 2, baseScale: 1.0 }]
        };
        socket.emit('initPlayerName', { confirmedName: finalName });
    });

    socket.on('updateInput', (data) => {
        let p = serverPlayers[socket.id];
        if (p && p.alive) {
            p.angle = data.angle || 0;
            // Yêu cầu 1: Đã triệt tiêu hoàn toàn tính năng nhấp chuột/touch tăng tốc cũ
            p.isMouseDown = false; 
        }
    });

    // Kích hoạt kĩ năng tăng tốc x3 từ nút bấm chuyên dụng
    socket.on('activateSpeedSkill', () => {
        let p = serverPlayers[socket.id];
        // Nếu người chơi còn sống và kĩ năng đang không trong thời gian kích hoạt
        if (p && p.alive && !p.skillSpeedActive) {
            p.skillSpeedActive = true;
            p.skillSpeedTimer = 7 * 60; // 7 giây chạy ở tần số quét 60 FPS = 420 ticks
            io.to(socket.id).emit('speedSkillActivatedConfirmed');
        }
    });

    socket.on('disconnect', () => {
        delete serverPlayers[socket.id];
        delete playerDeathCounts[socket.id];
    });
});

// VÒNG LẶP VẬT LÝ CHÍNH CỦA SERVER (60 FPS)
setInterval(() => {
    let players = Object.values(serverPlayers);

    // 1. CẬP NHẬT AI BOT
    players.forEach(p => {
        if (!p.alive || !p.isBot || p.body.length === 0) return;
        p.botTargetTimer--;

        if (p.botTargetTimer <= 0 || !p.botTargetId) {
            p.botTargetTimer = Math.floor(Math.random() * 40) + 30;
            if (Math.random() < 0.75 && serverCubes.length > 0) {
                p.botTargetType = 'cube';
                let randomCube = serverCubes[Math.floor(Math.random() * serverCubes.length)];
                p.botTargetId = randomCube.id;
            } else if (serverItems.length > 0) {
                p.botTargetType = 'item';
                let randomItem = serverItems[Math.floor(Math.random() * serverItems.length)];
                p.botTargetId = randomItem.id;
            } else {
                p.botTargetType = 'wander';
                p.botTargetId = null;
            }
            
            // AI ngẫu nhiên kích hoạt tăng tốc x3 của riêng nó độc lập để tăng tính cạnh tranh
            if (Math.random() < 0.05 && !p.skillSpeedActive) {
                p.skillSpeedActive = true;
                p.skillSpeedTimer = 7 * 60;
            }
        }

        let targetX = null, targetY = null;
        if (p.botTargetType === 'cube') {
            let targetCube = serverCubes.find(c => c.id === p.botTargetId);
            if (targetCube) { targetX = targetCube.x; targetY = targetCube.y; }
        } else if (p.botTargetType === 'item') {
            let targetItem = serverItems.find(it => it.id === p.botTargetId);
            if (targetItem) { targetX = targetItem.x; targetY = targetItem.y; }
        }

        if (targetX !== null && targetY !== null) {
            p.angle = Math.atan2(targetY - p.body[0].y, targetX - p.body[0].x);
        } else {
            if (Math.random() < 0.05) p.angle += (Math.random() - 0.5) * 1.5;
        }
    });

    // 2. XỬ LÝ DI CHUYỂN TOÀN BỘ NGƯỜI CHƠI VÀ BOT
    players.forEach(p => {
        if (!p.alive || p.body.length === 0) return;

        let speedFactor = 1.0;
        
        // Yêu cầu 3: Nếu kĩ năng nút bấm x3 đang kích hoạt (trong 7 giây)
        if (p.skillSpeedActive) {
            speedFactor = 3.0; // Tăng tốc x3 lần tốc độ bình thường
            p.skillSpeedTimer--;
            if (p.skillSpeedTimer <= 0) {
                p.skillSpeedActive = false;
            }
            // Giải quyết: Giữ nguyên speedFactor x3, hoàn toàn KHÔNG BỊ ĐỨT ĐUÔI (không cắt mảng body rớt khối)
        }

        let baseStep = 2.86 * speedFactor;

        let head = p.body[0];
        head.x += Math.cos(p.angle) * baseStep;
        head.y += Math.sin(p.angle) * baseStep;

        let headRadius = (BASE_HEAD_SIZE * (head.baseScale || 1)) / 2;
        if (head.x < headRadius) head.x = headRadius;
        if (head.x > MAP_WIDTH - headRadius) head.x = MAP_WIDTH - headRadius;
        if (head.y < headRadius) head.y = headRadius;
        if (head.y > MAP_HEIGHT - headRadius) head.y = MAP_HEIGHT - headRadius;

        for (let i = 1; i < p.body.length; i++) {
            let cur = p.body[i];
            let prev = p.body[i - 1];
            if (!cur || !prev) continue;
            let dist = Math.hypot(cur.x - prev.x, cur.y - prev.y);
            let targetDist = 24 * ((prev.baseScale || 1) + (cur.baseScale || 1)) * 0.46;
            if (dist > targetDist) {
                let angleNode = Math.atan2(prev.y - cur.y, prev.x - cur.x);
                cur.x = prev.x - Math.cos(angleNode) * targetDist;
                cur.y = prev.y - Math.sin(angleNode) * targetDist;
            }
        }

        // 3. VA CHẠM ĐẦU RẮN ĂN KHỐI ĐIỂM (CUBES) TRÊN BẢN ĐỒ
        for (let i = serverCubes.length - 1; i >= 0; i--) {
            let c = serverCubes[i];
            let cRadius = (28 * calculateNodeScale(c.value)) / 2;
            let dist = Math.hypot(head.x - c.x, head.y - c.y);
            if (dist < headRadius + cRadius) {
                if (head.value === c.value) {
                    head.value *= 2;
                    io.emit('playClientSound', { playerId: p.id, type: 'merge', val: head.value });
                    smartMergeOnServer(p, 0, "none");
                } else {
                    smartMergeOnServer(p, c.value, "add");
                }
                serverCubes.splice(i, 1);
            }
        }

        // 4. VA CHẠM ĐẦU RẮN ĂN VẬT PHẨM (ITEMS)
        for (let i = serverItems.length - 1; i >= 0; i--) {
            let it = serverItems[i];
            let dist = Math.hypot(head.x - it.x, head.y - it.y);
            if (dist < headRadius + 18) {
                io.emit('playClientSound', { playerId: p.id, type: it.type });
                
                if (it.type === 'x2') {
                    p.body.forEach(node => { node.value *= 2; });
                    smartMergeOnServer(p, 0, "none");
                } else if (it.type === '/2') {
                    p.body.forEach(node => {
                        node.value = Math.max(2, Math.floor(node.value / 2));
                    });
                    smartMergeOnServer(p, 0, "none");
                } else if (it.type === 'bomb') {
                    if (p.body.length > 1) {
                        let lossCount = Math.floor(p.body.length / 2);
                        let dropped = p.body.splice(p.body.length - lossCount, lossCount);
                        explodeBodyToCubes(dropped);
                        smartMergeOnServer(p, 0, "none");
                    } else {
                        handlePlayerDeath(p.id);
                    }
                }
                serverItems.splice(i, 1);
            }
        }
    });

    // 5. XỬ LÝ VA CHẠM ĐẦU RẮN VỚI THÂN CỦA ĐỐI THỦ (KILL & DEATH)
    let deadPlayersThisTick = new Set();
    for (let i = 0; i < players.length; i++) {
        let p1 = players[i];
        if (!p1.alive || p1.body.length === 0 || deadPlayersThisTick.has(p1.id)) continue;

        let head1 = p1.body[0];
        let h1Radius = (BASE_HEAD_SIZE * (head1.baseScale || 1)) / 2;

        for (let j = 0; j < players.length; j++) {
            let p2 = players[j];
            if (!p2.alive || p2.body.length === 0 || p1.id === p2.id) continue;

            for (let k = 0; k < p2.body.length; k++) {
                if (k === 0) {
                    // Đối đầu Head-to-Head
                    let head2 = p2.body[0];
                    let h2Radius = (BASE_HEAD_SIZE * (head2.baseScale || 1)) / 2;
                    let dist = Math.hypot(head1.x - head2.x, head1.y - head2.y);
                    if (dist < (h1Radius + h2Radius) * 0.85) {
                        if (head1.value < head2.value) {
                            deadPlayersThisTick.add(p1.id);
                            p2.killCount++; p2.killStreak++;
                            if (p2.killStreak % 10 === 0 && p2.killStreak >= 10) {
                                io.emit('triggerGlobalMegaFireworks', { killerName: p2.name, killStreak: p2.killStreak });
                            }
                            io.emit('playerKilled', { killerId: p2.id, killerName: p2.name, victimId: p1.id, victimName: p1.name, killCount: p2.killCount, killStreak: p2.killStreak, fireworks: true });
                            handlePlayerDeath(p1.id);
                            break;
                        }
                    }
                } else {
                    // Đâm vào thân người khác
                    let bodyNode = p2.body[k];
                    let bRadius = (BASE_HEAD_SIZE * (bodyNode.baseScale || 1)) / 2;
                    let dist = Math.hypot(head1.x - bodyNode.x, head1.y - bodyNode.y);
                    if (dist < (h1Radius + bRadius) * 0.82) {
                        if (head1.value === bodyNode.value) {
                            // Cùng cấp bậc, an toàn sát nhập ngược lại cấu trúc server
                            bodyNode.value *= 2;
                            io.emit('playClientSound', { playerId: p2.id, type: 'merge', val: bodyNode.value });
                            smartMergeOnServer(p2, 0, "none");
                            break;
                        } else {
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
    console.log(`[SERVER] Đang chạy ổn định tại cổng : ${PORT}`);
});
