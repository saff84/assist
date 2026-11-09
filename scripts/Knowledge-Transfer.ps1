Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Invoke-KnowledgeRemote {
    param([string]$Server, [string]$RemoteProject, [string[]]$Arguments = @(),
          [ValidateSet('run', 'prepare', 'hash')][string]$Operation = 'run',
          [string]$RemoteFile = '', [string]$ExpectedHash = '')
    if ($Server -notmatch '^[A-Za-z0-9_][A-Za-z0-9_.@-]*$') { throw 'Use an SSH config alias or user@hostname.' }
    if ($RemoteProject -notmatch '^/[A-Za-z0-9_./-]+$' -or $RemoteProject.Contains('/../')) {
        throw 'RemoteProject must be an absolute Linux path without spaces or shell characters.'
    }
    $payload = @{ project = $RemoteProject; arguments = @($Arguments); operation = $Operation; file = $RemoteFile; hash = $ExpectedHash }
    $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($payload | ConvertTo-Json -Compress)))
    # Only base64 is interpolated into the remote command; paths/questions are JSON data.
    $program = @'
import base64,hashlib,json,os,pathlib,subprocess,sys
c=json.loads(base64.b64decode(sys.argv[1])); os.chdir(c["project"])
if c["operation"]=="run":
    sys.exit(subprocess.call(["python3","scripts/knowledge_backup.py"]+c["arguments"]))
p=pathlib.Path(c["file"])
if c["operation"]=="prepare":
    p.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    if p.exists(): sys.exit("Transfer destination already exists")
else:
    h=hashlib.sha256()
    with p.open("rb") as f:
        for b in iter(lambda:f.read(4194304),b""): h.update(b)
    if h.hexdigest()!=c["hash"].lower(): sys.exit("Transferred archive checksum mismatch")
'@
    $code = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($program))
    $remoteCommand = "python3 -c 'import base64,sys;exec(base64.b64decode(sys.argv.pop(1)))' $code $encoded"
    & ssh -o ServerAliveInterval=30 -o ServerAliveCountMax=10 -- $Server $remoteCommand
    if ($LASTEXITCODE -ne 0) { throw "Remote operation failed (exit $LASTEXITCODE). Existing data was not overwritten by the transfer." }
}
