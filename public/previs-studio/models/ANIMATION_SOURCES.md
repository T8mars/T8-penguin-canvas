# Animation sources

The `sit`, `wave`, and `thumbs_up` clips embedded in `xbot-animated.glb` are
retargeted from the Three.js `RobotExpressive.glb` example at commit
`6a644fe0cc3220c7bebf6acc96bb7e49d3274980`.

Original model and animations by Tomas Laulhe (Quaternius), licensed CC0 1.0.
Three.js source notes: https://github.com/mrdoob/three.js/tree/dev/examples/models/gltf/RobotExpressive

The upstream project pins `scripts/assets/RobotExpressive.glb`, so its
retargeting step is reproducible offline with `npm run build:animations` in the
upstream repository.

The `squat` clip is retargeted from trial `13_29` in the Carnegie Mellon
University Graphics Lab Motion Capture Database (subject 13, various everyday
behaviors). The source trial contains recorded squats; only one complete squat
segment is embedded in the runtime model. CMU places no restrictions on use of
the original dataset, and the BVH conversion used here adds no restrictions.
The upstream pinned source is `scripts/assets/CMU_13_29.bvh`.

Synced from `GuiYi-Xi/monoform-previs-studio` commit
`daa54b2f6e78cc69f07102f7d32f6fabe3ac4a54`.
