# ONNX Runtime(AI NG)は、ネイティブの側から Java のクラス・メソッドを名前で探す。R8 が名前を変えたり外したりすると、判定の途中で落ちる
-keep class ai.onnxruntime.** { *; }

# WorkManager(閲覧履歴の定期確認)は内部の DB(Room)をリフレクションで作る。消すと起動時に落ちる(NoSuchMethodException: WorkDatabase_Impl.<init>)
-keep class * extends androidx.room.RoomDatabase { <init>(); }
-keep class androidx.work.impl.WorkDatabase_Impl { *; }
