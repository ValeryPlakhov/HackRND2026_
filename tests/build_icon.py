"""Rasterize the repository's simple blueprint mark as a Windows ICO, stdlib only."""
from pathlib import Path
import math
import struct

ROOT = Path(__file__).resolve().parents[1]

def rounded_distance(x, y, box, radius):
    left, top, right, bottom = box
    qx = abs(x - (left + right) / 2) - (right - left) / 2 + radius
    qy = abs(y - (top + bottom) / 2) - (bottom - top) / 2 + radius
    return min(max(qx, qy), 0) + math.hypot(max(qx, 0), max(qy, 0)) - radius

def line_distance(x, y, line):
    ax, ay, bx, by = line
    dx, dy = bx - ax, by - ay
    t = max(0, min(1, ((x-ax)*dx + (y-ay)*dy)/(dx*dx+dy*dy)))
    return math.hypot(x-ax-t*dx, y-ay-t*dy)

def pixel(x, y):
    if rounded_distance(x, y, (0, 0, 48, 48), 13) > 0:
        return (0, 0, 0, 0)
    boxes = [(17, 8, 31, 17), (6, 31, 20, 40), (28, 31, 42, 40)]
    lines = [(24, 17, 24, 24), (13, 24, 35, 24), (13, 24, 13, 31), (35, 24, 35, 31)]
    white = any(abs(rounded_distance(x, y, box, 2)) < 1.35 for box in boxes)
    white = white or any(line_distance(x, y, line) < 1.35 for line in lines)
    return (255, 255, 255, 255) if white else (223, 103, 55, 255)

def image(size):
    pixels = bytearray()
    for row in reversed(range(size)):
        for column in range(size):
            samples = [pixel((column + dx) * 48 / size, (row + dy) * 48 / size)
                       for dx, dy in [(0.25,0.25),(0.75,0.25),(0.25,0.75),(0.75,0.75)]]
            pixels.extend(round(sum(sample[channel] for sample in samples)/4) for channel in range(4))
    mask = bytes(((size + 31)//32)*4*size)
    header = struct.pack('<IiiHHIIiiII', 40, size, size*2, 1, 32, 0, len(pixels)+len(mask), 0, 0, 0, 0)
    return header + pixels + mask

def main():
    sizes = [16, 32, 48, 64, 256]
    images = [image(size) for size in sizes]
    directory = bytearray(struct.pack('<HHH', 0, 1, len(sizes)))
    offset = 6 + 16 * len(sizes)
    for size, data in zip(sizes, images):
        directory.extend(struct.pack('<BBBBHHII', size % 256, size % 256, 0, 0, 1, 32, len(data), offset))
        offset += len(data)
    target = ROOT / 'desktop/assets/blueprints.ico'
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(bytes(directory) + b''.join(images))
    print(target)

if __name__ == '__main__':
    main()
