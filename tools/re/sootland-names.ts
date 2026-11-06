// Lo que se sabe de Sootland tras leer el código: nombres de etiquetas y comentarios por
// dirección. Alimenta a lift.ts; todo lo que no está aquí sale con nombre automático.
// Las direcciones son las lógicas (las de ejecución).
import type { Names } from "./lift";

/** Direcciones de fuera de cada tramo que el código nombra (se definen con EQU o en otro tramo). */
export const ENGINE_EXTERNS = new Map<number, string>([
  [0xca38, "level_header"], [0x61a8, "level_body"], [0xaa00, "bg_buffer"], [0xba00, "bg_attrs"],
  [0xcf08, "hud_gfx"], [0xd708, "hud_attrs"], [0xce40, "lvl_actors"], [0xcea4, "lvl_spawns"],
  [0xc350, "ending_code"], [0xce72, "ending_entry"],
]);

export const ENGINE: Names = {
  labels: {
    0xea60: "start", 0xea7f: "ask_rewind_side", 0xea8d: "load_level_1", 0xeab1: "ask_space", 0xeaca: "wait_space",
    0xeb7d: "begin_level", 0xebc3: "begin_scene", 0xebf8: "read_controls", 0xec15: "control_kempston",
    0xec3b: "control_keyboard", 0xec64: "control_sinclair", 0xec85: "control_cursor", 0xeca5: "controls_done",
    0xeca8: "aim_up", 0xecba: "aim_down", 0xeccc: "aim_left", 0xecf3: "aim_right", 0xeced: "scene_first", 0xed15: "scene_last",
    0xed1b: "draw_scene", 0xedc2: "game_tick", 0xee03: "enemy_pop_up", 0xee2b: "enemy_pick", 0xee59: "enemy_hidden",
    0xee66: "time_runs", 0xee81: "enemy_in_view", 0xee99: "enemy_step", 0xeeae: "spawn_table",
    0xef08: "v_scene", 0xef09: "v_pace", 0xef0b: "v_time_reload", 0xef0d: "v_score", 0xef12: "v_score_top",
    0xef19: "v_record", 0xef1b: "v_time", 0xef1d: "v_level", 0xef1e: "v_wave", 0xef1f: "v_enemy_timer",
    0xef21: "v_enemy_on", 0xef22: "v_enemy_scene", 0xef24: "v_lives", 0xef28: "v_step_timer",
    0xef2b: "draw_frame", 0xefa8: "sprite_draw", 0xf067: "sprite_restore",
    0xf0a8: "spr_crosshair", 0xf0ae: "spr_crosshair_col", 0xf0af: "spr_crosshair_row", 0xf0b2: "spr_crosshair_on",
    0xf0b3: "spr_enemy", 0xf0b9: "spr_enemy_col", 0xf0ba: "spr_enemy_row", 0xf0bd: "spr_enemy_on",
    0xf0be: "spr_enemy2", 0xf0c8: "spr_enemy2_on", 0xf0c9: "spr_blast", 0xf0d4: "spr_actor1", 0xf0df: "spr_actor2",
    0xf0ea: "spr_bonus", 0xf0f0: "spr_bonus_col", 0xf0f4: "bonus_active",
    0xf0f5: "lose_life", 0xf1a7: "enemy_gfx_table", 0xf1b1: "ay_silence", 0xf1bf: "ay_fx_miss", 0xf1cd: "ay_fx_hit",
    0xf1db: "ay_fx_actor", 0xf1e9: "ay_play", 0xf203: "fire", 0xf291: "place_actors", 0xf2bd: "place_actor",
    0xf310: "actor_table", 0xf350: "check_actors", 0xf3aa: "score_carry", 0xf3c5: "bonus_timer", 0xf400: "bonus_check",
    0xf42e: "game_over", 0xf447: "txt_game_over", 0xf465: "txt_press_space", 0xf4a7: "txt_rewind", 0xf4f9: "load_error",
    0xf519: "txt_error", 0xf53a: "next_level", 0xf5c4: "txt_level", 0xf5d0: "txt_level_digit", 0xf5dd: "txt_level_digit2",
    0xf60e: "load_ending", 0xf61e: "play_sample", 0xf64a: "sample_data",
  },
  comments: {
    0xea60: "SOOTLAND — motor del juego (bloque B de la cinta, cara 1). La intro lo carga en D778h y salta aquí.\n" +
      "Entrada: borra los atributos, pone el borde negro y pide la cara B de la cinta.",
    0xea8d: "Carga la cabecera del nivel (1222 bytes en CA38h, flag = nº de nivel) y su cuerpo (18432 bytes en\n" +
      "61A8h, flag = nivel + 4) con LD-BYTES de la ROM. Si falla, load_error lo cuenta y se reintenta.",
    0xeaca: "Espera a ESPACIO (fila 7Fh de puertos, bit 0). Copia el marco de marcadores (hud_gfx) al tercio inferior\n" +
      "de la pantalla y sus atributos, y escribe los marcadores con la calculadora de la ROM (STACK-A + PRINT-FP).",
    0xeb7d: "Estado inicial de un nivel: copia la tabla de apariciones (lvl_spawns) y la de actores (lvl_actors) de\n" +
      "la cabecera del nivel, y reinicia contadores.",
    0xebc3: "Una escena (un tablero de 4 de cada nivel): 20 enemigos y pasa al siguiente nivel.",
    0xebf8: "Lee el control elegido en el menú (variable en FFFFh: 1 Kempston, 2 teclado, 3 Sinclair, 4 cursor).\n" +
      "Mueve la mira (spr_crosshair_col/row) y cambia de escena al salirse por un borde.",
    0xed1b: "Dibuja la escena: copia el fondo de v_scene (0x1200 bytes: 4096 de bitmap y 512 de atributos) de\n" +
      "level_body a bg_buffer, coloca los actores y escribe marcadores con la ROM (mismo truco de número flotante).",
    0xedc2: "Un paso de juego: temporizadores del enemigo, avance, dibujo y llamada al bonus.",
    0xeeae: "Tabla de apariciones: registros de 3 bytes (escena, columna, fila); el juego usa 16 (copiada de lvl_spawns, 90 bytes de la cabecera del nivel).",
    0xef08: "Variables del juego.\nv_scene: escena actual (1–4). v_score: 6 dígitos de la puntuación (el menos significativo\n" +
      "primero). v_record: récord. v_level: nivel (1–4). v_lives: vidas.",
    0xef2b: "Compone un fotograma: dibuja los 7 sprites en bg_buffer (guarda fondo, AND con máscara, OR con gráfico),\n" +
      "vuelca bg_buffer a la pantalla (4096 bytes) y a los atributos (512), y restaura el fondo bajo cada sprite.",
    0xefa8: "Dibuja un sprite de celdas 8×8 sobre bg_buffer. IX apunta a su estructura:\n" +
      "  +0 gráfico, +2 máscara, +4 buffer donde guarda el fondo (punteros), +6 columna, +7 fila,\n" +
      "  +8 ancho y +9 alto en celdas, +10 activo. Las celdas se guardan por columnas, 8 bytes por celda.",
    0xf067: "Restaura el fondo guardado bajo un sprite (inversa de sprite_draw).",
    0xf0a8: "Estructuras de sprite (ver sprite_draw): mira, enemigo, segundo enemigo, destello, dos actores y bonus.",
    0xf0f5: "Pierde una vida: sonido, parpadeo y, si no quedan, game_over.",
    0xf1b1: "Sonidos: 14 valores para los registros 0–13 del AY-3-8912 (el juego usa un AY: puertos FFFDh/BFFDh).",
    0xf1e9: "Escribe 14 valores (HL) en los registros del AY y reproduce una muestra por el altavoz (play_sample).",
    0xf203: "Disparo: sonido y comprobación de si la mira está sobre un actor o enemigo.",
    0xf291: "Coloca los actores de la escena actual desde actor_table (10 entradas de 8 bytes: escena, columna, fila,\n" +
      "tipo, puntero al gráfico y a la máscara).",
    0xf310: "Tabla de actores (copiada de lvl_actors al empezar el nivel).",
    0xf3aa: "Propaga el acarreo entre los dígitos de la puntuación (un dígito pasa de 9 a 0 y suma al siguiente).",
    0xf42e: "Fin de la partida.",
    0xf53a: "Pasa al nivel siguiente: pide cargar su cabecera y su cuerpo de la cinta. Tras el cuarto, carga el final.",
    0xf60e: "Carga el bloque final de la cinta (3292 bytes en C350h) y salta a su entrada (ending_entry).",
    0xf61e: "Reproduce 768 bytes de memoria (sample_data) como pulsos por el altavoz (bit 4 del puerto FEh).",
    0xf64a: "Desde aquí hasta el final del bloque son datos de relleno que ya estaban en la memoria al grabar la cinta\n" +
      "(un volcado de memoria con restos de BASIC y de la fuente); sample_data usa los primeros 768 bytes.",
  },
  words: { 0xf0a8: 3, 0xf0b3: 3, 0xf0be: 3, 0xf0c9: 3, 0xf0d4: 3, 0xf0df: 3, 0xf0ea: 3, 0xf1a7: 5 },
};

export const LOADER: Names = {
  labels: {
    0xafc8: "music_run", 0xb00f: "music_tick", 0xb2e8: "swap_ending", 0xb3b0: "gfx_title1", 0xb510: "gfx_title2",
    0xb670: "gfx_title3", 0xb720: "gfx_title4",
    0xea60: "intro", 0xead9: "txt_menu", 0xec41: "txt_sel_a", 0xec42: "sel_a", 0xec57: "sel_b", 0xec67: "txt_sel_b",
    0xec8d: "menu_timeout", 0xec8f: "menu_flag", 0xec90: "title_sprite1", 0xec94: "title_sprite2", 0xec98: "title_sprite3",
    0xec9c: "title_sprite4", 0xeca0: "menu_loop", 0xecdb: "choose_kempston", 0xecf5: "choose_keyboard",
    0xed0f: "choose_sinclair", 0xed2a: "choose_cursor", 0xed46: "menu_mark", 0xed62: "start_game",
    0xeeae: "credits_jump", 0xeec0: "draw_cells", 0xeef5: "show_credits", 0xef30: "txt_credits",
    0xf030: "title_animate", 0xf066: "title_reset", 0xf06c: "title_frame", 0xf06d: "title_cells",
    0xf0e4: "launch_engine", 0xf0f2: "stub_loader",
  },
  comments: {
    0xafc8: "SOOTLAND — loader.bin (bloque A, cara 1): música, menú de la intro y cargador del motor.\n" +
      "© 1988 Zafiro Software (Spanish Soft). Programación: Fernando Pérez Alonso. Gráficos: Alberto Herraiz y\n" +
      "Fernando Pérez. Música: J. Torres. Incluido con permiso de su autor.\n\n" +
      "Toca la música hasta que se pulsa una tecla (el reproductor, music_tick, es la rutina de B00Fh).",
    0xea60: "Intro: pantalla del menú. El BASIC de la cinta salta aquí (RANDOMIZE USR 60000).\n" +
      "Borra la pantalla, pinta el menú (txt_menu, 360 bytes con códigos de control de PRINT AT/INK) y los cuatro\n" +
      "gráficos del título (draw_cells las dibuja en celdas de 8×8).",
    0xeca0: "Bucle del menú. Teclas 1–4 (fila F7h): elige el control y lo marca; 0 (fila EFh, bit 0): empezar.\n" +
      "La opción se guarda en FFFFh, donde la lee el motor.",
    0xed62: "Empezar: animación de salida y lanza el motor (launch_engine).",
    0xef30: "Créditos de la intro.",
    0xf0e4: "Copia el cargador de abajo (stub_loader, 100 bytes) encima de la música (AFC8h) y salta a él: así\n" +
      "puede cargar el motor sin pisarse a sí mismo.",
    0xf0f2: "stub_loader: se ejecuta en AFC8h (PHASE). Carga el motor (10370 bytes sin cabecera) en D778h con\n" +
      "LD-BYTES, lo reparte con tres LDIR (hud_gfx → CF08h, fuente → DD00h, sprites → C350h; el resto se queda\n" +
      "en EA60h) y salta a EA60h.",
  },
};

export const FINAL: Names = {
  labels: { 0xce72: "ending_entry" },
  comments: {
    0xc350: "Bloque final de la cinta (cara 2, 3292 bytes): se carga en C350h cuando se acaban los cuatro niveles.",
    0xce72: "Entrada del final (el motor salta aquí, vía load_ending).",
  },
};
