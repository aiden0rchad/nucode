def document(value):
    if not isinstance(value, dict):
        raise ValueError('document')
    includes, values = value.get('include', []), value.get('values', {})
    if not isinstance(includes, list) or any(not isinstance(p, str) for p in includes) or not isinstance(values, dict):
        raise ValueError('document')
    return includes, values
