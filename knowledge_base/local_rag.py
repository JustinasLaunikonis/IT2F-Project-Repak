import re

from knowledge_base import database
from knowledge_base.rag import (
    QUERY_FIELDS,
    LocalAdviceGenerator,
    LocalRetriever,
    build_request,
)


STOP_WORDS = {
    "a", "an", "and", "are", "as", "at", "be", "by", "can", "do", "does",
    "for", "from", "has", "have", "how", "i", "in", "is", "it", "my", "not",
    "of", "on", "or", "our", "please", "the", "this", "to", "was", "we",
    "what", "when", "which", "with", "without",
}
ALARM_PATTERN = re.compile(
    r"(?<![\w+-])(?:E|W)-\d+(?:-[A-Za-z0-9]+)*(?![\w+-])",
    re.IGNORECASE,
)


def _checked_request(request):
    """Keep direct adapter calls behind the same review gate as RagService."""
    if not isinstance(request, dict):
        raise ValueError("A reviewed request is required.")
    fields = {}
    for field_name, placeholder in QUERY_FIELDS.items():
        fields[placeholder] = request.get(field_name)
    return build_request(
        fields,
        review_confirmed=request.get("review_confirmed"),
        max_results=request.get("max_results"),
    )


def _tokens(text):
    tokens = []
    for token in re.findall(r"[^\W_]+(?:[-+][^\W_]+)*\+?", text.casefold()):
        if token not in STOP_WORDS and token not in tokens:
            tokens.append(token)
    return tokens


def _contains_exact(value, text):
    pattern = r"(?<![\w+-])" + re.escape(value.strip()) + r"(?![\w+-])"
    return re.search(pattern, text, re.IGNORECASE) is not None


def _matches_machine(machine_number, document):
    if machine_number.strip() == "":
        return False
    for machine_type in document["machine_types"]:
        if _contains_exact(machine_number, machine_type):
            return True
    return False


def _alarm_values(request):
    """Preserve exact codes, including codes supplied in search terms."""
    alarms = []
    explicit_alarm = request["alarm_code"].strip().casefold()
    if explicit_alarm != "":
        alarms.append(explicit_alarm)
    for field_name in QUERY_FIELDS:
        if field_name in ("machine_number", "alarm_code"):
            continue
        for alarm in ALARM_PATTERN.findall(request[field_name]):
            if alarm.casefold() not in alarms:
                alarms.append(alarm.casefold())
    return alarms


def _document_text(document, passages):
    parts = [document["name"]]
    for passage in passages:
        parts.append(passage["text"])
    return "\n".join(parts)


def _query_tokens(request, machine_is_known):
    parts = []
    for field_name in QUERY_FIELDS:
        if field_name not in ("machine_number", "alarm_code"):
            parts.append(request[field_name])
    context_tokens = _tokens(" ".join(parts))
    if not machine_is_known:
        return context_tokens
    machine_tokens = _tokens(request["machine_number"])
    evidence_tokens = []
    for token in context_tokens:
        if token not in machine_tokens:
            evidence_tokens.append(token)
    return evidence_tokens


def _keyword_score(document, passages, query_tokens):
    title_tokens = _tokens(document["name"])
    subject_tokens = _tokens(" ".join(document["machine_types"] + document["components"]))
    body_tokens = _tokens(_document_text(document, passages))
    score = 0
    for token in query_tokens:
        if token in title_tokens:
            score = score + 4
        if token in subject_tokens:
            score = score + 3
        if token in body_tokens:
            score = score + 1
    return score


def _passage_order(passage):
    # Return safety context before fix steps; retain concept disclaimers.
    heading = passage["location_in_document"].casefold()
    priority = 4
    if "do not use it to advise a customer" in passage["text"].casefold():
        priority = 0
    elif "safe checks" in heading:
        priority = 0
    elif "fix steps" in heading:
        priority = 1
    elif "escalat" in heading:
        priority = 2
    return priority, passage["position"], passage["id"]


def _document_order(candidate):
    return -candidate["score"], candidate["document"]["id"]


def _passage_result(document, passage):
    result = document.copy()
    result.pop("id")
    result["document_id"] = document["id"]
    result["passage_id"] = passage["id"]
    result["position"] = passage["position"]
    result["location_in_document"] = passage["location_in_document"]
    result["text"] = passage["text"]
    return result


class SqliteKeywordRetriever(LocalRetriever):
    def __init__(self, connection):
        self.connection = connection

    def retrieve(self, request):
        request = _checked_request(request)
        candidates = self._read_candidates()
        machine_is_known = False
        for candidate in candidates:
            if _matches_machine(request["machine_number"], candidate["document"]):
                machine_is_known = True
        query_tokens = _query_tokens(request, machine_is_known)
        has_context = False
        for field_name in QUERY_FIELDS:
            if field_name in ("machine_number", "alarm_code"):
                continue
            if request[field_name].strip() != "":
                has_context = True
        alarms = _alarm_values(request)
        matches = []
        for candidate in candidates:
            document = candidate["document"]
            if machine_is_known and not _matches_machine(request["machine_number"], document):
                continue
            text = _document_text(document, candidate["passages"])
            alarms_match = True
            for alarm in alarms:
                if not _contains_exact(alarm, text):
                    alarms_match = False
            if not alarms_match:
                continue
            score = _keyword_score(document, candidate["passages"], query_tokens)
            if score == 0 and len(alarms) == 0:
                if has_context or not machine_is_known:
                    continue
            candidate["score"] = score
            candidate["passages"].sort(key=_passage_order)
            matches.append(candidate)
        matches.sort(key=_document_order)
        return _select_passages(matches, request["max_results"])

    def _read_candidates(self):
        candidates = []
        rows = self.connection.execute("SELECT id, source_type FROM documents ORDER BY id").fetchall()
        for row in rows:
            if row[1] in database.BLOCKED_SOURCE_TYPES:
                continue
            document = database.get_document(self.connection, row[0])
            passages = database.get_passages(self.connection, row[0])
            if len(passages) > 0:
                candidates.append({"document": document, "passages": passages})
        return candidates


def _select_passages(matches, max_results):
    results = []
    passage_index = 0
    while len(results) < max_results:
        added_passage = False
        for candidate in matches:
            if len(results) == max_results:
                break
            if passage_index < len(candidate["passages"]):
                passage = candidate["passages"][passage_index]
                results.append(_passage_result(candidate["document"], passage))
                added_passage = True
        if not added_passage:
            break
        passage_index = passage_index + 1
    return results


class ExtractiveAdviceGenerator(LocalAdviceGenerator):
    def generate(self, request, passages):
        request = _checked_request(request)
        uncertainties = [
            "Keyword retrieval and verbatim extraction are a baseline, not semantic search or an LLM.",
            "Quotes are untrusted draft context, not verified instructions. Review applicability, safety, and possible disagreements before use.",
        ]
        has_synthetic = False
        has_concept = False
        machine_verified = False
        restricted_documents = []
        for passage in passages:
            if passage["source_type"] == database.SAMPLE_SOURCE_TYPE:
                has_synthetic = True
            if passage["status"] == "concept":
                has_concept = True
            if _matches_machine(request["machine_number"], passage):
                machine_verified = True
            if "do not use it to advise a customer" in passage["text"].casefold():
                restricted_documents.append(passage["document_id"])
        if has_synthetic:
            uncertainties.append("Synthetic sample sources are fictional and must not be used to advise real customers.")
        if has_concept:
            uncertainties.append("Concept sources are unverified; missing checks or fix steps must not be invented.")
        if request["machine_number"].strip() != "" and not machine_verified:
            uncertainties.append("The machine number is not linked in source metadata; matches rely on other keyword/alarm evidence and require human verification.")
        steps = []
        for passage in passages:
            if passage["document_id"] in restricted_documents:
                if "do not use it to advise a customer" not in passage["text"].casefold():
                    continue
            steps.append({"text": passage["text"], "passage_ids": [passage["passage_id"]]})
        return {"advice_steps": steps, "uncertainties": uncertainties}
