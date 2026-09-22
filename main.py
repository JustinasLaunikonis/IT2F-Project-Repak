from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from docx_generator.docx_generator import convert_json_to_docx

from pydantic import BaseModel

project_directory = Path(__file__).resolve().parent
static_directory = project_directory / "static"
home_page = static_directory / "index.html"

# Disable the generated API documentation so the page needs no external assets.
app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

# Serve the files in the static folder (for example index.css) under /static.
# Without this, the browser's request for the stylesheet returns 404.
app.mount("/static", StaticFiles(directory=static_directory), name="static")


@app.get("/")
def show_home_page():
    return FileResponse(home_page, media_type="text/html")


class DocxFileExportRequest(BaseModel):
    transcript: str

@app.post("/export")
def export_docx_file(request: DocxFileExportRequest):

    output_path = convert_json_to_docx(request.transcript)

    return FileResponse(
        path=output_path,
        filename=output_path.name
    )

