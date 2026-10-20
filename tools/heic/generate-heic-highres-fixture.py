#!/usr/bin/env python3
"""Generate synthetic 24.47MP RGB PNG. Never uses any user photo or metadata."""
import pathlib
import struct
import sys
import zlib

WIDTH, HEIGHT = 4284, 5712

def write_chunk(handle, name, data):
    handle.write(struct.pack(">I", len(data)))
    handle.write(name)
    handle.write(data)
    handle.write(struct.pack(">I", zlib.crc32(name + data) & 0xffffffff))

def main():
    if len(sys.argv) != 2:
        raise SystemExit("Usage: generate-heic-highres-fixture.py OUTPUT.png")
    target = pathlib.Path(sys.argv[1])
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("wb") as handle:
        handle.write(b"\x89PNG\r\n\x1a\n")
        write_chunk(handle, b"IHDR", struct.pack(">IIBBBBB", WIDTH, HEIGHT, 8, 2, 0, 0, 0))
        compressor = zlib.compressobj(level=2)
        for y in range(HEIGHT):
            left = (235, 40, 40) if y < HEIGHT // 2 else (40, 70, 235)
            right = (45, 210, 70) if y < HEIGHT // 2 else (230, 210, 30)
            row = b"\x00" + bytes(left) * (WIDTH // 2) + bytes(right) * (WIDTH - WIDTH // 2)
            compressed = compressor.compress(row)
            if compressed:
                write_chunk(handle, b"IDAT", compressed)
        final = compressor.flush()
        if final:
            write_chunk(handle, b"IDAT", final)
        write_chunk(handle, b"IEND", b"")
    print("Synthetic PNG:", target, WIDTH, HEIGHT, target.stat().st_size, "bytes")

if __name__ == "__main__":
    main()
