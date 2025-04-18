import { Pipeline, Renderer } from "../webgpu/renderer";
import vertexShaderCode from "./shaders/render.vert.wgsl";
import fragmentShaderCode from "./shaders/render.frag.wgsl";
import { SimParamsBuffer } from "./simParams";
import { ValuesBuffer } from "./simulatePipeline";

interface DrawPipelineState {
    renderer: Renderer;
    simParamsBuffer: SimParamsBuffer;
    valuesBuffer: ValuesBuffer;
    bindGroup: GPUBindGroup;
    pipeline: GPURenderPipeline;
    timeElapsed: number;
}

export function createDrawPipeline(
    renderer: Renderer,
    simParamsBuffer: SimParamsBuffer,
    valuesBuffer: ValuesBuffer,
): Pipeline {
    const device = renderer.getDevice();

    if (!device) {
        throw new Error("Trying to create pipeline when Renderer doesn't have device yet.");
    }

    const bindGroupLayout = device.createBindGroupLayout({
        entries: [
            {
                // SimParams
                binding: 0,
                visibility: GPUShaderStage.COMPUTE | GPUShaderStage.FRAGMENT,
                buffer: { type: 'uniform' }
            },
            {
                // Values
                binding: 1,
                visibility: GPUShaderStage.COMPUTE | GPUShaderStage.FRAGMENT,
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
        ]
    });

    const vertexModule = device.createShaderModule({
        code: vertexShaderCode,
    });
    const fragmentModule = device.createShaderModule({
        code: fragmentShaderCode,
    });
    const pipeline = device.createRenderPipeline({
        layout: device.createPipelineLayout({
            bindGroupLayouts: [bindGroupLayout]
        }),
        vertex: {
            module: vertexModule,
            entryPoint: 'main'
        },
        fragment: {
            module: fragmentModule,
            entryPoint: 'main',
            targets: [{
                format: renderer.getOutputTargetFormat(),
            }]
        },
        primitive: {
            topology: 'triangle-list'
        }
    });

    const state: DrawPipelineState = {
        renderer,
        simParamsBuffer,
        valuesBuffer,
        bindGroup,
        pipeline,
        timeElapsed: 0,
    };

    return {
        run: (commandEncoder: GPUCommandEncoder, _: number) => run(commandEncoder, state),
    };
}

function run(
    commandEncoder: GPUCommandEncoder,
    state: DrawPipelineState,
): void {
    const textureView = state.renderer.getTextureView()

    const pass = commandEncoder.beginRenderPass({
        colorAttachments: [{
            view: textureView,
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            loadOp: 'clear',
            storeOp: 'store'
        }]
    });

    pass.setPipeline(state.pipeline);
    pass.setBindGroup(0, state.bindGroup);
    pass.draw(3, 1, 0, 0); // Draw one triangle that covers the screen
    pass.end();
}
