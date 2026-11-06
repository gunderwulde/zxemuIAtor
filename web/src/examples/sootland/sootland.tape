{
 "v": 1,
 "name": "Sootland",
 "blocks": [
  {
   "type": "basic",
   "name": "SHOOT",
   "autostart": 10,
   "source": "10 CLEAR 24999\n20 LOAD \"loader.bin\" CODE\n30 LET l=USR 60000"
  },
  {
   "type": "code",
   "name": "loader.bin",
   "src": "loader.asm",
   "addr": "0xAFC8",
   "len": 20535,
   "param2": 32887
  },
  {
   "type": "data",
   "flag": 255,
   "src": "engine.asm",
   "addr": "0xD778",
   "len": 10370
  },
  {
   "type": "data",
   "flag": 1,
   "src": "level1.asm",
   "addr": "0xCA38",
   "len": 1222
  },
  {
   "type": "data",
   "flag": 5,
   "src": "level1.asm",
   "addr": "0x61A8",
   "len": 18432
  },
  {
   "type": "data",
   "flag": 2,
   "src": "level2.asm",
   "addr": "0xCA38",
   "len": 1222
  },
  {
   "type": "data",
   "flag": 6,
   "src": "level2.asm",
   "addr": "0x61A8",
   "len": 18432
  },
  {
   "type": "data",
   "flag": 3,
   "src": "level3.asm",
   "addr": "0xCA38",
   "len": 1222
  },
  {
   "type": "data",
   "flag": 7,
   "src": "level3.asm",
   "addr": "0x61A8",
   "len": 18432
  },
  {
   "type": "data",
   "flag": 4,
   "src": "level4.asm",
   "addr": "0xCA38",
   "len": 1222
  },
  {
   "type": "data",
   "flag": 8,
   "src": "level4.asm",
   "addr": "0x61A8",
   "len": 18432
  },
  {
   "type": "data",
   "flag": 255,
   "src": "final.asm",
   "addr": "0xC350",
   "len": 3292
  }
 ]
}