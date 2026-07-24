#!/usr/bin/env python3
import unittest

from truncate_context import truncate_preserving_term


class TruncatePreservingTermTest(unittest.TestCase):
    def test_unchanged_when_short(self):
        r = truncate_preserving_term("hello", "ll", 512)
        self.assertEqual(r.strategy, "unchanged")
        self.assertEqual(r.value, "hello")

    def test_prefix_when_term_in_kept_part(self):
        text = "alpha beta gamma delta"
        r = truncate_preserving_term(text, "beta", 12)
        self.assertEqual(r.strategy, "prefix")
        self.assertEqual(r.value, text[:12])
        self.assertIn("beta", r.value)

    def test_suffix_when_term_in_cut_tail(self):
        text = "alpha beta gamma delta"
        r = truncate_preserving_term(text, "delta", 12)
        self.assertEqual(r.strategy, "suffix")
        self.assertEqual(r.value, text[-12:])
        self.assertIn("delta", r.value)

    def test_prefix_when_no_term(self):
        text = "x" * 600
        r = truncate_preserving_term(text, None, 512)
        self.assertEqual(r.strategy, "prefix")
        self.assertEqual(len(r.value), 512)
        self.assertEqual(r.value, text[:512])

    def test_suffix_when_term_only_in_tail(self):
        text = "a" * 520 + "TERM"
        r = truncate_preserving_term(text, "TERM", 512)
        self.assertEqual(r.strategy, "suffix")
        self.assertIn("TERM", r.value)
        self.assertEqual(len(r.value), 512)

    def test_center_when_term_in_middle(self):
        text = "a" * 400 + "MID" + "b" * 400
        r = truncate_preserving_term(text, "MID", 100)
        self.assertEqual(r.strategy, "center")
        self.assertIn("MID", r.value)
        self.assertEqual(len(r.value), 100)

    def test_term_longer_than_max_falls_back_to_prefix(self):
        text = "Z" * 20 + "T" * 600
        r = truncate_preserving_term(text, "T" * 600, 512)
        self.assertEqual(r.strategy, "prefix")
        self.assertEqual(len(r.value), 512)


if __name__ == "__main__":
    unittest.main()
