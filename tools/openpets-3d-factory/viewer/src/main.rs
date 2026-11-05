use bevy::{asset::AssetPlugin, prelude::*};
use std::{env, path::Path};

fn main() {
    let model = env::args()
        .nth(1)
        .unwrap_or_else(|| "var/openpets/lucy-refantasia-blockout.glb".to_string());
    if !Path::new(&model).is_file() {
        eprintln!("GLB not found: {model}; build it first with the factory CLI.");
        std::process::exit(2);
    }
    let model_path = Path::new(&model)
        .canonicalize()
        .expect("GLB path must resolve to a local file");
    let asset_root = model_path
        .parent()
        .expect("GLB must have a parent directory")
        .to_string_lossy()
        .replace('\\', "/");
    let asset_name = model_path
        .file_name()
        .expect("GLB path must have a filename")
        .to_string_lossy()
        .to_string();
    App::new()
        .insert_resource(ClearColor(Color::srgb(0.10, 0.08, 0.12)))
        .add_plugins(DefaultPlugins.set(AssetPlugin {
            file_path: asset_root,
            ..default()
        }))
        .add_systems(
            Startup,
            move |mut commands: Commands, asset_server: Res<AssetServer>| {
                commands.spawn((
                    Camera3d::default(),
                    Transform::from_xyz(0.0, 1.7, 6.6)
                        .looking_at(Vec3::new(0.0, 1.5, 0.0), Vec3::Y),
                ));
                commands.spawn((
                    DirectionalLight {
                        illuminance: 12_000.0,
                        shadow_maps_enabled: true,
                        ..default()
                    },
                    Transform::from_xyz(3.0, 6.0, 4.0)
                        .looking_at(Vec3::new(0.0, 1.4, 0.0), Vec3::Y),
                ));
                commands.spawn(WorldAssetRoot(
                    asset_server.load(GltfAssetLabel::Scene(0).from_asset(asset_name.clone())),
                ));
            },
        )
        .run();
}
