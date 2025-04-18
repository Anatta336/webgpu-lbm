struct VertexOut {
    @builtin(position) position: vec4f,
    @location(0) texCoord: vec2f,
}

@vertex
fn main(@builtin(vertex_index) vertexIndex: u32) -> VertexOut {
    // Triangle that fills whole screen by expanding above and to the right.
    let pos = array(
        vec2f(-1.0, -1.0),  // bottom left
        vec2f( 3.0, -1.0),  // bottom right + 2 units (off screen)
        vec2f(-1.0,  3.0)   // top left + 2 units (off screen)
    );

    let texCoords = array(
        vec2f(0.0, 0.0),  // bottom left
        vec2f(2.0, 0.0),  // bottom right
        vec2f(0.0, 2.0)   // top left
    );

    var output: VertexOut;
    output.position = vec4f(pos[vertexIndex], 0.0, 1.0);
    output.texCoord = texCoords[vertexIndex];
    return output;
}