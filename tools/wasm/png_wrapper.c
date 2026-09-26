#include <stdint.h>
#include <stdlib.h>
#include <stddef.h>
#include <emscripten/emscripten.h>
#include "spng.h"

static unsigned char *output_png = NULL;
static size_t output_png_size = 0;

EMSCRIPTEN_KEEPALIVE
void jtrim_png_free_output(void)
{
    free(output_png);
    output_png = NULL;
    output_png_size = 0;
}

EMSCRIPTEN_KEEPALIVE
int jtrim_png_encode(const unsigned char *rgba,
                     size_t rgba_size,
                     uint32_t width,
                     uint32_t height,
                     int interlaced,
                     int compression_level)
{
    if(rgba == NULL || width == 0 || height == 0) return SPNG_EINVAL;
    if((size_t)width > SIZE_MAX / 4) return SPNG_EOVERFLOW;
    size_t row_size = (size_t)width * 4;
    if((size_t)height > SIZE_MAX / row_size) return SPNG_EOVERFLOW;
    if(rgba_size != row_size * (size_t)height) return SPNG_EBUFSIZ;

    jtrim_png_free_output();

    spng_ctx *ctx = spng_ctx_new(SPNG_CTX_ENCODER);
    if(ctx == NULL) return SPNG_EMEM;

    int ret = spng_set_option(ctx, SPNG_ENCODE_TO_BUFFER, 1);
    if(ret) {
        spng_ctx_free(ctx);
        return ret;
    }

    if(compression_level >= 0 && compression_level <= 9) {
        ret = spng_set_option(ctx, SPNG_IMG_COMPRESSION_LEVEL, compression_level);
        if(ret) {
            spng_ctx_free(ctx);
            return ret;
        }
    }

    struct spng_ihdr ihdr = {0};
    ihdr.width = width;
    ihdr.height = height;
    ihdr.bit_depth = 8;
    ihdr.color_type = SPNG_COLOR_TYPE_TRUECOLOR_ALPHA;
    ihdr.compression_method = 0;
    ihdr.filter_method = 0;
    ihdr.interlace_method = interlaced ? SPNG_INTERLACE_ADAM7 : SPNG_INTERLACE_NONE;

    ret = spng_set_ihdr(ctx, &ihdr);
    if(ret) {
        spng_ctx_free(ctx);
        return ret;
    }

    ret = spng_encode_image(ctx, rgba, rgba_size, SPNG_FMT_PNG, SPNG_ENCODE_FINALIZE);
    if(ret) {
        spng_ctx_free(ctx);
        return ret;
    }

    int buffer_error = 0;
    output_png = spng_get_png_buffer(ctx, &output_png_size, &buffer_error);
    spng_ctx_free(ctx);

    if(output_png == NULL) {
        output_png_size = 0;
        return buffer_error ? buffer_error : SPNG_EMEM;
    }

    return SPNG_OK;
}

EMSCRIPTEN_KEEPALIVE
uintptr_t jtrim_png_output_ptr(void)
{
    return (uintptr_t)output_png;
}

EMSCRIPTEN_KEEPALIVE
size_t jtrim_png_output_size(void)
{
    return output_png_size;
}
