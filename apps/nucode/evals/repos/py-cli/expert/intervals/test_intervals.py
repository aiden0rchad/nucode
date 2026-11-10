import copy
import itertools
import unittest
from .ranges import normalize
from .availability import available
class Tests(unittest.TestCase):
    def test_normalization_and_ownership(self):
        rows=[[5,9],[1,3],[3,5],[2,4],[7,7],[-3,-1]]
        before=copy.deepcopy(rows)
        self.assertEqual(normalize(iter(rows)),[(-3,-1),(1,9)])
        self.assertEqual(rows,before)
        self.assertEqual(normalize([(1,1)]),[])
    def test_split_boundaries_and_one_shot_inputs(self):
        windows=[[0,10],[12,15]]; blocks=[[2,4],[4,6],[8,12],[14,20]]
        before=copy.deepcopy((windows,blocks))
        self.assertEqual(available(iter(windows),iter(blocks)),[(0,2),(6,8),(12,14)])
        self.assertEqual((windows,blocks),before)
        self.assertEqual(available([(0,2)],[(2,4)]),[(0,2)])
        self.assertEqual(available([(0,2)],[(-1,0)]),[(0,2)])
        self.assertEqual(available([(0,2)],[(-1,3)]),[])
    def test_exhaustive_small_integer_coverage(self):
        choices=[(-2,-2),(-2,0),(-1,1),(0,2),(1,2),(2,3)]
        def points(rows):
            return {n for a,b in rows for n in range(a,b)}
        for windows in itertools.combinations_with_replacement(choices,2):
            for blocked in itertools.combinations_with_replacement(choices,2):
                result=available(iter(windows),iter(blocked))
                self.assertEqual(points(result),points(windows)-points(blocked))
                self.assertTrue(all(isinstance(row,tuple) and a<b for row in result for a,b in [row]))
                self.assertTrue(all(left[1]<right[0] for left,right in zip(result,result[1:])))
    def test_validation_is_not_skipped_for_empty_results(self):
        for bad in [(3,2),(True,2),(0,1.5),(0,),None,'12']:
            with self.subTest(bad=bad):
                with self.assertRaises(ValueError): normalize([bad])
                with self.assertRaises(ValueError): available([],iter([bad]))
                with self.assertRaises(ValueError): available(iter([bad]),[])
