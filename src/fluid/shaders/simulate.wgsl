#include lbm_common.wgsl;

@group(0) @binding(0) var<uniform> params: SimParams;
@group(0) @binding(1) var<storage, read> src: array<f32>;
@group(0) @binding(2) var<storage, read_write> dst: array<f32>;


// Check if a cell is solid (boundary)
fn isSolid(x: u32, y: u32) -> bool {
    // Walls on the borders.
    return x == 0u || y == 0u || x == params.width - 1u || y == params.height - 1u;

    // Could add more complex boundary conditions here.
}

// Collision step (compute new distributions after collision)
@compute @workgroup_size(16, 16)
fn collision(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let x = global_id.x;
    let y = global_id.y;

    if (x >= params.width || y >= params.height) {
        return;
    }

    let baseIndex = computeIndex(params, x, y);

    // Check if this is a solid cell
    if (isSolid(x, y)) {
        // For solid cells, we'll handle bounce-back in the streaming step
        // Just copy the original values to the destination buffer
        for (var i = 0u; i < 12u; i++) {
            dst[baseIndex + i] = src[baseIndex + i];
        }
        return;
    }

    // Load current distributions f[i]
    var f: array<f32, 9>;
    for (var i = 0u; i < 9u; i++) {
        f[i] = src[baseIndex + i];
    }

    // Compute macroscopic quantities: density and velocity
    var rho = 0.0;
    var momentum = vec2<f32>(0.0, 0.0);

    for (var i = 0u; i < 9u; i++) {
        rho += f[i];
        momentum += f[i] * e[i];
    }

    let velocity = select(momentum / rho, vec2<f32>(0.0, 0.0), rho < 0.0001);

    // Save macroscopic quantities for visualization and next steps
    dst[baseIndex + 9] = rho;
    dst[baseIndex + 10] = velocity.x;
    dst[baseIndex + 11] = velocity.y;

    // Compute equilibrium distributions
    var f_eq: array<f32, 9>;
    for (var i = 0u; i < 9u; i++) {
        f_eq[i] = computeEquilibrium(rho, velocity, i);
    }

    // Perform collision step using BGK approximation
    // f_i = f_i + omega * (f_eq_i - f_i)
    for (var i = 0u; i < 9u; i++) {
        // Calculate the post-collision distribution
        let f_coll = f[i] + params.omega * (f_eq[i] - f[i]);
        dst[baseIndex + i] = f_coll;
    }
}

// Streaming step (move distributions to neighboring cells)
@compute @workgroup_size(16, 16)
fn streaming(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let x = global_id.x;
    let y = global_id.y;

    if (x >= params.width || y >= params.height) {
        return;
    }

    let dstIndex = computeIndex(params, x, y);

    // Handle bounce-back boundary conditions for solid cells
    if (isSolid(x, y)) {
        // For solid cells, perform bounce-back
        // Distributions bounce back in the opposite direction
        for (var i = 1u; i < 9u; i++) { // Skip center direction (0)
            let oppositeDir = opposite[i];

            // Get the distribution from the opposite direction
            let srcValue = src[dstIndex + i];

            // Reflect it back
            dst[dstIndex + oppositeDir] = srcValue;
        }
        return;
    }

    // For fluid cells, handle streaming from neighboring cells
    for (var i = 0u; i < 9u; i++) {
        // Find the source cell for this direction (move in the opposite direction to trace back)
        let srcDir = opposite[i];
        let srcVec = e[srcDir];

        // Calculate coordinates of the source cell
        let srcX = u32(i32(x) - i32(srcVec.x));
        let srcY = u32(i32(y) - i32(srcVec.y));

        // Check if the source cell is within bounds
        if (srcX < params.width && srcY < params.height) {
            let srcCellIndex = computeIndex(params, srcX, srcY);

            // If source is a solid cell, handle bounce-back
            if (isSolid(srcX, srcY)) {
                // The distribution bounces back from the solid boundary
                dst[dstIndex + i] = src[dstIndex + srcDir];
            } else {
                // Regular streaming: pull the distribution from the source cell
                dst[dstIndex + i] = src[srcCellIndex + i];
            }
        }
    }

    // Copy the macroscopic quantities (rho, vx, vy) from collision step
    dst[dstIndex + 9] = src[dstIndex + 9];   // rho
    dst[dstIndex + 10] = src[dstIndex + 10]; // vx
    dst[dstIndex + 11] = src[dstIndex + 11]; // vy
}