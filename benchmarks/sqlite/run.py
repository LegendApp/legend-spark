#!/usr/bin/env python3
"""Compile and benchmark real SQLite JSI providers in a macOS Hermes host."""
import argparse, base64, hashlib, io, json, os, pathlib, re, shutil, statistics
import subprocess, tarfile, time, urllib.request

SOURCE = pathlib.Path(__file__).resolve().parent
REPO = SOURCE.parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--work', type=pathlib.Path, default=REPO / '.spark/benchmarks/sqlite')
parser.add_argument('--hermes-headers', type=pathlib.Path, default=REPO / 'examples/kitchen-sink/macos/Pods/hermes-engine/destroot/include')
parser.add_argument('--hermes-frameworks', type=pathlib.Path, default=REPO / 'artifacts/runtimes/LegendGo.app/Contents/Frameworks')
parser.add_argument('--rounds', type=int, default=3)
args = parser.parse_args()
work = args.work.resolve()


def reserve(extra=0):
    destination = pathlib.Path('/System/Volumes/Data')
    if not destination.exists():
        destination = work if work.exists() else REPO
    available = shutil.disk_usage(destination).free
    if available - extra <= 50_000_000_000:
        raise RuntimeError(f'Disk reserve reached: {available} bytes available; 50 GB required')


def run(command, **kwargs):
    reserve(200_000_000)
    process = subprocess.Popen([str(part) for part in command], **kwargs)
    try:
        while process.poll() is None:
            reserve()
            time.sleep(0.5)
        if process.returncode:
            raise RuntimeError(f'Command failed ({process.returncode}): {command[0]}')
    except BaseException:
        if process.poll() is None:
            process.terminate()
            process.wait()
        raise
    finally:
        reserve()


reserve(200_000_000)
work.mkdir(parents=True, exist_ok=True)
if not (args.hermes_headers / 'hermes/hermes.h').exists():
    raise RuntimeError('Hermes headers missing; pass --hermes-headers from an existing RN macOS installation')
if not (args.hermes_frameworks / 'hermes.framework/hermes').exists():
    raise RuntimeError('Hermes framework missing; pass --hermes-frameworks from an existing RN macOS build')
# Pin and verify the published package; do not install or modify app dependencies.
metadata_path = work / 'nitro-metadata.json'
package = work / 'nitro/package'
if not package.exists():
    metadata = json.load(urllib.request.urlopen('https://registry.npmjs.org/react-native-nitro-sqlite/10.0.0'))
    archive = urllib.request.urlopen(metadata['dist']['tarball']).read()
    digest = 'sha512-' + base64.b64encode(hashlib.sha512(archive).digest()).decode()
    if digest != metadata['dist']['integrity']:
        raise RuntimeError('NitroSQLite archive integrity mismatch')
    metadata_path.write_text(json.dumps(metadata, indent=2))
    with tarfile.open(fileobj=io.BytesIO(archive), mode='r:gz') as tar:
        target = work / 'nitro'
        target.mkdir(exist_ok=True)
        for member in tar.getmembers():
            destination = target / member.name
            if member.issym() or member.islnk() or target.resolve() not in destination.resolve().parents:
                raise RuntimeError('Unsafe archive member: ' + member.name)
            if member.isdir():
                destination.mkdir(parents=True, exist_ok=True)
            elif member.isfile():
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(tar.extractfile(member).read())
reserve()

nm = REPO / 'node_modules'
op = nm / '@op-engineering/op-sqlite'
nitro = nm / 'react-native-nitro-modules/cpp'
for folder, expected in [(op, '18.2.1'), (nm / 'react-native-nitro-modules', '0.35.7'), (package, '10.0.0')]:
    if json.loads((folder / 'package.json').read_text())['version'] != expected:
        raise RuntimeError(f'Unexpected package version: {folder}; update benchmark metadata deliberately')
include = work / 'include/NitroModules'
include.mkdir(parents=True, exist_ok=True)
for header in nitro.rglob('*.hpp'):
    destination = include / header.name
    if not destination.exists():
        destination.symlink_to(header)
common = ['-O3', '-DNDEBUG', '-std=c++20', '-mmacosx-version-min=14.0']
common += ['-I' + str(folder) for folder in [args.hermes_headers, nm / 'react-native/ReactCommon/jsi', nm / 'react-native/ReactCommon/callinvoker', work / 'include', include]]
optimized = ['SQLITE_DQS=0', 'SQLITE_DEFAULT_MEMSTATUS=0', 'SQLITE_DEFAULT_WAL_SYNCHRONOUS=1', 'SQLITE_LIKE_DOESNT_MATCH_BLOBS=1', 'SQLITE_MAX_EXPR_DEPTH=0', 'SQLITE_OMIT_DEPRECATED=1', 'SQLITE_OMIT_PROGRESS_CALLBACK=1', 'SQLITE_OMIT_SHARED_CACHE=1', 'SQLITE_USE_ALLOCA=1']


def compile_object(command, source, obj):
    signature = obj.with_suffix('.command.json')
    serialized = json.dumps([str(part) for part in command])
    if not obj.exists() or obj.stat().st_mtime < source.stat().st_mtime or not signature.exists() or signature.read_text() != serialized:
        run(command)
        signature.write_text(serialized)


for provider in ['op', 'nitro']:
    output = work / 'build' / provider
    output.mkdir(parents=True, exist_ok=True)
    sources = [SOURCE / 'host.cpp', nm / 'react-native/ReactCommon/jsi/jsi/jsi.cpp']
    flags = common + ['-D' + ('OP_BACKEND' if provider == 'op' else 'NITRO_BACKEND')]
    if provider == 'op':
        sources += sorted((op / 'cpp').glob('*.cpp'))
        flags += ['-I' + str(op / 'cpp')]
        csource = op / 'cpp/sqlite3.c'
        cflags = ['HAVE_USLEEP=1', 'SQLITE_ENABLE_LOCKING_STYLE=0', 'SQLITE_DBCONFIG_ENABLE_LOAD_EXTENSION=1']
    else:
        sources += sorted(nitro.rglob('*.cpp'))
        sources += sorted((nm / 'react-native-nitro-modules/ios/platform').glob('*.cpp'))
        sources += sorted((nm / 'react-native-nitro-modules/ios/threading').glob('*.cpp'))
        sources += sorted((package / 'cpp').rglob('*.cpp'))
        sources += [file for file in sorted((package / 'nitrogen/generated/shared/c++').glob('*.cpp')) if 'OnLoad' not in file.name]
        flags += ['-I' + str(folder) for folder in [nm / 'react-native-nitro-modules/ios/threading', package / 'cpp', package / 'cpp/sqlite', package / 'cpp/hybridObjects', package / 'nitrogen/generated/shared/c++']]
        csource = package / 'cpp/sqlite/sqlite3.c'
        cflags = optimized + ['SQLITE_THREADSAFE=1']
    objects = []
    for index, source in enumerate(sources):
        obj = output / f'{index}-{source.stem}.o'
        objects.append(obj)
        compile_object(['clang++'] + flags + ['-c', source, '-o', obj], source, obj)
    obj = output / 'sqlite.o'
    objects.append(obj)
    compile_object(['clang', '-O3', '-DNDEBUG', '-mmacosx-version-min=14.0', '-DHAVE_FULLFSYNC=1'] + ['-D' + value for value in cflags] + ['-c', csource, '-o', obj], csource, obj)
    run(['clang++'] + common + objects + ['-F' + str(args.hermes_frameworks), '-framework', 'hermes', '-framework', 'Foundation', '-Wl,-rpath,' + str(args.hermes_frameworks), '-o', work / f'{provider}-host'])

run(['bun', SOURCE / 'bundle.ts'], env={**os.environ, 'SQLITE_BENCHMARK_WORK': str(work)})
results = {'sourceHead': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=REPO, text=True).strip(), 'machine': subprocess.check_output(['sysctl', '-n', 'machdep.cpu.brand_string'], text=True).strip(), 'rounds': []}
for round_number in range(args.rounds):
    for provider in (['nitro', 'op'] if round_number % 2 == 0 else ['op', 'nitro']):
        database_dir = work / f'db-{provider}'
        database_dir.mkdir(exist_ok=True)
        stdout_path = work / f'{provider}-{round_number}.jsonl'
        metrics_path = work / f'{provider}-{round_number}-time.txt'
        with stdout_path.open('w') as stdout, metrics_path.open('w') as stderr:
            run(['/usr/bin/time', '-l', work / f'{provider}-host', work / f'{provider}-suite.js', database_dir], stdout=stdout, stderr=stderr)
        records = [json.loads(line) for line in stdout_path.read_text().splitlines()]
        if not records[-1].get('completed') or records[-1]['correctness'] != 'passed':
            raise RuntimeError(f'Incomplete benchmark: {stdout_path}')
        rss = re.search(r'(\d+)\s+maximum resident set size', metrics_path.read_text())
        results['rounds'].append({'provider': provider, 'round': round_number, 'peakRssBytes': int(rss[1]), 'records': records})
        print(provider, round_number, 'completed', flush=True)
(work / 'results.json').write_text(json.dumps(results, indent=2))
print('Results:', work / 'results.json')
