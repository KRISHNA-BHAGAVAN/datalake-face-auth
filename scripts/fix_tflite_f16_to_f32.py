#!/usr/bin/env python3
"""
Convert a "true float16" TFLite model to float32 in-place at the flatbuffer level.

Why this exists
---------------
`assets/models/minifasnet_v2.tflite` shipped as a *true* float16 model (every
activation/weight tensor typed FLOAT16, no DEQUANTIZE ops). TFLite's CPU kernels
(CONV_2D, REDUCE_MAX, ...) only accept float32/uint8/int8/int16 activations, so
the interpreter fails to build:

    TfliteModule.createModel(...): Failed to create TFLite interpreter!
    tflite/kernels/conv.cc:360 ... input_type == kTfLiteFloat32 || ... was not true.
    Node number 1 (CONV_2D) failed to prepare.

react-native-fast-tflite bundles the same TFLite/LiteRT runtime, so it fails the
same way. The model graph itself is correct (clean 103-op MiniFASNetV2, 80x80
NHWC, 3-class) and matches src/utils/config.ts; only the dtype is wrong.

This script retypes every FLOAT16 tensor to FLOAT32 and casts each backing weight
buffer float16 -> float32. The cast is lossless (every float16 value is exactly
representable in float32), so outputs are numerically identical to what the
float16 graph would have produced if it could run.

Usage
-----
    .venv-convert/bin/python scripts/fix_tflite_f16_to_f32.py <in.tflite> <out.tflite>
"""
import sys
import numpy as np
import flatbuffers
from ai_edge_litert import schema_py_generated as schema

F16 = schema.TensorType.FLOAT16
F32 = schema.TensorType.FLOAT32


def convert(src_path: str, dst_path: str) -> None:
    with open(src_path, "rb") as f:
        buf = f.read()

    # NOTE: ModelT.InitFromBuf is broken in this schema build (mis-inits the root
    # offset). Parse with the immutable reader first, then lift to the object API.
    model = schema.Model.GetRootAs(buf, 0)
    mt = schema.ModelT.InitFromObj(model)

    retyped = recast = 0
    for sg in mt.subgraphs:
        for t in sg.tensors:
            if t.type != F16:
                continue
            t.type = F32
            retyped += 1
            b = mt.buffers[t.buffer]
            if b.data is not None and len(b.data) > 0:
                arr16 = np.frombuffer(bytes(bytearray(b.data)), dtype=np.float16)
                b.data = arr16.astype(np.float32).view(np.uint8)
                recast += 1

    builder = flatbuffers.Builder(1 << 20)
    builder.Finish(mt.Pack(builder), b"TFL3")
    with open(dst_path, "wb") as f:
        f.write(bytes(builder.Output()))

    print(f"retyped {retyped} FLOAT16 tensors -> FLOAT32, recast {recast} weight buffers")
    print(f"wrote {dst_path}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(1)
    convert(sys.argv[1], sys.argv[2])
