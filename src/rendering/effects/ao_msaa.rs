use bevy::pbr::ScreenSpaceAmbientOcclusion;
use bevy::prelude::*;

use crate::rendering::gtao::GtaoSettings;

pub fn disable_msaa_for_screen_space_ao(
    mut cameras: Query<
        (
            Entity,
            &mut Msaa,
            Option<&ScreenSpaceAmbientOcclusion>,
            Option<&GtaoSettings>,
        ),
        With<Camera3d>,
    >,
) {
    for (entity, mut msaa, ssao, gtao) in cameras.iter_mut() {
        if (ssao.is_some() || gtao.is_some()) && *msaa != Msaa::Off {
            warn!(
                "Disabling MSAA on camera {:?}: screen-space ambient occlusion requires Msaa::Off",
                entity
            );
            *msaa = Msaa::Off;
        }
    }
}

#[cfg(test)]
mod tests {
    use bevy::pbr::ScreenSpaceAmbientOcclusion;
    use bevy::prelude::*;

    use super::*;

    #[test]
    fn gtao_camera_msaa_is_forced_off() {
        let mut app = App::new();
        let camera = app
            .world_mut()
            .spawn((Camera3d::default(), Msaa::Sample4, GtaoSettings::default()))
            .id();

        app.add_systems(Update, disable_msaa_for_screen_space_ao);
        app.update();

        assert_eq!(app.world().get::<Msaa>(camera), Some(&Msaa::Off));
    }

    #[test]
    fn ssao_camera_msaa_is_forced_off() {
        let mut app = App::new();
        let camera = app
            .world_mut()
            .spawn((
                Camera3d::default(),
                Msaa::Sample4,
                ScreenSpaceAmbientOcclusion::default(),
            ))
            .id();

        app.add_systems(Update, disable_msaa_for_screen_space_ao);
        app.update();

        assert_eq!(app.world().get::<Msaa>(camera), Some(&Msaa::Off));
    }

    #[test]
    fn camera_without_screen_space_ao_keeps_msaa() {
        let mut app = App::new();
        let camera = app
            .world_mut()
            .spawn((Camera3d::default(), Msaa::Sample4))
            .id();

        app.add_systems(Update, disable_msaa_for_screen_space_ao);
        app.update();

        assert_eq!(app.world().get::<Msaa>(camera), Some(&Msaa::Sample4));
    }
}
