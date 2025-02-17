import { get_color_from_kelvin } from "./src/color_scale.js";
import { Color } from "./src/color.js";

function draw_circle(ctx, x, y, radius, color){
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, 2*Math.PI);
    ctx.fill();
}

function animate(){
    ctx.clearRect(0,0,canvas.width, canvas.height);
    var kelvin = Number(kelvin_slider.value);
    var color = get_color_from_kelvin(kelvin);
    draw_circle(ctx, 250, 250, 50, color.get_css());
    requestAnimationFrame(animate);
}

const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const kelvin_slider = document.getElementById("kelvin_slider");
requestAnimationFrame(animate);

console.log("imported");
