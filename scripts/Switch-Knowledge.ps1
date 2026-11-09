param(
    [Parameter(Mandatory)][string]$Server,
    [Parameter(Mandatory)][string]$RemoteProject,
    [Parameter(Mandatory)][string]$RestoreDirectory,
    [switch]$Rollback,
    [switch]$Fresh,
    [ValidateRange(1024,65535)][int]$Port = 3000
)
. "$PSScriptRoot/Knowledge-Transfer.ps1"
$action = if ($Rollback) { 'rollback' } else { 'promote' }
if ($Rollback -and $Fresh) { throw 'Fresh and Rollback are mutually exclusive.' }
$remoteArguments = @($action, $RestoreDirectory)
if ($Fresh) { $remoteArguments += @('--fresh','--port',"$Port") }
Invoke-KnowledgeRemote -Server $Server -RemoteProject $RemoteProject -Arguments $remoteArguments
