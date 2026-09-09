import unittest
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tools.pallet_labels import prepare_labels
from main import dispatch
from tools.counter import Counter

class PalletLabelsTests(unittest.TestCase):
    def test_pairs_and_size(self):
        result = prepare_labels({"company": "YMC", "total": 10, "printerName": "Label"})
        self.assertEqual(result["labelCount"], 20)
        self.assertEqual(result["pageSize"], {"width": 38100, "height": 25400})
        from re import findall
        self.assertEqual(findall(r'<div class="number">(.*?)</div>', result["html"]), [f"{n}/10" for n in range(1, 11) for _ in range(2)])

    def test_single_and_escaping(self):
        result = prepare_labels({"company": '<script>&"', "total": 1, "printerName": "Label"})
        self.assertEqual(result["labels"], ["1/1", "1/1"])
        self.assertNotIn('<script>', result["html"])
        self.assertIn('&lt;script&gt;&amp;&quot;', result["html"])

    def test_invalid_jobs(self):
        for value in [0, -1, 1.5, True, "10", 1001, None]:
            with self.subTest(total=value), self.assertRaises(ValueError):
                prepare_labels({"company": "YMC", "total": value, "printerName": "Label"})
        for company in [None, " ", "x" * 81]:
            with self.subTest(company=company), self.assertRaises(ValueError):
                prepare_labels({"company": company, "total": 1, "printerName": "Label"})
        with self.assertRaises(ValueError):
            prepare_labels({"company": "YMC", "total": 1, "printerName": ""})

    def test_preview_routes_through_dispatch(self):
        result = dispatch(Counter(), {"id": "test", "operation": "pallet.preview", "payload": {"company": "YMC", "total": 10}})
        self.assertEqual(result["labels"], ["1/10", "1/10", "2/10", "2/10", "3/10", "3/10"])
        self.assertNotIn("html", result)
        self.assertEqual(result["lastLabel"], "10/10")

    def test_alignment_is_one_label_and_requires_printer(self):
        result = dispatch(Counter(), {"id": "test", "operation": "pallet.alignment", "payload": {"printerName": "Zebra"}})
        self.assertEqual(result["labelCount"], 1)
        self.assertEqual(result["html"].count('<section'), 1)
        self.assertIn('class="frame"', result["html"])
        self.assertIn('class="horizontal"', result["html"])
        self.assertIn('class="vertical"', result["html"])
        self.assertEqual(result["pageSize"], {"width": 38100, "height": 25400})
        for job in [None, {}, {"printerName": " "}]:
            with self.subTest(job=job), self.assertRaises(ValueError):
                dispatch(Counter(), {"id": "test", "operation": "pallet.alignment", "payload": job})
