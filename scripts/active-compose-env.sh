# Source after changing to the project directory. Does not print runtime secrets.
if [ -f .knowledge-active.json ]; then
  COMPOSE_FILE=$(python3 -c 'import json,pathlib; root=pathlib.Path.cwd().resolve(); p=pathlib.Path(json.loads((root/".knowledge-active.json").read_text())["compose"]).resolve(); assert p.is_file() and p.parent.parent == root/".knowledge-backups"; print(p)')
  export COMPOSE_FILE
fi
