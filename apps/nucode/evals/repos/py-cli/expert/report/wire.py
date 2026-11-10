import json
def render(row):
    return json.dumps(row, ensure_ascii=False, separators=(',', ':')) + '\n'
