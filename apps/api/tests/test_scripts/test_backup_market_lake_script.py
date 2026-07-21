import pathlib

SCRIPT = pathlib.Path(__file__).resolve().parents[4] / "deployment" / "n6v" / "backup-market-lake.ps1"


def test_backup_script_checks_native_exit_codes_and_validates_bronze_run():
    content = SCRIPT.read_text(encoding="utf-8")

    assert "function Get-CommittedBronzeRun" in content
    assert 'Join-Path $run.FullName "COMPLETE"' in content
    assert 'Join-Path $run.FullName "manifest.json"' in content
    assert "Get-FileHash -LiteralPath $fragmentPath -Algorithm SHA256" in content
    assert "backup $dumpPath $bronzeRun" in content
    assert 'Where-Object { $_.message_type -eq "summary" }' in content
    assert '$snapshotId = [string]$backupSummary.snapshot_id' in content
    assert '& $restic.Source snapshots --json $snapshotId' in content
    assert '$snapshots = ($snapshotOutput -join "`n") | ConvertFrom-Json' in content
    assert "$matchingSnapshots.Count -ne 1" in content
    assert '$snapshot.paths -notcontains $expectedPath' in content
    assert '--latest 1' not in content
    assert 'Select-Object -Single' not in content
    assert 'Remove-Item -LiteralPath $dumpPath -Force' in content
    for command in (
        "& $mongodump.Source",
        "$backupOutput = & $restic.Source backup",
        "$snapshotOutput = & $restic.Source snapshots",
        "& $restic.Source check",
    ):
        start = content.index(command)
        assert "ExitCode" in content[start : start + 350] or "if ($LASTEXITCODE -ne 0)" in content[start : start + 350]
