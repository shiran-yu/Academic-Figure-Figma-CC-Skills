#!/usr/bin/env python3
"""PreToolUse hook for the Figma use_figma tool: library injection and pre-flight lint.

The model starts a drawing call with the single line `//@figma_lib`. This hook replaces that
line with academic-figure-figma/scripts/figma_lib.js (read at hook time, so the lib is never
duplicated), then checks the part of the code the model wrote against the verified API subset
in references/figma-api-cheatsheet.md. A failed Figma call is atomic but still counts against
the 200/day quota, so a predictable failure is denied here with the cheatsheet reason instead.

Scope gate: only calls that carry the marker or the lib signature are touched. A call without
either (other work through the same tool) passes through unchanged.

Python 3.6 safe: this runs under the system python3 of the cluster.
"""
import json
import os
import re
import sys

MARKER = '//@figma_lib'
LIB_SIGNATURE = 'async function FONTS('
LIB_RELATIVE = os.path.join('academic-figure-figma', 'scripts', 'figma_lib.js')
CHEATSHEET = 'references/figma-api-cheatsheet.md'

# (pattern, token shown to the model, reason). A match in the scrubbed model-written code denies.
DENY_RULES = [
    (re.compile(r'\b(layoutMode|layoutSizing\w*|primaryAxisSizingMode|counterAxisSizingMode'
                r'|createAutoLayout)\b'),
     'Auto Layout',
     'Auto Layout is banned for paper figures (hard rule 3; ' + CHEATSHEET + ' "Banned for paper '
     'figures", error table "you touched Auto Layout"). Use absolute x/y in plain frames.'),
    (re.compile(r'\b(createImage\w*|loadAllPagesAsync|setPluginData)\b|\bfigma\s*\.\s*variables\b'),
     'banned API',
     'createImage*, loadAllPagesAsync, setPluginData and figma.variables are banned (' +
     CHEATSHEET + ' "Banned for paper figures"). Bitmaps go through upload_assets.'),
    (re.compile(r'\bfigma\s*\.\s*currentPage\s*=(?!=)'),
     'figma.currentPage =',
     'Setting figma.currentPage is not supported; use `await figma.setCurrentPageAsync(page)` ('
     + CHEATSHEET + ' error table).'),
    (re.compile(r'\bconsole\s*\.\s*(log|warn|error|info|debug)\s*\(|\bfigma\s*\.\s*notify\s*\('),
     'console.log / figma.notify',
     'console output is invisible and figma.notify throws; the `return {...}` value is the only '
     'output channel (' + CHEATSHEET + ' "The use_figma contract").'),
]

# Lib helpers that create text, so fonts must be loaded before they run.
TEXT_CALL = re.compile(r'\bcreateText\s*\(|(?<![\w.$])(?:txt|stageColumn|legendRow|dashedGroup'
                       r'|badge|rotText)\s*\(')
FONT_LOAD = re.compile(r'\bawait\s+FONTS\s*\(|\bloadFontAsync\s*\(')
FONT_REASON = ('text is created before fonts are loaded ("Cannot write to node with unloaded '
               'font", ' + CHEATSHEET + ' error table). Put `await FONTS();` on the first line '
               'after the marker.')

ASYNC_HELPER = re.compile(r'(?<![\w.$])(?:arrow|arrowH|arrowV|elbowArrow|curveArrow|selfLoop'
                          r'|reroute|inspect)\s*\(')
TEXT_EDIT = re.compile(r'\.(?:characters|fontSize)\s*=(?!=)')
PACK_OR_AUDIT = re.compile(r'\b(?:packBox|auditFigure)\s*\(')


def plugin_root():
    """Plugin install directory: CLAUDE_PLUGIN_ROOT, else the parent of this hooks/ folder."""
    root = os.environ.get('CLAUDE_PLUGIN_ROOT')
    return root if root else os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read_lib(root):
    """Return the text of figma_lib.js under root, or None when it cannot be read."""
    try:
        with open(os.path.join(root, LIB_RELATIVE), encoding='utf-8') as handle:
            return handle.read()
    except (OSError, UnicodeDecodeError):
        return None


def string_end(source, start):
    """Index just past the string literal that opens at start (unterminated ones stop early)."""
    quote = source[start]
    i = start + 1
    while i < len(source):
        char = source[i]
        if char == '\\':
            i += 2
        elif char == quote:
            return i + 1
        elif char == '\n' and quote != '`':
            return i
        else:
            i += 1
    return len(source)


def blank(text):
    """Replace every character except newlines with a space."""
    return re.sub(r'[^\n]', ' ', text)


def scrub(source):
    """Blank comments and string literals so the lint rules only see code."""
    out = []
    i = 0
    while i < len(source):
        pair = source[i:i + 2]
        if pair == '//':
            end = source.find('\n', i)
            end = len(source) if end < 0 else end
        elif pair == '/*':
            end = source.find('*/', i + 2)
            end = len(source) if end < 0 else end + 2
        elif source[i] in '\'"`':
            end = string_end(source, i)
        else:
            out.append(source[i])
            i += 1
            continue
        out.append(blank(source[i:end]))
        i = end
    return ''.join(out)


def split_marker(code):
    """Return (True, code after the marker line) when the first non-blank line is the marker."""
    lines = code.split('\n')
    for index, line in enumerate(lines):
        if line.strip():
            if line.strip() == MARKER:
                return True, '\n'.join(lines[index + 1:])
            break
    return False, code


def model_part(code, rest, has_marker, lib):
    """The code the model wrote: after the marker, or after a pasted lib; None if unlocatable."""
    if has_marker and LIB_SIGNATURE not in rest:
        return rest
    if LIB_SIGNATURE not in code or lib is None:
        return None
    tail = '\n'.join(lib.rstrip().split('\n')[-3:])
    position = code.rfind(tail)
    return None if position < 0 else code[position + len(tail):]


def font_problem(scrubbed):
    """Return a problem string when text is created before (or without) a font load."""
    for match in TEXT_CALL.finditer(scrubbed):
        if re.search(r'\bfunction\s+$', scrubbed[:match.start()]):
            continue  # a definition, not a call
        load = FONT_LOAD.search(scrubbed)
        if load is None or load.start() > match.start():
            return match.group(0).rstrip(' (').strip() + ': ' + FONT_REASON
        return None
    return None


def lint(model_code):
    """Return (problems, warnings) for the model-written code."""
    scrubbed = scrub(model_code)
    problems = []
    for pattern, token, reason in DENY_RULES:
        found = pattern.search(scrubbed)
        if found:
            problems.append(found.group(0).strip(' (') + ' [' + token + ']: ' + reason)
    problem = font_problem(scrubbed)
    if problem:
        problems.append(problem)
    warnings = []
    for match in ASYNC_HELPER.finditer(scrubbed):
        if not re.search(r'\b(await|function|return)\s+$', scrubbed[:match.start()]):
            warnings.append(match.group(0).rstrip(' (') + '(...) is async and is not awaited, so '
                            'the arrow may be unfinished when the call returns (' + CHEATSHEET +
                            ' "Arrow helpers are async").')
            break
    if TEXT_EDIT.search(scrubbed) and PACK_OR_AUDIT.search(scrubbed):
        warnings.append('this call edits .characters/.fontSize and also runs packBox/auditFigure; '
                        'text metrics are stale within the call that edited the text, so pack and '
                        'audit in a fresh call (' + CHEATSHEET + ' "Stale-metrics trap").')
    return problems, warnings


def process(code, lib):
    """Return (new_code, problems, warnings); new_code differs only when the marker expanded."""
    has_marker, rest = split_marker(code)
    if not has_marker and LIB_SIGNATURE not in code:
        return code, [], []
    problems, warnings = [], []
    if has_marker and LIB_SIGNATURE not in rest:
        if lib is None:
            return code, ['//@figma_lib: figma_lib.js was not found under the plugin root; paste '
                          'the lib into the call by hand.'], []
        new_code = lib.rstrip('\n') + '\n' + rest
    else:
        new_code = code
    written = model_part(code, rest, has_marker, lib)
    if written is not None:
        problems, warnings = lint(written)
    return new_code, problems, warnings


def deny_output(problems):
    """The hook JSON that blocks the call and tells the model what to fix."""
    reason = ('figma preflight: nothing was sent to Figma (a failed call still counts against '
              'the 200/day quota). Fix and resend:\n- ' + '\n- '.join(problems))
    return {'hookSpecificOutput': {'hookEventName': 'PreToolUse',
                                   'permissionDecision': 'deny',
                                   'permissionDecisionReason': reason}}


def allow_output(tool_input, new_code, warnings):
    """The hook JSON that swaps in the expanded code and attaches any warnings."""
    output = {'hookEventName': 'PreToolUse'}
    if new_code != tool_input['code']:
        # updatedInput replaces the whole input object, so keep every other field
        updated = dict(tool_input)
        updated['code'] = new_code
        output['updatedInput'] = updated
    if warnings:
        output['additionalContext'] = 'figma preflight warning: ' + ' | '.join(warnings)
    return {'hookSpecificOutput': output} if len(output) > 1 else None


def main():
    """Read the hook payload on stdin and print the decision; fail open on any surprise."""
    try:
        # tool_input = json.load(sys.stdin).get('tool_input')
        # (the old line above garbles non-ASCII labels under a C/POSIX locale)
        tool_input = json.loads(sys.stdin.buffer.read().decode('utf-8')).get('tool_input')
        code = tool_input.get('code')
        if not isinstance(code, str):
            return 0
        new_code, problems, warnings = process(code, read_lib(plugin_root()))
        result = deny_output(problems) if problems else allow_output(tool_input, new_code,
                                                                     warnings)
    except (ValueError, AttributeError, TypeError) as error:
        sys.stderr.write('figma_preflight: skipped (' + repr(error) + ')\n')
        return 0
    if result:
        sys.stdout.write(json.dumps(result))
    return 0


if __name__ == '__main__':
    sys.exit(main())
