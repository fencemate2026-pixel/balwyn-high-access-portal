import base64
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("gate", ROOT / "scripts/verify-netlify.py")
gate = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(gate)


class GateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.out = self.root / "out"
        self.out.mkdir()
        self.config('[build]\npublish = "out"\n')
        self.html()

    def config(self, value):
        (self.root / "netlify.toml").write_text(value)

    def html(self, extra="", name="index.html"):
        page = self.out / name
        page.parent.mkdir(parents=True, exist_ok=True)
        page.write_text('<!doctype html><html><body>Tony Frizza' + ' ' * 1100 + extra + '</body></html>')

    def test_clean_output_passes(self):
        self.assertEqual(gate.check_output(self.out), [])

    def test_credentials_decoded_without_logging_them(self):
        def encode(obj):
            return base64.urlsafe_b64encode(json.dumps(obj).encode()).decode().rstrip('=')
        for role, blocked in [('service_role', True), ('anon', False)]:
            token = encode({'alg': 'HS256'}) + '.' + encode({'role': role}) + '.invalidsignature'
            self.html('<script>const key="' + token + '";</script>')
            errors = gate.check_output(self.out)
            self.assertEqual(bool(errors), blocked)
            self.assertNotIn(token, str(errors))

    def test_new_secret_key_is_blocked(self):
        self.html('sb_secret_syntheticreviewonly')
        self.assertTrue(gate.check_output(self.out))

    def test_missing_assets_with_queries_quotes_and_unquoted_urls(self):
        for markup in ['<script src="/missing.js?v=1"></script>', "<script src='/missing.js'></script>", '<script src=/missing.js></script>', '<link href="/missing.css#theme" rel="stylesheet">']:
            with self.subTest(markup=markup):
                self.html(markup)
                self.assertTrue(gate.check_output(self.out))

    def test_relative_nested_assets_and_base_url(self):
        (self.out / 'assets').mkdir()
        (self.out / 'assets' / 'app.js').write_text('console.log(1)')
        self.html('<script src="../assets/app.js?v=1"></script>', 'nested/page.html')
        self.assertEqual(gate.check_output(self.out), [])
        self.html('<base href="/assets/"><script src="app.js"></script>')
        self.assertEqual(gate.check_output(self.out), [])

    def test_external_assets_are_not_local_files(self):
        self.html('<script src="https://example.com/app.js"></script>')
        self.assertEqual(gate.check_output(self.out), [])

    def test_single_quoted_publish_and_production_override(self):
        self.config("[build]\npublish = 'out'\n[context.production]\npublish = 'published'\n")
        self.assertEqual(gate.publish_target(self.root, {})[0], self.root / 'published')
        self.assertEqual(gate.publish_target(self.root, {'CONTEXT': 'deploy-preview'})[0], self.out)

    def test_branch_override(self):
        self.config('[build]\npublish = "out"\n[context.production]\npublish = "prod"\n[context.release]\npublish = "release-out"\n')
        self.assertEqual(gate.publish_target(self.root, {'CONTEXT': 'production', 'BRANCH': 'release'})[0], self.root / 'release-out')

    def test_wrong_directory_and_detached_scan_rejected(self):
        for env in [{'NETLIFY_OUT_DIR': 'other'}, {'NETLIFY_OUT_DIR': 'other', 'ALLOW_DETACHED_SCAN': '1'}, {'ALLOW_DETACHED_SCAN': '1'}]:
            with self.assertRaises(ValueError):
                gate.publish_target(self.root, env)

    def test_invalid_or_missing_configuration_blocks(self):
        for source in ['not toml', '[build]\ncommand = "true"\n']:
            self.config(source)
            with self.assertRaises(ValueError):
                gate.publish_target(self.root, {})

    def test_read_error_blocks_scan(self):
        with patch.object(Path, 'read_bytes', side_effect=PermissionError('unreadable asset')):
            with self.assertRaises(PermissionError):
                gate.check_output(self.out)

    def test_installer_repairs_existing_command_and_is_repeatable(self):
        self.config('[build]\ncommand = "echo skipped"\npublish = "out"\n')
        (self.root / 'package.json').write_text(json.dumps({'scripts': {'build:netlify:verified': 'echo skipped'}}))
        for _ in range(2):
            result = subprocess.run(['bash', str(ROOT / 'install-netlify-gate.sh')], cwd=self.root, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            data = json.loads((self.root / 'package.json').read_text())
            self.assertEqual(data['scripts']['build:netlify:verified'], 'bash scripts/build-netlify-verified.sh')
            self.assertEqual(gate.tomllib.loads((self.root / 'netlify.toml').read_text())['build']['command'], 'npm run build:netlify:verified')


if __name__ == '__main__':
    unittest.main()
