#include lbm_common.wgsl;

@group(0) @binding(0) var<uniform> params: SimParams;
@group(0) @binding(1) var<storage, read_write> values: array<f32>;

// Maps velocity to a color using a simple color scheme
fn velocityToColor(velocity: vec2<f32>) -> vec3<f32> {
    let speed = length(velocity);
    let maxSpeed = 0.1; // Adjust based on your simulation scale
    let normalizedSpeed = min(speed / maxSpeed, 1.0);

    // Direction-based coloring
    let angle = atan2(velocity.y, velocity.x);
    let hue = (angle / (2.0 * 3.14159) + 1.0) * 0.5; // Map angle to [0,1]

    // Generate an HSV color and convert to RGB
    return hsv2rgb(vec3<f32>(hue, normalizedSpeed, normalizedSpeed * 0.8 + 0.2));
}

// HSV to RGB conversion
fn hsv2rgb(hsv: vec3<f32>) -> vec3<f32> {
    let h = hsv.x * 6.0;
    let s = hsv.y;
    let v = hsv.z;

    let c = v * s;
    let x = c * (1.0 - abs(fract(h) * 2.0 - 1.0));
    let m = v - c;

    var rgb: vec3<f32>;

    if (h < 1.0) {
        rgb = vec3<f32>(c, x, 0.0);
    } else if (h < 2.0) {
        rgb = vec3<f32>(x, c, 0.0);
    } else if (h < 3.0) {
        rgb = vec3<f32>(0.0, c, x);
    } else if (h < 4.0) {
        rgb = vec3<f32>(0.0, x, c);
    } else if (h < 5.0) {
        rgb = vec3<f32>(x, 0.0, c);
    } else {
        rgb = vec3<f32>(c, 0.0, x);
    }

    return rgb + vec3<f32>(m);
}

// RGB to HSV conversion
fn rgb2hsv(rgb: vec3<f32>) -> vec3<f32> {
    let maxVal = max(max(rgb.r, rgb.g), rgb.b);
    let minVal = min(min(rgb.r, rgb.g), rgb.b);
    let delta = maxVal - minVal;

    var h = 0.0;
    if delta == 0.0 {
        h = 0.0;
    } else if maxVal == rgb.r {
        h = ((rgb.g - rgb.b) / delta) % 6.0;
    } else if maxVal == rgb.g {
        h = (rgb.b - rgb.r) / delta + 2.0;
    } else {
        h = (rgb.r - rgb.g) / delta + 4.0;
    };

    var s = 0.0;
    if maxVal != 0.0 {
        s = delta / maxVal;
    }
    let v = maxVal;

    return vec3<f32>(h / 6.0, s, v);
}

@fragment
fn main(@location(0) texCoord: vec2f) -> @location(0) vec4f {
    let x = u32(texCoord.x * f32(params.width));
    let y = u32((1.0 - texCoord.y) * f32(params.height));

    if (x >= params.width || y >= params.height) {
        return vec4f(0.0, 0.0, 0.0, 1.0);
    }

    let baseIndex = computeIndex(params, x, y);

    // Check if this is a boundary/wall
    let isBoundary = x == 0u || y == 0u || x == params.width - 1u || y == params.height - 1u;
    if (isBoundary) {
        return vec4f(0.2, 0.2, 0.2, 1.0); // Gray color for boundaries
    }

    // Extract macroscopic quantities
    let rho = values[baseIndex + 9];

    // let vx = values[baseIndex + 10];
    // let vy = values[baseIndex + 11];
    // let velocity = vec2<f32>(vx, vy);

    // Scale the density for visualization
    let normalizedDensity = (rho - 0.9) * 5.0; // Magic numbers.
    let densityFactor = clamp(normalizedDensity, 0.0, 1.0);

    // Display just the density.
    let color = generateColour(densityFactor);
    return vec4<f32>(color, 1.0);
}

const PI: f32 = 3.14159;
const TWO_PI: f32 = 2.0 * PI;

fn generateColour(t: f32) -> vec3<f32> {
    let scaledT = t * 0.8 + 0.1;

    let pi = 3.14159;
    let constant = vec3<f32>(0.73, 0.81, 0.94);
    let multi    = vec3<f32>(0.96, 0.70, 0.75);
    let repeat   = vec3<f32>(1.00, 1.00, 0.00);
    let phase    = vec3<f32>(0.13, 0.93, 0.69);

    return constant + multi * cos(2 * pi * (scaledT * repeat + phase));
}

// Helper function to interpolate between two colors in HSV space
fn lerp_color(a: vec3<f32>, b: vec3<f32>, t: f32) -> vec3<f32> {
    let hsvA = rgb2hsv(a);
    let hsvB = rgb2hsv(b);

    // Interpolate in HSV space
    let h = mix(hsvA.x, hsvB.x, t);
    let s = mix(hsvA.y, hsvB.y, t);
    let v = mix(hsvA.z, hsvB.z, t);

    return hsv2rgb(vec3<f32>(h, s, v));
}

// Map normalized density to a color gradient
fn density_to_color(density: f32) -> vec3<f32> {
    // Define gradient stops
    let c0 = vec3<f32>(0.116, 0.274, 0.500);
    let c1 = vec3<f32>(0.587, 0.471, 0.856);
    let c2 = vec3<f32>(0.876, 0.195, 0.892);

    return lerp_color(c2, c1, density);
}
