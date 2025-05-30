import { get_color_from_kelvin } from "./src/color_scale.js";
import { normalized_arctan } from "./src/brightness.js";
import { normalize, unflatten, minmax, binary_search_floor} from "./src/utils.js";
import { Color } from "./src/color.js";

const MID_BRIGHTNESS = 2000;
const QUARTER_BRIGHTNESS = 1500;
const MIN_RADIUS = 25;

function draw_circle(ctx, x, y, radius, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, 2 * Math.PI);
    ctx.fill();
}

function draw_light(ctx, x, y, max_radius, kelvin){
    const color = get_color_from_kelvin(kelvin);
    const brightness_scale = normalized_arctan(kelvin, MID_BRIGHTNESS, QUARTER_BRIGHTNESS);
    draw_circle(ctx, x, y, max_radius * brightness_scale, color.get_css());
}

function circle_centers(radius, width, height, num){
    if (radius * num * 2 > width){
        const num_rows = Math.ceil(radius*num*2 / width);
        const num_cols = Math.ceil(num / num_rows);
        if(num_rows*num_cols < num){
            throw issue
        }
        var r = [];
        var offset = (width - num_cols * 2 * radius) / 2;
        for (let i = 0; i < num_rows; i++){
            for (let j = 0; j < num_cols; j++){
                r.push([2*j*radius + radius + offset, 2*i*radius + radius]);
            }
        }
    }else{
        var y = height / 2;
        var offset = (width - num * 2 * radius) / 2;
        var r = [[radius + offset, y]];
        for (let i = 1; i < num; i++){
            r.push([2*i*radius + radius, y]);
        }
    }
    return r
}

function draw_lights(canvas, ctx, radius, kelvins){
    var width = canvas.width;
    var height = canvas.height;
    const num = kelvins.length;
    const centers= circle_centers(radius, width, height, num);
    for(let i=0; i < num; i++){
        let k = kelvins[i]
        let x = centers[i][0]
        let y = centers[i][1]
        draw_light(ctx, x, y, radius, k)
    }
}

function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function resize_canvas(canvas, width_percent, height_percent){
    var width = window.innerWidth * width_percent;
    var height = window.innerHeight * height_percent;
    canvas.width = width;
    canvas.height = height;
}

function resize_canvas_parent(canvas, width_percent, height_percent){
    const parent = canvas.parentElement;
    var width = parent.clientWidth * width_percent;
    var height = width * height_percent;
    if (height < MIN_HEIGHT){
        height = MIN_HEIGHT;
    }
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
    var num_lights = parseInt(processedData[0][0])
    var num_lines = parseInt(processedData[0][1])
    var matrix = processedData.slice(1)
    var simulation_timestamps = matrix.map(row => row[0])
    var simulation = matrix.map(row => row.slice(1))
    return [simulation, simulation_timestamps]
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

var sims =[]

class sim{
    constructor(div, path_to_sim){
        this.div = div;
        this.path_to_sim = path_to_sim;
        this.canvas = document.createElement('canvas')
        this.ctx = this.canvas.getContext('2d')
        //loading logic
        this.loaded = false;
        this.increment = 40
        this.brightness = 0
        this.active_lights = []
        this.div.appendChild(this.canvas)
        requestAnimationFrame(()=>{this.render()});
        fetch(this.path_to_sim).then(response => {
            if (!response.ok) {
                    throw new Error(`HTTP error! Status: ${response.status}`);
                }
                return response.text();
            })
            .then(data => {
                [this.simulation, this.simulation_timestamps] = read_twinkle_text(data) 
                this.simulation_time = 0.0
                this.simulation_end = this.simulation_timestamps[this.simulation_timestamps.length - 1]
                this.loaded = true
            }).catch(error => {
                console.error('Error fetching file:', error);
            });
    }

    radius(width){
        var num = 1;
        if(this.loaded){
            num = this.simulation[0].length;
        }
        var radius = width / (num*2);
        var new_radius = radius;

        if(window.innerWidth < 500){
            // dynamic min radius is 1/7 of inner width
            if (radius < width / 8 / 2){
                new_radius = width / 8 / 2;
            }
        }else{
            // static min radius
            if (radius < MIN_RADIUS){
                new_radius = MIN_RADIUS;
            }
        }

        // Max radius is 1/2 inner height
        if(radius * 2 > window.innerHeight/2){
            new_radius = window.innerHeight / 2 / 2;
        }
        console.log("radius", radius, "new radius", new_radius, "width", width)

        return new_radius;
    }

    resize(){
        const parent = this.canvas.parentElement;
        var width = parent.clientWidth;
        var num_lights = 1;
        if (this.loaded){
            num_lights = this.simulation[0].length;
        }
        var radius = this.radius(width);
        var num_rows = this.num_rows(width, num_lights, radius);
        var height = radius * 2 * num_rows;

        this.canvas.width = width;
        this.canvas.height = height;
    }

    num_rows(width, num, radius){
        return Math.ceil(radius*num*2 / width);
    }

    lights_on_now(){
        if(this.loaded){
            const index = binary_search_floor(this.simulation_timestamps, this.simulation_time);
            if (index >= this.simulation.length){
                this.simulation_time = 0;
                index = 0;
                console.log("cycled")
            }
            return this.simulation[index]
        }
    }

    render(){
        this.resize();
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        if (this.loaded){
            draw_lights(this.canvas, this.ctx, this.radius(this.canvas.width), this.lights_on_now());
        }else{
            draw_lights(this.canvas, this.ctx, this.radius(this.canvas.width), [this.brightness]);
        }
        requestAnimationFrame(()=>{this.render()});
    }

    tick(){
        if (this.loaded){
            this.simulation_time += 0.01;
            if (this.simulation_time >= this.simulation_end){
                this.simulation_time = 0;
            }
        } else {
            this.brightness += this.increment
            if (this.brightness >= MID_BRIGHTNESS*2 || this.brightness <= 0){
                this.increment *= -1
            }
        }
    }
}

function tick_sims(sims) {
    sims.forEach(element => {
       element.tick() 
    });
}

export function add_sim(div_name, sim_path){
    var div1 = document.getElementById(div_name)
    var sim1 = new sim(div1, sim_path)
    sims.push(sim1)
};


setInterval(() => {tick_sims(sims)}, 10);


// var num_lights = 1;
// var num_lines = 0;
// var simulation = null;
// var simulation_timestamps = null;
// var active_lights = null;
// var simulation_index = 0;
// const canvas = document.getElementById("canvas");
// const ctx = canvas.getContext("2d");
// const kelvin_slider = document.getElementById("kelvin_slider");
// resize_canvas();
// window.addEventListener("resize", resize_canvas);
// requestAnimationFrame(animate);
// document.getElementById("file_input").addEventListener('change', twinkle_file_event)
// fetch("/blogs/twinkle/out26.txt").then(response => {
//     if (!response.ok) {
//             throw new Error(`HTTP error! Status: ${response.status}`);
//         }
//         return response.text();
//     })
//     .then(data => {
//         read_twinkle_text(data) 
//     }).catch(error => {
//         console.error('Error fetching file:', error);
//     });
