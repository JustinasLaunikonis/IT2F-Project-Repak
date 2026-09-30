import shutil
from pathlib import Path
from tempfile import TemporaryDirectory

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from docx_generator.docx_generator import convert_json_to_docx
from whisper_demo import transcribe_audio


project_directory = Path(__file__).resolve().parent
static_directory = project_directory / "static"
home_page = static_directory / "index.html"

# Disable the generated API documentation so the page needs no external assets.
app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

# Serve files in the static folder under /static.
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
        filename=output_path.name,
        headers={"filename": output_path.name},
    )


@app.post("/transcribe")
def transcribe_uploaded_wav(file: UploadFile = File(...)):
    if not file.filename or not file.filename.lower().endswith(".wav"):
        raise HTTPException(
            status_code=400,
            detail="Please upload a WAV file.",
        )

    with TemporaryDirectory() as temporary_directory:
        audio_path = Path(temporary_directory) / "recording.wav"

        with open(audio_path, "wb") as saved_audio:
            shutil.copyfileobj(file.file, saved_audio)

        if audio_path.stat().st_size == 0:
            raise HTTPException(
                status_code=400,
                detail="The uploaded WAV file is empty.",
            )

        text = transcribe_audio(str(audio_path))

    return {"text": text}
