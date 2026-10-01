import shutil
from pathlib import Path
from tempfile import TemporaryDirectory

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from docx_generator.docx_generator import convert_json_to_docx
from whisper_demo import transcribe_audio_segments
from speaker_transcript import merge_and_format_transcript


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


def save_uploaded_wav(uploaded_file, destination):
    #check if the uploaded file is wav file
    if(
        not uploaded_file.filename
        or not uploaded_file.filename.lower().endswith(".wav")
    ):

        raise HTTPException(
            status_code=400,
            detail="Please upload WAV files.",
        )

    with open(destination, "wb") as saved_audio: #save uploaded recording temporarily
        shutil.copyfileobj(
            uploaded_file.file,
            saved_audio,
        )

    if destination.stat().st_size == 0: #dont accept empty recordingsd
        raise HTTPException(
            status_code=400,
            detail="An uploaded WAV file is empty.",
        )


@app.post("/transcribe")
def transcribe_uploaded_wav(
    harm: UploadFile = File(...),
    caller: UploadFile | None = File(None),
):
    #files inside this folder arre removed automatically afterwards
    with TemporaryDirectory() as temporary_directory:
        temporary_path = Path(temporary_directory)

        harm_path = temporary_path / "harm.wav"

        save_uploaded_wav(
            harm,
            harm_path
        )

        #transcribe harm's mic recording
        harm_segments = transcribe_audio_segments(
            str(harm_path)
        )

        caller_segments = []

        #transcrive caller.wav if caller audio was recorded
        if caller is not None:
            caller_path = temporary_path / "caller.wav"

            save_uploaded_wav(
                caller,
                caller_path
            )

            caller_segments = transcribe_audio_segments(
                str(caller_path)
            )

        #label speakers and put all segments in spoken order
        transcript_result = merge_and_format_transcript(
            harm_segments,
            caller_segments
        )

        return transcript_result
#
#
# @app.post("extract-report")
# def convert_transcription_to_json_input():
#
