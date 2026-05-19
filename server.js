const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const PORT = process.env.PORT || 3000;

app.use(express.static('public'));

const MAP_WIDTH = 3000;
const MAP_HEIGHT = 2000;

let serverPlayers = {};
let serverCubes = [];
const MAX_CUBES = 600;

const BOT_NAMES = ['Sói Đơn Độc', 'Ẩn Sĩ', 'NinjaCube', 'Độc Cô Cầu Bại', 'Chiến Thần', 'Thợ Săn Cube', 'CubeVương', 'Gấu Đô Đốc', 'Rắn Đại Hiệp', 'Lão Đại 2048'];

function spawnItem() {
    // 2. LOẠI BỎ VẬT PHẨM TĂNG TỐC VÀ LOẠI BỎ CỘNG DỒN
    // Chỉ giữ lại x2, /2 và bomb. Điều chỉnh tỷ lệ xuất hiện đồng đều
    const types = ['x2', '/2', 'bomb'];
    const weights = [40, 30, 30]; 
    let r = Math.random() * 100;
    let sum = 0, type = 'x2';
    for (let i = 0; i < types.length; i++) {
        sum += weights[i];
        if (r <= sum) { type = types[i]; break; }
    }
    return {
        id: Math.random().toString(36).substring(2, 9),
        x: Math.random() * (MAP_WIDTH - 120) + 60,
        y: Math.random() * (MAP_HEIGHT - 120) + 60,
        type: type
    };
}

function initCubes() {
    for (let i = 0; i < MAX_CUBES; i++) {
        serverCubes.push(spawnItem());
    }
}
initCubes();

function createPlayerObject(id, name, isBot = false) {
    let startX = Math.random() * (MAP_WIDTH - 400) + 200;
    let startY = Math.random() * (MAP_HEIGHT - 400) + 200;
    return {
        id: id,
        name: name,
        alive: true,
        isBot: isBot,
        angle: Math.random() * Math.PI * 2,
        
        // 3. TÍNH NĂNG NÚT BẤM TĂNG TỐC X3 TRONG 7S
        speedMultiplier: 1.0,  // Hệ số tốc độ mặc định
        dashSkillTimer: 0,     // Bộ đếm thời gian hiệu ứng bằng Frame (7s * 60 FPS = 420)
        
        killCount: 0,
        killStreak: 0,
        body: [
            { x: startX, y: startY, value: 2, baseScale: 1.0 },
            { x: startX - 30, y: startY, value: 2, baseScale: 0.95 },
            { x: startX - 60, y: startY, value: 2, baseScale: 0.9 }
        ]
    };
}

function spawnBot() {
    let botId = 'bot_' + Math.random().toString(36).substring(2, 9);
    let name = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];
    let count = 0;
    Object.values(serverPlayers).forEach(p => { if (p.isBot && p.name.startsWith(name)) count++; });
    if (count > 0) name += ' ' + (count + 1);
    serverPlayers[botId] = createPlayerObject(botId, name, true);
}

for (let i = 0; i < 5; i++) { spawnBot(); }

io.on('connection', (socket) => {
    socket.on('joinGame', (data) => {
        let pName = (data.name && data.name.trim() !== "") ? data.name.trim() : "Player";
        serverPlayers[socket.id] = createPlayerObject(socket.id, pName, false);
    });

    socket.on('updateInput', (data) => {
        let p = serverPlayers[socket.id];
        // 1. LOẠI BỎ TÍNH NĂNG NHẤP CHUỘT HOẶC TOUCH ĐỂ TĂNG TỐC TỪ INPUT CŨ
        if (p && p.alive) {
            p.angle = data.angle;
        }
    });

    // 3. TẠO LOGIC TIẾP NHẬN SKILL TĂNG TỐC X3 TỪ CLIENT
    socket.on('activateDashSkill', () => {
        let p = serverPlayers[socket.id];
        if (p && p.alive && p.dashSkillTimer <= 0) {
            p.speedMultiplier = 3.0; // Tăng tốc x3
            p.dashSkillTimer = 7 * 60; // Duy trì trong 7 giây tại tần số 60 FPS
            
            // Đồng bộ chữ nổi thông báo lên màn hình người chơi
            io.to(p.id).emit('playClientSound', { 
                playerId: p.id, 
                type: 'speed', 
                floatingText: "⚡ TỐC BIẾN X3 TỐC ĐỘ (7s)!", 
                color: "#ec4899" 
            });
        }
    });

    socket.on('disconnect', () => {
        if (serverPlayers[socket.id]) {
            delete serverPlayers[socket.id];
        }
    });
});

// Vòng lặp tính toán logic game (60 FPS)
setInterval(() => {
    // 1. Cập nhật vị trí di chuyển cho người chơi và Bot
    Object.values(serverPlayers).forEach(p => {
        if (!p.alive || !p.body || p.body.length === 0) return;

        // Xử lý bộ đếm thời gian hiệu ứng tăng tốc x3
        if (p.dashSkillTimer > 0) {
            p.dashSkillTimer--;
            if (p.dashSkillTimer <= 0) {
                p.speedMultiplier = 1.0; // Trả về tốc độ gốc sau 7 giây
            }
        }

        // Tốc độ di chuyển cơ bản cố định nhân với hệ số tăng tốc (Không rụng điểm khi đi nhanh)
        let finalSpeed = 2.8 * p.speedMultiplier;

        if (p.isBot) {
            let head = p.body[0];
            let closest = null, minDist = 400;
            serverCubes.forEach(c => {
                let d = Math.hypot(c.x - head.x, c.y - head.y);
                if (d < minDist) { minDist = d; closest = c; }
            });
            if (closest) {
                p.angle = Math.atan2(closest.y - head.y, closest.x - head.x);
            }
            // Bot ngẫu nhiên tự kích hoạt tăng tốc x3 giống người chơi để săn đuổi
            if (Math.random() < 0.002 && p.dashSkillTimer <= 0) {
                p.speedMultiplier = 3.0;
                p.dashSkillTimer = 7 * 60;
            }
        }

        let head = p.body[0];
        head.x += Math.cos(p.angle) * finalSpeed;
        head.y += Math.sin(p.angle) * finalSpeed;

        if (head.x < 20) head.x = 20; if (head.x > MAP_WIDTH - 20) head.x = MAP_WIDTH - 20;
        if (head.y < 20) head.y = 20; if (head.y > MAP_HEIGHT - 20) head.y = MAP_HEIGHT - 20;

        // Xử lý uốn lượn uốn khúc cho thân sau
        for (let i = p.body.length - 1; i > 0; i--) {
            let prev = p.body[i - 1];
            let curr = p.body[i];
            if (!prev || !curr) continue;
            let dist = Math.hypot(prev.x - curr.x, prev.y - curr.y);
            let targetDist = 26 * (prev.baseScale + curr.baseScale) * 0.45;
            if (dist > targetDist) {
                let tAngle = Math.atan2(prev.y - curr.y, prev.x - curr.x);
                curr.x = prev.x - Math.cos(tAngle) * targetDist;
                curr.y = prev.y - Math.sin(tAngle) * targetDist;
            }
        }
    });

    // 2. Kiểm tra va chạm: Nuốt hạt vật phẩm (Cubes)
    Object.values(serverPlayers).forEach(p => {
        if (!p.alive) return;
        let head = p.body[0];
        let rHead = 24 * p.body[0].baseScale;

        for (let i = serverCubes.length - 1; i >= 0; i--) {
            let c = serverCubes[i];
            let dist = Math.hypot(c.x - head.x, c.y - head.y);
            if (dist < rHead + 15) {
                let type = c.type;
                serverCubes.splice(i, 1);

                if (type === 'x2') {
                    let last = p.body[p.body.length - 1];
                    let v = last.value;
                    let scale = Math.max(0.4, last.baseScale * 0.96);
                    p.body.push({ x: last.x, y: last.y, value: v, baseScale: scale });
                    io.to(p.id).emit('playClientSound', { playerId: p.id, type: 'x2' });
                } 
                else if (type === '/2') {
                    if (p.body.length > 2) {
                        p.body.pop();
                        io.to(p.id).emit('playClientSound', { playerId: p.id, type: 'div2' });
                    }
                } 
                else if (type === 'bomb') {
                    io.to(p.id).emit('playClientSound', { playerId: p.id, type: 'bomb' });
                    let pId = p.id;
                    let pName = p.name;
                    let isBot = p.isBot;
                    
                    p.body = [];
                    p.alive = false;
                    io.emit('playerDied', { name: pName, isBomb: true });
                    
                    setTimeout(() => {
                        if (serverPlayers[pId]) {
                            if (isBot) {
                                delete serverPlayers[pId];
                                spawnBot();
                            } else {
                                serverPlayers[pId] = createPlayerObject(pId, pName, false);
                                io.to(pId).emit('respawnData', serverPlayers[pId]);
                            }
                        }
                    }, 2000);
                }
                break;
            }
        }
    });

    // Bù hạt vật phẩm bị thiếu
    while (serverCubes.length < MAX_CUBES) {
        serverCubes.push(spawnItem());
    }

    // 3. Kiểm tra va chạm: Đấu trường giữa các Rắn Cube với nhau
    let playersArr = Object.values(serverPlayers).filter(p => p.alive);
    playersArr.forEach(p1 => {
        playersArr.forEach(p2 => {
            if (p1.id === p2.id) return;
            let head1 = p1.body[0];
            let rHead1 = 24 * head1.baseScale;

            for (let j = 0; j < p2.body.length; j++) {
                if (j === 0) {
                    let head2 = p2.body[0];
                    let d = Math.hypot(head1.x - head2.x, head1.y - head2.y);
                    if (d < rHead1 + 24 * head2.baseScale) {
                        if (head1.value > head2.value) {
                            mergeBodies(p1, p2);
                        } else if (head2.value > head1.value) {
                            mergeBodies(p2, p1);
                        }
                        break;
                    }
                } else {
                    let seg = p2.body[j];
                    let rSeg = 24 * seg.baseScale;
                    let d = Math.hypot(head1.x - seg.x, head1.y - seg.y);
                    if (d < rHead1 + rSeg) {
                        if (head1.value === seg.value) {
                            head1.value *= 2;
                            p1.body.forEach((s, idx) => { s.baseScale = Math.min(2.5, 1.0 + (idx * 0.02) + (Math.log2(head1.value) * 0.05)); });
                            p2.body.splice(j, 1);
                            io.to(p1.id).emit('playClientSound', { playerId: p1.id, type: 'merge' });

                            if (p2.body.length <= 1) {
                                killPlayer(p1, p2, false);
                            }
                        } else {
                            killPlayer(p2, p1, true);
                        }
                        break;
                    }
                }
            }
        });
    });

    io.emit('updateState', { players: serverPlayers, cubes: serverCubes });
}, 1000 / 60);

function mergeBodies(winner, loser) {
    let wHead = winner.body[0];
    wHead.value *= 2;
    winner.body.forEach((s, idx) => { s.baseScale = Math.min(2.5, 1.0 + (idx * 0.02) + (Math.log2(wHead.value) * 0.05)); });
    
    let lId = loser.id;
    let lName = loser.name;
    let isBot = loser.isBot;
    
    loser.body = [];
    loser.alive = false;
    
    winner.killCount++;
    winner.killStreak++;
    io.emit('playerDied', { name: lName, killer: winner.name, streak: winner.killStreak });

    setTimeout(() => {
        if (serverPlayers[lId]) {
            if (isBot) {
                delete serverPlayers[lId];
                spawnBot();
            } else {
                serverPlayers[lId] = createPlayerObject(lId, lName, false);
                io.to(lId).emit('respawnData', serverPlayers[lId]);
            }
        }
    }, 2000);
}

function killPlayer(killer, victim, hittedBody) {
    let vId = victim.id;
    let vName = victim.name;
    let isBot = victim.isBot;
    
    victim.body = [];
    victim.alive = false;
    
    killer.killCount++;
    killer.killStreak++;
    io.emit('playerDied', { name: vName, killer: killer.name, streak: killer.killStreak });

    setTimeout(() => {
        if (serverPlayers[vId]) {
            if (isBot) {
                delete serverPlayers[vId];
                spawnBot();
            } else {
                serverPlayers[vId] = createPlayerObject(vId, vName, false);
                io.to(vId).emit('respawnData', serverPlayers[vId]);
            }
        }
    }, 2000);
}

http.listen(PORT, () => {
    console.log('Server running on port ' + PORT);
});
