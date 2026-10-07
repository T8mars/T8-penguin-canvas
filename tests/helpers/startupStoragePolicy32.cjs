'use strict';
// Explicit small synthetic-fixture policy, not a production capacity bypass.
const mib = (value) => value * 1024 * 1024;
module.exports = Object.freeze({
  mainMaxBytes: mib(64), walCheckpointTargetBytes: mib(1),
  maximumSingleTransactionWalBytes: mib(4), walPressureBytes: mib(8),
  walReserveBytes: mib(16), walResidualLimitBytes: mib(0.5),
  shmReserveBytes: mib(4), hotJournalReserveBytes: mib(8),
  sqliteTempReserveBytes: mib(16), minimumFilesystemFreeBytes: mib(64),
  backupCandidateReserveBytes: mib(80), recoveryEvidenceReserveBytes: mib(96),
});
