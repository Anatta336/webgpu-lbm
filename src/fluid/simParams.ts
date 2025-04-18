import { Pipeline, Renderer } from "../webgpu/renderer";

interface SimParamsState {
    simParamsBuffer: SimParamsBuffer;
    timeElapsed: number;
    renderer: Renderer;
    viscosity: number;
}

export interface ProvidesSimParamsBuffer {
    getSimParamsBuffer(): SimParamsBuffer;
    setViscosity(value: number): void;
}

/**
 * Uniforms for the simulation.
 */
export interface SimParamsBuffer extends GPUBuffer {}

export function createSimParamsPipeline(
    renderer: Renderer,
): Pipeline & ProvidesSimParamsBuffer {
    const device = renderer.getDevice();

    if (!device) {
        throw new Error("Trying to create pipeline when Renderer doesn't have device yet.");
    }

    const simParamsBuffer = device.createBuffer({
        size: 6 * 4, // 6 32-bit values
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const state: SimParamsState = {
        simParamsBuffer,
        timeElapsed: 0,
        renderer,
        viscosity: 0.1,
    };

    return {
        run: (_: GPUCommandEncoder, dt: number) => run(state, dt),
        getSimParamsBuffer: () => simParamsBuffer,
        setViscosity: (value: number) => { state.viscosity = value; },
    };
}

function run(
    state: SimParamsState,
    dt: number
): void {
    const queue = state.renderer.getQueue();
    const [resolutionX, resolutionY] = state.renderer.getResolution();
    state.timeElapsed = state.timeElapsed + dt;

    // Parameter buffer with views in to it.
    const paramsArray = new ArrayBuffer(6 * 4);
    const u32View = new Uint32Array(paramsArray, 0, 2);
    const f32View = new Float32Array(paramsArray, 2 * 4, 4);

    // Width and height are u32
    u32View[0] = resolutionX;
    u32View[1] = resolutionY;

    // Calculate omega from viscosity.
    const omega = 1.0 / (3.0 * state.viscosity + 0.5);

    // Time, relaxation parameter (omega), viscosity
    f32View[0] = state.timeElapsed;
    f32View[1] = omega;
    f32View[2] = state.viscosity;
    f32View[3] = 0.0;       // reserved for future use

    queue.writeBuffer(
        state.simParamsBuffer,
        0,
        paramsArray
    );
}
