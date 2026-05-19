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
    let t = type || ['x2', '/2', 'bomb', 'speed'][Math.floor(Math.random() * 4)];
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
        isMouseDown: Math.random() < 0.15,
        killCount: 0,
        killStreak: 0,
        speedBuffTimer: 0,
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
            killCount: 0,
            killStreak: 0,
            speedBuffTimer: 0,
            body: [{ x: Math.random() * (MAP_WIDTH - 600) + 300, y: Math.random() * (MAP_HEIGHT - 600) + 300, value: 2, baseScale: 1.0 }]
        };
        socket.emit('initPlayerName', { confirmedName: finalName });
    });

    socket.on('updateInput', (data) => {
        let p = serverPlayers[socket.id];
        if (p && p.alive) {
            p.angle = data.angle || 0;
            p.isMouseDown = !!data.isMouseDown;
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
            p.isMouseDown = Math.random() < 0.22;
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
        if (p.speedBuffTimer > 0) {
            speedFactor = 2.2;
            p.speedBuffTimer--;
        }

        let baseStep = 2.86 * speedFactor;
        if (p.isMouseDown && p.body.length > 1) {
            baseStep *= 1.65;
            if (Math.random() < 0.12) {
                let tailIndex = p.body.length - 1;
                let poppedNode = p.body.splice(tailIndex, 1)[0];
                serverCubes.push({
                    id: Math.random().toString(36).substring(2, 9),
                    x: poppedNode.x + (Math.random() - 0.5) * 40,
                    y: poppedNode.y + (Math.random() - 0.5) * 40,
                    value: poppedNode.value
                });
                smartMergeOnServer(p, 0, "none");
            }
        }

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
    });

    // 3. XỬ LÝ VA CHẠM THU HOẠCH CUBE THƯỜNG
    players.forEach(p => {
        if (!p.alive || p.body.length === 0) return;
        let head = p.body[0];
        let headSize = BASE_HEAD_SIZE * (head.baseScale || 1);

        for (let k = serverCubes.length - 1; k >= 0; k--) {
            let c = serverCubes[k];
            let d = Math.hypot(head.x - c.x, head.y - c.y);
            if (d < (headSize / 2) + 12) {
                smartMergeOnServer(p, c.value, "add");
                serverCubes.splice(k, 1);
            }
        }
    });

    // 4. XỬ LÝ VA CHẠM ĂN HỘP VẬT PHẨM (ITEMS)
    players.forEach(p => {
        if (!p.alive || p.body.length === 0) return;
        let head = p.body[0];
        let headSize = BASE_HEAD_SIZE * (head.baseScale || 1);

        for (let k = serverItems.length - 1; k >= 0; k--) {
            let it = serverItems[k];
            let d = Math.hypot(head.x - it.x, head.y - it.y);
            if (d < (headSize / 2) + 18) {
                if (it.type === 'x2') {
                    p.body[0].value *= 2; 
                    smartMergeOnServer(p, 0, "none");
                    io.emit('playClientSound', { playerId: p.id, type: 'x2', floatingText: "✨ NHÂN ĐÔI KHỐI ĐẦU (X2)!", color: "#fbbf24" });
                } 
                else if (it.type === '/2') {
                    p.body.forEach(node => { if (node.value > 2) node.value /= 2; });
                    smartMergeOnServer(p, 0, "none");
                    io.emit('playClientSound', { playerId: p.id, type: '/2', floatingText: "⚡ BỊ GIẢM SỨC MẠNH (/2)!", color: "#94a3b8" });
                } 
                else if (it.type === 'bomb') {
                    if (p.body.length > 1) {
                        let cutLength = Math.ceil(p.body.length / 2);
                        let removedNodes = p.body.splice(cutLength);
                        explodeBodyToCubes(removedNodes);
                    }
                    smartMergeOnServer(p, 0, "none");
                    io.emit('playClientSound', { playerId: p.id, type: 'bomb', floatingText: "💥 DẪM PHẢI BOM NỔ TÙNG PHÈO!", color: "#ef4444" });
                } 
                else if (it.type === 'speed') {
                    if (!p.speedBuffTimer) p.speedBuffTimer = 0;
                    p.speedBuffTimer += 300; 

                    let totalSecondsLeft = Math.ceil(p.speedBuffTimer / 60);

                    io.emit('playClientSound', { 
                        playerId: p.id, 
                        type: 'speed', 
                        floatingText: "⚡ Tốc Độ Siêu Hạng (+5s)!", 
                        color: "#00ffff",
                        speedDuration: totalSecondsLeft
                    });
                }
                serverItems.splice(k, 1);
            }
        }
    });

    // 5. XỬ LÝ VA CHẠM ĐỐI KHÁNG ĐẦU VÀ ĂN ĐUÔI
    let playerIds = Object.keys(serverPlayers);
    let deadPlayersThisTick = new Set(); 

    for (let i = 0; i < playerIds.length; i++) {
        let p1 = serverPlayers[playerIds[i]];
        if (!p1 || !p1.alive || p1.body.length === 0 || deadPlayersThisTick.has(p1.id)) continue;

        for (let j = 0; j < playerIds.length; j++) {
            if (i === j) continue;
            let p2 = serverPlayers[playerIds[j]];
            if (!p2 || !p2.alive || p2.body.length === 0 || deadPlayersThisTick.has(p2.id)) continue;

            let h1 = p1.body[0]; 
            let h2 = p2.body[0]; 
            let size1 = BASE_HEAD_SIZE * (h1.baseScale || 1);
            let size2 = BASE_HEAD_SIZE * (h2.baseScale || 1);

            let distHeadToHead = Math.hypot(h1.x - h2.x, h1.y - h2.y);
            if (distHeadToHead < (size1 / 2) + (size2 / 2) - 5) {
                if (h1.value > h2.value) {
                    deadPlayersThisTick.add(p2.id);
                    p1.killCount++;
                    p1.killStreak++;
                    
                    // Chỉnh sửa: Phát tín hiệu thông báo Marquee và Pháo hoa toàn map cho tất cả người chơi
                    let triggersMega = (p1.killStreak % 10 === 0 && p1.killStreak >= 10);
                    if (triggersMega) {
                        io.emit('triggerGlobalMegaFireworks', { killerName: p1.name, killStreak: p1.killStreak });
                    }

                    io.emit('playerKilled', { 
                        killerId: p1.id, killerName: p1.name, victimId: p2.id, victimName: p2.name,
                        killCount: p1.killCount, killStreak: p1.killStreak, fireworks: true 
                    });
                    
                    smartMergeOnServer(p1, h2.value, "add");
                    handlePlayerDeath(p2.id);
                    break; 
                }
                else if (h2.value > h1.value) {
                    deadPlayersThisTick.add(p1.id);
                    p2.killCount++;
                    p2.killStreak++;
                    
                    // Chỉnh sửa: Phát tín hiệu thông báo Marquee và Pháo hoa toàn map cho tất cả người chơi
                    let triggersMega = (p2.killStreak % 10 === 0 && p2.killStreak >= 10);
                    if (triggersMega) {
                        io.emit('triggerGlobalMegaFireworks', { killerName: p2.name, killStreak: p2.killStreak });
                    }

                    io.emit('playerKilled', { 
                        killerId: p2.id, killerName: p2.name, victimId: p1.id, victimName: p1.name,
                        killCount: p2.killCount, killStreak: p2.killStreak, fireworks: true 
                    });
                    
                    smartMergeOnServer(p2, h1.value, "add");
                    handlePlayerDeath(p1.id);
                    break;
                }
            }

            for (let nodeIndex = 1; nodeIndex < p2.body.length; nodeIndex++) {
                let targetNode = p2.body[nodeIndex];
                if (!targetNode) continue;
                
                let distToNode = Math.hypot(h1.x - targetNode.x, h1.y - targetNode.y);
                let hitRadius = (size1 / 2) + (BASE_HEAD_SIZE * (targetNode.baseScale || 1) / 2) - 2;

                if (distToNode < hitRadius) {
                    if (h1.value > targetNode.value) {
                        let severedTail = p2.body.splice(nodeIndex);
                        explodeBodyToCubes(severedTail);
                        smartMergeOnServer(p1, targetNode.value, "add");
                        
                        io.emit('playClientSound', { 
                            playerId: p1.id, 
                            type: 'merge', 
                            floatingText: `✂️ Đã cắn đứt đuôi của ${p2.name}!`, 
                            color: "#22c55e" 
                        });
                        
                        smartMergeOnServer(p2, 0, "none");
                        break; 
                    } 
                    else {
                        deadPlayersThisTick.add(p1.id);
                        p2.killCount++;
                        p2.killStreak++;
                        
                        // Chỉnh sửa: Phát tín hiệu thông báo Marquee và Pháo hoa toàn map cho tất cả người chơi
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
    console.log(`[SERVER RUNNING] Hệ thống đấu trường 2048 Cube đã mở tại Port: ${PORT}`);
});
