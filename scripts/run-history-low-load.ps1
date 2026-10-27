param(
    [ValidateSet('Probe', 'TransportProbe', 'HistoryUI', 'BasicSettingsUI', 'ImageInputUI', 'ImageInputPersist', 'BudgetImageInputPersist', 'FalImageInputPersist', 'BananaImageInputPersist', 'VideoInputPersist', 'FalVideoInputPersist', 'BasicSettingsPersist', 'GeneratedVersions', 'FullHistory', 'CreativeCanvas', 'StrataCanvas', 'MotionCanvas', 'KlingCanvas', 'CanvasSave', 'UpdateExit')][string]$Mode = 'Probe',
    [ValidateSet('image-standard', 'image-fal', 'image-mj', 'image-budget', 'video')][string]$SettingsCase = 'image-standard',
    [ValidateSet('gpt-image-2-fal', 'nano-banana-pro-fal', 'nano-banana-2-fal')][string]$FalModel = 'gpt-image-2-fal',
    [ValidateSet('zhenzhen-image-g-v2.5-lowprice', 'zhenzhen-image-g-v2.5-flare', 'zhenzhen-image-g-v2.5-sunburst')][string]$BudgetModel = 'zhenzhen-image-g-v2.5-flare',
    [ValidateSet('gemini-3.1-flash-image', 'gemini-3.1-flash-lite-image', 'nano-banana-pro', 'nano-banana-pro-2k', 'nano-banana-pro-4k', 'gemini-3-pro-image')][string]$BananaModel = 'gemini-3.1-flash-lite-image',
    [ValidateSet('veo3.1-fal', 'grok-video-fal', 'grok-imagine-video-1.5', 'sora-2')][string]$FalVideoModel = 'veo3.1-fal',
    [ValidateSet(0, 17)][int]$ProbeExitCode = 0,
    [switch]$ProbeLeaveIdleChild
)
# Dedicated child PowerShell only; never dot-source this into a user's shell.
# Windows Job limits cover this runner and its descendants, not other apps.
# References: Microsoft Learn Job Objects / CPU_RATE_CONTROL_INFORMATION /
# JOBOBJECT_EXTENDED_LIMIT_INFORMATION. No breakaway or kill-on-close flags.
$ErrorActionPreference = 'Stop'
if ($MyInvocation.InvocationName -eq '.') { throw 'Run this script in a dedicated pwsh process; do not dot-source it.' }
if (-not $IsWindows) { throw 'This resource-limited runner requires Windows.' }
if ($Mode -ne 'Probe' -and $ProbeExitCode -ne 0) { throw 'ProbeExitCode is only valid for the idle Probe.' }
if ($ProbeLeaveIdleChild -and ($Mode -ne 'Probe' -or $ProbeExitCode -ne 17)) { throw 'Orphan cleanup probe requires Probe with exit code 17.' }
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskNode = (Get-Command node.exe -ErrorAction Stop).Source
$taskMutex = [Threading.Mutex]::new($false, 'Local\T8HistoryAcceptanceLowLoad')
$taskOwnsMutex = $false
$taskJob = $null
$taskScratch = $null
$taskExitCode = 0
$taskChildExitCode = $null
$taskReceiptPath = $null
$taskStartedAt = [DateTime]::UtcNow.ToString('o')
$taskPhase = 'preflight'
$taskFailureKind = $null
$taskDescendantExitVerified = $false
$taskCleanupStatus = 'not-observed'
$taskForcedDescendantCount = 0
$taskRemainingDescendantCount = $null
function Read-TaskSystemCommit {
    try {
        $sample = Get-CimInstance Win32_PerfFormattedData_PerfOS_Memory -ErrorAction Stop
        if ($null -eq $sample -or $null -eq $sample.CommittedBytes -or $null -eq $sample.CommitLimit) { return $null }
        return @{ committedBytes = [long]$sample.CommittedBytes; limitBytes = [long]$sample.CommitLimit }
    } catch { return $null } # Missing diagnostics are unknown, never zero.
}
$taskInitialCommit = $null
try {
    try { $taskOwnsMutex = $taskMutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $taskOwnsMutex = $true }
    if (-not $taskOwnsMutex) { throw 'Another low-load history task is running. Do not start a second one.' }
    $taskCpu = Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor -Filter "Name='_Total'"
    $taskMemory = Get-CimInstance Win32_OperatingSystem
    if ($null -eq $taskCpu -or $null -eq $taskMemory) { throw 'Resource preflight unavailable; do not start.' }
    $taskMinimumFreeKB = [Math]::Max(8 * 1MB, $taskMemory.TotalVisibleMemorySize * 0.2)
    if ($taskCpu.PercentProcessorTime -ge 50 -or $taskMemory.FreePhysicalMemory -lt $taskMinimumFreeKB) {
        throw ('Resource preflight refused: CPU={0}%, free memory={1:N1} GiB, required reserve={2:N1} GiB. Defer acceptance; do not retry automatically.' -f $taskCpu.PercentProcessorTime, ($taskMemory.FreePhysicalMemory / 1MB), ($taskMinimumFreeKB / 1MB))
    }
    Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public sealed class T8HistoryJob : IDisposable {
    [StructLayout(LayoutKind.Sequential)] public struct Cpu { public uint Flags, Rate; }
    [StructLayout(LayoutKind.Sequential)] public struct Basic {
        public long ProcessTime, JobTime; public uint Flags;
        public UIntPtr MinWorkingSet, MaxWorkingSet; public uint ActiveProcesses;
        public UIntPtr Affinity; public uint PriorityClass, SchedulingClass;
    }
    [StructLayout(LayoutKind.Sequential)] public struct Io { public ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes; }
    [StructLayout(LayoutKind.Sequential)] public struct Extended {
        public Basic Basic; public Io Io; public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
    }
    [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)] static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job, int type, IntPtr value, uint size);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job, int type, IntPtr value, uint size, IntPtr returned);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool IsProcessInJob(IntPtr process, IntPtr job, out bool result);
    [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll")] static extern uint GetCurrentProcessId();
    [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateProcess(IntPtr process, uint exitCode);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    IntPtr handle;
    void Set<T>(int type, T value) where T:struct {
        int size=Marshal.SizeOf<T>(); IntPtr memory=Marshal.AllocHGlobal(size);
        try { Marshal.StructureToPtr(value,memory,false); if(!SetInformationJobObject(handle,type,memory,(uint)size)) throw new Win32Exception(); }
        finally { Marshal.FreeHGlobal(memory); }
    }
    T Read<T>(int type) where T:struct {
        int size=Marshal.SizeOf<T>(); IntPtr memory=Marshal.AllocHGlobal(size);
        try { if(!QueryInformationJobObject(handle,type,memory,(uint)size,IntPtr.Zero)) throw new Win32Exception(); return Marshal.PtrToStructure<T>(memory); }
        finally { Marshal.FreeHGlobal(memory); }
    }
    public T8HistoryJob() {
        handle=CreateJobObject(IntPtr.Zero,null); if(handle==IntPtr.Zero) throw new Win32Exception();
        try {
            Set(15,new Cpu { Flags=0x1|0x4, Rate=1000 }); // enable + hard cap: 10%
            Set(9,new Extended { Basic=new Basic { Flags=0x20|0x200, PriorityClass=0x4000 }, JobMemory=new UIntPtr(4UL*1024*1024*1024) });
            var cpu=Read<Cpu>(15); var limits=Read<Extended>(9);
            if(cpu.Flags!=5 || cpu.Rate!=1000 || limits.JobMemory.ToUInt64()!=4UL*1024*1024*1024 || limits.Basic.PriorityClass!=0x4000) throw new Exception("Job limits did not read back exactly");
            if(!AssignProcessToJobObject(handle,GetCurrentProcess())) throw new Win32Exception();
        } catch { Dispose(); throw; }
    }
    public bool Contains(IntPtr process) { bool result; if(!IsProcessInJob(process,handle,out result)) throw new Win32Exception(); return result; }
    // Query this exact anonymous Job, not process names or reusable parent PIDs.
    // https://learn.microsoft.com/windows/win32/api/winnt/ns-winnt-jobobject_basic_process_id_list
    public int[] ProcessIds() {
        for(int capacity=64; capacity<=4096; capacity*=2) {
            int size=8+capacity*IntPtr.Size; IntPtr memory=Marshal.AllocHGlobal(size);
            try {
                bool ok=QueryInformationJobObject(handle,3,memory,(uint)size,IntPtr.Zero);
                if(!ok) { int error=Marshal.GetLastWin32Error(); if(error==234) continue; throw new Win32Exception(error); }
                int assigned=Marshal.ReadInt32(memory,0), count=Marshal.ReadInt32(memory,4);
                if(assigned<0 || count<0 || count>capacity) throw new InvalidOperationException("Invalid Job process list");
                if(count<assigned) continue;
                var ids=new int[count]; for(int i=0;i<count;i++) ids[i]=checked((int)Marshal.ReadIntPtr(memory,8+i*IntPtr.Size).ToInt64());
                return ids;
            } finally { Marshal.FreeHGlobal(memory); }
        }
        throw new InvalidOperationException("Job process list exceeded bounded capacity");
    }
    public bool StopOwnedProcess(int pid) {
        if(pid<=0 || (uint)pid==GetCurrentProcessId()) throw new InvalidOperationException("Never stop the runner itself");
        // Keep one handle through identity verification and termination so PID
        // reuse cannot turn a stale snapshot into termination of another app.
        IntPtr process=OpenProcess(0x1000|0x1,false,(uint)pid);
        if(process==IntPtr.Zero) { int error=Marshal.GetLastWin32Error(); if(error==87) return false; throw new Win32Exception(error); }
        try {
            if(!Contains(process)) return false;
            if(!TerminateProcess(process,1)) throw new Win32Exception();
            return true;
        } finally { CloseHandle(process); }
    }
    public uint CpuRate { get { return Read<Cpu>(15).Rate; } }
    public ulong MemoryBytes { get { return Read<Extended>(9).JobMemory.ToUInt64(); } }
    public ulong PeakJobBytes { get { return Read<Extended>(9).PeakJobMemory.ToUInt64(); } }
    public ulong PeakProcessBytes { get { return Read<Extended>(9).PeakProcessMemory.ToUInt64(); } }
    public void Dispose() { if(handle!=IntPtr.Zero) { CloseHandle(handle); handle=IntPtr.Zero; } }
}
'@
    $taskJob = [T8HistoryJob]::new()
    # An independent outer receipt survives an abrupt Node verifier exit. It
    # does not assert descendant cleanup, acceptance or the cause of an OOM.
    $taskInitialCommit = Read-TaskSystemCommit
    $taskReceiptDirectory = Join-Path $taskRoot 'artifacts/history-low-load-runner'
    New-Item -ItemType Directory -Path $taskReceiptDirectory -Force | Out-Null
    $taskReceiptPath = Join-Path $taskReceiptDirectory ([Guid]::NewGuid().ToString('N') + '.json')
    $env:T8_ACCEPTANCE_RUNNER_RECEIPT = $taskReceiptPath
    [IO.File]::WriteAllText($taskReceiptPath, (@{
        schema='t8-history-runner-receipt-v1'; mode=$Mode; startedAt=$taskStartedAt;
        runnerFinished=$false; childExitCode=$null; acceptanceStatus='not-evaluated'
    } | ConvertTo-Json -Depth 4))
    $env:GOMAXPROCS = '1'
    # GC budgets trigger earlier collection; neither is a native-memory cap.
    # Keep the aggregate Job limit unchanged and record the actual outcome.
    $env:GOMEMLIMIT = '512MiB'
    $taskNodeHeapFlag = '--max-old-space-size=768'
    $env:UV_THREADPOOL_SIZE = '2'
    $env:T8_ACCEPTANCE_LOW_LOAD = '1'
    $env:T8_ACCEPTANCE_SOFTWARE_RENDERING = '1'
    if ($Mode -eq 'Probe') {
        # An idle child proves membership without a CPU stress test or Electron.
        $probeStart = [Diagnostics.ProcessStartInfo]::new($taskNode)
        $probeStart.UseShellExecute = $false
        $probeStart.CreateNoWindow = $true
        $probeStart.ArgumentList.Add($taskNodeHeapFlag)
        $probeStart.ArgumentList.Add('-e')
        $taskProbeCode = "setTimeout(()=>process.exit($ProbeExitCode),1500)"
        if ($ProbeLeaveIdleChild) {
            # Detach from Node's parent-lifetime cleanup, not from our Windows
            # Job. Idle and self-expiring even if cleanup fails; no Electron.
            $taskProbeCode = "const child=require('node:child_process').spawn(process.execPath,['--max-old-space-size=64','-e','setTimeout(()=>{},15000)'],{stdio:'ignore',windowsHide:true,detached:true}); child.unref(); console.log(JSON.stringify({idleDescendantPid:child.pid})); " + $taskProbeCode
        }
        $probeStart.ArgumentList.Add($taskProbeCode)
        $taskPhase = 'idle-probe-running'
        $probeProcess = [Diagnostics.Process]::Start($probeStart)
        try {
            if (-not $taskJob.Contains($probeProcess.Handle)) { throw 'Child escaped the resource-limited job.' }
            $probeProcess.WaitForExit()
            $taskChildExitCode = $probeProcess.ExitCode
            $taskExitCode = $taskChildExitCode
            $taskPhase = 'idle-probe-exited'
            [pscustomobject]@{Mode='Probe';Passed=($taskChildExitCode -eq 0);ChildExitCode=$taskChildExitCode;CpuHardCapPercent=$taskJob.CpuRate/100;JobCommitLimitMB=$taskJob.MemoryBytes/1MB;Priority='BelowNormal';ChildInJob=$true;ElectronStarted=$false} | ConvertTo-Json -Compress
        } finally { $probeProcess.Dispose() }
    } else {
        $activeTests = Get-CimInstance Win32_Process | Where-Object {
            $_.Name -in @('electron.exe','node.exe') -and
            ($_.CommandLine -like '*verify-generation-history-full-electron.cjs*' -or $_.CommandLine -like '*verify-history-basic-settings-ui.cjs*' -or $_.CommandLine -like '*t8-full-electron-*')
        }
        if ($activeTests) { throw 'An existing acceptance process is alive; inspect it instead of starting another.' }
        $taskDrive = [IO.Path]::GetPathRoot($taskRoot)
        $taskDisk = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$($taskDrive.TrimEnd('\'))'"
        if (-not $taskDisk -or $taskDisk.FreeSpace -lt 10GB) { throw 'At least 10 GB of free scratch-disk space is required.' }
        $taskScratch = Join-Path $taskDrive ('t8-history-low-load-' + [Guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $taskScratch | Out-Null
        $env:TEMP = $taskScratch
        $env:TMP = $taskScratch
        $env:T8_ACCEPTANCE_SCENARIO = if ($Mode -eq 'GeneratedVersions') { 'generated-versions' } elseif ($Mode -eq 'BasicSettingsPersist') { 'basic-settings' } elseif ($Mode -eq 'ImageInputPersist') { 'image-input-draft' } elseif ($Mode -eq 'BudgetImageInputPersist') { 'budget-image-input-draft' } elseif ($Mode -eq 'FalImageInputPersist') { 'fal-image-input-draft' } elseif ($Mode -eq 'VideoInputPersist') { 'video-input-draft' } elseif ($Mode -eq 'FalVideoInputPersist') { 'fal-video-input-draft' } else { 'full-history' }
        if ($Mode -eq 'FalImageInputPersist') { $env:T8_ACCEPTANCE_FAL_MODEL = $FalModel }
        if ($Mode -eq 'BudgetImageInputPersist') { $env:T8_ACCEPTANCE_BUDGET_MODEL = $BudgetModel }
        if ($Mode -eq 'FalVideoInputPersist') { $env:T8_ACCEPTANCE_FAL_VIDEO_MODEL = $FalVideoModel }
        if ($Mode -eq 'BananaImageInputPersist') {
            $env:T8_ACCEPTANCE_SCENARIO = 'banana-image-input-draft'
            $env:T8_ACCEPTANCE_BANANA_MODEL = $BananaModel
        }
        # One model per full-client invocation; no accumulating five canvases
        # through repeated reloads in a single memory-limited renderer session.
        if ($Mode -eq 'BasicSettingsPersist') { $env:T8_ACCEPTANCE_SETTINGS_CASE = $SettingsCase }
        $env:T8_ACCEPTANCE_UI_KIND = if ($Mode -eq 'ImageInputUI') { 'image-input' } else { 'settings' }
        Push-Location $taskRoot
        try {
            & $taskNode scripts/worktree-role.cjs development
            if ($LASTEXITCODE -ne 0) { throw 'Development worktree gate rejected the task.' }
            [pscustomobject]@{Mode=$Mode;CpuHardCapPercent=10;JobCommitLimitMB=4096;Priority='BelowNormal';SoftwareRendering=$true;AutomaticRetries=0;Scratch=$taskScratch} | ConvertTo-Json -Compress
            $taskPhase = 'verifier-running'
            if ($Mode -eq 'TransportProbe') { & $taskNode $taskNodeHeapFlag scripts/diagnose-history-electron-transport.cjs }
            elseif ($Mode -eq 'HistoryUI') {
                $taskElectronNode = Join-Path $taskRoot 'node_modules/electron/dist/electron.exe'
                if (-not (Test-Path -LiteralPath $taskElectronNode -PathType Leaf)) { throw 'Current Electron Node runtime is unavailable.' }
                $env:ELECTRON_RUN_AS_NODE = '1'
                $env:NODE_OPTIONS = $taskNodeHeapFlag
                $env:JITI_CACHE = 'false'
                try {
                    $taskHistoryUiStart = [Diagnostics.ProcessStartInfo]::new($taskElectronNode)
                    $taskHistoryUiStart.UseShellExecute = $false
                    $taskHistoryUiStart.CreateNoWindow = $true
                    $taskHistoryUiStart.WorkingDirectory = $taskRoot
                    $taskHistoryUiStart.ArgumentList.Add((Join-Path $taskRoot 'scripts/verify-generation-history-ui.cjs'))
                    $taskHistoryUiProcess = [Diagnostics.Process]::Start($taskHistoryUiStart)
                    try {
                        if (-not $taskJob.Contains($taskHistoryUiProcess.Handle)) { throw 'History UI verifier escaped the resource-limited job.' }
                        $taskHistoryUiProcess.WaitForExit()
                        $taskHistoryUiExitCode = $taskHistoryUiProcess.ExitCode
                    } finally { $taskHistoryUiProcess.Dispose() }
                }
                finally {
                    Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
                    Remove-Item Env:NODE_OPTIONS -ErrorAction SilentlyContinue
                    Remove-Item Env:JITI_CACHE -ErrorAction SilentlyContinue
                }
            }
            elseif ($Mode -in @('BasicSettingsUI', 'ImageInputUI')) { & $taskNode $taskNodeHeapFlag scripts/verify-history-basic-settings-ui.cjs }
            elseif ($Mode -eq 'CreativeCanvas') { & $taskNode $taskNodeHeapFlag scripts/verify-creative-canvas.cjs }
            elseif ($Mode -eq 'StrataCanvas') { & $taskNode $taskNodeHeapFlag scripts/verify-strata-canvas.cjs }
            elseif ($Mode -eq 'KlingCanvas') { & $taskNode $taskNodeHeapFlag scripts/verify-kling-v4-canvas.cjs }
            elseif ($Mode -eq 'MotionCanvas') { & $taskNode $taskNodeHeapFlag scripts/verify-motion-video-canvas.cjs }
            elseif ($Mode -eq 'CanvasSave') { & $taskNode $taskNodeHeapFlag scripts/verify-canvas-save-conflict.cjs }
            elseif ($Mode -eq 'UpdateExit') { & $taskNode $taskNodeHeapFlag scripts/verify-update-full-app.cjs }
            else { & $taskNode $taskNodeHeapFlag scripts/verify-generation-history-full-electron.cjs }
            $taskExitCode = if ($Mode -eq 'HistoryUI') { $taskHistoryUiExitCode } else { $LASTEXITCODE }
            $taskChildExitCode = $taskExitCode
            $taskPhase = 'verifier-exited'
        } finally { Pop-Location }
    }
} catch {
    $taskExitCode = 1
    $taskFailureKind = 'runner-error'
    throw
} finally {
    # The synchronous verifier/probe has ended before this point. Native death
    # may bypass its own finally; release only this Job's leftover descendants.
    # Forced disposal always fails acceptance, even if the verifier returned 0.
    if ($taskJob) {
        try {
            $taskCleanupStatus = 'clean'
            for ($taskCleanupPass = 0; $taskCleanupPass -lt 10; $taskCleanupPass++) {
                $taskRemaining = @($taskJob.ProcessIds() | Where-Object { $_ -ne $PID })
                if ($taskRemaining.Count -eq 0) { break }
                $taskCleanupStatus = 'forced-test-disposal'
                if ($taskExitCode -eq 0) { $taskExitCode = 1 }
                foreach ($taskOwnedId in $taskRemaining) {
                    if ($taskJob.StopOwnedProcess($taskOwnedId)) { $taskForcedDescendantCount++ }
                }
                Start-Sleep -Milliseconds 200
            }
            $taskRemainingDescendantCount = @($taskJob.ProcessIds() | Where-Object { $_ -ne $PID }).Count
            $taskDescendantExitVerified = $taskRemainingDescendantCount -eq 0
            if (-not $taskDescendantExitVerified) { throw 'Owned Job descendants remain after bounded cleanup' }
        } catch {
            $taskCleanupStatus = 'incomplete'
            $taskDescendantExitVerified = $false
            if ($taskExitCode -eq 0) { $taskExitCode = 1 }
            Write-Warning 'Owned Job cleanup incomplete; do not retry or infer normal application shutdown.'
        }
    }
    if ($taskReceiptPath) {
        try {
            $taskPeakJob = $null; $taskPeakProcess = $null
            if ($taskJob) { $taskPeakJob = $taskJob.PeakJobBytes; $taskPeakProcess = $taskJob.PeakProcessBytes }
            [IO.File]::WriteAllText($taskReceiptPath, (@{
                schema='t8-history-runner-receipt-v1'; mode=$Mode; startedAt=$taskStartedAt; finishedAt=[DateTime]::UtcNow.ToString('o');
                runnerFinished=$true; phase=$taskPhase; runnerExitCode=$taskExitCode; childExitCode=$taskChildExitCode;
                failureKind=$taskFailureKind; acceptanceStatus='not-evaluated'; descendantExitVerified=$taskDescendantExitVerified; cleanupStatus=$taskCleanupStatus;
                forcedDescendantCount=$taskForcedDescendantCount; remainingDescendantCount=$taskRemainingDescendantCount;
                cpuHardCapPercent=10; jobCommitLimitBytes=4GB; peakJobBytes=$taskPeakJob; peakProcessBytes=$taskPeakProcess;
                nodeOldSpaceMiB=768; goSoftMemoryLimit='512MiB';
                systemCommitBefore=$taskInitialCommit; systemCommitAfter=(Read-TaskSystemCommit)
            } | ConvertTo-Json -Depth 4))
            Write-Output "Runner receipt: $taskReceiptPath"
        } catch { Write-Warning 'Runner diagnostic receipt incomplete; do not infer a clean exit from missing fields.' }
    }
    # The verifier cleans its own fixtures; remove only an empty wrapper root.
    if ($taskScratch -and (Test-Path -LiteralPath $taskScratch)) {
        if (@(Get-ChildItem -LiteralPath $taskScratch -Force).Count -eq 0) { Remove-Item -LiteralPath $taskScratch }
        else { Write-Warning "Owned scratch retained for inspection: $taskScratch" }
    }
    if ($taskJob) { $taskJob.Dispose() }
    if ($taskOwnsMutex) { $taskMutex.ReleaseMutex() }
    $taskMutex.Dispose()
}
exit $taskExitCode
