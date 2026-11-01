/*
 * audio_test_harness.c — banco de pruebas aislado del resampler (sólo tests de M2).
 *
 * Incluye audio.c tal cual y expone audio_out/audio_end_frame a JS para poder generar
 * ondas sintéticas con T-states exactos sin depender de la CPU (C1). Lo compila
 * tools/audio-build-harness.mjs; NO forma parte de core.wasm ni de core-probe.wasm.
 * Los zx_audio_render/zx_audio_buffer/zx_t_beeper_log* exportados son los de audio.c.
 */
#define ZX_TEST_HOOKS 1
#include "audio.c"

#define H_EXPORT(name) __attribute__((export_name(#name)))

H_EXPORT(h_reset) void h_reset(void) { audio_reset(); }
H_EXPORT(h_out)   void h_out(uint32_t t, uint32_t fe) { audio_out(t, (uint8_t)fe); }
H_EXPORT(h_end)   void h_end(uint32_t frame_len) { audio_end_frame(frame_len); }
