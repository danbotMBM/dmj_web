function showErrorMessage(message){
    var errorDiv = document.getElementById("error_message");
    errorDiv.innerHTML = message
}

const canvas = document.querySelector("canvas");
if (!navigator.gpu) {
    const noWebGPUError = `
    <h2 class="text-center" id="title">Error Starting WebGPU:</h1>
    <p>This page is a demo for the WebGPU API which aims to be 
    a superior alternative to the WebGL graphics API. You are 
    seeing this error message because your browser either does 
    not support or does not allow the WebGPU API to access your graphics processor.
    Google Chrome and most other Chromium-based browsers support it by default. Many
    browsers can enable WebGPU with an experimental setting/flag.
    For guidance, visit <a href="https://caniuse.com/webgpu">caniuse.com</a>.
    `
    showErrorMessage(noWebGPUError)
    throw new Error("WebGPU not supported on this browser.");
}
const noAdapterError = `
<h2 class="text-center" id="title">Error Fetching GPU Adapter:</h1>
<p>This page is a demo for the WebGPU API which aims to be 
a superior alternative to the WebGL graphics API. You are 
seeing this error message because your browser supports the WebGPU graphics API but was not able to
access the graphics processor of your device. Consider using another browser or a device with
a dedicated graphics processor. 
For guidance, visit <a href="https://caniuse.com/webgpu">caniuse.com</a>.
`
var adapter = null;
try {
    // check requestAdapter docs to see how to choose which gpu adapter to use
    adapter = await navigator.gpu.requestAdapter();
} catch (error){
    showErrorMessage(noAdapterError)
}
if (!adapter) {
    showErrorMessage(noAdapterError)
    throw new Error("No appropriate GPUAdapter found.");
}
var device = null;
try {
    // check requestDevice documentation 
    device = await adapter.requestDevice();
} catch (error){
    showErrorMessage(noAdapterError)
}
canvas.width = 512;
canvas.height = 512;
if (window.innerWidth > 1200 && window.innerHeight > 1200){
    canvas.width = 1024;
    canvas.height = 1024;
}
if (window.innerWidth > 2400 && window.innerHeight > 2400){
    canvas.width = 2048;
    canvas.height = 2048;
}
if (window.innerWidth < 600 || window.innerHeight < 600){
    canvas.width = 256;
    canvas.height = 256;
}
console.log(window.innerWidth, window.innerHeight);
const context = canvas.getContext("webgpu");
const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
// device is the gpu; format is the texture memory format
context.configure({
    device: device,
    format: canvasFormat,
});

const WORKGROUP_SIZE = 8; // compute shader workgroup size
const GRID_SIZE = canvas.width/16;



let step = 0; // Track how many simulation steps have been run

//consider using index buffers to not have to convert manually into triangles
const vertices = new Float32Array([
    //   X,    Y,
    -0.8, -0.8, // Triangle 1 (Blue)
    0.8, -0.8,
    0.8, 0.8,

    -0.8, -0.8, // Triangle 2 (Red)
    0.8, 0.8,
    -0.8, 0.8,
]);

// allocate a special gpu buffer
const vertexBuffer = device.createBuffer({
    label: "Cell vertices",
    size: vertices.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
});

// write to buffer
device.queue.writeBuffer(vertexBuffer, /*bufferOffset=*/0, vertices);

const vertexBufferLayout = {
    arrayStride: 8,
    attributes: [{
        format: "float32x2",
        offset: 0,
        shaderLocation: 0, // Position, see vertex shader
    }],
};

// Create the bind group layout and pipeline layout.
const bindGroupLayout = device.createBindGroupLayout({
    label: "Cell Bind Group Layout",
    entries: [{
        binding: 0,
        // Add GPUShaderStage.FRAGMENT here if you are using the `grid` uniform in the fragment shader.
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.COMPUTE | GPUShaderStage.FRAGMENT,
        buffer: {} // Grid uniform buffer
    }, {
        binding: 1,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.COMPUTE,
        buffer: { type: "read-only-storage" } // Cell state input buffer
    }, {
        binding: 2,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "storage" } // Cell state output buffer
    }]
});



const pipelineLayout = device.createPipelineLayout({
    label: "Cell Pipeline Layout",
    bindGroupLayouts: [bindGroupLayout],
});

const cellShaderModule = device.createShaderModule({
    label: "Cell shader",
    code: `
        struct VertexInput {
            @location(0) pos: vec2f,
            @builtin(instance_index) instance: u32,
        };

        struct VertexOutput {
            @builtin(position) pos: vec4f,
            @location(0) cell: vec2f,
        };

        @group(0) @binding(0) var<uniform> grid: vec2f;
        @group(0) @binding(1) var<storage> cellState: array<u32>;
        

        @vertex
        fn vertexMain(input: VertexInput) -> VertexOutput  {
            let i = f32(input.instance);
            let cell = vec2f(i % grid.x, floor(i / grid.x));
            let state = f32(extractBits(cellState[input.instance], 0, 1));
            
            let cellOffset = cell / grid * 2;
            let gridPos = (input.pos * state + 1) / grid - 1 + cellOffset;
        
            var output: VertexOutput;
            output.pos = vec4f(gridPos, 0, 1);
            output.cell = cell;
            return output;
        }

        @fragment
        fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
            let c = input.cell / grid;
            return vec4f(1-c.y, c, 1); // (Red, Green, Blue, Alpha)
        }
    `
});

const cellPipeline = device.createRenderPipeline({
    label: "Cell pipeline",
    layout: pipelineLayout,
    vertex: {
        module: cellShaderModule,
        entryPoint: "vertexMain",
        buffers: [vertexBufferLayout]
    },
    fragment: {
        module: cellShaderModule,
        entryPoint: "fragmentMain",
        targets: [{
            format: canvasFormat
        }]
    }
});

// Create the compute shader that will process the simulation.
const simulationShaderModule = device.createShaderModule({
    label: "Game of Life simulation shader",
    code: `
        @group(0) @binding(0) var<uniform> grid: vec2f;
        
        
        @group(0) @binding(1) var<storage> cellStateIn: array<u32>;
        @group(0) @binding(2) var<storage, read_write> cellStateOut: array<u32>;

        fn cellActive(x: u32, y: u32) -> u32 {
            return cellStateIn[cellIndex(vec2(x, y))];
        }
    
        fn cellIndex(cell: vec2u) -> u32 {
            return (cell.y % u32(grid.y)) * u32(grid.x) +
                (cell.x % u32(grid.x));
        }

        @compute @workgroup_size(${WORKGROUP_SIZE}, ${WORKGROUP_SIZE})
        fn computeMain(@builtin(global_invocation_id) cell: vec3u) {
            let activeNeighbors = cellActive(cell.x+1, cell.y+1) +
                                cellActive(cell.x+1, cell.y) +
                                cellActive(cell.x+1, cell.y-1) +
                                cellActive(cell.x, cell.y-1) +
                                cellActive(cell.x-1, cell.y-1) +
                                cellActive(cell.x-1, cell.y) +
                                cellActive(cell.x-1, cell.y+1) +
                                cellActive(cell.x, cell.y+1);
            let i = cellIndex(cell.xy);

            // Conway's game of life rules:
            switch activeNeighbors {
            case 2: { // Active cells with 2 neighbors stay active.
                cellStateOut[i] = cellStateIn[i];
            }
            case 3: { // Cells with 3 neighbors become or stay active.
                cellStateOut[i] = 1;
            }
            default: { // Cells with < 2 or > 3 neighbors become inactive.
                cellStateOut[i] = 0;
            }
            }
        }`
});


// Create a compute pipeline that updates the game state.
const simulationPipeline = device.createComputePipeline({
    label: "Simulation pipeline",
    layout: pipelineLayout,
    compute: {
        module: simulationShaderModule,
        entryPoint: "computeMain",
    }
});


// Create a uniform buffer that describes the grid.
const uniformArray = new Float32Array([GRID_SIZE, GRID_SIZE]);
const uniformBuffer = device.createBuffer({
    label: "Grid Uniforms",
    size: uniformArray.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});
device.queue.writeBuffer(uniformBuffer, 0, uniformArray);

// Create an array representing the active state of each cell.
const cellStateArray = new Uint32Array(GRID_SIZE * GRID_SIZE);
let liveCellStateArrays = [new Uint32Array(GRID_SIZE * GRID_SIZE), new Uint32Array(GRID_SIZE * GRID_SIZE)];

// Create two storage buffers to hold the cell state.
const cellStateStorage = [
    device.createBuffer({
        label: "Cell State A",
        size: cellStateArray.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    }),
    device.createBuffer({
        label: "Cell State B",
        size: cellStateArray.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    })
];

// Create two storage buffers to hold the cell state.
const cellStateStorageReaders = [
    device.createBuffer({
        label: "Cell State A reader",
        size: cellStateArray.byteLength,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    }),
    device.createBuffer({
        label: "Cell State B reader",
        size: cellStateArray.byteLength,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    })
];



// connects uniform to the shader
const bindGroups = [
    device.createBindGroup({
        label: "Cell renderer bind group A",
        layout: bindGroupLayout,
        entries: [{
            binding: 0,
            resource: { buffer: uniformBuffer }
        }, {
            binding: 1,
            resource: { buffer: cellStateStorage[0] }
        }, {
            binding: 2,
            resource: { buffer: cellStateStorage[1] }
        },],
    }),
    device.createBindGroup({
        label: "Cell renderer bind group B",
        layout: bindGroupLayout,
        entries: [{
            binding: 0,
            resource: { buffer: uniformBuffer }
        }, {
            binding: 1,
            resource: { buffer: cellStateStorage[1] }
        }, {
            binding: 2,
            resource: { buffer: cellStateStorage[0] }
        },],
    })
];






// Move all of our rendering code into a function
async function updateGrid() {
    
    const encoder = device.createCommandEncoder();

    if (run){
    const computePass = encoder.beginComputePass();

    // Compute work will go here...
    computePass.setPipeline(simulationPipeline);
    computePass.setBindGroup(0, bindGroups[step % 2]);
    const workgroupCount = Math.ceil(GRID_SIZE / WORKGROUP_SIZE);
    computePass.dispatchWorkgroups(workgroupCount, workgroupCount);

    computePass.end();
    step++; // Increment the step count
    
    }
    
    // Start a render pass 
    const pass = encoder.beginRenderPass({
        colorAttachments: [{
            view: context.getCurrentTexture().createView(),
            loadOp: "clear",
            clearValue: { r: 0, g: 0, b: 0.4, a: 1.0 },
            storeOp: "store",
        }]
    });

    // Draw the grid.
    pass.setPipeline(cellPipeline);
    pass.setBindGroup(0, bindGroups[step % 2]); // Updated!
    pass.setVertexBuffer(0, vertexBuffer);
    pass.draw(vertices.length / 2, GRID_SIZE * GRID_SIZE);
    // End the render pass and submit the command buffer
    pass.end();

    
    encoder.copyBufferToBuffer(cellStateStorage[0], 0, cellStateStorageReaders[0], 0, cellStateArray.byteLength);
    encoder.copyBufferToBuffer(cellStateStorage[1], 0, cellStateStorageReaders[1], 0, cellStateArray.byteLength);
    device.queue.submit([encoder.finish()]);
    await cellStateStorageReaders[0].mapAsync(GPUMapMode.READ, 0, cellStateArray.byteLength);
    liveCellStateArrays[0] = new Uint32Array(cellStateStorageReaders[0].getMappedRange(0, cellStateArray.byteLength).slice(0));
    cellStateStorageReaders[0].unmap();
    await cellStateStorageReaders[1].mapAsync(GPUMapMode.READ, 0, cellStateArray.byteLength);
    liveCellStateArrays[1] = new Uint32Array(cellStateStorageReaders[1].getMappedRange(0, cellStateArray.byteLength).slice(0));
    cellStateStorageReaders[1].unmap();

}

// Set each cell to a random state, then copy the JavaScript array 
// into the storage buffer.

function pos_to_cell(x, y) {
    let a = Math.floor(x / (canvas.width/GRID_SIZE));
    let b = GRID_SIZE - 1 - Math.floor(y / (canvas.height/GRID_SIZE));
    return a + (b * GRID_SIZE);
}

let mouse_x;
let mouse_y;
// Optional: Event listener for mouse movement
canvas.addEventListener('mousemove', (event) => {
    const rect = canvas.getBoundingClientRect();
    mouse_x = event.clientX - rect.left;
    mouse_y = event.clientY - rect.top;
    pos.textContent = (`(${mouse_x}, ${mouse_y}, ${pos_to_cell(mouse_x, mouse_y)})`);
    if (drawing){
        liveCellStateArrays[0][pos_to_cell(mouse_x, mouse_y)] = 1;
        liveCellStateArrays[1][pos_to_cell(mouse_x, mouse_y)] = 1;
        console.log(`clicked  ${pos_to_cell(mouse_x, mouse_y)} ${liveCellStateArrays[0][pos_to_cell(mouse_x, mouse_y)]}`);
        device.queue.writeBuffer(cellStateStorage[0], 0, liveCellStateArrays[0]);
        device.queue.writeBuffer(cellStateStorage[1], 0, liveCellStateArrays[1]);
    }
    
});
let drawing = false;
let temp = false;
canvas.addEventListener('mousedown', (event) => {
    drawing = true;
    temp = run  
    run = false;
    liveCellStateArrays[0][pos_to_cell(mouse_x, mouse_y)] = 1;
    liveCellStateArrays[1][pos_to_cell(mouse_x, mouse_y)] = 1;
    console.log(`clicked  ${pos_to_cell(mouse_x, mouse_y)} ${liveCellStateArrays[0][pos_to_cell(mouse_x, mouse_y)]}`);
    device.queue.writeBuffer(cellStateStorage[0], 0, liveCellStateArrays[0]);
    device.queue.writeBuffer(cellStateStorage[1], 0, liveCellStateArrays[1]);
});
canvas.addEventListener('mouseup', (event) => {    
    run = temp;
    drawing = false;
});


// Control the processing loop
const debug_field = document.getElementById('debug');
const pos = document.getElementById('pos');
const play_simulation_button = document.getElementById('play_simulation_button');
const reshuffle_button = document.getElementById('reshuffle_button');
let run = false;
const slider = document.getElementById('tick_rate');
const display = document.getElementById('tick_rate_value');
const dot_slider = document.getElementById('dot_generate');
const dot_display = document.getElementById('dot_generate_value');
let windowUpdater;

function shuffle(){
    for (let i = 0; i < cellStateArray.length; ++i) {
        cellStateArray[i] = Math.random() < dot_generate_chance ? 1 : 0;
    }
}

function reshuffle(){
    shuffle()
    device.queue.writeBuffer(cellStateStorage[0], 0, cellStateArray);
    device.queue.writeBuffer(cellStateStorage[1], 0, cellStateArray);
}

function press_play_button(){
    run = !run;
}

function updateValue() {
    const value = slider.value;
    display.textContent = value;
    UPDATE_INTERVAL = value; // Update the variable
    // Schedule updateGrid() to run repeatedly
    clearInterval(windowUpdater);
    windowUpdater = setInterval(updateGrid, UPDATE_INTERVAL);
}

function updateDotGenValue() {
    const value = dot_slider.value;
    dot_display.textContent = value;
    dot_generate_chance = value;
}


let dot_generate_chance = 0.0;
updateDotGenValue();
shuffle()
device.queue.writeBuffer(cellStateStorage[0], 0, cellStateArray);

// Initialize the variable with the initial slider value
let UPDATE_INTERVAL = slider.value;

// Add an event listener to the slider to handle value changes
slider.addEventListener('input', updateValue);
dot_slider.addEventListener('input', updateDotGenValue);
play_simulation_button.addEventListener('click', press_play_button);
reshuffle_button.addEventListener('click', reshuffle);

// Update the display initially
updateValue();
