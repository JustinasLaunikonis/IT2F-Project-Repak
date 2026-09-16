from docx import Document
from docx.oxml.ns import qn
import json
import shutil
import os
import subprocess
import platform

textInput = "Template/text-input-example.json"
templateDocx = "Template/Meldingsformulier Template.docx"
workingDocxDestination = "Output.docx"

# using XML to find the text nodes in the Document is the best approach as XML just returns all the text nodes. This
#   is better than going through paragraphs, tables, footers etc. separately

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


# make copy of template file first
shutil.copyfile(templateDocx, workingDocxDestination)

# load document
document = Document(workingDocxDestination)

replace_text_in_document(document, textInput)

#Then save
document.save(workingDocxDestination)

#Open doc in reader/app
open_document(workingDocxDestination)

