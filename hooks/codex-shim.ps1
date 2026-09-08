param([Parameter(Mandatory = $true)][string]$Script)
# my-flow Codex hook shim (Windows). Codex runs hook commands through PowerShell; this
# forwards stdin/stdout/stderr to a Node hook script. {{NODE}} is substituted at install time.
$ErrorActionPreference = 'Stop'
$node = '{{NODE}}'
if (-not (Test-Path -LiteralPath $node)) { $node = 'node' }
$startInfo = [System.Diagnostics.ProcessStartInfo]::new()
$startInfo.FileName = $node
$startInfo.UseShellExecute = $false
$startInfo.RedirectStandardInput = $true
$startInfo.RedirectStandardOutput = $true
$startInfo.RedirectStandardError = $true
$startInfo.Arguments = '"' + $Script + '"'
$process = [System.Diagnostics.Process]::new()
$process.StartInfo = $startInfo
$null = $process.Start()
$stdinTask = [Console]::OpenStandardInput().CopyToAsync($process.StandardInput.BaseStream)
$stdoutTask = $process.StandardOutput.BaseStream.CopyToAsync([Console]::OpenStandardOutput())
$stderrTask = $process.StandardError.BaseStream.CopyToAsync([Console]::OpenStandardError())
$stdinTask.Wait()
$process.StandardInput.Close()
$process.WaitForExit()
$stdoutTask.Wait()
$stderrTask.Wait()
exit $process.ExitCode
