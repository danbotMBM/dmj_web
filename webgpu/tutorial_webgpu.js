const canvas = document.querySelector("canvas");
if (!navigator.gpu) {
    throw new Error("WebGPU not supported on this browser.");
}
// check requestAdapter docs to see how to choose which gpu adapter to use
const adapter = await navigator.gpu.requestAdapter();
if (!adapter) {
    throw new Error("No appropriate GPUAdapter found.");
}
// check requestDevice documentation 
const device = await adapter.requestDevice();
const context = canvas.getContext("webgpu");
const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
// device is the gpu; format is the texture memory format
context.configure({
    device: device,
    format: canvasFormat,
});

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

const vertexBufferLayout = {
    arrayStride: 8,
    attributes: [{
        format: "float32x2",
        offset: 0,
        shaderLocation: 0, // Position, see vertex shader
    }],
};

// write to buffer
device.queue.writeBuffer(vertexBuffer, /*bufferOffset=*/0, vertices);


const cellShaderModule = device.createShaderModule({
    label: "Cell shader",
    code: `
        //shader contents written in WGSL with rust like syntax
        @vertex
        fn vertexMain(@location(0) pos: vec2f) -> 
            @builtin(position) vec4f {
            return vec4f(pos, 0, 1); // (X, Y, Z, W)
        }
        @fragment
        fn fragmentMain() -> @location(0) vec4f {
            return vec4f(1, 0, 0, 1); // (Red, Green, Blue, Alpha)
        }
    `
});

const cellPipeline = device.createRenderPipeline({
    label: "Cell pipeline",
    layout: "auto",
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

// object to send commands to GPU
const encoder = device.createCommandEncoder();

// make some instructions for the GPU to soon execute
const pass = encoder.beginRenderPass({
    colorAttachments: [{
        view: context.getCurrentTexture().createView(),
        loadOp: "clear", // start from scratch
        storeOp: "store", // saved into the texture? not sure what texture is referring to here
        clearValue: { r: 0, g: 0.6, b: 0.4, a: 1 }, // color value
    }]
});

pass.setPipeline(cellPipeline);
pass.setVertexBuffer(0, vertexBuffer);
pass.draw(vertices.length / 2); // 6 vertices

pass.end();
// save a set of instructions
const commandBuffer = encoder.finish();

// actually do the thing (uses up the buffer)
device.queue.submit([commandBuffer]);

