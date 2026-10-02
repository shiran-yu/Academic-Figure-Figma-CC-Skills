"""Tests for hooks/figma_preflight.py: marker expansion, passthrough and each lint rule.

Run from the repo root with: python3 -m unittest discover -s tests -v
"""
import json
import os
import re
import subprocess
import sys
import unittest

TESTS_DIR = os.path.dirname(os.path.abspath(__file__))
PLUGIN_ROOT = os.path.dirname(TESTS_DIR)
sys.path.insert(0, os.path.join(PLUGIN_ROOT, 'hooks'))

import figma_preflight as hook  # noqa: E402  pylint: disable=wrong-import-position

LIB = hook.read_lib(PLUGIN_ROOT)
HOOK_SCRIPT = os.path.join(PLUGIN_ROOT, 'hooks', 'figma_preflight.py')
GOOD_BODY = ('await FONTS();\n'
             'const art = await figma.getNodeByIdAsync("9:2");\n'
             'txt(art, 0, 0, 40, "label", 6.5);\n'
             'await arrowH(art, 0, 10, 20);\n'
             'return {ids: [art.id]};\n')


def run_hook(payload, root=PLUGIN_ROOT):
    """Run the hook as a subprocess the way Claude Code does; return (stdout, returncode)."""
    environment = dict(os.environ)
    environment['CLAUDE_PLUGIN_ROOT'] = root
    completed = subprocess.run(['/usr/bin/python3', HOOK_SCRIPT], input=json.dumps(payload),
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                               universal_newlines=True, env=environment, timeout=15, check=False)
    return completed.stdout, completed.returncode


def tool_payload(code, **extra):
    """A PreToolUse payload for use_figma with the given code and extra input fields."""
    tool_input = {'code': code, 'fileKey': 'abc', 'description': 'd', 'skillNames': 'x'}
    tool_input.update(extra)
    return {'hook_event_name': 'PreToolUse', 'tool_name': 'mcp__plugin_figma_figma__use_figma',
            'tool_input': tool_input}


class ExpansionTest(unittest.TestCase):
    """The marker line becomes the library; everything else is left alone."""

    def test_lib_file_is_found(self):
        """The lib exists and carries the signature the hook keys on."""
        self.assertIn(hook.LIB_SIGNATURE, LIB)

    def test_marker_expands_to_lib_then_body(self):
        """Marker line is replaced by the lib, the body follows, the marker is gone."""
        new_code, problems, warnings = hook.process(hook.MARKER + '\n' + GOOD_BODY, LIB)
        self.assertEqual(new_code, LIB.rstrip('\n') + '\n' + GOOD_BODY)
        self.assertNotIn(hook.MARKER, new_code.split('\n'))  # no line is the bare marker
        self.assertEqual((problems, warnings), ([], []))

    def test_marker_after_blank_lines_still_counts(self):
        """Leading blank lines before the marker do not hide it."""
        new_code, _, _ = hook.process('\n\n  //@figma_lib  \n' + GOOD_BODY, LIB)
        self.assertTrue(new_code.startswith(LIB.rstrip('\n')))

    def test_marker_not_on_first_line_is_not_a_marker(self):
        """A marker buried after other code is left alone."""
        code = 'const a = 1;\n//@figma_lib\n'
        self.assertEqual(hook.process(code, LIB), (code, [], []))

    def test_no_marker_passes_through_untouched(self):
        """Other use_figma work (no marker, no lib signature) is not even linted."""
        code = 'const f = figma.createFrame(); f.layoutMode = "VERTICAL"; console.log(1);'
        self.assertEqual(hook.process(code, LIB), (code, [], []))
        self.assertEqual(run_hook(tool_payload(code)), ('', 0))

    def test_pasted_lib_is_not_expanded_again(self):
        """A manual paste plus a marker keeps one copy of the lib."""
        code = LIB + '\n' + hook.MARKER + '\n' + GOOD_BODY
        new_code, problems, _ = hook.process(code, LIB)
        self.assertEqual(new_code, code)
        self.assertEqual(problems, [])

    def test_pasted_lib_without_marker_lints_only_the_model_part(self):
        """The lib's own createText must not trip the font rule; a bad body still does."""
        self.assertEqual(hook.process(LIB + '\n' + GOOD_BODY, LIB)[1], [])
        problems = hook.process(LIB + '\nconsole.log(1);\n', LIB)[1]
        self.assertEqual(len(problems), 1)

    def test_missing_lib_denies_instead_of_sending_the_marker(self):
        """With no lib file the marker would reach Figma, so the call is denied."""
        output, code = run_hook(tool_payload(hook.MARKER + '\n' + GOOD_BODY), root='/nonexistent')
        self.assertEqual(code, 0)
        decision = json.loads(output)['hookSpecificOutput']
        self.assertEqual(decision['permissionDecision'], 'deny')
        self.assertIn('not found', decision['permissionDecisionReason'])


class HookProcessTest(unittest.TestCase):
    """End to end through stdin and stdout, as Claude Code runs the hook."""

    def test_updated_input_keeps_every_other_field(self):
        """updatedInput replaces the whole input, so fileKey and friends must survive."""
        output, code = run_hook(tool_payload(hook.MARKER + '\n' + GOOD_BODY))
        self.assertEqual(code, 0)
        decision = json.loads(output)['hookSpecificOutput']
        self.assertEqual(decision['hookEventName'], 'PreToolUse')
        self.assertNotIn('permissionDecision', decision)
        updated = decision['updatedInput']
        self.assertEqual((updated['fileKey'], updated['description'], updated['skillNames']),
                         ('abc', 'd', 'x'))
        self.assertTrue(updated['code'].endswith(GOOD_BODY))
        self.assertIn(hook.LIB_SIGNATURE, updated['code'])

    def test_garbage_input_fails_open(self):
        """A payload without code, or not JSON at all, exits 0 with no output."""
        self.assertEqual(run_hook({'tool_input': {}}), ('', 0))
        self.assertEqual(run_hook({'tool_input': {'code': 5}}), ('', 0))
        completed = subprocess.run(['/usr/bin/python3', HOOK_SCRIPT], input='not json',
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                   universal_newlines=True, timeout=15, check=False)
        self.assertEqual((completed.stdout, completed.returncode), ('', 0))

    def test_non_ascii_labels_survive_a_c_locale(self):
        """Raw UTF-8 on stdin must not be garbled when the hook runs under a C/POSIX locale."""
        label = 'txt(art, 0, 0, 40, "σ → θ", 6.5);\n'
        payload = json.dumps(tool_payload(hook.MARKER + '\nawait FONTS();\n' + label),
                             ensure_ascii=False).encode('utf-8')
        environment = dict(os.environ)
        environment.update({'CLAUDE_PLUGIN_ROOT': PLUGIN_ROOT, 'LC_ALL': 'C', 'LANG': 'C'})
        completed = subprocess.run(['/usr/bin/python3', HOOK_SCRIPT], input=payload,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                   env=environment, timeout=15, check=False)
        updated = json.loads(completed.stdout.decode('utf-8'))['hookSpecificOutput']
        self.assertTrue(updated['updatedInput']['code'].endswith(label))

    def test_hooks_json_wires_the_script(self):
        """hooks.json matches the plugin-scoped Figma tool name and points at a real file."""
        with open(os.path.join(PLUGIN_ROOT, 'hooks', 'hooks.json'), encoding='utf-8') as handle:
            entry = json.load(handle)['hooks']['PreToolUse'][0]
        for name in ('mcp__plugin_figma_figma__use_figma', 'mcp__figma__use_figma'):
            self.assertTrue(re.search('^(?:' + entry['matcher'] + ')$', name), name)
        self.assertIsNone(re.search('^(?:' + entry['matcher'] + ')$',
                                    'mcp__plugin_figma_figma__whoami'))
        command = entry['hooks'][0]['command']
        self.assertIn('${CLAUDE_PLUGIN_ROOT}/hooks/figma_preflight.py', command)
        self.assertTrue(os.path.isfile(HOOK_SCRIPT))


class DenyRuleTest(unittest.TestCase):
    """Each deterministic rule denies, and the clean body does not."""

    def problems(self, body):
        """Lint a marker call with the given body and return the problem list."""
        return hook.process(hook.MARKER + '\n' + body, LIB)[1]

    def test_clean_body_passes(self):
        """The reference body from the canonical call skeleton is clean."""
        self.assertEqual(self.problems(GOOD_BODY), [])

    def test_auto_layout_is_denied(self):
        """layoutMode, layoutSizing*, primaryAxisSizingMode and createAutoLayout are banned."""
        for token in ('f.layoutMode = "VERTICAL";', 'f.layoutSizingHorizontal = "FILL";',
                      'f.primaryAxisSizingMode = "AUTO";', 'figma.createAutoLayout();'):
            found = self.problems('await FONTS();\n' + token)
            self.assertEqual(len(found), 1, token)
            self.assertIn('Auto Layout', found[0])

    def test_other_banned_apis_are_denied(self):
        """createImage, loadAllPagesAsync, setPluginData and figma.variables are banned."""
        for token in ('figma.createImage(b);', 'await figma.loadAllPagesAsync();',
                      'n.setPluginData("k", "v");', 'figma.variables.getLocalVariables();'):
            found = self.problems('await FONTS();\n' + token)
            self.assertEqual(len(found), 1, token)
            self.assertIn('banned', found[0])

    def test_current_page_assignment_is_denied_but_comparison_is_not(self):
        """Assigning figma.currentPage is denied; reading or comparing it is fine."""
        self.assertEqual(len(self.problems('await FONTS();\nfigma.currentPage = p;')), 1)
        self.assertIn('setCurrentPageAsync',
                      self.problems('await FONTS();\nfigma.currentPage = p;')[0])
        self.assertEqual(self.problems('await FONTS();\nconst ok = figma.currentPage == p;'), [])
        self.assertEqual(self.problems('await FONTS();\nconst n = figma.currentPage.name;'), [])

    def test_console_and_notify_are_denied(self):
        """console.log is invisible and figma.notify throws."""
        self.assertEqual(len(self.problems('await FONTS();\nconsole.log("x");')), 1)
        self.assertEqual(len(self.problems('await FONTS();\nfigma.notify("x");')), 1)

    def test_text_before_fonts_is_denied(self):
        """Creating text before `await FONTS()`, or with no font load at all, is denied."""
        for body in ('txt(art, 0, 0, 40, "a", 6.5);\nawait FONTS();',
                     'const t = figma.createText();',
                     'stageColumn(art, 0, 0, 10, 10, "claim", "T", 7);'):
            found = self.problems(body)
            self.assertEqual(len(found), 1, body)
            self.assertIn('unloaded font', found[0])

    def test_text_after_fonts_or_load_font_async_is_fine(self):
        """Either `await FONTS()` or an explicit loadFontAsync before the text op is accepted."""
        self.assertEqual(self.problems('await FONTS();\nfigma.createText();'), [])
        self.assertEqual(self.problems(
            'await figma.loadFontAsync({family:"Tinos",style:"Regular"});\nfigma.createText();'),
            [])

    def test_text_helper_definition_is_not_a_call(self):
        """Defining a helper named txt before FONTS is not creating text."""
        body = 'function txt2() {}\nfunction badge(a) { return a; }\nawait FONTS();\nbadge(1);'
        self.assertEqual(self.problems(body), [])

    def test_comments_and_strings_do_not_trigger(self):
        """Banned words in comments, strings and labels are not code."""
        body = ('await FONTS();\n'
                '// do not use layoutMode or console.log here\n'
                '/* figma.currentPage = x; */\n'
                'txt(art, 0, 0, 40, "layoutMode and console.log(1)", 6.5);\n'
                "txt(art, 0, 0, 40, 'it\\'s figma.notify(1)', 6.5);\n")
        self.assertEqual(self.problems(body), [])

    def test_all_problems_are_reported_in_one_denial(self):
        """Two separate problems come back together so one resend fixes both."""
        output, _ = run_hook(tool_payload(hook.MARKER + '\nconsole.log(1);\nf.layoutMode = 1;\n'))
        reason = json.loads(output)['hookSpecificOutput']['permissionDecisionReason']
        self.assertIn('Auto Layout', reason)
        self.assertIn('console.log', reason)
        self.assertEqual(json.loads(output)['hookSpecificOutput']['permissionDecision'], 'deny')

    def test_denied_call_is_not_expanded(self):
        """A deny carries no updatedInput, so the marker is not expanded for nothing."""
        output, _ = run_hook(tool_payload(hook.MARKER + '\nconsole.log(1);\n'))
        self.assertNotIn('updatedInput', json.loads(output)['hookSpecificOutput'])


class WarningTest(unittest.TestCase):
    """Warn-only checks allow the call and attach additionalContext."""

    def test_unawaited_arrow_helper_warns(self):
        """arrowH without await warns; awaited or returned calls do not."""
        _, problems, warnings = hook.process(
            hook.MARKER + '\nawait FONTS();\narrowH(art, 0, 0, 10);\n', LIB)
        self.assertEqual(problems, [])
        self.assertEqual(len(warnings), 1)
        self.assertIn('not awaited', warnings[0])
        self.assertEqual(hook.process(
            hook.MARKER + '\nawait FONTS();\nawait arrowH(art, 0, 0, 10);\n', LIB)[2], [])
        self.assertEqual(hook.process(
            hook.MARKER + '\nawait FONTS();\nreturn arrowH(art, 0, 0, 10);\n', LIB)[2], [])

    def test_text_edit_with_pack_in_one_call_warns(self):
        """Raw .characters= plus packBox in one call hits the stale-metrics trap."""
        body = 'await FONTS();\nt.characters = "x";\npackBox(box, 4, 2);\n'
        _, problems, warnings = hook.process(hook.MARKER + '\n' + body, LIB)
        self.assertEqual(problems, [])
        self.assertIn('Stale-metrics', warnings[0])
        self.assertEqual(hook.process(hook.MARKER + '\nawait FONTS();\npackBox(box, 4, 2);\n',
                                      LIB)[2], [])

    def test_warning_rides_along_with_the_expansion(self):
        """The allow output carries both the expanded code and the warning text."""
        output, _ = run_hook(tool_payload(hook.MARKER + '\nawait FONTS();\narrowV(a, 0, 0, 9);\n'))
        decision = json.loads(output)['hookSpecificOutput']
        self.assertIn('updatedInput', decision)
        self.assertIn('figma preflight warning', decision['additionalContext'])


if __name__ == '__main__':
    unittest.main()
