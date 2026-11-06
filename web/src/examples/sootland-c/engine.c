/* SOOTLAND — motor del juego, versión en C.
 *
 * Es el motor del ejemplo "sootland" (engine.asm, bloque B de la cinta) reescrito en C:
 * misma lógica, mismas direcciones de memoria y mismos recursos, así que el cargador, la
 * música, los niveles y el bloque final son los del original (ver docs/proyectos.md).
 * Lo que sigue en ensamblador está en hw.c (puertos, ROM y bucles de temporización).
 *
 * © 1988 Zafiro Software (Spanish Soft). Programación: Fernando Pérez Alonso.
 * Gráficos: Alberto Herraiz y Fernando Pérez. Música: J. Torres.
 * Reconstruido por ingeniería inversa e incluido con permiso de su autor.
 *
 * Cómo se ejecuta: el cargador carga este bloque en D778h, reparte las tres primeras piezas
 * (pieces.asm) y salta a EA60h, donde empieza el crt0 del compilador.
 */
#pragma org 0xEA60

#include <string.h>
#include "hw.h"

/* ---- Memoria que fija el original ---- */
#define LEVEL_BODY   0x61A8u    /* 4 fondos de 0x1200 bytes (bitmap 4096 + atributos 512) */
#define BG_BUFFER    0xAA00u    /* escena que se compone (imagen del bitmap) ... */
#define BG_ATTRS     0xBA00u    /* ... y sus atributos */
#define LEVEL_HEADER 0xCA38u    /* 1222 bytes: sprites del nivel, actores y apariciones */
#define LVL_ACTORS   0xCE40u
#define LVL_SPAWNS   0xCEA4u
#define HUD_GFX      0xCF08u    /* marco de marcadores: 2048 bytes de bitmap ... */
#define HUD_ATTRS    0xD708u    /* ... y 256 de atributos */
#define ENDING_CODE  0xC350u
#define MENU_CONTROL (*(unsigned char *)0xFFFFu)   /* control elegido en el menú: 1 Kempston, 2 teclado, 3 cursor, 4 Sinclair */

#define FRAMES_LO    (*(volatile unsigned char *)0x5C78u)
#define FRAMES_HI    (*(volatile unsigned char *)0x5C79u)
#define CHARS_LO     (*(unsigned char *)0x5C36u)   /* CHARS = dirección de la fuente - 256 */
#define CHARS_HI     (*(unsigned char *)0x5C37u)
#define DF_SZ        (*(unsigned char *)0x5C6Bu)

#define TIME_START   250        /* vueltas del bucle que dura un enemigo */
#define PACE_START   50         /* vueltas entre fotogramas de animación del enemigo */
#define PACE_MIN     26
#define WAVES        20         /* enemigos por nivel */

/* Los textos llevan códigos de control de la ROM: 16h AT fila,col; 10h INK; 11h PAPER. Con la
   fuente del juego, las mayúsculas dibujan la mitad de arriba de cada letra y las minúsculas
   la de abajo: por eso cada texto se escribe dos veces en filas consecutivas. */
static const char txt_rewind[] = "\026\002\000\020\002\021\000REBOBINA LA CARA B Y PULSA PLAY\026\003\000\020\003rebobina la cara b y pulsa play  ";
static const char txt_press_space[] = "\026\006\002\020\001\021\000 PULSE ESPACE PARA EMPEZAR \026\007\002\020\003 pulse espace para empezar";
static const char txt_game_over[] = "\026\012\013\020\001\021\000GAME OVER\026\013\013\020\003game over";
static const char txt_error[] = "\026\012\015\020\003\021\000ERROR\026\013\015\020\002error";
/* Los dos dígitos del nivel (posiciones 12 y 25) se cambian antes de imprimirlo. */
static char txt_level[] = "\026\000\014\020\001\021\000FASE 0\026\001\014\020\003\021\000fase 0\026\012\006\020\003\021\000PULSA ENTER Y PLAY\026\013\006\020\005pulsa enter y play";

/* Registros 0-13 del AY-3-8912 de cada sonido (el juego usa un AY: puertos FFFDh/BFFDh). */
static const unsigned char ay_silence[14] = { 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x1E, 0x40, 0x10, 0x10, 0x10, 0x00, 0x07, 0x00 };
static const unsigned char ay_fx_miss[14] = { 0x67, 0x00, 0x49, 0x00, 0x45, 0x00, 0x00, 0xF8, 0x10, 0x10, 0x10, 0x00, 0x10, 0x00 };
static const unsigned char ay_fx_hit[14]  = { 0x00, 0x00, 0x00, 0x00, 0x00, 0x11, 0x1F, 0x40, 0x10, 0x10, 0x10, 0x00, 0x08, 0x06 };
static const unsigned char ay_fx_actor[14] = { 0x65, 0x00, 0x42, 0x00, 0x3C, 0x00, 0x00, 0xF0, 0x10, 0x10, 0x10, 0x00, 0x10, 0x00 };

/* Gráfico de cada tipo de enemigo (1-4): 5 fotogramas de 32 bytes seguidos. */
static const unsigned int enemy_gfx[5] = { 0xC738, 0xC738, 0xC7D8, 0xC878, 0xC918 };

/* ---- Estado ---- */

/* Sprite de celdas de 8x8 que se compone sobre BG_BUFFER. Los gráficos, las máscaras y los
   búferes donde se guarda el fondo viven en la zona de sprites (C350h-CA37h) y en la cabecera
   del nivel; las celdas van por columnas, 8 bytes por celda. */
struct sprite {
    unsigned int gfx, mask, save;
    unsigned char col, row, w, h, on;
};

/* Actor del escenario (de la cabecera del nivel): 8 por nivel. Un disparo lo manda a la escena 5. */
struct actor {
    unsigned char scene, row, col, type;
    unsigned int gfx, mask;
};

struct sprite crosshair = { 0xC350, 0xC3B4, 0xC418, 10, 10, 2, 2, 1 };
struct sprite enemy     = { 0xC998, 0xC4E0, 0xC544, 11, 10, 2, 2, 0 };
/* Indicador "hay un enemigo en otra escena". Su búfer de fondo, C4E0h, coincide con la máscara
   del enemigo, como en el original. */
struct sprite enemy2    = { 0xC9B8, 0xC9D8, 0xC4E0, 15, 2, 2, 2, 1 };
struct sprite blast     = { 0xC9F8, 0xCA18, 0x0000, 0, 0, 2, 2, 0 };    /* el destello guarda su fondo en la ROM: no se restaura */
struct sprite actor1    = { 0x0000, 0x0000, 0xC60C, 0, 0, 2, 2, 0 };
struct sprite actor2    = { 0x0000, 0x0000, 0xC5A8, 0, 0, 2, 2, 0 };
struct sprite bonus     = { 0xC670, 0xC690, 0xC6B0, 29, 12, 2, 2, 0 };    /* on = bonus activo */

struct actor actor_table[8];
unsigned char spawn_table[90];      /* apariciones: registros de 3 bytes (escena, columna, fila) */

unsigned char scene;                /* escena actual (1-4) */
unsigned char level;                /* nivel (1-4) */
unsigned char wave;                 /* enemigos abatidos en el nivel */
unsigned char lives;
unsigned int time_left;             /* vueltas que le quedan al enemigo visible */
unsigned int time_reload;           /* ... y con las que empieza: baja con cada acierto */
unsigned int enemy_timer;           /* vueltas hasta que aparezca el siguiente enemigo */
unsigned int step_timer;            /* vueltas hasta el siguiente fotograma del enemigo */
unsigned int pace;                  /* ... y con las que se reinicia: baja con cada acierto */
unsigned char enemy_on;             /* hay un enemigo en juego (aunque esté en otra escena) */
unsigned char enemy_scene;
unsigned char enemy_type;

/* Cifras (la menos significativa primero). La puntuación son las seis primeras; la de más arriba
   desborda a la 6. El récord (cifras 7-12) sale de fábrica en 300000 y el juego no lo actualiza. */
unsigned char digits[14];
#define SCORE_TOP 5
#define RECORD_TOP 12


/* ---- Marcadores y pantalla ---- */

/* Las cifras se escriben con la calculadora de la ROM, dos veces: con la fuente normal (fila de
   arriba) y con CHARS desplazado 15 caracteres (fila de abajo, la otra mitad de cada cifra). */
static void print_digits(unsigned char top, unsigned char n)
{
    unsigned char i;
    for (i = 0; i < n; i++) print_num(digits[top - i]);
}

static void hud_numbers(unsigned char row, unsigned char col, unsigned char lives_too)
{
    rst10(0x16); rst10(row); rst10(col);
    if (lives_too) { rst10('0'); print_num(lives); }
}

/* Vidas y puntuación en las filas 20-21 (el marco hud_gfx ya está en pantalla). */
static void draw_hud(void)
{
    CHARS_HI = 0xDC;
    rst10(0x16); rst10(20); rst10(2);
    rst10('0'); print_num(lives);
    rst10(0x16); rst10(20); rst10(7);
    print_digits(SCORE_TOP, 6);
    CHARS_HI = 0xDB; CHARS_LO = 0x88;
    rst10(0x16); rst10(21); rst10(2);
    rst10('0'); print_num(lives);
    rst10(0x16); rst10(21); rst10(7);
    print_digits(SCORE_TOP, 6);
    CHARS_LO = 0; CHARS_HI = 0x3C;      /* otra vez la fuente de la ROM */
}

static void print_msg(const char *s, unsigned int n)
{
    CHARS_HI = 0xDC;
    print_str(s, n);
}

static void wait_key(unsigned int port, unsigned char mask)
{
    while (inp(port) & mask) ;
}

static void score_carry(void)
{
    unsigned char i;
    for (i = SCORE_TOP; i >= 1; i--)
        if (digits[i] == 10) { digits[i] = 0; digits[i + 1]++; }
}

/* ---- Sprites ---- */

/* Un fotograma: compone los sprites sobre BG_BUFFER, vuelca la escena a la pantalla y
   deshace los sprites en BG_BUFFER (el destello no: lo borra el redibujado de la escena). */
static void draw_frame(void)
{
    if (enemy_on != 1) enemy.on = 0;
    sprite_draw(&enemy);
    sprite_draw(&enemy2);
    sprite_draw(&actor1);
    sprite_draw(&actor2);
    sprite_draw(&bonus);
    sprite_draw(&crosshair);
    sprite_draw(&blast);
    memcpy((void *)0x4000, (void *)BG_BUFFER, 0x1000);
    memcpy((void *)0x5800, (void *)BG_ATTRS, 0x200);
    sprite_restore(&crosshair);
    sprite_restore(&bonus);
    sprite_restore(&actor2);
    sprite_restore(&actor1);
    sprite_restore(&enemy2);
    sprite_restore(&enemy);
}

/* ---- Escenas ---- */

static void place_actor(struct actor *a)
{
    struct sprite *s = a->type == 1 ? &actor1 : &actor2;
    s->row = a->row;
    s->col = a->col;
    s->gfx = a->gfx;
    s->mask = a->mask;
    s->on = 1;
}

/* Un tipo 1 va al sprite actor1; cualquier otro, a actor2. */
static void place_actors(void)
{
    unsigned char i;
    actor1.on = 0;
    actor2.on = 0;
    for (i = 0; i < 8; i++)
        if (actor_table[i].scene == scene) place_actor(&actor_table[i]);
}

/* Dibuja la escena: el fondo de la escena actual del cuerpo del nivel, los actores y los marcadores. */
static void draw_scene(void)
{
    memcpy((void *)BG_BUFFER, (void *)(LEVEL_BODY + (unsigned int)(scene - 1) * 0x1200u), 0x1200);
    place_actors();
    draw_hud();
}

static void play_sound(const unsigned char *regs)
{
    ay_play(regs);
}

/* ---- Jugada ---- */

/* El enemigo aparece: elige tipo (1-4) y sitio de la tabla de apariciones con el reloj de
   FRAMES como azar, y empieza su temporizador. */
static void enemy_pop_up(void)
{
    unsigned char r;
    const unsigned char *p;
    enemy_on = 1;
    enemy_type = ((FRAMES_LO ^ FRAMES_HI) & 3) + 1;
    r = (FRAMES_LO & 0x0F) + 1;
    p = spawn_table + 3 * r;
    enemy_scene = p[0];
    enemy.col = p[1];
    enemy.row = p[2];
    enemy.gfx = enemy_gfx[enemy_type];
    enemy_timer = TIME_START;
}

/* Pierde una vida: parpadeo del destello en sitios al azar, pausa y, si no quedan, fin de la
   partida (devuelve 1). Si no, reinicia el ritmo y redibuja. */
static unsigned char lose_life(void)
{
    unsigned char i;
    ay_play(ay_silence);
    scene = enemy_scene;
    draw_scene();
    enemy2.on = 0;
    crosshair.on = 0;
    enemy.on = 1;
    draw_frame();
    blast.on = 1;
    for (i = 0; i < 5; i++) {
        spin(0);
        ay_play(ay_silence);
        blast.col = FRAMES_LO & 0x1F;
        blast.row = ((FRAMES_LO ^ FRAMES_HI) & 0x0F) - 1;
        draw_frame();
    }
    blast.on = 0;
    long_pause();
    memset((void *)0x5800, 0, 0x200);
    spin(0);
    lives--;
    if (lives == 0) return 1;
    crosshair.on = 1;
    enemy_on = 0;
    time_left = TIME_START;
    enemy_timer = TIME_START;
    enemy.on = 0;
    enemy2.on = 0;
    time_reload = TIME_START;
    step_timer = PACE_START;
    pace = PACE_START;
    draw_scene();
    return 0;
}

/* El enemigo gasta una vuelta de su tiempo; si se acaba, pierdes una vida. */
static unsigned char enemy_time(void)
{
    time_left--;
    if (time_left == 0) return lose_life();
    return 0;
}

/* Un paso de juego: temporizadores del enemigo, avance de su animación y dibujo. Devuelve 1 si
   la partida ha terminado. */
static unsigned char game_tick(void)
{
    if (!enemy_on) {
        enemy_timer--;
        if (enemy_timer == 0) enemy_pop_up();
    } else {
        if (enemy_scene != scene) {
            /* En otra escena: no se ve, pero corre el tiempo y se enciende el indicador. */
            enemy.on = 0;
            if (enemy_time()) return 1;
            enemy2.on = 1;
        } else {
            enemy.on = 1;
            if (enemy_time()) return 1;
            enemy2.on = 0;
        }
        step_timer--;
        if (step_timer == 0) {
            enemy.gfx += 32;                /* siguiente fotograma */
            step_timer = PACE_START;
        }
    }
    draw_frame();
    /* El bonus: si no está activo, nace con una probabilidad de 1/256 por vuelta; activo, cruza
       la pantalla de derecha a izquierda una columna por vuelta. */
    if (bonus.on != 1) {
        if ((FRAMES_LO ^ rreg()) == 0x0A) bonus.on = 1;
    } else {
        bonus.col--;
        bonus.row = 12;
        if (bonus.col == 1) { bonus.on = 0; bonus.col = 29; }
    }
    return 0;
}

/* Un acierto sube la dificultad hasta PACE_MIN: el enemigo dura 20 vueltas menos y avanza más
   deprisa. Devuelve a begin_scene el siguiente enemigo. */
static void speed_up(void)
{
    if (pace == PACE_MIN) return;
    time_reload -= 20;
    pace -= 4;
    step_timer = pace;
}

static void check_actors(void)
{
    unsigned char i;
    for (i = 0; i < 8; i++) {
        struct actor *a = &actor_table[i];
        if (a->scene == scene && a->row == crosshair.row && a->col == crosshair.col) {
            a->scene = 5;                   /* fuera de todas las escenas */
            ay_play(ay_fx_actor);
            digits[1] += 5;                 /* +50 puntos */
            score_carry();
        }
    }
    draw_scene();
}

static void check_bonus(void)
{
    if (bonus.on != 1) return;
    if (crosshair.row != 12 || crosshair.col != bonus.col) return;
    ay_play(ay_fx_miss);
    digits[2]++;                            /* +100 puntos */
    bonus.on = 0;
    score_carry();
}

/* Disparo. Devuelve 1 si has dado al enemigo (empieza otra escena). */
static unsigned char fire(void)
{
    ay_play(ay_silence);
    check_actors();
    check_bonus();
    if (enemy2.on == 1 && crosshair.col == 15 && crosshair.row == 2) ay_play(ay_fx_miss);
    if (enemy.on == 1 && enemy.row == crosshair.row && enemy.col == crosshair.col && enemy_scene == scene) {
        digits[2]++;                        /* +100 puntos */
        score_carry();
        ay_play(ay_fx_hit);
        speed_up();
        return 1;
    }
    return 0;
}

/* Resultado de leer el control. */
#define ACT_NONE 0
#define ACT_FIRE 1
#define ACT_QUIT 2

static void aim_up(void)    { crosshair.row--; if (crosshair.row == 0xFF) crosshair.row = 0; }
static void aim_down(void)  { crosshair.row++; if (crosshair.row == 15) crosshair.row = 14; }

/* Al salirse por un borde la mira pasa a la escena de al lado. */
static void aim_left(void)
{
    crosshair.col--;
    if (crosshair.col == 0xFF) {
        crosshair.col = 30;
        scene++;
        if (scene == 5) scene = 1;
        draw_scene();
    }
}

static void aim_right(void)
{
    crosshair.col++;
    if (crosshair.col == 31) {
        crosshair.col = 0;
        scene--;
        if (scene == 0) scene = 4;
        draw_scene();
    }
}

/* Lee el control elegido en el menú y mueve la mira. Las filas del teclado se leen por el
   puerto FEh con la fila en el byte alto; una tecla pulsada es un bit a 0. */
static unsigned char read_controls(void)
{
    unsigned char k;
    switch (MENU_CONTROL) {
    case 1:                                 /* Kempston: sólo vale una dirección sola */
        k = inp(0xE9);
        if (k == 0x08) aim_up();
        else if (k == 0x04) aim_down();
        else if (k == 0x01) aim_right();
        else if (k == 0x02) aim_left();
        else if (k == 0x10) return ACT_FIRE;
        return ACT_NONE;
    case 2:                                 /* teclado: ESPACIO, Q, A, P, O */
        if (!(inp(0x7FFE) & 1)) return ACT_FIRE;
        if (!(inp(0xFBFE) & 1)) aim_up();
        else if (!(inp(0xFDFE) & 1)) aim_down();
        else {
            k = inp(0xDFFE);
            if (!(k & 1)) aim_right();
            else if (!(k & 2)) aim_left();
        }
        return ACT_NONE;
    case 3:                                 /* cursor: 0 dispara; 9, 8, 7 y 6 mueven; CAPS SHIFT sale */
        k = inp(0xEFFE);
        if (!(k & 1)) return ACT_FIRE;
        if (!(k & 2)) aim_up();
        else if (!(k & 4)) aim_down();
        else if (!(k & 8)) aim_right();
        else if (!(k & 16)) aim_left();
        else if (!(inp(0xFEFE) & 1)) return ACT_QUIT;
        return ACT_NONE;
    case 4:                                 /* Sinclair */
        k = inp(0xEFFE);
        if (!(k & 1)) return ACT_FIRE;
        if (!(k & 4)) aim_right();
        else if (!(k & 8)) aim_up();
        else if (!(k & 16)) aim_down();
        else if (!(inp(0xF7FE) & 16)) aim_left();
        return ACT_NONE;
    }
    return ACT_QUIT;
}

/* Estado inicial de un nivel: copia de las tablas de la cabecera (los actores abatidos se
   restauran) y de los contadores. */
static void begin_level(void)
{
    memcpy(spawn_table, (void *)LVL_SPAWNS, 90);
    memcpy(actor_table, (void *)LVL_ACTORS, 64);
    wave = 0xFF;
    scene = 1;
    crosshair.on = 1;
    crosshair.row = 10;
    crosshair.col = 15;
    time_reload = TIME_START;
    step_timer = PACE_START;
    pace = PACE_START;
    bonus.on = 0;
}

#define NEXT_LEVEL 0
#define GAME_OVER  1
#define QUIT       2

/* Juega un nivel: una escena por cada enemigo (hasta WAVES). */
static unsigned char play_level(void)
{
    unsigned char act;
    begin_level();
    for (;;) {
        enemy.col = 21;
        enemy.row = 21;
        wave++;
        if (wave == WAVES) return NEXT_LEVEL;
        time_left = time_reload;
        enemy_timer = time_reload;
        enemy_on = 0;
        enemy2.on = 0;
        enemy.on = 0;
        bonus.col = 31;
        draw_scene();
        for (;;) {
            act = read_controls();
            if (act == ACT_QUIT) return QUIT;
            if (act == ACT_FIRE && fire()) break;
            if (game_tick()) return GAME_OVER;
        }
    }
}

/* ---- Carga y menús ---- */

static void load_error(void)
{
    unsigned char *p;
    for (p = (unsigned char *)0x5800; p < (unsigned char *)0x5B00; p++)
        *p = (*p << 1) | (*p >> 7);         /* rota los atributos: un destello de aviso */
    print_msg(txt_error, sizeof(txt_error) - 1);
}

/* Cabecera del nivel (flag = nivel) y cuerpo (flag = nivel + 4). Si falla, avisa y repite. */
static void load_level(unsigned char n)
{
    for (;;) {
        if (!ld_bytes(LEVEL_HEADER, 0x04C6, n)) { load_error(); continue; }
        if (!ld_bytes(LEVEL_BODY, 0x4800, n + 4)) { load_error(); continue; }
        return;
    }
}

static void press_space(void)
{
    print_msg(txt_press_space, sizeof(txt_press_space) - 1);
    outp(0xFE, 0);
    wait_key(0x7FFE, 1);
    outp(0xFE, 0);
}

/* Marco de marcadores: tercio inferior de la pantalla y sus atributos. */
static void draw_hud_frame(void)
{
    memcpy((void *)0x5000, (void *)HUD_GFX, 0x800);
    memcpy((void *)0x5A00, (void *)HUD_ATTRS, 0x100);
    chan_open(2);
    CHARS_HI = 0xDC;
    rst10(0x16); rst10(20); rst10(16);
    print_digits(RECORD_TOP, 6);
    CHARS_HI = 0xDB; CHARS_LO = 0x88;
    rst10(0x16); rst10(21); rst10(16);
    print_digits(RECORD_TOP, 6);
    CHARS_LO = 0;
}

int main(void)
{
    unsigned char i, r;

    digits[RECORD_TOP] = 3;
    DF_SZ = 0;                              /* las 24 líneas, sin zona inferior de BASIC */
    chan_open(2);
    memset((void *)0x5800, 0, 0x300);
    outp(0xFE, 0);
    level = 1;

    for (;;) {                              /* una partida desde la cinta */
        print_msg(txt_rewind, sizeof(txt_rewind) - 1);
        load_level(1);
        for (;;) {                          /* una partida con el nivel 1 en memoria */
            press_space();
            for (i = 0; i < 5; i++) digits[i] = 0;
            digits[6] = 0;
            draw_hud_frame();
            lives = 4;
            for (;;) {                      /* los niveles */
                r = play_level();
                if (r == QUIT) return 0;
                if (r == GAME_OVER) break;
                level++;
                if (level == 5) {
                    ld_bytes(ENDING_CODE, 0x0CDC, 0xFF);
                    jump_ending();
                }
                txt_level[12] = '0' + level;
                txt_level[25] = 0x21 + level;
                print_msg(txt_level, sizeof(txt_level) - 1);
                wait_key(0xBFFE, 1);        /* ENTER */
                load_level(level);
                press_space();
                lives++;
            }
            print_msg(txt_game_over, sizeof(txt_game_over) - 1);
            if (level != 1) break;
        }
    }
}
