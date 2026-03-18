const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

let w, h;
let floorY, ceilingY, pSize, pX;
let gravity, jumpVelocity;

const STATE = { START: 0, PLAYING: 1, PAUSED: 2, GAMEOVER: 3 };
const TYPE = { SPIKE: 0, BLOCK: 1, HANGING: 2, PORTAL: 3, ORB: 4 };
let gameState = STATE.START;

let bgHue = 240;
let playerColor = '#ffffff'; // Start player as white to pop well until we add character selects if wanted

let isGravityMode = false;
let gravityDirection = 1;
let nextPortalIsA = true;
let spikesSincePortal = 0;
let particles = [];
let shatterParticles = [];
let isDead = false;
let deathTimer = 0;
let score = 0;
let highScore = localStorage.getItem('gdHighScore') || 0;
let lastOrbSpawnTime = 0;

// Theme System
const themes = [
    {
        id: 'city',
        bgColor: '#1a237e',
        buildingColor: 'rgba(255, 255, 255, 0.08)',
        windowColor: 'rgba(255, 255, 200, 0.3)',
        style: 'city'
    },
    {
        id: 'industrial',
        bgColor: '#4a148c',
        buildingColor: 'rgba(255, 255, 255, 0.06)',
        windowColor: 'rgba(255, 200, 200, 0.2)',
        style: 'industrial'
    },
    {
        id: 'cyber',
        bgColor: '#000000',
        buildingColor: 'rgba(0, 255, 0, 0.05)',
        windowColor: 'rgba(0, 255, 0, 0.1)',
        style: 'cyber'
    }
];
let currentThemeIndex = 0;
let themeTimer = 0;
let obstaclesPassed = 0;

let bgObjects = [];
let bgSpeed;

let obstacles = [];
let obstacleSpeed;
let obstacleTimer = 0;
let minGap;
let spikeSize;

let consecutiveCeilingSpikes = 0;

const player = {
    x: 0,
    y: 0,
    size: 0,
    vy: 0,
    isJumping: false,
    rotation: 0
};
let playerRotationSpeed = 0;

class ShatterParticle {
    constructor(x, y, color) {
        this.x = x;
        this.y = y;
        this.size = pSize * (0.1 + Math.random() * 0.3); // Random fragments
        this.color = color;
        this.alpha = 1.0;

        // Explode outward in all directions
        let angle = Math.random() * Math.PI * 2;
        let speed = Math.random() * pSize * 0.3;
        this.vx = Math.cos(angle) * speed;
        this.vy = Math.sin(angle) * speed - (pSize * 0.1); // Add upward burst

        this.life = 1.0;
        this.decay = 0.01 + Math.random() * 0.02;
    }

    update(timeScale) {
        this.vy += gravity * 2 * timeScale; // Particles fall
        this.x += this.vx * timeScale;
        this.y += this.vy * timeScale;

        this.life -= this.decay * timeScale;
        this.alpha = Math.max(0, this.life);
    }

    draw(ctx) {
        if (this.alpha <= 0) return;
        ctx.save();
        ctx.globalAlpha = this.alpha;
        ctx.fillStyle = this.color;
        ctx.shadowColor = this.color;
        ctx.shadowBlur = 10;
        ctx.fillRect(this.x - this.size / 2, this.y - this.size / 2, this.size, this.size);
        ctx.restore();
    }
}

function init() {
    // UI Elements
    const pauseBtn = document.getElementById('pauseBtn');
    const pauseMenu = document.getElementById('pauseMenu');
    const resumeBtn = document.getElementById('resumeBtn');

    // Pause Logic
    pauseBtn.addEventListener('click', () => {
        if (gameState === STATE.PLAYING) {
            gameState = STATE.PAUSED;
            pauseBtn.classList.add('hidden');
            pauseMenu.classList.remove('hidden');
        }
    });

    resumeBtn.addEventListener('click', () => {
        gameState = STATE.PLAYING;
        pauseMenu.classList.add('hidden');
        pauseBtn.classList.remove('hidden');
        // Reset lastTime to avoid huge delta jumps after unpausing
        requestAnimationFrame((timestamp) => {
            lastTime = timestamp;
        });
    });

    const restartBtn = document.getElementById('restartBtn');
    const gameOverMenu = document.getElementById('gameOverMenu');
    const scoreDisplay = document.getElementById('scoreDisplay');

    // Color Customization
    document.querySelectorAll('#playerColors .color-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            playerColor = e.target.dataset.color;
        });
    });

    restartBtn.addEventListener('click', () => {
        gameOverMenu.classList.add('hidden');
        resetGame();
    });

    resize();
    window.addEventListener('resize', resize);

    // Splash screen fade-out
    setTimeout(() => {
        const splash = document.getElementById('splashScreen');
        if (splash) {
            splash.classList.add('fade-out');
            setTimeout(() => splash.remove(), 1000);
        }
    }, 2500);

    // Register Service Worker for PWA
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js')
            .then(reg => console.log('SW registered!', reg.scope))
            .catch(err => console.log('SW failed!', err));
    }
    // Input handling
    window.addEventListener('keydown', (e) => {
        if (e.code === 'Space') {
            e.preventDefault();
            jump();
        }
    }); // spacebar listener

    // Mouse input
    window.addEventListener('mousedown', (e) => {
        if (!e.target.closest('#uiLayer')) {
            e.preventDefault();
            jump();
        }
    });

    // Use touchstart for touch devices
    window.addEventListener('touchstart', (e) => {
        if (!e.target.closest('#uiLayer')) {
            e.preventDefault(); // Prevents zooming/scrolling natively on mobile browsers
            jump();
        }
    }, { passive: false });

    // Key up logic for jump height control
    window.addEventListener('keyup', (e) => {
        if (e.code === 'Space') {
            stopJump();
        }
    });

    // Mouse up logic
    window.addEventListener('mouseup', (e) => {
        if (!e.target.closest('#uiLayer')) {
            e.preventDefault();
            stopJump();
        }
    });

    // Touch end logic for jump height control
    window.addEventListener('touchend', (e) => {
        if (!e.target.closest('#uiLayer')) {
            e.preventDefault();
            stopJump();
        }
    }, { passive: false });

    // Initial time and start loop
    requestAnimationFrame((timestamp) => {
        lastTime = timestamp;
        gameLoop(timestamp);
    });
}


function resize() {
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = w;
    canvas.height = h;

    // Use minimum screen dimension to scale player size
    pSize = Math.min(w, h) * 0.08;
    pX = w * 0.15; // Placed near left side
    floorY = h * 0.8; // Floor at bottom 20%
    ceilingY = h * 0.4; // Tighten the corridor to exactly above max jump height

    // Physics scaling (tuned for a snappy, heavy jump at 60fps equivalent)
    gravity = h * 0.0035;
    jumpVelocity = h * -0.045;

    // Calculate rotation speed to achieve 90 degrees (Math.PI / 2) over standard full jump arc
    // Air time frames = (2 * Math.abs(jumpVelocity)) / gravity
    playerRotationSpeed = (Math.PI / 2) / ((2 * Math.abs(jumpVelocity)) / gravity);


    // Obstacle scaling
    spikeSize = Math.min(w, h) * 0.06;
    obstacleSpeed = w * 0.009; // Slightly faster for GD feel
    minGap = w * 0.4;
    obstacles = [];

    // Background scaling
    bgSpeed = obstacleSpeed * 0.25; // Slower than obstacles for parallax depth
    bgObjects = [];
    for (let i = 0; i < 10; i++) {
        generateBgObject(Math.random() * w * 2);
    }

    player.size = pSize;
    player.x = pX;

    // Ensure player rests safely on the floor if resized
    if (!player.isJumping || player.y + player.size > floorY) {
        player.y = floorY - player.size;
        player.vy = 0;
        player.isJumping = false;
        player.rotation = 0;
    }
}

function generateBgObject(startX) {
    let isPillar = Math.random() > 0.3;
    let objW = isPillar ? w * 0.04 + Math.random() * (w * 0.06) : w * 0.12 + Math.random() * (w * 0.18);
    let objH = isPillar ? h * 0.4 + Math.random() * (h * 0.45) : w * 0.1 + Math.random() * (w * 0.15);
    let objY = floorY - objH;

    // Window data for buildings
    let windows = [];
    if (isPillar) {
        let cols = Math.floor(objW / (w * 0.02));
        let rows = Math.floor(objH / (h * 0.05));
        for (let r = 1; r < rows; r++) {
            for (let c = 1; c < cols; c++) {
                if (Math.random() > 0.3) {
                    windows.push({
                        rx: c * (objW / cols),
                        ry: r * (objH / rows)
                    });
                }
            }
        }
    }

    bgObjects.push({
        x: startX,
        y: objY,
        width: objW,
        height: objH,
        isPillar: isPillar,
        windows: windows,
        antenna: isPillar && Math.random() > 0.6 ? h * 0.05 + Math.random() * (h * 0.05) : 0
    });
}

function resetGame() {
    obstacles = [];
    player.x = pX;
    player.y = floorY - player.size;
    player.vy = 0;
    player.isJumping = false;
    player.rotation = 0;
    consecutiveCeilingSpikes = 0;
    isGravityMode = false;
    gravityDirection = 1;
    nextPortalIsA = true;
    particles = [];
    shatterParticles = [];
    isDead = false;
    deathTimer = 0;
    currentThemeIndex = 0;
    themeTimer = 0;
    score = 0;
    lastOrbSpawnTime = 0;
    document.getElementById('scoreDisplay').innerText = "0";
    document.getElementById('gameOverMenu').classList.add('hidden');
    gameState = STATE.PLAYING;
    document.getElementById('pauseBtn').classList.remove('hidden');
    requestAnimationFrame((timestamp) => {
        lastTime = timestamp;
    });
}

function jump() {
    if (gameState === STATE.START) {

        // Attempt Fullscreen and Orientation lock on first interaction
        try {
            if (document.documentElement.requestFullscreen) {
                document.documentElement.requestFullscreen().then(() => {
                    if (screen.orientation && screen.orientation.lock) {
                        screen.orientation.lock('landscape').catch((err) => {
                            console.log('Orientation lock failed or unsupported:', err);
                        });
                    }
                }).catch((err) => {
                    console.log('Fullscreen request failed:', err);
                });
            }
        } catch (err) {
            console.log('Fullscreen API error:', err);
        }

        gameState = STATE.PLAYING;
        document.getElementById('pauseBtn').classList.remove('hidden');
        document.getElementById('scoreDisplay').classList.remove('hidden');
        requestAnimationFrame((timestamp) => {
            lastTime = timestamp;
        });
    } else if (gameState === STATE.GAMEOVER) {
        resetGame();
    } else if (gameState === STATE.PLAYING) {
        // Jump Orb Check (Highest priority - AABB intersection)
        let usedOrb = false;
        for (let obs of obstacles) {
            if (obs.type === TYPE.ORB && obs.active) {
                // Generous AABB: treat orb as a box and use expanded overlap zone
                let orbRadius = obs.w / 2;
                let orbLeft = obs.x + obs.w / 2 - orbRadius * 1.5;
                let orbRight = obs.x + obs.w / 2 + orbRadius * 1.5;
                let orbTop = obs.y + obs.h / 2 - orbRadius * 1.5;
                let orbBottom = obs.y + obs.h / 2 + orbRadius * 1.5;

                if (player.x < orbRight && player.x + player.size > orbLeft &&
                    player.y < orbBottom && player.y + player.size > orbTop) {
                    // HIT ORB!
                    player.vy = jumpVelocity;
                    player.isJumping = true;
                    player.rotation = Math.round(player.rotation / (Math.PI / 2)) * (Math.PI / 2);

                    // DELETE FROM MEMORY IMMEDIATELY
                    obstacles.splice(obstacles.indexOf(obs), 1);

                    usedOrb = true;

                    // Spawn yellow burst particles
                    let orbCX = obs.x + obs.w / 2;
                    let orbCY = obs.y + obs.h / 2;
                    for (let i = 0; i < 15; i++) {
                        shatterParticles.push(new ShatterParticle(orbCX, orbCY, '#ffff00'));
                    }
                    break;
                }
            }
        }

        if (usedOrb) return;

        if (isGravityMode) {
            // Instant momentum reset and flip gravity direction
            gravityDirection *= -1;
            player.vy = 0;
            player.isJumping = true;

            // Surface offset: move 2px away from the surface we just left to prevent clipping
            player.y += (gravityDirection * 2);
        } else {
            // Only standard jump if on the ground and NOT in gravity mode
            if (!player.isJumping) {
                player.vy = jumpVelocity;
                player.isJumping = true;
            }
        }
    }
}

function stopJump() {
    if (isGravityMode) return; // Gravity mode handles discrete flips, not jump cuts

    // Cut velocity if moving upwards (standard jump)
    if (player.vy < 0) {
        player.vy *= 0.5;
    }
}

let lastTime = 0;
const TARGET_FPS = 60;
const FRAME_MS = 1000 / TARGET_FPS;

function gameLoop(timestamp) {
    let deltaTime = timestamp - lastTime;
    lastTime = timestamp;

    // Cap deltaTime to avoid physics glitches on massive lag/tab suspend
    if (deltaTime > 100) deltaTime = 100;

    let timeScale = deltaTime / FRAME_MS;

    update(timeScale);
    draw();

    requestAnimationFrame(gameLoop);
}

function triggerDeath() {
    isDead = true;
    deathTimer = 1.0; // 1 second delay
    document.getElementById('pauseBtn').classList.add('hidden');

    // Spawn 25 shatter pieces
    shatterParticles = [];
    for (let i = 0; i < 25; i++) {
        shatterParticles.push(new ShatterParticle(
            player.x + player.size / 2,
            player.y + player.size / 2,
            playerColor
        ));
    }
}

function update(timeScale) {
    if (gameState !== STATE.PLAYING) return;

    if (isDead) {
        deathTimer -= (timeScale * FRAME_MS) / 1000;

        // Update shatter particles only, freeze world
        for (let p of shatterParticles) {
            p.update(timeScale);
        }

        if (deathTimer <= 0) {
            // Game Over Recap logic
            if (score > highScore) {
                highScore = Math.floor(score);
                localStorage.setItem('gdHighScore', highScore);
            }

            document.getElementById('finalScore').innerText = Math.floor(score);
            document.getElementById('bestScore').innerText = highScore;
            document.getElementById('gameOverMenu').classList.remove('hidden');
            document.getElementById('scoreDisplay').classList.add('hidden');

            gameState = STATE.GAMEOVER;
        }
        return;
    }

    // DEBUG: Monitor obstacle count
    if (Math.floor(score) % 50 === 0) {
        console.log("Obstacle Count:", obstacles.length);
    }

    // Score increment
    score += (obstacleSpeed * timeScale) / 30; // Scale score to something reasonable
    document.getElementById('scoreDisplay').innerText = Math.floor(score);
    document.getElementById('scoreDisplay').classList.remove('hidden');

    // Theme logic
    if (!isGravityMode) {
        themeTimer += (timeScale * FRAME_MS) / 1000;
        if (themeTimer >= 20 || obstaclesPassed >= 20) {
            themeTimer = 0;
            obstaclesPassed = 0;
            currentThemeIndex = (currentThemeIndex + 1) % themes.length;
        }
    }

    // Dynamic Color Shift
    bgHue = (bgHue + 0.1 * timeScale) % 360;
    document.documentElement.style.setProperty('--ui-color', `hsl(${Math.floor(bgHue)}, 80%, 60%)`);

    if (player.isJumping || isGravityMode) {
        player.vy += gravity * gravityDirection * timeScale;
        player.y += player.vy * timeScale;

        if (player.isJumping) {
            // Spin player (Faster spin during gravity flips)
            let spinSpeed = isGravityMode ? playerRotationSpeed * 1.5 : playerRotationSpeed;
            player.rotation += spinSpeed * gravityDirection * timeScale;
        }

        // Floor/Ceiling collision logic
        if (gravityDirection === 1 && player.y + player.size >= floorY) {
            player.y = floorY - player.size;
            player.vy = 0;
            player.isJumping = false;
            player.rotation = Math.round(player.rotation / (Math.PI / 2)) * (Math.PI / 2);
        } else if (isGravityMode && gravityDirection === -1 && player.y <= ceilingY) {
            player.y = ceilingY;
            player.vy = 0;
            player.isJumping = false;
            player.rotation = Math.round(player.rotation / (Math.PI / 2)) * (Math.PI / 2);
        }
    }

    // High Speed Particles inside Gravity Mode
    if (isGravityMode) {
        if (Math.random() > 0.4) {
            particles.push({
                x: w,
                y: ceilingY + Math.random() * (floorY - ceilingY),
                length: w * 0.05 + Math.random() * (w * 0.1),
                speed: w * 0.03 + Math.random() * (w * 0.015) // Extremely fast
            });
        }
    }

    for (let i = particles.length - 1; i >= 0; i--) {
        particles[i].x -= particles[i].speed * timeScale;
        if (particles[i].x + particles[i].length < 0) {
            particles.splice(i, 1);
        }
    }

    // Background parallax logic
    for (let i = 0; i < bgObjects.length; i++) {
        bgObjects[i].x -= bgSpeed * timeScale;
        if (bgObjects[i].x + bgObjects[i].width < 0) {
            // Recycle object off-screen to the right
            bgObjects.splice(i, 1);
            generateBgObject(w + Math.random() * (w * 0.5));
            i--;
        }
    }

    // Obstacle logic
    obstacleTimer -= timeScale;
    if (obstacleTimer <= 0) {
        spikesSincePortal++;

        // Portal Spawning Logic
        if (spikesSincePortal > 18 + Math.random() * 5) {
            obstacles.push({
                x: w + 50,
                type: TYPE.PORTAL,
                isPortalA: nextPortalIsA,
                isPortalB: !nextPortalIsA,
                w: spikeSize,
                h: floorY - ceilingY
            });
            spikesSincePortal = 0;
            nextPortalIsA = !nextPortalIsA;

            let minTime = (minGap * 2) / obstacleSpeed;
            obstacleTimer = minTime + Math.random() * (minTime * 1.5);
        } else {
            // Pattern Spawning Logic
            let r = Math.random();
            let numSpikes = 1;

            // Distance Guard: Only spawn if floor is clear at spawn point
            let lastObs = obstacles[obstacles.length - 1];
            if (lastObs && lastObs.x > w - spikeSize * 2) {
                // Too close to last obstacle, skip this spawn cycle
                return;
            }

            if (r < 0.4) {
                // Ground Spike Cluster
                let cluster = Math.random() > 0.7 ? 3 : (Math.random() > 0.4 ? 2 : 1);
                numSpikes = cluster;
                for (let i = 0; i < cluster; i++) {
                    obstacles.push({
                        x: w + 50 + i * spikeSize,
                        type: TYPE.SPIKE,
                        w: spikeSize,
                        h: spikeSize,
                        y: floorY
                    });
                }
            } else if (r < 0.75) {
                // Floating Platform (Block)
                let blockW = spikeSize * (2 + Math.floor(Math.random() * 3));
                let blockH = spikeSize;
                let blockY = floorY - (player.size * (2 + Math.random() * 2));
                obstacles.push({
                    x: w + 50,
                    type: TYPE.BLOCK,
                    w: blockW,
                    h: blockH,
                    y: blockY
                });
            } else if (r < 0.9) {
                // Hanging Pillar
                let pillarW = spikeSize * 1.5;
                let pillarH = h * 0.4;
                obstacles.push({
                    x: w + 50,
                    type: TYPE.HANGING,
                    w: pillarW,
                    h: pillarH,
                    y: 0
                });
            } else {
                // ORB PIT COMBO: Wide spike bed + floating orb
                // Cooldown: Only spawn one every 2 seconds
                if (Date.now() - lastOrbSpawnTime < 2000) return;

                let pitSpikes = 4;
                numSpikes = pitSpikes;
                let pitStartX = w + 50;
                for (let i = 0; i < pitSpikes; i++) {
                    obstacles.push({
                        x: pitStartX + i * spikeSize,
                        type: TYPE.SPIKE,
                        w: spikeSize,
                        h: spikeSize,
                        y: floorY
                    });
                }
                // Orb floats above the midpoint of the pit
                let orbX = pitStartX + (pitSpikes * spikeSize) / 2 - spikeSize * 0.4;
                let orbY = floorY - (player.size * 3.5);
                obstacles.push({
                    x: orbX,
                    type: TYPE.ORB,
                    w: spikeSize * 0.8,
                    h: spikeSize * 0.8,
                    y: orbY,
                    active: true,
                    pulseTimer: 0
                });
                lastOrbSpawnTime = Date.now();
            }

            // Calculate frames needed for gap
            let minTime = minGap / obstacleSpeed;
            let clusterWait = (numSpikes - 1) * (spikeSize / obstacleSpeed);
            if (isGravityMode) {
                minTime *= 0.6;
                clusterWait *= 0.6;
            }
            obstacleTimer = minTime + clusterWait + Math.random() * (minTime * 1.2);
            obstaclesPassed += 1;
        }
    }

    // Move obstacles and check collisions
    obstacles.forEach(obs => {
        obs.x -= obstacleSpeed * timeScale;
    });

    // Clean up: Remove off-screen and inactive obstacles
    obstacles = obstacles.filter(obs => (obs.x + (obs.w || spikeSize) > -100) && (obs.active !== false));

    for (let i = obstacles.length - 1; i >= 0; i--) {
        let obs = obstacles[i];

        // Advanced Collision Detection
        let hit = false;

        if (obs.type === TYPE.SPIKE) {
            let hitX = obs.x + obs.w * 0.25;
            let hitW = obs.w * 0.5;
            let hitY = obs.y - obs.h;
            let hitH = obs.h;
            if (player.x < hitX + hitW && player.x + player.size > hitX &&
                player.y < hitY + hitH && player.y + player.size > hitY) {
                hit = true;
            }
        } else if (obs.type === TYPE.BLOCK) {
            // Solid Block Logic
            if (player.x < obs.x + obs.w && player.x + player.size > obs.x &&
                player.y < obs.y + obs.h && player.y + player.size > obs.y) {

                // Check if landing on top (with buffer)
                let isFalling = (gravityDirection === 1 && player.vy >= 0) || (gravityDirection === -1 && player.vy <= 0);
                let surfaceY = gravityDirection === 1 ? obs.y : obs.y + obs.h;
                let playerFootY = gravityDirection === 1 ? player.y + player.size : player.y;

                let distToSurface = Math.abs(playerFootY - surfaceY);

                if (isFalling && distToSurface < 20) {
                    player.y = gravityDirection === 1 ? obs.y - player.size : obs.y + obs.h;
                    player.vy = 0;
                    player.isJumping = false;
                    player.rotation = Math.round(player.rotation / (Math.PI / 2)) * (Math.PI / 2);
                } else {
                    hit = true;
                }
            }
        } else if (obs.type === TYPE.HANGING) {
            // Entire pillar plus the hanging spikes is a hazard
            let hazardHeight = obs.h + spikeSize / 2;
            if (player.x < obs.x + obs.w && player.x + player.size > obs.x &&
                player.y < obs.y + hazardHeight && player.y + player.size > obs.y) {
                hit = true;
            }
        } else if (obs.type === TYPE.PORTAL) {
            if (player.x < obs.x + obs.w && player.x + player.size > obs.x &&
                player.y < ceilingY + obs.h && player.y + player.size > ceilingY) {
                if (obs.isPortalA) {
                    isGravityMode = true;
                    obstacles.splice(i, 1);
                } else if (obs.isPortalB) {
                    isGravityMode = false;
                    gravityDirection = 1;
                    player.isJumping = true; // Force physics update
                    player.vy = 2; // Downward kick to prevent floating
                    obstacles.splice(i, 1);
                    particles = [];
                }
            }
        }

        if (hit && !isDead) {
            triggerDeath();
        }
    }
}

function draw() {
    // Total reset for every frame
    ctx.clearRect(0, 0, w, h);
    ctx.beginPath();
    ctx.shadowBlur = 0;
    ctx.shadowColor = "transparent";
    ctx.globalAlpha = 1.0;

    // Dynamic HSL fill for background
    ctx.fillStyle = isGravityMode ? '#330000' : `hsl(${Math.floor(bgHue)}, 60%, 20%)`;
    ctx.fillRect(0, 0, w, h);

    // Render parallax background objects based on theme
    const theme = themes[currentThemeIndex];

    for (let obj of bgObjects) {
        ctx.fillStyle = theme.buildingColor;
        ctx.fillRect(obj.x, obj.y, obj.width, obj.height);

        if (theme.style === 'city' || theme.style === 'industrial') {
            // Draw windows
            ctx.fillStyle = theme.windowColor;
            for (let win of obj.windows) {
                ctx.fillRect(obj.x + win.rx, obj.y + win.ry, 4, 4);
            }

            // Draw industrial antennas
            if (theme.style === 'industrial' && obj.antenna > 0) {
                ctx.strokeStyle = theme.buildingColor;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(obj.x + obj.width / 2, obj.y);
                ctx.lineTo(obj.x + obj.width / 2, obj.y - obj.antenna);
                ctx.stroke();
            }
        } else if (theme.style === 'cyber') {
            // Draw grid lines on buildings
            ctx.strokeStyle = 'rgba(0, 255, 0, 0.1)';
            ctx.lineWidth = 1;
            for (let xOffset = 0; xOffset < obj.width; xOffset += 15) {
                ctx.beginPath();
                ctx.moveTo(obj.x + xOffset, obj.y);
                ctx.lineTo(obj.x + xOffset, obj.y + obj.height);
                ctx.stroke();
            }
        }
    }

    // Render intense streaming particles 
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let p of particles) {
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x + p.length, p.y);
    }
    ctx.stroke();

    // Render floor & ceiling lines (neon cyan)
    ctx.strokeStyle = '#00ffff';
    ctx.lineWidth = 4;
    ctx.shadowBlur = 15;
    ctx.shadowColor = '#00ffff';

    ctx.beginPath();
    ctx.moveTo(0, floorY);
    ctx.lineTo(w, floorY);
    if (isGravityMode) {
        ctx.moveTo(0, ceilingY);
        ctx.lineTo(w, ceilingY);
    }
    ctx.stroke();

    // Render spikes and structures
    ctx.shadowBlur = 15;

    for (let obs of obstacles) {
        ctx.save();

        // Calculate dynamic opacity based on screen position
        let alpha = 1.0;
        const fadeMargin = 150;
        if (obs.x > w - fadeMargin) {
            alpha = Math.max(0, (w - obs.x) / fadeMargin);
        } else if (obs.x < fadeMargin) {
            alpha = Math.max(0, (obs.x + (obs.w || spikeSize)) / fadeMargin);
        }
        ctx.globalAlpha = alpha;

        ctx.beginPath();
        if (obs.type === TYPE.PORTAL) {
            ctx.save();
            ctx.shadowBlur = 0;
            ctx.shadowColor = "transparent";

            let color = obs.isPortalA ? '#00ff00' : '#0000ff';
            let pulse = Math.sin(Date.now() / 150) * 3;
            let portalW = obs.w / 2 + pulse;
            let portalH = obs.h / 2 + pulse;
            let centerX = obs.x + obs.w / 2;
            let centerY = ceilingY + obs.h / 2;

            // Layer 1: Dark Core (Void)
            ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
            ctx.beginPath();
            ctx.ellipse(centerX, centerY, portalW, portalH, 0, 0, Math.PI * 2);
            ctx.fill();

            // Layer 2: Inner Ring
            ctx.strokeStyle = color;
            ctx.lineWidth = 4 + (pulse / 2);
            ctx.beginPath();
            ctx.ellipse(centerX, centerY, portalW * 0.9, portalH * 0.9, 0, 0, Math.PI * 2);
            ctx.stroke();

            // Layer 3: Outer Glow
            ctx.strokeStyle = color;
            ctx.globalAlpha = 0.4;
            ctx.lineWidth = 8 + pulse;
            ctx.shadowBlur = 25;
            ctx.shadowColor = color;
            ctx.beginPath();
            ctx.ellipse(centerX, centerY, portalW * 1.1, portalH * 1.1, 0, 0, Math.PI * 2);
            ctx.stroke();

            ctx.shadowBlur = 0;
            ctx.shadowColor = "transparent";
            ctx.restore();
        } else if (obs.type === TYPE.SPIKE) {
            ctx.fillStyle = '#ff0000';
            ctx.shadowColor = '#ff0000';
            ctx.moveTo(obs.x, obs.y);
            ctx.lineTo(obs.x + obs.w, obs.y);
            ctx.lineTo(obs.x + obs.w / 2, obs.y - obs.h);
            ctx.fill();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            ctx.stroke();
        } else if (obs.type === TYPE.BLOCK) {
            ctx.fillStyle = 'rgba(20, 20, 40, 0.9)';
            ctx.strokeStyle = '#00ffff';
            ctx.lineWidth = 3;
            ctx.shadowColor = '#00ffff';
            ctx.fillRect(obs.x, obs.y, obs.w, obs.h);
            ctx.strokeRect(obs.x, obs.y, obs.w, obs.h);
        } else if (obs.type === TYPE.HANGING) {
            ctx.fillStyle = 'rgba(20, 20, 40, 0.9)';
            ctx.strokeStyle = '#ff00ff';
            ctx.lineWidth = 3;
            ctx.shadowColor = '#ff00ff';
            ctx.fillRect(obs.x, obs.y, obs.w, obs.h);
            ctx.strokeRect(obs.x, obs.y, obs.w, obs.h);

            // Hanging spikes
            ctx.fillStyle = '#ff00ff';
            ctx.beginPath();
            ctx.moveTo(obs.x, obs.y + obs.h);
            ctx.lineTo(obs.x + obs.w, obs.y + obs.h);
            ctx.lineTo(obs.x + obs.w / 2, obs.y + obs.h + spikeSize / 2);
            ctx.fill();
        } else if (obs.type === TYPE.ORB) {
            if (obs.active) {
                ctx.save();
                ctx.shadowBlur = 0;
                ctx.shadowColor = "transparent";

                // Pulse effect
                let pulse = Math.sin(Date.now() / 150) * 2;
                let orbX = obs.x + obs.w / 2;
                let orbY = obs.y + obs.h / 2;
                let radius = (obs.w / 2) + pulse;

                ctx.lineWidth = 6 + (pulse / 2);
                ctx.strokeStyle = '#ffff00';
                ctx.shadowColor = '#ffff00';
                ctx.shadowBlur = 15;

                ctx.beginPath();
                ctx.arc(orbX, orbY, radius, 0, Math.PI * 2);
                ctx.stroke();

                // Subtle inner glow
                ctx.globalAlpha = 0.5;
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(orbX, orbY, radius * 0.7, 0, Math.PI * 2);
                ctx.stroke();

                ctx.shadowBlur = 0;
                ctx.shadowColor = "transparent";
                ctx.restore();
            }
        }
        ctx.restore();
    }

    // Render player (neon magenta cube) resting against current gravity boundary
    if (!isDead) {
        ctx.fillStyle = playerColor;
        ctx.shadowColor = playerColor;
        ctx.shadowBlur = 20;

        ctx.save();
        ctx.translate(player.x + player.size / 2, player.y + player.size / 2);
        ctx.rotate(player.rotation);
        ctx.fillRect(-player.size / 2, -player.size / 2, player.size, player.size);
        ctx.restore();
    }

    // Render shattered pieces if dead
    for (let p of shatterParticles) {
        p.draw(ctx);
    }

    // Reset shadow to avoid trailing issues on next frame clear
    ctx.shadowBlur = 0;

    if (gameState === STATE.START) {
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold ' + (h * 0.08) + 'px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('НАТИСНИ И ЗАПОЧНИ', w / 2, h / 2);
    }
}

init();
