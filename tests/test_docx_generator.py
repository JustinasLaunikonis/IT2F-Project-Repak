import json

from docx import Document
from docx.oxml.ns import qn

from docx_generator.docx_generator import replace_text_in_document


def test_multiline_transcript_has_word_line_breaks(tmp_path):
    document = Document()
    document.add_paragraph("Transcript: [transcriptie]")
    transcript = "First line\r\nSecond line\nThird line"
    replacements = {"[transcriptie]": transcript}

    replace_text_in_document(document, json.dumps(replacements))
    output_path = tmp_path / "transcript.docx"
    document.save(output_path)

    exported_document = Document(output_path)
    paragraph = exported_document.paragraphs[0]
    assert paragraph.text == "Transcript: First line\nSecond line\nThird line"
    assert len(list(paragraph._p.iter(qn("w:br")))) == 2
