"""Check the installer's write boundary and rollback with a fake systemctl."""
import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "pi"))
import upgrade_reconnect as upgrade


class UpgradeTests(unittest.TestCase):
    def test_reviewed_installed_source_and_terminal_line_endings_are_accepted(self):
        source = (Path(__file__).parent / 'fixtures' / 'mirror_2_2_0_installed.py').read_bytes()
        for previous in (source, source.replace(b'\n', b'\r\n') + b'\r\n'):
            with tempfile.TemporaryDirectory() as folder:
                target = Path(folder) / 'mildura_mirror.py'
                target.write_bytes(previous)
                with patch.object(upgrade, 'TARGET', target), patch.object(upgrade.os, 'geteuid', return_value=0), patch.object(upgrade.time, 'sleep'), patch.object(upgrade.subprocess, 'run') as run:
                    upgrade.main()
                self.assertEqual(target.read_bytes(), upgrade.SOURCE.encode())
                self.assertEqual(run.call_args_list[0].args[0], ['systemctl', 'restart', 'mildura-mirror.service'])

    def test_changed_executable_field_source_still_refuses_upgrade(self):
        source = (Path(__file__).parent / 'fixtures' / 'mirror_2_2_0_installed.py').read_bytes()
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder) / 'mildura_mirror.py'
            changed = source.replace(b'HTTP_TIMEOUT_S = 20', b'HTTP_TIMEOUT_S = 25')
            target.write_bytes(changed)
            with patch.object(upgrade, 'TARGET', target), patch.object(upgrade.os, 'geteuid', return_value=0), patch.object(upgrade.subprocess, 'run') as run:
                with self.assertRaises(SystemExit):
                    upgrade.main()
            self.assertEqual(target.read_bytes(), changed)
            run.assert_not_called()

    def test_unknown_source_is_never_overwritten_or_restarted(self):
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder) / 'mildura_mirror.py'
            target.write_text('custom installed source')
            with patch.object(upgrade, 'TARGET', target), patch.object(upgrade.os, 'geteuid', return_value=0), patch.object(upgrade.subprocess, 'run') as run:
                with self.assertRaises(SystemExit):
                    upgrade.main()
            self.assertEqual(target.read_text(), 'custom installed source')
            run.assert_not_called()
            self.assertEqual(len(list(Path(folder).iterdir())), 1)

    def test_upgrade_only_restarts_mirror_and_rolls_back_failed_start(self):
        import hashlib
        original = b'# verified fixture source\n'
        for fail in (False, True):
            with self.subTest(fail=fail), tempfile.TemporaryDirectory() as folder:
                target = Path(folder) / 'mildura_mirror.py'
                target.write_bytes(original)
                calls = []
                def run(args, **kwargs):
                    calls.append(args)
                    if fail and len(calls) == 2:
                        raise subprocess.CalledProcessError(3, args)
                with patch.object(upgrade, 'TARGET', target), patch.object(upgrade, 'OLD_SHA256', hashlib.sha256(original).hexdigest()), patch.object(upgrade.os, 'geteuid', return_value=0), patch.object(upgrade.time, 'sleep'), patch.object(upgrade.subprocess, 'run', run):
                    if fail:
                        with self.assertRaises(SystemExit):
                            upgrade.main()
                    else:
                        upgrade.main()
                self.assertEqual(target.read_bytes(), original if fail else upgrade.SOURCE.encode())
                backup, = Path(folder).glob('*.backup-*')
                self.assertEqual(backup.read_bytes(), original)
                for command in calls:
                    self.assertEqual(command[0], 'systemctl')
                    self.assertEqual(command[-1], 'mildura-mirror.service')
                self.assertEqual(calls[0], ['systemctl', 'restart', 'mildura-mirror.service'])
                if fail:
                    self.assertEqual(calls[-1], calls[0])

    def test_embedded_program_matches_tested_source(self):
        source = Path(upgrade.__file__).with_name('mildura_mirror.py').read_bytes()
        self.assertEqual(upgrade.SOURCE.encode(), source)


if __name__ == '__main__':
    unittest.main()
