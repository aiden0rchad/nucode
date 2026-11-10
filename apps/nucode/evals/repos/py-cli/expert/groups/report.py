from .rows import read_rows
def render(text):
    result = []
    for key, amount in read_rows(text):
        if result and result[-1][0] == key:
            result[-1] = (key, result[-1][1] + amount)
        else:
            result.append((key, amount))
    return ''.join(f'{key}={total}\n' for key, total in result)
