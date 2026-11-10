import json
from pathlib import Path
from .schema import document
from .merge import merge
def load(path):
    includes, values = document(json.loads(Path(path).read_text(encoding='utf-8')))
    return merge({}, values)
