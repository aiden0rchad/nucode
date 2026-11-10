def read_rows(text):
    for number, line in enumerate(text.splitlines(), 1):
        if not line.strip():
            continue
        key, sep, value = line.rpartition(':')
        try:
            if not sep or not key:
                raise ValueError('row')
            yield key, int(value)
        except ValueError:
            raise ValueError(f'invalid row at line {number}') from None
