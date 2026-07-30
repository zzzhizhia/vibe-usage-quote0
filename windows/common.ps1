Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$script:VibeUsageTaskName = 'VibeUsageQuote0'

function Get-CommandPath {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Name
  )

  foreach ($candidate in $Name) {
    $command = Get-Command -Name $candidate -CommandType Application -ErrorAction SilentlyContinue |
      Select-Object -First 1
    if ($null -ne $command) {
      $source = $command.Source
      if ([string]::IsNullOrWhiteSpace($source)) {
        $source = $command.Definition
      }
      if ([IO.Path]::IsPathRooted($source) -and (Test-Path -LiteralPath $source -PathType Leaf)) {
        return [IO.Path]::GetFullPath($source)
      }
    }
  }

  throw "Required command not found: $($Name -join ', ')"
}

function Resolve-ExecutablePath {
  param(
    [string]$Path,
    [Parameter(Mandatory = $true)]
    [string[]]$CommandName
  )

  if ([string]::IsNullOrWhiteSpace($Path)) {
    return Get-CommandPath -Name $CommandName
  }
  if (-not [IO.Path]::IsPathRooted($Path)) {
    throw "Executable path must be absolute: $Path"
  }
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "Executable path does not exist: $Path"
  }
  return [IO.Path]::GetFullPath($Path)
}

function Get-WindowsQuoteConfigPath {
  if (-not [string]::IsNullOrWhiteSpace($env:XDG_CONFIG_HOME)) {
    return Join-Path (Join-Path $env:XDG_CONFIG_HOME 'vibe-usage-quote0') 'config.json'
  }
  if (-not [string]::IsNullOrWhiteSpace($env:APPDATA)) {
    return Join-Path (Join-Path $env:APPDATA 'vibe-usage-quote0') 'config.json'
  }
  if (-not [string]::IsNullOrWhiteSpace($env:USERPROFILE)) {
    return Join-Path (Join-Path (Join-Path $env:USERPROFILE 'AppData\Roaming') 'vibe-usage-quote0') 'config.json'
  }
  throw 'Windows config directory is unavailable: APPDATA and USERPROFILE are missing.'
}

function Get-WindowsDataDirectory {
  if (-not [string]::IsNullOrWhiteSpace($env:XDG_DATA_HOME)) {
    return Join-Path $env:XDG_DATA_HOME 'vibe-usage-quote0'
  }
  if (-not [string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
    return Join-Path $env:LOCALAPPDATA 'vibe-usage-quote0'
  }
  if (-not [string]::IsNullOrWhiteSpace($env:USERPROFILE)) {
    return Join-Path (Join-Path $env:USERPROFILE 'AppData\Local') 'vibe-usage-quote0'
  }
  throw 'Windows data directory is unavailable: LOCALAPPDATA and USERPROFILE are missing.'
}

function Assert-PersistentScheduledEnvironment {
  foreach ($name in @('XDG_CONFIG_HOME', 'XDG_DATA_HOME')) {
    $processValue = [Environment]::GetEnvironmentVariable(
      $name,
      [EnvironmentVariableTarget]::Process
    )
    if ([string]::IsNullOrWhiteSpace($processValue)) {
      continue
    }

    $userValue = [Environment]::GetEnvironmentVariable(
      $name,
      [EnvironmentVariableTarget]::User
    )
    $machineValue = [Environment]::GetEnvironmentVariable(
      $name,
      [EnvironmentVariableTarget]::Machine
    )
    $matchesUser = [string]::Equals(
      $processValue,
      $userValue,
      [StringComparison]::OrdinalIgnoreCase
    )
    $matchesMachine = [string]::Equals(
      $processValue,
      $machineValue,
      [StringComparison]::OrdinalIgnoreCase
    )
    if (-not $matchesUser -and -not $matchesMachine) {
      $command = "[Environment]::SetEnvironmentVariable('$name', `$env:$name, 'User')"
      throw "$name is set only for this process, so Task Scheduler would not inherit it. Run: $command ; then rerun the installer."
    }
  }
}

function Assert-QuoteConfigAcl {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "Quote config does not exist: $Path"
  }

  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $currentSid = $identity.User.Value
  $acl = Get-Acl -LiteralPath $Path
  $rules = @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
  $allowRules = @($rules | Where-Object {
    $_.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow
  })
  $currentRules = @($allowRules | Where-Object {
    $_.IdentityReference.Value -eq $currentSid
  })
  $otherRules = @($allowRules | Where-Object {
    $_.IdentityReference.Value -ne $currentSid
  })

  if (-not $acl.AreAccessRulesProtected -or $currentRules.Count -eq 0 -or $otherRules.Count -gt 0) {
    $command = 'icacls "{0}" /reset ; icacls "{0}" /inheritance:r /grant:r "*{1}:(M)"' -f $Path, $currentSid
    throw "Quote config ACL must allow only the current user. Run: $command ; then rerun the installer."
  }
}
