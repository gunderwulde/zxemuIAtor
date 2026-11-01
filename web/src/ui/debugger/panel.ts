// D1: panel de depuración (DOM). Toda la lógica está en controller.ts; aquí sólo se
// pinta y se traducen clics y teclas. Se repinta al parar y, mientras corre, como mucho
// RUN_REFRESH_MS (registros, desensamblado y memoria cuestan microsegundos; el límite es
// para no rehacer el DOM 50 veces por segundo).
import { disassembleRange, type DisasmLine } from "../../disasm";
import type { RegsSnapshot } from "../../emu/regs";
import type { Debugger } from "./controller";

const RUN_REFRESH_MS = 250;
const DIS_LINES = 18;
const MEM_ROWS = 8;
const FLAGS = ["S", "Z", "5", "H", "3", "P", "N", "C"];

const h2 = (v: number) => v.toString(16).toUpperCase().padStart(2, "0");
const h4 = (v: number) => v.toString(16).toUpperCase().padStart(4, "0");
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

export interface PanelHost {
  /** Destino de "hasta el cursor" en el editor (null si la línea no tiene código). */
  editorCursorAddr(): number | null;
  /** Mensaje corto para el usuario. */
  say(text: string): void;
}

export class DebuggerPanel {
  private shown: RegsSnapshot | null = null;
  private base: RegsSnapshot | null = null;
  private disStart = 0;
  private disFollow = true;
  private disSel: number | null = null;
  private lastPick: "editor" | "disasm" = "editor";
  private memAddr = 0x8000;
  private memSel: number | null = null;
  private memNibble: number | null = null;
  private lastRunPaint = 0;

  private bar: HTMLElement;
  private regsEl: HTMLElement;
  private disEl: HTMLElement;
  private memEl: HTMLElement;
  private timeEl: HTMLElement;
  private runBtn: HTMLButtonElement;
  private disInput: HTMLInputElement;
  private memInput: HTMLInputElement;

  constructor(readonly host: HTMLElement, private dbg: Debugger, private ui: PanelHost) {
    host.classList.add("dbg");
    host.innerHTML = `
      <div class="dbg-bar">
        <button type="button" data-a="run" title="Continuar / pausa (F5)">Continuar</button>
        <button type="button" data-a="step" title="Paso: una instrucción (F7)">Paso</button>
        <button type="button" data-a="over" title="Paso por encima de CALL/RST/DJNZ/LDIR… (F8)">Por encima</button>
        <button type="button" data-a="cursor" title="Corre hasta la línea del cursor del editor o la seleccionada en el desensamblado (F4)">Hasta el cursor</button>
        <button type="button" data-a="clear" title="Quita todos los breakpoints">Quitar bps</button>
        <span class="dbg-time status"></span>
        <span class="spacer"></span>
        <button type="button" data-a="close" title="Ocultar el depurador">×</button>
      </div>
      <div class="dbg-body">
        <div class="dbg-regs"></div>
        <div class="dbg-col">
          <label class="dbg-head">Desensamblado <input class="dbg-addr" data-i="dis" spellcheck="false" maxlength="5" placeholder="PC" title="Dirección (hex). Vacío: seguir al PC"></label>
          <div class="dbg-dis" tabindex="0"></div>
        </div>
        <div class="dbg-col">
          <label class="dbg-head">Memoria <input class="dbg-addr" data-i="mem" spellcheck="false" maxlength="5" value="8000" title="Dirección (hex)"></label>
          <div class="dbg-mem" tabindex="0" title="Clic en un byte y teclea dos dígitos hex para cambiarlo; flechas para moverse"></div>
        </div>
      </div>`;
    const q = <T extends HTMLElement>(s: string) => host.querySelector(s) as T;
    this.bar = q(".dbg-bar");
    this.regsEl = q(".dbg-regs");
    this.disEl = q(".dbg-dis");
    this.memEl = q(".dbg-mem");
    this.timeEl = q(".dbg-time");
    this.runBtn = q('[data-a="run"]');
    this.disInput = q('[data-i="dis"]');
    this.memInput = q('[data-i="mem"]');

    this.bar.addEventListener("click", (e) => {
      const a = (e.target as HTMLElement).closest("button")?.dataset.a;
      if (a === "close") { this.host.hidden = true; return; }
      if (a) this.command(a);
    });

    this.disInput.addEventListener("change", () => {
      const v = this.disInput.value.trim();
      if (v === "") { this.disFollow = true; }
      else {
        const a = parseInt(v, 16);
        if (Number.isNaN(a)) return;
        this.disFollow = false;
        this.disStart = a & 0xffff;
      }
      this.render();
    });
    this.disEl.addEventListener("click", (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>("[data-addr]");
      if (!row) return;
      const addr = Number(row.dataset.addr);
      if ((e.target as HTMLElement).closest(".dbg-gut")) this.dbg.toggleBp(addr);
      else { this.disSel = addr; this.lastPick = "disasm"; this.render(); }
    });
    this.disEl.addEventListener("wheel", (e) => {
      e.preventDefault();
      this.disFollow = false;
      // Hacia abajo: una instrucción; hacia arriba no se puede saber dónde empieza la
      // anterior, se retrocede un byte.
      const l = disassembleRange(this.dbg.ram(), this.disStart, 1)[0]!;
      this.disStart = (this.disStart + (e.deltaY > 0 ? l.len : -1)) & 0xffff;
      this.disInput.value = h4(this.disStart);
      this.render();
    }, { passive: false });

    this.memInput.addEventListener("change", () => {
      const a = parseInt(this.memInput.value, 16);
      if (Number.isNaN(a)) return;
      this.memAddr = a & 0xfff0;
      this.render();
    });
    this.memEl.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>("[data-m]");
      if (!b) return;
      this.memSel = Number(b.dataset.m);
      this.memNibble = null;
      this.memEl.focus();
      this.render();
    });
    this.memEl.addEventListener("keydown", (e) => this.memKey(e));
    this.memEl.addEventListener("wheel", (e) => {
      e.preventDefault();
      this.memAddr = (this.memAddr + (e.deltaY > 0 ? 16 : -16)) & 0xffff;
      this.memInput.value = h4(this.memAddr);
      this.render();
    }, { passive: false });

    dbg.events.on("change", () => this.render());
  }

  /** El editor tuvo el foco más recientemente que el desensamblado. */
  pickedEditor(): void { this.lastPick = "editor"; }

  command(a: string): void {
    const d = this.dbg;
    switch (a) {
      case "run": if (d.paused) d.resume(); else d.pause(); break;
      case "step": d.step(); break;
      case "over": d.stepOver(); break;
      case "cursor": {
        const t = this.lastPick === "disasm" && this.disSel !== null ? this.disSel : this.ui.editorCursorAddr();
        if (t === null) { this.ui.say("La línea del cursor no tiene código ensamblado (ensambla con «Depurar» o elige una línea del desensamblado)."); break; }
        d.runTo(t);
        break;
      }
      case "clear": d.clearAll(); this.ui.say("Breakpoints quitados."); break;
    }
  }

  /** Lo llama el bucle en cada frame emulado. */
  onFrame(): void {
    const now = performance.now();
    if (now - this.lastRunPaint < RUN_REFRESH_MS) return;
    this.lastRunPaint = now;
    this.render();
  }

  render(): void {
    if (this.host.hidden) return;
    const d = this.dbg;
    const paused = d.paused;
    this.runBtn.textContent = paused ? "Continuar" : "Pausa";
    this.host.classList.toggle("dbg-running", !paused);
    const t = d.time();
    this.timeEl.textContent = `T ${t.t} · línea ${t.line} (${t.col}) · frame ${t.frame}`;

    const regs = this.regsSnapshot();
    if (paused) {
      if (!this.shown || !sameRegs(this.shown, regs)) { this.base = this.shown; this.shown = regs; }
    }
    this.renderRegs(regs, paused ? this.base : null);
    this.renderDis(regs.pc);
    this.renderMem();
  }

  private regsSnapshot(): RegsSnapshot { return this.dbg.regs(); }

  private renderRegs(r: RegsSnapshot, base: RegsSnapshot | null): void {
    const ch = (k: keyof RegsSnapshot) => (base && base[k] !== r[k] ? " dbg-chg" : "");
    const pair = (label: string, k: keyof RegsSnapshot) =>
      `<span class="dbg-r${ch(k)}"><b>${label}</b>${h4(r[k])}</span>`;
    const byte = (label: string, k: keyof RegsSnapshot, v = h2(r[k])) =>
      `<span class="dbg-r${ch(k)}"><b>${label}</b>${v}</span>`;
    const f = r.af & 0xff, bf = base ? base.af & 0xff : f;
    const flags = FLAGS.map((n, i) => {
      const bit = 0x80 >> i;
      const cls = (f & bit ? "on" : "off") + ((f ^ bf) & bit ? " dbg-chg" : "");
      return `<span class="dbg-flag ${cls}" title="bit ${7 - i}">${n}</span>`;
    }).join("");
    this.regsEl.innerHTML =
      pair("AF", "af") + pair("AF'", "af_") +
      pair("BC", "bc") + pair("BC'", "bc_") +
      pair("DE", "de") + pair("DE'", "de_") +
      pair("HL", "hl") + pair("HL'", "hl_") +
      pair("IX", "ix") + pair("IY", "iy") +
      pair("SP", "sp") + pair("PC", "pc") +
      byte("I", "i") + byte("R", "r") +
      pair("WZ", "memptr") + byte("IM", "im", String(r.im)) +
      byte("IFF1", "iff1", String(r.iff1)) + byte("IFF2", "iff2", String(r.iff2)) +
      (r.halted ? `<span class="dbg-r dbg-halt">HALT</span>` : "") +
      `<div class="dbg-flags">${flags}</div>`;
  }

  private renderDis(pc: number): void {
    const ram = this.dbg.ram();
    if (this.disFollow) {
      const lines = disassembleRange(ram, this.disStart, DIS_LINES);
      const idx = lines.findIndex((l) => l.addr === pc);
      if (idx < 0 || idx > DIS_LINES - 4) this.disStart = pc;
    }
    const lines = disassembleRange(ram, this.disStart, DIS_LINES);
    const temp = this.dbg.tempAddr;
    this.disEl.innerHTML = lines.map((l) => this.disRow(l, pc, temp)).join("");
  }

  private disRow(l: DisasmLine, pc: number, temp: number | null): string {
    const cls = ["dbg-row"];
    if (l.addr === pc) cls.push("dbg-pc");
    if (l.addr === this.disSel) cls.push("dbg-sel");
    if (l.undoc) cls.push("dbg-undoc");
    const bp = this.dbg.hasBp(l.addr) ? "●" : l.addr === temp ? "○" : "";
    const src = this.dbg.lineOf(l.addr);
    const text = l.comment !== null ? `${esc(l.mnemonic.padEnd(5))}${esc(l.operands.join(","))}<i> ; ${esc(l.comment)}</i>` : esc(l.text);
    return `<div class="${cls.join(" ")}" data-addr="${l.addr}"><span class="dbg-gut" title="Breakpoint">${bp}</span>` +
      `<span class="dbg-a">${h4(l.addr)}</span><span class="dbg-b">${l.bytes.map(h2).join(" ")}</span>` +
      `<span class="dbg-t">${text}</span>${src ? `<span class="dbg-src">${src}</span>` : ""}</div>`;
  }

  private renderMem(): void {
    const ram = this.dbg.ram();
    let s = "";
    for (let r = 0; r < MEM_ROWS; r++) {
      const row = (this.memAddr + r * 16) & 0xffff;
      let hex = "", asc = "";
      for (let i = 0; i < 16; i++) {
        const a = (row + i) & 0xffff;
        const v = ram[a]!;
        const sel = a === this.memSel;
        const txt = sel && this.memNibble !== null ? `${this.memNibble.toString(16).toUpperCase()}_` : h2(v);
        hex += `<span data-m="${a}" class="${sel ? "dbg-msel" : ""}${a < 0x4000 ? " dbg-rom" : ""}">${txt}</span>`;
        asc += v >= 32 && v < 127 ? esc(String.fromCharCode(v)) : "·";
      }
      s += `<div class="dbg-mrow"><span class="dbg-a">${h4(row)}</span>${hex}<span class="dbg-asc">${asc}</span></div>`;
    }
    this.memEl.innerHTML = s;
  }

  private memKey(e: KeyboardEvent): void {
    if (this.memSel === null) return;
    const move = (d: number) => {
      this.memSel = (this.memSel! + d) & 0xffff;
      this.memNibble = null;
      // Mantener la selección a la vista.
      const off = (this.memSel - this.memAddr) & 0xffff;
      if (off >= MEM_ROWS * 16) this.memAddr = (this.memAddr + (d > 0 ? 16 : -16)) & 0xffff;
      this.memInput.value = h4(this.memAddr);
    };
    const k = e.key;
    if (/^[0-9a-fA-F]$/.test(k)) {
      const v = parseInt(k, 16);
      if (this.memNibble === null) this.memNibble = v;
      else {
        if (this.memSel < 0x4000) this.ui.say("La ROM (0000h–3FFFh) no se puede escribir.");
        this.dbg.poke(this.memSel, (this.memNibble << 4) | v);
        move(1);
      }
    } else if (k === "ArrowRight") move(1);
    else if (k === "ArrowLeft") move(-1);
    else if (k === "ArrowDown") move(16);
    else if (k === "ArrowUp") move(-16);
    else if (k === "Escape") { this.memNibble = null; this.memSel = null; }
    else return;
    e.preventDefault();
    this.render();
  }
}

function sameRegs(a: RegsSnapshot, b: RegsSnapshot): boolean {
  for (const k in a) if (a[k as keyof RegsSnapshot] !== b[k as keyof RegsSnapshot]) return false;
  return true;
}
