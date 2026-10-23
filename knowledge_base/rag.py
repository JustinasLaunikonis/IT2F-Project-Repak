from copy import deepcopy

from knowledge_base.database import BLOCKED_SOURCE_TYPES, DOCUMENT_STATUSES, SOURCE_TYPES


QUERY_FIELDS = {
    "machine_number": "[machinenummer]",
    "alarm_code": "[alarmcode of exacte tekst]",
    "affected_part": "[onderdeel of station]",
    "problem": "[probleem]",
    "symptoms": "[symptomen]",
    "search_question": "[zoekvraag]",
    "search_terms": "[zoektermen]",
}


def build_request(report_fields, *, review_confirmed=False, max_results=5):
    if review_confirmed is not True:
        raise ValueError("Employee review must be explicitly confirmed.")
    if not isinstance(report_fields, dict):
        raise ValueError("report_fields must be a dictionary.")
    if isinstance(max_results, bool) or not isinstance(max_results, int):
        raise ValueError("max_results must be a whole number from 1 to 20.")
    if max_results < 1 or max_results > 20:
        raise ValueError("max_results must be a whole number from 1 to 20.")

    request = {}
    has_query_text = False
    for field_name, placeholder in QUERY_FIELDS.items():
        value = report_fields.get(placeholder)
        if value is None:
            value = ""
        if not isinstance(value, str):
            raise ValueError(field_name + " must be text or None.")
        request[field_name] = value
        if value.strip() != "":
            has_query_text = True
    if not has_query_text:
        raise ValueError("At least one reviewed query field must contain text.")

    request["review_confirmed"] = True
    request["max_results"] = max_results
    return request


class LocalRetriever:
    """Replace retrieve with a local implementation returning passage dictionaries."""

    def retrieve(self, request):
        raise NotImplementedError("Local retrieval is not configured.")


class LocalAdviceGenerator:
    """Replace generate with local generation from untrusted source data only."""

    def generate(self, request, passages):
        raise NotImplementedError("Local advice generation is not configured.")


class RagService:
    """Validate adapter boundaries and return drafts requiring employee review."""

    def __init__(self, retriever=None, advice_generator=None):
        self.retriever = retriever
        self.advice_generator = advice_generator

    def run(self, request):
        checked_request = _check_request(request)
        if self.retriever is None or self.advice_generator is None:
            return _result("disabled", "Local retrieval and advice adapters are not configured.")

        try:
            retrieved = self.retriever.retrieve(checked_request.copy())
            passages = _check_passages(retrieved, checked_request["max_results"])
            if len(passages) == 0:
                return _result("no_sources", "No usable source found; no advice was generated.")

            generated = self.advice_generator.generate(
                checked_request.copy(), deepcopy(passages)
            )
            advice_steps, uncertainties = _check_advice(generated, passages)
        except Exception:
            return _result("unavailable", "Local knowledge service is unavailable or returned invalid data.")

        result = _result("draft", "Employee confirmation is required before copying results into a report.")
        result["passages"] = passages
        result["advice_steps"] = advice_steps
        result["uncertainties"] = uncertainties
        warned_documents = []
        for passage in passages:
            document_id = passage["document_id"]
            if passage["status"] == "concept" and document_id not in warned_documents:
                warning = "Document " + str(document_id) + " is a concept; its instructions need verification."
                result["warnings"].append(warning)
                warned_documents.append(document_id)
        return result


def _check_request(request):
    if not isinstance(request, dict):
        raise ValueError("request must be a dictionary from build_request.")
    report_fields = {}
    for field_name, placeholder in QUERY_FIELDS.items():
        report_fields[placeholder] = request.get(field_name)
    return build_request(
        report_fields,
        review_confirmed=request.get("review_confirmed"),
        max_results=request.get("max_results"),
    )


def _result(status, warning):
    return {
        "status": status,
        "passages": [],
        "advice_steps": [],
        "uncertainties": [],
        "warnings": [warning],
    }


def _required_text(value, field_name):
    if not isinstance(value, str) or value.strip() == "":
        raise ValueError(field_name + " must contain text.")
    return value


def _optional_text(value, field_name):
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError(field_name + " must be text or None.")
    if value.strip() == "":
        return None
    return value


def _whole_number(value, field_name, minimum):
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError(field_name + " must be a whole number.")
    if value < minimum:
        raise ValueError(field_name + " is below the minimum.")
    return value


def _text_list(value, field_name):
    if not isinstance(value, list):
        raise ValueError(field_name + " must be a list of text values.")
    checked_values = []
    for item in value:
        checked_values.append(_required_text(item, field_name))
    return checked_values


def _check_passages(retrieved, max_results):
    if not isinstance(retrieved, list) or len(retrieved) > max_results:
        raise ValueError("Retriever must return a list within max_results.")
    passages = []
    passage_ids = []
    for source in retrieved:
        if not isinstance(source, dict):
            raise ValueError("Each passage must be a dictionary.")
        # Do not rely on the loader: raw SQL can bypass its privacy block.
        if source.get("source_type") in BLOCKED_SOURCE_TYPES:
            continue
        passage = _check_passage(source)
        if passage["passage_id"] in passage_ids:
            raise ValueError("Passage IDs must be unique.")
        passage_ids.append(passage["passage_id"])
        passages.append(passage)
    return passages


def _check_passage(source):
    passage = {}
    for field_name in ("passage_id", "document_id"):
        passage[field_name] = _whole_number(source.get(field_name), field_name, 1)
    passage["position"] = _whole_number(source.get("position"), "position", 0)
    for field_name in ("name", "location", "text", "location_in_document", "added_at"):
        passage[field_name] = _required_text(source.get(field_name), field_name)

    source_type = source.get("source_type")
    if source_type not in SOURCE_TYPES or source_type in BLOCKED_SOURCE_TYPES:
        raise ValueError("Source type is not allowed.")
    passage["source_type"] = source_type
    status = source.get("status")
    if status not in DOCUMENT_STATUSES:
        raise ValueError("Document status is invalid.")
    passage["status"] = status

    for field_name in ("document_number", "version", "document_date", "language"):
        passage[field_name] = _optional_text(source.get(field_name), field_name)
    for field_name in ("machine_types", "components"):
        passage[field_name] = _text_list(source.get(field_name), field_name)
    return passage


def _check_advice(generated, passages):
    if not isinstance(generated, dict):
        raise ValueError("Generated advice must be a dictionary.")
    steps = generated.get("advice_steps")
    if not isinstance(steps, list) or len(steps) == 0:
        raise ValueError("Draft advice must contain cited steps.")
    known_ids = []
    for passage in passages:
        known_ids.append(passage["passage_id"])

    checked_steps = []
    for step in steps:
        if not isinstance(step, dict):
            raise ValueError("Each advice step must be a dictionary.")
        text = _required_text(step.get("text"), "advice text")
        passage_ids = step.get("passage_ids")
        if not isinstance(passage_ids, list) or len(passage_ids) == 0:
            raise ValueError("Every advice step must cite passages.")
        checked_ids = []
        for passage_id in passage_ids:
            _whole_number(passage_id, "advice passage_id", 1)
            if passage_id not in known_ids:
                raise ValueError("Advice cites an unknown passage.")
            checked_ids.append(passage_id)
        checked_steps.append({"text": text, "passage_ids": checked_ids})
    uncertainties = _text_list(generated.get("uncertainties"), "uncertainties")
    return checked_steps, uncertainties
