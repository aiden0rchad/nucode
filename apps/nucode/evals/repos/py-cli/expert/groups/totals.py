from .rows import read_rows
def summarize(text):
    result = []
    for key, amount in read_rows(text):
        if result and result[-1]['key'] == key:
            result[-1]['total'] += amount
        else:
            result.append({'key': key, 'total': amount})
    return result
