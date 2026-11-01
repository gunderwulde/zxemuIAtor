// Ejemplos precargados del editor. El primero es el que se muestra en la primera carga.
import demo from "./examples/demo.asm?raw";
import border from "./examples/border.asm?raw";
import stripes from "./examples/stripes.asm?raw";
import hello from "../../asm/examples/hello.asm?raw";

export interface Example { id: string; title: string; source: string }

export const EXAMPLES: readonly Example[] = [
  { id: "demo", title: "Arco iris (bandas y rayas animadas)", source: demo },
  { id: "hello", title: "Hola mundo (RST 10h)", source: hello },
  { id: "border", title: "Cambio de borde", source: border },
  { id: "stripes", title: "Rayas de borde multicolor (HALT)", source: stripes },
];

export const DEFAULT_EXAMPLE = EXAMPLES[0]!;
