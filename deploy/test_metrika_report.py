import datetime as dt
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('report', Path(__file__).with_name('metrika_report.py'))
report = importlib.util.module_from_spec(spec)
spec.loader.exec_module(report)

class ReportTests(unittest.TestCase):
    def test_daily(self):
        self.assertEqual(report.period('daily', dt.date(2026, 10, 23)),
                         (dt.date(2026, 10, 22), dt.date(2026, 10, 22)))

    def test_weekly_is_completed_monday_sunday(self):
        for day in (19, 23, 25):
            self.assertEqual(report.period('weekly', dt.date(2026, 10, day)),
                             (dt.date(2026, 10, 12), dt.date(2026, 10, 18)))

    def test_zero_report_is_not_uptime_claim(self):
        with patch.object(report, 'counters', return_value=[{'id':1,'name':'Test','report_goals':[]}]), patch.object(report, 'stats', return_value=([0] * 6, {})):
            text, _, _ = report.build_report('daily', dt.date(2026, 10, 23))
        self.assertIn('не проверка доступности', text)
        self.assertIn('не означает полученную заявку', text)

    def test_zero_comparison(self):
        self.assertEqual(report.change(1, 0), 'нет базы сравнения')
        self.assertEqual(report.change(0, 0), 'без изменений')
        self.assertEqual(report.change(20, 10), '+100.0%')

    def test_provider_notice_precedes_site_statistics(self):
        with patch.object(report, 'counters', return_value=[{'id':1,'name':'Test','report_goals':[]}]), patch.object(report, 'stats', return_value=([0] * 6, {})):
            text, _, _ = report.build_report('daily', dt.date(2026, 10, 23), 'Данные провайдера могут запаздывать.')
        self.assertLess(text.index('Данные провайдера'), text.index('🌐 Test'))

    def test_telegram_chunk_boundaries(self):
        text = ('x' * 1000 + '\n') * 8
        parts = report.chunks(text)
        self.assertGreater(len(parts), 1)
        self.assertTrue(all(len(x) <= 3800 for x in parts))

if __name__ == '__main__':
    unittest.main()
