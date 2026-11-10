import unittest
from unittest.mock import patch
from . import groups
from .rows import read_rows
from .totals import summarize
from .report import render
class Tests(unittest.TestCase):
    def test_legacy_api_and_physical_line_errors(self):
        text='a:2\na:-2\n\nb:3\na:4\nx:y:5\n'
        self.assertEqual(summarize(text),[{'key':'a','total':0},{'key':'b','total':3},{'key':'a','total':4},{'key':'x:y','total':5}])
        self.assertEqual(render(text),'a=0\nb=3\na=4\nx:y=5\n')
        self.assertEqual(summarize(''),[]); self.assertEqual(render(''),'')
        for function in [summarize,render]:
            with self.assertRaisesRegex(ValueError,'^invalid row at line 3$'):
                function('a:1\n\nbad')
        source=read_rows('a:1\nbad')
        self.assertEqual(next(source),('a',1))
        with self.assertRaisesRegex(ValueError,'line 2$'): next(source)
    def test_lazy_one_shot_group_boundaries(self):
        seen=[]
        def source():
            for row in [('a',1),('a',-1),('b',2),('b',3),('a',4)]:
                seen.append(row)
                yield row
        result=groups.iter_totals(source())
        self.assertEqual(seen,[])
        self.assertEqual(next(result),('a',0)); self.assertEqual(len(seen),3)
        self.assertEqual(next(result),('b',5)); self.assertEqual(len(seen),5)
        self.assertEqual(next(result),('a',4))
        with self.assertRaises(StopIteration): next(result)
        self.assertEqual(list(groups.iter_totals(iter([]))),[])
        self.assertEqual(list(groups.iter_totals(iter([('',0)]))),[('',0)])
    def test_late_failure_and_runtime_delegation(self):
        failure=RuntimeError('late')
        def source():
            yield 'a',1
            yield 'b',2
            raise failure
        result=groups.iter_totals(source())
        self.assertEqual(next(result),('a',1))
        with self.assertRaises(RuntimeError) as raised: next(result)
        self.assertIs(raised.exception,failure)
        with patch.object(groups,'iter_totals',return_value=iter([('shared',7)])) as shared:
            self.assertEqual(summarize('a:1'),[{'key':'shared','total':7}])
            self.assertEqual(list(shared.call_args.args[0]),[('a',1)])
        with patch.object(groups,'iter_totals',return_value=iter([('shared',7)])) as shared:
            self.assertEqual(render('a:1'),'shared=7\n')
            self.assertEqual(list(shared.call_args.args[0]),[('a',1)])
