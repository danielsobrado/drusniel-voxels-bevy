use bevy::asset::LoadState;
use bevy::gltf::Gltf;
use bevy::prelude::*;

const SAMPLE_GLTF: &str =
    "models/vegetation/trees/ultimate_stylized_nature/BirchTree_1.gltf";

#[derive(Resource)]
struct GltfCheck {
    handle: Handle<Gltf>,
}

fn setup(mut commands: Commands, asset_server: Res<AssetServer>) {
    let handle = asset_server.load(SAMPLE_GLTF);
    commands.insert_resource(GltfCheck { handle });
}

fn poll_load(
    check: Res<GltfCheck>,
    asset_server: Res<AssetServer>,
    mut exit: MessageWriter<AppExit>,
) {
    match asset_server.get_load_state(&check.handle) {
        Some(LoadState::Loaded) => {
            info!("Loaded sample glTF: {SAMPLE_GLTF}");
            exit.write(AppExit::Success);
        }
        Some(LoadState::Failed(_)) => {
            error!("Failed to load sample glTF: {SAMPLE_GLTF}");
            exit.write(AppExit::error());
        }
        _ => {}
    }
}

fn main() {
    App::new()
        .add_plugins(DefaultPlugins.set(WindowPlugin {
            primary_window: Some(Window {
                visible: false,
                ..default()
            }),
            ..default()
        }))
        .add_systems(Startup, setup)
        .add_systems(Update, poll_load)
        .run();
}
