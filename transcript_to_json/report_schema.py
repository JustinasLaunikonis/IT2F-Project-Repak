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
    customer: str | None = Field(description="Company name given for the caller's organisation. Record it here even if the organisation may be a distributor; leave distributor for manual entry rather than guessing the company's role.")
    problem: str | None = Field(description="Short main issue or complaint explicitly reported by any speaker, including software issues in a test recording. The phrase 'The problem is' is not required. Leave identifiers, timing, frequency, actions, and additional observations to their dedicated fields; do not infer symptoms.")
    alarm_code: str | None = Field(description="Exact alarm code or alarm text stated in the call.")
    actions_taken: str | None = Field(description="Actions already performed and their reported results.")
    distributor: None = Field(default=None, description="Manual entry only. Always return null, even if a distributor is named. Record the caller's company under customer instead.")
    technician: str | None = Field(default=None, description="Technician explicitly identified as the recipient of telephone/app/email advice or follow-up ('TEL/APP/Mail aan' in the Word document). This is separate from Technical Support, the Repak employee taking the call; do not infer the recipient from a job title alone.")
    contact_person: str | None = Field(default=None, description="Actual name of the person making the call, if explicitly stated. Do not substitute another technician, a different follow-up contact, or a speaker label.")
    time_difference: str | None = Field(default=None, description="Time difference explicitly stated or inferred from a country.")
    engineer: str | None = Field(default=None, description="Engineer explicitly assigned to this case, for the Engineer field in the Word document footer. Do not assume this is the Repak employee taking the call or another named technician.")
    contact_details: str | None = Field(default=None, description="Phone number or email explicitly stated to contact caller again.")
    language: str | None = Field(default=None, description="Language used in the conversation, infer from transcript language.")
    repak_employee: str | None = Field(default=None, description="Technical Support: actual name of the Repak employee who answers or accepts the call. A greeting such as 'Repak service, <name> speaking' explicitly identifies this person. Extract that stated name; do not infer a name from a speaker label alone or substitute another named person.")
    machine_status: str | None = Field(default=None, description="Current machine status, only if explicitly discussed: stopped, limited production, or in production. Do not infer status from symptoms, alarm codes, or suggested actions; return null when it is not stated.")
    affected_part: str | None = Field(default=None, description="Affected part or station explicitly identified.")
    problem_started: str | None = Field(default=None, description="When and in what situation the fault started, as reported; do not invent an absolute date.")
    frequency: str | None = Field(default=None, description="All explicitly reported frequencies and operating conditions when the problem occurs, such as every stroke, during start-up, run mode, manual mode, after warming up, or a stated interval. If it occurs every stroke in manual mode after warming up, retain all three details. Do not reduce this to a fixed category or make assumptions.")
    symptoms: str | None = Field(default=None, description="Additional observations explicitly reported, beyond the main problem and details in the alarm, status, timing, frequency, and actions fields. Do not restate those fields; return null if there are no additional observations.")
    recent_changes: str | None = Field(default=None, description="Recente wijzigingen: maintenance, settings, parts, or software changes explicitly reported to have taken place before the problem arose. Actions performed after the fault began belong in actions_taken. Do not assume timing; missing information is null, not 'no changes'.")
    missing_information: str | None = Field(default=None, description="Information explicitly described as unknown or still needed.")
    questions: str | None = Field(default=None, description="Unanswered questions actually asked in the call.")
    reported_cause: str | None = Field(default=None, description="Cause or suspected cause explicitly stated by any speaker, including an unconfirmed hypothesis. Preserve uncertainty such as 'might' or 'not confirmed'; do not introduce your own diagnosis.")
    other_causes: str | None = Field(default=None, description="Additional possible causes explicitly discussed, preserving uncertainty. Exclude any cause already recorded in reported_cause; return null if there are no other causes.")
    reported_facts: str | None = Field(default=None, description="Additional facts from this call that have no more specific report field. Do not recap or paraphrase facts already captured elsewhere, and do not claim a verified knowledge source. Return null if nothing remains.")
    search_question: str | None = Field(default=None, description="Documentation search question explicitly discussed.")
    search_terms: str | None = Field(default=None, description="Exact machine identifiers, alarm codes, and reported component names usable as search terms.")
    advice: str | None = Field(default=None, description="Advice actually given in the call, attributed to its speaker; do not generate new repair advice.")
    uncertainties: str | None = Field(default=None, description="Additional ambiguities or uncertainties explicitly expressed in the call. Do not repeat missing_information, questions, or uncertainty already preserved with a stated cause; return null if nothing remains.")


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
