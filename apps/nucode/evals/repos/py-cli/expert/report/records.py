import json
def read_records(lines):
    for number, line in enumerate(lines, 1):
        if not line.strip():
            continue
        row = json.loads(line)
        yield {'name': str(row['name']), 'amount': int(row['amount'])}
