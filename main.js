const p = console.log

function randRange(range) {
  return Math.floor(Math.random() * range);
}

const winW = Math.floor(window.innerWidth/10);
const winH = Math.floor(window.innerHeight/10);

const GRID_SIZE = [winW, winH];
const GRID_AREA = GRID_SIZE[0] * GRID_SIZE[1];

const UPDATE_INTERVAL = 1000/12;

const WORKGROUP_SIZE = 8;

const canvas = document.querySelector('canvas');
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

if (!navigator.gpu) throw new Error("WebGPU is not supported");

const adapter = await navigator.gpu.requestAdapter();
if (!adapter) throw new Error("No Appropriate GPU found");

const device = await adapter.requestDevice();
const context = canvas.getContext('webgpu');

const format = navigator.gpu.getPreferredCanvasFormat();

context.configure({ device, format });

// ==== Vertex buffer

const vertices = new Float32Array([
    -.8, -.8,
    -.8,  .8,
     .8,  .8,

    -.8, -.8,
     .8,  .8,
     .8, -.8,
]);

const vertBuffer = device.createBuffer({
    label: 'Cell vertices',
    size: vertices.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
});

device.queue.writeBuffer(vertBuffer, /*bufferOffset*/0, vertices);

const vertBuffLayout = {
    arrayStride: 8,
    attributes: [{
        format: "float32x2",
        offset: 0,
        shaderLocation: 0 // Position in vertex shader
    }]
};

// ==== Render shader

const shaderFile = await (await fetch('./shader.wgsl')).text();

const cellShaderModule = device.createShaderModule({
    label: "Cell Shader",
    code: shaderFile
});

// ==== Grid buffer

const uniformArray = new Float32Array(GRID_SIZE);
const uniformBuffer = device.createBuffer({
    label: "Grid Uniforms",
    size: uniformArray.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
});

device.queue.writeBuffer(uniformBuffer, 0, uniformArray);

// ==== Cell state buffer

const cellStateArray = new Uint32Array(GRID_AREA);

const cellState = [
    device.createBuffer({
        label: "Cell state A",
        size: cellStateArray.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    }),
    device.createBuffer({
        label: "Cell state B",
        size: cellStateArray.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    }),
];

for (let i = 0; i < cellStateArray.length; ++i) {
    cellStateArray[i] = Math.random() > 0.6;
}

device.queue.writeBuffer(cellState[0], 0, cellStateArray);
device.queue.writeBuffer(cellState[1], 0, cellStateArray);

// ==== Point Flip buffer

const cellFlipArray = new Uint32Array(2);

function cellFlip() {
    cellFlipArray[0] = randRange(GRID_SIZE[0]);
    cellFlipArray[1] = randRange(GRID_SIZE[1]);
}

cellFlip();

const cellFlipBuffer = device.createBuffer({
    label: "Cell Flip Buffer",
    size: cellFlipArray.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
});

device.queue.writeBuffer(cellFlipBuffer, 0, cellFlipArray);

// ==== Bind group layout

const bindGroupLayout = device.createBindGroupLayout({
    label: "Cell bind group layout",
    entries: [{
        binding: 0,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
        buffer: {} // uniform buffer
    }, {
        binding: 1,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.COMPUTE,
        buffer: { type: "read-only-storage" }
    }, {
        binding: 2,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "storage" }
    }, {
        binding: 3,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "storage" }
    }]
})

// ==== Bind groups

const bindGroups = [
    device.createBindGroup({
        label: "Cell render bind group A",
        layout: bindGroupLayout,
        entries: [{
            binding: 0,
            resource: { buffer: uniformBuffer }
        }, {
            binding: 1,
            resource: { buffer: cellState[0] }
        }, {
            binding: 2,
            resource: { buffer: cellState[1] }
        }, {
            binding: 3,
            resource: { buffer: cellFlipBuffer }
        }]
    }),
    device.createBindGroup({
        label: "Cell render bind group B",
        layout: bindGroupLayout,
        entries: [{
            binding: 0,
            resource: { buffer: uniformBuffer }
        }, {
            binding: 1,
            resource: { buffer: cellState[1] }
        }, {
            binding: 2,
            resource: { buffer: cellState[0] }
        }, {
            binding: 3,
            resource: { buffer: cellFlipBuffer }
        }]
    }),
];

// ==== Pipeline layout

const pipelineLayout = device.createPipelineLayout({
    label: "Cell Pipeline Layout",
    bindGroupLayouts: [ bindGroupLayout ],
});

// ==== Pipeline

const cellPipeline = device.createRenderPipeline({
    label: 'Cell pipeline',
    layout: pipelineLayout,
    vertex: {
        module: cellShaderModule,
        entryPoint: 'vertexMain',
        buffers: [vertBuffLayout]
    },
    fragment: {
        module: cellShaderModule,
        entryPoint: 'fragmentMain',
        targets: [{ format }]
    }
});

// ==== Compute shader

const computeFile = await (await fetch('./compute.wgsl')).text();

const simShaderModule = device.createShaderModule({
    label: "Compute shader module",
    code: computeFile
});

const simPipeline = device.createComputePipeline({
    label: "Sim pipeline",
    layout: pipelineLayout,
    compute: {
        module: simShaderModule,
        entryPoint: "computeMain"
    }
});

// ==== Render pass

let step = 0;
function updateGrid() {

    cellFlip();

    device.queue.writeBuffer(cellFlipBuffer, 0 , cellFlipArray);

    const encoder = device.createCommandEncoder({label: 'VoxEngine'});

    const computePass = encoder.beginComputePass();

    computePass.setPipeline(simPipeline);
    computePass.setBindGroup(0, bindGroups[step % 2]);

    computePass.dispatchWorkgroups(
        Math.ceil(GRID_SIZE[0] / WORKGROUP_SIZE),
        Math.ceil(GRID_SIZE[1] / WORKGROUP_SIZE)
    );

    computePass.end();

    step++;

    const renderPass = encoder.beginRenderPass({
        colorAttachments: [{
            view: context.getCurrentTexture().createView({label: 'VoxEngine'}),
            loadOp: "clear",
            storeOp: "store",
            clearValue: [0.06, 0.06, 0.2, 1] // same as: {r:0,g:0,b:0,a:1}
        }]
    });

    renderPass.setPipeline(cellPipeline);
    renderPass.setVertexBuffer(0, vertBuffer);
    renderPass.setBindGroup(0, bindGroups[step % 2]);
    renderPass.draw(vertices.length / 2, GRID_AREA); // number of vertces

    renderPass.end();

    device.queue.submit([encoder.finish()]);
}

setInterval(updateGrid, UPDATE_INTERVAL);
