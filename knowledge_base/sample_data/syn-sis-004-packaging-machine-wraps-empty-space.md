name: Packaging machine wraps empty space
document_number: SYN-SIS-004
version: 1.0
document_date: 2026-09-01
status: final
language: en
machine_types: packaging machine
components: product sensor; wrapping unit
---
## Section 1: Symptoms
The packaging machine starts a wrapping cycle before a product arrives. It makes neat, sealed packages with nothing inside: it wraps empty space. The empty packages come out at the normal cycle rate.

## Section 2: Possible cause
The product sensor is dirty. Dust, pieces of film, or product residue on the sensor lens make the sensor report a product that is not there, so the machine starts wrapping.

## Section 3: Safe checks
Stop the machine and set it to manual mode. Follow the site lock-out procedure before you clean anything near moving parts.
- Look at the indicator light of the product sensor. When it is on while nothing is in front of the sensor, the sensor sees a product that is not there.

## Section 4: Fix steps
1. Clean the lens of the product sensor with a dry, lint-free cloth.
2. Check the indicator light: off with no product in front of the sensor, on when you hold a product in front of it.
3. Restart the machine. It must wait for products instead of wrapping empty space.
4. Run a few products and check that no empty packages come out.

## Section 5: When to escalate
Contact a Repak service engineer when the indicator light stays on after cleaning, when the sensor or its bracket is damaged, or when the machine still makes empty packages.
