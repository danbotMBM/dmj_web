const canvas = document.createElement("canvas");
const ctx = canvas.getContext("2d");
document.body.appendChild(canvas);
canvas.width = 480;
canvas.height = 640;

let bird, pipes, frame, gameOver, score;
let gameStarted = false;

const FPS = 60;
const FRAME_INTERVAL = 1000 / FPS;
let lastTime = 0;

// Sound effects
const flapSound = new Audio("https://actions.google.com/sounds/v1/cartoon/wood_plank_flicks.ogg");
const pointSound = new Audio("https://actions.google.com/sounds/v1/cartoon/pop.ogg");
const hitSound = new Audio("https://freesound.org/data/previews/256/256113_3263906-lq.mp3");

function resetGame() {
    bird = { x: 50, y: 150, width: 20, height: 20, gravity: 0.27, lift: -5.6, velocity: 0 };
    pipes = [];
    frame = 0;
    gameOver = false;
    score = 0;
    lastTime = 0;
    gameStarted = true;
}

function update() {
    bird.velocity += bird.gravity;
    bird.y += bird.velocity;

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

    if (!gameStarted) {
        ctx.fillStyle = "black";
        ctx.font = "30px Arial";
        ctx.fillText("Press Space to Start", canvas.width / 4 - 20, canvas.height / 2);
        return;
    }

    ctx.fillStyle = "blue";
    ctx.fillRect(bird.x, bird.y, bird.width, bird.height);

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

// Controls

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

requestAnimationFrame(gameLoop);
