// Ejemplos C precargados (L1), de menos a más. Cada uno se compila con la librería
// (spectrum.h, string.h, stdlib.h) y tiene un test en tests/clib/examples.test.ts.
import hello from "./examples/01-hello.c?raw";
import table from "./examples/02-table.c?raw";
import keys from "./examples/03-keys.c?raw";
import graphics from "./examples/04-graphics.c?raw";
import rainbow from "./examples/05-rainbow.c?raw";
import scale from "./examples/06-scale.c?raw";
import sprite from "./examples/07-sprite.c?raw";
import enemies from "./examples/08-enemies.c?raw";
import hanoi from "./examples/09-hanoi.c?raw";
import game from "./examples/10-game.c?raw";

export interface CExampleDef { id: string; title: string; source: string }

export const EXAMPLES: readonly CExampleDef[] = [
  { id: "hello", title: "1 · Hola mundo con colores", source: hello },
  { id: "table", title: "2 · Bucles y aritmética (tabla de multiplicar)", source: table },
  { id: "keys", title: "3 · Teclado (eco y mover un carácter)", source: keys },
  { id: "graphics", title: "4 · Gráficos (plot y line)", source: graphics },
  { id: "rainbow", title: "5 · Atributos animados (arco iris)", source: rainbow },
  { id: "scale", title: "6 · Sonido (escala con beep)", source: scale },
  { id: "sprite", title: "7 · Sprite 16×16 sin parpadeo", source: sprite },
  { id: "enemies", title: "8 · Structs y arrays (enemigos)", source: enemies },
  { id: "hanoi", title: "9 · Recursión (torres de Hanoi)", source: hanoi },
  { id: "game", title: "10 · Mini-juego (monedas y rocas)", source: game },
];
