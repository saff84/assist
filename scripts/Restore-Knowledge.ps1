param(
    [Parameter(Mandatory)][string]$Server,
    [Parameter(Mandatory)][string]$RemoteProject,
    [Parameter(Mandatory)][string]$Archive,
    [Parameter(Mandatory)][string]$Question,
    [Parameter(Mandatory)][string]$ExpectedAnswer,
    [ValidateRange(1024,65535)][int]$StagePort = 3210
)
. "$PSScriptRoot/Knowledge-Transfer.ps1"
$Archive = (Resolve-Path -LiteralPath $Archive).Path
$hash = (Get-FileHash -LiteralPath $Archive -Algorithm SHA256).Hash.ToLowerInvariant()
$remote = $RemoteProject.TrimEnd('/') + '/.knowledge-backups/transfers/upload-' + [Guid]::NewGuid().ToString('N') + '.akb.tar'
Invoke-KnowledgeRemote -Server $Server -RemoteProject $RemoteProject -Operation prepare -RemoteFile $remote
& scp -- $Archive "${Server}:$remote"
if ($LASTEXITCODE -ne 0) { throw 'Upload incomplete; restoration was not started.' }
Invoke-KnowledgeRemote -Server $Server -RemoteProject $RemoteProject -Operation hash -RemoteFile $remote -ExpectedHash $hash
Invoke-KnowledgeRemote -Server $Server -RemoteProject $RemoteProject -Arguments @(
    'restore', $remote, '--question', $Question, '--expect', $ExpectedAnswer, '--port', "$StagePort")
Write-Host 'Restoration is isolated. Review the reported restore directory before switching the working app.'
