import { Pipeline, Renderer } from "../webgpu/renderer";
import shaderCode from "./shaders/simulate.wgsl";
import { SimParamsBuffer } from "./simParams";

interface SimulatePipelineState {
    renderer: Renderer;
    simParamsBuffer: SimParamsBuffer;
    fluidBuffers: {
        src: GPUBuffer;
        dst: GPUBuffer;
    };
    bindGroups: {
        collisionGroup: GPUBindGroup;
        streamingGroup: GPUBindGroup;
    };
    pipelines: {
        collisionPipeline: GPUComputePipeline;
        streamingPipeline: GPUComputePipeline;
    };
    timeElapsed: number;
    initialData: Float32Array;
}

export interface ProvidesValuesBuffer {
    getValuesBuffer(): ValuesBuffer;
    resetSimulation(): void;
}

/**
 * Stores LBM distribution values for each point.
 */
export interface ValuesBuffer extends GPUBuffer {}

export function createSimulatePipeline(
    renderer: Renderer,
    simParamsBuffer: SimParamsBuffer,
): Pipeline & ProvidesValuesBuffer {
    const device = renderer.getDevice();
    const [resolutionX, resolutionY] = renderer.getResolution();

    if (!device) {
        throw new Error("Trying to create pipeline when Renderer doesn't have device yet.");
    }

    // For LBM, we need 9 directions (D2Q9 model) plus rho and velocity (2 components)
    // So per cell: 9 distribution values + 1 density + 2 velocity components = 12 f32 values
    const bytesPerPoint = 12 * 4; // 12 x f32 (4 bytes each)

    // Create ping-pong buffers for the simulation
    const srcBuffer = device.createBuffer({
        size: resolutionX * resolutionY * bytesPerPoint,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });

    const dstBuffer = device.createBuffer({
        size: resolutionX * resolutionY * bytesPerPoint,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });

    // Initialize the buffers with default values
    const initialData = new Float32Array(resolutionX * resolutionY * 12);
    // Set initial density to 1.0 (rho)
    for (let i = 0; i < resolutionX * resolutionY; i++) {
        // Each cell has 12 values: f0-f8, rho, vx, vy
        const baseIndex = i * 12;

        // Initialize distribution values (f) with equilibrium for rho=1, v=0
        initialData[baseIndex + 0] = 4/9;  // f0 (center) - weight 4/9
        initialData[baseIndex + 1] = 1/9;  // f1 (east) - weight 1/9
        initialData[baseIndex + 2] = 1/9;  // f2 (north) - weight 1/9
        initialData[baseIndex + 3] = 1/9;  // f3 (west) - weight 1/9
        initialData[baseIndex + 4] = 1/9;  // f4 (south) - weight 1/9
        initialData[baseIndex + 5] = 1/36; // f5 (north-east) - weight 1/36
        initialData[baseIndex + 6] = 1/36; // f6 (north-west) - weight 1/36
        initialData[baseIndex + 7] = 1/36; // f7 (south-west) - weight 1/36
        initialData[baseIndex + 8] = 1/36; // f8 (south-east) - weight 1/36

        // Initial density is 1.0
        initialData[baseIndex + 9] = 1.0;  // rho

        // Initial velocity is zero
        initialData[baseIndex + 10] = 0.0; // vx
        initialData[baseIndex + 11] = 0.0; // vy
    }

    // Upload the initial data to both buffers
    renderer.getQueue().writeBuffer(srcBuffer, 0, initialData);
    renderer.getQueue().writeBuffer(dstBuffer, 0, initialData);

    // Create bind group layouts
    const bindGroupLayout = device.createBindGroupLayout({
        entries: [
            {
                // SimParams
                binding: 0,
                visibility: GPUShaderStage.COMPUTE,
                buffer: { type: 'uniform' }
            },
            {
                // Source buffer (read-only)
                binding: 1,
                visibility: GPUShaderStage.COMPUTE,
                buffer: { type: 'read-only-storage' }
            },
            {
                // Destination buffer (read-write)
                binding: 2,
                visibility: GPUShaderStage.COMPUTE,
                buffer: { type: 'storage' }
            },
        ]
    });

    // Create bind groups for ping-ponging between buffers
    const collisionBindGroup = device.createBindGroup({
        layout: bindGroupLayout,
        entries: [
            {
                binding: 0,
                resource: { buffer: simParamsBuffer }
            },
            {
                binding: 1,
                resource: { buffer: srcBuffer }
            },
            {
                binding: 2,
                resource: { buffer: dstBuffer }
            },
        ]
    });

    const streamingBindGroup = device.createBindGroup({
        layout: bindGroupLayout,
        entries: [
            {
                binding: 0,
                resource: { buffer: simParamsBuffer }
            },
            {
                binding: 1,
                resource: { buffer: dstBuffer }
            },
            {
                binding: 2,
                resource: { buffer: srcBuffer }
            },
        ]
    });

    // Create the shader module from the WGSL code
    const shaderModule = device.createShaderModule({
        code: shaderCode
    });

    // Create pipelines for collision and streaming steps
    const collisionPipeline = device.createComputePipeline({
        layout: device.createPipelineLayout({
            bindGroupLayouts: [bindGroupLayout]
        }),
        compute: {
            module: shaderModule,
            entryPoint: 'collision'
        }
    });

    const streamingPipeline = device.createComputePipeline({
        layout: device.createPipelineLayout({
            bindGroupLayouts: [bindGroupLayout]
        }),
        compute: {
            module: shaderModule,
            entryPoint: 'streaming'
        }
    });

    const state: SimulatePipelineState = {
        renderer,
        simParamsBuffer,
        fluidBuffers: {
            src: srcBuffer,
            dst: dstBuffer
        },
        bindGroups: {
            collisionGroup: collisionBindGroup,
            streamingGroup: streamingBindGroup
        },
        pipelines: {
            collisionPipeline,
            streamingPipeline
        },
        timeElapsed: 0,
        initialData: initialData
    };

    return {
        run: (commandEncoder: GPUCommandEncoder, dt: number) => run(commandEncoder, state, dt),
        getValuesBuffer: () => state.fluidBuffers.src, // Always return the source buffer for visualization
        resetSimulation: () => resetSimulation(state),
    };
}

function run(
    commandEncoder: GPUCommandEncoder,
    state: SimulatePipelineState,
    dt: number
): void {
    const [resolutionX, resolutionY] = state.renderer.getResolution();
    state.timeElapsed += dt;

    // Step 1: Collision step
    let collisionPass = commandEncoder.beginComputePass();
    collisionPass.setPipeline(state.pipelines.collisionPipeline);
    collisionPass.setBindGroup(0, state.bindGroups.collisionGroup);
    collisionPass.dispatchWorkgroups(
        Math.ceil(resolutionX / 16),
        Math.ceil(resolutionY / 16)
    );
    collisionPass.end();

    // Step 2: Streaming step
    let streamingPass = commandEncoder.beginComputePass();
    streamingPass.setPipeline(state.pipelines.streamingPipeline);
    streamingPass.setBindGroup(0, state.bindGroups.streamingGroup);
    streamingPass.dispatchWorkgroups(
        Math.ceil(resolutionX / 16),
        Math.ceil(resolutionY / 16)
    );
    streamingPass.end();

    // We don't need to swap the buffers, as the binding groups are already set up for ping-ponging.
}

function resetSimulation(state: SimulatePipelineState): void {
    const queue = state.renderer.getQueue();
    if (!queue) {
        throw new Error("Trying to reset simulation when Renderer doesn't have queue yet.");
    }

    // Reset both buffers to initial state
    queue.writeBuffer(state.fluidBuffers.src, 0, state.initialData);
    queue.writeBuffer(state.fluidBuffers.dst, 0, state.initialData);

    // Reset the time elapsed
    state.timeElapsed = 0;
}
