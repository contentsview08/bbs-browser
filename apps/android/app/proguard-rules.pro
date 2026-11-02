# ONNX Runtime(AI NG)は、ネイティブの側から Java のクラス・メソッドを名前で探す。R8 が名前を変えたり外したりすると、判定の途中で落ちる
-keep class ai.onnxruntime.** { *; }
