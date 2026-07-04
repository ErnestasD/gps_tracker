/**
 * Plain counters for E01-5 tests and logs. prom-client exposition arrives in E02-5
 * (metric NAMES are frozen in Appendix A — these map 1:1 onto them).
 */
export class IngestMetrics {
  msgsTotal = 0 // ingest_msgs_total
  parseFailTotal = 0 // ingest_parse_fail_total
  frameViolationsTotal = 0 // ingest_frame_violations_total
  ackedRecordsTotal = 0
  rejectedImeiTotal = 0
  sanityRejectsTotal = 0
  pausedSockets = 0 // gauge: sockets currently paused by backpressure
  sessionErrorsTotal = 0
}
