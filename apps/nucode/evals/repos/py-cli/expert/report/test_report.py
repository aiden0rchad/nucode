import json
import os
import subprocess
import sys
import unittest
from .records import read_records
from .wire import render
class Tests(unittest.TestCase):
    def run_cli(self, text):
        return subprocess.run([sys.executable, '-m', 'expert.report.cli'], input=text.encode('utf-8'), capture_output=True, timeout=3, env={**os.environ, 'PYTHONIOENCODING': 'utf-8'})
    def test_success_bytes(self):
        text=' {"amount":0,"name":"β","ignored":7}\n\n{"name":" x ","amount":-2}\n'
        result=self.run_cli(text)
        self.assertEqual((result.returncode,result.stderr),(0,b''))
        self.assertEqual(result.stdout,'{"name":"β","amount":0}\n{"name":" x ","amount":-2}\n'.encode('utf-8'))
        self.assertEqual(render({'name':'a','amount':1}),'{"name":"a","amount":1}\n')
        result=self.run_cli(' \n\t\n')
        self.assertEqual((result.returncode,result.stdout,result.stderr),(0,b'',b''))
    def test_errors_have_no_partial_output(self):
        bad=['{','[]','null','{}',*map(json.dumps,[{'name':'x','amount':True},{'name':'x','amount':1.5},{'name':'x','amount':'2'},{'name':4,'amount':2},{'name':'','amount':2}])]
        for row in bad:
            with self.subTest(row=row):
                text='{"name":"ok","amount":3}\n\n'+row+'\n'
                result=self.run_cli(text)
                self.assertEqual((result.returncode,result.stdout,result.stderr),(2,b'',b'error: invalid record at line 3\n'))
                with self.assertRaisesRegex(ValueError,'^invalid record at line 3$'):
                    list(read_records(text.splitlines()))
    def test_library_stays_lazy(self):
        seen=[]
        def source():
            seen.append(1)
            yield '{"name":"ok","amount":0}'
            seen.append(2)
            yield 'false'
        rows=read_records(source())
        self.assertEqual(seen,[])
        self.assertEqual(next(rows),{'name':'ok','amount':0})
        self.assertEqual(seen,[1])
        with self.assertRaisesRegex(ValueError,'line 2$'):
            next(rows)
