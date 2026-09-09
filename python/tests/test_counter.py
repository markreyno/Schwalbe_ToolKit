import json
import subprocess
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from main import dispatch
from tools.counter import Counter


class CounterTests(unittest.TestCase):
    def test_count_close_and_reopen(self):
        counter = Counter()
        first = counter.open()
        self.assertEqual(first['value'], 0)
        for value in range(1, 11):
            self.assertEqual(counter.execute('counter.increment', first['sessionId'])['value'], value)
        counter.execute('counter.close', first['sessionId'])
        second = counter.open()
        self.assertEqual(second['value'], 0)
        self.assertNotEqual(first['sessionId'], second['sessionId'])
        with self.assertRaises(ValueError):
            counter.execute('counter.increment', first['sessionId'])

    def test_sessions_are_independent(self):
        counter = Counter()
        a, b = counter.open(), counter.open()
        counter.execute('counter.increment', a['sessionId'])
        self.assertEqual(counter.execute('counter.increment', b['sessionId'])['value'], 1)

    def test_invalid_requests(self):
        for request in [None, [], {}, {'id': '1', 'operation': 'shell.run'}, {'id': '2', 'operation': 'counter.increment', 'sessionId': []}]:
            with self.assertRaises(ValueError):
                dispatch(Counter(), request)

    def test_real_process_protocol_and_restart(self):
        for _ in range(2):
            process = subprocess.Popen([sys.executable, '-u', str(Path(__file__).resolve().parents[1] / 'main.py')], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            try:
                process.stdin.write('invalid json\n' + json.dumps({'id': 'open', 'operation': 'counter.open'}) + '\n')
                process.stdin.flush()
                self.assertIn('error', json.loads(process.stdout.readline()))
                opened = json.loads(process.stdout.readline())
                self.assertEqual(opened['id'], 'open')
                self.assertEqual(opened['result']['value'], 0)
                for i in range(100):
                    process.stdin.write(json.dumps({'id': str(i), 'operation': 'counter.increment', 'sessionId': opened['result']['sessionId']}) + '\n')
                process.stdin.flush()
                for i in range(100):
                    reply = json.loads(process.stdout.readline())
                    self.assertEqual(reply['id'], str(i))
                    self.assertEqual(reply['result']['value'], i + 1)
            finally:
                process.communicate(timeout=5)
            self.assertEqual(process.returncode, 0)


if __name__ == '__main__':
    unittest.main()
