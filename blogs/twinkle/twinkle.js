import { get_color_from_kelvin } from "./src/color_scale.js";
import { normalized_arctan } from "./src/brightness.js";
import { normalize, unflatten, minmax } from "./src/utils.js";
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

function circle_centers(width, height, num){
    var y = height / 2;
    const radius = width / (num*2);
    var r = [[radius, y]];
    for (let i = 1; i < num; i++){
        r.push([2*i*radius + radius, y]);
    }
    return r
}

function draw_lights(kelvins){
    var width = canvas.width;
    var height = canvas.height;
    const num = kelvins.length;
    var offset = 0;
    if (num <= 5){
        width = width / 2;
        offset = width / 2;
    }
    var radius = width / (num*2);
    if (radius*2 > height){
        radius = height/2;
    }
    const centers= circle_centers(width, height, num);
    for(let i=0; i < num; i++){
        let k = kelvins[i]
        let x = centers[i][0] + offset
        let y = centers[i][1]
        draw_light(x, y, radius, k)
    }
}

function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!active_lights){
        draw_lights([Number(kelvin_slider.value)]);
    }else{
        draw_lights(active_lights);
    }
    requestAnimationFrame(animate);
}

function resize_canvas(){
    var width = window.innerWidth;
    var height = window.innerHeight * 0.4;
    canvas.width = width;
    canvas.height = height;
}

function twinkle_file_event(event){
    read_twinkle_file(event.target.files[0]);
}

function read_twinkle_text(twinkle_text){
    const text = twinkle_text;
    const lines = text.split("\n");
    const processedData = lines.map(line => {
                return line.trim().split(/\s+/).map(token => {
                    return isNaN(token) ? token : parseFloat(token, 10); // Convert numbers, keep text
                });
            });
    num_lights = parseInt(processedData[0][0])
    num_lines = parseInt(processedData[0][1])
    var matrix = processedData.slice(1)
    simulation_timestamps = matrix.map(row => row[0])
    simulation = matrix.map(row => row.slice(1))
    // simulation = scale_simulation(simulation, 0, 3000);
}

function read_twinkle_file(file){
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        read_twinkle_text(e.target.result)
    };
    reader.readAsText(file);
}

function tick(){
    if (simulation){
        simulation_index += 1;
        if (simulation_index >= simulation.length){
            simulation_index = 0;
        }
        console.log(simulation_index, simulation.length)
        active_lights = simulation[simulation_index];
    }
}

function scale_simulation(simulation, expected_min, expected_max){
    let len = simulation[0].length
    let flat = simulation.flat()
    let {min, max} = minmax(flat)
    let norm = flat.map(v => normalize(v, min, max)) 
    let scaled_norm = norm.map(v => (expected_max - expected_min) * v + expected_min) 
    return unflatten(scaled_norm, len);
}


var num_lights = 1;
var num_lines = 0;
var simulation = null;
var simulation_timestamps = null;
var active_lights = null;
var simulation_index = 0;
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const kelvin_slider = document.getElementById("kelvin_slider");
resize_canvas();
window.addEventListener("resize", resize_canvas);
requestAnimationFrame(animate);
document.getElementById("file_input").addEventListener('change', twinkle_file_event)
setInterval(tick, 10);
fetch("/blogs/twinkle/out26.txt").then(response => {
    if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }
        return response.text();
    })
    .then(data => {
        read_twinkle_text(data) 
    }).catch(error => {
        console.error('Error fetching file:', error);
    });