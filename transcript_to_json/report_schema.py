from pydantic import BaseModel, ConfigDict, Field


# Every placeholder in the Word template, including fields filled manually.
REPORT_FIELDS = (
    "[machinenummer]", "[distributeur]", "[naam monteur]", "[contactpersoon]",
    "[klant]", "[tijdverschil]", "[datum]", "[engineer]", "[goedgekeurd]",
    "[datum / tijd]", "[telefoonnummer en/of e-mailadres]", "[taal]",
    "[naam van Repak medewerker die melding aangenomen heeft]",
    "[machine staat stil / productie beperkt / machine in productie]",
    "[audio link]", "[betrouwbaarheid transcriptie hoog / gemiddeld / laag]",
    "[tijdstippen of toelichting]", "[transcriptie]", "[probleem]",
    "[alarmcode of exacte tekst]", "[onderdeel of station]",
    "[datum / tijd / situatie]", "[eenmalig / af en toe / continu]",
    "[symptomen]", "[acties en resultaten]",
    "[onderhoud / instellingen / onderdelen / software]",
    "[ontbrekende informatie]", "[vragen]", "[oorzaak]", "[oorzaken]",
    "[feiten uit melding en kennisbron]", "[zekerheid analyse hoog / gemiddeld / laag]",
    "[zoekvraag]", "[zoektermen]", "[bronnen]",
    "[documentnaam, documentnummer en versie]", "[map of koppeling]",
    "[datum van bron]", "[relevantie van zoekresultaat hoog / gemiddeld / laag]",
    "[conceptadvies]", "[documentnaam, documentnummer, versie, paragraaf of pagina]",
    "[afwijkingen of onzekerheden]",
)


def empty_report():
    return {key: "" for key in REPORT_FIELDS}


class ExtractedCallFields(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True,)

    machine_number: str | None = Field(description="Exact machine identifier stated in the call.")
    customer: str | None = Field(description="Customer company name")
    problem: str | None = Field(description="Brief summary of the main issue or complaint explicitly reported by any speaker, including software issues in a test recording. The phrase 'The problem is' is not required; do not infer additional symptoms.")
    alarm_code: str | None = Field(description="Exact alarm code or alarm text stated in the call.")
    actions_taken: str | None = Field(description="Actions already performed and their reported results.")
    distributor: str | None = Field(default=None, description="Distributor explicitly named.")
    technician: str | None = Field(default=None, description="Customer's technician/mechanic explicitly named.")
    contact_person: str | None = Field(default=None, description="Person explicitly identified as the contact.")
    time_difference: str | None = Field(default=None, description="Time difference explicitly stated or inferred from a country.")
    engineer: str | None = Field(default=None, description="Engineer explicitly assigned to this case.")
    contact_details: str | None = Field(default=None, description="Phone number or email explicitly stated to contact caller again.")
    language: str | None = Field(default=None, description="Language used in the conversation, infer from transcript language.")
    repak_employee: str | None = Field(default=None, description="Repak employee's actual name if stated; speaker labels alone do not identify a person.")
    machine_status: str | None = Field(default=None, description="Reported machine status. Choose between one of these three only: stopped, limited production, in production.")
    affected_part: str | None = Field(default=None, description="Affected part or station explicitly identified.")
    problem_started: str | None = Field(default=None, description="When and in what situation the fault started, as reported; do not invent an absolute date.")
    frequency: str | None = Field(default=None, description="Reported frequency. Choose between one of these three only: one-off, occasionally, continuously.")
    symptoms: str | None = Field(default=None, description="Observed symptoms explicitly reported.")
    recent_changes: str | None = Field(default=None, description="Reported maintenance, settings, parts, or software changes. Missing information is null, not 'no changes'.")
    missing_information: str | None = Field(default=None, description="Information explicitly described as unknown or still needed.")
    questions: str | None = Field(default=None, description="Unanswered questions actually asked in the call.")
    reported_cause: str | None = Field(default=None, description="Cause or suspected cause explicitly stated by any speaker, including an unconfirmed hypothesis. Preserve uncertainty such as 'might' or 'not confirmed'; do not introduce your own diagnosis.")
    other_causes: str | None = Field(default=None, description="Other possible causes explicitly discussed, preserving uncertainty.")
    reported_facts: str | None = Field(default=None, description="Facts from this call only; do not claim a verified knowledge source.")
    search_question: str | None = Field(default=None, description="Documentation search question explicitly discussed.")
    search_terms: str | None = Field(default=None, description="Exact machine identifiers, alarm codes, and reported component names usable as search terms.")
    advice: str | None = Field(default=None, description="Advice actually given in the call, attributed to its speaker; do not generate new repair advice.")
    uncertainties: str | None = Field(default=None, description="Ambiguities or uncertainties explicitly expressed in the call.")


PLACEHOLDERS = {
    "machine_number": "[machinenummer]",
    "customer": "[klant]",
    "problem": "[probleem]",
    "alarm_code": "[alarmcode of exacte tekst]",
    "actions_taken": "[acties en resultaten]",
    "distributor": "[distributeur]",
    "technician": "[naam monteur]",
    "contact_person": "[contactpersoon]",
    "time_difference": "[tijdverschil]",
    "engineer": "[engineer]",
    "contact_details": "[telefoonnummer en/of e-mailadres]",
    "language": "[taal]",
    "repak_employee": "[naam van Repak medewerker die melding aangenomen heeft]",
    "machine_status": "[machine staat stil / productie beperkt / machine in productie]",
    "affected_part": "[onderdeel of station]",
    "problem_started": "[datum / tijd / situatie]",
    "frequency": "[eenmalig / af en toe / continu]",
    "symptoms": "[symptomen]",
    "recent_changes": "[onderhoud / instellingen / onderdelen / software]",
    "missing_information": "[ontbrekende informatie]",
    "questions": "[vragen]",
    "reported_cause": "[oorzaak]",
    "other_causes": "[oorzaken]",
    "reported_facts": "[feiten uit melding en kennisbron]",
    "search_question": "[zoekvraag]",
    "search_terms": "[zoektermen]",
    "advice": "[conceptadvies]",
    "uncertainties": "[afwijkingen of onzekerheden]",
}


def to_report_fields(extracted: ExtractedCallFields) -> dict:
    fields = empty_report()

    for name, value in extracted.model_dump().items():
        placeholder = PLACEHOLDERS[name]
        fields[placeholder] = value.strip() if value is not None else ""

    return fields
