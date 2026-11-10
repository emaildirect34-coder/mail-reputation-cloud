#!/usr/bin/env python3
"""Build and query a signed, advisory suppression snapshot. Input is one MD5 per line."""

import argparse
import hashlib
import hmac
import json
import math
import os
import struct
import sys
import tempfile
import time
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener


HEADER = struct.Struct('!4sQQ')
VERSION = b'EDB1'
MAX_COUNT = 10_000_000
PROBES = 7
TAG_SIZE = 32
MAX_AGE = 86400


def bloom_bytes(capacity):
    if not 1 <= capacity <= MAX_COUNT:
        raise ValueError('Capacity must be between 1 and 10,000,000')
    return math.ceil(capacity * 1.2)


def positions(value, key, size):
    if len(value) != 32:
        raise ValueError('Expected a 32-character hexadecimal suppression hash')
    raw = bytes.fromhex(value)
    if len(raw) != 16:
        raise ValueError('Expected a 32-character hexadecimal suppression hash')
    a, b = struct.unpack('!QQ', hmac.digest(key, b'index\0' + raw, 'sha256')[:16])
    for i in range(PROBES):
        yield (a + i * (b | 1)) % size


def signed(header, bits, key):
    mac = hmac.new(key, b'snapshot\0' + header, hashlib.sha256)
    mac.update(bits)
    return mac.digest()


def build(values, capacity, output, key):
    bits = bytearray(bloom_bytes(capacity))
    count = 0
    for count, value in enumerate(values, 1):
        if count > capacity:
            raise ValueError('The snapshot exceeds its declared capacity')
        for position in positions(value, key, len(bits) * 8):
            bits[position >> 3] |= 1 << (position & 7)
    header = HEADER.pack(VERSION, int(time.time()), capacity)
    with tempfile.NamedTemporaryFile(dir=output.parent, delete=False) as stream:
        temporary = Path(stream.name)
        try:
            stream.write(header)
            stream.write(bits)
            stream.write(signed(header, bits, key))
            stream.flush()
            os.fsync(stream.fileno())
            stream.close()
            os.replace(temporary, output)
        finally:
            if temporary.exists():
                stream.close()
                temporary.unlink()
    return count


def load(path, key):
    with path.open('rb') as stream:
        header = stream.read(HEADER.size)
        if len(header) != HEADER.size:
            raise ValueError('Truncated snapshot')
        version, issued, capacity = HEADER.unpack(header)
        if version != VERSION or not -300 <= time.time() - issued <= MAX_AGE:
            raise ValueError('Unknown version, stale snapshot, or invalid time')
        size = bloom_bytes(capacity)
        bits = stream.read(size)
        tag = stream.read(TAG_SIZE)
        if len(bits) != size or not hmac.compare_digest(tag, signed(header, bits, key)) or stream.read(1):
            raise ValueError('Snapshot authentication failed')
    return bits


def maybe_present(bits, key, value):
    return all(bits[position >> 3] & (1 << (position & 7)) for position in positions(value, key, len(bits) * 8))


def suspects(bits, key, jobs):
    if not isinstance(jobs, list) or len(jobs) > 200:
        raise ValueError('Expected at most 200 jobs')
    return [job['id'] for job in jobs if maybe_present(bits, key,
            hashlib.md5(job['rcpt'].strip().lower().encode(), usedforsecurity=False).hexdigest())]


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def refresh(url, output, key, token):
    location = urlsplit(url)
    if location.scheme != 'https' or not location.hostname or location.username or location.password or location.fragment:
        raise ValueError('A private HTTPS snapshot URL is required')
    if not token or any(char.isspace() for char in token):
        raise ValueError('A snapshot bearer token is required')
    limit = HEADER.size + bloom_bytes(MAX_COUNT) + TAG_SIZE
    request = Request(url, headers={'Authorization': 'Bearer ' + token})
    with tempfile.NamedTemporaryFile(dir=output.parent, delete=False) as stream:
        temporary = Path(stream.name)
        try:
            with build_opener(NoRedirect).open(request, timeout=15) as response:
                total = 0
                while chunk := response.read(65536):
                    total += len(chunk)
                    if total > limit:
                        raise ValueError('Oversized snapshot')
                    stream.write(chunk)
            stream.flush()
            os.fsync(stream.fileno())
            stream.close()
            load(temporary, key)
            os.replace(temporary, output)
        finally:
            if temporary.exists():
                stream.close()
                temporary.unlink()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    create = commands.add_parser('build')
    create.add_argument('file', type=Path)
    create.add_argument('--capacity', required=True, type=int)
    query = commands.add_parser('query')
    query.add_argument('file', type=Path)
    batch = commands.add_parser('suspects')
    batch.add_argument('file', type=Path)
    download = commands.add_parser('refresh')
    download.add_argument('file', type=Path)
    download.add_argument('url')
    args = parser.parse_args()
    try:
        key = bytes.fromhex(os.environ.get('SUPPRESSION_BLOOM_KEY', ''))
        if len(key) != 32:
            raise ValueError('SUPPRESSION_BLOOM_KEY must contain 32 random bytes in hexadecimal')
        hashes = (line.strip() for line in sys.stdin if line.strip())
        if args.command == 'build':
            print(build(hashes, args.capacity, args.file, key))
        elif args.command == 'refresh':
            refresh(args.url, args.file, key, os.environ.get('SUPPRESSION_BLOOM_FETCH_TOKEN', ''))
        elif args.command == 'suspects':
            bits = load(args.file, key)
            print(json.dumps(suspects(bits, key, json.load(sys.stdin))))
        else:
            bits = load(args.file, key)
            for value in hashes:
                print('maybe-present' if maybe_present(bits, key, value) else 'absent-at-snapshot')
    except HTTPError as error:
        sys.exit(f'Snapshot refresh failed (HTTP {error.code})')
    except (OSError, ValueError, KeyError, TypeError, AttributeError) as error:
        sys.exit(str(error))


if __name__ == '__main__':
    main()
