from .policy import interval
def normalize(ranges):
    return sorted(interval(value) for value in ranges)
