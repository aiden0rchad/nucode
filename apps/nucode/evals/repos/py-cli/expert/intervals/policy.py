def interval(value):
    if not isinstance(value, (list, tuple)) or len(value) != 2:
        raise ValueError('interval')
    start, end = value
    if type(start) is not int or type(end) is not int or start > end:
        raise ValueError('interval')
    return start, end
