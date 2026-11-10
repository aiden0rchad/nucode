import sys
from .records import read_records
from .wire import render
def main():
    for row in read_records(sys.stdin):
        sys.stdout.write(render(row))
    return 0
if __name__ == '__main__':
    sys.exit(main())
