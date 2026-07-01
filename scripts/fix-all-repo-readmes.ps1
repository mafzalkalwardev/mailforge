# Remove placeholder screenshot sections from all mafzalkalwardev repos
# Keeps only README image refs that match files in docs/screenshots/

$ErrorActionPreference = "Continue"
$Owner = "mafzalkalwardev"

function Get-RepoScreenshotFiles($repo) {
    $files = @()
    try {
        $items = gh api "repos/$Owner/$repo/contents/docs/screenshots" --jq '.[].name' 2>$null
        if ($items) { $files = @($items) }
    } catch {}
    return $files
}

function Clean-ReadmeText($text, $screenshotFiles) {
    $lines = $text -split "`r?`n"
    $out = New-Object System.Collections.Generic.List[string]
    $skipUntilBlank = $false
    $inScreenshots = $false

    for ($i = 0; $i -lt $lines.Count; $i++) {
        $line = $lines[$i]

        if ($line -match 'placeholder\.svg') { continue }
        if ($line -match 'Replace.*placeholder\.svg') { continue }
        if ($line -match '^\*Replace `docs/screenshots') { continue }

        if ($line -match '^##\s*.*Screenshots') {
            $inScreenshots = $true
            $sectionStart = $out.Count
            $out.Add($line)
            continue
        }

        if ($inScreenshots -and $line -match '^##\s' -and $line -notmatch 'Screenshots') {
            $inScreenshots = $false
        }

        if ($line -match '!\[[^\]]*\]\((docs/screenshots/[^)]+)\)') {
            $path = $Matches[1] -replace '.*/', ''
            if ($screenshotFiles -notcontains $path) { continue }
        }

        if ($line -match '<img[^>]+src="(docs/screenshots/[^"]+)"') {
            $path = $Matches[1] -replace '.*/', ''
            if ($screenshotFiles -notcontains $path) { continue }
        }

        $out.Add($line)
    }

    $result = ($out -join "`n")

    # Remove empty Screenshots sections (header only, no images)
    $result = [regex]::Replace($result, '(?ms)^##[^\n]*Screenshots[^\n]*\r?\n(?!\s*!\[)(?:(?!^##).*\r?\n)*', '')

    # Remove duplicate consecutive Screenshots headers
    while ($result -match '(?ms)(##[^\n]*Screenshots[^\n]*\r?\n){2,}') {
        $result = $result -replace '(?ms)(##[^\n]*Screenshots[^\n]*\r?\n)(##[^\n]*Screenshots[^\n]*\r?\n)+', '$1'
    }

    # Clean nav links with broken encoding
    $result = $result -replace '\[Features\][^\n]*Screenshots[^\n]*Contributing[^\n]*\r?\n', ''

    return $result.TrimEnd() + "`n"
}

$repos = gh repo list $Owner --limit 100 --json name -q '.[].name'

foreach ($repo in $repos) {
    if ($repo -eq 'odysseus') { continue }

    $readmeMeta = gh api "repos/$Owner/$repo/readme" --jq '{sha: .sha, content: .content}' 2>$null | ConvertFrom-Json
    if (-not $readmeMeta) { continue }

    $text = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($readmeMeta.content))
    if ($text -notmatch 'placeholder\.svg|docs/screenshots') {
        Write-Host "SKIP $repo (no placeholder/screenshots section)"
        continue
    }

    $shots = Get-RepoScreenshotFiles $repo
    $shots = $shots | Where-Object { $_ -ne 'placeholder.svg' -and $_ -notmatch '\.md$' }

    $cleaned = Clean-ReadmeText $text $shots
    if ($cleaned -eq $text) {
        Write-Host "UNCHANGED $repo"
        continue
    }

    $b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($cleaned))
    $body = @{
        message = "docs: remove placeholder screenshots from README"
        content = $b64
        sha = $readmeMeta.sha
    } | ConvertTo-Json

    try {
        gh api -X PUT "repos/$Owner/$repo/contents/README.md" --input - <<< $body 2>$null
        if ($LASTEXITCODE -ne 0) {
            $tempFile = [IO.Path]::GetTempFileName()
            Set-Content -Path $tempFile -Value $body -Encoding UTF8
            gh api -X PUT "repos/$Owner/$repo/contents/README.md" -f message="docs: remove placeholder screenshots from README" -f content=$cleaned -f sha=$readmeMeta.sha 2>&1
            Remove-Item $tempFile -Force -ErrorAction SilentlyContinue
        }
        Write-Host "FIXED $repo"
    } catch {
        Write-Host "FAIL $repo : $_"
    }
}

Write-Host "Done."
