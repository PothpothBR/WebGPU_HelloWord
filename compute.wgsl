@group(0) @binding(0) var<uniform> grid: vec2f;
@group(0) @binding(1) var<storage> in: array<u32>;
@group(0) @binding(2) var<storage, read_write> out: array<u32>;
@group(0) @binding(3) var<storage, read_write> cellFlip: vec2u;

fn cellIndex(cell: vec2u) -> u32 {
    return (cell.y % u32(grid.y)) * u32(grid.x) + (cell.x % u32(grid.x));
}

fn cellActive(x: u32, y: u32) -> u32 {
    return in[cellIndex(vec2(x, y))];
}

@compute @workgroup_size(8, 8)
fn computeMain(@builtin(global_invocation_id) cell: vec3u) {
    let i = cellIndex(cell.xy);

    if (cell.x == cellFlip.x && cell.y == cellFlip.y) {
        out[i] = 1;
        return;
    }
    
    let activeNeighbors = (
        cellActive(cell.x+1, cell.y+1) +
        cellActive(cell.x+1, cell.y) +
        cellActive(cell.x+1, cell.y-1) +
        cellActive(cell.x, cell.y-1) +
        cellActive(cell.x-1, cell.y-1) +
        cellActive(cell.x-1, cell.y) +
        cellActive(cell.x-1, cell.y+1) +
        cellActive(cell.x, cell.y+1)
    );

    switch activeNeighbors {
        case 2: { out[i] = in[i]; }
        case 3: { out[i] = 1; }
        default: { out[i] = 0; }
    }
}