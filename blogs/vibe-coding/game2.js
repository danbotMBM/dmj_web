const canvas = document.createElement("canvas");
const ctx = canvas.getContext("2d");
document.body.appendChild(canvas);
canvas.width = 480;
canvas.height = 640;

let bird = { x: 50, y: 150, width: 20, height: 20, gravity: 0.4, lift: -10, velocity: 0 };
let pipes = [];
let frame = 0;
let gameOver = false;
let score = 0;

document.addEventListener("keydown", () => { bird.velocity = bird.lift; });

function update() {
    if (gameOver) return;

    bird.velocity += bird.gravity;
    bird.y += bird.velocity;

    if (bird.y + bird.height >= canvas.height || bird.y <= 0) {
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
            gameOver = true;
        }
        if (!pipe.passed && pipe.x + pipe.width < bird.x) {
            pipe.passed = true;
            score += 0.5; // each pair of pipes counts as 1 point
        }
    });

    frame++;
    requestAnimationFrame(draw);
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
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
    } else {
        update();
    }
}

draw();
