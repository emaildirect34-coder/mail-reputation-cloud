#!/usr/bin/env python3
"""Rehearse restoring the checked-in VPS configuration in a temporary directory."""

from hashlib import sha256
from pathlib import Path, PurePosixPath
import shutil
import subprocess
from tempfile import TemporaryDirectory
from zipfile import ZipFile, ZIP_DEFLATED


def read_manifest(bundle: Path) -> dict[str, str]:
    manifest = {}
    for line in (bundle / "SHA256SUMS").read_text(encoding="utf-8").splitlines():
        digest, name = line.split("  ", 1)
        relative = PurePosixPath(name)
        if (len(digest) != 64 or relative.is_absolute() or ".." in relative.parts
                or "\\" in name or ":" in name or name in manifest
                or relative.parts[0] not in {"email-direct", "mail-tester"}):
            raise ValueError("Invalid path or checksum in the VPS manifest")
        manifest[name] = digest
    if not manifest:
        raise ValueError("The VPS manifest is empty")
    return manifest


def validate(root: Path, manifest: dict[str, str]) -> None:
    for name, digest in manifest.items():
        file = root / name
        if not file.resolve().is_relative_to(root.resolve()) or file.is_symlink():
            raise ValueError(f"Unexpected path: {name}")
        if sha256(file.read_bytes()).hexdigest() != digest:
            raise ValueError(f"Checksum mismatch: {name}")


def check_compose(root: Path, files: tuple[str, ...]) -> None:
    command = ["docker", "compose", "--project-name", "email-direct-restore-check"]
    for file in files:
        command.extend(["-f", file])
    subprocess.run([*command, "config", "--quiet"], cwd=root, check=True, timeout=60)


def main() -> None:
    bundle = Path(__file__).resolve().parent / "vps"
    manifest = read_manifest(bundle)
    validate(bundle, manifest)
    with TemporaryDirectory(prefix="email-direct-restore-") as temporary:
        scratch = Path(temporary)
        backup = scratch / "configuration.zip"
        with ZipFile(backup, "w", ZIP_DEFLATED) as archive:
            for name in manifest:
                archive.write(bundle / name, name)

        restored = scratch / "restored"
        with ZipFile(backup) as archive:
            archive.extractall(restored, members=manifest)
        validate(restored, manifest)
        shutil.copyfile(bundle / "mail-tester/.env.example", restored / "mail-tester/.env")
        shutil.copyfile(bundle / "mail-tester/placement.env.example", restored / "mail-tester/.env.placement")
        check_compose(restored / "email-direct", ("compose.yaml",))
        check_compose(restored / "mail-tester", ("compose.yaml", "compose.vps.yaml", "compose.placement.yaml"))
    print(f"{len(manifest)} archived files restored and verified. Both Compose configurations passed.")


if __name__ == "__main__":
    main()
