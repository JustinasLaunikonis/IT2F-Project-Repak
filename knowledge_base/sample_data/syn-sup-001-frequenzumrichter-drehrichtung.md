name: Frequenzumrichter BW-FU30: Drehrichtung einstellen (Auszug)
document_number: SYN-SUP-001
version: 2.1
document_date: 2025-11-15
status: final
language: de
machine_types: BW-FU30
components: Frequenzumrichter; Motor; Drehrichtung
---
## Abschnitt 1: Allgemeine Hinweise
Dieser Auszug beschreibt den fiktiven Frequenzumrichter BW-FU30 des fiktiven Herstellers Beispielwerk Antriebe. Arbeiten am Umrichter dürfen nur von Elektrofachkräften durchgeführt werden. Vor allen Arbeiten die Anlage spannungsfrei schalten und gegen Wiedereinschalten sichern.

## Abschnitt 2: Parameter P-104 Drehrichtung
Parameter P-104 legt die Drehrichtung des Motors fest: 0 = Rechtslauf, 1 = Linkslauf, 2 = Vorgabe über die Steuerklemme. Die Werkseinstellung ist 2. Bei Vorgabe über die Steuerklemme bestimmt die übergeordnete Steuerung die Drehrichtung.

## Abschnitt 3: Störmeldung F-17
Die Störmeldung F-17 "Drehrichtung gesperrt" erscheint, wenn die Steuerung eine Drehrichtung anfordert, die mit Parameter P-105 gesperrt ist. Den Motor nicht durch Ändern der Verdrahtung umpolen. Zuerst die Parameter P-104 und P-105 prüfen.

## Abschnitt 4: Kundendienst
Wenn F-17 nach der Prüfung der Parameter weiterhin erscheint, den Kundendienst des Herstellers kontaktieren und die Seriennummer des Umrichters angeben.
