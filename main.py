from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse


project_directory = Path(__file__).resolve().parent
home_page = project_directory / "static" / "index.html"

# Disable the generated API documentation so the page needs no external assets.
app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)


@app.get("/")
def show_home_page():
    return FileResponse(home_page, media_type="text/html")
