# sf2converter

This package aims to convert .sf2 files into a format more suitable for playback on the web.

Similar converters/webpack loaders/sf2 players exist, but they are missing vital features (like velocity layers).
Or worse, they force users to pick from remotely-hosted sample packs.

### Installation
LAME must be installed and available on the PATH environment variable in order to render samples to MP3

### Known restrictions/limitations 
   1. Only one sample is allowed per zone. If a left and a right channel are 
     detected on the same zone they will be mixed down into a single sample. Otherwise, subsequent samples
     found in the same zone will be dropped in favor of the first sample.
   2. Overlapping SF2 zones default to the first-defined sample to avoid blending short release/pop samples into the main note. Use `zoneCollisionPolicy: 'merge'` only when you explicitly want those collisions mixed together. Merged pitched samples are transposed to the root pitch of the sample closest to the target zone's key-range center; unpitched samples are not transposed.
  3. The output represents zones using their key and velocity ranges. Some of the web-based samplers we are targeting may not support explicit key ranges; a custom sampler may be needed to honor them.
 
