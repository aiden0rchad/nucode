import copy
import json
from pathlib import Path
import tempfile
import unittest
from .merge import merge
from .loader import load
class Tests(unittest.TestCase):
    def test_recursive_deletion_replacement_and_ownership(self):
        base={'db':{'host':'local','port':4},'list':[{'a':1}],'keep':{'x':[]}}
        overlay={'db':{'port':None,'ssl':False},'list':[2], 'new':{'gone':None,'zero':0},'missing':None}
        before=copy.deepcopy((base,overlay))
        result=merge(base,overlay)
        self.assertEqual(result,{'db':{'host':'local','ssl':False},'list':[2],'keep':{'x':[]},'new':{'zero':0}})
        self.assertEqual((base,overlay),before)
        result['keep']['x'].append(1); result['list'].append(3); result['db']['host']='changed'
        self.assertEqual((base,overlay),before)
        self.assertEqual(merge({'x':2},{'x':{'a':None,'b':[]}}),{'x':{'b':[]}})
        self.assertEqual(merge({'x':{'a':2}},{'x':0}),{'x':0})
    def put(self, root, name, value):
        path=root/name; path.parent.mkdir(parents=True,exist_ok=True)
        path.write_text(json.dumps(value),encoding='utf-8')
        return path
    def test_relative_diamond_includes_and_precedence(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            self.put(root,'common.json',{'values':{'x':1,'db':{'a':1,'b':2}}})
            self.put(root,'sub/left.json',{'include':['../common.json'],'values':{'x':2,'db':{'a':9}}})
            self.put(root,'sub/right.json',{'include':['../common.json'],'values':{'right':True}})
            entry=self.put(root,'root.json',{'include':['sub/left.json','sub/right.json'],'values':{'db':{'b':None}}})
            self.assertEqual(load(entry),{'x':1,'db':{'a':1},'right':True})
            self.assertEqual(load(entry),{'x':1,'db':{'a':1},'right':True})
    def test_cycles_and_validation_of_included_documents(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            entry=self.put(root,'a.json',{'include':['sub/b.json']})
            self.put(root,'sub/b.json',{'include':['.././a.json']})
            with self.assertRaisesRegex(ValueError,'^include cycle$'):
                load(entry)
            for invalid in [[],{'include':'a.json'},{'include':[1]},{'values':[]}]:
                self.put(root,'sub/b.json',invalid)
                with self.assertRaisesRegex(ValueError,'^document$'):
                    load(entry)
            self.put(root,'sub/b.json',{'values':{'valid':1}})
            self.assertEqual(load(entry),{'valid':1})
