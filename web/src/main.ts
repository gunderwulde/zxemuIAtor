// Arranque de la web (esqueleto de fase 0). W1 sustituye el bucle por loop.ts con
// reloj maestro de audio, y añade teclado, carga de ficheros y controles.
import romUrl from "../../rom/48.rom?url";
import { Core, FB_HEIGHT, FB_WIDTH, TSTATES_PER_FRAME, CPU_HZ } from "./emu/core";

const FRAME_MS = (1000 * TSTATES_PER_FRAME) / CPU_HZ; // 19,968 ms → 50,08 Hz

async function boot(): Promise<void> {
  const [wasm, rom] = await Promise.all([
    fetch("/wasm/core.wasm").then((r) => r.arrayBuffer()),
    fetch(romUrl).then((r) => r.arrayBuffer()),
  ]);
  const core = await Core.load(wasm);
  core.loadRom(new Uint8Array(rom));

  const canvas = document.getElementById("screen") as HTMLCanvasElement;
  const ctx = canvas.getContext("2d")!;
  const status = document.getElementById("emu-status")!;
  const image = new ImageData(core.framebuffer(), FB_WIDTH, FB_HEIGHT);

  let paused = false;
  let last = performance.now();
  let acc = 0;

  const tick = (now: number) => {
    acc += Math.min(now - last, 250);
    last = now;
    while (!paused && acc >= FRAME_MS) {
      core.runFrame();
      acc -= FRAME_MS;
    }
    ctx.putImageData(image, 0, 0);
    status.textContent = `frame ${core.x.zx_frame_count()}`;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  document.getElementById("emu-reset")!.onclick = () => core.x.zx_reset();
  const pause = document.getElementById("emu-pause")!;
  pause.onclick = () => {
    paused = !paused;
    pause.textContent = paused ? "Continuar" : "Pausa";
  };
}

boot().catch((e) => {
  document.getElementById("emu-status")!.textContent = `Error: ${e}`;
  console.error(e);
});
