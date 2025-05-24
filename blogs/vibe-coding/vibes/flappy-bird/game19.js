const canvas = document.createElement("canvas");
const ctx = canvas.getContext("2d");
document.body.appendChild(canvas);
canvas.width = 480;
canvas.height = 640;

// Disable double-tap zoom on Safari/iOS
canvas.style.touchAction = "manipulation";
canvas.style.webkitTouchCallout = "none";
canvas.style.webkitUserSelect = "none";
canvas.style.userSelect = "none";

let bird, pipes, clouds, dragons, frame, gameOver, score;
let gameStarted = false;

const FPS = 60;
const FRAME_INTERVAL = 1000 / FPS;
let lastTime = 0;

// Load penguin sprite
const penguinImage = new Image();
penguinImage.src = "penguin1.jpeg";

// Load dragon animated gif
const dragonGif = document.createElement("img");
dragonGif.src = "dragon1.gif";
dragonGif.style.position = "absolute";
dragonGif.style.width = "64px";
dragonGif.style.height = "64px";
dragonGif.style.pointerEvents = "none";
dragonGif.style.display = "none";
dragonGif.style.zIndex = "0";
document.body.appendChild(dragonGif);

// Sound effects (preloaded)
const flapSound = new Audio("flap.mp3");
const pointSound = new Audio("point.mp3");
const hitSound = new Audio("game-over.mp3");

flapSound.preload = "auto";
pointSound.preload = "auto";
hitSound.preload = "auto";

function createClouds() {
    clouds = [];
    for (let i = 0; i < 5; i++) {
        clouds.push({
            x: Math.random() * canvas.width,
            y: Math.random() * canvas.height / 2,
            width: 40 + Math.random() * 30,
            height: 20 + Math.random() * 10,
            speed: 0.5 + Math.random()
        });
    }
    dragons = [];
}

function maybeSpawnDragon() {
    if (Math.floor(score) % 10 === 0 && Math.floor(score) !== 0 && !dragons.some(d => d.activeScore === Math.floor(score))) {
        if (Math.random() < 0.05) {
            dragons.push({
                x: canvas.width,
                y: 50 + Math.random() * 100,
                speed: 0.75 + Math.random() * 0.5,
                width: 64,
                height: 64,
                activeScore: Math.floor(score)
            });
        }
    }
}

function resetGame() {
    bird = { x: 50, y: 150, width: 30, height: 30, gravity: 0.27, lift: -5.6, velocity: 0 };
    pipes = [];
    createClouds();
    frame = 0;
    gameOver = false;
    score = 0;
    lastTime = 0;
    gameStarted = true;
}

function update() {
    bird.velocity += bird.gravity;
    bird.y += bird.velocity;

    clouds.forEach(cloud => {
        cloud.x -= cloud.speed;
        if (cloud.x + cloud.width < 0) {
            cloud.x = canvas.width;
            cloud.y = Math.random() * canvas.height / 2;
        }
    });

    dragons.forEach(dragon => {
        dragon.x -= dragon.speed;
    });
    dragons = dragons.filter(dragon => dragon.x + dragon.width > 0);

    maybeSpawnDragon();

    if (bird.y + bird.height >= canvas.height || bird.y <= 0) {
        if (!gameOver) hitSound.play();
        gameOver = true;
    }

    if (frame % 100 === 0) {
        let pipeHeight = Math.random() * (canvas.height / 2);
        pipes.push({ x: canvas.width, y: 0, width: 40, height: pipeHeight, passed: false });
        pipes.push({ x: canvas.width, y: pipeHeight + 100, width: 40, height: canvas.height - pipeHeight - 100, passed: false });
    }

    pipes.forEach(pipe => pipe.x -= 2);
    pipes = pipes.filter(pipe => pipe.x + pipe.width > 0);

    pipes.forEach(pipe => {
        if (
            bird.x < pipe.x + pipe.width &&
            bird.x + bird.width > pipe.x &&
            bird.y < pipe.y + pipe.height &&
            bird.y + bird.height > pipe.y
        ) {
            if (!gameOver) hitSound.play();
            gameOver = true;
        }
        if (!pipe.passed && pipe.x + pipe.width < bird.x) {
            pipe.passed = true;
            score += 0.5;
            pointSound.play();
        }
    });

    frame++;
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = "#b3e0ff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = "#f8c8dc";
    clouds.forEach(cloud => {
        ctx.beginPath();
        ctx.ellipse(cloud.x, cloud.y, cloud.width / 2, cloud.height / 2, 0, 0, Math.PI * 2);
        ctx.fill();
    });

    // Draw dragons behind pipes
    if (dragons.length > 0) {
        const d = dragons[0];
        dragonGif.style.left = d.x + "px";
        dragonGif.style.top = d.y + "px";
        dragonGif.style.display = "block";
    } else {
        dragonGif.style.display = "none";
    }

    if (!gameStarted) {
        ctx.fillStyle = "black";
        ctx.font = "30px Arial";
        ctx.fillText("Press Space to Start", canvas.width / 4 - 20, canvas.height / 2);
        return;
    }

    if (penguinImage.complete) {
        ctx.drawImage(penguinImage, bird.x, bird.y, bird.width, bird.height);
    } else {
        ctx.fillStyle = "blue";
        ctx.fillRect(bird.x, bird.y, bird.width, bird.height);
    }

    ctx.fillStyle = "green";
    pipes.forEach(pipe => ctx.fillRect(pipe.x, pipe.y, pipe.width, pipe.height));

    ctx.fillStyle = "black";
    ctx.font = "20px Arial";
    ctx.fillText("Score: " + Math.floor(score), 10, 30);

    if (gameOver) {
        ctx.fillStyle = "red";
        ctx.font = "30px Arial";
        ctx.fillText("Game Over", canvas.width / 4, canvas.height / 2);
        ctx.font = "20px Arial";
        ctx.fillText("Press Space to Restart", canvas.width / 4 - 10, canvas.height / 2 + 40);
    }
}

function gameLoop(timestamp) {
    if (!lastTime) lastTime = timestamp;
    const delta = timestamp - lastTime;

    if (gameStarted && !gameOver && delta >= FRAME_INTERVAL) {
        update();
        draw();
        lastTime = timestamp;
    } else {
        draw();
    }

    requestAnimationFrame(gameLoop);
}

document.addEventListener("keydown", (e) => {
    if (e.code === "Space") {
        if (!gameStarted || gameOver) {
            resetGame();
        } else {
            bird.velocity = bird.lift;
            flapSound.play();
        }
    }
});

createClouds();

// Touch support for mobile
document.addEventListener("touchstart", (e) => {
    const touch = e.touches[0];
    const rect = canvas.getBoundingClientRect();
    const x = touch.clientX - rect.left;
    const y = touch.clientY - rect.top;

    if (x >= 0 && x <= canvas.width && y >= 0 && y <= canvas.height) {
        if (!gameStarted || gameOver) {
            resetGame();
        } else {
            bird.velocity = bird.lift;
            flapSound.play();
        }
    }
}, { passive: true });

requestAnimationFrame(gameLoop);
