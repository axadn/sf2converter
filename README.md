# sf2converter

This package aims to convert .sf2 files into a format more suitable for playback on the web.

Similar converters/webpack loaders/sf2 players exist, but they are missing vital features (like velocity layers).
Or worse, they force users to pick from remotely-hosted sample packs.

### Installation
LAME must be installed and available on the PATH environment variable in order to render samples to MP3

### Known restrictions/limitations
1. Each instrument zone references one sample. If that sample is a left or right stereo channel, its linked opposite channel is included in the rendered stereo sample. ROM sample types (`RomMono`, `RomLeft`, `RomRight`, and `RomLinked`) are not supported.
2. Overlapping zones use the first zone by default. Set `zoneCollisionPolicy` to `'last'` to use the last zone, or `'merge'` to mix samples from colliding zones. In a merge, pitched samples are transposed to the root pitch closest to the target key-range center; unpitched samples are not transposed.
3. Output zones retain their key and velocity ranges. The playback sampler must support explicit key ranges to honor them.
 
