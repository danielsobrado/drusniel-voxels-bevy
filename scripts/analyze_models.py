#!/usr/bin/env python3
"""
GLTF/GLB Model Analyzer
Analyzes 3D models to extract bounding box and origin information.
This helps determine correct y_offset values for prop placement.
"""

import json
import struct
import sys
from pathlib import Path


def read_glb(filepath: Path) -> dict:
    """Read a GLB file and extract the JSON and binary chunks."""
    with open(filepath, "rb") as f:
        # GLB Header: magic (4) + version (4) + length (4)
        magic = f.read(4)
        if magic != b"glTF":
            raise ValueError(f"Not a valid GLB file: {filepath}")
        
        version = struct.unpack("<I", f.read(4))[0]
        total_length = struct.unpack("<I", f.read(4))[0]
        
        # First chunk should be JSON
        chunk_length = struct.unpack("<I", f.read(4))[0]
        chunk_type = f.read(4)
        
        if chunk_type != b"JSON":
            raise ValueError("First chunk is not JSON")
        
        json_data = f.read(chunk_length).decode("utf-8").rstrip("\x00")
        gltf = json.loads(json_data)
        
        # Read binary chunk if present
        binary_data = None
        if f.tell() < total_length:
            chunk_length = struct.unpack("<I", f.read(4))[0]
            chunk_type = f.read(4)
            if chunk_type == b"BIN\x00":
                binary_data = f.read(chunk_length)
        
        return gltf, binary_data


def read_gltf(filepath: Path) -> dict:
    """Read a GLTF file."""
    with open(filepath, "r") as f:
        return json.load(f), None


def get_accessor_data(gltf: dict, binary_data: bytes, accessor_idx: int) -> list:
    """Extract data from an accessor."""
    if binary_data is None:
        return []
    
    accessor = gltf["accessors"][accessor_idx]
    buffer_view = gltf["bufferViews"][accessor["bufferView"]]
    
    offset = buffer_view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
    count = accessor["count"]
    
    # Component type sizes
    component_sizes = {
        5120: 1,  # BYTE
        5121: 1,  # UNSIGNED_BYTE
        5122: 2,  # SHORT
        5123: 2,  # UNSIGNED_SHORT
        5125: 4,  # UNSIGNED_INT
        5126: 4,  # FLOAT
    }
    
    # Type element counts
    type_counts = {
        "SCALAR": 1,
        "VEC2": 2,
        "VEC3": 3,
        "VEC4": 4,
        "MAT4": 16,
    }
    
    component_type = accessor["componentType"]
    accessor_type = accessor["type"]
    
    component_size = component_sizes.get(component_type, 4)
    element_count = type_counts.get(accessor_type, 1)
    
    # Format string for struct
    format_chars = {
        5120: "b",
        5121: "B",
        5122: "h",
        5123: "H",
        5125: "I",
        5126: "f",
    }
    format_char = format_chars.get(component_type, "f")
    
    data = []
    for i in range(count):
        element_offset = offset + i * component_size * element_count
        element = []
        for j in range(element_count):
            value = struct.unpack_from(
                f"<{format_char}",
                binary_data,
                element_offset + j * component_size
            )[0]
            element.append(value)
        data.append(element if element_count > 1 else element[0])
    
    return data


def analyze_model(filepath: Path) -> dict:
    """Analyze a GLTF/GLB model and extract bounds info."""
    if filepath.suffix.lower() == ".glb":
        gltf, binary_data = read_glb(filepath)
    else:
        gltf, binary_data = read_gltf(filepath)
    
    result = {
        "file": filepath.name,
        "meshes": [],
        "global_min": [float("inf")] * 3,
        "global_max": [float("-inf")] * 3,
    }
    
    # Analyze each mesh
    for mesh_idx, mesh in enumerate(gltf.get("meshes", [])):
        mesh_info = {
            "name": mesh.get("name", f"mesh_{mesh_idx}"),
            "primitives": [],
        }
        
        for prim_idx, primitive in enumerate(mesh.get("primitives", [])):
            prim_info = {
                "index": prim_idx,
                "vertex_count": 0,
                "bounds": None,
            }
            
            # Get position accessor
            if "POSITION" in primitive.get("attributes", {}):
                pos_accessor_idx = primitive["attributes"]["POSITION"]
                accessor = gltf["accessors"][pos_accessor_idx]
                
                prim_info["vertex_count"] = accessor["count"]
                
                # Check for precomputed min/max
                if "min" in accessor and "max" in accessor:
                    prim_info["bounds"] = {
                        "min": accessor["min"],
                        "max": accessor["max"],
                    }
                    
                    # Update global bounds
                    for i in range(3):
                        result["global_min"][i] = min(result["global_min"][i], accessor["min"][i])
                        result["global_max"][i] = max(result["global_max"][i], accessor["max"][i])
                
                elif binary_data:
                    # Compute bounds from vertex data
                    positions = get_accessor_data(gltf, binary_data, pos_accessor_idx)
                    if positions:
                        min_pos = [float("inf")] * 3
                        max_pos = [float("-inf")] * 3
                        
                        for pos in positions:
                            for i in range(3):
                                min_pos[i] = min(min_pos[i], pos[i])
                                max_pos[i] = max(max_pos[i], pos[i])
                        
                        prim_info["bounds"] = {
                            "min": min_pos,
                            "max": max_pos,
                        }
                        
                        for i in range(3):
                            result["global_min"][i] = min(result["global_min"][i], min_pos[i])
                            result["global_max"][i] = max(result["global_max"][i], max_pos[i])
            
            mesh_info["primitives"].append(prim_info)
        
        result["meshes"].append(mesh_info)
    
    # Calculate derived values
    if result["global_min"][0] != float("inf"):
        result["size"] = [
            result["global_max"][i] - result["global_min"][i]
            for i in range(3)
        ]
        result["center"] = [
            (result["global_max"][i] + result["global_min"][i]) / 2
            for i in range(3)
        ]
        # Y offset needed to place bottom at origin
        result["suggested_y_offset"] = -result["global_min"][1]
    else:
        result["size"] = None
        result["center"] = None
        result["suggested_y_offset"] = None
    
    return result


def main():
    if len(sys.argv) < 2:
        print("Usage: python analyze_models.py <model_path_or_directory>")
        sys.exit(1)
    
    target = Path(sys.argv[1])
    
    if target.is_file():
        files = [target]
    else:
        files = list(target.glob("**/*.glb")) + list(target.glob("**/*.gltf"))
    
    print("=" * 80)
    print("GLTF/GLB Model Analysis Report")
    print("=" * 80)
    
    for filepath in sorted(files):
        try:
            result = analyze_model(filepath)
            
            print(f"\n{'-' * 40}")
            print(f"File: {result['file']}")
            print(f"  Meshes: {len(result['meshes'])}")
            
            if result["size"]:
                print(f"  Bounding Box:")
                print(f"    Min: X={result['global_min'][0]:.4f}, Y={result['global_min'][1]:.4f}, Z={result['global_min'][2]:.4f}")
                print(f"    Max: X={result['global_max'][0]:.4f}, Y={result['global_max'][1]:.4f}, Z={result['global_max'][2]:.4f}")
                print(f"  Size: W={result['size'][0]:.4f}, H={result['size'][1]:.4f}, D={result['size'][2]:.4f}")
                print(f"  Center: X={result['center'][0]:.4f}, Y={result['center'][1]:.4f}, Z={result['center'][2]:.4f}")
                print(f"  Y_MIN (bottom): {result['global_min'][1]:.4f}")
                print(f"  SUGGESTED y_offset (to ground bottom): {result['suggested_y_offset']:.4f}")
            else:
                print("  Could not determine bounds")
            
        except Exception as e:
            print(f"\nError analyzing {filepath}: {e}")
    
    print("\n" + "=" * 80)
    print("Analysis complete")


if __name__ == "__main__":
    main()
