#include lbm_common.wgsl;

struct VelocityInput {
    startX: f32,
    startY: f32,
    endX: f32,
    endY: f32,
    strength: f32,
    radius: f32,
}

@group(0) @binding(0) var<uniform> params: SimParams;
@group(0) @binding(1) var<storage, read_write> values: array<f32>;
@group(0) @binding(2) var<uniform> velocityInput: VelocityInput;

// Distance from point to line segment
fn distToSegment(p: vec2<f32>, start: vec2<f32>, end: vec2<f32>) -> f32 {
    let line = end - start;
    let len_squared = dot(line, line);

    // If segment is just a point, return distance to that point
    if (len_squared < 0.0001) {
        return distance(p, start);
    }

    // Project point onto line segment
    let t = max(0.0, min(1.0, dot(p - start, line) / len_squared));
    let projection = start + t * line;

    // Return distance to projection point
    return distance(p, projection);
}

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let x = global_id.x;
    let y = global_id.y;

    if (x >= params.width || y >= params.height) {
        return;
    }

    let baseIndex = computeIndex(params, x, y);

    // Get current cell position
    let pos = vec2<f32>(f32(x) + 0.5, f32(y) + 0.5);

    // Get start and end positions of velocity stroke
    let start = vec2<f32>(velocityInput.startX, velocityInput.startY);
    let end = vec2<f32>(velocityInput.endX, velocityInput.endY);

    // Calculate distance to the line segment
    let dist = distToSegment(pos, start, end);

    // Only apply velocity if point is within radius of the line segment
    if (dist <= velocityInput.radius) {
        // Calculate direction vector of the stroke
        let direction = normalize(end - start);

        // Apply strength with falloff based on distance
        let falloff = 1.0 - (dist / velocityInput.radius);
        let strength = velocityInput.strength * falloff * falloff;

        // let strength = velocityInput.strength;

        // Get current macroscopic values
        let rho = values[baseIndex + 9];
        let vx = values[baseIndex + 10];
        let vy = values[baseIndex + 11];

        // Apply new velocity (add to existing with some blending)
        let newVx = vx - direction.x * strength;
        let newVy = vy - direction.y * strength;

        // Limit maximum velocity to prevent instability
        let maxMagnitude = 0.3;
        let magnitude = sqrt(newVx * newVx + newVy * newVy);
        var newVelocity = vec2<f32>(newVx, newVy);

        if (magnitude > maxMagnitude) {
            newVelocity *= (maxMagnitude / magnitude);
        }

        // Update macroscopic velocity
        values[baseIndex + 10] = newVelocity.x;
        values[baseIndex + 11] = newVelocity.y;

        // Update distribution functions to be closer to equilibrium with the new velocity
        for (var i = 0u; i < 9u; i++) {
            // Partially relax towards the new equilibrium to avoid sudden changes
            let eq = computeEquilibrium(rho, newVelocity, i);
            let current = values[baseIndex + i];
            values[baseIndex + i] = current * 0.7 + eq * 0.3;  // Blend between current and equilibrium
        }
    }
}