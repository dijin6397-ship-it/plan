import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app import app

# Vercel serverless handler - WSGI adapter
class handler:
    def __init__(self, environ, start_response):
        self.environ = environ
        self.start_response = start_response

    def __iter__(self):
        return iter(app(self.environ, self.start_response))

    def __call__(self, environ, start_response):
        return app(environ, start_response)
