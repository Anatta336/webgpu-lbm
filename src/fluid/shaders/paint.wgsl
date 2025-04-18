#include lbm_common.wgsl;

@group(0) @binding(0) var<uniform> params: SimParams;
@group(0) @binding(1) var<storage, read_write> values: array<f32>;
@group(0) @binding(2) var<storage, read_write> userInput: array<f32>;

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let x = global_id.x;
    let y = global_id.y;

    if (x >= params.width || y >= params.height) {
        return;
    }

    let index = y * params.width + x;
    let baseIndex = computeIndex(params, x, y);

    // Get user input (paint) value for this cell
    let inputValue = userInput[index];

    // Only process cells that have been painted
    if (inputValue > 0.0) {
        // Get current density and velocity from the cell
        let rho = values[baseIndex + 9];
        let vx = values[baseIndex + 10];
        let vy = values[baseIndex + 11];

        // Add density based on user input and reset to near equilibrium
        let newRho = rho + inputValue * 0.2;
        let velocity = vec2<f32>(vx, vy);

        values[baseIndex + 9] = newRho;

        // Recalculate distribution functions based on new density and velocity
        // This effectively adds fluid to the simulation
        for (var i = 0u; i < 9u; i++) {
            values[baseIndex + i] = computeEquilibrium(newRho, velocity, i);
        }
    }

    // Reset the user input after processing
    userInput[index] = 0.0;
}