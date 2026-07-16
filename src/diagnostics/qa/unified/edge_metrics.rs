use super::image_linear::{LinearImage, rec709_luminance};

pub fn sobel_magnitudes(image: &LinearImage) -> Vec<f32> {
    let width = image.width as usize;
    let height = image.height as usize;
    let mut luminance = vec![0.0; width * height];
    for (pixel, output) in luminance.iter_mut().enumerate() {
        let offset = pixel * 3;
        *output = rec709_luminance(
            image.rgb[offset],
            image.rgb[offset + 1],
            image.rgb[offset + 2],
        );
    }

    let mut output = vec![0.0; luminance.len()];
    if width < 3 || height < 3 {
        return output;
    }
    for y in 1..height - 1 {
        for x in 1..width - 1 {
            let index = y * width + x;
            let top_left = luminance[index - width - 1];
            let top_center = luminance[index - width];
            let top_right = luminance[index - width + 1];
            let middle_left = luminance[index - 1];
            let middle_right = luminance[index + 1];
            let bottom_left = luminance[index + width - 1];
            let bottom_center = luminance[index + width];
            let bottom_right = luminance[index + width + 1];
            let gx = -top_left + top_right - 2.0 * middle_left + 2.0 * middle_right
                - bottom_left
                + bottom_right;
            let gy = -top_left - 2.0 * top_center - top_right
                + bottom_left
                + 2.0 * bottom_center
                + bottom_right;
            output[index] = gx.hypot(gy);
        }
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flat_image_has_no_edges() {
        let image = LinearImage {
            width: 3,
            height: 3,
            rgb: vec![0.5; 27],
        };
        assert!(sobel_magnitudes(&image).iter().all(|value| *value == 0.0));
    }
}
