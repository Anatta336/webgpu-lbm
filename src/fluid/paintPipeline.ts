import { Pipeline, Renderer } from "../webgpu/renderer";
import paintShaderCode from "./shaders/paint.wgsl";
import { SimParamsBuffer } from "./simParams";
import { ValuesBuffer } from "./simulatePipeline";

export interface DrawsCircles {
    drawCircle(x: number, y: number, radius: number, value: number): void;
}

interface PaintPipelineState {
    userInputBuffer: GPUBuffer;
    bindGroup: GPUBindGroup;
    pipeline: GPUComputePipeline;
}

export function createPaintPipeline(
    renderer: Renderer,
    simParamsBuffer: SimParamsBuffer,
    valuesBuffer: ValuesBuffer,
): Pipeline & DrawsCircles {
    const device = renderer.getDevice();
    if (!device) {
        throw new Error("Trying to create pipeline when Renderer doesn't have device yet.");
    }

    const [resolutionX, resolutionY] = renderer.getResolution();

    const userInputBuffer = device.createBuffer({
        size: resolutionX * resolutionY * 4, // 4 bytes each for f32.
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
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
                // Values
                binding: 1,
                visibility: GPUShaderStage.COMPUTE,
                buffer: { type: 'storage' }
            },
            {
                // UserInput
                binding: 2,
                visibility: GPUShaderStage.COMPUTE,
                buffer: { type: 'storage' }
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
                resource: { buffer: userInputBuffer }
            }
        ]
    });

    const shaderModule = device.createShaderModule({
        code: paintShaderCode,
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

    const state: PaintPipelineState = {
        userInputBuffer,
        bindGroup,
        pipeline,
    };

    return {
        run: (commandEncoder: GPUCommandEncoder, _: number) => run(commandEncoder, state, renderer),
        drawCircle: (x: number, y: number, radius: number, value: number) =>
            drawCircle(renderer, state.userInputBuffer, x, y, radius, value),
    };
}

function run(
    commandEncoder: GPUCommandEncoder,
    state: PaintPipelineState,
    renderer: Renderer
): void {
    const [resolutionX, resolutionY] = renderer.getResolution();

    const pass = commandEncoder.beginComputePass();
    pass.setPipeline(state.pipeline);
    pass.setBindGroup(0, state.bindGroup);
    pass.dispatchWorkgroups(
        Math.ceil(resolutionX / 16),
        Math.ceil(resolutionY / 16)
    );
    pass.end();
}

function drawCircle(
    renderer: Renderer,
    inputBuffer: GPUBuffer,
    x: number,
    y: number,
    radius: number,
    value: number
) {
    // TODO: rework this to only add to only queue during the `run` function.

    const [resolutionX, resolutionY] = renderer.getResolution();

    // Create a temporary array to hold our data
    const data = new Float32Array(resolutionX * resolutionY);

    // For each pixel in a square around the circle
    const radiusSquared = radius * radius;
    for (let dy = -radius; dy <= radius; dy++) {
        const py = Math.round(y + dy);
        if (py < 0 || py >= resolutionY) {
            continue;
        }

        for (let dx = -radius; dx <= radius; dx++) {
            const px = Math.round(x + dx);
            if (px < 0 || px >= resolutionX) {
                continue;
            }

            // Check if this point is within the circle
            const distSquared = dx * dx + dy * dy;
            if (distSquared <= radiusSquared) {
                // Write the value to our array
                const index = py * resolutionX + px;
                data[index] = value;
            }
        }
    }

    renderer.getQueue().writeBuffer(inputBuffer, 0, data);
}
