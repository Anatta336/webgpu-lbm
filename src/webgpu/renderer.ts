export interface Renderer {
    getCanvas(): HTMLCanvasElement;
    getDevice(): GPUDevice;
    getQueue(): GPUQueue;
    getTextureView(): GPUTextureView;
    getOutputTargetFormat(): GPUTextureFormat;
    addPipeline(pipeline: Pipeline): void;
    addPipelines(pipelines: Pipeline[]): void;
    removePipeline(pipeline: Pipeline): void;
    getResolution(): [number, number];
    render(dt: number): void;
}

export interface Pipeline {
    run(commandEncoder: GPUCommandEncoder, dt: number): void;
}

interface RendererState {
    resolutionX: number;
    resolutionY: number;
    outputTargetFormat: GPUTextureFormat;
    canvas: HTMLCanvasElement;
    context: GPUCanvasContext | null | undefined;
    device: GPUDevice | null | undefined;
    queue: GPUQueue | null | undefined;
    pipelines: Pipeline[];
    time: number;
}

export async function createRenderer(
    canvas: HTMLCanvasElement,
    resolutionX: number = 256,
    resolutionY: number = 256,
    outputTargetFormat: GPUTextureFormat = 'bgra8unorm'
): Promise<Renderer | null> {

    const state = await initializeState(canvas, resolutionX, resolutionY, outputTargetFormat);

    const renderer: Renderer = {
        getCanvas: () => state.canvas,
        getDevice: () => state.device!,
        getQueue: () => state.queue!,
        getTextureView: () => state.context!.getCurrentTexture().createView(),
        getOutputTargetFormat: () => state.outputTargetFormat,
        addPipeline: (pipeline: Pipeline) => {
            if (!state.pipelines.includes(pipeline)) {
                state.pipelines.push(pipeline);
            }
        },
        addPipelines: (pipelines: Pipeline[]) => {
            for (const pipeline of pipelines) {
                if (!state.pipelines.includes(pipeline)) {
                    state.pipelines.push(pipeline);
                }
            }
        },
        removePipeline: (pipeline: Pipeline) => {
            const index = state.pipelines.indexOf(pipeline);
            if (index !== -1) {
                state.pipelines.splice(index, 1);
            }
        },
        getResolution: () => [state.resolutionX, state.resolutionY],
        render: (dt: number) => render(state, dt)
    };

    return renderer;
}

async function initializeState(
    canvas: HTMLCanvasElement,
    resolutionX: number = 256,
    resolutionY: number = 256,
    outputTargetFormat: GPUTextureFormat = 'bgra8unorm'
): Promise<RendererState> {
    const entry: GPU = navigator.gpu;
    if (!entry) {
        console.error('WebGPU is not supported');
        throw new Error('WebGPU is not supported');
    }

    const adapter = await entry.requestAdapter();
    const device = await adapter!.requestDevice();
    const context = canvas.getContext('webgpu');

    if (!context) {
        throw new Error('Failed to get WebGPU context.');
    }

    const canvasConfig: GPUCanvasConfiguration = {
        device: device,
        format: outputTargetFormat,
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
        alphaMode: 'premultiplied'
    };
    context.configure(canvasConfig);

    const state: RendererState = {
        resolutionX,
        resolutionY,
        outputTargetFormat,
        canvas,
        device,
        queue: device!.queue,
        context,
        pipelines: [],
        time: 0
    };

    return state;
}

function render(state: RendererState, dt: number) {
    if (!state.device || !state.context || !state.queue) {
        console.error('Renderer not fully initialized.');
        return;
    }

    const commandEncoder = state.device.createCommandEncoder();

    for (const pipeline of state.pipelines) {
        pipeline.run(commandEncoder, dt);
    }

    // Submit commands from the pipelines.
    state.queue.submit([commandEncoder.finish()]);
}
