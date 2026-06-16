update sync_status
set status = 'failed',
    completed_at = now(),
    error_message = 'reset before n6v cutover'
where sync_type = 'full_market'
  and status = 'running';
