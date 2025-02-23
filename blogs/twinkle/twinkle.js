import { get_color_from_kelvin } from "./src/color_scale.js";
import { normalized_arctan } from "./src/brightness.js";
import { Color } from "./src/color.js";

const MID_BRIGHTNESS = 2000;
const QUARTER_BRIGHTNESS = 1500;

function draw_circle(ctx, x, y, radius, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, 2 * Math.PI);
    ctx.fill();
}

function draw_light(x, y, max_radius, kelvin){
    const color = get_color_from_kelvin(kelvin);
    const brightness_scale = normalized_arctan(kelvin, MID_BRIGHTNESS, QUARTER_BRIGHTNESS);
    draw_circle(ctx, x, y, max_radius * brightness_scale, color.get_css());
}

function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    draw_light(250, 250, 50, Number(kelvin_slider.value));
    requestAnimationFrame(animate);
}

const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const kelvin_slider = document.getElementById("kelvin_slider");
requestAnimationFrame(animate);
