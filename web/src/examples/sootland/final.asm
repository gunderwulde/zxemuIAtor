; Sootland — final
; Último bloque de la cinta (cara 2, sin cabecera, 3292 bytes en C350h).
; © 1988 Zafiro Software (Spanish Soft). Programación: Fernando Pérez Alonso.
; Gráficos: Alberto Herraiz y Fernando Pérez. Música: J. Torres.
; Reconstruido por ingeniería inversa de la cinta original e incluido con permiso de su autor.



 org 0C350h
; Bloque final de la cinta (cara 2, 3292 bytes): se carga en C350h cuando se acaban los cuatro niveles.
lbl_C350:
 db 00h,00h,3Fh,20h,2Fh,2Fh,2Fh,2Fh,2Fh,2Fh,2Fh,2Fh,2Fh,2Fh,2Fh,2Fh
 db 2Fh,2Fh,2Fh,2Fh,2Fh,2Fh,2Fh,20h,3Fh,3Fh,0Fh,01h,00h,00h,00h,00h
 db 00h,00h,0FCh,06h,0F7h,0F7h,0F7h,0F7h,1Fh,0Fh,07h,03h,00h,00h,7Ch,46h
 db 77h,17h,17h,17h,17h,17h,0F7h,07h,0FFh,0FFh,0FFh,0FFh,00h,00h,00h,00h
 db 00h,00h,3Fh,20h,2Fh,0AFh,0AFh,0AFh,0AFh,0AFh,0AFh,0AFh,2Fh,2Fh,20h,2Fh
 db 2Fh,0AFh,0AFh,0AFh,0AFh,0AFh,0AFh,0AFh,0BFh,0BFh,9Fh,8Fh,00h,00h,00h,00h
 db 00h,00h,0FEh,06h,0F7h,0F7h,0F7h,17h,17h,17h,17h,17h,17h,0F7h,07h,0F7h
 db 17h,17h,17h,17h,17h,17h,17h,17h
 db 1Fh,1Fh,0Fh,07h,00h,00h,00h,00h,00h,00h,38h,2Ch,2Eh,2Eh,0AEh,0A2h
 db 0A9h,0ACh,0AFh,0AFh,0AFh,0AEh,0AEh,0AEh,0AEh,0AEh,0AEh,0AEh,0AEh,0AEh,0AEh,0AEh
 db 0BEh,9Eh,8Eh,86h,00h,00h,00h,00h,00h,00h,1Ch,16h,17h,17h,27h,47h
 db 97h,37h,0F7h,0F7h,0D7h,17h,17h,17h,17h,17h,17h,17h,17h,17h,17h,17h
 db 1Fh,1Fh,0Fh,07h,00h,00h,00h,00h,00h,00h,3Fh,20h,2Fh,2Fh,2Fh,2Fh
 db 28h,28h,28h,28h,2Fh,21h,2Fh,2Fh,2Fh,28h,28h,28h,28h,28h,2Fh,20h
 db 3Fh,3Fh,1Fh,0Fh,00h,00h,00h,00h,00h,00h,0FCh,06h,0FFh,0FFh,0FFh,0FFh
 db 00h,00h,00h,00h,80h,0C0h,0C0h,0C0h,0C0h,00h,00h,00h,00h,00h,0FEh,07h
 db 0FFh,0FFh,0FFh,0FFh,00h,00h,00h,00h,0FFh,0C0h,80h,80h,80h,80h,80h,80h
 ds 18,80h
 db 0C0h,0F0h,0FEh,0FFh,0FFh,0FFh,0FFh,03h,01h,00h,00h,00h,00h,00h,00h,60h
 db 70h,78h,7Ch,03h,01h,00h,00h,00h,40h,40h,40h,00h,00h,00h,00h,00h
 db 00h,00h,00h,0FFh,0FFh,0FFh,0FFh,0C0h,80h,80h,00h,00h,00h,00h,00h,00h
 db 00h,00h,00h,80h,80h,80h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h
 db 00h,20h,70h,0FFh,0FFh,0FFh,0FFh,01h,00h,00h,00h,00h,00h,00h,40h,40h
 db 40h,40h,00h,00h,00h,00h,00h,40h,40h,40h,40h,40h,40h,40h,40h,40h
 db 60h,70h,0F8h,0FFh,0FFh,0FFh,0FFh,0C7h,83h,81h,00h,00h,00h,00h,00h,00h
 ds 16
 db 20h,30h,79h,0FFh,0FFh,0FFh,0FFh,0E3h,0C1h,0C0h,0C0h,0C0h,80h,00h,00h,00h
 db 00h,00h,00h,00h,0C0h,0C0h,0C0h,0C0h,0C0h,0C0h,0C0h,0C0h,0C0h,0C0h,0C0h,0C0h
 db 0E0h,0F0h,0F8h,0FFh,0FFh,0FFh,0FFh,0C0h,80h,80h,00h,00h,00h,00h,00h,03h
 db 03h,00h,00h,00h,00h,00h,00h,00h,03h,03h,03h,00h,00h,00h,00h,00h
 db 40h,60h,0F0h,0FFh,0FFh,0FFh,0FFh,03h,01h,00h,00h,00h,00h,00h,00h,0FFh
 db 0FFh,7Fh,3Fh,1Fh,1Fh,1Fh,1Fh,3Fh,0FFh,0FFh,0FFh,01h,00h,00h,00h,00h
 db 00h,00h,00h,0FFh,0FFh,0FFh,00h,00h,3Fh,60h,0EFh,0EFh,0EFh,0EFh,0E8h,0E8h
 db 0E8h,0E8h,0E8h,0E8h,0E8h,0E8h,0E8h,0E8h,0E8h,0E8h,0E8h,0E8h
 db 0EFh,0E0h,0FFh,0FFh,0FFh,0FFh,00h,00h,00h,00h,00h,00h,0FCh,04h,0F4h,0F4h
 db 0F4h,0F4h,74h,74h,74h,74h,74h,74h,74h,74h,74h,74h,74h,74h,74h,74h
 db 0F4h,04h,0FCh,0F8h,0F0h,0E0h,00h,00h,00h,00h,00h,00h,38h,68h,0E8h,0E8h
 db 0E8h,0E8h,0E8h,0E8h,0E8h,0E8h,0E8h,0E8h,0E8h,0E8h,0E8h,0E8h,0E8h,0E8h
 db 0F4h,0FAh,0FDh,7Eh,3Fh,1Fh,0Fh,07h,00h,00h,00h,00h,00h,00h,1Ch,34h
 db 74h,0F4h,0F4h,0F5h,0F5h,0F5h,0F5h,0F5h,0F5h,0F5h,0F5h,0F5h,0F5h,0F5h,0F5h,0F5h
 db 0EDh,0DDh,0B9h,71h,0E1h,0C1h,81h,01h,00h,00h,00h,00h,00h,00h,3Fh,60h
 db 6Fh,0EFh,0EFh,0EFh,0E8h,0E8h,0E8h,0E8h,0EFh,0E0h,0EFh,0EEh,0ECh,0E8h,0E8h,0E8h
 db 0E8h,0E8h,0EFh,0E0h,0FFh,0FFh,0FFh,0FFh,00h,00h,00h,00h,00h,00h,0FCh,04h
 db 0FCh,0F8h,0E1h,81h,01h,01h,01h,01h,81h,81h,81h,01h,01h,01h,01h,01h
 db 01h,01h,0FDh,05h,0FDh,0FDh,0F1h,0C1h,00h,00h,00h,00h,00h,00h,3Fh,60h
 db 0EFh,0EFh,0EFh,0EFh,0E8h,0E8h,0EFh,0E0h,0EFh,0EBh,0E9h,0E8h,0E8h,0E8h,0E8h,0E8h
 db 0E8h,0E8h,0E8h,0E8h,0F8h,0F0h,0E0h,0E0h,00h,00h,00h,00h,00h,00h,0F8h,04h
 db 0F4h,0F4h,0F4h,0F4h,0F4h,0F4h,0F4h,04h,0B8h,0D0h,0E8h,0F4h,0F4h,0F4h,0F4h,0F4h
 db 0F4h,0F4h,0F4h,0F4h,0FCh,0F8h,0F0h,0E0h,00h,00h,00h,00h,0FFh,0C0h,80h,00h
 db 00h,00h,00h,00h,00h,03h,03h,03h,03h,03h,03h,03h,03h,03h,03h,03h
 db 03h,00h,00h,00h,00h,00h,00h,00h,00h,0FFh,0FFh,0FFh,0FFh,03h,01h,01h
 ds 19
 db 01h,01h,03h,07h,0Fh,1Fh,0FFh,0FFh,0FFh,0FFh,0C7h,83h,03h,03h,02h,02h
 db 02h,02h,02h,02h,02h,02h,02h,02h,02h,02h,02h,02h,02h
 db 00h,00h,00h,00h,80h,0C0h,0E0h,0F0h,0F8h,0FFh,0FFh,0FFh,0FFh,0E3h,0C1h,81h
 db 01h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h
 db 00h,00h,00h,04h,0Ch,1Ch,3Ch,7Ch,0FEh,0FFh,0FFh,0FFh,0FFh,0C0h,80h,00h
 db 00h,00h,00h,00h,00h,03h,03h,00h,00h,00h,00h,00h,01h,03h,03h,03h
 db 03h,00h,00h,00h,00h,00h,00h,00h,00h,0FFh,0FFh,0FFh,0FFh,03h,01h,01h
 db 00h,02h,04h,1Ch,7Ch,0FCh,0FCh,7Ch,3Ch,3Ch,3Ch,7Ch,0FCh,0FCh,0FCh,0FCh
 db 0FCh,00h,00h,00h,00h,00h,00h,0Ch,3Eh,0FFh,0FFh,0FFh,0FFh,40h,80h,00h
 db 00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h
 db 02h,02h,02h,02h,02h,02h,02h,02h,02h,02h
 db 06h,0Eh,0Eh,1Fh,0FFh,0FFh,0FFh,0FFh,07h,03h,01h,01h,01h,01h,01h,01h
 db 01h,01h,01h,03h,07h,03h,01h,01h,01h,01h,01h,01h,01h,01h,01h,01h
 db 03h,07h,0Fh,1Fh,0FFh,0FFh,0FFh,00h,00h,00h,00h,00h,00h,00h,00h,00h
 db 00h,00h,18h,18h,14h,16h,0Fh,1Fh,1Fh,0Fh,0Fh,0Fh,07h,03h,01h,08h
 db 08h,04h,04h,04h,00h,01h,02h,01h,00h,00h,00h,00h,00h,00h,00h,00h
 ds 24
 db 03h,04h,04h,02h,02h,02h,01h,01h,02h,02h,04h,04h,04h,08h,08h,08h
 db 08h,08h,08h,08h,08h,08h,08h,08h
 ds 27
 db 01h,01h,01h,00h,80h,0C1h,0F1h,0FDh,0FDh,0FEh,0FFh,0FFh,3Fh,07h,00h,80h
 db 10h,90h,10h,08h,04h,88h,50h,50h,20h,20h,40h,80h,80h,80h,80h,40h
 db 40h,40h,40h,03h,0Ch,30h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h
 db 00h,00h,00h,00h,03h,0FCh,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h
 ds 28
 db 03h,03h,23h,23h,03h,0Bh,0Bh,0Fh,0Fh,1Fh,9Fh,3Fh,3Fh,1Fh,0Fh,0Fh
 db 1Fh,0C2h,0DDh,0FDh,0DFh,1Dh,0E2h,0FFh,0FFh,0FFh,0FFh,00h,00h,00h,01h,03h
 db 03h,03h,03h,13h,33h,33h,33h,73h,33h,30h,11h,03h,00h,0Fh,0C0h,30h
 db 1Fh,1Fh,06h,2Ah,01h,01h,01h,01h,00h,01h,00h,00h,00h,00h,3Fh,40h
 db 80h,00h,01h,01h,03h,03h,07h,07h,0Fh,0Fh,0Ch,1Fh,1Fh,1Fh,1Eh,1Dh
 db 3Eh,3Fh,3Fh,3Eh,3Dh,3Fh,3Fh,3Eh,3Fh,3Fh,3Fh,3Fh,3Fh,3Eh,3Ch,38h
 db 30h,20h,20h,00h,00h,00h,00h,00h,07h,0FFh,0FFh,0FEh,0FDh,0F8h,0F8h,0F8h
 db 0FCh,0FFh,0DFh,0EFh,0F7h,0DFh,0EFh,0FFh,0FFh,22h,0DDh,0DDh,0FFh,0DDh,22h,0FFh
 db 0FFh,0FEh,0F0h,00h,00h,00h,86h,0E7h,0F9h,0FFh,0FDh,0FEh,0FEh,0FFh,9Eh,1Fh
 db 0F7h,0FBh,0FFh,0FFh,3Fh,0FFh,0Fh,1Fh,0FEh,0FDh,56h,0A9h,55h,56h,5Bh,7Fh
 db 0FFh,07h,0B8h,0DFh,60h,7Eh,3Dh,00h,5Bh,0D5h,0E5h,0E7h,0DAh,0DAh,0DBh,0DFh
 db 0DFh,0FFh,3Eh,0FFh,0FFh,0EFh,9Bh,0FFh,0EFh,0FFh,0E7h,0FFh,57h,0FEh,0FCh,0F8h
 db 0F0h,0E0h,0C0h,80h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h
 db 0FFh,0FFh,00h,0A0h,00h,08h,1Ch,1Fh,3Fh,0FFh,0FFh,0FFh,0FFh,0FFh,0FFh,0FFh
 db 0FFh,23h,0DDh,0DDh,0FFh,0DCh,20h,0F0h,80h,07h,03h,0Fh,07h,7Fh,7Fh,0FFh
 db 7Dh,0FFh,5Fh,0AFh,4Fh,7Fh,0FFh,0FFh,0BFh,0DFh,0DFh,0EFh,0EFh,0EFh,0EFh,7Fh
 db 0BFh,5Fh,0AEh,5Dh,0BBh,0FBh,0F7h,0EFh,0DCh,0B3h,0Fh,78h,0FFh,0FFh,0F0h,0Fh
 db 0FFh,0BFh,0BFh,7Fh,0FFh,0FFh,0FEh,0FCh,0FCh,0E4h,1Ch,0F8h,0F8h,0F0h,0E0h,0E0h
 db 0C0h,0C0h,80h,80h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h
 db 00h,00h,00h,00h,00h,00h,00h,00h
 db 0E0h,0F0h,38h,9Ch,5Eh,1Fh,7Fh,0FFh,0BFh,0DFh,0FFh,0F7h,0BBh,0DBh,0FBh,0FFh
 db 0FFh,0FFh,0FCh,0F3h,8Fh,0Ah,00h,00h,00h,00h,80h,80h,80h,80h,0C3h,0E4h
 db 0E0h,0C0h,0C8h,0CCh,8Ch,88h,80h,81h,01h,0Dh,0Fh,0C0h,0DDh,0DBh,0BEh,0BEh
 db 7Dh,7Dh,0FBh,0F7h,0E3h,0DDh,0B6h,58h,55h,0ABh,41h,0AAh,0E9h,96h,76h,0F7h
 db 0E3h,0E3h,0E3h,0C1h,81h,01h,06h,07h,07h,0Fh,0Dh,0Dh,0Bh,0Bh,07h,07h
 db 0Fh,0Fh,0Fh,0Fh,0Fh,0Eh,0Eh,0Ch,0Ch,08h,00h,00h,00h,00h,00h,00h
 db 00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h
 db 80h,80h,80h,80h,80h,80h,80h,80h,80h
 db 0C0h,3Fh,0FFh,0FFh,0FAh,0A0h,00h,00h,00h,00h,00h,00h,00h,00h,0C0h,60h
 db 20h,60h,60h,0E0h,0C0h,0C0h,0C0h,80h,80h,00h,00h,00h,00h,00h,0E0h,0DCh
 db 0BBh,0F0h,0E0h,0C0h,80h,00h,00h,00h,00h,80h,0C0h,60h,0B0h,0F8h,0F8h,7Ch
 db 0BCh,0BCh,0FCh,0FDh,0FDh,0FDh,0FBh,7Bh,7Bh,7Bh,0B3h,0B3h,0B3h,0A3h,0A3h,0A3h
 db 0C3h,0C3h,83h,83h,03h,02h,02h,02h,02h,00h,00h,00h,00h,00h,00h,00h
 ds 25
 db 0C0h,0F8h,0F0h,0A0h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h
 ds 16
 db 0C0h,30h,0Ch,03h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h
 db 00h,00h,00h,00h,00h,00h,80h,80h,80h,80h,80h,80h,80h,80h,80h,80h
 db 80h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h
 ds 59
 db 80h,60h,1Eh,01h,00h,00h,00h,02h,04h,04h,08h,08h,08h,08h,08h,08h
 db 08h,08h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h
 ds 20
 db 0FFh,0FFh,0FFh,0FFh,0FFh,0FFh,0FFh,0FFh,0FFh,0FFh
 db 0E3h,0C3h,0C3h,0C1h,0C0h,0C0h,0C0h,0C0h,0E0h,0E0h,0E0h,0F0h,0F8h,0F4h,0E2h,0E3h
 db 0F1h,0F1h,0F1h,0F8h,0FCh,0F8h,0FCh,0FEh,0FFh,0FFh,0FFh,0FFh,0FFh,0FEh,0FEh,0FEh
 db 0FEh,0FFh,0FFh,0FFh,0FFh,0FFh,0FFh,0FFh,0FFh,0FFh,0FFh,0FFh,0FFh,0FFh,0FFh,0FFh
 db 0FFh,0FFh,0FFh,0FFh,0FFh,0FFh,0FCh,00h,00h,00h,00h,00h,00h,00h,00h,00h
 ds 30
 db 0FFh,0FFh,0FFh,0FFh,0FFh,0FFh,0FFh,0FFh,0FFh,0FFh
 db 0FEh,0FEh,0FCh,0FCh,0FCh,7Ch,3Ch,0Ch,00h,00h,00h,00h,00h,00h,00h,0C0h
 db 0F8h,6Fh,0C7h,47h,47h,0E3h,71h,23h,07h,07h,8Fh,8Fh,1Fh,3Fh,3Fh,3Fh
 db 3Fh,1Fh,1Fh,1Fh,1Ch,0B0h,0C0h,83h,0CFh,0FFh,0FFh,0FFh,0FFh,0FFh,0FFh,0FFh
 db 0FFh,0FFh,0FFh,0FFh,0FFh,0FCh,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h
 ds 30
 db 0F0h,0C0h,80h,80h,80h,80h,80h,00h,00h,00h,00h,00h,00h,00h,00h,00h
 db 00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h
 db 80h,0C0h,0C0h,0C0h,0E0h,0E0h,0E0h,0C0h,80h,80h,80h,00h,80h,80h,0C0h,0E0h
 db 0F0h,00h,00h,00h,0C0h,0C0h,0C0h,80h,0D4h,0FCh,0FCh,0FCh,0FCh,0FCh,0FEh,0FEh
 db 0FFh,0C0h,80h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h
 ds 236
 db 0Fh,07h,03h,01h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h
 ds 88
 db 0FFh,0FFh,0FFh,0FFh,0FFh,7Fh,7Fh,3Fh,3Fh,3Fh,3Fh,3Fh,3Fh,3Fh,3Fh,3Fh
 db 00h,00h,00h,00h,00h,00h,1Fh,7Fh,3Fh,3Fh,3Fh,3Fh,3Fh,3Fh,1Fh,0Fh
 db 0Fh,0Fh,0Fh,0Fh,1Fh,1Fh,1Fh,3Fh,3Fh,7Fh,7Fh,0FFh,7Fh,1Fh,03h,00h
 ds 56
 ds 16,0FFh
 db 3Fh,07h,03h,07h,0Fh,1Fh,0FFh,0FFh,0FFh,0FFh,0FFh,0FFh,0FFh,0FFh,0FFh,0FFh
 ds 16,0FFh
 db 3Fh,0Fh,03h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h,00h
 ds 40
 ds 51,0FFh
 db 7Fh,1Fh,01h,00h,00h,00h,00h
; Entrada del final (el motor salta aquí, vía load_ending).
ending_entry:ld   hl,9C00h
            ld   bc,1B00h
lbl_CE78:   ld   a,07h
            ld   (hl),a
            dec  bc
            inc  hl
            ld   a,b
            or   c
            jr   nz,lbl_CE78
            call sub_CFEF
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            nop
            ld   b,a
            ld   b,a
            nop
            nop
            call sub_CFEF
sub_CEA7:   ld   ix,dat_CFD1
            call sub_CEDD
            ld   ix,dat_CFDB
            call sub_CEDD
            ld   ix,dat_CFE5
            call sub_CEDD
            ld   hl,9C00h
            ld   de,4000h
            ld   bc,1B00h
            ldir
            ld   ix,dat_CFE5
            call sub_CF96
            ld   ix,dat_CFDB
            call sub_CF96
            ld   ix,dat_CFD1
            call sub_CF96
            ret
sub_CEDD:   push ix
            ld   e,(ix+04h)
            ld   d,(ix+05h)
            ld   b,(ix+07h)
            ld   c,(ix+06h)
            ld   a,(ix+08h)
lbl_CEEE:   push af
            ld   a,(ix+09h)
lbl_CEF2:   push af
            ld   h,9Ch
            ld   a,b
            and  18h
            add  a,h
            ld   h,a
            ld   a,b
            and  07h
            rrca
            rrca
            rrca
            add  a,c
            ld   l,a
            push bc
            ld   b,08h
lbl_CF05:   ld   a,(hl)
            ld   (de),a
            inc  de
            inc  h
            djnz lbl_CF05
            pop  bc
            pop  af
            inc  b
            dec  a
            jr   nz,lbl_CEF2
            pop  af
            ld   b,(ix+07h)
            inc  c
            dec  a
            jr   nz,lbl_CEEE
            pop  ix
            push ix
            ld   e,(ix+02h)
            ld   d,(ix+03h)
            ld   b,(ix+07h)
            ld   c,(ix+06h)
            ld   a,(ix+08h)
lbl_CF2C:   push af
            ld   a,(ix+09h)
lbl_CF30:   push af
            ld   h,9Ch
            ld   a,b
            and  18h
            add  a,h
            ld   h,a
            ld   a,b
            and  07h
            rrca
            rrca
            rrca
            add  a,c
            ld   l,a
            push bc
            ld   b,08h
lbl_CF43:   ld   a,(de)
            and  (hl)
            ld   (hl),a
            inc  de
            inc  h
            djnz lbl_CF43
            pop  bc
            pop  af
            inc  b
            dec  a
            jr   nz,lbl_CF30
            pop  af
            ld   b,(ix+07h)
            inc  c
            dec  a
            jr   nz,lbl_CF2C
            pop  ix
            ld   e,(ix+00h)
            ld   d,(ix+01h)
            ld   b,(ix+07h)
            ld   c,(ix+06h)
            ld   a,(ix+08h)
lbl_CF69:   push af
            ld   a,(ix+09h)
lbl_CF6D:   push af
            ld   h,9Ch
            ld   a,b
            and  18h
            add  a,h
            ld   h,a
            ld   a,b
            and  07h
            rrca
            rrca
            rrca
            add  a,c
            ld   l,a
            push bc
            ld   b,08h
lbl_CF80:   ld   a,(de)
            or   (hl)
            ld   (hl),a
            inc  de
            inc  h
            djnz lbl_CF80
            pop  bc
            pop  af
            inc  b
            dec  a
            jr   nz,lbl_CF6D
            pop  af
            ld   b,(ix+07h)
            inc  c
            dec  a
            jr   nz,lbl_CF69
            ret
sub_CF96:   ld   e,(ix+04h)
            ld   d,(ix+05h)
            ld   b,(ix+07h)
            ld   c,(ix+06h)
            ld   a,(ix+08h)
lbl_CFA5:   push af
            ld   a,(ix+09h)
lbl_CFA9:   push af
            ld   h,9Ch
            ld   a,b
            and  18h
            add  a,h
            ld   h,a
            ld   a,b
            and  07h
            rrca
            rrca
            rrca
            add  a,c
            ld   l,a
            push bc
            ld   b,08h
lbl_CFBC:   ld   a,(de)
            ld   (hl),a
            inc  de
            inc  h
            djnz lbl_CFBC
            pop  bc
            pop  af
            inc  b
            dec  a
            jr   nz,lbl_CFA9
            pop  af
            ld   b,(ix+07h)
            inc  c
            dec  a
            jr   nz,lbl_CFA5
            ret
dat_CFD1:
 db 50h,0C3h,50h,0C4h,0F0h,0D2h,07h
dat_CFD8:
 db 18h,08h,04h
dat_CFDB:
 db 50h,0C5h,50h,0C6h,0D8h,0D6h,10h
dat_CFE2:
 db 18h,08h,04h
dat_CFE5:
 db 50h,0C7h,0F8h,0CAh,0C0h,0DAh,0Bh
dat_CFEC:
 db 00h,09h,0Dh
sub_CFEF:   ld   a,1Ch
            ld   bc,1800h
            ld   hl,9C00h
lbl_CFF7:   xor  a
            ld   (hl),a
            dec  bc
            inc  a
            ld   a,b
            or   c
            jr   nz,lbl_CFF7
            ld   a,1Ch
lbl_D001:   ld   (dat_CFD8),a
            dec  a
            push af
            call sub_CEA7
            pop  af
            ld   b,a
            djnz lbl_D001
            ld   a,0FCh
lbl_D00F:   ld   (dat_CFE2),a
            inc  a
            push af
            call sub_CEA7
            pop  af
            ld   b,a
            dec  b
            dec  b
            djnz lbl_D00F
            ld   a,21h
lbl_D01F:   ld   (dat_CFEC),a
            inc  a
            push af
            call sub_CEA7
            pop  af
            ld   b,a
            djnz lbl_D01F
            ret
