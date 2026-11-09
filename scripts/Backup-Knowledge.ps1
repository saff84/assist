param(
    [Parameter(Mandatory)][string]$Server,
    [Parameter(Mandatory)][string]$RemoteProject,
    [Parameter(Mandatory)][string]$LocalDirectory,
    [ValidateSet('standard','full')][string]$Mode = 'standard'
)
. "$PSScriptRoot/Knowledge-Transfer.ps1"
New-Item -ItemType Directory -Path $LocalDirectory -Force | Out-Null
$LocalDirectory = (Resolve-Path -LiteralPath $LocalDirectory).Path
$name = "knowledge-$Mode-" + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ') + '-' + [Guid]::NewGuid().ToString('N').Substring(0,8) + '.akb.tar'
$remote = $RemoteProject.TrimEnd('/') + '/.knowledge-backups/transfers/' + $name
Invoke-KnowledgeRemote -Server $Server -RemoteProject $RemoteProject -Arguments @('backup','--output',$remote,'--mode',$Mode)
$partial = Join-Path $LocalDirectory ($name + '.partial')
$hashFile = Join-Path $LocalDirectory ($name + '.sha256')
& scp -- "${Server}:$remote" $partial
if ($LASTEXITCODE -ne 0) { throw 'Download incomplete; partial file and server backup were retained.' }
& scp -- "${Server}:$remote.sha256" $hashFile
if ($LASTEXITCODE -ne 0) { throw 'Failed to download checksum.' }
$expected = ((Get-Content -LiteralPath $hashFile -Raw).Trim() -split '\s+')[0]
if ($expected -notmatch '^[a-fA-F0-9]{64}$' -or (Get-FileHash -LiteralPath $partial -Algorithm SHA256).Hash -ne $expected) {
    throw 'Downloaded archive checksum mismatch; do not use this copy.'
}
$destination = Join-Path $LocalDirectory $name
Move-Item -LiteralPath $partial -Destination $destination
Write-Host "Verified complete knowledge backup: $destination"
