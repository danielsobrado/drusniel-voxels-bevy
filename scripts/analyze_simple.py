#!/usr/bin/env python3
"""
Simple GLTF/GLB Model Analyzer - outputs to a file
"""

import json
import struct
from pathlib import Path


def read_glb(filepath):
    with open(filepath, "rb") as f:
        magic = f.read(4)
        if magic != b"glTF":
            raise ValueError(f"Not a valid GLB file")
        
        version = struct.unpack("<I", f.read(4))[0]
        total_length = struct.unpack("<I", f.read(4))[0]
        
        chunk_length = struct.unpack("<I", f.read(4))[0]
        chunk_type = f.read(4)
        
        if chunk_type != b"JSON":
            raise ValueError("First chunk is not JSON")
        
        json_data = f.read(chunk_length).decode("utf-8").rstrip("\x00")
        gltf = json.loads(json_data)
        
        binary_data = None
        if f.tell() < total_length:
            chunk_length = struct.unpack("<I", f.read(4))[0]
            chunk_type = f.read(4)
            if chunk_type == b"BIN\x00":
                binary_data = f.read(chunk_length)
        
        return gltf, binary_data


def analyze_model(filepath):
    gltf, _ = read_glb(filepath)
    
    global_min = [float("inf")] * 3
    global_max = [float("-inf")] * 3
    
    for mesh in gltf.get("meshes", []):
        for primitive in mesh.get("primitives", []):
            if "POSITION" in primitive.get("attributes", {}):
                pos_accessor_idx = primitive["attributes"]["POSITION"]
                accessor = gltf["accessors"][pos_accessor_idx]
                
                if "min" in accessor and "max" in accessor:
                    for i in range(3):
                        global_min[i] = min(global_min[i], accessor["min"][i])
                        global_max[i] = max(global_max[i], accessor["max"][i])
    
    return global_min, global_max


# Analyze multiple models and write to file
models_dir = Path("assets/models/plants/custom")
output_lines = []

output_lines.append("=" * 60)
output_lines.append("GLTF Model Bounds Analysis")
output_lines.append("=" * 60)

for glb in sorted(models_dir.glob("*.glb")):
    try:
        gmin, gmax = analyze_model(glb)
        if gmin[0] != float("inf"):
            height = gmax[1] - gmin[1]
            suggested_offset = -gmin[1]
            output_lines.append("")
            output_lines.append(f"File: {glb.name}")
            output_lines.append(f"  Y_MIN (bottom): {gmin[1]:.4f}")
            output_lines.append(f"  Y_MAX (top):    {gmax[1]:.4f}")
            output_lines.append(f"  Height:         {height:.4f}")
            output_lines.append(f"  SUGGESTED y_offset: {suggested_offset:.4f}")
    except Exception as e:
        output_lines.append(f"Error: {glb.name}: {e}")

output_lines.append("")
output_lines.append("=" * 60)

# Write to file
with open("model_analysis_results.txt", "w") as f:
    f.write("\n".join(output_lines))

print("Results written to model_analysis_results.txt")
