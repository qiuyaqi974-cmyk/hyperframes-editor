"""Optional independent interoperability check with OpenTimelineIO 0.18.1.

Run test:otio with OTIO_CHECK_DIR pointing at a scratch directory, then run
this script with that directory. No project runtime dependency is required.
"""
import pathlib
import sys
import opentimelineio as otio

root = pathlib.Path(sys.argv[1])
for name, duration, tracks in [
    ('simple', 8, 1), ('complex', 8, 2), ('approved', 11, 2), ('rejected', 11, 2)
]:
    timeline = otio.adapters.read_from_file(str(root / f'{name}.otio'))
    assert isinstance(timeline, otio.schema.Timeline)
    assert len(timeline.tracks) == tracks
    assert abs(timeline.duration().to_seconds() - duration) < 1e-8
    roundtrip = otio.adapters.read_from_string(otio.adapters.write_to_string(timeline))
    assert roundtrip.is_equivalent_to(timeline)
    if name == 'complex':
        video = timeline.tracks[0]
        assert video[0].effects[0].time_scalar == 2
        assert abs(video.range_of_child_at_index(2).start_time.to_seconds() - 4) < 1e-8
        assert video[1].transition_type == 'SMPTE_Dissolve'
        assert video[1].metadata['custom'] == 'preserved'
print('Official OpenTimelineIO SDK interoperability checks passed.')
