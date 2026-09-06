#!/usr/bin/env bash

set -euo pipefail

dest="$(git config --get backup.driveDir || true)"

if [ -z "$dest" ]; then
  echo "↷ backup.driveDir non défini — sauvegarde Drive sautée"
  echo "  (à configurer : git config --global backup.driveDir <chemin>)"
  exit 0
fi
if [ ! -d "$dest" ]; then
  echo "↷ backup.driveDir pointe vers un dossier absent ($dest) — sauvegarde sautée"
  exit 0
fi

repo="$(git rev-parse --show-toplevel)"
name="$(basename "$repo")"
tmp="$dest/.${name}.tar.gz.tmp"
out="$dest/${name}.tar.gz"

if tar -czf "$tmp" -C "$(dirname "$repo")" "$name"; then
  mv -f "$tmp" "$out"
  echo "✓ Sauvegarde : $out ($(du -h "$out" | cut -f1)) — laisse Google Drive finir la synchro"
else
  rm -f "$tmp"
  echo "✗ Échec de l'archivage vers $dest" >&2
  exit 1
fi
