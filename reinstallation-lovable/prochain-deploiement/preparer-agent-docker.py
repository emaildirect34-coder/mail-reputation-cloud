#!/usr/bin/env python3
"""Prepare an agent image layer from a Lovable installer without executing it."""

import argparse
import re
import shutil
from pathlib import Path
from urllib.parse import urlsplit


def extract(source, filename, marker):
    pattern = rf"^cat > /usr/local/bin/{re.escape(filename)} <<'{marker}'\n(.*?)^{marker}$"
    matches = re.findall(pattern, source, re.MULTILINE | re.DOTALL)
    if len(matches) != 1 or not matches[0].startswith('#!'):
        raise ValueError(f'Bloc {marker} introuvable ou ambigu. Vérifier la version publiée par Lovable.')
    return matches[0]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('installer', type=Path)
    parser.add_argument('origin')
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    origin = urlsplit(args.origin)
    if not re.fullmatch(r'https://[a-z0-9.-]+/?', args.origin) or not origin.hostname:
        parser.error('Indiquer uniquement l’origine HTTPS publiée dans Lovable.')
    try:
        source = args.installer.read_text(encoding='utf-8')
        scripts = {filename: extract(source, filename, marker) for filename, marker in (
            ('kumo-agent', 'AGENT'), ('kumo-events.py', 'EVENTS'), ('kumo-campaign-control.py', 'CONTROL'),
        )}
        agent = scripts['kumo-agent']
        if agent.count('__API__') != 1 or 'confirm-suppressions' not in agent or 'preferencePermit:true' not in agent:
            raise ValueError('L’installateur publié ne contient pas encore les fonctions attendues.')
        scripts['kumo-agent'] = agent.replace('__API__', args.origin.rstrip('/') + '/api/public/agent')
        args.output.mkdir()
        for filename, script in scripts.items():
            (args.output / filename).write_text(script, encoding='utf-8', newline='\n')
        directory = Path(__file__).resolve().parent
        shutil.copyfile(directory / 'suppression-bloom.py', args.output / 'suppression-bloom.py')
        shutil.copyfile(directory / 'Dockerfile.agent-update', args.output / 'Dockerfile')
    except (OSError, ValueError) as error:
        parser.exit(1, f'{error}\n')
    print(f'Image prête à préparer depuis {args.output}. Aucun script téléchargé n’a été exécuté.')


if __name__ == '__main__':
    main()
