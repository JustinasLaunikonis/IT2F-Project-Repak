from pydantic import BaseModel, ConfigDict, Field

class ExtractedCallFields(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        strict=True,
    )

    machine_number: str | None = Field(
        description="Exact machine identifier stated in the call."
    )

    customer: str | None = Field(
        description="Customer company name, if explicitly stated."
    )

    problem: str | None = Field(
        description="Brief factual summary of the reported problem."
    )

    alarm_code: str | None = Field(
        description="Exact alarm code or alarm text stated in the call."
    )

    actions_taken: str | None = Field(
        description="Actions already performed and their reported results."
    )


PLACEHOLDERS = {
    "machine_number": "[machinenummer]",
    "customer": "[klant]",
    "problem": "[probleem]",
    "alarm_code": "[alarmcode of exacte tekst]",
    "actions_taken": "[acties en resultaten]",
}


def to_report_fields(extracted: ExtractedCallFields) -> dict:
    fields = {}

    for name, value in extracted.model_dump().items():
        placeholder = PLACEHOLDERS[name]
        fields[placeholder] = value.strip() if value is not None else ""

    return fields
