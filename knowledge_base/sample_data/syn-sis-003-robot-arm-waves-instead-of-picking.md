name: Robot arm waves instead of picking up boxes
document_number: SYN-SIS-003
version: 1.0
document_date: 2026-09-01
status: final
language: en
machine_types: RA-07; MotionCore MC-900
components: gripper VG-220+; program selection; pallet pattern; box sensor
---
## Section 1: Symptoms
When a new box arrives, robot arm RA-07 moves left and right in a wave instead of picking up the box. It does not leave its working area.

The MotionCore MC-900 controller shows "Program paused" and warning W-611 "production program does not match line recipe". Error E-204-A "target position outside selected pallet pattern" is shown in yellow. The active program is the demo program DEMO-WAVE-V2.

## Section 2: Possible cause
The demonstration program DEMO-WAVE-V2 is still active after a training session or a demonstration. The approved production program is not selected, so the robot runs the demo wave movement whenever the box sensor sees a box.

## Section 3: Safe checks
Put the cell in manual mode, stop the conveyor, and keep the gate closed. Nobody may enter the fenced area or bypass a safety device.
- Open the program list and check which program is marked active.
- Check that the vacuum level of gripper VG-220+ is inside the range shown on the screen.
- Place a test box at the external loading point and check that the box sensor input changes.

## Section 4: Fix steps
1. Select the approved production program and confirm the pallet pattern from the work order. Warning W-611 must disappear; E-204-A may stay in the history list.
2. From outside the cell, run Safe Home at reduced speed.
3. Run one dry cycle, then one cycle with a test box. The robot must follow its normal path without a wave.
4. With supervisor approval, switch on "lock demonstrations during production".

## Section 5: When to escalate
Stop the cycle and contact a Repak service engineer when the arm makes any unexpected movement during the supervised restart, touches the fence or other equipment, or when E-204-A becomes active again while the production program is selected.
