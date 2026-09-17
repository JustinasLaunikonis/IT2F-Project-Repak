import re
from pathlib import Path
from docx import Document
from docx.oxml.ns import qn
import json
import shutil
import os
import subprocess
import platform

# using XML to find the text nodes in the Document is the best approach as XML just returns all the text nodes. This
#   is better than going through paragraphs, tables, footers etc. separately

def print_unreplaced_placeholders(document):

    unreplaced_placeholders = find_unreplaced_placeholders(document)

    if unreplaced_placeholders:
        print("Info: The following placeholders were not replaced in the word document:")
        for unreplaced_placeholder in unreplaced_placeholders:
            print("-", unreplaced_placeholder)
    else:
        print("All placeholders were replaced")

def find_unreplaced_placeholders(document):
    # a set has deduplicated, unordered, unindexed values
    placeholders = set()

    # creates python list containing the document's XML format
    xml_elements = [document.element]

    for section in document.sections:
        xml_elements.extend([
            section.header._element,
            section.first_page_header._element,
            section.even_page_header._element,
            section.footer._element,
            section.first_page_footer._element,
            section.even_page_footer._element
        ])

    for xml_element in xml_elements:
        for paragraph in xml_element.iter(qn("w:p")):
            #turn XML into text. Join text so that a run ending between a placeholder doesn't mess up detection
            text = "".join(text_node.text or "" for text_node in paragraph.iter(qn("w:t")))
            # Only text in brackets "[]" is a placeholder in the document, so anything that still has square brackets
            # is a placeholder that hasn't been filled in
            placeholders.update(re.findall(r"\[[^][\r\n]+]", text))

    return placeholders

def replace_text_in_xml(xml_element, replacement_data):
    for text_node in xml_element.iter(qn("w:t")):
        if text_node.text is None:
            continue

        for key, value in replacement_data.items():
            if key in text_node.text:
                text_node.text = text_node.text.replace(key, str(value))

def replace_text_in_document(document, text_input):
    # open JSON file
        with (open(text_input, "r") as textInputJsonFile):
            text_input_json_file_data = json.load(textInputJsonFile)

        # Main document text
        replace_text_in_xml(document.element, text_input_json_file_data)

        # Headers and Footers
        for section in document.sections:

            replace_text_in_xml(
                section.header._element,
                text_input_json_file_data
            )

            replace_text_in_xml(
                section.first_page_header._element,
                text_input_json_file_data
            )

            replace_text_in_xml(
                section.even_page_header._element,
                text_input_json_file_data
            )

            replace_text_in_xml(
                section.footer._element,
                text_input_json_file_data
            )

            replace_text_in_xml(
                section.first_page_footer._element,
                text_input_json_file_data
            )

            replace_text_in_xml(
                section.even_page_footer._element,
                text_input_json_file_data
            )

#target system is Windows, but this makes testing easier and the program a bit more OS-agnostic
def open_document(file_path):
    file_path = os.path.abspath(file_path)

    if platform.system() == "Windows":
        os.startfile(file_path)

    elif platform.system() == "Linux":
        subprocess.Popen(["xdg-open", file_path])

    elif platform.system() == "Darwin": #macOS
        subprocess.Popen(["open", file_path])

    else:
        print("OS was not recognized. Document could not be opened.")

def main():
    # Allows program/directories to be run/accessed from root
    script_directory = Path(__file__).resolve().parent
    text_input = script_directory / "template" / "text-input-example.json"
    template_docx = script_directory / "template" / "meldingsformulier-template.docx"
    working_docx_destination = script_directory / "output.docx"

    # make copy of template file first
    shutil.copyfile(template_docx, working_docx_destination)

    # load document
    document = Document(str(working_docx_destination))

    replace_text_in_document(document, text_input)

    #Then save
    document.save(str(working_docx_destination))

    print_unreplaced_placeholders(document)

    #Open doc in reader/app
    open_document(working_docx_destination)

if __name__ == "__main__":
    main()

