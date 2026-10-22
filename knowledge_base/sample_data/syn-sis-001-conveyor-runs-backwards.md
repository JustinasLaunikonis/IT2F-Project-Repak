name: Conveyor belt runs backwards after restart
document_number: SYN-SIS-001
version: 1.0
document_date: 2026-09-01
status: final
language: en
machine_types: CV-12B
components: conveyor drive; direction selector; HMI touch screen; photo sensor
---
## Section 1: Symptoms
After a stop and a new start, the belt of conveyor module CV-12B runs backwards. Products travel back toward the upstream machine instead of forward to the next station.

The operator display shows warning W-217 "direction command changed". Error E-417-B "reverse feedback active" often appears right after it. On the HMI, the field "requested direction" says reverse.

## Section 2: Possible cause
The direction selector on the HMI touch screen was set to reverse. This usually happens by accident while the screen is cleaned and the manual controls are unlocked. The drive follows the reverse command at the next start.

A broken photo sensor or a wiring fault is rarely the cause when warning W-217 is shown.

## Section 3: Safe checks
Keep the conveyor stopped and keep connected machines in manual mode. Do not open the electrical cabinet. Stay behind the safety line and check only what the display shows:
- Read the "requested direction" field.
- Check which direction arrow is highlighted.
- Hold a test box in front of the photo sensor and check that its input changes on the display.

## Section 4: Fix steps
1. Tap the forward arrow on the HMI and then tap Confirm. "Requested direction" must now say forward.
2. Check that warning W-217 has gone. E-417-B may stay in the history list; that is normal.
3. Lower the speed and run a short test with one test box. The box must move forward.
4. With supervisor rights, switch on "lock manual direction controls", so cleaning the screen cannot change the direction again.

## Section 5: When to escalate
Contact a Repak service engineer when the belt still runs backwards while "requested direction" says forward, when E-417-B becomes active again without anyone changing the direction, or when the motor current is outside the range printed beside the display.
