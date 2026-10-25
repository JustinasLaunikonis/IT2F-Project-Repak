name: Robot arm drops boxes with vacuum error E-240-A
document_number: SYN-SIS-006
version: 1.0
document_date: 2026-09-08
status: final
language: en
machine_types: RA-07; MotionCore MC-900
components: gripper VG-220+; vacuum hose; suction cups; vacuum filter
---
## Section 1: Symptoms
Robot arm RA-07 drops a box during transport, or stops right after picking it up. The MotionCore MC-900 controller shows the red error E-240-A "vacuum level too low during transport".

## Section 2: Possible cause
The vacuum of gripper VG-220+ is too weak to hold the box. Common causes are a vacuum hose with a hole or crack, worn suction cups, or a blocked vacuum filter.

## Section 3: Safe checks
Stop the cell, put it in manual mode, and keep the gate closed. Do not enter the fenced area.
- Read the vacuum level on the controller and compare it with the acceptable range shown on the screen.
- From outside the cell, look at the suction cups for cracks or missing parts.

## Section 4: Fix steps
1. Let trained maintenance staff replace worn suction cups or clean the vacuum filter, following the site procedure.
2. Run one test cycle at reduced speed and check that the vacuum level stays inside the range during transport.

## Section 5: When to escalate
Contact a Repak service engineer when the vacuum level stays outside the range after maintenance, or when E-240-A returns during production.
