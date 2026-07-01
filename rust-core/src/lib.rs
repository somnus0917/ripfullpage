use std::alloc::{alloc, dealloc, Layout};
use std::cmp::{max, min};
use std::slice;

const RGBA_CHANNELS: usize = 4;
const OK: i32 = 0;
const ERR_INVALID_INPUT: i32 = 1;
const ERR_BUFFER_TOO_SMALL: i32 = 2;

#[no_mangle]
pub extern "C" fn rip_alloc(size: usize) -> *mut u8 {
    if size == 0 {
        return std::ptr::null_mut();
    }

    let Ok(layout) = Layout::from_size_align(size, 8) else {
        return std::ptr::null_mut();
    };

    unsafe { alloc(layout) }
}

#[no_mangle]
pub extern "C" fn rip_free(ptr: *mut u8, size: usize) {
    if ptr.is_null() || size == 0 {
        return;
    }

    let Ok(layout) = Layout::from_size_align(size, 8) else {
        return;
    };

    unsafe {
        dealloc(ptr, layout);
    }
}

#[no_mangle]
pub extern "C" fn rip_apply_mosaic(
    ptr: *mut u8,
    len: usize,
    image_width: u32,
    image_height: u32,
    left: u32,
    top: u32,
    rect_width: u32,
    rect_height: u32,
    block_size: u32,
) -> i32 {
    let Some(image_len) = checked_image_len(image_width, image_height) else {
        return ERR_INVALID_INPUT;
    };

    if ptr.is_null() || len < image_len || block_size == 0 {
        return ERR_BUFFER_TOO_SMALL;
    }

    let rect = clamp_rect(
        image_width,
        image_height,
        left,
        top,
        rect_width,
        rect_height,
    );

    if rect.width == 0 || rect.height == 0 {
        return OK;
    }

    let pixels = unsafe { slice::from_raw_parts_mut(ptr, len) };
    let stride = image_width as usize * RGBA_CHANNELS;
    let block = max(1, block_size as usize);
    let bottom = rect.top + rect.height;
    let right = rect.left + rect.width;

    for y in (rect.top..bottom).step_by(block) {
        for x in (rect.left..right).step_by(block) {
            let sample_index = y as usize * stride + x as usize * RGBA_CHANNELS;
            let color = [
                pixels[sample_index],
                pixels[sample_index + 1],
                pixels[sample_index + 2],
                pixels[sample_index + 3],
            ];
            let fill_bottom = min(bottom, y + block as u32);
            let fill_right = min(right, x + block as u32);

            for fill_y in y..fill_bottom {
                let row_start = fill_y as usize * stride;

                for fill_x in x..fill_right {
                    let index = row_start + fill_x as usize * RGBA_CHANNELS;
                    pixels[index] = color[0];
                    pixels[index + 1] = color[1];
                    pixels[index + 2] = color[2];
                    pixels[index + 3] = color[3];
                }
            }
        }
    }

    OK
}

#[no_mangle]
pub extern "C" fn rip_apply_box_blur(
    ptr: *mut u8,
    len: usize,
    image_width: u32,
    image_height: u32,
    left: u32,
    top: u32,
    rect_width: u32,
    rect_height: u32,
    radius: u32,
    iterations: u32,
) -> i32 {
    let Some(image_len) = checked_image_len(image_width, image_height) else {
        return ERR_INVALID_INPUT;
    };

    if ptr.is_null() || len < image_len {
        return ERR_BUFFER_TOO_SMALL;
    }

    let rect = clamp_rect(
        image_width,
        image_height,
        left,
        top,
        rect_width,
        rect_height,
    );

    if rect.width < 2 || rect.height < 2 || radius == 0 || iterations == 0 {
        return OK;
    }

    let pixels = unsafe { slice::from_raw_parts_mut(ptr, len) };
    let width = rect.width as usize;
    let height = rect.height as usize;
    let Some(roi_len) = width
        .checked_mul(height)
        .and_then(|value| value.checked_mul(RGBA_CHANNELS))
    else {
        return ERR_INVALID_INPUT;
    };
    let image_stride = image_width as usize * RGBA_CHANNELS;
    let mut source = vec![0u8; roi_len];
    let mut temp = vec![0u8; roi_len];

    for row in 0..height {
        let source_start =
            (rect.top as usize + row) * image_stride + rect.left as usize * RGBA_CHANNELS;
        let source_end = source_start + width * RGBA_CHANNELS;
        let target_start = row * width * RGBA_CHANNELS;

        source[target_start..target_start + width * RGBA_CHANNELS]
            .copy_from_slice(&pixels[source_start..source_end]);
    }

    let radius = min(radius as usize, max(width, height));
    let iterations = min(iterations, 6);

    for _ in 0..iterations {
        horizontal_blur(&source, &mut temp, width, height, radius);
        vertical_blur(&temp, &mut source, width, height, radius);
    }

    for row in 0..height {
        let target_start =
            (rect.top as usize + row) * image_stride + rect.left as usize * RGBA_CHANNELS;
        let target_end = target_start + width * RGBA_CHANNELS;
        let source_start = row * width * RGBA_CHANNELS;

        pixels[target_start..target_end]
            .copy_from_slice(&source[source_start..source_start + width * RGBA_CHANNELS]);
    }

    OK
}

#[no_mangle]
pub extern "C" fn rip_crop(
    src_ptr: *const u8,
    src_len: usize,
    dst_ptr: *mut u8,
    dst_len: usize,
    image_width: u32,
    image_height: u32,
    left: u32,
    top: u32,
    rect_width: u32,
    rect_height: u32,
) -> i32 {
    let Some(src_image_len) = checked_image_len(image_width, image_height) else {
        return ERR_INVALID_INPUT;
    };

    let rect = clamp_rect(
        image_width,
        image_height,
        left,
        top,
        rect_width,
        rect_height,
    );
    let Some(dst_image_len) = checked_image_len(rect.width, rect.height) else {
        return ERR_INVALID_INPUT;
    };

    if src_ptr.is_null() || dst_ptr.is_null() || src_len < src_image_len || dst_len < dst_image_len
    {
        return ERR_BUFFER_TOO_SMALL;
    }

    let source = unsafe { slice::from_raw_parts(src_ptr, src_len) };
    let target = unsafe { slice::from_raw_parts_mut(dst_ptr, dst_len) };
    let source_stride = image_width as usize * RGBA_CHANNELS;
    let target_stride = rect.width as usize * RGBA_CHANNELS;

    for row in 0..rect.height as usize {
        let source_start =
            (rect.top as usize + row) * source_stride + rect.left as usize * RGBA_CHANNELS;
        let target_start = row * target_stride;

        target[target_start..target_start + target_stride]
            .copy_from_slice(&source[source_start..source_start + target_stride]);
    }

    OK
}

fn horizontal_blur(source: &[u8], target: &mut [u8], width: usize, height: usize, radius: usize) {
    let diameter = radius * 2 + 1;

    for y in 0..height {
        let row_offset = y * width * RGBA_CHANNELS;

        for x in 0..width {
            let mut sums = [0u32; RGBA_CHANNELS];
            let start = x.saturating_sub(radius);
            let end = min(width - 1, x + radius);
            let count = min(diameter, end - start + 1) as u32;

            for sample_x in start..=end {
                let index = row_offset + sample_x * RGBA_CHANNELS;
                sums[0] += source[index] as u32;
                sums[1] += source[index + 1] as u32;
                sums[2] += source[index + 2] as u32;
                sums[3] += source[index + 3] as u32;
            }

            let target_index = row_offset + x * RGBA_CHANNELS;
            target[target_index] = (sums[0] / count) as u8;
            target[target_index + 1] = (sums[1] / count) as u8;
            target[target_index + 2] = (sums[2] / count) as u8;
            target[target_index + 3] = (sums[3] / count) as u8;
        }
    }
}

fn vertical_blur(source: &[u8], target: &mut [u8], width: usize, height: usize, radius: usize) {
    let diameter = radius * 2 + 1;

    for y in 0..height {
        let start = y.saturating_sub(radius);
        let end = min(height - 1, y + radius);
        let count = min(diameter, end - start + 1) as u32;

        for x in 0..width {
            let mut sums = [0u32; RGBA_CHANNELS];

            for sample_y in start..=end {
                let index = (sample_y * width + x) * RGBA_CHANNELS;
                sums[0] += source[index] as u32;
                sums[1] += source[index + 1] as u32;
                sums[2] += source[index + 2] as u32;
                sums[3] += source[index + 3] as u32;
            }

            let target_index = (y * width + x) * RGBA_CHANNELS;
            target[target_index] = (sums[0] / count) as u8;
            target[target_index + 1] = (sums[1] / count) as u8;
            target[target_index + 2] = (sums[2] / count) as u8;
            target[target_index + 3] = (sums[3] / count) as u8;
        }
    }
}

fn checked_image_len(width: u32, height: u32) -> Option<usize> {
    (width as usize)
        .checked_mul(height as usize)?
        .checked_mul(RGBA_CHANNELS)
}

fn clamp_rect(
    image_width: u32,
    image_height: u32,
    left: u32,
    top: u32,
    width: u32,
    height: u32,
) -> Rect {
    let left = min(left, image_width);
    let top = min(top, image_height);
    let right = min(image_width, left.saturating_add(width));
    let bottom = min(image_height, top.saturating_add(height));

    Rect {
        left,
        top,
        width: right.saturating_sub(left),
        height: bottom.saturating_sub(top),
    }
}

struct Rect {
    left: u32,
    top: u32,
    width: u32,
    height: u32,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mosaic_fills_each_block_from_top_left_sample() {
        let mut pixels = vec![
            10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255, 100, 110, 120, 255,
        ];

        let status = rip_apply_mosaic(pixels.as_mut_ptr(), pixels.len(), 2, 2, 0, 0, 2, 2, 2);

        assert_eq!(status, OK);
        assert_eq!(
            pixels,
            vec![10, 20, 30, 255, 10, 20, 30, 255, 10, 20, 30, 255, 10, 20, 30, 255,]
        );
    }

    #[test]
    fn crop_copies_requested_rectangle() {
        let source = vec![
            1, 1, 1, 255, 2, 2, 2, 255, 3, 3, 3, 255, 4, 4, 4, 255, 5, 5, 5, 255, 6, 6, 6, 255,
        ];
        let mut target = vec![0; 2 * RGBA_CHANNELS];

        let status = rip_crop(
            source.as_ptr(),
            source.len(),
            target.as_mut_ptr(),
            target.len(),
            3,
            2,
            1,
            1,
            2,
            1,
        );

        assert_eq!(status, OK);
        assert_eq!(target, vec![5, 5, 5, 255, 6, 6, 6, 255]);
    }
}
