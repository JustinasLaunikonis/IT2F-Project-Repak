name: Label printer prints BANANA TEST instead of the product label
document_number: SYN-SIS-002
version: 1.0
document_date: 2026-09-01
status: final
language: en
machine_types: LabelJet LX-400+
components: print queue; label template; barcode
---
## Section 1: Symptoms
The LabelJet LX-400+ prints a wrong label. The product field says "BANANA TEST", and the barcode and expiry date are test values instead of the real product data.

The printer shows warning W-302 "template changed outside production job". The printer display shows the job DEMO-BANANA-01, while the line display still shows the production job.

## Section 2: Possible cause
After a training session, the training job DEMO-BANANA-01 was left active in the print queue, above the production job. The printer prints whatever job is active, so it keeps printing the banana training label. The printer hardware is usually fine.

## Section 3: Safe checks
Stop the line and pause the printer. Keep every wrongly labelled box apart from good production. Do not touch the print head or the rollers.
- Open Queue on the printer display and check which job has the green "active" arrow.
- Check that the label roll size and the gap sensor value match the job specification.

## Section 4: Fix steps
1. Select DEMO-BANANA-01 in the queue and choose Cancel. Do not delete other jobs.
2. Open Details of the production job and check the template, batch, expiry date, and barcode.
3. Print one test copy and scan the barcode. The scanner must report it as valid.
4. Compare the horizontal offset with the job specification; a training session may have changed it.
5. Tap Pause and then Resume once and check that the production job stays active.

## Section 5: When to escalate
Contact a Repak service engineer when the print head diagnostics report failed dots, when W-302 comes back without a training job, or when the barcode does not scan as valid. The customer's quality team decides what happens with the wrongly labelled boxes.
