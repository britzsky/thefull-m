param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$ExpoArguments
)

$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$packageJsonPath = Join-Path $projectRoot 'package.json'
$expoCliPath = Join-Path $projectRoot 'node_modules\expo\bin\cli'

if (-not (Test-Path -LiteralPath $packageJsonPath)) {
    throw "Expo project was not found: $projectRoot"
}

if (-not (Test-Path -LiteralPath $expoCliPath)) {
    throw 'Expo is not installed. Run npm.cmd install first.'
}

if ($projectRoot -notmatch '[\\/]\.git[\\/]') {
    Push-Location -LiteralPath $projectRoot
    try {
        & node $expoCliPath @ExpoArguments
        exit $LASTEXITCODE
    }
    finally {
        Pop-Location
    }
}

# Metro가 상위 경로의 .git 이름까지 버전관리 폴더로 오인하지 않도록 실행 중에만 가상 드라이브를 연결합니다.
$gitDirectory = $projectRoot

while ($gitDirectory -and (Split-Path -Path $gitDirectory -Leaf) -ne '.git') {
    $parentDirectory = Split-Path -Path $gitDirectory -Parent
    if (-not $parentDirectory -or $parentDirectory -eq $gitDirectory) {
        $gitDirectory = $null
        break
    }
    $gitDirectory = $parentDirectory
}

if (-not $gitDirectory) {
    throw "A parent .git directory was not found: $projectRoot"
}

$relativeProjectPath = $projectRoot.Substring($gitDirectory.Length).TrimStart([char[]]'\/')
$projectName = Split-Path -Path $projectRoot -Leaf
$driveLetter = $null
$driveName = $null
$driveRoot = $null
$aliasPath = $null
$createdAlias = $false

# 다른 Expo 프로세스가 사용 중인 문자는 건너뛰고 실제 연결에 성공한 첫 번째 문자를 사용합니다.
foreach ($candidate in @('T', 'U', 'V', 'W', 'X', 'Y', 'Z')) {
    $candidateDriveName = "${candidate}:"
    $candidateAliasPath = Join-Path ([System.IO.Path]::GetTempPath()) "${projectName}-expo-parent-${candidate}"
    $candidateAliasCreated = $false

    if (Test-Path -LiteralPath $candidateAliasPath) {
        $candidateAliasItem = Get-Item -LiteralPath $candidateAliasPath -Force
        if ($candidateAliasItem.LinkType -ne 'Junction' -or $candidateAliasItem.Target -notcontains $gitDirectory) {
            continue
        }
    }
    else {
        New-Item -ItemType Junction -Path $candidateAliasPath -Target $gitDirectory | Out-Null
        $candidateAliasCreated = $true
    }

    & subst.exe $candidateDriveName $candidateAliasPath >$null 2>&1
    if ($LASTEXITCODE -eq 0) {
        $driveLetter = $candidate
        $driveName = $candidateDriveName
        $driveRoot = "${candidate}:\"
        $aliasPath = $candidateAliasPath
        $createdAlias = $candidateAliasCreated
        break
    }

    if ($candidateAliasCreated -and (Test-Path -LiteralPath $candidateAliasPath)) {
        [System.IO.Directory]::Delete($candidateAliasPath)
    }
}

if (-not $driveLetter) {
    throw 'No available drive letter was found for Expo.'
}

$mappedProjectRoot = "$driveRoot$relativeProjectPath"

try {
    Push-Location -LiteralPath $mappedProjectRoot
    try {
        $mappedExpoCliPath = Join-Path $mappedProjectRoot 'node_modules\expo\bin\cli'
        & node $mappedExpoCliPath @ExpoArguments
        exit $LASTEXITCODE
    }
    finally {
        Pop-Location
    }
}
finally {
    & subst.exe $driveName /D
    $aliasItem = Get-Item -LiteralPath $aliasPath -Force -ErrorAction SilentlyContinue
    if ($createdAlias -and $aliasItem -and $aliasItem.LinkType -eq 'Junction' -and $aliasItem.Target -contains $gitDirectory) {
        [System.IO.Directory]::Delete($aliasPath)
    }
}
