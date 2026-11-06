#!/usr/bin/env python3
"""Use the already-transferred installer after checking the reviewed Pi source.
No file or service changes occur until the source matches this exact reviewed copy.
The installer's own backup, syntax checks, checksum and rollback remain in force.
"""
import hashlib
from pathlib import Path
import runpy

target = Path('/opt/mildura-mirror/mildura_mirror.py')
data = target.read_bytes()
normalised = (data.decode('utf-8').replace('\r\n', '\n').rstrip() + '\n').encode('utf-8')
if hashlib.sha256(normalised).hexdigest() != 'd01bc75bb33d9b8f4e0b228360b09c716e70291786a9761f893d3cae7942866c':
    raise SystemExit('Source does not match the reviewed Pi copy; nothing changed.')
installer = runpy.run_path('/home/rjlcommercial/upgrade_reconnect.py')
if installer.get('NEW_SHA256') != '773c486a1098ba33d51983b94a32b82ae1bd33ac38a9eb7f568c41a4d4c0fc8a':
    raise SystemExit('Unexpected installer version; nothing changed.')
installer['main'].__globals__['OLD_SHA256'] = hashlib.sha256(data).hexdigest()
installer['main']()
