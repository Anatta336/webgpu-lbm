import { Pipeline, Renderer } from "../webgpu/renderer";
import velocityShaderCode from "./shaders/velocity.wgsl";
import { SimParamsBuffer } from "./simParams";
import { ValuesBuffer } from "./simulatePipeline";

export interface RecordsMovement {
    recordMovement(x: number, y:number): void;
}

interface VelocityPipelineState {
    velocityInputBuffer: GPUBuffer;
    bindGroup: GPUBindGroup;
    pipeline: GPUComputePipeline;
    lastPosition: {x: number, y: number} | null;
    currentPosition: {x: number, y: number} | null;
}

export function createVelocityPipeline(
    renderer: Renderer,
    simParamsBuffer: SimParamsBuffer,
    valuesBuffer: ValuesBuffer,
): Pipeline & RecordsMovement {
    const device = renderer.getDevice();
    if (!device) {
        throw new Error("Trying to create pipeline when Renderer doesn't have device yet.");
    }

    // Create buffer for velocity input parameters
    const velocityInputBuffer = device.createBuffer({
        size: 6 * 4, // 6 x f32: startX, startY, endX, endY, strength, radius
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });

    const bindGroupLayout = device.createBindGroupLayout({
        entries: [
            {
                // SimParams
                binding: 0,
                visibility: GPUShaderStage.COMPUTE,
                buffer: { type: 'uniform' }
            },
            {
                // Values buffer
                binding: 1,
                visibility: GPUShaderStage.COMPUTE,
                buffer: { type: 'storage' }
            },
            {
                // Velocity input buffer
                binding: 2,
                visibility: GPUShaderStage.COMPUTE,
                buffer: { type: 'uniform' }
            }
        ]
    });

    const bindGroup = device.createBindGroup({
        layout: bindGroupLayout,
        entries: [
            {
                binding: 0,
                resource: { buffer: simParamsBuffer }
            },
            {
                binding: 1,
                resource: { buffer: valuesBuffer }
            },
            {
                binding: 2,
                resource: { buffer: velocityInputBuffer }
            }
        ]
    });

    const shaderModule = device.createShaderModule({
        code: velocityShaderCode,
    });

    const pipeline = device.createComputePipeline({
        layout: device.createPipelineLayout({
            bindGroupLayouts: [bindGroupLayout]
        }),
        compute: {
            module: shaderModule,
            entryPoint: 'main'
        }
    });

    const state: VelocityPipelineState = {
        velocityInputBuffer,
        bindGroup,
        pipeline,
        lastPosition: null,
        currentPosition: null
    };

    return {
        run: (commandEncoder: GPUCommandEncoder, _: number) =>
            run(commandEncoder, state, renderer),
        recordMovement: (x: number, y:number) =>
            state.currentPosition = { x, y },
    };
}

function run(
    commandEncoder: GPUCommandEncoder,
    state: VelocityPipelineState,
    renderer: Renderer
): void {
    const [resolutionX, resolutionY] = renderer.getResolution();
    const queue = renderer.getQueue();

    const dx = (state.currentPosition?.x ?? 0) - (state.lastPosition?.x ?? 0);
    const dy = (state.currentPosition?.y ?? 0) - (state.lastPosition?.y ?? 0);
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (!state.currentPosition || !state.lastPosition || distance < 1.0) {
        // Not enough movement to apply velocity, so skip the shader run entirely.
        state.lastPosition = state.currentPosition;
        state.currentPosition = null;

        return;
    }

    // Strength based on mouse movement speed (capped)
    const strength = Math.min(distance * 0.005, 0.6);

    const paramsArray = new Float32Array(6);
    // startX
    paramsArray[0] = state.lastPosition.x;
    // startY
    paramsArray[1] = state.lastPosition.y;
    // endX
    paramsArray[2] = state.currentPosition!.x;
    // endY
    paramsArray[3] = state.currentPosition!.y;
    // strength
    paramsArray[4] = strength;
    // radius - how wide the velocity stroke is.
    paramsArray[5] = 50.0;

    // Write the data to the buffer, to be used by the compute shader.
    queue.writeBuffer(state.velocityInputBuffer, 0, paramsArray);

    const pass = commandEncoder.beginComputePass();
    pass.setPipeline(state.pipeline);
    pass.setBindGroup(0, state.bindGroup);
    pass.dispatchWorkgroups(
        Math.ceil(resolutionX / 16),
        Math.ceil(resolutionY / 16)
    );
    pass.end();

    commandEncoder.clearBuffer(state.velocityInputBuffer);

    state.lastPosition = state.currentPosition;
    state.currentPosition = null;
}

