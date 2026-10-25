# Sample knowledge base documents

Machine names, alarm codes, and the supplier "Beispielwerk Antriebe" are made up.

Load them with `python -m knowledge_base.load_sample_data`. The loader stores every document with the source type
`synthetic_sample`.

## What is in the folder

| File | Purpose |
| --- | --- |
| `syn-sis-001` to `syn-sis-005` | One service information sheet for each scripted test call in `test_calls/call-01` to `call-05`, with the same machine names and alarm codes. |
| `syn-sis-006` | A distractor for call 03: the same robot, but a different error code (E-240-A instead of E-204-A). An exact search for E-204-A must not return it. |
| `syn-sis-007` | A sheet with status `concept`, for testing how a search treats documents that are not final. |
| `syn-sup-001` | A short German (`de`) excerpt of a fictional supplier manual for a frequency controller. | 

## File format

The loader reads every `.md` file in this folder in file-name order, except
this `README.md`. Sub-folders are not read. Files must be UTF-8 text.

```
name: Conveyor belt runs backwards after restart
document_number: SYN-SIS-001
version: 1.0
document_date: 2026-09-01
status: final
language: en
machine_types: CV-12B
components: conveyor drive; direction selector; photo sensor
---
## Section 1: Symptoms
Text of the first passage.

## Section 2: Possible cause
Text of the second passage.
```