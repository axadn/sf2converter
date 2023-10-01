# sf2converter

This package aims to convert .sf2 files into a format more suitable for playback on the web.

Similar converters/webpack loaders/sf2 players exist, but they are missing vital features (like velocity layers).
Or worse, they force users to pick from remotely-hosted sample packs.


### Known restrictions/limitations 
   1. Only one sample is allowed per zone. If a left and a right channel are 
     detected on the same zone they will be mixed down into a single sample. Otherwise, subsequent samples
     found in the same zone will be dropped in favor of the first sample.
  3. Explicit zones (key-ranges) will not work with the web-based samplers we are targeting.
     Root notes will be used to define new zones. Support for explicit zones may be added eventually, as I move towards
     extending them or implementing my own samplers without this restriction. 
 
