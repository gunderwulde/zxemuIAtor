// E1: descarga de ficheros generados (TAP, SNA) desde el navegador.

/** Nombre con fecha local: `prefix-AAAAMMDD-HHMMSS.ext`. */
export function stampedName(prefix: string, ext: string, d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${prefix}-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.${ext}`;
}

/** Ofrece `data` como descarga con un enlace temporal. */
export function downloadBytes(data: Uint8Array, filename: string): void {
  // Copia a un ArrayBuffer propio: la vista puede ser de la memoria del wasm (saveSna).
  const bytes = new Uint8Array(data);
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  // Algunos navegadores leen el blob después del clic: se libera más tarde.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
