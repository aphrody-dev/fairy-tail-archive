use serde::Deserialize;
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{env, fs, path::Path};

#[derive(Deserialize)]
struct Manifest {
    schema_version: u32,
    asset_id: String,
    display_name: String,
    status: String,
    palette: Palette,
}

#[derive(Deserialize)]
struct Palette {
    skin: [f32; 4],
    hair: [f32; 4],
    towel: [f32; 4],
    cloth_shadow: [f32; 4],
}

#[derive(Default)]
struct Geometry {
    positions: Vec<[f32; 3]>,
    normals: Vec<[f32; 3]>,
    colors: Vec<[f32; 4]>,
    indices: Vec<u16>,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = env::args().collect();
    if args.len() != 4 || !matches!(args[1].as_str(), "build" | "verify") {
        eprintln!("usage: openpets-3d-factory <build|verify> <manifest.json> <output.glb>");
        std::process::exit(2);
    }
    let manifest_bytes = fs::read(&args[2])?;
    let manifest: Manifest = serde_json::from_slice(&manifest_bytes)?;
    if manifest.schema_version != 1 || manifest.status != "blockout" {
        return Err("unsupported manifest schema or non-blockout generator profile".into());
    }
    let first = build_glb(&manifest)?;
    let second = build_glb(&manifest)?;
    let deterministic = first == second;
    if !deterministic {
        return Err("same manifest produced different GLB bytes".into());
    }
    let parsed = gltf::Gltf::from_slice(&first)?;
    let mesh_count = parsed.meshes().count();
    let animation_count = parsed.animations().count();
    let skin_count = parsed.skins().count();
    let status = if mesh_count > 0 && skin_count > 0 && animation_count >= 2 {
        "structure-complete-unqualified"
    } else {
        "blockout-incomplete"
    };
    if args[1] == "verify" {
        let disk_bytes = fs::read(&args[3])?;
        if disk_bytes != first {
            return Err("on-disk GLB does not match a fresh build from this manifest".into());
        }
        println!(
            "{{\"status\":\"{status}\",\"deterministic\":{deterministic},\"onDiskMatches\":true,\"bytes\":{},\"meshes\":{mesh_count},\"skins\":{skin_count},\"animations\":{animation_count},\"sha256\":\"{}\"}}",
            first.len(),
            hex(&Sha256::digest(&first))
        );
        return Ok(());
    }
    let output = Path::new(&args[3]);
    if let Some(parent) = output.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(output, &first)?;
    let report = json!({
        "schemaVersion": 1,
        "assetId": manifest.asset_id,
        "displayName": manifest.display_name,
        "status": status,
        "deterministicForManifest": deterministic,
        "manifestSha256": hex(&Sha256::digest(&manifest_bytes)),
        "glbSha256": hex(&Sha256::digest(&first)),
        "glbBytes": first.len(),
        "meshCount": mesh_count,
        "skinCount": skin_count,
        "animationCount": animation_count,
        "sourcePixelsEmbedded": false,
        "qualification": {
            "gltfRoundTrip": "passed",
            "khronosValidator": "not-run",
            "visualReview": "not-run",
            "openPetsValidation": "not-run"
        }
    });
    let report_path = output.with_extension("report.json");
    fs::write(&report_path, serde_json::to_vec_pretty(&report)?)?;
    println!("{}", serde_json::to_string(&report)?);
    Ok(())
}

fn build_glb(manifest: &Manifest) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
    let mut geometry = Geometry::default();
    // Source-guided procedural blockout: raised bent arms, the visible towel,
    // blond hair masses and closed-eye expression. This is still not a final
    // sculpt, semantic vector trace, or deforming cloth rig.
    ellipsoid(
        &mut geometry,
        [0.0, 1.36, 0.0],
        [0.43, 0.72, 0.30],
        manifest.palette.towel,
        16,
        24,
    );
    ellipsoid(
        &mut geometry,
        [0.0, 2.25, 0.02],
        [0.35, 0.40, 0.30],
        manifest.palette.skin,
        16,
        24,
    );
    ellipsoid(
        &mut geometry,
        [0.0, 2.53, -0.02],
        [0.48, 0.26, 0.37],
        manifest.palette.towel,
        12,
        24,
    );
    ellipsoid(
        &mut geometry,
        [-0.42, 2.23, 0.02],
        [0.13, 0.40, 0.17],
        manifest.palette.towel,
        12,
        16,
    );
    ellipsoid(
        &mut geometry,
        [0.42, 2.23, 0.02],
        [0.13, 0.40, 0.17],
        manifest.palette.towel,
        12,
        16,
    );
    ellipsoid(
        &mut geometry,
        [0.0, 1.76, -0.15],
        [0.35, 0.66, 0.16],
        manifest.palette.hair,
        16,
        24,
    );
    ellipsoid(
        &mut geometry,
        [-0.50, 2.02, 0.08],
        [0.18, 0.62, 0.16],
        manifest.palette.hair,
        16,
        16,
    );
    ellipsoid(
        &mut geometry,
        [0.50, 2.02, 0.08],
        [0.13, 0.62, 0.13],
        manifest.palette.hair,
        16,
        16,
    );
    ellipsoid(
        &mut geometry,
        [-0.10, 2.39, 0.27],
        [0.11, 0.20, 0.08],
        manifest.palette.hair,
        12,
        14,
    );
    ellipsoid(
        &mut geometry,
        [0.12, 2.37, 0.27],
        [0.10, 0.19, 0.08],
        manifest.palette.hair,
        12,
        14,
    );
    let ink = [0.18, 0.13, 0.12, 1.0];
    ellipsoid(
        &mut geometry,
        [-0.14, 2.31, 0.305],
        [0.09, 0.012, 0.012],
        ink,
        8,
        12,
    );
    ellipsoid(
        &mut geometry,
        [0.14, 2.31, 0.305],
        [0.09, 0.012, 0.012],
        ink,
        8,
        12,
    );
    ellipsoid(
        &mut geometry,
        [0.0, 2.13, 0.31],
        [0.075, 0.018, 0.012],
        ink,
        8,
        12,
    );
    // Raised arm masses, hands and cropped-view leg placeholders are kept as
    // separate color regions in the same deterministic blockout mesh.
    ellipsoid_angled(
        &mut geometry,
        [-0.52, 2.10, 0.0],
        [0.15, 0.38, 0.14],
        manifest.palette.skin,
        12,
        16,
        0.71,
    );
    ellipsoid_angled(
        &mut geometry,
        [-0.70, 2.57, 0.06],
        [0.14, 0.30, 0.14],
        manifest.palette.skin,
        12,
        16,
        -0.22,
    );
    ellipsoid(
        &mut geometry,
        [-0.65, 2.82, 0.16],
        [0.15, 0.18, 0.13],
        manifest.palette.skin,
        10,
        14,
    );
    ellipsoid_angled(
        &mut geometry,
        [0.52, 2.10, 0.0],
        [0.15, 0.38, 0.14],
        manifest.palette.skin,
        12,
        16,
        -0.71,
    );
    ellipsoid_angled(
        &mut geometry,
        [0.70, 2.57, 0.06],
        [0.14, 0.30, 0.14],
        manifest.palette.skin,
        12,
        16,
        0.22,
    );
    ellipsoid(
        &mut geometry,
        [0.65, 2.82, 0.16],
        [0.15, 0.18, 0.13],
        manifest.palette.skin,
        10,
        14,
    );
    ellipsoid(
        &mut geometry,
        [-0.30, 0.72, 0.01],
        [0.19, 0.55, 0.16],
        manifest.palette.skin,
        12,
        16,
    );
    ellipsoid(
        &mut geometry,
        [0.30, 0.72, 0.01],
        [0.19, 0.55, 0.16],
        manifest.palette.skin,
        12,
        16,
    );
    ellipsoid(
        &mut geometry,
        [0.0, 1.15, 0.31],
        [0.12, 0.35, 0.04],
        manifest.palette.cloth_shadow,
        8,
        12,
    );
    let bytes_per_position = geometry.positions.len() * 12;
    let bytes_per_normal = geometry.normals.len() * 12;
    let bytes_per_color = geometry.colors.len() * 16;
    let mut binary = Vec::new();
    for p in &geometry.positions {
        for n in p {
            binary.extend(n.to_le_bytes());
        }
    }
    pad4(&mut binary);
    for p in &geometry.normals {
        for n in p {
            binary.extend(n.to_le_bytes());
        }
    }
    pad4(&mut binary);
    for p in &geometry.colors {
        for n in p {
            binary.extend(n.to_le_bytes());
        }
    }
    pad4(&mut binary);
    let index_offset = binary.len();
    for i in &geometry.indices {
        binary.extend(i.to_le_bytes());
    }
    pad4(&mut binary);
    let max = geometry
        .positions
        .iter()
        .fold([f32::NEG_INFINITY; 3], |mut a, p| {
            for i in 0..3 {
                a[i] = a[i].max(p[i]);
            }
            a
        });
    let min = geometry
        .positions
        .iter()
        .fold([f32::INFINITY; 3], |mut a, p| {
            for i in 0..3 {
                a[i] = a[i].min(p[i]);
            }
            a
        });
    let json_doc = json!({
        "asset": {"version":"2.0", "generator":"openpets-3d-factory/0.1.0"},
        "scene": 0,
        "scenes": [{"name":"Lucy source blockout", "nodes":[0]}],
        "nodes": [{"name":"Lucy_Blockout_Mesh", "mesh":0}],
        "meshes": [{"name":"Lucy_Blockout", "primitives":[{"attributes":{"POSITION":0,"NORMAL":1,"COLOR_0":2},"indices":3,"material":0,"mode":4}]}],
        "materials": [{"name":"Source palette blockout", "pbrMetallicRoughness":{"baseColorFactor":[1.0,1.0,1.0,1.0],"metallicFactor":0.0,"roughnessFactor":0.92},"doubleSided":true}],
        "buffers": [{"byteLength":binary.len()}],
        "bufferViews": [
            {"buffer":0,"byteOffset":0,"byteLength":bytes_per_position,"target":34962},
            {"buffer":0,"byteOffset":bytes_per_position,"byteLength":bytes_per_normal,"target":34962},
            {"buffer":0,"byteOffset":bytes_per_position+bytes_per_normal,"byteLength":bytes_per_color,"target":34962},
            {"buffer":0,"byteOffset":index_offset,"byteLength":geometry.indices.len()*2,"target":34963}
        ],
        "accessors": [
            {"bufferView":0,"componentType":5126,"count":geometry.positions.len(),"type":"VEC3","min":min,"max":max},
            {"bufferView":1,"componentType":5126,"count":geometry.normals.len(),"type":"VEC3"},
            {"bufferView":2,"componentType":5126,"count":geometry.colors.len(),"type":"VEC4"},
            {"bufferView":3,"componentType":5123,"count":geometry.indices.len(),"type":"SCALAR"}
        ],
        "extras":{"assetId":manifest.asset_id,"status":"blockout","sourceArtworkEmbedded":false}
    });
    let mut json_bytes = serde_json::to_vec(&json_doc)?;
    pad_json(&mut json_bytes);
    let total_len = 12 + 8 + json_bytes.len() + 8 + binary.len();
    let mut glb = Vec::with_capacity(total_len);
    glb.extend(0x46546C67u32.to_le_bytes());
    glb.extend(2u32.to_le_bytes());
    glb.extend((total_len as u32).to_le_bytes());
    glb.extend((json_bytes.len() as u32).to_le_bytes());
    glb.extend(0x4E4F534Au32.to_le_bytes());
    glb.extend(json_bytes);
    glb.extend((binary.len() as u32).to_le_bytes());
    glb.extend(0x004E4942u32.to_le_bytes());
    glb.extend(binary);
    Ok(glb)
}

fn ellipsoid(
    g: &mut Geometry,
    center: [f32; 3],
    radius: [f32; 3],
    color: [f32; 4],
    lat: usize,
    lon: usize,
) {
    ellipsoid_angled(g, center, radius, color, lat, lon, 0.0);
}

fn ellipsoid_angled(
    g: &mut Geometry,
    center: [f32; 3],
    radius: [f32; 3],
    color: [f32; 4],
    lat: usize,
    lon: usize,
    angle_z: f32,
) {
    let base = g.positions.len() as u16;
    let (sin, cos) = angle_z.sin_cos();
    for y in 0..=lat {
        let theta = std::f32::consts::PI * y as f32 / lat as f32;
        for x in 0..=lon {
            let phi = std::f32::consts::TAU * x as f32 / lon as f32;
            let unit = [
                theta.sin() * phi.cos(),
                theta.cos(),
                theta.sin() * phi.sin(),
            ];
            let local_x = unit[0] * radius[0];
            let local_y = unit[1] * radius[1];
            g.positions.push([
                center[0] + local_x * cos - local_y * sin,
                center[1] + local_x * sin + local_y * cos,
                center[2] + unit[2] * radius[2],
            ]);
            let mut normal = [
                unit[0] / radius[0],
                unit[1] / radius[1],
                unit[2] / radius[2],
            ];
            let length =
                (normal[0] * normal[0] + normal[1] * normal[1] + normal[2] * normal[2]).sqrt();
            for n in &mut normal {
                *n /= length;
            }
            normal = [
                normal[0] * cos - normal[1] * sin,
                normal[0] * sin + normal[1] * cos,
                normal[2],
            ];
            g.normals.push(normal);
            g.colors.push(color);
        }
    }
    for y in 0..lat {
        for x in 0..lon {
            let a = base + (y * (lon + 1) + x) as u16;
            let b = a + (lon + 1) as u16;
            g.indices.extend([a, a + 1, b, b, a + 1, b + 1]);
        }
    }
}

fn pad4(bytes: &mut Vec<u8>) {
    while bytes.len() % 4 != 0 {
        bytes.push(0);
    }
}
fn pad_json(bytes: &mut Vec<u8>) {
    while bytes.len() % 4 != 0 {
        bytes.push(0x20);
    }
}
fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
